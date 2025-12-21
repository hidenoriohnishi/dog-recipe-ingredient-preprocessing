import dotenv from "dotenv";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  calculateCost,
  formatCost,
  type CostResult,
} from "../../utils/cost-calculator.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, "result");

// 入力ファイル
const mextFile = join(
  __dirname,
  "../08-3-merge-choline/result/final-with-choline.csv"
);
const distanceFile = join(
  __dirname,
  "../09-2-pure-distance/result/distance-top20.json"
);
const usdaFoodsFile = join(
  __dirname,
  "../09-1-usda-normalize/result/usda-foods.json"
);

// 出力ファイル
const mappingFile = join(resultDir, "usda-mapping.json");
const outputFile = join(resultDir, "final-nutrition.csv");
const progressFile = join(resultDir, "progress.json");

const BATCH_SIZE = 10;
const MODEL_NAME = "gpt-5-mini-2025-08-07";

// 距離計算結果
interface DistanceData {
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

// USDA食品データ
interface USDAFood {
  fdc_id: string;
  description: string;
  food_category_id: string;
  nutrients: Record<string, { name: string; amount: number; unit: string }>;
}

// マッチング結果
interface MatchResult {
  mext_food_number: string;
  mext_food_name: string;
  usda_fdc_id: string | null;
  usda_description: string | null;
  distance: number | null;
  match_reason: string;
}

interface Progress {
  processedFoodNumbers: string[];
}

// グローバルに保持するデータ
let distanceData: Record<string, DistanceData> = {};
let usdaFoods: Record<string, USDAFood> = {};

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
 * 進捗を読み込み
 */
async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return { processedFoodNumbers: [] };
  }
}

/**
 * 進捗を保存
 */
async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * マッピング結果を読み込み
 */
