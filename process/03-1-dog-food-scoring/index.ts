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
const BATCH_SIZE = 10;

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
      const [foodNumber, scoreStr, ...reasonParts] = line.split(',');
      const score = parseInt(scoreStr, 10);
      const reason = reasonParts.join(',').replace(/^"|"$/g, '');
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
  const lines = newScores.map(s => formatCSVLine([s.foodNumber, s.score.toString(), s.reason]));
  const content = lines.join('\n') + '\n';
  
  try {
    await access(scoresFile);
    // ファイルが存在する場合は追記
    const existing = await readFile(scoresFile, 'utf-8');
    await writeFile(scoresFile, existing + content, 'utf-8');
  } catch {
    // ファイルが存在しない場合は新規作成（ヘッダー付き）
    const header = formatCSVLine(['食品番号', 'スコア', '理由']);
    await writeFile(scoresFile, header + '\n' + content, 'utf-8');
  }
}

/**
 * AIで食品のスコアを評価
 */
async function evaluateFoods(foods: Array<{ batchIndex: number; originalIndex: number; foodNumber: string; foodName: string; structuredName: string }>): Promise<{ scores: ScoreResult[]; cost: CostResult | null }> {
  const foodList = foods.map((f) => 
    `${f.batchIndex}. 食品番号: ${f.foodNumber}, 食品名: ${f.foodName}`
  ).join('\n');

  const prompt = `あなたは犬の栄養と健康に関する専門家です。以下の食品リストについて、各食品が「犬のレシピ素材として適しているか」を10段階で評価してください。

## 評価基準

### スコアの定義
- **1-2点**: 危険 - 犬に有害な成分を含む、絶対に与えてはいけない（例：玉ねぎ、ぶどう、チョコレート）
- **3-4点**: 不適切 - 過剰な加工、高塩分、高糖分など犬の食事に適さない
- **5-6点**: 条件付き - 加工度が高い、調理済み食品など、素材として使いにくい
- **7-8点**: 適切 - 犬のレシピ素材として使用可能
- **9-10点**: 最適 - 犬のレシピ素材として理想的（生鮮食品、肉類、野菜など）

### 評価軸
1. **毒性・有害性（最重要）**: 玉ねぎ・ネギ類、ぶどう・レーズン、チョコレート、マカダミアナッツ、キシリトール、アルコールなどは自動的に1-2点
2. **加工度・調理済み状態**: 生鮮食品は高評価、調理済み食品・惣菜は低評価
3. **塩分・糖分**: 高塩分・高糖分の食品は低評価
4. **素材としての実用性**: 単一素材は高評価、複合食品・料理は低評価

## 評価対象食品

${foodList}

## 出力形式

各食品について、以下のJSON形式で出力してください：
\`\`\`json
[
  {"index": 1, "score": 8, "reason": "評価理由を簡潔に"},
  {"index": 2, "score": 2, "reason": "評価理由を簡潔に"},
  ...
]
\`\`\`

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
      scores: evaluations.map((eval: any) => {
        const food = foods.find(f => f.batchIndex === eval.index);
        if (!food) {
          throw new Error(`評価結果のindex ${eval.index}に対応する食品が見つかりません`);
        }
        return {
          foodNumber: food.foodNumber,
          score: eval.score,
          reason: eval.reason || '',
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
  const foods = dataRows.map((row, originalIndex) => {
    const foodNumber = row[1] || '';
    const foodName = row[3] || '';
    const structuredName = row[row.length - 1] || '{}'; // 最後の列が構造化食品名
    return {
      originalIndex,
      foodNumber,
      foodName,
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
