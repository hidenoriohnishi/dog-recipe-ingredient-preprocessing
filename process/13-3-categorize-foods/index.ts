import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../13-1-canonical-food-mark/result/final-nutrition-with-canonical.csv');
const ingredientsFile = join(__dirname, '../10-0/ingredients-structured.json');
const outputFile = join(resultDir, 'final-nutrition-categorized.csv');

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

  // ingredients-structured.jsonを読み込む
  console.log('ingredients-structured.jsonを読み込んでいます...');
  const ingredientsContent = await readFile(ingredientsFile, 'utf-8');
  const ingredientsData: Record<string, Record<string, string[]>> = JSON.parse(ingredientsContent);

  // 全ての食材名を抽出（カテゴリ→食材名のキーを全て取得）
  const recipeIngredientNames = new Set<string>();
  for (const category of Object.values(ingredientsData)) {
    for (const ingredientName of Object.keys(category)) {
      recipeIngredientNames.add(ingredientName);
    }
  }
  console.log(`一般レシピ食材数: ${recipeIngredientNames.size}件`);

  // マッチング関数：柔軟なマッチングを行う
  function matchesRecipeIngredient(canonicalName: string): boolean {
    if (!canonicalName) return false;

    // 1. 完全一致
    if (recipeIngredientNames.has(canonicalName)) {
      return true;
    }

    // 2. canonical_nameから括弧内を除いた部分でマッチング
    const withoutParentheses = canonicalName.replace(/[（(].*?[）)]/g, '').trim();
    if (withoutParentheses && recipeIngredientNames.has(withoutParentheses)) {
      return true;
    }

    // 3. canonical_nameにingredients-structured.jsonのキーが含まれているか
    for (const ingredientName of recipeIngredientNames) {
      if (canonicalName.includes(ingredientName)) {
        return true;
      }
    }

    // 4. ingredients-structured.jsonのキーがcanonical_nameに含まれているか（双方向）
    for (const ingredientName of recipeIngredientNames) {
      if (canonicalName.includes(ingredientName) || ingredientName.includes(canonicalName)) {
        return true;
      }
    }

    // 5. 「精」などの接頭辞を除いてマッチング（例：「精白米」→「白米」）
    const withoutPrefix = withoutParentheses.replace(/^(精|本|特|上|下|大|小|新|旧|生|乾|冷|熱)/, '');
    if (withoutPrefix && withoutPrefix !== withoutParentheses && recipeIngredientNames.has(withoutPrefix)) {
      return true;
    }
    for (const ingredientName of recipeIngredientNames) {
      if (withoutPrefix.includes(ingredientName) || ingredientName.includes(withoutPrefix)) {
        return true;
      }
    }

    // 6. 末尾の「米」「肉」などを除いてマッチング（例：「精白米」→「精白」→「白米」にマッチ）
    // ただし、これは危険なので慎重に
    // 代わりに、ingredients名がcanonical名の末尾に含まれるかチェック
    for (const ingredientName of recipeIngredientNames) {
      // 「精白米」の末尾に「白米」が含まれるか
      if (canonicalName.endsWith(ingredientName) || withoutParentheses.endsWith(ingredientName)) {
        return true;
      }
      // 「白米」が「精白米」の一部として含まれるか（末尾部分）
      if (canonicalName.includes(ingredientName) && canonicalName.length >= ingredientName.length) {
        return true;
      }
    }

    return false;
  }

  // CSVを読み込む
  console.log('\nCSVファイルを読み込んでいます...');
  const csvContent = await readFile(inputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  const headers = records[0];
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // 必要な列のインデックスを取得
  const isCanonicalIndex = headers.indexOf('is_canonical');
  const canonicalNameIndex = headers.indexOf('canonical_name');

  if (isCanonicalIndex === -1 || canonicalNameIndex === -1) {
    throw new Error('必要な列が見つかりません');
  }

  // カテゴリを決定
  console.log('\n=== 食材を分類 ===');
  const categoryCounts = {
    recipe_ingredient: 0,
    canonical_food: 0,
    variation: 0,
  };

  const outputRows: string[][] = [];
  const newHeaders = [...headers, 'food_category'];
  outputRows.push(newHeaders);

  for (const row of dataRows) {
    const isCanonical = row[isCanonicalIndex]?.toUpperCase() === 'TRUE';
    const canonicalName = row[canonicalNameIndex] || '';

    let category: FoodCategory;
    if (!isCanonical) {
      // バリエーション食材
      category = 'variation';
      categoryCounts.variation++;
    } else {
      // 代表食材
      if (matchesRecipeIngredient(canonicalName)) {
        // 一般レシピ食材
        category = 'recipe_ingredient';
        categoryCounts.recipe_ingredient++;
      } else {
        // canonical-food
        category = 'canonical_food';
        categoryCounts.canonical_food++;
      }
    }

    const newRow = [...row, category];
    outputRows.push(newRow);
  }

  // CSVファイルに書き込み
  console.log('\n=== CSV出力 ===');
  const csvOutput = writeCSV(outputRows);
  await writeFile(outputFile, csvOutput, 'utf-8');
  console.log(`結果を保存: ${outputFile}`);

  console.log(`\n処理完了！`);
  console.log(`全食材: ${dataRows.length}件`);
  console.log(`1. 一般レシピ食材: ${categoryCounts.recipe_ingredient}件`);
  console.log(`2. canonical-food: ${categoryCounts.canonical_food}件`);
  console.log(`3. その他（バリエーション）: ${categoryCounts.variation}件`);
  console.log(`合計: ${categoryCounts.recipe_ingredient + categoryCounts.canonical_food + categoryCounts.variation}件`);
}

main().catch(console.error);

