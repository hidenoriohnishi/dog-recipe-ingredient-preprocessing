import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getGroupKey, type StructuredFoodName } from "../02-food-name-normalize/food-name-scheme.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");
const mextFile = join(
  __dirname,
  "../10-1-recipe-ingredient-mark/result/final-nutrition-with-recipe-flag.csv"
);
const cookingLabelsFile = join(resultDir, "cooking-labels.json");
const variationStatsFile = join(resultDir, "variation-stats.json");
const outputFile = join(resultDir, "final-nutrition-with-cooking-variations.csv");

// =====================================================
// 調理ラベルの定義
// =====================================================

/**
 * 調理工程ラベル
 */
type CookingLabel = "RAW" | "DRAINED" | "SOUPED" | "STEAMED" | "SEARED" | "FRIED" | "FOOD_STATE";

/**
 * MEXT項目から調理ラベルへのマッピング
 */
const MEXT_TO_LABEL: Record<string, CookingLabel> = {
  // RAW: 非加熱の状態
  "生": "RAW",

  // FOOD_STATE: 加工・保存処理がなされた状態（起点として使用）
  "冷凍": "FOOD_STATE",
  "乾": "FOOD_STATE",
  "素干し": "FOOD_STATE",
  "乾燥": "FOOD_STATE",
  "煮干し": "FOOD_STATE",
  "丸干し": "FOOD_STATE",
  "水煮缶詰": "FOOD_STATE",
  "缶詰": "FOOD_STATE",
  "塩漬": "FOOD_STATE",
  "ぬかみそ漬": "FOOD_STATE",

  // DRAINED: 水中で加熱し、ゆで汁を分離
  "ゆで": "DRAINED",
  "塩抜き": "DRAINED",
  "水戻し": "DRAINED",

  // SOUPED: 水中で加熱し、汁ごと摂取
  "水煮": "SOUPED",
  "浸出液": "SOUPED",

  // STEAMED: 蒸気または電磁波で加熱
  "蒸し": "STEAMED",
  "電子レンジ調理": "STEAMED",

  // SEARED: 乾熱または少量の油で加熱
  "焼き": "SEARED",
  "油いため": "SEARED",
  "ソテー": "SEARED",
  "いり": "SEARED",
  "くん製": "SEARED",

  // FRIED: 油中で高温加熱
  "素揚げ": "FRIED",
  "フライ": "FRIED",
};

/**
 * 調理ラベルの説明
 */
const LABEL_DESCRIPTIONS: Record<CookingLabel, { ja: string; description: string }> = {
  "RAW": {
    ja: "調理なし",
    description: "非加熱の状態。食材本来の水分・栄養価を100%（基準）とする。"
  },
  "DRAINED": {
    ja: "茹でる（捨てる）",
    description: "水中で加熱し、ゆで汁を分離する工程。水溶性栄養素（カリウム・ビタミンB/C）が最大流出する。"
  },
  "SOUPED": {
    ja: "茹でる（使う）",
    description: "水中で加熱し、汁ごと摂取する工程。栄養は汁に溶け出すが回収される。加水により栄養密度は下がる。"
  },
  "STEAMED": {
    ja: "蒸す（レンジ）",
    description: "蒸気または電磁波で加熱する工程。水への溶出がなく、熱分解のみ。RAWに最も近い組成を維持。"
  },
  "SEARED": {
    ja: "焼く・炒める",
    description: "乾熱または少量の油で加熱する工程。水分が蒸発し栄養が濃縮される。脂溶性ビタミンも保持。"
  },
  "FRIED": {
    ja: "揚げる（素揚げ）",
    description: "油中で高温加熱し、油を切る工程。水分が抜け、代わりに油が浸透する。脂溶性が油側に逃げる。"
  },
  "FOOD_STATE": {
    ja: "加工済み状態",
    description: "乾物、缶詰、冷凍、漬物、干物など、すでに加工・保存処理がなされた状態。計算の起点として使用。"
  },
};

