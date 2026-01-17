import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 入力ファイル
const MEXT_CSV = path.join(__dirname, "../07-normalize-headers/result/final-nutrition.csv");
const USDA_JSON = path.join(__dirname, "../09-1-1-usda-normalize/result/usda-foods.json");
const NAME_DISTANCE_JSON = path.join(__dirname, "../09-2-2-name-distance/result/name-distance-top200.json");

const OUTPUT_DIR = path.join(__dirname, "result");
const TOP_N = 50;
const MIN_VALID_NUTRIENTS = 3; // 最低3つの栄養素が一致する必要がある

// =====================================================
// 栄養素マッピングと重み付け
// =====================================================
// AAFCOで重要な栄養素を中心に重み付け
// 重み範囲: 0.1 - 1.0（最大/最小 = 10倍以内）

interface NutrientConfig {
  usdaId: string;
  weight: number;
  name: string;
}

const NUTRIENT_MAPPING: Record<string, NutrientConfig> = {
  // マクロ栄養素（最重要: 1.0）
  "PROT-": { usdaId: "1003", weight: 1.0, name: "Protein" },
  "FAT-": { usdaId: "1004", weight: 1.0, name: "Fat" },
  
  // ミネラル - AAFCO必須（高: 0.8）
  "CA": { usdaId: "1087", weight: 0.8, name: "Calcium" },
  "P": { usdaId: "1091", weight: 0.8, name: "Phosphorus" },
  
  // ミネラル - AAFCO必須（中高: 0.6）
  "ZN": { usdaId: "1095", weight: 0.6, name: "Zinc" },
  "FE": { usdaId: "1089", weight: 0.6, name: "Iron" },
  "MG": { usdaId: "1090", weight: 0.5, name: "Magnesium" },
  
  // ミネラル - AAFCO必須（中: 0.4）
  "K": { usdaId: "1092", weight: 0.4, name: "Potassium" },
  "NA": { usdaId: "1093", weight: 0.4, name: "Sodium" },
  "CU": { usdaId: "1098", weight: 0.4, name: "Copper" },
  "MN": { usdaId: "1101", weight: 0.3, name: "Manganese" },
  "SE": { usdaId: "1103", weight: 0.3, name: "Selenium" },
  
  // ビタミンB群 - AAFCO必須（中: 0.3-0.4）
  "THIA": { usdaId: "1165", weight: 0.4, name: "Thiamin (B1)" },
  "RIBF": { usdaId: "1166", weight: 0.4, name: "Riboflavin (B2)" },
  "NIA": { usdaId: "1167", weight: 0.3, name: "Niacin (B3)" },
  "PANTAC": { usdaId: "1170", weight: 0.3, name: "Pantothenic acid (B5)" },
  "VITB6A": { usdaId: "1175", weight: 0.3, name: "Vitamin B6" },
  "FOL": { usdaId: "1177", weight: 0.2, name: "Folate" },
  "VITB12": { usdaId: "1178", weight: 0.3, name: "Vitamin B12" },
  
  // 脂溶性ビタミン - AAFCO必須（中: 0.3）
  "VITA_RAE": { usdaId: "1106", weight: 0.3, name: "Vitamin A (RAE)" },
  "VITD": { usdaId: "1114", weight: 0.3, name: "Vitamin D" },
  "VITE": { usdaId: "1109", weight: 0.3, name: "Vitamin E" },
  
  // その他（低: 0.1-0.2）
  "FIBTG": { usdaId: "1079", weight: 0.2, name: "Fiber" },
  "ASH": { usdaId: "1007", weight: 0.1, name: "Ash" },
  "WATER": { usdaId: "1051", weight: 0.1, name: "Water" },
};

// =====================================================
// 型定義
// =====================================================

interface USDAFood {
  fdc_id: string;
  description: string;
  food_category_id: string;
  nutrients: Record<string, { name: string; amount: number; unit: string }>;
}

interface NameDistanceCandidate {
  fdc_id: string;
  description: string;
  similarity: number;
}

