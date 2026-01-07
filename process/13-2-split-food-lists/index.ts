import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../13-1-canonical-food-mark/result/final-nutrition-with-canonical.csv');
const canonicalFoodsFile = join(resultDir, 'canonical-foods.json');

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

function escapeCSVField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return field;
}

function writeCSV(records: string[][]): string {
  return records.map(row => row.map(escapeCSVField).join(',')).join('\n');
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

  // is_canonical列のインデックスを取得
  const isCanonicalIndex = headers.indexOf('is_canonical');
  if (isCanonicalIndex === -1) {
    throw new Error('is_canonical列が見つかりません');
  }

  // 正規化名辞書を生成（canonical_name -> 食材リスト）
  console.log('\n=== 正規化名辞書を生成 ===');
  const canonicalNameIndex = headers.indexOf('canonical_name');
  const foodNumberIndex = headers.indexOf('food_number');
  const foodNameIndex = headers.indexOf('food_name');
  
  if (canonicalNameIndex === -1) {
    throw new Error('canonical_name列が見つかりません');
  }
  if (foodNumberIndex === -1 || foodNameIndex === -1) {
    throw new Error('food_numberまたはfood_name列が見つかりません');
  }

  const canonicalDictionary: Record<string, Array<{
    food_number: string;
    food_name: string;
    is_canonical: boolean;
  }>> = {};

  for (const row of dataRows) {
    const canonicalName = row[canonicalNameIndex] || '';
    if (!canonicalName) continue;

    const foodNumber = row[foodNumberIndex] || '';
    const foodName = row[foodNameIndex] || '';
    const isCanonical = row[isCanonicalIndex]?.toUpperCase() === 'TRUE';

    if (!canonicalDictionary[canonicalName]) {
      canonicalDictionary[canonicalName] = [];
    }
    canonicalDictionary[canonicalName].push({
      food_number: foodNumber,
      food_name: foodName,
      is_canonical: isCanonical,
    });
  }

  // 正規化名でソート
  const sortedDictionary: Record<string, Array<{
    food_number: string;
    food_name: string;
    is_canonical: boolean;
  }>> = {};
  const sortedKeys = Object.keys(canonicalDictionary).sort();
  for (const key of sortedKeys) {
    sortedDictionary[key] = canonicalDictionary[key];
  }

  await writeFile(canonicalFoodsFile, JSON.stringify(sortedDictionary, null, 2), 'utf-8');
  console.log(`正規化名辞書を保存: ${canonicalFoodsFile}`);
  console.log(`正規化グループ数: ${Object.keys(sortedDictionary).length}件`);
  
  // 統計
  const totalCanonicalFoods = Object.values(sortedDictionary).reduce((sum, foods) => sum + foods.length, 0);
  console.log(`総食材数（グループ内）: ${totalCanonicalFoods}件`);

  console.log(`\n処理完了！`);
  console.log(`全食材: ${dataRows.length}件`);
  console.log(`正規化グループ: ${Object.keys(sortedDictionary).length}件`);
}

main().catch(console.error);