// =====================================================
// 型定義
// =====================================================

interface MEXTFood {
  food_number: string;
  food_name: string;
  structured_food_name?: string;
  rawRecord: string[];
}

interface CookingVariation {
  [label: string]: string[]; // label -> food_numbers
}

// =====================================================
// CSV パース
// =====================================================

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

// =====================================================
// ユーティリティ関数
// =====================================================

/**
 * structured_food_nameからStructuredFoodNameを取得
 */
function parseStructuredName(
  structuredName?: string
): StructuredFoodName | null {
  if (!structuredName) return null;

  try {
    const parsed = JSON.parse(structuredName);
    return parsed as StructuredFoodName;
  } catch {
    return null;
  }
}

/**
 * MEXT項目から調理ラベルを取得
 */
function getCookingLabel(mextState?: string): CookingLabel | null {
  if (!mextState) return null;
  return MEXT_TO_LABEL[mextState] || null;
}

function escapeCSVField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return field;
}

// =====================================================
// メイン処理
// =====================================================

async function loadMEXTFoods(): Promise<{ headers: string[]; foods: MEXTFood[] }> {
  const content = await readFile(mextFile, "utf-8");
  const records = parseCSVRecords(content);

  if (records.length === 0) {
    throw new Error("MEXTデータが空です");
  }

  const headers = records[0];
  const foodNumberIndex = headers.indexOf("food_number");
  const foodNameIndex = headers.indexOf("food_name");
  const structuredIndex = headers.indexOf("structured_food_name");

  if (foodNumberIndex === -1 || foodNameIndex === -1) {
    throw new Error("MEXTデータに必要な列が見つかりません");
  }

  const foods: MEXTFood[] = records.slice(1).map((row) => ({
    food_number: row[foodNumberIndex] || "",
    food_name: row[foodNameIndex] || "",
    structured_food_name:
      structuredIndex !== -1 ? row[structuredIndex] || undefined : undefined,
    rawRecord: row,
  }));

  return { headers, foods };
}

/**
 * 調理状態バリエーションを生成
 */
