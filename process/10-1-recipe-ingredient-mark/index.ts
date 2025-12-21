import dotenv from "dotenv";
import { mkdir, readFile, writeFile, appendFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  calculateCost,
  formatCost,
  type CostResult,
} from "../../utils/cost-calculator.js";
import { z } from "zod";

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
const MODEL_NAME = "gpt-5-mini-2025-08-07";

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
  labelPaths: string[];
  reason: string;
}

interface LabelMatcher {
  pathString: string;
  normalizedKeywords: string[];
}

interface Progress {
  processedFoodNumbers: string[];
  headerWritten: boolean;
}

const EXTRA_COLUMNS = [
  "recipe_ai_reason",
  "is_recipe_ingredient",
  "recipe_label_paths",
];

const evaluationSchema = z.object({
  index: z
    .number()
    .int()
    .describe("1から始まる食品のバッチ内インデックス"),
  reason: z
    .string()
    .min(1)
    .describe(
      "まず理由を書き、どのラベルに該当する/しないかを説明する。一般的な食材を優先する意図も明記する"
    ),
  matched_label_paths: z
    .array(z.string().min(1))
    .describe(
      "一致したラベルの階層パスを『カテゴリ > ... > ラベル』形式で1〜3件まで列挙する。該当しない場合も空配列を必ず返す"
    ),
});

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
  return labels
    .map((label) => {
      const displayNames = label.ingredientNames.slice(0, 5);
      const hasMore = label.ingredientNames.length > 5;
      const ingredientList = displayNames
        .map((name, idx) => `  ${idx + 1}. ${name}`)
        .join("\n");
      const suffix = hasMore
        ? `\n  ...等（全${label.ingredientNames.length}件）`
        : "";
      return `ラベルID: ${label.id}\n階層パス: ${label.path.join(
        " > "
      )}\nサンプル食材:\n${ingredientList}${suffix}`;
    })
    .join("\n\n");
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[ー―−‐]/g, "-");
}

function buildLabelMatchers(labels: IngredientLabel[]): LabelMatcher[] {
  const matchers: LabelMatcher[] = [];

  for (const label of labels) {
    const keywords = new Set<string>();
    const leafName = label.path[label.path.length - 1];
    if (leafName) {
      keywords.add(leafName);
    }

    for (const segment of label.path) {
      if (segment) {
        keywords.add(segment);
      }
    }
    for (const name of label.ingredientNames) {
      if (name) {
        keywords.add(name);
      }
    }

    const normalizedKeywords = Array.from(keywords)
      .map((keyword) => normalizeForMatch(keyword))
      .filter((keyword) => keyword.length > 0);

    matchers.push({
      pathString: label.path.join(" > "),
      normalizedKeywords,
    });
  }

  return matchers;
}

