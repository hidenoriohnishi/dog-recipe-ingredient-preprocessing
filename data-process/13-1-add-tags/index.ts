import dotenv from "dotenv";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { calculateCost, formatCost } from "../utils/cost-calculator.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, "result");
const batchesDir = join(resultDir, "batches");

// 入力・出力ファイル
const inputFile = join(
  __dirname,
  "../12-1-merge-additional-foods/result/final-nutrition-with-egg-shell.csv"
);
const outputFile = join(resultDir, "final-nutrition-with-tags.csv");
const progressFile = join(resultDir, "progress.json");

const MODEL_NAME = "gpt-4.1-2025-04-14";
const BATCH_SIZE = 30; // バッチサイズ
const OVERLAP_SIZE = 5; // オーバーラップサイズ

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

function escapeCSVField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return field;
}

// =====================================================
// 型定義
// =====================================================

interface Progress {
  processedFoodNumbers: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  lastBatchNumber: number;
}

interface FoodTagInfo {
  food_number: string;
  tag_name: string;
  diff: string;
  search_keywords: string[];
}

interface BatchResult {
  batchNumber: number;
  foods: FoodTagInfo[];
}

// =====================================================
// 進捗管理
// =====================================================

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      processedFoodNumbers: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      lastBatchNumber: 0,
    };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), "utf-8");
}

