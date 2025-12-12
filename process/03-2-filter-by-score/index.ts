import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../02-food-name-normalize/result/claude-json-header-with-structured-names.csv');
const scoresFile = join(__dirname, '../03-1-dog-food-scoring/result/scores.csv');

// フィルター閾値（この値以上のスコアの食品を残す）
const SCORE_THRESHOLD = 7;

async function main() {
  // resultディレクトリを作成
  await mkdir(resultDir, { recursive: true });

  console.log('スコアファイルを読み込んでいます...');
  
  // スコアファイルを読み込む
  const scoresContent = await readFile(scoresFile, 'utf-8');
  const scoresRecords = parseCSVRecords(scoresContent);
  
  // スコアが閾値以上の食品番号のセットと、理由・スコアのマップを作成
  const validFoodNumbers = new Set<string>();
  const scoreDataMap = new Map<string, { reason: string; score: number }>();
  
  for (let i = 1; i < scoresRecords.length; i++) {
    const foodNumber = scoresRecords[i][0]; // 食品番号
    const reason = scoresRecords[i][1] || ''; // 理由
    const score = parseInt(scoresRecords[i][2], 10); // スコア
    
    if (!isNaN(score) && score >= SCORE_THRESHOLD) {
      validFoodNumbers.add(foodNumber);
      scoreDataMap.set(foodNumber, { reason, score });
    }
  }
  
  console.log(`スコア${SCORE_THRESHOLD}以上の食品番号: ${validFoodNumbers.size}件`);

  console.log('CSVファイルを読み込んでいます...');
  
  // CSVファイルを読み込む
  const csvContent = await readFile(inputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  // ヘッダー行を処理
  const headerColumns = records[0];
  // 理由とスコアの列を追加
  const newHeader = [...headerColumns, '理由', 'スコア'];
  const outputLines: string[] = [formatCSVLine(newHeader)];
  
  // 食品番号の列のインデックス（2列目、インデックス1）
  const foodNumberIndex = 1;

  console.log(`データ行をフィルタリング中... (全${records.length - 1}行)`);

  let filteredCount = 0;

  // データ行をフィルタリング
  for (let i = 1; i < records.length; i++) {
    const columns = records[i];
    const foodNumber = columns[foodNumberIndex] || '';
    
    // スコアが閾値以上の食品番号のみ残す
    if (validFoodNumbers.has(foodNumber)) {
      const scoreData = scoreDataMap.get(foodNumber);
      // 理由とスコアの列を追加
      const newColumns = [...columns, scoreData?.reason || '', scoreData?.score.toString() || ''];
      outputLines.push(formatCSVLine(newColumns));
      filteredCount++;
    }

    if (i % 100 === 0) {
      console.log(`処理中: ${i}/${records.length - 1}行`);
    }
  }

  // 結果をファイルに書き出し
  const outputPath = join(resultDir, 'filtered-by-score.csv');
  await writeFile(outputPath, outputLines.join('\n'), 'utf-8');

  console.log(`処理完了: ${outputPath}`);
  console.log(`元の行数: ${records.length - 1}行`);
  console.log(`フィルタリング後: ${filteredCount}行`);
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
        // エスケープされたダブルクォート
        current += '"';
        i += 2;
        continue;
      } else {
        // クォートの開始/終了
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (!inQuotes) {
      if (char === ',') {
        // フィールドの区切り
        fields.push(current);
        current = '';
        i++;
        continue;
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        // レコードの区切り（改行）
        fields.push(current);
        current = '';
        if (fields.some(f => f.trim())) {
          // 空でないレコードのみ追加
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

  // 最後のフィールドとレコードを追加
  if (current || fields.length > 0) {
    fields.push(current);
    if (fields.some(f => f.trim())) {
      records.push([...fields]);
    }
  }

  return records;
}

/**
 * CSV行をフォーマット（ダブルクォートでエスケープ）
 */
function formatCSVLine(columns: string[]): string {
  return columns.map(col => {
    // カンマ、ダブルクォート、改行が含まれる場合はエスケープ
    if (col.includes(',') || col.includes('"') || col.includes('\n')) {
      return `"${col.replace(/"/g, '""')}"`;
    }
    return col;
  }).join(',');
}

main().catch(console.error);
