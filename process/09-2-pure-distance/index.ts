import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEXT_CSV = path.join(__dirname, "../08-3-merge-choline/result/final-with-choline.csv");
const USDA_JSON = path.join(__dirname, "../09-1-usda-normalize/result/usda-foods.json");
const OUTPUT_DIR = path.join(__dirname, "result");

// MEXTとUSDAの栄養素マッピング
// MEXT列名 -> USDA nutrient_id
const NUTRIENT_MAPPING: Record<string, string> = {
  "PROT-": "1003", // Protein (G)
  "FAT-": "1004", // Total lipid (fat) (G)
  "CA": "1087", // Calcium, Ca (MG)
  "P": "1091", // Phosphorus, P (MG)
  "FE": "1089", // Iron, Fe (MG)
  "ZN": "1095", // Zinc, Zn (MG)
  "MG": "1090", // Magnesium, Mg (MG)
  "THIA": "1165", // Thiamin (MG)
  "RIBF": "1166", // Riboflavin (MG)
  "NIA": "1167", // Niacin (MG)
};

// MEXT食品群とUSDAカテゴリーのマッピング
// MEXT food_group (2桁) -> USDA food_category_id (文字列)
// 明確に対応するカテゴリーは縛り、曖昧なものは複数カテゴリーを許容
// 明らかに含まないカテゴリーは排除
const CATEGORY_MAPPING: Record<string, string[]> = {
  "01": ["20", "8"], // 穀類 -> Cereal Grains and Pasta, Breakfast Cereals
  "02": ["11"], // いも及びでん粉類 -> Vegetables (potatoes)
  "03": ["19"], // 砂糖及び甘味類 -> Sweets
  "04": ["16"], // 豆類 -> Legumes and Legume Products
  "05": ["12"], // 種実類 -> Nut and Seed Products
  "06": ["11", "16"], // 野菜類 -> Vegetables, Legumes（豆野菜を含む）
  "07": ["9"], // 果実類 -> Fruits and Fruit Juices
  "08": ["11"], // きのこ類 -> Vegetables (mushrooms)
  "09": [], // 藻類 -> 全カテゴリー対象（海藻は栄養組成が独特で距離が大きくなりがち）
  "10": ["15", "24"], // 魚介類 -> Finfish and Shellfish, American Indian/Alaska Native Foods
  "11": ["5", "10", "13", "17", "7"], // 肉類 -> Poultry, Pork, Beef, Lamb/Veal/Game, Sausages
  "12": ["1"], // 卵類 -> Dairy and Egg Products
  "13": ["1"], // 乳類 -> Dairy and Egg Products
  "14": ["4"], // 油脂類 -> Fats and Oils
  "15": ["19", "18", "23"], // 菓子類 -> Sweets, Baked Products, Snacks
  "16": ["14", "28"], // し好飲料類 -> Beverages, Alcoholic Beverages
  "17": ["2", "6"], // 調味料及び香辛料類 -> Spices and Herbs, Soups/Sauces/Gravies
  "18": ["22", "21", "25", "6"], // 調理済み流通食品類 -> Meals, Fast Foods, Restaurant Foods, Soups/Sauces
};

// 食品群ごとの距離閾値（特殊なカテゴリーは緩める）
const DISTANCE_THRESHOLD: Record<string, number> = {
  "09": 5.0, // 藻類は栄養組成が独特で距離が大きくなるため緩める
  "03": 5.0, // 砂糖類も距離が大きくなりがち
  "17": 5.0, // 調味料も距離が大きくなりがち
  "18": 5.0, // 調理済み食品も複合的
};
const DEFAULT_DISTANCE_THRESHOLD = 3.0;

