import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { calculateEmbeddingCost, formatEmbeddingCost } from '../../utils/cost-calculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const batchDir = join(resultDir, 'batches');

// 入力・出力ファイル
const inputFile = join(__dirname, '../09-2-1-1-translate/result/translated-names.json');
const progressFile = join(resultDir, 'progress.json');

const MODEL_NAME = 'text-embedding-3-large';
const BATCH_SIZE = 100;

// OpenAI クライアント
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =====================================================
// 型定義
// =====================================================

interface TranslatedFood {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
}

interface Progress {
  processedFoodNumbers: string[];
  totalTokens: number;
  batchCount: number;
}

interface EmbeddingResult {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
  embedding: number[];
}

// =====================================================
// 進捗管理
// =====================================================

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedFoodNumbers: [], totalTokens: 0, batchCount: 0 };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

// バッチ結果を個別ファイルに保存
async function saveBatchResults(batchNum: number, results: EmbeddingResult[]): Promise<void> {
  const batchFile = join(batchDir, `batch-${String(batchNum).padStart(4, '0')}.json`);
  await writeFile(batchFile, JSON.stringify(results), 'utf-8');
}

// =====================================================
// Embedding処理
// =====================================================

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
  await mkdir(batchDir, { recursive: true });

  console.log('=== 09-2-1-2: MEXT食品名Embedding（英語翻訳版）===\n');

  // 翻訳データを読み込む
  console.log('翻訳データを読み込んでいます...');
  const translatedContent = await readFile(inputFile, 'utf-8');
  const translatedFoods: TranslatedFood[] = JSON.parse(translatedContent);

  console.log(`翻訳済み食品数: ${translatedFoods.length}件`);

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedFoodNumbers);
  let totalTokens = progress.totalTokens;
  let batchCount = progress.batchCount;

  console.log(`処理済み食品数: ${processedSet.size}件`);
  console.log(`累計トークン数: ${totalTokens}`);
  console.log(`保存済みバッチ数: ${batchCount}件`);

  // 未処理の食品を抽出
  const unprocessedFoods = translatedFoods.filter(f => !processedSet.has(f.food_number));
  console.log(`未処理の食品数: ${unprocessedFoods.length}件`);

  if (unprocessedFoods.length === 0) {
    console.log('全ての食品が処理済みです。');
  } else {
    // バッチ処理
    const totalBatches = Math.ceil(unprocessedFoods.length / BATCH_SIZE);
    let batchTotalTokens = 0;

    for (let i = 0; i < unprocessedFoods.length; i += BATCH_SIZE) {
      const batch = unprocessedFoods.slice(i, i + BATCH_SIZE);
      const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;

      console.log(`\nバッチ ${currentBatchNum}/${totalBatches}: ${batch.length}件処理中...`);

      // 英語名を取得（embeddingは英語名で行う）
      const texts = batch.map(f => f.food_name_en);

      try {
        // Embedding取得
        const { embeddings, totalTokens: batchTokens } = await getEmbeddings(texts);
        batchTotalTokens += batchTokens;
        totalTokens += batchTokens;

        // バッチ結果を作成
        const batchResults: EmbeddingResult[] = [];
        for (let j = 0; j < batch.length; j++) {
          const food = batch[j];
          const embedding = embeddings[j];

          batchResults.push({
            food_number: food.food_number,
            food_name_ja: food.food_name_ja,
            food_name_en: food.food_name_en,
            embedding,
          });

          processedSet.add(food.food_number);
        }

        // バッチ結果を個別ファイルに保存
        batchCount++;
        await saveBatchResults(batchCount, batchResults);

        // 料金を表示
        const batchCost = calculateEmbeddingCost(MODEL_NAME, batchTokens);
        console.log(`  トークン数: ${batchTokens}`);
        console.log(`  ${formatEmbeddingCost(batchCost)}`);

        // 進捗を保存
        progress.processedFoodNumbers = Array.from(processedSet);
        progress.totalTokens = totalTokens;
        progress.batchCount = batchCount;
        await saveProgress(progress);

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
    const batchTotalCost = calculateEmbeddingCost(MODEL_NAME, batchTotalTokens);
    console.log(`\n=== 今回の処理 ===`);
    console.log(`処理件数: ${unprocessedFoods.length}件`);
    console.log(`トークン数: ${batchTotalTokens}`);
    console.log(`${formatEmbeddingCost(batchTotalCost)}`);
  }

  // 累計料金を表示
  const totalCost = calculateEmbeddingCost(MODEL_NAME, totalTokens);
  console.log(`\n=== 累計 ===`);
  console.log(`総食品数: ${processedSet.size}件`);
  console.log(`累計トークン数: ${totalTokens}`);
  console.log(`バッチファイル数: ${batchCount}件`);
  console.log(`累計${formatEmbeddingCost(totalCost)}`);

  console.log(`\n結果を保存: ${batchDir}/batch-*.json`);
  console.log('処理完了！');
}

main().catch(console.error);
