import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

// 入力ファイル
const inputFile = join(__dirname, '../10-1-add-refuse-rate/result/final-nutrition-with-refuse-rate.csv');

// 出力ファイル
const outputFile = join(resultDir, 'cleaned-final-nutrition.csv');

// 削除するカラム名
const COLUMNS_TO_REMOVE = [
  'structured_food_name',
  'has_amino_acid_data',
  'has_fatty_acid_data',
  'reason'
];

// 新しいカラム順序（削除対象を除く）
const NEW_COLUMN_ORDER = [
  // 1. 基本情報（識別子）
  'food_group',
  'REFUSE',
  'food_number',
  'food_name',
  'food_name_en',
  
  // 2. 基本栄養素・エネルギー
  'WATER',
  'PROT-',
  'FAT-',
  'FIB-',
  'ASH',
  'ENERC_KCAL',
  'ME_KCAL_100G',
  
  // 3. ミネラル（13種）
  'CA',
  'P',
  'NA',
  'K',
  'MG',
  'FE',
  'ZN',
  'CU',
  'MN',
  'ID',
  'SE',
  'CR',
  'MO',
  'usda_selenium_ug',
  
  // 4. ビタミン（12種 + コリン + USDA補完）
  'RETOL',
  'VITD',
  'TOCPHA',
  'THIA',
  'RIBF',
  'NIA',
  'VITB6A',
  'VITB12',
  'FOL',
  'PANTAC',
  'VITK',
  'BIOT',
  'usda_choline_mg',
  'usda_vitamin_k_ug',
  'usda_vitamin_c_mg',
  
  // 5. アミノ酸（14種）
  'ILE',
  'LEU',
  'LYS',
  'MET',
  'CYS',
  'AAS',
  'PHE',
  'TYR',
  'AAA',
  'THR',
  'TRP',
  'VAL',
  'HIS',
  'ARG',
  
  // 6. 脂肪酸（9種）
  'FACID',
  'FAPU',
  'FAPUN3',
  'FAPUN6',
  'F18D2N6',
  'F18D3N3',
  'F20D5N3',
  'F22D6N3',
  'F20D4N6',
  
  // 7. メタデータ（スコア・参照情報）
  'score',
  'usda_fdc_id'
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
 * カラムを削除し、新しい順序で並び替えた行を作成
 */
function removeAndReorderColumns(
  row: string[],
  columnIndices: Map<string, number>,
  columnsToRemove: string[],
  newOrder: string[]
): string[] {
  // 削除対象のインデックスを取得
  const removeIndices = new Set<number>();
  columnsToRemove.forEach(columnName => {
    const index = columnIndices.get(columnName);
    if (index !== undefined) {
      removeIndices.add(index);
    }
  });

  // 新しい順序に従ってカラムを並び替え
  const reorderedRow: string[] = [];
  for (const columnName of newOrder) {
    const index = columnIndices.get(columnName);
    if (index !== undefined && !removeIndices.has(index)) {
      reorderedRow.push(row[index]);
    }
  }

  return reorderedRow;
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

  // 新しい順序に存在しないカラムを確認
  const missingOrderColumns = NEW_COLUMN_ORDER.filter(col => !columnIndices.has(col));
  if (missingOrderColumns.length > 0) {
    console.warn(`警告: 新しい順序に指定された以下のカラムが見つかりませんでした: ${missingOrderColumns.join(', ')}`);
  }

  // 実際に存在するカラムのみを新しい順序から抽出
  const validNewOrder = NEW_COLUMN_ORDER.filter(col => columnIndices.has(col) && !COLUMNS_TO_REMOVE.includes(col));

  console.log(`削除対象カラム: ${COLUMNS_TO_REMOVE.join(', ')}`);
  console.log(`元のカラム数: ${headerRow.length}`);
  console.log(`新しい順序のカラム数: ${validNewOrder.length}`);

  // 新しいヘッダー行を作成
  const newHeaderRow = validNewOrder;

  // 各行から指定カラムを削除し、新しい順序で並び替え
  const cleanedRecords = [
    newHeaderRow,
    ...records.slice(1).map(row => 
      removeAndReorderColumns(row, columnIndices, COLUMNS_TO_REMOVE, validNewOrder)
    )
  ];

  console.log(`クリーンアップ後のカラム数: ${cleanedRecords[0].length}`);
  console.log(`レコード数: ${cleanedRecords.length}`);

  // CSVに変換して出力
  const outputCSV = recordsToCSV(cleanedRecords);
  await writeFile(outputFile, outputCSV, 'utf-8');

  console.log(`クリーンアップ完了: ${outputFile}`);
}

main().catch(console.error);