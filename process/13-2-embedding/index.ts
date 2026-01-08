import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { calculateEmbeddingCost, formatEmbeddingCost, USD_TO_JPY } from '../../utils/cost-calculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../13-1-vector-db-extract/result/vector-db-data.csv');
const outputFile = join(resultDir, 'embeddings.json');
const progressFile = join(resultDir, 'progress.json');

const MODEL_NAME = 'text-embedding-3-large';
const BATCH_SIZE = 100; // OpenAI APIは1回のリクエストで最大2048件まで対応

// OpenAI クライアント
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =====================================================
// CSV パース
// =====================================================

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

// =====================================================
// 進捗管理
// =====================================================

interface Progress {
  processedFoodNumbers: string[];
  totalTokens: number;
}

interface EmbeddingResult {
  food_number: string;
  food_name: string;
  embedding_text: string;
  embedding: number[];
}

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedFoodNumbers: [], totalTokens: 0 };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

async function loadExistingResults(): Promise<EmbeddingResult[]> {
  try {
    const content = await readFile(outputFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveResults(results: EmbeddingResult[]): Promise<void> {
  await writeFile(outputFile, JSON.stringify(results, null, 2), 'utf-8');
}

// =====================================================
// Embedding処理
// =====================================================

interface FoodItem {
  food_number: string;
  food_name: string;
  embedding_text: string;
}

async function getEmbeddings(
  texts: string[]
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  const response = await openai.embeddings.create({
    model: MODEL_NAME,
    input: texts,
  });

  const embeddings = response.data.map(d => d.embedding);
  const totalTokens = response.usage?.total_tokens || 0;

  return { embeddings, totalTokens };
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('CSVファイルを読み込んでいます...');
  const csvContent = await readFile(inputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  const headers = records[0];
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // ヘッダーのインデックスを取得
  const foodNumberIndex = headers.indexOf('food_number');
  const foodNameIndex = headers.indexOf('food_name');
  const embeddingTextIndex = headers.indexOf('embedding_text');

  if (foodNumberIndex === -1 || foodNameIndex === -1 || embeddingTextIndex === -1) {
    throw new Error('必要な列が見つかりません');
  }

  // 食品データを抽出
  const foods: FoodItem[] = dataRows.map(row => ({
    food_number: row[foodNumberIndex] || '',
    food_name: row[foodNameIndex] || '',
    embedding_text: row[embeddingTextIndex] || '',
  }));

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedFoodNumbers);
  let totalTokens = progress.totalTokens;

  // 既存の結果を読み込む
  const existingResults = await loadExistingResults();
  const resultsMap = new Map<string, EmbeddingResult>();
  for (const result of existingResults) {
    resultsMap.set(result.food_number, result);
  }

  console.log(`処理済み食品数: ${processedSet.size}件`);
  console.log(`累計トークン数: ${totalTokens}`);

  // 未処理の食品を抽出
  const unprocessedFoods = foods.filter(f => !processedSet.has(f.food_number));
  console.log(`未処理の食品数: ${unprocessedFoods.length}件`);

  if (unprocessedFoods.length === 0) {
    console.log('全ての食品が処理済みです。');
  } else {
    // バッチ処理
    const totalBatches = Math.ceil(unprocessedFoods.length / BATCH_SIZE);
    let batchTotalTokens = 0;

    for (let i = 0; i < unprocessedFoods.length; i += BATCH_SIZE) {
      const batch = unprocessedFoods.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      console.log(`\nバッチ ${batchNum}/${totalBatches}: ${batch.length}件処理中...`);

      // embedding_textを取得
      const texts = batch.map(f => f.embedding_text);

      try {
        // Embedding取得
        const { embeddings, totalTokens: batchTokens } = await getEmbeddings(texts);
        batchTotalTokens += batchTokens;
        totalTokens += batchTokens;

        // 結果を保存
        for (let j = 0; j < batch.length; j++) {
          const food = batch[j];
          const embedding = embeddings[j];

          const result: EmbeddingResult = {
            food_number: food.food_number,
            food_name: food.food_name,
            embedding_text: food.embedding_text,
            embedding,
          };

          resultsMap.set(food.food_number, result);
          processedSet.add(food.food_number);
        }

        // 料金を表示
        const batchCost = calculateEmbeddingCost(MODEL_NAME, batchTokens);
        console.log(`  トークン数: ${batchTokens}`);
        console.log(`  ${formatEmbeddingCost(batchCost)}`);

        // 進捗を保存
        progress.processedFoodNumbers = Array.from(processedSet);
        progress.totalTokens = totalTokens;
        await saveProgress(progress);

        // 結果を保存（途中保存）
        const results = Array.from(resultsMap.values());
        await saveResults(results);

        // レートリミット対策（1秒待機）
        if (i + BATCH_SIZE < unprocessedFoods.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`バッチ ${batchNum} でエラーが発生しました:`, error);
        throw error;
      }
    }

    // バッチ処理の合計料金を表示
    const batchTotalCost = calculateEmbeddingCost(MODEL_NAME, batchTotalTokens);
    console.log(`\n=== 今回の処理 ===`);
    console.log(`処理件数: ${unprocessedFoods.length}件`);
    console.log(`トークン数: ${batchTotalTokens}`);
    console.log(`${formatEmbeddingCost(batchTotalCost)}`);
  }

  // 最終結果を保存
  const results = Array.from(resultsMap.values());
  // food_numberでソート
  results.sort((a, b) => a.food_number.localeCompare(b.food_number));
  await saveResults(results);

  // 累計料金を表示
  const totalCost = calculateEmbeddingCost(MODEL_NAME, totalTokens);
  console.log(`\n=== 累計 ===`);
  console.log(`総食品数: ${results.length}件`);
  console.log(`累計トークン数: ${totalTokens}`);
  console.log(`累計${formatEmbeddingCost(totalCost)}`);

  console.log(`\n結果を保存: ${outputFile}`);
  console.log('処理完了！');
}

main().catch(console.error);

