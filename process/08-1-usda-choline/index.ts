import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, "../08-0/Choln02");
const OUTPUT_DIR = path.join(__dirname, "result");

// 栄養素IDとカラム名のマッピング
const NUTRIENT_COLUMNS: Record<string, string> = {
  "421": "total_choline_mg",
  "450": "free_choline_mg",
  "451": "phosphocholine_mg",
  "452": "phosphatidylcholine_mg",
  "453": "glycerophosphocholine_mg",
  "454": "betaine_mg",
  "455": "sphingomyelin_mg",
};

// USDA形式の行をパース（~value~^~value~^... 形式）
function parseUSDALine(line: string): string[] {
  // ^で分割し、各値から~を除去
  return line.split("^").map((v) => v.replace(/~/g, "").trim());
}

// 食品データを読み込み
function loadFoodDescriptions(): Map<
  string,
  { foodGroup: string; foodName: string }
> {
  const content = fs.readFileSync(
    path.join(INPUT_DIR, "FOOD_DES.txt"),
    "utf-8"
  );
  const foods = new Map<string, { foodGroup: string; foodName: string }>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const parts = parseUSDALine(line);
    if (parts.length >= 3) {
      foods.set(parts[0], {
        foodGroup: parts[1],
        foodName: parts[2],
      });
    }
  }

  return foods;
}

// 栄養データを読み込み
function loadNutrientData(): Map<string, Record<string, number>> {
  const content = fs.readFileSync(
    path.join(INPUT_DIR, "NUT_DATA.txt"),
    "utf-8"
  );
  const data = new Map<string, Record<string, number>>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const parts = parseUSDALine(line);
    if (parts.length >= 3) {
      const ndbNo = parts[0];
      const nutrientId = parts[1];
      const value = parseFloat(parts[2]);

      if (!data.has(ndbNo)) {
        data.set(ndbNo, {});
      }
      data.get(ndbNo)![nutrientId] = value;
    }
  }

  return data;
}

// CSVに変換
function convertToCSV(
  foods: Map<string, { foodGroup: string; foodName: string }>,
  nutrients: Map<string, Record<string, number>>
): string {
  const headers = [
    "ndb_no",
    "food_group",
    "food_name",
    ...Object.values(NUTRIENT_COLUMNS),
  ];

  const rows: string[] = [headers.join(",")];

  for (const [ndbNo, food] of foods) {
    const nutrientValues = nutrients.get(ndbNo) || {};

    const values = [
      ndbNo,
      food.foodGroup,
      `"${food.foodName.replace(/"/g, '""')}"`, // CSVエスケープ
      ...Object.keys(NUTRIENT_COLUMNS).map((id) =>
        nutrientValues[id] !== undefined ? nutrientValues[id].toString() : ""
      ),
    ];

    rows.push(values.join(","));
  }

  return rows.join("\n");
}

// メイン処理
function main() {
  console.log("Loading USDA choline data...");

  const foods = loadFoodDescriptions();
  console.log(`  Foods: ${foods.size} items`);

  const nutrients = loadNutrientData();
  console.log(`  Nutrient records: ${nutrients.size} items`);

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // CSV変換
  const csv = convertToCSV(foods, nutrients);

  // 出力
  const outputPath = path.join(OUTPUT_DIR, "usda-choline.csv");
  fs.writeFileSync(outputPath, csv);

  console.log(`\nOutput: ${outputPath}`);
  console.log(`  Total rows: ${foods.size}`);
}

main();
