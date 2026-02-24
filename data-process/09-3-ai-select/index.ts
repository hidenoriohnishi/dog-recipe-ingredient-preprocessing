import dotenv from "dotenv";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, "result");

// 入力ファイル
const mextFile = join(
  __dirname,
  "../07-normalize-headers/result/final-nutrition.csv"
);
const distanceFile = join(
  __dirname,
  "../09-2-3-pure-distance/result/distance-top50.json"
);
const usdaFoodsFile = join(
  __dirname,
  "../09-1-1-usda-normalize/result/usda-foods.json"
);
const translatedNamesFile = join(
  __dirname,
  "../09-2-1-1-translate/result/translated-names.json"
);

// 出力ファイル
const outputFile = join(resultDir, "final-nutrition.csv");

// 距離計算結果（09-2-3の形式）
interface DistanceCandidate {
  fdc_id: string;
  description: string;
  name_similarity: number;
  nutrient_distance: number;
  combined_score: number;
  matched_nutrients: number;
}

interface DistanceData {
  food_number: string;
  food_name: string;
  candidates: DistanceCandidate[];
}

// USDA食品データ
interface USDAFood {
  fdc_id: string;
  description: string;
  food_category_id: string;
  nutrients: Record<string, { name: string; amount: number; unit: string }>;
}

// 翻訳データ
interface TranslatedName {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
}

// マッチング結果
interface MatchResult {
  mext_food_number: string;
  usda_fdc_id: string | null;
  usda_choline_mg: string;
  usda_selenium_ug: string;
  usda_vitamin_k_ug: string;
  usda_vitamin_c_mg: string;
  food_name_en: string;
}

// グローバルに保持するデータ
let distanceData: Record<string, DistanceData> = {};
let usdaFoods: Record<string, USDAFood> = {};
let translatedNames: Record<string, TranslatedName> = {};

/**
 * CSVをパース
 */
function parseCSVRecords(csvContent: string): string[][] {
  const records: string[][] = [];
  const fields: string[] = [];
  let current = "";
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
      if (char === ",") {
        fields.push(current);
        current = "";
        i++;
        continue;
      } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
        fields.push(current);
        current = "";
        if (fields.some((f) => f.trim())) {
          records.push([...fields]);
        }
        fields.length = 0;
        if (char === "\r" && nextChar === "\n") {
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
    if (fields.some((f) => f.trim())) {
      records.push([...fields]);
    }
  }

  return records;
}

/**
 * 距離データを読み込み
 */
async function loadDistanceData(): Promise<void> {
  const content = await readFile(distanceFile, "utf-8");
  distanceData = JSON.parse(content);
  console.log(`距離データ読み込み完了: ${Object.keys(distanceData).length}件`);
}

/**
 * USDA食品データを読み込み
 */
async function loadUSDAFoods(): Promise<void> {
  const content = await readFile(usdaFoodsFile, "utf-8");
  usdaFoods = JSON.parse(content);
  console.log(`USDA食品データ読み込み完了: ${Object.keys(usdaFoods).length}件`);
}

/**
 * 翻訳名データを読み込み
 */
async function loadTranslatedNames(): Promise<void> {
  const content = await readFile(translatedNamesFile, "utf-8");
  const translatedArray: TranslatedName[] = JSON.parse(content);
  translatedNames = {};
  for (const item of translatedArray) {
    translatedNames[item.food_number] = item;
  }
  console.log(`翻訳名データ読み込み完了: ${Object.keys(translatedNames).length}件`);
}

// USDA栄養素ID（SR Legacyにデータがあるもののみ）
const USDA_CHOLINE_ID = "1180"; // Choline, total
const USDA_SELENIUM_ID = "1103"; // Selenium, Se
const USDA_VITAMIN_K_ID = "1185"; // Vitamin K (phylloquinone)
const USDA_VITAMIN_C_ID = "1162"; // Vitamin C, total ascorbic acid

function getUsdaNutrientValue(usdaFood: USDAFood | undefined, nutrientId: string): string {
  if (usdaFood?.nutrients) {
    const nutrient = usdaFood.nutrients[nutrientId];
    if (nutrient?.amount != null) return nutrient.amount.toString();
  }
  return "";
}

/**
 * 最適な候補を機械的に選択
 * 
 * 選択戦略:
 * combined_scoreが最大の候補を選ぶ
 * (combined_score = name_similarity * 0.6 + nutrient_similarity * 0.4)
 */
function selectBestCandidate(candidates: DistanceCandidate[]): DistanceCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  // combined_scoreが最大の候補を選択
  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.combined_score > best.combined_score) {
      best = candidate;
    }
  }

  return best;
}

/**
 * マッチング結果を生成
 */
