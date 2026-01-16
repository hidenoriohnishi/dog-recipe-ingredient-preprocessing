import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

// 入力ファイル（両方ともバッチディレクトリ）
const mextBatchDir = join(__dirname, '../09-2-1-2-embedding/result/batches');
const usdaBatchDir = join(__dirname, '../09-1-2-usda-embedding/result/batches');

// 出力ファイル
const outputFile = join(resultDir, 'name-distance-top200.json');

const TOP_N = 200;

// =====================================================
// 型定義
// =====================================================

interface MextEmbedding {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
  embedding: number[];
}

interface USDAEmbedding {
  fdc_id: string;
  description: string;
  embedding: number[];
}

interface Candidate {
  fdc_id: string;
  description: string;
  similarity: number;
}

interface ResultEntry {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
  candidates: Candidate[];
}

// =====================================================
// コサイン類似度計算
// =====================================================

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  if (norm === 0) return 0;
  return dotProduct / norm;
}

// =====================================================
// バッチファイルからembeddingを読み込む
// =====================================================

async function loadBatchEmbeddings<T>(batchDir: string, name: string): Promise<T[]> {
  console.log(`${name}のembeddingを読み込んでいます...`);
  
  const batchFiles = await readdir(batchDir);
  const jsonFiles = batchFiles.filter(f => f.endsWith('.json')).sort();
  
  const allEmbeddings: T[] = [];
  for (const file of jsonFiles) {
    const content = await readFile(join(batchDir, file), 'utf-8');
    const batch: T[] = JSON.parse(content);
    allEmbeddings.push(...batch);
  }
  
  console.log(`  ${name}食品数: ${allEmbeddings.length}件`);
  console.log(`  バッチファイル数: ${jsonFiles.length}件`);
  
  return allEmbeddings;
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('=== 09-2-2: 食品名距離計算 ===\n');

  // MEXTのembeddingを読み込む（バッチファイル）
  const mextList = await loadBatchEmbeddings<MextEmbedding>(mextBatchDir, 'MEXT');

  // USDAのembeddingを読み込む（バッチファイル）
  const usdaList = await loadBatchEmbeddings<USDAEmbedding>(usdaBatchDir, 'USDA');

  // 各MEXT食品に対して距離を計算
  console.log('\n距離計算を開始します...');
  const results: Record<string, ResultEntry> = {};
  
  let processed = 0;
  const total = mextList.length;

  for (const mext of mextList) {
    // 全USDAとの類似度を計算
    const similarities: { fdc_id: string; description: string; similarity: number }[] = [];
    
    for (const usda of usdaList) {
      const similarity = cosineSimilarity(mext.embedding, usda.embedding);
      similarities.push({
        fdc_id: usda.fdc_id,
        description: usda.description,
        similarity,
      });
    }

    // 類似度でソートして上位N件を取得
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topN = similarities.slice(0, TOP_N);

    results[mext.food_number] = {
      food_number: mext.food_number,
      food_name_ja: mext.food_name_ja,
      food_name_en: mext.food_name_en,
      candidates: topN,
    };

    processed++;
    if (processed % 100 === 0 || processed === total) {
      console.log(`  処理済み: ${processed}/${total} (${((processed / total) * 100).toFixed(1)}%)`);
    }
  }

  // 結果を保存
  console.log('\n結果を保存しています...');
  await writeFile(outputFile, JSON.stringify(results, null, 2), 'utf-8');

  // 統計情報を表示
  const avgTopSimilarity = mextList.reduce((sum, mext) => {
    const entry = results[mext.food_number];
    return sum + (entry.candidates[0]?.similarity || 0);
  }, 0) / mextList.length;

  console.log(`\n=== 完了 ===`);
  console.log(`MEXT食品数: ${mextList.length}件`);
  console.log(`USDA食品数: ${usdaList.length}件`);
  console.log(`上位${TOP_N}件を保存`);
  console.log(`平均トップ類似度: ${avgTopSimilarity.toFixed(4)}`);
  console.log(`\n結果を保存: ${outputFile}`);
}

main().catch(console.error);
