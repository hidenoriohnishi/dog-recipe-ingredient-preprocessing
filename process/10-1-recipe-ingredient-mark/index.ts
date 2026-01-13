import dotenv from "dotenv";
import { mkdir, readFile, writeFile, appendFile, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  calculateCost,
  formatCost,
  type CostResult,
} from "../../utils/cost-calculator.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");
const batchResultsDir = join(resultDir, "batch-results");
const ingredientsFile = join(__dirname, "../10-0/ingredients-structured.json");
const mextFile = join(
  __dirname,
  "../09-3-ai-select/result/final-nutrition.csv"
);
const progressFile = join(resultDir, "progress.json");
const outputFile = join(resultDir, "final-nutrition-with-recipe-flag.csv");

const BATCH_SIZE = 20;
const MODEL_NAME = "gpt-4.1-2025-04-14";

// Zodスキーマ定義（Chain of Thought: reasonを先に）
const FoodEvaluationSchema = z.object({
  index: z.number().int().positive(),
  reason: z.string().describe("判定理由（推論プロセス）"),
  decision: z.enum(["MATCH", "NOMATCH"]).describe("reasonに基づく判定結果"),
  matched_label_path: z.string().describe("該当ラベルパス。NOMATCHの場合は空文字列"),
});

const FoodEvaluationsSchema = z.object({
  evaluations: z.array(FoodEvaluationSchema),
});

interface IngredientLabel {
  id: string;
  path: string[];
  ingredientNames: string[];
}

interface MEXTFood {
  food_number: string;
  food_name: string;
  structured_food_name?: string;
  search_keys?: string;
  tag_name_ja?: string;
  tag_name_ja_detail?: string;
  tag_name_en?: string;
  tag_name_en_detail?: string;
  reason?: string;
  rawRecord: string[];
}

interface BatchFood {
  batchIndex: number;
  food: MEXTFood;
}

interface MappingResult {
  foodNumber: string;
  decision: "MATCH" | "NOMATCH";
  labelPath: string;
  reason: string;
}

interface Progress {
  processedFoodNumbers: string[];
  headerWritten: boolean;
}

const EXTRA_COLUMNS = ["is_recipe_ingredient", "recipe_label_path"];

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, "utf-8");
    const parsed = JSON.parse(content);
    return {
      processedFoodNumbers: parsed.processedFoodNumbers || [],
      headerWritten: Boolean(parsed.headerWritten),
    };
  } catch {
    return {
      processedFoodNumbers: [],
      headerWritten: false,
    };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), "utf-8");
}

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
  const searchKeysIndex = headers.indexOf("search_keys");
  const tagJaIndex = headers.indexOf("tag_name_ja");
  const tagJaDetailIndex = headers.indexOf("tag_name_ja_detail");
  const tagEnIndex = headers.indexOf("tag_name_en");
  const tagEnDetailIndex = headers.indexOf("tag_name_en_detail");
  const reasonIndex = headers.indexOf("reason");

  if (foodNumberIndex === -1 || foodNameIndex === -1) {
    throw new Error("MEXTデータに必要な列が見つかりません");
  }

  const foods: MEXTFood[] = records.slice(1).map((row) => ({
    food_number: row[foodNumberIndex] || "",
    food_name: row[foodNameIndex] || "",
    structured_food_name:
      structuredIndex !== -1 ? row[structuredIndex] || undefined : undefined,
    search_keys: searchKeysIndex !== -1 ? row[searchKeysIndex] || undefined : undefined,
    tag_name_ja: tagJaIndex !== -1 ? row[tagJaIndex] || undefined : undefined,
    tag_name_ja_detail:
      tagJaDetailIndex !== -1 ? row[tagJaDetailIndex] || undefined : undefined,
    tag_name_en: tagEnIndex !== -1 ? row[tagEnIndex] || undefined : undefined,
    tag_name_en_detail:
      tagEnDetailIndex !== -1 ? row[tagEnDetailIndex] || undefined : undefined,
    reason: reasonIndex !== -1 ? row[reasonIndex] || undefined : undefined,
    rawRecord: row,
  }));

  return { headers, foods };
}

function extractLabels(
  obj: any,
  path: string[] = [],
  list: IngredientLabel[] = []
): IngredientLabel[] {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    if (Array.isArray(value)) {
      list.push({
        id: `label-${String(list.length + 1).padStart(6, "0")}`,
        path: currentPath,
        ingredientNames: value as string[],
      });
    } else if (value && typeof value === "object") {
      extractLabels(value, currentPath, list);
    }
  }

  return list;
}

function generateLabelListString(labels: IngredientLabel[]): string {
  // 簡潔に: 各ラベルの代表的な食材のみをリスト化
  return labels
    .map((label) => {
      const path = label.path.join(" > ");
      const samples = label.ingredientNames.slice(0, 3).join(", ");
      const count = label.ingredientNames.length;
      return `- ${path}: ${samples}${count > 3 ? ` 他${count - 3}件` : ""}`;
    })
    .join("\n");
}