async function loadBatchResult(batchNumber: number): Promise<BatchResult | null> {
  try {
    const batchFile = join(batchesDir, `batch-${batchNumber}.json`);
    const content = await readFile(batchFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveBatchResult(batchResult: BatchResult): Promise<void> {
  const batchFile = join(batchesDir, `batch-${batchResult.batchNumber}.json`);
  await writeFile(batchFile, JSON.stringify(batchResult, null, 2), "utf-8");
}

// =====================================================
// AI処理
// =====================================================

async function processBatch(
  foods: Array<{ food_number: string; food_name: string; food_name_en: string }>,
  previousBatchResults: FoodTagInfo[] = [],
  previousBatchFoods: Array<{ food_number: string; food_name: string; food_name_en: string }> = []
): Promise<{
  results: FoodTagInfo[];
  inputTokens: number;
  outputTokens: number;
}> {
  // 前のバッチの結果を参考情報として含める
  let referenceInfo = "";
  if (previousBatchResults.length > 0 && previousBatchFoods.length > 0) {
    referenceInfo = `\n\n## 参考: 前のバッチの最後${previousBatchResults.length}件の結果\n`;
    referenceInfo += previousBatchResults
      .map((f, idx) => {
        const food = previousBatchFoods.find((food) => food.food_number === f.food_number);
        const foodName = food ? food.food_name : f.food_number;
        return `${idx + 1}. ${foodName} → タグネーム: "${f.tag_name}", 差分: "${f.diff}", サーチキーワード: ${f.search_keywords.join(", ")}`;
      })
      .join("\n");
    referenceInfo +=
      "\n\nこれらの結果を参考にして、一貫性のあるタグネームと差分を付けてください。";
  }

  const foodList = foods
    .map((f, idx) => `${idx + 1}. ${f.food_name}${f.food_name_en ? ` (${f.food_name_en})` : ""}`)
    .join("\n");

  const prompt = `日本の食品成分表データベースの食材に、ユーザー向けのタグ情報を付与してください。

## 出力フィールド

1. **tag_name（必須）**: ユーザーが最も自然に呼ぶ名前。短くシンプルに。
2. **diff（省略可）**: 同じtag_nameが複数ある時の区別用。調理法・部位・状態など。
3. **search_keywords（省略可）**: 検索用キーワード。漢字表記・別名・表記揺れなど。

## タグネームの付け方

- **基本**: 一般的な呼び名を使う（例：「鶏もも肉」「にんじん」「ごはん」）
- **加工品**: 独立したタグネームにする（「サバ缶」「ツナ缶」「かまぼこ」）
- **品種**: 一般的に別物として認識されるものは独立タグ（「伊予柑」「デコポン」）

## 差分の付け方

- 同じタグネームの食材が複数ある場合のみ付ける
- 最もベーシックな状態（生、皮なし等）は省略可
- 例：「焼き」「ゆで」「缶詰」「皮付き」「もも」「むね」

## サーチキーワードの付け方

- タグネームは自動で検索対象になるので含めない
- ひらがな⇔カタカナは自動変換されるので片方だけでOK
- 漢字表記（鯖、鶏、牛など）、別名、表記揺れを含める
- 該当するものがなければ省略

## 変換例

| 入力（food_name） | tag_name | diff | search_keywords |
|---|---|---|---|
| まさば　生 | さば | | ["鯖"] |
| まさば　焼き | さば | 焼き | ["鯖"] |
| さば類　缶詰　水煮 | サバ缶 | 水煮 | ["鯖缶"] |
| うんしゅうみかん　じょうのう　生 | みかん | 薄皮付き | |
| いよかん　砂じょう　生 | 伊予柑 | | ["いよかん"] |
| トマト　果実　生 | トマト | | |
| 鶏肉　もも　皮つき　生 | 鶏もも肉 | 皮付き | ["鶏肉","もも肉"] |
| 鶏肉　もも　皮なし　生 | 鶏もも肉 | 皮なし | ["鶏肉","もも肉"] |
| 鶏肉　もも　皮つき　焼き | 鶏もも肉 | 皮付き・焼き | ["鶏肉","もも肉"] |
| 精白米　うるち米 | 米 | 白米 | ["精白米","うるち米"] |
| 精白米　めし | ごはん | | ["白米","ライス"] |
${referenceInfo}

## 食材リスト

${foodList}

## 出力形式

JSON配列で出力。インデックスは1始まり。diffとsearch_keywordsは省略可。

\`\`\`json
[
  {"index": 1, "tag_name": "さば", "search_keywords": ["鯖"]},
  {"index": 2, "tag_name": "さば", "diff": "焼き", "search_keywords": ["鯖"]},
  {"index": 3, "tag_name": "サバ缶", "search_keywords": ["鯖缶"]},
  {"index": 4, "tag_name": "みかん", "diff": "温州みかん", "search_keywords": ["温州みかん"]},
  {"index": 5, "tag_name": "伊予柑", "search_keywords": ["いよかん"]},
  {"index": 6, "tag_name": "トマト"}
]
\`\`\``;

  const result = await generateText({
    model: openai(MODEL_NAME),
    prompt,
    temperature: 0.1,
  });

  const inputTokens = result.usage?.inputTokens || 0;
  const outputTokens = result.usage?.outputTokens || 0;

  // JSONを抽出
  const jsonMatch =
    result.text.match(/```json\s*([\s\S]*?)\s*```/) ||
    result.text.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    throw new Error("JSONが見つかりませんでした: " + result.text);
  }

  const jsonText = jsonMatch[1] || jsonMatch[0];
  const parsed = JSON.parse(jsonText);

  const results: FoodTagInfo[] = parsed.map((item: any) => {
    const food = foods[item.index - 1];
    if (!food) {
      throw new Error(`インデックス ${item.index} に対応する食品が見つかりません`);
    }
    return {
      food_number: food.food_number,
      tag_name: item.tag_name || "",
      diff: item.diff || "", // 省略可能
      search_keywords: Array.isArray(item.search_keywords)
        ? item.search_keywords
        : item.search_keywords
          ? [item.search_keywords]
          : [], // 省略可能
    };
  });

  return { results, inputTokens, outputTokens };
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });
  await mkdir(batchesDir, { recursive: true });

  console.log("=== 13-1: タグ情報の追加 ===\n");
  console.log(`使用モデル: ${MODEL_NAME}`);
  console.log(`バッチサイズ: ${BATCH_SIZE}, オーバーラップ: ${OVERLAP_SIZE}`);

  // CSVを読み込む
  console.log("\nCSVを読み込んでいます...");
  const csvContent = await readFile(inputFile, "utf-8");
  const records = parseCSVRecords(csvContent);

  if (records.length === 0) {
    throw new Error("入力CSVが空です");
  }

  const headers = records[0];
  const dataRows = records.slice(1);

  // ヘッダーのインデックスを取得
  const foodNumberIdx = headers.indexOf("food_number");
  const foodNameIdx = headers.indexOf("food_name");
  const foodNameEnIdx = headers.indexOf("food_name_en");

  if (foodNumberIdx === -1 || foodNameIdx === -1) {
    throw new Error("必要な列が見つかりません");
  }

  // 食品データを抽出
  const foods = dataRows.map((row) => ({
    food_number: row[foodNumberIdx] || "",
    food_name: row[foodNameIdx] || "",
    food_name_en: foodNameEnIdx !== -1 ? row[foodNameEnIdx] || "" : "",
  })).filter((f) => f.food_number && f.food_name);

  console.log(`総食品数: ${foods.length}件`);

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedFoodNumbers);
  let totalInputTokens = progress.totalInputTokens;
  let totalOutputTokens = progress.totalOutputTokens;
  let batchNumber = progress.lastBatchNumber;

  console.log(`処理済み食品数: ${processedSet.size}件`);

  // 開始位置を計算（中断から再開する場合）
  let startIdx = 0;
  if (processedSet.size > 0) {
    // 処理済みの最後の食品のインデックスを見つける
    for (let j = foods.length - 1; j >= 0; j--) {
      if (processedSet.has(foods[j].food_number)) {
        // 次の未処理の食品から開始（オーバーラップ分を戻す）
        startIdx = Math.max(0, j + 1 - OVERLAP_SIZE);
        break;
      }
    }
  }

  // 未処理の食品数を計算
  const unprocessedCount = foods.filter((f) => !processedSet.has(f.food_number)).length;
  console.log(`未処理の食品数: ${unprocessedCount}件`);

  if (unprocessedCount === 0) {
    console.log("全ての食品が処理済みです。");
  } else {
    // バッチ処理（オーバーラップ付き）
    const allResults: FoodTagInfo[] = [];
    let batchInputTokens = 0;
    let batchOutputTokens = 0;

    // 前のバッチの最後の結果を保持（参考用）
    let previousBatchLastResults: FoodTagInfo[] = [];
    // 前のバッチの最後の食品情報を保持（参考用）
    let previousBatchLastFoods: Array<{ food_number: string; food_name: string; food_name_en: string }> = [];

    // 中断から再開する場合、前のバッチ結果を読み込む
    if (batchNumber > 0) {
      const lastBatchResult = await loadBatchResult(batchNumber);
      if (lastBatchResult && lastBatchResult.foods.length > 0) {
        previousBatchLastResults = lastBatchResult.foods.slice(-OVERLAP_SIZE);
        // 対応する食品情報も取得
        const lastFoodNumbers = previousBatchLastResults.map(f => f.food_number);
        previousBatchLastFoods = foods.filter(f => lastFoodNumbers.includes(f.food_number));
      }
    }

    let currentIdx = startIdx;
    while (currentIdx < foods.length) {
      // バッチを作成（30件）
      const endIdx = Math.min(currentIdx + BATCH_SIZE, foods.length);
      const batch = foods.slice(currentIdx, endIdx);

      // バッチ内に未処理の食品があるか確認
      const hasUnprocessed = batch.some((f) => !processedSet.has(f.food_number));
      if (!hasUnprocessed) {
        // 全て処理済みならスキップ
        currentIdx += BATCH_SIZE - OVERLAP_SIZE;
        continue;
      }

      batchNumber++;

      console.log(
        `\nバッチ ${batchNumber} (進捗: ${currentIdx + batch.length}/${foods.length}): ${batch.length}件処理中...`
      );
      if (previousBatchLastResults.length > 0) {
        console.log(
          `  オーバーラップ: 前のバッチの最後${previousBatchLastResults.length}件を参考にします`
        );
      }

      try {
        const { results, inputTokens, outputTokens } = await processBatch(
          batch,
          previousBatchLastResults,
          previousBatchLastFoods
        );

        batchInputTokens += inputTokens;
        batchOutputTokens += outputTokens;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        // バッチ結果を保存
        const batchResult: BatchResult = {
          batchNumber,
          foods: results,
        };
        await saveBatchResult(batchResult);

        // 結果を追加（オーバーラップ部分は重複しないように）
        for (const result of results) {
          if (!processedSet.has(result.food_number)) {
            allResults.push(result);
            processedSet.add(result.food_number);
          }
        }

        // 前のバッチの最後の結果を更新（次のバッチの参考用）
        previousBatchLastResults = results.slice(-OVERLAP_SIZE);
        // 前のバッチの最後の食品情報を更新（参考用）
        previousBatchLastFoods = batch.slice(-OVERLAP_SIZE);

        // 料金を表示
        const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
        console.log(`  ${formatCost(cost)}`);

        // 進捗を保存
        progress.processedFoodNumbers = Array.from(processedSet);
        progress.totalInputTokens = totalInputTokens;
        progress.totalOutputTokens = totalOutputTokens;
        progress.lastBatchNumber = batchNumber;
        await saveProgress(progress);

        // 次のバッチの開始位置を更新（オーバーラップを考慮）
        currentIdx += BATCH_SIZE - OVERLAP_SIZE;

        // レートリミット対策（1秒待機）
        if (currentIdx < foods.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`バッチ ${batchNumber} でエラーが発生しました:`, error);
        throw error;
      }
    }

    // バッチ処理の合計料金を表示
    const batchCost = calculateCost(MODEL_NAME, batchInputTokens, batchOutputTokens);
    console.log(`\n=== 今回の処理 ===`);
    console.log(`処理件数: ${allResults.length}件`);
    console.log(`${formatCost(batchCost)}`);
  }

  // 全てのバッチ結果を読み込んで統合
  console.log("\n全てのバッチ結果を統合しています...");
  const allTagInfo: FoodTagInfo[] = [];
  for (let i = 1; i <= batchNumber; i++) {
    const batchResult = await loadBatchResult(i);
    if (batchResult) {
      // 重複を避けるため、food_numberでチェック
      for (const food of batchResult.foods) {
        if (!allTagInfo.find((f) => f.food_number === food.food_number)) {
          allTagInfo.push(food);
        }
      }
    }
  }

  // タグ情報をMapに変換
  const tagInfoMap = new Map<string, FoodTagInfo>();
  for (const info of allTagInfo) {
    tagInfoMap.set(info.food_number, info);
  }

  // CSVにタグ情報を追加
  console.log("CSVにタグ情報を追加しています...");
  const newHeaders = [
    ...headers,
    "tag_name",
    "diff",
    "search_keywords",
  ];

  const extendedRows = dataRows.map((row) => {
    const foodNumber = row[foodNumberIdx] || "";
    const tagInfo = tagInfoMap.get(foodNumber);

    if (tagInfo) {
      return [
        ...row,
        tagInfo.tag_name,
        tagInfo.diff,
        tagInfo.search_keywords.join(" "), // スペース区切りで保存
      ];
    } else {
      return [...row, "", "", ""];
    }
  });

  // CSV出力
  const csvLines = [
    newHeaders.map(escapeCSVField).join(","),
    ...extendedRows.map((row) =>
      row.map(escapeCSVField).join(",")
    ),
  ];

  await writeFile(outputFile, csvLines.join("\n"), "utf-8");
  console.log(`結果を保存: ${outputFile}`);

  // 累計料金を表示
  const totalCost = calculateCost(MODEL_NAME, totalInputTokens, totalOutputTokens);
  console.log(`\n=== 累計 ===`);
  console.log(`総食品数: ${allTagInfo.length}件`);
  console.log(`累計${formatCost(totalCost)}`);

  console.log("\n処理完了！");
}

main().catch(console.error);