interface NameDistanceEntry {
  food_number: string;
  food_name_ja: string;
  food_name_en: string;
  candidates: NameDistanceCandidate[];
}

interface OutputCandidate {
  fdc_id: string;
  description: string;
  name_similarity: number;
  nutrient_distance: number;
  combined_score: number;
  matched_nutrients: number;
}

interface OutputEntry {
  food_number: string;
  food_name: string; // 日本語名を使用
  candidates: OutputCandidate[];
}

// =====================================================
// ユーティリティ関数
// =====================================================

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

function parseValue(value: string): number | null {
  if (!value || value.trim() === "" || value === "-" || value === "(0)") {
    return null;
  }
  const cleaned = value.replace(/[()]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// =====================================================
// 栄養素距離計算
// =====================================================

/**
 * 対数比距離を計算
 * 両方の値が有効（> 0）な場合のみ計算に含める
 * 重み付き対数比の二乗和の平方根を返す
 */
function calculateNutrientDistance(
  mextNutrients: Record<string, number>,
  usdaNutrients: Record<string, { name: string; amount: number; unit: string }>
): { distance: number; matchedCount: number } | null {
  let weightedSumSquared = 0;
  let totalWeight = 0;
  let matchedCount = 0;

  for (const [mextKey, config] of Object.entries(NUTRIENT_MAPPING)) {
    const mextValue = mextNutrients[mextKey];
    const usdaNutrient = usdaNutrients[config.usdaId];

    // 両方の値が有効（> 0）な場合のみ計算に含める
    if (
      mextValue === null ||
      mextValue === undefined ||
      mextValue <= 0 ||
      !usdaNutrient ||
      usdaNutrient.amount === null ||
      usdaNutrient.amount === undefined ||
      usdaNutrient.amount <= 0
    ) {
      continue;
    }

    // 対数比を計算
    const logRatio = Math.log(usdaNutrient.amount / mextValue);
    
    // 重み付き対数比の二乗を加算
    weightedSumSquared += config.weight * logRatio * logRatio;
    totalWeight += config.weight;
    matchedCount++;
  }

  // 最低限の栄養素が一致しない場合はnullを返す
  if (matchedCount < MIN_VALID_NUTRIENTS) {
    return null;
  }

  // 正規化した距離を返す（重みの合計で割る）
  const normalizedDistance = Math.sqrt(weightedSumSquared / totalWeight);
  
  return {
    distance: normalizedDistance,
    matchedCount,
  };
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  console.log("=== 09-2-3: 栄養素距離計算（候補絞り込み）===\n");

  // MEXTデータを読み込む
  console.log("MEXTデータを読み込んでいます...");
  const mextContent = await readFile(MEXT_CSV, "utf-8");
  const mextLines = mextContent.split("\n").filter((line) => line.trim());
  const mextHeaders = parseCSVLine(mextLines[0]);
  const mextRows = mextLines.slice(1).map((line) => parseCSVLine(line));

  const headerIndices: Record<string, number> = {};
  for (let i = 0; i < mextHeaders.length; i++) {
    headerIndices[mextHeaders[i]] = i;
  }

  console.log(`  MEXT食品数: ${mextRows.length}件`);

  // USDAデータを読み込む
  console.log("USDAデータを読み込んでいます...");
  const usdaContent = await readFile(USDA_JSON, "utf-8");
  const usdaFoods: Record<string, USDAFood> = JSON.parse(usdaContent);
  console.log(`  USDA食品数: ${Object.keys(usdaFoods).length}件`);

  // name-distance候補を読み込む
  console.log("name-distance候補を読み込んでいます...");
  const nameDistanceContent = await readFile(NAME_DISTANCE_JSON, "utf-8");
  const nameDistanceData: Record<string, NameDistanceEntry> = JSON.parse(nameDistanceContent);
  console.log(`  候補データ: ${Object.keys(nameDistanceData).length}件`);

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 各MEXT食品に対して距離を計算
  const results: Record<string, OutputEntry> = {};
  let processed = 0;
  let noNameCandidates = 0;
  let noNutrientMatch = 0;

  console.log("\n栄養素距離を計算しています...");

  for (const mextRow of mextRows) {
    const foodNumber = mextRow[headerIndices["food_number"]] || "";
    const foodName = mextRow[headerIndices["food_name"]] || "";

    if (!foodNumber) continue;

    // name-distance候補を取得
    const nameDistanceEntry = nameDistanceData[foodNumber];
    if (!nameDistanceEntry || nameDistanceEntry.candidates.length === 0) {
      noNameCandidates++;
      results[foodNumber] = {
        food_number: foodNumber,
        food_name: foodName,
        candidates: [],
      };
      continue;
    }

    // MEXTの栄養素値を取得
    const mextNutrients: Record<string, number> = {};
    for (const mextKey of Object.keys(NUTRIENT_MAPPING)) {
      const value = parseValue(mextRow[headerIndices[mextKey]] || "");
      if (value !== null && value > 0) {
        mextNutrients[mextKey] = value;
      }
    }

    // 候補に対して栄養素距離を計算
    const scoredCandidates: OutputCandidate[] = [];

    for (const candidate of nameDistanceEntry.candidates) {
      const usdaFood = usdaFoods[candidate.fdc_id];
      if (!usdaFood) continue;

      const distanceResult = calculateNutrientDistance(mextNutrients, usdaFood.nutrients);
      if (distanceResult === null) continue;

      // 名前の類似度と栄養素距離を組み合わせたスコアを計算
      // 栄養素距離は小さいほど良いので、1/(1+distance)で0-1の類似度に変換
      const nutrientSimilarity = 1 / (1 + distanceResult.distance);
      
      // 総合スコア = 名前類似度 * 0.6 + 栄養素類似度 * 0.4
      // 名前の類似度を重視（同じ魚種が選ばれるように）
      const combinedScore = candidate.similarity * 0.6 + nutrientSimilarity * 0.4;

      scoredCandidates.push({
        fdc_id: candidate.fdc_id,
        description: candidate.description,
        name_similarity: candidate.similarity,
        nutrient_distance: distanceResult.distance,
        combined_score: combinedScore,
        matched_nutrients: distanceResult.matchedCount,
      });
    }

    if (scoredCandidates.length === 0) {
      noNutrientMatch++;
    }

    // 総合スコアでソートして上位N件を取得
    scoredCandidates.sort((a, b) => b.combined_score - a.combined_score);
    const topN = scoredCandidates.slice(0, TOP_N);

    results[foodNumber] = {
      food_number: foodNumber,
      food_name: foodName,
      candidates: topN,
    };

    processed++;
    if (processed % 100 === 0) {
      console.log(`  処理済み: ${processed}/${mextRows.length}`);
    }
  }

  console.log(`\n処理完了: ${processed}件`);

  // 結果を保存
  const outputPath = path.join(OUTPUT_DIR, "distance-top50.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");

  // 統計情報
  const foodsWithCandidates = Object.values(results).filter(r => r.candidates.length > 0).length;
  const avgCandidates = Object.values(results).reduce((sum, r) => sum + r.candidates.length, 0) / Object.keys(results).length;
  const avgMatchedNutrients = Object.values(results)
    .flatMap(r => r.candidates)
    .reduce((sum, c) => sum + c.matched_nutrients, 0) / 
    Object.values(results).flatMap(r => r.candidates).length || 0;

  console.log(`\n=== 統計 ===`);
  console.log(`総食品数: ${Object.keys(results).length}件`);
  console.log(`候補ありの食品数: ${foodsWithCandidates}件`);
  console.log(`name-distance候補なし: ${noNameCandidates}件`);
  console.log(`栄養素マッチなし: ${noNutrientMatch}件`);
  console.log(`平均候補数: ${avgCandidates.toFixed(1)}件`);
  console.log(`平均マッチ栄養素数: ${avgMatchedNutrients.toFixed(1)}種`);

  console.log(`\n出力: ${outputPath}`);
}

main().catch(console.error);
