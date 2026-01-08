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
const ingredientsFile = join(__dirname, '../10-0/ingredients-structured.json');
const outputFile = join(resultDir, 'label-embeddings.json');
const progressFile = join(resultDir, 'progress.json');

const MODEL_NAME = 'text-embedding-3-large';
const BATCH_SIZE = 50; // バッチサイズ

// OpenAI クライアント
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =====================================================
// 型定義
// =====================================================

interface LabelInfo {
  label: string;
  path: string;
  variants: string[];
}

interface LabelEmbedding {
  label: string;
  path: string;
  variants: string[];
  searchText: string;
  embedding: number[];
}

interface Progress {
  processedLabels: string[];
  totalTokens: number;
}

// =====================================================
// 末端ラベルの抽出
// =====================================================

/**
 * ingredients-structured.jsonから末端ラベルを抽出
 */
function extractLeafLabels(obj: any, path: string[] = []): LabelInfo[] {
  const labels: LabelInfo[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    if (Array.isArray(value)) {
      // 配列の場合は末端ラベル
      labels.push({
        label: key,
        path: currentPath.join(' > '),
        variants: value as string[],
      });
    } else if (typeof value === 'object' && value !== null) {
      // オブジェクトの場合は再帰的に処理
      labels.push(...extractLeafLabels(value, currentPath));
    }
  }

  return labels;
}

// =====================================================
// 進捗管理
// =====================================================

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedLabels: [], totalTokens: 0 };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

async function loadExistingResults(): Promise<LabelEmbedding[]> {
  try {
    const content = await readFile(outputFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveResults(results: LabelEmbedding[]): Promise<void> {
  await writeFile(outputFile, JSON.stringify(results, null, 2), 'utf-8');
}


// =====================================================
// Embedding生成
// =====================================================

/**
 * テキストのembeddingを取得（バッチ）
 */
async function getEmbeddings(texts: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
  const response = await openai.embeddings.create({
    model: MODEL_NAME,
    input: texts,
  });

  const embeddings = response.data.map(d => d.embedding);
  const tokens = response.usage?.total_tokens || 0;

  return { embeddings, tokens };
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('=== 14-1: ラベルEmbedding生成 ===\n');

  // ingredients-structured.jsonを読み込む
  console.log('ingredients-structured.jsonを読み込んでいます...');
  const ingredientsContent = await readFile(ingredientsFile, 'utf-8');
  const ingredients = JSON.parse(ingredientsContent);

  // 末端ラベルを抽出
  const leafLabels = extractLeafLabels(ingredients);
  console.log(`末端ラベル数: ${leafLabels.length}件\n`);

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedLabels);
  let totalTokens = progress.totalTokens;

  // 既存の結果を読み込む
  const existingResults = await loadExistingResults();
  const resultsMap = new Map<string, LabelEmbedding>();
  for (const result of existingResults) {
    resultsMap.set(result.label, result);
  }

  console.log(`処理済みラベル数: ${processedSet.size}件`);
  console.log(`累計トークン数: ${totalTokens}\n`);

  // 未処理のラベルを抽出
  const unprocessedLabels = leafLabels.filter(l => !processedSet.has(l.label));
  console.log(`未処理のラベル数: ${unprocessedLabels.length}件\n`);

  if (unprocessedLabels.length === 0) {
    console.log('全てのラベルが処理済みです。');
    return;
  }

  // バッチ処理
  const totalBatches = Math.ceil(unprocessedLabels.length / BATCH_SIZE);
  let batchTotalTokens = 0;

  for (let i = 0; i < unprocessedLabels.length; i += BATCH_SIZE) {
    const batch = unprocessedLabels.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    console.log(`\nバッチ ${batchNum}/${totalBatches}: ${batch.length}件処理中...`);

    // ラベル名をそのままembedding用テキストとして使用
    const searchTexts = batch.map(l => l.label);

    // 表示（最初の5件）
    for (let j = 0; j < Math.min(5, batch.length); j++) {
      console.log(`  - ${batch[j].label}`);
    }
    if (batch.length > 5) {
      console.log(`  ... 他${batch.length - 5}件`);
    }

    try {
      // Embedding取得
      const { embeddings, tokens: batchTokens } = await getEmbeddings(searchTexts);
      batchTotalTokens += batchTokens;
      totalTokens += batchTokens;

      // 結果を保存
      for (let j = 0; j < batch.length; j++) {
        const labelInfo = batch[j];
        const embedding = embeddings[j];

        const result: LabelEmbedding = {
          label: labelInfo.label,
          path: labelInfo.path,
          variants: labelInfo.variants,
          searchText: searchTexts[j],
          embedding,
        };

        resultsMap.set(labelInfo.label, result);
        processedSet.add(labelInfo.label);
      }

      // 料金を表示
      const batchCost = calculateEmbeddingCost(MODEL_NAME, batchTokens);
      console.log(`  トークン数: ${batchTokens}`);
      console.log(`  ${formatEmbeddingCost(batchCost)}`);

      // 進捗を保存
      progress.processedLabels = Array.from(processedSet);
      progress.totalTokens = totalTokens;
      await saveProgress(progress);

      // 結果を保存（途中保存）
      const results = Array.from(resultsMap.values());
      await saveResults(results);

      // レートリミット対策（1秒待機）
      if (i + BATCH_SIZE < unprocessedLabels.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`バッチ ${batchNum} でエラーが発生しました:`, error);
      throw error;
    }
  }

  // 最終結果を保存
  const results = Array.from(resultsMap.values());
  // labelでソート
  results.sort((a, b) => a.label.localeCompare(b.label));
  await saveResults(results);

  // 料金を表示
  const batchTotalCost = calculateEmbeddingCost(MODEL_NAME, batchTotalTokens);
  const totalCost = calculateEmbeddingCost(MODEL_NAME, totalTokens);

  console.log(`\n=== 処理完了 ===`);
  console.log(`結果を保存: ${outputFile}`);
  console.log(`処理済みラベル数: ${results.length}件`);
  console.log(`\n今回の処理: ${formatEmbeddingCost(batchTotalCost)}`);
  console.log(`累計: ${formatEmbeddingCost(totalCost)}`);
}

main().catch(console.error);

