import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, "../09-0/FoodData_Central_sr_legacy_food_csv_2018-04");
const OUTPUT_DIR = path.join(__dirname, "result");

// CSV行をパース（ダブルクォートで囲まれた値に対応）
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // エスケープされたダブルクォート
        current += '"';
        i++; // 次の文字をスキップ
      } else {
        // クォートの開始/終了
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // フィールドの終了
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current); // 最後のフィールド
  return result;
}

// food.csvを読み込み
function loadFoods(): Map<string, { description: string; food_category_id: string }> {
  const content = fs.readFileSync(path.join(INPUT_DIR, "food.csv"), "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const foods = new Map<string, { description: string; food_category_id: string }>();

  // ヘッダーをスキップ
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 4) {
      const fdc_id = fields[0].replace(/"/g, "");
      const description = fields[2].replace(/"/g, "");
      const food_category_id = fields[3].replace(/"/g, "");
      foods.set(fdc_id, { description, food_category_id });
    }
  }

  return foods;
}

// nutrient.csvを読み込み
function loadNutrients(): Map<string, { name: string; unit_name: string }> {
  const content = fs.readFileSync(path.join(INPUT_DIR, "nutrient.csv"), "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const nutrients = new Map<string, { name: string; unit_name: string }>();

  // ヘッダーをスキップ
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 3) {
      const id = fields[0].replace(/"/g, "");
      const name = fields[1].replace(/"/g, "");
      const unit_name = fields[2].replace(/"/g, "");
      nutrients.set(id, { name, unit_name });
    }
  }

  return nutrients;
}

// food_nutrient.csvを読み込み
function loadFoodNutrients(): Map<string, Map<string, number>> {
  const content = fs.readFileSync(path.join(INPUT_DIR, "food_nutrient.csv"), "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const foodNutrients = new Map<string, Map<string, number>>();

  // ヘッダーをスキップ
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 4) {
      const fdc_id = fields[1].replace(/"/g, "");
      const nutrient_id = fields[2].replace(/"/g, "");
      const amount = parseFloat(fields[3].replace(/"/g, ""));

      if (!isNaN(amount)) {
        if (!foodNutrients.has(fdc_id)) {
          foodNutrients.set(fdc_id, new Map());
        }
        foodNutrients.get(fdc_id)!.set(nutrient_id, amount);
      }
    }
  }

  return foodNutrients;
}

// メイン処理
function main() {
  console.log("Loading USDA SR Legacy data...");

  const foods = loadFoods();
  console.log(`  Foods: ${foods.size} items`);

  const nutrients = loadNutrients();
  console.log(`  Nutrients: ${nutrients.size} items`);

  const foodNutrients = loadFoodNutrients();
  console.log(`  Food-nutrient records: ${foodNutrients.size} foods`);

  // JSONデータ構造を作成
  const usdaFoods: Record<
    string,
    {
      fdc_id: string;
      description: string;
      food_category_id: string;
      nutrients: Record<
        string,
        { name: string; amount: number; unit: string }
      >;
    }
  > = {};

  for (const [fdc_id, food] of foods) {
    const nutrientMap = foodNutrients.get(fdc_id);
    const nutrientsData: Record<string, { name: string; amount: number; unit: string }> = {};

    if (nutrientMap) {
      for (const [nutrient_id, amount] of nutrientMap) {
        const nutrient = nutrients.get(nutrient_id);
        if (nutrient) {
          nutrientsData[nutrient_id] = {
            name: nutrient.name,
            amount,
            unit: nutrient.unit_name,
          };
        }
      }
    }

    usdaFoods[fdc_id] = {
      fdc_id,
      description: food.description,
      food_category_id: food.food_category_id,
      nutrients: nutrientsData,
    };
  }

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // JSON出力
  const outputPath = path.join(OUTPUT_DIR, "usda-foods.json");
  fs.writeFileSync(outputPath, JSON.stringify(usdaFoods, null, 2), "utf-8");

  console.log(`\nOutput: ${outputPath}`);
  console.log(`  Total foods: ${Object.keys(usdaFoods).length}`);
  console.log(`  Foods with nutrients: ${Object.values(usdaFoods).filter(f => Object.keys(f.nutrients).length > 0).length}`);
}

main();