function parseSearchKeys(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter((item) => item.trim())
      : [];
  } catch {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value);
  }
}

function buildFoodListString(batchFoods: BatchFood[]): string {
  return batchFoods
    .map(({ batchIndex, food }) => {
      const searchTerms = parseSearchKeys(food.search_keys || "");
      const searchLine = searchTerms.length
        ? `\n  検索キー: ${searchTerms.join(", ")}`
        : "";
      const structuredLine = food.structured_food_name
        ? `\n  構造化名称: ${food.structured_food_name}`
        : "";
      const tagJaLine = food.tag_name_ja
        ? `\n  タグ: ${food.tag_name_ja}${food.tag_name_ja_detail ? ` (${food.tag_name_ja_detail})` : ""}`
        : "";
      const tagEnLine = food.tag_name_en
        ? `\n  Tag(EN): ${food.tag_name_en}${food.tag_name_en_detail ? ` (${food.tag_name_en_detail})` : ""}`
        : "";
      const reasonLine = food.reason ? `\n  コメント: ${food.reason}` : "";

      return `${batchIndex}. 食品番号: ${food.food_number}\n  食品名: ${food.food_name}${structuredLine}${tagJaLine}${tagEnLine}${searchLine}${reasonLine}`;
    })
    .join("\n\n");
}

async function mapFoods(
  batchFoods: BatchFood[],
  labelListString: string
): Promise<{ results: MappingResult[]; cost: CostResult | null }> {
  if (batchFoods.length === 0) {
    return { results: [], cost: null };
  }

  const foodListString = buildFoodListString(batchFoods);

  const prompt = `
## 目的
犬のレシピ生成システムで「よく使われる食材」と「あまり使われない食材」を区別するため、MEXT食品が実績リストに含まれるかを判定します。
これはレシピ提案時に「典型的な食材」を優先的に提案できるようにするためのフラグ付けです。
実績リストの食材ラベルの全体を眺めて、その粒度を確認し、各MEXT食品が適切な粒度の食材ラベルを選択するようにしてください。

## 実績リスト（過去のレシピで実際に使われた食材ラベル）
形式: "- {階層パス（=食材ラベル）}: {ユーザによって実際に書かれた食材名1}, {ユーザによって実際に書かれた食材名2}, {ユーザによって実際に書かれた食材名3} 他{N}件"
--------------------------------
${labelListString}
--------------------------------

## 判定対象のMEXT食品
${foodListString}

## 判定ルール
- MEXT食品が上記の実績リストに「存在する食材ラベル」に該当する食材の場合はMATCH
- 実績リストにない食材ラベルを新たに作成してはならない
- もし迷った場合は、その食品が郊外の中規模のスーパーマーケットなどで手に入るかを参考にしてください。手に入る場合は食材がラベルに該当することが多いです。

## 出力形式
1. reason: 判定理由を簡潔に
2. decision: "MATCH" または "NOMATCH"
3. matched_label_path: MATCHの場合は実績リストに存在するラベルパスをそのまま記載、NOMATCHの場合は空文字列 ""
`;

  try {
    const response = await generateObject({
      model: openai(MODEL_NAME),
      schema: FoodEvaluationsSchema,
      mode: 'json',
      prompt,
    });

    // AI SDKの標準的なusage構造を使用
    const inputTokens = response.usage?.inputTokens || 0;
    const outputTokens = response.usage?.outputTokens || 0;
    const reasoningTokens = response.usage?.outputTokenDetails?.reasoningTokens || 0;

    if (reasoningTokens > 0) {
      console.log(`トークン: 入力=${inputTokens}, 出力=${outputTokens} (推論=${reasoningTokens}含む)`);
    }

    const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
    console.log(formatCost(cost));

    const evaluations = response.object.evaluations;
    console.log(`AI出力: ${evaluations.length}件の評価を取得`);

    const results: MappingResult[] = [];

    for (const evaluation of evaluations) {
      const item = batchFoods.find((bf) => bf.batchIndex === evaluation.index);
      if (!item) {
        console.warn(`警告: index ${evaluation.index} に該当する食品が見つかりません`);
        continue;
      }

      results.push({
        foodNumber: item.food.food_number,
        decision: evaluation.decision,
        labelPath: evaluation.matched_label_path?.trim() || "",
        reason: evaluation.reason,
      });
    }

    return { results, cost };
  } catch (error) {
    console.error("AI処理でエラーが発生しました", error);
    return {
      results: batchFoods.map((bf) => ({
        foodNumber: bf.food.food_number,
        decision: "NOMATCH" as const,
        labelPath: "",
        reason: `ERROR: ${String(error)}`,
      })),
      cost: null,
    };
  }
}

