import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

// 入力ファイル
const inputFile = join(__dirname, '../09-3-ai-select/result/final-nutrition.csv');

// 出力ファイル
const outputFile = join(resultDir, 'cleaned-final-nutrition.csv');

// 削除するカラム名
const COLUMNS_TO_REMOVE = [
  'structured_food_name',
  'has_amino_acid_data',
  'has_fatty_acid_data'
];

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
 * CSV値をエスケープ
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * カラムインデックスを取得
 */
function getColumnIndices(headerRow: string[]): Map<string, number> {
  const indices = new Map<string, number>();
  headerRow.forEach((columnName, index) => {
    indices.set(columnName, index);
  });
  return indices;
}

/**
 * 指定されたカラムを削除した新しい行を作成
 */
function removeColumns(row: string[], columnIndices: Map<string, number>, columnsToRemove: string[]): string[] {
  const removeIndices = new Set<number>();
  columnsToRemove.forEach(columnName => {
    const index = columnIndices.get(columnName);
    if (index !== undefined) {
      removeIndices.add(index);
    }
  });

  return row.filter((_, index) => !removeIndices.has(index));
}

/**
 * CSVレコードを文字列に変換
 */
function recordsToCSV(records: string[][]): string {
  return records.map(row =>
    row.map(field => escapeCSV(field)).join(',')
  ).join('\n');
}

async function main() {
  console.log('10-1-clean-data: データクリーンアップを開始します...');

  // resultディレクトリを作成
  await mkdir(resultDir, { recursive: true });

  // 入力ファイルを読み込み
  console.log('CSVファイルを読み込んでいます...');
  const csvContent = await readFile(inputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  // ヘッダー行を取得
  const headerRow = records[0];
  const columnIndices = getColumnIndices(headerRow);

  // 削除するカラムが存在するか確認
  const missingColumns = COLUMNS_TO_REMOVE.filter(col => !columnIndices.has(col));
  if (missingColumns.length > 0) {
    console.warn(`警告: 以下のカラムが見つかりませんでした: ${missingColumns.join(', ')}`);
  }

  console.log(`削除対象カラム: ${COLUMNS_TO_REMOVE.join(', ')}`);
  console.log(`元のカラム数: ${headerRow.length}`);

  // 各行から指定カラムを削除
  const cleanedRecords = records.map(row => removeColumns(row, columnIndices, COLUMNS_TO_REMOVE));

  console.log(`クリーンアップ後のカラム数: ${cleanedRecords[0].length}`);
  console.log(`レコード数: ${cleanedRecords.length}`);

  // CSVに変換して出力
  const outputCSV = recordsToCSV(cleanedRecords);
  await writeFile(outputFile, outputCSV, 'utf-8');

  console.log(`クリーンアップ完了: ${outputFile}`);
}

main().catch(console.error);