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
const csvInputFile = join(__dirname, '../04-1-merge-tables/result/merged-nutrition.csv');
const searchKeysFile = join(__dirname, '../05-1-search-keys/result/search-keys.json');
const outputFile = join(resultDir, 'tag-names.json');
const progressFile = join(resultDir, 'progress.json');

const BATCH_SIZE = 20;

interface Progress {
  processedFoodNumbers: string[];
}

interface TagNamesResult {
  [foodNumber: string]: { ja: string; jaDetail?: string; en: string; enDetail?: string };
}

interface SearchKeysData {
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
 * 既存のタグ名を読み込む
 */
async function loadExistingTagNames(): Promise<TagNamesResult> {
  try {
    const content = await readFile(outputFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * タグ名を保存
 */
async function saveTagNames(tagNames: TagNamesResult): Promise<void> {
  await writeFile(outputFile, JSON.stringify(tagNames, null, 2), 'utf-8');
}

/**
 * 検索キーを読み込む
 */
async function loadSearchKeys(): Promise<SearchKeysData> {
  try {
    const content = await readFile(searchKeysFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * AIでタグ名を生成
 */
async function generateTagNames(
  foods: Array<{
    batchIndex: number;
    foodNumber: string;
    foodName: string;
    structuredName: string;
    searchKeys: string[];
  }>
): Promise<{ tagNames: Array<{ foodNumber: string; ja: string; en: string }>; cost: CostResult | null }> {
  const foodList = foods.map((f) => {
    const searchKeysStr = f.searchKeys.length > 0 ? f.searchKeys.slice(0, 10).join(', ') : 'なし';
    return `${f.batchIndex}. 食品番号: ${f.foodNumber}
   食品名: ${f.foodName}
   構造化: ${f.structuredName}
   検索キー: ${searchKeysStr}`;
  }).join('\n\n');

  const prompt = `あなたは日本の食材に詳しい専門家です。以下の食品について、UIに表示するタグ名を日本語と英語で生成してください。

## 最重要ルール：タグ名の本質

タグ名とは「ユーザーがこの食品を探すときに使う名前」です。

**自問自答してください**：
「この食品が欲しい人は、何という名前で探すか？」

例：「こむぎ ［パン類］ 角形食パン 焼き」が欲しい人は？
→ 「食パン」で探す。「小麦」では絶対に探さない。
→ ja: "食パン", jaDetail: "角形・焼き"

例：「こむぎ 強力粉 1等」が欲しい人は？
→ 「強力粉」で探す。「小麦」でも「小麦粉」でもない。
→ ja: "強力粉", jaDetail: "1等"

## 出力項目

1. **ja**: ユーザーが検索に使う名前（日本語）
2. **jaDetail**: 同じja名の食品を区別する詳細（不要なら空文字列""）
3. **en**: ユーザーが検索に使う名前（英語）
4. **enDetail**: 同じen名の食品を区別する詳細（不要なら空文字列""）

※ detailは区別が必要な場合のみ。不要なら空文字列にする（"-"は使わない）

## 重要：加工品は加工品名でタグ付け

- パン → 「パン」「食パン」「フランスパン」など（「小麦」ではない）
- うどん → 「うどん」（「小麦」ではない）
- 豆腐 → 「豆腐」（「大豆」ではない）
- ハム → 「ハム」（「豚肉」ではない）

## 具体例

| 食品名 | ja | jaDetail | en | enDetail |
|--------|-----|----------|-----|----------|
| こむぎ ［パン類］ 角形食パン 焼き | 食パン | 角形・焼き | Bread | Square Loaf, Toasted |
| こむぎ ［パン類］ フランスパン | フランスパン | | French Bread | |
| こむぎ ［うどん・そうめん類］ うどん ゆで | うどん | ゆで | Udon | Boiled |
| こむぎ 強力粉 1等 | 強力粉 | 1等 | Bread Flour | Grade 1 |
| おおむぎ 押麦 乾 | 押麦 | 乾燥 | Rolled Barley | Dried |
| 鶏 もも 皮つき 生 | 鶏もも肉 | 皮つき・生 | Chicken Thigh | Skin-on, Raw |
| まあじ 皮つき 生 | 鯵 | 皮つき・生 | Horse Mackerel | Skin-on, Raw |

## 食品リスト

${foodList}

## 出力形式

\`\`\`json
[
  {"index": 1, "ja": "タグ名", "jaDetail": "詳細", "en": "Tag Name", "enDetail": "Detail"},
  ...
]
\`\`\`

全食品について、ユーザーが実際に検索に使う名前でタグ付けしてください。`;

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
      tagNames: evaluations.map((evaluation: any) => {
        const food = foods.find(f => f.batchIndex === evaluation.index);
        if (!food) {
          throw new Error(`評価結果のindex ${evaluation.index}に対応する食品が見つかりません`);
        }
        return {
          foodNumber: food.foodNumber,
          ja: evaluation.ja || '',
          jaDetail: evaluation.jaDetail || '',
          en: evaluation.en || '',
          enDetail: evaluation.enDetail || '',
        };
      }),
      cost,
    };
  } catch (error) {
    console.error('AI生成エラー:', error);
    // エラー時は構造化食品名からbaseNameを使用
    return {
      tagNames: foods.map(f => {
        try {
          const parsed = JSON.parse(f.structuredName);
          return {
            foodNumber: f.foodNumber,
            ja: parsed.baseName || f.foodName,
            jaDetail: parsed.variety || undefined,
            en: parsed.baseName || f.foodName,
            enDetail: parsed.variety || undefined,
          };
        } catch {
          return {
            foodNumber: f.foodNumber,
            ja: f.foodName,
            jaDetail: undefined,
            en: f.foodName,
            enDetail: undefined,
          };
        }
      }),
      cost: null,
    };
  }
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('ファイルを読み込んでいます...');
  
  // CSVを読み込む
  const csvContent = await readFile(csvInputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  // 検索キーを読み込む
  const searchKeys = await loadSearchKeys();
  console.log(`検索キー: ${Object.keys(searchKeys).length}件`);

  // ヘッダー行を除くデータ行
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // 食品データを抽出（食品番号:1, 食品名:2, 構造化食品名:30）
  const foods = dataRows.map((row) => {
    const foodNumber = row[1] || '';
    const foodName = row[2] || '';
    const structuredName = row[30] || '{}';
    return {
      foodNumber,
      foodName,
      structuredName,
      searchKeys: searchKeys[foodNumber] || [],
    };
  });

  // 進捗と既存データを読み込む
  const progress = await loadProgress();
  const existingTagNames = await loadExistingTagNames();
  const processedSet = new Set(progress.processedFoodNumbers);

  console.log(`既存のタグ名: ${Object.keys(existingTagNames).length}件`);
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
    const result = await generateTagNames(batch);

    // 結果を保存
    for (const item of result.tagNames) {
      const tagName: { ja: string; jaDetail?: string; en: string; enDetail?: string } = {
        ja: item.ja,
        en: item.en,
      };
      if (item.jaDetail && item.jaDetail !== '-' && item.jaDetail !== '') {
        tagName.jaDetail = item.jaDetail;
      }
      if (item.enDetail && item.enDetail !== '-' && item.enDetail !== '') {
        tagName.enDetail = item.enDetail;
      }
      existingTagNames[item.foodNumber] = tagName;
      processedSet.add(item.foodNumber);
    }

    // ファイルに保存
    await saveTagNames(existingTagNames);
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
