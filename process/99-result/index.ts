import { mkdir, readFile, writeFile, copyFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");

// 入力ファイル
const inputFiles = {
  csv: join(__dirname, "../11-1-cooking-variations/result/final-nutrition-with-cooking-variations.csv"),
  columnMetadata: join(__dirname, "../08-3-merge-choline/result/column-metadata.json"),
  cookingLabels: join(__dirname, "../11-1-cooking-variations/result/cooking-labels.json"),
  spec: join(__dirname, "../../doc/spec.md"),
  specAdditional: join(__dirname, "../../sample-result/spec-additional.md"),
  specComparison: join(__dirname, "../07-normalize-headers/SPEC_COMPARISON.md"),
  readme: join(__dirname, "readme.md"),
};

// 出力ファイル
const outputFiles = {
  csv: join(resultDir, "foods.csv"),
  columnMetadata: join(resultDir, "column-metadata.json"),
  cookingLabels: join(resultDir, "cooking-labels.json"),
  spec: join(resultDir, "spec.md"),
  specAdditional: join(resultDir, "spec-additional.md"),
  specComparison: join(resultDir, "SPEC_COMPARISON.md"),
  readme: join(resultDir, "readme.md"),
};

async function updateColumnMetadata(): Promise<void> {
  // 既存のメタデータを読み込み
  const content = await readFile(inputFiles.columnMetadata, "utf-8");
  const metadata = JSON.parse(content);

  // 11-1で追加された列のメタデータを追加
  const additionalColumns = [
    {
      columnIndex: metadata.columns.length,
      columnName: "usda_fdc_id",
      type: "identifier",
      name: "USDA FDC ID",
      description: "USDA FoodData Central ID（マッチした場合）",
      originalHeader: JSON.stringify({
        type: "identifier",
        name: "USDA FDC ID",
        description: "USDA FoodData Central ID（マッチした場合）"
      })
    },
    {
      columnIndex: metadata.columns.length + 1,
      columnName: "usda_description",
      type: "identifier",
      name: "USDA説明",
      description: "USDA FoodData Centralの食品説明（マッチした場合）",
      originalHeader: JSON.stringify({
        type: "identifier",
        name: "USDA説明",
        description: "USDA FoodData Centralの食品説明（マッチした場合）"
      })
    },
    {
      columnIndex: metadata.columns.length + 2,
      columnName: "usda_match_distance",
      type: "numeric",
      name: "USDAマッチ距離",
      description: "USDA FoodData Centralとの栄養素距離（小さいほど類似）",
      originalHeader: JSON.stringify({
        type: "numeric",
        name: "USDAマッチ距離",
        description: "USDA FoodData Centralとの栄養素距離（小さいほど類似）"
      })
    },
    {
      columnIndex: metadata.columns.length + 3,
      columnName: "usda_chlorine_mg",
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "無機質",
      name: "塩素",
      unit: "mg",
      code: "CL",
      source: "USDA",
      originalHeader: JSON.stringify({
        type: "nutrient",
        basis: "可食部100g当たり",
        category: "無機質",
        name: "塩素",
        unit: "mg",
        code: "CL",
        source: "USDA"
      })
    },
    {
      columnIndex: metadata.columns.length + 4,
      columnName: "usda_choline_mg",
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ビタミン",
      name: "コリン（USDA）",
      unit: "mg",
      code: "CHOLN_USDA",
      source: "USDA",
      originalHeader: JSON.stringify({
        type: "nutrient",
        basis: "可食部100g当たり",
        category: "ビタミン",
        name: "コリン（USDA）",
        unit: "mg",
        code: "CHOLN_USDA",
        source: "USDA"
      })
    },
    {
      columnIndex: metadata.columns.length + 5,
      columnName: "is_recipe_ingredient",
      type: "flag",
      name: "レシピ実績食材フラグ",
      description: "過去のレシピで使用された食材かどうか",
      values: {
        "TRUE": "レシピ実績あり",
        "FALSE": "レシピ実績なし"
      },
      originalHeader: JSON.stringify({
        type: "flag",
        name: "レシピ実績食材フラグ",
        description: "過去のレシピで使用された食材かどうか",
        values: { TRUE: "レシピ実績あり", FALSE: "レシピ実績なし" }
      })
    },
    {
      columnIndex: metadata.columns.length + 6,
      columnName: "recipe_label_path",
      type: "extension",
      name: "レシピラベルパス",
      description: "マッチしたレシピ食材ラベルのパス",
      originalHeader: JSON.stringify({
        type: "extension",
        name: "レシピラベルパス",
        description: "マッチしたレシピ食材ラベルのパス"
      })
    },
    {
      columnIndex: metadata.columns.length + 7,
      columnName: "cooking_label",
      type: "enum",
      name: "調理ラベル",
      description: "調理状態のラベル（RAW, DRAINED, SOUPED, STEAMED, SEARED, FRIED, FOOD_STATE）",
      values: {
        "RAW": "調理なし（生）",
        "DRAINED": "茹でる（ゆで汁を捨てる）",
        "SOUPED": "茹でる（汁ごと使う）",
        "STEAMED": "蒸す・電子レンジ",
        "SEARED": "焼く・炒める",
        "FRIED": "揚げる",
        "FOOD_STATE": "加工済み状態（乾物、缶詰、冷凍など）"
      },
      originalHeader: JSON.stringify({
        type: "enum",
        name: "調理ラベル",
        description: "調理状態のラベル",
        values: {
          RAW: "調理なし（生）",
          DRAINED: "茹でる（ゆで汁を捨てる）",
          SOUPED: "茹でる（汁ごと使う）",
          STEAMED: "蒸す・電子レンジ",
          SEARED: "焼く・炒める",
          FRIED: "揚げる",
          FOOD_STATE: "加工済み状態（乾物、缶詰、冷凍など）"
        }
      })
    },
    {
      columnIndex: metadata.columns.length + 8,
      columnName: "cooking_variations",
      type: "json",
      name: "調理バリエーション",
      description: "同じ食材の異なる調理状態への参照（JSON形式: {ラベル: [食品番号]}）",
      originalHeader: JSON.stringify({
        type: "json",
        name: "調理バリエーション",
        description: "同じ食材の異なる調理状態への参照（JSON形式: {ラベル: [食品番号]}）"
      })
    }
  ];

  // メタデータを更新
  metadata.columns.push(...additionalColumns);
  metadata.version = "2.0";
  metadata.description = "CSV列のメタデータ（11-1処理完了版）";

  await writeFile(outputFiles.columnMetadata, JSON.stringify(metadata, null, 2), "utf-8");
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log("=== 12-result: 最終成果物集約 ===\n");

  // 1. CSVファイルをコピー
  console.log("1. CSVファイルをコピー...");
  await copyFile(inputFiles.csv, outputFiles.csv);
  console.log(`   → ${outputFiles.csv}`);

  // 2. 列メタデータを更新して保存
  console.log("2. 列メタデータを更新...");
  await updateColumnMetadata();
  console.log(`   → ${outputFiles.columnMetadata}`);

  // 3. 調理ラベル定義をコピー
  console.log("3. 調理ラベル定義をコピー...");
  await copyFile(inputFiles.cookingLabels, outputFiles.cookingLabels);
  console.log(`   → ${outputFiles.cookingLabels}`);

  // 4. spec.mdをコピー
  console.log("4. spec.mdをコピー...");
  await copyFile(inputFiles.spec, outputFiles.spec);
  console.log(`   → ${outputFiles.spec}`);

  // 5. spec-additional.mdをコピー
  console.log("5. spec-additional.mdをコピー...");
  await copyFile(inputFiles.specAdditional, outputFiles.specAdditional);
  console.log(`   → ${outputFiles.specAdditional}`);

  // 6. SPEC_COMPARISON.mdをコピー
  console.log("6. SPEC_COMPARISON.mdをコピー...");
  await copyFile(inputFiles.specComparison, outputFiles.specComparison);
  console.log(`   → ${outputFiles.specComparison}`);

  // 7. readme.mdをコピー
  console.log("7. readme.mdをコピー...");
  await copyFile(inputFiles.readme, outputFiles.readme);
  console.log(`   → ${outputFiles.readme}`);

  // 統計情報を表示
  console.log("\n=== 統計情報 ===");
  const csvContent = await readFile(outputFiles.csv, "utf-8");
  const lines = csvContent.split("\n").filter(line => line.trim());
  console.log(`CSVファイル: ${lines.length}行（ヘッダー1行 + データ${lines.length - 1}行）`);

  const headers = lines[0].split(",");
  console.log(`列数: ${headers.length}列`);

  console.log("\n処理が完了しました！");
  console.log(`\n成果物は ${resultDir} に保存されました。`);
}

main().catch((error) => {
  console.error("エラーが発生しました:", error);
  process.exit(1);
});