async function loadMapping(): Promise<MatchResult[]> {
  try {
    const content = await readFile(mappingFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * マッピング結果を保存
 */
async function saveMapping(mapping: MatchResult[]): Promise<void> {
  await writeFile(mappingFile, JSON.stringify(mapping, null, 2), "utf-8");
}

/**
 * AIで最適候補を選定
 */
async function selectBestCandidate(
  foods: Array<{
    batchIndex: number;
    foodNumber: string;
    foodName: string;
    foodGroup: string;
    candidates: DistanceData["candidates"];
  }>
): Promise<{ results: MatchResult[]; cost: CostResult | null }> {
  const foodList = foods
    .map((f) => {
      const candidatesList = f.candidates
        .map(
          (c, idx) =>
            `  ${idx + 1}. ${c.description} (FDC ID: ${c.fdc_id})`
        )
        .join("\n");

      return `${f.batchIndex}. MEXT食品: ${f.foodName} (食品番号: ${f.foodNumber}, 食品群: ${f.foodGroup})
候補（同じカテゴリー内から選出）:
${candidatesList}`;
    })
    .join("\n\n");

  const prompt = `あなたは日本の食品（MEXT）とアメリカの食品データベース（USDA）をマッチングする専門家です。

## 目的

MEXTで足りていない栄養素（塩素（塩化物CHLORIDE）とCHOLIN）の量を推定するために、USDAから最も適切な食材を選定します。

## マッチング対象のMEXT食品と候補

${foodList}

## マッチの判断基準

**基本方針**: 食材として同一または近種のものだけをマッチさせてください。無理にマッチさせる必要はありません。

### 判断の優先順位

1. **食材としての同一性・近種性**（最優先）
   - 同じ食材であること（例: 米→rice、鶏肉→chicken、鮭→salmon）
   - 近種も可: 同じ科・属の食材（例: あじ→mackerel系、さけ→salmon系）
   - 同じ動物/植物の部位違いは可（例: 牛もも肉→beef round）

2. **調理状態の柔軟性**
   - 調理状態が異なっても可（raw/cooked/roasted/bakedなど）

3. **部位の柔軟性**
   - 同じ食材なら部位が異なっても可

4. **マッチしない場合（重要）**
   - **候補に同一または近種の食材がない場合は必ずNO_MATCHとする**
   - 例: しいたけ(mushroom)の候補にパプリカ(pepper)やポテトしかない → NO_MATCH
   - 例: きのこ類の候補に野菜しかない → NO_MATCH
   - 例: 魚の候補に別の種類の魚しかない場合でも、明らかに異なる魚種はNO_MATCH
   - 栄養価が近いだけでは不十分。食材として同一または近種であることが必須

## 出力形式

\`\`\`json
[
  {"index": 1, "fdc_id": "170683", "reason": "アマランサスとAmaranth grainは同じ食材"},
  {"index": 2, "fdc_id": "173725", "reason": "あじ類とmackerelは近種の魚"},
  {"index": 3, "fdc_id": null, "reason": "NO_MATCH: 候補にしいたけ(mushroom)に相当する食材がない"}
]
\`\`\`

各MEXT食品について、上記候補から**好意的に解釈して最も適切なもの**を1つ選んでください。正確な名前一致よりも、人が妥当と考えるクラスタリングを優先し、近種や類似食材も積極的に考慮してください。`;

  try {
    const result = await generateText({
      model: openai(MODEL_NAME),
      prompt,
      temperature: 0.1,
    });

    // トークン使用量と料金を計算
    const inputTokens = result.usage?.promptTokens || 0;
    const outputTokens = result.usage?.completionTokens || 0;
    const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
    console.log(formatCost(cost));

    // JSONを抽出
    const jsonMatch =
      result.text.match(/```json\s*([\s\S]*?)\s*```/) ||
      result.text.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      throw new Error("JSONが見つかりませんでした: " + result.text);
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const evaluations = JSON.parse(jsonText);

    // 結果を変換
    const results: MatchResult[] = evaluations.map((evaluation: any) => {
      const food = foods.find((f) => f.batchIndex === evaluation.index);
      if (!food) {
        throw new Error(
          `評価結果のindex ${evaluation.index}に対応する食品が見つかりません`
        );
      }

      const candidate = evaluation.fdc_id
        ? food.candidates.find((c) => c.fdc_id === evaluation.fdc_id)
        : null;

      return {
        mext_food_number: food.foodNumber,
        mext_food_name: food.foodName,
        usda_fdc_id: evaluation.fdc_id || null,
        usda_description: candidate?.description || null,
        distance: candidate?.distance || null,
        match_reason: evaluation.reason,
      };
    });

    return { results, cost };
  } catch (error) {
    console.error("AI処理エラー:", error);
    return {
      results: foods.map((f) => ({
        mext_food_number: f.foodNumber,
        mext_food_name: f.foodName,
        usda_fdc_id: null,
        usda_description: null,
        distance: null,
        match_reason: "ERROR: " + String(error),
      })),
      cost: null,
    };
  }
}

// USDA栄養素ID
const USDA_CHLORINE_ID = "1088"; // Chlorine, Cl
const USDA_CHOLINE_ID = "1180"; // Choline, total

/**
 * 最終CSVを生成
 */
async function generateFinalCSV(mapping: MatchResult[]): Promise<void> {
  console.log("\n最終CSVを生成しています...");

  // MEXTデータを読み込み
  const mextContent = await readFile(mextFile, "utf-8");
  const mextRecords = parseCSVRecords(mextContent);
  const mextHeaders = mextRecords[0];
  const mextRows = mextRecords.slice(1);

  // マッピングをMapに変換
  const mappingMap = new Map<string, MatchResult>();
  for (const m of mapping) {
    mappingMap.set(m.mext_food_number, m);
  }

  // 新しいヘッダー（USDA関連の列を追加）
  const newHeaders = [
    ...mextHeaders,
    "usda_fdc_id",
    "usda_description",
    "usda_match_distance",
    "usda_chlorine_mg",
    "usda_choline_mg",
  ];

  // データ行を拡張
  const extendedRows = mextRows.map((row) => {
    const foodNumber = row[mextHeaders.indexOf("food_number")] || "";
    const match = mappingMap.get(foodNumber);

    if (match && match.usda_fdc_id) {
      // USDAの栄養素データを取得
      const usdaFood = usdaFoods[match.usda_fdc_id];
      let chlorineValue = "";
      let cholineValue = "";

      if (usdaFood && usdaFood.nutrients) {
        const chlorineNutrient = usdaFood.nutrients[USDA_CHLORINE_ID];
        const cholineNutrient = usdaFood.nutrients[USDA_CHOLINE_ID];
        
        if (chlorineNutrient && chlorineNutrient.amount != null) {
          chlorineValue = chlorineNutrient.amount.toString();
        }
        if (cholineNutrient && cholineNutrient.amount != null) {
          cholineValue = cholineNutrient.amount.toString();
        }
      }

      return [
        ...row,
        match.usda_fdc_id,
        match.usda_description || "",
        match.distance?.toString() || "",
        chlorineValue,
        cholineValue,
      ];
    } else {
      return [...row, "", "", "", "", ""];
    }
  });

  // CSV出力
  const csvLines = [
    newHeaders.join(","),
    ...extendedRows.map((row) =>
      row.map((cell) => {
        const str = String(cell);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(",")
    ),
  ];

  await writeFile(outputFile, csvLines.join("\n"), "utf-8");
  console.log(`出力: ${outputFile}`);
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  // データを読み込み
  await loadDistanceData();
  await loadUSDAFoods();

  // MEXTデータを読み込み
  console.log("MEXTデータを読み込んでいます...");
  const mextContent = await readFile(mextFile, "utf-8");
  const mextRecords = parseCSVRecords(mextContent);
  const mextHeaders = mextRecords[0];

  // カラムインデックスを取得
  const foodNumberIdx = mextHeaders.indexOf("food_number");
  const foodNameIdx = mextHeaders.indexOf("food_name");

  const mextDataRows = mextRecords.slice(1);
  console.log(`MEXTデータ: ${mextDataRows.length}件`);

  // 距離データから食品リストを作成
  const foods = Object.values(distanceData)
    .filter((d) => d.candidates.length > 0)
    .map((d) => ({
      foodNumber: d.food_number,
      foodName: d.food_name,
      foodGroup: d.food_group,
      candidates: d.candidates,
    }));

  console.log(`候補がある食品: ${foods.length}件`);

  // 進捗とマッピング結果を読み込み
  const progress = await loadProgress();
  const existingMapping = await loadMapping();
  const processedSet = new Set(progress.processedFoodNumbers);

  console.log(`処理済み: ${processedSet.size}件`);

  // 未処理の食品をフィルタ
  const unprocessedFoods = foods.filter(
    (f) => !processedSet.has(f.foodNumber)
  );
  console.log(`未処理: ${unprocessedFoods.length}件`);

  if (unprocessedFoods.length === 0) {
    console.log("すべての食品が処理済みです。");
  } else {
    // バッチ処理
    let totalCostUSD = 0;
    for (let i = 0; i < unprocessedFoods.length; i += BATCH_SIZE) {
      const batch = unprocessedFoods
        .slice(i, i + BATCH_SIZE)
        .map((f, idx) => ({
          batchIndex: idx + 1,
          foodNumber: f.foodNumber,
          foodName: f.foodName,
          foodGroup: f.foodGroup,
          candidates: f.candidates,
        }));

      console.log(
        `\n処理中: ${i + 1}-${Math.min(i + BATCH_SIZE, unprocessedFoods.length)}件目`
      );
      console.log(
        `食品: ${batch.map((b) => b.foodName.substring(0, 20)).join(", ")}`
      );

      // AI選定
      const result = await selectBestCandidate(batch);

      // 結果を保存
      existingMapping.push(...result.results);
      for (const item of result.results) {
        processedSet.add(item.mext_food_number);
      }

      // ファイルに保存
      await saveMapping(existingMapping);
      progress.processedFoodNumbers = Array.from(processedSet);
      await saveProgress(progress);

      if (result.cost) {
        totalCostUSD += result.cost.totalCostUSD;
      }

      console.log(`完了: ${processedSet.size}/${foods.length}件処理済み`);

      // APIレート制限を考慮して待機
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`\n累計料金: $${totalCostUSD.toFixed(4)} (¥${(totalCostUSD * 150).toFixed(2)})`);
  }

  // 最終CSVを生成
  await generateFinalCSV(existingMapping);

  // 統計
  const matchedCount = existingMapping.filter((m) => m.usda_fdc_id).length;
  console.log(`\n処理完了:`);
  console.log(`  マッチ: ${matchedCount}件`);
  console.log(`  NO_MATCH: ${existingMapping.length - matchedCount}件`);
  console.log(`  マッピング結果: ${mappingFile}`);
  console.log(`  最終CSV: ${outputFile}`);
}

main().catch(console.error);
