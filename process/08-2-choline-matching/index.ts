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
  "../07-normalize-headers/result/final-nutrition.csv"
);
const usdaFile = join(__dirname, "../08-1-usda-choline/result/usda-choline.csv");

// 出力ファイル
const mappingFile = join(resultDir, "choline-mapping.json");
const outputFile = join(resultDir, "final-with-choline.csv");
const progressFile = join(resultDir, "progress.json");

const BATCH_SIZE = 10;
const MODEL_NAME = "gpt-5-mini-2025-08-07";

// USDA食品データ
interface USDAFood {
  ndb_no: string;
  food_name: string;
  total_choline_mg: number;
}

// マッチング結果
interface MatchResult {
  mext_food_number: string;
  mext_food_name: string;
  usda_ndb_no: string | null;
  usda_food_name: string | null;
  total_choline_mg: number | null;
  match_reason: string;
}

interface Progress {
  processedFoodNumbers: string[];
}

// グローバルに保持するUSDAデータ
let usdaFoods: USDAFood[] = [];

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
 * USDAデータを読み込み
 */
async function loadUSDAData(): Promise<void> {
  const content = await readFile(usdaFile, "utf-8");
  const records = parseCSVRecords(content);

  usdaFoods = records.slice(1).map((row) => ({
    ndb_no: row[0],
    food_name: row[2]?.replace(/^"|"$/g, "") || "",
    total_choline_mg: parseFloat(row[3]) || 0,
  }));

  console.log(`USDAデータ読み込み完了: ${usdaFoods.length}件`);
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
 * USDA食品リストを生成（プロンプト用）
 */
function generateUSDAList(): string {
  return usdaFoods
    .map((f) => `${f.ndb_no}: ${f.food_name} (${f.total_choline_mg}mg)`)
    .join("\n");
}

/**
 * AIでマッチングを実行
 */
async function matchFoods(
  foods: Array<{
    batchIndex: number;
    foodNumber: string;
    foodName: string;
    tagNameEn: string;
    tagNameEnDetail: string;
  }>
): Promise<{ results: MatchResult[]; cost: CostResult | null }> {
  const foodList = foods
    .map((f) => {
      return `${f.batchIndex}. 食品番号: ${f.foodNumber}
  日本語名: ${f.foodName}
  英語名: ${f.tagNameEn}${f.tagNameEnDetail ? ` (${f.tagNameEnDetail})` : ""}`;
    })
    .join("\n\n");

  const usdaList = generateUSDAList();

  const prompt = `あなたは日本の食品（MEXT）とアメリカの食品データベース（USDA）をマッチングする専門家です。

## USDA食品リスト（NDB番号: 食品名 (コリン含有量mg/100g)）

${usdaList}

## マッチング対象のMEXT食品

${foodList}

## マッチの判断基準

- 同じ食材であること
- 部位が同じか近いこと
- 調理状態が異なっても可（コリン含有量は似ている）
- **原材料が異なるものは代替にしない**
  - 例: 大麦麺に卵麺を代替にしてはいけない（卵はコリンが多い）
  - 例: 小麦パスタに卵パスタを代替にしてはいけない
- マッチがない場合は無理に代替を探さずNO_MATCHとする

## 出力形式

\`\`\`json
[
  {"index": 1, "usda_ndb_no": "01123", "reason": "同じ卵の全卵"},
  {"index": 2, "usda_ndb_no": null, "reason": "NO_MATCH: 該当する食品がない"}
]
\`\`\`

各MEXT食品について、上記USDAリストから最適なマッチを見つけてください。`;

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

      const usdaFood = evaluation.usda_ndb_no
        ? usdaFoods.find((u) => u.ndb_no === evaluation.usda_ndb_no)
        : null;

      return {
        mext_food_number: food.foodNumber,
        mext_food_name: food.foodName,
        usda_ndb_no: evaluation.usda_ndb_no,
        usda_food_name: usdaFood?.food_name || null,
        total_choline_mg: usdaFood?.total_choline_mg || null,
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
        usda_ndb_no: null,
        usda_food_name: null,
        total_choline_mg: null,
        match_reason: "ERROR: " + String(error),
      })),
      cost: null,
    };
  }
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  // USDAデータを読み込み
  await loadUSDAData();

  // MEXTデータを読み込み
  console.log("MEXTデータを読み込んでいます...");
  const mextContent = await readFile(mextFile, "utf-8");
  const mextRecords = parseCSVRecords(mextContent);
  const mextHeaders = mextRecords[0];

  // カラムインデックスを取得
  const foodNumberIdx = mextHeaders.indexOf("food_number");
  const foodNameIdx = mextHeaders.indexOf("food_name");
  const tagNameEnIdx = mextHeaders.indexOf("tag_name_en");
  const tagNameEnDetailIdx = mextHeaders.indexOf("tag_name_en_detail");

  const mextDataRows = mextRecords.slice(1);
  console.log(`MEXTデータ: ${mextDataRows.length}件`);

  // 食品データを抽出
  const foods = mextDataRows.map((row) => ({
    foodNumber: row[foodNumberIdx] || "",
    foodName: row[foodNameIdx] || "",
    tagNameEn: row[tagNameEnIdx] || "",
    tagNameEnDetail: row[tagNameEnDetailIdx] || "",
  }));

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
          ...f,
        }));

      console.log(
        `\n処理中: ${i + 1}-${Math.min(i + BATCH_SIZE, unprocessedFoods.length)}件目`
      );
      console.log(
        `食品: ${batch.map((b) => b.tagNameEn || b.foodName.substring(0, 15)).join(", ")}`
      );

      // AIマッチング
      const result = await matchFoods(batch);

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

  // 統計
  const matchedCount = existingMapping.filter((m) => m.usda_ndb_no).length;
  console.log(`\n処理完了:`);
  console.log(`  マッチ: ${matchedCount}件`);
  console.log(`  NO_MATCH: ${existingMapping.length - matchedCount}件`);
  console.log(`  マッピング結果: ${mappingFile}`);
}

main().catch(console.error);