function generateMatchResults(): MatchResult[] {
  const results: MatchResult[] = [];

  for (const [foodNumber, data] of Object.entries(distanceData)) {
    const bestCandidate = selectBestCandidate(data.candidates);

    // 英語翻訳名を取得
    const translated = translatedNames[foodNumber];
    const foodNameEn = translated?.food_name_en || "";

    if (bestCandidate) {
      const usdaFood = usdaFoods[bestCandidate.fdc_id];
      results.push({
        mext_food_number: foodNumber,
        usda_fdc_id: bestCandidate.fdc_id,
        usda_choline_mg: getUsdaNutrientValue(usdaFood, USDA_CHOLINE_ID),
        usda_selenium_ug: getUsdaNutrientValue(usdaFood, USDA_SELENIUM_ID),
        usda_vitamin_k_ug: getUsdaNutrientValue(usdaFood, USDA_VITAMIN_K_ID),
        usda_vitamin_c_mg: getUsdaNutrientValue(usdaFood, USDA_VITAMIN_C_ID),
        food_name_en: foodNameEn,
      });
    } else {
      results.push({
        mext_food_number: foodNumber,
        usda_fdc_id: null,
        usda_choline_mg: "",
        usda_selenium_ug: "",
        usda_vitamin_k_ug: "",
        usda_vitamin_c_mg: "",
        food_name_en: foodNameEn,
      });
    }
  }

  return results;
}

/**
 * 最終CSVを生成
 */
async function generateFinalCSV(matchResults: MatchResult[]): Promise<void> {
  console.log("\n最終CSVを生成しています...");

  // MEXTデータを読み込み
  const mextContent = await readFile(mextFile, "utf-8");
  const mextRecords = parseCSVRecords(mextContent);
  const mextHeaders = mextRecords[0];
  const mextRows = mextRecords.slice(1);

  // マッチング結果をMapに変換
  const matchMap = new Map<string, MatchResult>();
  for (const m of matchResults) {
    matchMap.set(m.mext_food_number, m);
  }

  // 新しいヘッダー（USDA関連の列を追加）
  const newHeaders = [
    ...mextHeaders,
    "usda_fdc_id",
    "usda_choline_mg",
    "usda_selenium_ug",
    "usda_vitamin_k_ug",
    "usda_vitamin_c_mg",
    "food_name_en",
  ];

  const emptyUsdaValues = ["", "", "", ""]; // 4 USDA補完カラム（choline, selenium, vitK, vitC）

  // データ行を拡張
  const extendedRows = mextRows.map((row) => {
    const foodNumber = row[mextHeaders.indexOf("food_number")] || "";
    const match = matchMap.get(foodNumber);

    if (match) {
      return [
        ...row,
        match.usda_fdc_id || "",
        match.usda_choline_mg,
        match.usda_selenium_ug,
        match.usda_vitamin_k_ug,
        match.usda_vitamin_c_mg,
        match.food_name_en,
      ];
    } else {
      return [...row, "", "", ...emptyUsdaValues, ""];
    }
  });

  // CSV出力
  const csvLines = [
    newHeaders.join(","),
    ...extendedRows.map((row) =>
      row
        .map((cell) => {
          const str = String(cell);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    ),
  ];

  await writeFile(outputFile, csvLines.join("\n"), "utf-8");
  console.log(`出力: ${outputFile}`);
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log("=== 09-3: USDAマッチング選定（機械的選択） ===\n");

  // データを読み込み
  await loadDistanceData();
  await loadUSDAFoods();
  await loadTranslatedNames();

  // 機械的にマッチング
  console.log("\n候補から最適なものを選択しています...");
  const matchResults = generateMatchResults();

  // 統計
  const matchedCount = matchResults.filter((m) => m.usda_fdc_id).length;
  const withCholine = matchResults.filter((m) => m.usda_choline_mg !== "").length;
  const withSelenium = matchResults.filter((m) => m.usda_selenium_ug !== "").length;
  const withVitaminK = matchResults.filter((m) => m.usda_vitamin_k_ug !== "").length;
  const withVitaminC = matchResults.filter((m) => m.usda_vitamin_c_mg !== "").length;
  const withTranslation = matchResults.filter((m) => m.food_name_en !== "").length;

  console.log(`\n選択結果:`);
  console.log(`  総食品数: ${matchResults.length}件`);
  console.log(`  マッチ: ${matchedCount}件`);
  console.log(`  Cholineデータあり: ${withCholine}件`);
  console.log(`  Selenium(USDA)あり: ${withSelenium}件`);
  console.log(`  Vitamin K(USDA)あり: ${withVitaminK}件`);
  console.log(`  Vitamin C(USDA)あり: ${withVitaminC}件`);
  console.log(`  英語翻訳名あり: ${withTranslation}件`);

  // 最終CSVを生成
  await generateFinalCSV(matchResults);

  console.log(`\n処理完了: ${outputFile}`);
}

main().catch(console.error);