function generateCookingVariations(
  foods: MEXTFood[]
): {
  variations: Map<string, CookingVariation>;
  labels: Map<string, CookingLabel>;
  stats: {
    totalFoods: number;
    foodsWithLabel: number;
    groupCount: number;
    groupsWithVariations: number;
    labelCounts: Record<string, number>;
    variationPatterns: Record<string, number>;
  };
} {
  // 各食品の調理ラベルを取得
  const labels = new Map<string, CookingLabel>();
  const labelCounts: Record<string, number> = {};

  for (const food of foods) {
    const parsed = parseStructuredName(food.structured_food_name);
    if (!parsed) continue;

    const label = getCookingLabel(parsed.state);
    if (label) {
      labels.set(food.food_number, label);
      labelCounts[label] = (labelCounts[label] || 0) + 1;
    }
  }

  // getGroupKeyを使用してグループ化（stateを除く）
  const groups = new Map<string, MEXTFood[]>();

  for (const food of foods) {
    const parsed = parseStructuredName(food.structured_food_name);
    if (!parsed || !parsed.baseName) continue;

    // 調理ラベルがある食品のみグループ化
    if (!labels.has(food.food_number)) continue;

    const groupKey = getGroupKey(parsed);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(food);
  }

  // 各グループ内で調理状態のバリエーションを生成
  const variations = new Map<string, CookingVariation>();
  const variationPatterns: Record<string, number> = {};
  let groupsWithVariations = 0;

  for (const [, groupFoods] of groups) {
    // 調理ラベルごとに食品を分類
    const labelMap = new Map<CookingLabel, string[]>(); // label -> food_numbers

    for (const food of groupFoods) {
      const label = labels.get(food.food_number);
      if (!label) continue;

      if (!labelMap.has(label)) {
        labelMap.set(label, []);
      }
      labelMap.get(label)!.push(food.food_number);
    }

    // 複数の調理ラベルがある場合のみ、相互参照を生成
    if (labelMap.size > 1) {
      groupsWithVariations++;

      // パターンを記録
      const patternLabels = Array.from(labelMap.keys()).sort();
      const pattern = patternLabels.join(" + ");
      variationPatterns[pattern] = (variationPatterns[pattern] || 0) + 1;

      for (const food of groupFoods) {
        const currentLabel = labels.get(food.food_number);
        if (!currentLabel) continue;

        const variation: CookingVariation = {};

        // 他の調理ラベルへの参照を追加
        for (const [otherLabel, otherFoodNumbers] of labelMap) {
          if (otherLabel !== currentLabel) {
            variation[otherLabel] = otherFoodNumbers;
          }
        }

        if (Object.keys(variation).length > 0) {
          variations.set(food.food_number, variation);
        }
      }
    }
  }

  return {
    variations,
    labels,
    stats: {
      totalFoods: foods.length,
      foodsWithLabel: labels.size,
      groupCount: groups.size,
      groupsWithVariations,
      labelCounts,
      variationPatterns,
    },
  };
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  // MEXTデータを読み込み
  console.log("MEXTデータを読み込んでいます...");
  const { headers, foods } = await loadMEXTFoods();
  console.log(`MEXTデータ: ${foods.length}件`);

  // 調理ラベルの定義を保存
  console.log("\n=== 調理ラベルの定義を保存 ===");
  const cookingLabelsData = {
    labels: LABEL_DESCRIPTIONS,
    mapping: MEXT_TO_LABEL,
  };
  await writeFile(
    cookingLabelsFile,
    JSON.stringify(cookingLabelsData, null, 2),
    "utf-8"
  );
  console.log(`調理ラベル定義を保存: ${cookingLabelsFile}`);

  // 調理状態バリエーションの生成
  console.log("\n=== 調理状態バリエーションの生成 ===");
  const { variations, labels, stats } = generateCookingVariations(foods);

  console.log(`総食品数: ${stats.totalFoods}件`);
  console.log(`調理ラベルがある食品: ${stats.foodsWithLabel}件`);
  console.log(`グループ数: ${stats.groupCount}`);
  console.log(`バリエーションがあるグループ: ${stats.groupsWithVariations}`);
  console.log(`バリエーションが検出された食品: ${variations.size}件`);

  console.log("\n調理ラベル別件数:");
  for (const [label, count] of Object.entries(stats.labelCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${count}件`);
  }

  console.log("\nバリエーションパターン（上位10件）:");
  const sortedPatterns = Object.entries(stats.variationPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${pattern}: ${count}グループ`);
  }

  // 統計情報を保存
  await writeFile(
    variationStatsFile,
    JSON.stringify(stats, null, 2),
    "utf-8"
  );
  console.log(`\n統計情報を保存: ${variationStatsFile}`);

  // CSV出力
  console.log("\n=== CSV出力 ===");
  const newHeaders = [...headers, "cooking_label", "cooking_variations"];
  const outputRows: string[][] = [];

  // ヘッダー行
  outputRows.push(newHeaders.map(escapeCSVField));

  // データ行
  for (const food of foods) {
    const label = labels.get(food.food_number) || "";
    const variation = variations.get(food.food_number);
    const variationJson = variation ? JSON.stringify(variation) : "";

    const newRow = [...food.rawRecord, label, variationJson];
    outputRows.push(newRow.map(escapeCSVField));
  }

  // CSVファイルに書き込み
  const csvContent = outputRows.map((row) => row.join(",")).join("\n");
  await writeFile(outputFile, csvContent, "utf-8");
  console.log(`結果を保存: ${outputFile}`);

  console.log("\n処理が完了しました！");
}

main().catch((error) => {
  console.error("エラーが発生しました:", error);
  process.exit(1);
});
