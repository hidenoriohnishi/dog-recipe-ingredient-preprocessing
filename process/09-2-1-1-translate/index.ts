import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { calculateCost, formatCost } from '../../utils/cost-calculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

// 入力・出力ファイル
const inputFile = join(__dirname, '../07-normalize-headers/result/final-nutrition.csv');
const outputFile = join(resultDir, 'translated-names.json');
const progressFile = join(resultDir, 'progress.json');

const MODEL_NAME = 'gpt-4.1-2025-04-14';
const BATCH_SIZE = 50; // AIのバッチサイズ

// =====================================================
// CSV パース
// =====================================================

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// =====================================================
// 型定義
// =====================================================

interface Progress {
  processedFoodNumbers: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface TranslatedFood {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
}

// =====================================================
// 進捗管理
// =====================================================

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedFoodNumbers: [], totalInputTokens: 0, totalOutputTokens: 0 };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

async function loadTranslations(): Promise<TranslatedFood[]> {
  try {
    const content = await readFile(outputFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveTranslations(translations: TranslatedFood[]): Promise<void> {
  await writeFile(outputFile, JSON.stringify(translations, null, 2), 'utf-8');
}

// =====================================================
// AI翻訳
// =====================================================

async function translateBatch(
  foods: Array<{ food_number: string; food_name: string }>
): Promise<{ translations: TranslatedFood[]; inputTokens: number; outputTokens: number }> {
  const foodList = foods
    .map((f, idx) => `${idx + 1}. ${f.food_name}`)
    .join('\n');

  const prompt = `Translate the following Japanese food names to English. These are from the Japanese Food Composition Database (MEXT).

## Rules
1. Translate to the most common English food name used in USDA FoodData Central
2. Keep it simple and searchable (e.g., "コイ" → "Carp", "まあじ" → "Horse mackerel")
3. Include cooking method if present (e.g., "生" → "raw", "焼き" → "grilled")
4. For fish, use the common English name (e.g., "さば" → "Mackerel", "たい" → "Sea bream")
5. Remove category prefixes like ＜魚類＞ from the translation

## Japanese Food Names
${foodList}

## Output Format (JSON array)
Return ONLY a JSON array with translations in the same order:
\`\`\`json
[
  {"index": 1, "en": "Amaranth grain, raw"},
  {"index": 2, "en": "Horse mackerel, raw"},
  ...
]
\`\`\``;

  const result = await generateText({
    model: openai(MODEL_NAME),
    prompt,
    temperature: 0.1,
  });

  const inputTokens = result.usage?.inputTokens || 0;
  const outputTokens = result.usage?.outputTokens || 0;

  // JSONを抽出
  const jsonMatch =
    result.text.match(/```json\s*([\s\S]*?)\s*```/) ||
    result.text.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    throw new Error('JSONが見つかりませんでした: ' + result.text);
  }

  const jsonText = jsonMatch[1] || jsonMatch[0];
  const parsed = JSON.parse(jsonText);

  const translations: TranslatedFood[] = parsed.map((item: any) => {
    const food = foods[item.index - 1];
    if (!food) {
      throw new Error(`インデックス ${item.index} に対応する食品が見つかりません`);
    }
    return {
      food_number: food.food_number,
      food_name_ja: food.food_name,
      food_name_en: item.en,
    };
  });

  return { translations, inputTokens, outputTokens };
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('=== 09-2-1-1: MEXT食品名 日英翻訳 ===\n');
  console.log(`使用モデル: ${MODEL_NAME}`);

  // MEXTデータを読み込む
  console.log('\nMEXTデータを読み込んでいます...');
  const csvContent = await readFile(inputFile, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const dataRows = lines.slice(1).map(line => parseCSVLine(line));

  // ヘッダーのインデックスを取得
  const foodNumberIdx = headers.indexOf('food_number');
  const foodNameIdx = headers.indexOf('food_name');

  if (foodNumberIdx === -1 || foodNameIdx === -1) {
    throw new Error('必要な列が見つかりません');
  }

  // 食品データを抽出
  const foods = dataRows.map(row => ({
    food_number: row[foodNumberIdx] || '',
    food_name: row[foodNameIdx] || '',
  })).filter(f => f.food_number && f.food_name);

  console.log(`MEXT食品数: ${foods.length}件`);

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedFoodNumbers);
  let totalInputTokens = progress.totalInputTokens;
  let totalOutputTokens = progress.totalOutputTokens;

  // 既存の翻訳を読み込む
  const existingTranslations = await loadTranslations();

  console.log(`処理済み食品数: ${processedSet.size}件`);

  // 未処理の食品を抽出
  const unprocessedFoods = foods.filter(f => !processedSet.has(f.food_number));
  console.log(`未処理の食品数: ${unprocessedFoods.length}件`);

  if (unprocessedFoods.length === 0) {
    console.log('全ての食品が処理済みです。');
  } else {
    // バッチ処理
    const totalBatches = Math.ceil(unprocessedFoods.length / BATCH_SIZE);
    let batchInputTokens = 0;
    let batchOutputTokens = 0;

    for (let i = 0; i < unprocessedFoods.length; i += BATCH_SIZE) {
      const batch = unprocessedFoods.slice(i, i + BATCH_SIZE);
      const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;

      console.log(`\nバッチ ${currentBatchNum}/${totalBatches}: ${batch.length}件処理中...`);

      try {
        const { translations, inputTokens, outputTokens } = await translateBatch(batch);

        batchInputTokens += inputTokens;
        batchOutputTokens += outputTokens;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        // 翻訳結果を追加
        existingTranslations.push(...translations);

        // 処理済みに追加
        for (const t of translations) {
          processedSet.add(t.food_number);
        }

        // 料金を表示
        const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
        console.log(`  ${formatCost(cost)}`);

        // 進捗を保存
        progress.processedFoodNumbers = Array.from(processedSet);
        progress.totalInputTokens = totalInputTokens;
        progress.totalOutputTokens = totalOutputTokens;
        await saveProgress(progress);
        await saveTranslations(existingTranslations);

        // レートリミット対策（1秒待機）
        if (i + BATCH_SIZE < unprocessedFoods.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`バッチ ${currentBatchNum} でエラーが発生しました:`, error);
        throw error;
      }
    }

    // バッチ処理の合計料金を表示
    const batchCost = calculateCost(MODEL_NAME, batchInputTokens, batchOutputTokens);
    console.log(`\n=== 今回の処理 ===`);
    console.log(`処理件数: ${unprocessedFoods.length}件`);
    console.log(`${formatCost(batchCost)}`);
  }

  // 累計料金を表示
  const totalCost = calculateCost(MODEL_NAME, totalInputTokens, totalOutputTokens);
  console.log(`\n=== 累計 ===`);
  console.log(`総食品数: ${existingTranslations.length}件`);
  console.log(`累計${formatCost(totalCost)}`);

  console.log(`\n結果を保存: ${outputFile}`);
  console.log('処理完了！');
}

main().catch(console.error);
