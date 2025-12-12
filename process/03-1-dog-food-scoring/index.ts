import dotenv from 'dotenv';
import { mkdir, writeFile, readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { calculateCost, formatCost, type CostResult } from '../../utils/cost-calculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../02-food-name-normalize/result/claude-json-header-with-structured-names.csv');
const scoresFile = join(resultDir, 'scores.csv');
const progressFile = join(resultDir, 'progress.json');

// シャッフル用の固定シード値
const SHUFFLE_SEED = 42;
const BATCH_SIZE = 20;

interface Progress {
  processedIndices: number[];
  shuffledIndices: number[];
}

interface ScoreResult {
  foodNumber: string;
  score: number;
  reason: string;
}

/**
 * シード値を使った再現可能なシャッフル
 */
function seededShuffle<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let currentSeed = seed;
  
  // 簡易的な線形合同法による乱数生成
  function random() {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  }
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

/**
 * CSV全体をパース（改行を含むフィールドに対応）
 */
function parseCSVRecords(csvContent: string): string[][] {
  const records: string[][] = [];
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvContent.length) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 2;
        continue;
      } else {
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (!inQuotes) {
      if (char === ',') {
        fields.push(current);
        current = '';
        i++;
        continue;
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        fields.push(current);
        current = '';
        if (fields.some(f => f.trim())) {
          records.push([...fields]);
        }
        fields.length = 0;
        if (char === '\r' && nextChar === '\n') {
          i += 2;
        } else {
          i++;
        }
        continue;
      }
    }

    current += char;
    i++;
  }

  if (current || fields.length > 0) {
    fields.push(current);
    if (fields.some(f => f.trim())) {
      records.push([...fields]);
    }
  }

  return records;
}

/**
 * CSV行をフォーマット
 */
function formatCSVLine(columns: string[]): string {
  return columns.map(col => {
    if (col.includes(',') || col.includes('"') || col.includes('\n')) {
      return `"${col.replace(/"/g, '""')}"`;
    }
    return col;
  }).join(',');
}

/**
 * 進捗ファイルを読み込む
 */
async function loadProgress(): Promise<Progress | null> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 進捗ファイルを保存
 */
async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

/**
 * 既存のスコアファイルを読み込む
 */