// CSV行をパース
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// 数値に変換（括弧や空文字を処理）
function parseValue(value: string): number | null {
  if (!value || value.trim() === "" || value === "-" || value === "(0)") {
    return null;
  }
  // 括弧で囲まれた値は推定値として扱う
  const cleaned = value.replace(/[()]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// PURE研究の栄養距離を計算
function calculateNutrientDistance(
  mextNutrients: Record<string, number>,
  usdaNutrients: Record<string, { name: string; amount: number; unit: string }>
): number | null {
  let sumSquaredErrors = 0;
  let validNutrients = 0;

  for (const [mextKey, usdaNutrientId] of Object.entries(NUTRIENT_MAPPING)) {
    const mextValue = mextNutrients[mextKey];
    const usdaNutrient = usdaNutrients[usdaNutrientId];

    // MEXT側の値が無効（null、0、または欠損）の場合はスキップ
    if (mextValue === null || mextValue === undefined || mextValue === 0) {
      continue;
    }

    // USDA側の値が無効の場合はスキップ
    if (!usdaNutrient || usdaNutrient.amount === null || usdaNutrient.amount === undefined) {
      continue;
    }

    // 単位変換（USDAは既に100g当たりの値なので、そのまま使用）
    // GとMGはそのまま、必要に応じて変換
    let usdaValue = usdaNutrient.amount;
    
    // 単位が一致していることを確認（GとMGは異なる単位なので注意）
    // マッピング定義で既に単位が一致するように設定されている前提
    // PROT-とFAT-はG、その他はMG

    // 相対誤差の二乗を計算
    const relativeError = (usdaValue - mextValue) / mextValue;
    sumSquaredErrors += relativeError * relativeError;
    validNutrients++;
  }

  // 有効な栄養素が1つもない場合はnullを返す
  if (validNutrients === 0) {
    return null;
  }

  // 栄養距離 = 相対誤差の二乗和の平方根
  return Math.sqrt(sumSquaredErrors);
}

// メイン処理
async function main() {
  console.log("Loading MEXT data...");
  const mextContent = await readFile(MEXT_CSV, "utf-8");
  const mextLines = mextContent.split("\n").filter((line) => line.trim());
  const mextHeaders = parseCSVLine(mextLines[0]);
  const mextRows = mextLines.slice(1).map((line) => parseCSVLine(line));

  console.log(`  MEXT foods: ${mextRows.length} items`);

  // ヘッダーのインデックスを取得
  const headerIndices: Record<string, number> = {};
  for (let i = 0; i < mextHeaders.length; i++) {
    headerIndices[mextHeaders[i]] = i;
  }

  console.log("Loading USDA data...");
  const usdaContent = await readFile(USDA_JSON, "utf-8");
  const usdaFoods: Record<
    string,
    {
      fdc_id: string;
      description: string;
      food_category_id: string;
      nutrients: Record<string, { name: string; amount: number; unit: string }>;
    }
  > = JSON.parse(usdaContent);

  const usdaFoodArray = Object.values(usdaFoods);
  console.log(`  USDA foods: ${usdaFoodArray.length} items`);

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 各MEXT食品に対して距離を計算
  const results: Record<
    string,
    {
      food_number: string;
      food_name: string;
      food_group: string;
      candidates: Array<{
        fdc_id: string;
        description: string;
        distance: number;
        food_category_id: string;
      }>;
    }
  > = {};

  console.log("\nCalculating nutrient distances...");
  let processed = 0;

  for (const mextRow of mextRows) {
    const foodNumber = mextRow[headerIndices["food_number"]] || "";
    const foodName = mextRow[headerIndices["food_name"]] || "";
    const foodGroup = mextRow[headerIndices["food_group"]] || "";

    if (!foodNumber) continue;

    // MEXTの栄養素値を取得
    const mextNutrients: Record<string, number> = {};
    for (const [mextKey] of Object.entries(NUTRIENT_MAPPING)) {
      const value = parseValue(mextRow[headerIndices[mextKey]] || "");
      if (value !== null) {
        mextNutrients[mextKey] = value;
      }
    }

    // 有効な栄養素が1つもない場合はスキップ
    if (Object.keys(mextNutrients).length === 0) {
      continue;
    }

    // 同じカテゴリーのUSDA食品のみを候補として取得
    const allowedCategoryIds = CATEGORY_MAPPING[foodGroup] || [];
    const filteredUSDAFoods = allowedCategoryIds.length > 0
      ? usdaFoodArray.filter((f) => allowedCategoryIds.includes(f.food_category_id))
      : usdaFoodArray; // カテゴリーマッピングがない場合は全食品を対象

    // 同じカテゴリーのUSDA食品との距離を計算
    const distances: Array<{
      fdc_id: string;
      description: string;
      distance: number;
      food_category_id: string;
    }> = [];

    for (const usdaFood of filteredUSDAFoods) {
      const distance = calculateNutrientDistance(mextNutrients, usdaFood.nutrients);
      if (distance !== null) {
        distances.push({
          fdc_id: usdaFood.fdc_id,
          description: usdaFood.description,
          distance,
          food_category_id: usdaFood.food_category_id,
        });
      }
    }

    // 食品群ごとの距離閾値を取得
    const distanceThreshold = DISTANCE_THRESHOLD[foodGroup] || DEFAULT_DISTANCE_THRESHOLD;

    // 距離でソートして、閾値以下の候補のみを取得（最大20件）
    distances.sort((a, b) => a.distance - b.distance);
    const filtered = distances.filter((d) => d.distance <= distanceThreshold);
    const top20 = filtered.slice(0, 20);

    results[foodNumber] = {
      food_number: foodNumber,
      food_name: foodName,
      food_group: foodGroup,
      candidates: top20,
    };

    processed++;
    if (processed % 100 === 0) {
      console.log(`  Processed: ${processed}/${mextRows.length}`);
    }
  }

  console.log(`\nCompleted: ${processed} foods processed`);

  // JSON出力
  const outputPath = path.join(OUTPUT_DIR, "distance-top20.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");

  console.log(`\nOutput: ${outputPath}`);
  console.log(`  Total foods with candidates: ${Object.keys(results).length}`);
  
  // 統計情報
  const foodsWithCandidates = Object.values(results).filter(r => r.candidates.length > 0).length;
  console.log(`  Foods with at least 1 candidate: ${foodsWithCandidates}`);
}

main().catch(console.error);
