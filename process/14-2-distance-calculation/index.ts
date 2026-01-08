import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const labelEmbeddingsFile = join(__dirname, '../14-1-label-embedding/result/label-embeddings.json');
const foodEmbeddingsFile = join(__dirname, '../13-2-embedding/result/embeddings.json');
const outputFile = join(resultDir, 'ingredient-mapping.json');
const progressFile = join(resultDir, 'progress.json');

const TOP_N = 9; // 表示する候補数

// =====================================================
// 型定義
// =====================================================

interface LabelEmbedding {
  label: string;
  path: string;
  variants: string[];
  searchText: string;
  embedding: number[];
}

interface FoodEmbedding {
  food_number: string;
  food_name: string;
  embedding_text: string;
  embedding: number[];
}

interface SelectedFood {
  food_number: string;
  food_name: string;
  distance: number;
  rank: number; // 選択時の優先順位（1が最優先）
}

interface IngredientMapping {
  label: string;
  path: string;
  searchText: string;
  selectedFoods: SelectedFood[];
}

interface Progress {
  processedLabels: string[];
  mappings: IngredientMapping[];
}

// =====================================================
// ベクトル計算
// =====================================================

/**
 * コサイン類似度を計算
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('ベクトルの次元が一致しません');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * コサイン距離を計算（1 - 類似度）
 */
function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

// =====================================================
// 進捗管理
// =====================================================

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedLabels: [], mappings: [] };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

// =====================================================
// ユーザー入力
// =====================================================

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// =====================================================
// マッチング処理
// =====================================================

interface FoodCandidate {
  food_number: string;
  food_name: string;
  distance: number;
  embedding_text: string;
}

/**
 * ラベルに対して最も近い食材を検索
 */
function findClosestFoods(
  labelEmbedding: number[],
  foodEmbeddings: FoodEmbedding[],
  topN: number = TOP_N
): FoodCandidate[] {
  const matches: FoodCandidate[] = [];

  for (const food of foodEmbeddings) {
    const distance = cosineDistance(labelEmbedding, food.embedding);

    matches.push({
      food_number: food.food_number,
      food_name: food.food_name,
      distance,
      embedding_text: food.embedding_text,
    });
  }

  // 距離でソート（小さい順）
  matches.sort((a, b) => a.distance - b.distance);

  return matches.slice(0, topN);
}

/**
 * 入力文字列から選択インデックスを解析
 * "213" -> [2, 1, 3]
 * "1" -> [1]
 * "" -> []
 */
function parseSelection(input: string): number[] {
  const indices: number[] = [];
  for (const char of input) {
    const num = parseInt(char, 10);
    if (!isNaN(num) && num >= 1 && num <= 9) {
      indices.push(num);
    }
  }
  return indices;
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('=== 14-2: 距離計算・食材マッチング ===\n');

  // ラベルのembeddingsを読み込む
  console.log('label-embeddings.jsonを読み込んでいます...');
  const labelEmbeddingsContent = await readFile(labelEmbeddingsFile, 'utf-8');
  const labelEmbeddings: LabelEmbedding[] = JSON.parse(labelEmbeddingsContent);
  console.log(`ラベル数: ${labelEmbeddings.length}件\n`);

  // 食材のembeddingsを読み込む
  console.log('embeddings.jsonを読み込んでいます...');
  const foodEmbeddingsContent = await readFile(foodEmbeddingsFile, 'utf-8');
  const foodEmbeddings: FoodEmbedding[] = JSON.parse(foodEmbeddingsContent);
  console.log(`食材数: ${foodEmbeddings.length}件\n`);

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedLabels);
  const mappingsMap = new Map<string, IngredientMapping>();
  for (const mapping of progress.mappings) {
    mappingsMap.set(mapping.label, mapping);
  }

  console.log(`処理済みラベル数: ${processedSet.size}件\n`);

  // 未処理のラベルを抽出
  const unprocessedLabels = labelEmbeddings.filter(l => !processedSet.has(l.label));
  console.log(`未処理のラベル数: ${unprocessedLabels.length}件\n`);

  if (unprocessedLabels.length === 0) {
    console.log('全てのラベルが処理済みです。');
    return;
  }

  // ユーザー入力のセットアップ
  const rl = createReadline();

  console.log('========================================');
  console.log('各ラベルに対して近い食材候補を9個表示します。');
  console.log('');
  console.log('操作方法:');
  console.log('  数字を入力: 候補を選択（例: 213 → 2番→1番→3番の順で保存）');
  console.log('  Enter: 何も選択せずに次へ');
  console.log('  s: スキップ（保存しない）');
  console.log('  q: 終了');
  console.log('========================================\n');

  for (let i = 0; i < unprocessedLabels.length; i++) {
    const labelInfo = unprocessedLabels[i];
    const { label, path, searchText, embedding } = labelInfo;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`[${i + 1}/${unprocessedLabels.length}] ${label}`);
    console.log(`パス: ${path}`);
    console.log(`${'='.repeat(50)}`);

    // 最も近い食材を検索
    const candidates = findClosestFoods(embedding, foodEmbeddings, TOP_N);

    // 候補を表示
    console.log('\n候補:');
    for (let j = 0; j < candidates.length; j++) {
      const c = candidates[j];
      const distanceStr = c.distance.toFixed(4);
      console.log(`  ${j + 1}. [${c.food_number}] ${c.food_name}`);
      console.log(`     距離: ${distanceStr} | ${c.embedding_text.substring(0, 50)}...`);
    }

    // ユーザー入力を待つ
    const answer = await askQuestion(rl, '\n選択 (数字/Enter/s/q): ');

    if (answer.toLowerCase() === 'q') {
      console.log('\n処理を終了します。');
      break;
    }

    if (answer.toLowerCase() === 's') {
      console.log('スキップしました。');
      continue;
    }

    // 選択を解析
    const selectedIndices = parseSelection(answer);

    // 選択された食材を保存
    const selectedFoods: SelectedFood[] = [];
    for (let rank = 0; rank < selectedIndices.length; rank++) {
      const idx = selectedIndices[rank] - 1; // 1-indexed -> 0-indexed
      if (idx >= 0 && idx < candidates.length) {
        const c = candidates[idx];
        selectedFoods.push({
          food_number: c.food_number,
          food_name: c.food_name,
          distance: c.distance,
          rank: rank + 1,
        });
      }
    }

    const mapping: IngredientMapping = {
      label,
      path,
      searchText,
      selectedFoods,
    };

    mappingsMap.set(label, mapping);
    processedSet.add(label);

    // 進捗を保存
    progress.processedLabels = Array.from(processedSet);
    progress.mappings = Array.from(mappingsMap.values());
    await saveProgress(progress);

    if (selectedFoods.length > 0) {
      console.log(`\n保存: ${selectedFoods.map(f => `${f.rank}.${f.food_name}`).join(' → ')}`);
    } else {
      console.log('\n保存: 選択なし');
    }
  }

  rl.close();

  // 最終結果を保存
  const finalMappings = Array.from(mappingsMap.values());
  await writeFile(outputFile, JSON.stringify(finalMappings, null, 2), 'utf-8');

  console.log(`\n=== 処理完了 ===`);
  console.log(`結果を保存: ${outputFile}`);
  console.log(`処理済みラベル数: ${finalMappings.length}件`);

  // 統計
  const withSelections = finalMappings.filter(m => m.selectedFoods.length > 0).length;
  const withoutSelections = finalMappings.filter(m => m.selectedFoods.length === 0).length;
  console.log(`選択あり: ${withSelections}件 / 選択なし: ${withoutSelections}件`);
}

main().catch(console.error);