function inferLabelPathsFromReason(
  reason: string,
  matchers: LabelMatcher[],
  limit: number = 3
): string[] {
  const normalizedReason = normalizeForMatch(reason || "");
  if (!normalizedReason) {
    return [];
  }

  const matches: string[] = [];
  for (const matcher of matchers) {
    if (
      matcher.normalizedKeywords.some(
        (keyword) => keyword && normalizedReason.includes(keyword)
      )
    ) {
      matches.push(matcher.pathString);
      if (matches.length >= limit) {
        break;
      }
    }
  }

  return matches;
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
あなたは犬用レシピの食材キュレーターです。以下のMEXT食品が、犬のレシピで日常的によく使われる食材ラベル（ingredients-structured.jsonの最下層ラベル）に該当するか判定してください。目的は、将来のレシピ生成時にAIが主要な食材を優先的に選べるようにすることです。一般的で入手しやすい食材は積極的にラベル付けし、極端にマイナーな食材は慎重に扱ってください。

## ラベル一覧
${labelListString}

## 判定対象
${foodListString}

## 判定手順
1. まず理由を考え、どのラベルに一致する/しないのかを文章で説明する。
2. 理由で「このラベルに該当する」「〇〇カテゴリの典型的食材」など肯定した場合は、そのラベルの階層パス（"カテゴリ > ... > ラベル"）を1〜3件挙げる。否定の場合は空配列のままにする。
3. 調理状態や乾燥/ゆでなどの差は無視してよい。同じ食材と判断できるなら肯定する。ただし極端に稀な/入手困難な食材は慎重に扱う。
4. 出力では reason を最初に書き、続いて matched_label_paths を記載する。必ず matched_label_paths を出力し、該当ラベルが無ければ空配列 [] を返す。配列に1件以上あれば、その食品はレシピ実績食材（TRUE）とみなす。

## 出力形式
\`\`\`
[
  {
    "index": 1,
    "reason": "にんじんの一種のため",
    "matched_label_paths": ["野菜 > 根菜類 > にんじん"]
  }
]
\`\`\`
`;

  try {
    const response = await generateObject({
      model: openai(MODEL_NAME),
      prompt,
      temperature: 0,
      schema: z.object({
        evaluations: z
          .array(evaluationSchema)
          .describe("バッチ内の各食品に対する判定結果"),
      }),
    });

    const inputTokens = response.usage?.promptTokens || 0;
    const outputTokens = response.usage?.completionTokens || 0;
    const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
    console.log(formatCost(cost));
    if (response.object.evaluations.length > 0) {
      console.log(
        `AI出力サンプル: ${JSON.stringify(
          response.object.evaluations[0]
        )}`
      );
    }

    const results: MappingResult[] = [];

    for (const evaluation of response.object.evaluations) {
      const indexValue = Number(evaluation.index);
      if (!Number.isFinite(indexValue)) {
        continue;
      }

      const item = batchFoods.find((bf) => bf.batchIndex === indexValue);
      if (!item) {
        continue;
      }

      const labelPathsRaw = evaluation.matched_label_paths || [];
      const labelPaths = Array.isArray(labelPathsRaw)
        ? labelPathsRaw.map((value) => String(value)).filter((value) => value.trim())
        : [];

      results.push({
        foodNumber: item.food.food_number,
        labelPaths,
        reason: evaluation.reason || "",
      });
    }

    return { results, cost };
  } catch (error) {
    console.error("AI処理でエラーが発生しました", error);
    return {
      results: batchFoods.map((bf) => ({
        foodNumber: bf.food.food_number,
        labelPaths: [],
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

function buildLabelPathSet(labels: IngredientLabel[]): Set<string> {
  return new Set(labels.map((label) => label.path.join(" > ")));
}

function normalizeLabelPaths(paths: string[], validPaths: Set<string>): string[] {
  const cleaned = paths
    .map((path) => path.replace(/\s+/g, " ").trim())
    .filter((path) => validPaths.has(path));
  return Array.from(new Set(cleaned)).slice(0, 3);
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
  const validLabelPaths = buildLabelPathSet(labels);
  const labelMatchers = buildLabelMatchers(labels);

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

  for (let i = 0; i < unprocessedFoods.length; i += BATCH_SIZE) {
    const batchFoodsRaw = unprocessedFoods.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

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
      const labelPaths = evaluation
        ? normalizeLabelPaths(evaluation.labelPaths, validLabelPaths)
        : [];
      const reason = evaluation?.reason || "";
      const inferredPaths = labelPaths.length > 0
        ? labelPaths
        : inferLabelPathsFromReason(reason, labelMatchers);
      const isRecipeIngredient = inferredPaths.length > 0;

      const rowValues = [...bf.food.rawRecord];
      rowValues.push(
        reason,
        isRecipeIngredient ? "TRUE" : "FALSE",
        inferredPaths.join(" | ")
      );

      rowsToAppend.push(serializeCsvRow(rowValues));
      batchResultOutput.push({
        reason,
        foodNumber: bf.food.food_number,
        foodName: bf.food.food_name,
        isRecipeIngredient,
        labelPaths: inferredPaths,
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
