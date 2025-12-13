import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { calculateCost, formatCost, type CostResult } from '../../utils/cost-calculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../04-1-merge-tables/result/merged-nutrition.csv');
const outputFile = join(resultDir, 'search-keys.json');
const progressFile = join(resultDir, 'progress.json');

const BATCH_SIZE = 20;

interface Progress {
  processedFoodNumbers: string[];
}

interface SearchKeysResult {
  [foodNumber: string]: string[];
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
 * 進捗ファイルを読み込む
 */
async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedFoodNumbers: [] };
  }
}

/**
 * 進捗ファイルを保存
 */
async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

/**
 * 既存の検索キーを読み込む
 */
async function loadExistingKeys(): Promise<SearchKeysResult> {
  try {
    const content = await readFile(outputFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * 検索キーを保存
 */
async function saveSearchKeys(keys: SearchKeysResult): Promise<void> {
  await writeFile(outputFile, JSON.stringify(keys, null, 2), 'utf-8');
}

/**
 * AIで検索キーワードを生成
 */
async function generateSearchKeys(
  foods: Array<{ batchIndex: number; foodNumber: string; foodName: string; structuredName: string }>
): Promise<{ keys: Array<{ foodNumber: string; searchKeys: string[] }>; cost: CostResult | null }> {
  const foodList = foods.map((f) => {
    return `${f.batchIndex}. 食品番号: ${f.foodNumber}, 食品名: ${f.foodName}, 構造化: ${f.structuredName}`;
  }).join('\n');

  const prompt = `あなたは日本の食材に詳しい専門家です。以下の食品について検索用キーワードを生成してください。

## 最重要ルール：検索キーワードの本質

検索キーワードとは「ユーザーがこの食品を探すときに入力しそうな言葉」です。

**自問自答してください**：
「この食品が欲しい人は、検索窓に何と入力するか？」

例：「おおむぎ 七分つき押麦」が欲しい人は何と入力する？
→ 「大麦」「おおむぎ」「押麦」「barley」などで検索する
→ 「七分つき」「しちぶつき」とは絶対に入力しない（精白度は検索ワードではない）

## 含めるキーワード

1. **食材の基本名**（ひらがな・カタカナ・漢字・英語の各表記）
   - 例：大麦 → おおむぎ、オオムギ、大麦、barley
   
2. **一般的な別名・俗称**
   - 例：鶏ささみ → ささみ、ササミ、笹身
   
3. **部位・形態の一般的な呼び名**
   - 例：押麦 → おしむぎ、オシムギ

## 絶対に含めないもの

1. **記号を含む表現は一切禁止**
   - 括弧 ()、スラッシュ /、コロン : など記号が1つでも含まれていたらNG
   - 悪い例: "あわ (雑穀)" ← 括弧があるのでNG
   - 悪い例: "小麦粉/強力粉" ← スラッシュがあるのでNG

2. **誰も検索に使わない専門用語**
   - 精白度（七分つき、精白粒、玄穀など）
   - 等級（1等、2等など）

3. **調理状態**（生、ゆで、焼きなど）

4. **冗長なキーワード**
   - 「大麦」があれば「大麦押麦」は不要

## 具体例

### おおむぎ 七分つき押麦
正解: ["大麦", "おおむぎ", "オオムギ", "barley", "押麦", "おしむぎ", "オシムギ", "麦", "むぎ"]
不正解: ["七分つき", "しちぶつき"] ← 誰も検索しない

### こむぎ 強力粉 1等
正解: ["強力粉", "きょうりきこ", "キョウリキコ", "小麦粉", "こむぎこ", "コムギコ", "flour", "小麦", "こむぎ"]
不正解: ["1等", "いっとう"] ← 誰も検索しない

### 鶏 もも 皮つき 生
正解: ["鶏もも肉", "とりもも", "トリモモ", "鶏肉", "とりにく", "トリニク", "chicken", "もも肉", "ももにく"]
不正解: ["皮つき", "かわつき", "生", "なま"] ← 検索ワードではない

## 食品リスト

${foodList}

## 出力形式

\`\`\`json
[
  {"index": 1, "keys": ["食材名", "ひらがな", "カタカナ", "english", ...]},
  ...
]
\`\`\`

全食品について、ユーザーが実際に入力しそうなキーワードのみを生成してください。`;

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

    // 結果を変換
    return {
      keys: evaluations.map((evaluation: any) => {
        const food = foods.find(f => f.batchIndex === evaluation.index);
        if (!food) {
          throw new Error(`評価結果のindex ${evaluation.index}に対応する食品が見つかりません`);
        }
        return {
          foodNumber: food.foodNumber,
          searchKeys: evaluation.keys || [],
        };
      }),
      cost,
    };
  } catch (error) {
    console.error('AI生成エラー:', error);
    // エラー時はベース名のみを返す
    return {
      keys: foods.map(f => {
        // 構造化食品名からbaseNameを抽出
        try {
          const parsed = JSON.parse(f.structuredName);
          return {
            foodNumber: f.foodNumber,
            searchKeys: [parsed.baseName || f.foodName],
          };
        } catch {
          return {
            foodNumber: f.foodNumber,
            searchKeys: [f.foodName],
          };
        }
      }),
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

  // 食品データを抽出（食品番号:1, 食品名:2, 構造化食品名:30）
  const foods = dataRows.map((row) => {
    const foodNumber = row[1] || '';
    const foodName = row[2] || '';
    const structuredName = row[30] || '{}'; // 構造化食品名
    return {
      foodNumber,
      foodName,
      structuredName,
    };
  });

  // 進捗と既存データを読み込む
  const progress = await loadProgress();
  const existingKeys = await loadExistingKeys();
  const processedSet = new Set(progress.processedFoodNumbers);

  console.log(`既存の検索キー: ${Object.keys(existingKeys).length}件`);
  console.log(`処理済み: ${processedSet.size}件`);

  // 未処理の食品をフィルタ
  const unprocessedFoods = foods.filter(f => !processedSet.has(f.foodNumber));
  console.log(`未処理: ${unprocessedFoods.length}件`);

  if (unprocessedFoods.length === 0) {
    console.log('すべての食品が処理済みです。');
    return;
  }

  // バッチ処理
  let totalCostUSD = 0;
  for (let i = 0; i < unprocessedFoods.length; i += BATCH_SIZE) {
    const batch = unprocessedFoods.slice(i, i + BATCH_SIZE).map((f, idx) => ({
      batchIndex: idx + 1,
      ...f,
    }));

    console.log(`\n処理中: ${i + 1}-${Math.min(i + BATCH_SIZE, unprocessedFoods.length)}件目`);
    console.log(`食品: ${batch.map(b => b.foodName.substring(0, 15)).join(', ')}`);

    // AI生成
    const result = await generateSearchKeys(batch);

    // 結果を保存
    for (const item of result.keys) {
      existingKeys[item.foodNumber] = item.searchKeys;
      processedSet.add(item.foodNumber);
    }

    // ファイルに保存
    await saveSearchKeys(existingKeys);
    progress.processedFoodNumbers = Array.from(processedSet);
    await saveProgress(progress);

    if (result.cost) {
      totalCostUSD += result.cost.totalCostUSD;
    }

    console.log(`完了: ${processedSet.size}/${foods.length}件処理済み`);

    // APIレート制限を考慮して少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n処理完了: ${outputFile}`);
  console.log(`総処理件数: ${processedSet.size}件`);
  console.log(`累計料金: $${totalCostUSD.toFixed(6)} (¥${(totalCostUSD * 150).toFixed(2)})`);
}

main().catch(console.error);