function serializeCsvValue(value: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  const needsQuotes = /[",\n\r]/.test(value);
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function serializeCsvRow(values: string[]): string {
  return values.map(serializeCsvValue).join(",");
}

async function appendRows(rows: string[]): Promise<void> {
  if (rows.length === 0) return;
  await appendFile(outputFile, rows.join("\n") + "\n", "utf-8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureHeader(headers: string[], progress: Progress): Promise<void> {
  const exists = await fileExists(outputFile);

  if (!exists) {
    const headerRow = serializeCsvRow([...headers, ...EXTRA_COLUMNS]) + "\n";
    await writeFile(outputFile, headerRow, "utf-8");
    progress.headerWritten = true;
    await saveProgress(progress);
    return;
  }

  if (!progress.headerWritten) {
    progress.headerWritten = true;
    await saveProgress(progress);
  }
}

async function main() {
  await mkdir(resultDir, { recursive: true });
  await mkdir(batchResultsDir, { recursive: true });

  console.log("レシピ実績食材のマーキングを開始します...");

  const progress = await loadProgress();
  const ingredientsContent = await readFile(ingredientsFile, "utf-8");
  const ingredientsData = JSON.parse(ingredientsContent);
  const labels = extractLabels(ingredientsData);
  const labelListString = generateLabelListString(labels);

  const { headers, foods } = await loadMEXTFoods();
  console.log(`MEXT食品数: ${foods.length}`);

  await ensureHeader(headers, progress);

  const processedSet = new Set(progress.processedFoodNumbers);
  const unprocessedFoods = foods.filter(
    (food) => food.food_number && !processedSet.has(food.food_number)
  );

  if (unprocessedFoods.length === 0) {
    console.log("すべての食品が処理済みです。");
    return;
  }

  console.log(`未処理食品: ${unprocessedFoods.length}`);

  let totalCost: CostResult | null = null;
  const alreadyProcessedBatches = Math.floor(processedSet.size / BATCH_SIZE);

  for (let i = 0;i < unprocessedFoods.length;i += BATCH_SIZE) {
    const batchFoodsRaw = unprocessedFoods.slice(i, i + BATCH_SIZE);
    const batchNumber = alreadyProcessedBatches + Math.floor(i / BATCH_SIZE) + 1;

    const batchFoods: BatchFood[] = batchFoodsRaw.map((food, idx) => ({
      batchIndex: idx + 1,
      food,
    }));

    console.log(
      `バッチ ${batchNumber}/${Math.ceil(unprocessedFoods.length / BATCH_SIZE)} を処理中...`
    );

    const { results, cost } = await mapFoods(batchFoods, labelListString);

    if (cost) {
      if (totalCost) {
        totalCost.inputTokens += cost.inputTokens;
        totalCost.outputTokens += cost.outputTokens;
        totalCost.inputCostUSD += cost.inputCostUSD;
        totalCost.outputCostUSD += cost.outputCostUSD;
        totalCost.totalCostUSD += cost.totalCostUSD;
        totalCost.totalCostJPY += cost.totalCostJPY;
      } else {
        totalCost = { ...cost };
      }
    }

    const rowsToAppend: string[] = [];
    const batchResultOutput = [];

    for (const bf of batchFoods) {
      const evaluation = results.find((r) => r.foodNumber === bf.food.food_number);
      const isRecipeIngredient = evaluation?.decision === "MATCH";
      const labelPath = evaluation?.labelPath || "";

      const rowValues = [...bf.food.rawRecord];
      rowValues.push(isRecipeIngredient ? "TRUE" : "FALSE");
      rowValues.push(labelPath);

      rowsToAppend.push(serializeCsvRow(rowValues));
      batchResultOutput.push({
        foodNumber: bf.food.food_number,
        foodName: bf.food.food_name,
        isRecipeIngredient,
        reason: evaluation?.reason || "",
        labelPath,
      });
    }

    await appendRows(rowsToAppend);

    const batchFile = join(batchResultsDir, `batch-${batchNumber}.json`);
    await writeFile(
      batchFile,
      JSON.stringify(
        {
          batchNumber,
          timestamp: new Date().toISOString(),
          results: batchResultOutput,
        },
        null,
        2
      ),
      "utf-8"
    );

    for (const food of batchFoodsRaw) {
      processedSet.add(food.food_number);
      progress.processedFoodNumbers.push(food.food_number);
    }
    await saveProgress(progress);

    // 1秒待機してAPI負荷を軽減
    if (i + BATCH_SIZE < unprocessedFoods.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (totalCost) {
    console.log("\n=== 総料金 ===");
    console.log(formatCost(totalCost));
  }

  console.log("処理が完了しました。");
  console.log(`結果ファイル: ${outputFile}`);
}

main().catch((error) => {
  console.error("処理中にエラーが発生しました", error);
  process.exitCode = 1;
});
