import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../13-3-categorize-foods/result/final-nutrition-categorized.csv');
const outputFile = join(resultDir, 'food-lists-by-category.json');

type FoodCategory = 'recipe_ingredient' | 'canonical_food' | 'variation';

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

  // 必要な列のインデックスを取得
  const foodNameIndex = headers.indexOf('food_name');
  const canonicalNameIndex = headers.indexOf('canonical_name');
  const foodCategoryIndex = headers.indexOf('food_category');

  if (foodNameIndex === -1 || foodCategoryIndex === -1) {
    throw new Error('必要な列が見つかりません');
  }
  if (canonicalNameIndex === -1) {
    throw new Error('canonical_name列が見つかりません');
  }

  // カテゴリごとに食材名を分類
  console.log('\n=== カテゴリ別に食材を分類 ===');
  const foodLists: Record<FoodCategory, string[]> = {
    recipe_ingredient: [],
    canonical_food: [],
    variation: [],
  };

  for (const row of dataRows) {
    const foodName = row[foodNameIndex] || '';
    const canonicalName = row[canonicalNameIndex] || '';
    const category = row[foodCategoryIndex] as FoodCategory;

    if (category && foodLists[category]) {
      // recipe_ingredientの場合はcanonical_nameを使用、それ以外はfood_name
      const displayName = category === 'recipe_ingredient' ? canonicalName : foodName;
      if (displayName) {
        foodLists[category].push(displayName);
      }
    }
  }

  // 各カテゴリをソート
  for (const category of Object.keys(foodLists) as FoodCategory[]) {
    foodLists[category].sort();
  }

  // JSONファイルに書き込み
  console.log('\n=== JSON出力 ===');
  await writeFile(outputFile, JSON.stringify(foodLists, null, 2), 'utf-8');
  console.log(`結果を保存: ${outputFile}`);

  console.log(`\n処理完了！`);
  console.log(`1. 一般レシピ食材: ${foodLists.recipe_ingredient.length}件`);
  console.log(`2. canonical-food: ${foodLists.canonical_food.length}件`);
  console.log(`3. その他（バリエーション）: ${foodLists.variation.length}件`);
  console.log(`合計: ${foodLists.recipe_ingredient.length + foodLists.canonical_food.length + foodLists.variation.length}件`);
}

main().catch(console.error);