async function loadExistingScores(): Promise<Map<string, ScoreResult>> {
  const scores = new Map<string, ScoreResult>();
  try {
    const content = await readFile(scoresFile, 'utf-8');
    const lines = content.trim().split('\n');
    // ヘッダー行をスキップ
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // 新しい順序: 食品番号, 理由, スコア
      const [foodNumber, ...rest] = line.split(',');
      const scoreStr = rest.pop() || '0';
      const score = parseInt(scoreStr.replace(/"/g, ''), 10);
      const reason = rest.join(',').replace(/^"|"$/g, '');
      scores.set(foodNumber, { foodNumber, score, reason });
    }
  } catch {
    // ファイルが存在しない場合は空のMapを返す
  }
  return scores;
}

/**
 * スコアをファイルに追記
 */
async function appendScores(newScores: ScoreResult[]): Promise<void> {
  const lines = newScores.map(s => formatCSVLine([s.foodNumber, s.reason, s.score.toString()]));
  const content = lines.join('\n') + '\n';
  
  try {
    await access(scoresFile);
    // ファイルが存在する場合は追記
    const existing = await readFile(scoresFile, 'utf-8');
    await writeFile(scoresFile, existing + content, 'utf-8');
  } catch {
    // ファイルが存在しない場合は新規作成（ヘッダー付き）
    const header = formatCSVLine(['食品番号', '理由', 'スコア']);
    await writeFile(scoresFile, header + '\n' + content, 'utf-8');
  }
}

/**
 * AIで食品のスコアを評価
 */
async function evaluateFoods(foods: Array<{ batchIndex: number; originalIndex: number; foodNumber: string; foodName: string; remark: string; structuredName: string }>): Promise<{ scores: ScoreResult[]; cost: CostResult | null }> {
  const foodList = foods.map((f) => {
    const remarkPart = f.remark ? `, 備考: ${f.remark}` : '';
    return `${f.batchIndex}. 食品番号: ${f.foodNumber}, 食品名: ${f.foodName}, 構造化: ${f.structuredName}${remarkPart}`;
  }).join('\n');

  const prompt = `あなたは犬の栄養と健康に関する専門家です。以下の食品リストについて、各食品が「犬のレシピ素材として適しているか」を10段階で評価してください。

## 重要な前提

この評価は「犬のレシピを自動生成するプログラム」のための素材適性判断です。以下の前提を必ず守ってください：

1. **栄養バランスはプログラムが管理**: ビタミン過剰、糖分過剰などはプログラムが計算・調整するため減点対象外
2. **少量使用が前提**: 高糖分・高塩分の食品でも、少量であれば問題ない
3. **添加物は減点対象外**: ビタミン添加など、添加物自体は悪いものではない
4. **生で食べられない食品は減点対象**: 食品名に「生」が含まれる場合、犬が生で食べられない食品は減点する（後述の「生食禁止リスト」参照）

## ★★★ 犬に絶対禁忌の食品リスト（1-2点を必ずつける）★★★

以下の食品は犬に有害な成分を含み、少量でも危険です。これらが含まれる食品は必ず1-2点としてください：

### 1. ネギ属（アリルプロピルジスルフィド → 溶血性貧血）
- 玉ねぎ、タマネギ、ねぎ、長ねぎ、青ねぎ、わけぎ、あさつき、にら、にんにく、らっきょう、エシャロット、リーキ
- ※加熱しても毒性は消えない

### 2. ぶどう類（酒石酸 → 急性腎不全）
- ぶどう、マスカット、巨峰、デラウェア、レーズン、干しぶどう、ぶどうジュース、ワイン
- ※少量でも腎不全を引き起こす可能性あり

### 3. プルーン・すもも（果肉自体が危険）
- プルーン（生・ドライ両方）、すもも、プラム → 1-2点
- 理由：ソルビトール（糖アルコール）が多く消化器障害、高カリウムで心臓への影響
- ※他の核果類（桃、さくらんぼ等）とは異なり、果肉自体が危険

### 4. チョコレート・カフェイン（テオブロミン・カフェイン → 神経・心臓毒性）
- チョコレート、ココア、カカオ、コーヒー、紅茶、緑茶、抹茶、コーラ、エナジードリンク

### 5. マカダミアナッツ（神経毒性）
- マカダミアナッツ → 絶対禁止（脱力、嘔吐、高体温）

### 6. くるみ・ペカン（ジュグロン → 神経毒性）
- くるみ、ペカン → 1-2点

### 7. アルコール（エタノール → 中枢神経抑制）
- 酒類全般、みりん、料理酒、ワイン、ビール、日本酒、焼酎、ウイスキー、ブランデー、リキュール、ラム

### 8. キシリトール（低血糖、肝障害）
- キシリトール含有食品、ガム、キャンディ

### 9. ナツメグ（ミリスチシン → 神経毒性）
- ナツメグ、ナツメグ含有食品 → 震え、けいれん

### 10. いちじく（フィシン・ソラレン → 消化器刺激、光線過敏症）
- いちじく（生・ドライ両方）→ 1-2点

### 11. スターフルーツ（シュウ酸・カランボキシン → 腎臓障害）
- スターフルーツ → 1-2点（少量でも危険）

### 12. ザクロ（消化器障害）
- ザクロ → 2-3点

## ★★ 注意が必要な食品（3-5点）★★

### 香辛料（消化器刺激）
- 唐辛子、わさび、からし、山椒、胡椒、カレー粉 → 3-4点

### その他ナッツ（消化不良、膵炎リスク）
- アーモンド、ピスタチオ、カシューナッツ、ピーナッツ → 4-5点

### 柑橘類の皮・種（ソラレン・リモネン）
- レモン、グレープフルーツ → 3-4点（果肉のみなら5-6点）
- みかん、オレンジの果肉 → 7-8点（皮・種は除去前提）

### アボカド（ペルシン）
- アボカド → 4-5点（犬への毒性は明確なエビデンス不足だが、脂肪分が高く注意）

## ★ 安全な核果類（果肉は安全、種・茎・葉は危険）★

以下の果物の**果肉のみ**は犬に与えて問題ありません：
- 桃、もも、ネクタリン → 7-8点
- あんず、杏 → 7-8点
- さくらんぼ、チェリー（果肉のみ）→ 7-8点
- びわ → 7-8点
- りんご（果肉のみ、種・芯は危険）→ 8-9点
- マンゴー、パパイヤ（果肉のみ）→ 7-8点

※種・茎・葉にはアミグダリン（青酸配糖体）が含まれるため危険だが、食品成分表の食品は通常果肉のみを指す

## ★★ 生食注意リスト（stateが「生」の場合の減点基準）★★

構造化食品名のstateが「生」の場合、以下を確認して減点：

### 1. 生の豚肉・鶏肉（細菌・寄生虫リスク）→ 5-6点
- 生の豚肉：トリヒナ寄生虫、サルモネラ菌
- 生の鶏肉：サルモネラ菌、カンピロバクター菌
- ※加熱済み（「ゆで」「焼き」「蒸し」等）は8-9点

### 2. 生の牛肉・馬肉・羊肉 → 7-8点
- 生でも比較的安全だが、細菌リスクはある
- ※加熱済みは9-10点

### 3. 生卵（アビジン・サルモネラ）→ 5-6点
- 生卵白はビオチン吸収を阻害
- ※加熱済みは8-9点

### 4. 生の魚介類（チアミナーゼ・寄生虫）→ 5-6点
- 生のイカ、タコ、エビ、カニ、貝類：ビタミンB1欠乏症リスク
- 生の川魚：寄生虫リスク高い → 4-5点
- 生の海水魚（刺身用）：比較的安全 → 6-7点
- ※加熱済みは8-9点

### 5. 生の大豆（トリプシンインヒビター）→ 4-5点
- 消化酵素を阻害、消化不良を引き起こす
- ※加熱済み（豆腐、納豆等）は7-8点

### 6. 生のじゃがいも（ソラニン）→ 3-4点
- 特に芽・緑色部分は危険
- ※加熱済みは7-8点

### 7. 未熟なトマト・生のナス（ソラニン）→ 4-5点
- 熟したトマトは安全 → 7-8点

## 評価基準

### スコアの定義
- **1-2点**: 上記禁忌リストに該当する危険な食品
- **3-4点**: 複合調理済み食品（惣菜、弁当、フライ）、禁忌に準ずる食品（生魚介類、香辛料）
- **5-6点**: 加工度が高いが素材として使える可能性あり
- **7-8点**: 犬のレシピ素材として使用可能
- **9-10点**: 犬のレシピ素材として理想的（肉類、魚類、野菜など）

### 減点対象外（これらで減点してはいけない）
- 「糖分が高い」「塩分が高い」（少量使用・プログラムが調整）
- 「ビタミン過剰の恐れ」（プログラムが栄養計算）
- 「添加物が含まれる」（添加物自体は問題ない）
- 「骨がある」「殻がある」（調理時に除去される前提）
- 加熱済みの食品（「ゆで」「焼き」「蒸し」「煮」等の調理済み表記がある場合）

### 注意：「生」の判定（構造化食品名を参照）

各食品には以下の情報が含まれます：

**構造化フィールド（JSON形式）**:
- **state**: 調理状態（「生」「ゆで」「焼き」「蒸し」「煮」等）
- **baseName**: 基本食品名
- **variety**: 品種・種類
- **part**: 部位

**備考フィールド**:
- 原材料配合割合、調理方法、別名などの補足情報
- 例：「原材料配合割合： 玉ねぎ 30」→ 玉ねぎが含まれるため禁忌

**判定方法**:
1. 構造化JSONの「state」フィールドを確認
2. state が「生」の場合 → 生食禁止リストを確認し、該当すれば減点（4-5点）
3. state が「ゆで」「焼き」「蒸し」「煮」等の場合 → 減点しない
4. baseName で禁忌食品（玉ねぎ、ぶどう、プルーン等）を判定
5. **備考欄も確認**: 原材料に禁忌食品が含まれていないか確認

## 評価対象食品

${foodList}

## 出力形式

まず禁忌リストに該当するか確認し、理由を考え、その後にスコアを決定してください。以下のJSON形式で出力：
\`\`\`json
[
  {"index": 1, "reason": "評価理由を簡潔に", "score": 8},
  {"index": 2, "reason": "評価理由を簡潔に", "score": 2},
  ...
]
\`\`\`

### 理由の書き方（重要）

理由はユーザーに直接表示されるため、以下のルールを守ってください：

- **内部事情を書かない**: 「プログラムで調整」「レシピプログラムが管理」「少量使用前提」などの内部的な理由は書かない
- **一般的な説明のみ**: 犬にとってなぜ適切/不適切かを一般的な表現で簡潔に説明
- **良い例**: 「豚肉は良質なタンパク源で犬のレシピ素材として適切」
- **悪い例**: 「豚肉は良質なタンパク源。プログラムが栄養計算するため適切」

必ず全ての食品について評価してください。`;

  const MODEL_NAME = 'gpt-5-mini-2025-08-07';
  
  try {
    const result = await generateText({
      model: openai(MODEL_NAME),
      prompt,
      temperature: 0.3,
    });

    // トークン使用量と料金を計算・表示
    const inputTokens = result.usage?.promptTokens || 0;
    const outputTokens = result.usage?.completionTokens || 0;
    const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
    console.log(formatCost(cost));

    // JSONを抽出
    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/) || 
                      result.text.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      throw new Error('JSONが見つかりませんでした');
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const evaluations = JSON.parse(jsonText);

    // 評価結果をScoreResultに変換
    return {
      scores: evaluations.map((evaluation: any) => {
        const food = foods.find(f => f.batchIndex === evaluation.index);
        if (!food) {
          throw new Error(`評価結果のindex ${evaluation.index}に対応する食品が見つかりません`);
        }
        return {
          foodNumber: food.foodNumber,
          score: evaluation.score,
          reason: evaluation.reason || '',
        };
      }),
      cost, // 料金情報も返す
    };
  } catch (error) {
    console.error('AI評価エラー:', error);
    // エラー時はデフォルトスコアを返す
    return {
      scores: foods.map(f => ({
        foodNumber: f.foodNumber,
        score: 5,
        reason: '評価エラー: ' + (error instanceof Error ? error.message : String(error)),
      })),
      cost: null,
    };
  }
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('CSVファイルを読み込んでいます...');
  const csvContent = await readFile(inputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  // ヘッダー行を除くデータ行
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // 食品番号（2列目、インデックス1）と食品名（4列目、インデックス3）を取得
  // 備考欄は最後から2番目、構造化食品名は最後の列
  const foods = dataRows.map((row, originalIndex) => {
    const foodNumber = row[1] || '';
    const foodName = row[3] || '';
    const remark = row[row.length - 2] || ''; // 備考欄（最後から2番目）
    const structuredName = row[row.length - 1] || '{}'; // 最後の列が構造化食品名
    return {
      originalIndex,
      foodNumber,
      foodName,
      remark,
      structuredName,
    };
  });

  // 進捗を読み込む
  let progress = await loadProgress();
  let shuffledIndices: number[];
  let processedPositions: Set<number>; // シャッフル後の位置（0, 1, 2...）を記録

  if (progress && progress.shuffledIndices.length === foods.length) {
    // 既存の進捗がある場合はそれを使用
    shuffledIndices = progress.shuffledIndices;
    processedPositions = new Set(progress.processedIndices);
    console.log(`既存の進捗を読み込みました。処理済み: ${processedPositions.size}/${foods.length}行`);
  } else {
    // 新規処理: シャッフル
    const indices = Array.from({ length: foods.length }, (_, i) => i);
    shuffledIndices = seededShuffle(indices, SHUFFLE_SEED);
    processedPositions = new Set();
    progress = {
      processedIndices: [],
      shuffledIndices,
    };
    await saveProgress(progress);
    console.log('シャッフル完了。処理を開始します。');
  }

  // 既存のスコアを読み込む
  const existingScores = await loadExistingScores();
  console.log(`既存のスコア: ${existingScores.size}件`);

  // バッチ処理
  let processedCount = processedPositions.size;
  for (let pos = 0; pos < shuffledIndices.length; pos += BATCH_SIZE) {
    // このバッチの位置範囲
    const batchPositions = Array.from(
      { length: Math.min(BATCH_SIZE, shuffledIndices.length - pos) },
      (_, i) => pos + i
    );
    
    // 未処理の位置のみをフィルタ
    const unprocessedPositions = batchPositions.filter(p => !processedPositions.has(p));
    
    if (unprocessedPositions.length === 0) {
      console.log(`スキップ: ${pos + 1}-${Math.min(pos + BATCH_SIZE, shuffledIndices.length)}行（既に処理済み）`);
      continue;
    }

    // 未処理の位置に対応する食品を取得
    const batch = unprocessedPositions.map((batchPos, batchIndex) => {
      const originalIndex = shuffledIndices[batchPos];
      return {
        batchIndex: batchIndex + 1, // AIに渡す用（1始まり）
        originalIndex,
        foodNumber: foods[originalIndex].foodNumber,
        foodName: foods[originalIndex].foodName,
        remark: foods[originalIndex].remark,
        structuredName: foods[originalIndex].structuredName,
      };
    });

    console.log(`\n処理中: ${pos + 1}-${Math.min(pos + BATCH_SIZE, shuffledIndices.length)}行（${unprocessedPositions.length}件）`);
    console.log(`食品: ${batch.map(b => b.foodName).join(', ')}`);

    // AI評価
    const result = await evaluateFoods(batch);
    const scores = result.scores;
    
    // 料金情報を表示（evaluateFoods内で既に表示されているが、累計も表示）
    if (result.cost) {
      // 累計料金の計算は必要に応じて追加可能
    }
    
    // 既存スコアと重複チェック（念のため）
    const newScores = scores.filter(s => !existingScores.has(s.foodNumber));
    
    if (newScores.length > 0) {
      await appendScores(newScores);
      newScores.forEach(s => existingScores.set(s.foodNumber, s));
    }

    // 進捗を更新（処理した位置を記録）
    unprocessedPositions.forEach(p => processedPositions.add(p));
    progress.processedIndices = Array.from(processedPositions).sort((a, b) => a - b);
    await saveProgress(progress);

    processedCount += unprocessedPositions.length;
    console.log(`完了: ${processedCount}/${foods.length}行処理済み`);

    // APIレート制限を考慮して少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n処理完了: ${scoresFile}`);
  console.log(`総処理行数: ${processedCount}行`);
}

main().catch(console.error);
