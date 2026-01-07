import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");
const inputFile = join(
  __dirname,
  "../11-1-cooking-variations/result/final-nutrition-with-cooking-variations.csv"
);
const outputFile = join(resultDir, "final-nutrition-with-egg-shell.csv");

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
// 鶏卵殻のデータ作成
// =====================================================

/**
 * 鶏卵殻の行を作成
 * egg-shell.mdの情報を基に、手動でデータを設定
 */
function createEggShellRow(headers: string[]): string[] {
  const row: string[] = new Array(headers.length).fill("");

  // 列インデックスを取得
  const getIndex = (name: string) => headers.indexOf(name);

  // 基本情報
  const foodGroupIdx = getIndex("food_group");
  const foodNumberIdx = getIndex("food_number");
  const foodNameIdx = getIndex("food_name");

  if (foodGroupIdx !== -1) row[foodGroupIdx] = "12";
  if (foodNumberIdx !== -1) row[foodNumberIdx] = "12024";
  if (foodNameIdx !== -1) row[foodNameIdx] = "鶏卵　殻";

  // 栄養成分（egg-shell.mdの情報を基に）
  // カルシウム: 38,000 mg/100g
  const caIdx = getIndex("CA");
  if (caIdx !== -1) row[caIdx] = "38000";

  // マグネシウム: 370-400 mg/100g（中央値385を使用）
  const mgIdx = getIndex("MG");
  if (mgIdx !== -1) row[mgIdx] = "385";

  // リン: 150-160 mg/100g（中央値155を使用）
  const pIdx = getIndex("P");
  if (pIdx !== -1) row[pIdx] = "155";

  // ナトリウム: 160 mg/100g
  const naIdx = getIndex("NA");
  if (naIdx !== -1) row[naIdx] = "160";

  // カリウム: 40-50 mg/100g（中央値45を使用）
  const kIdx = getIndex("K");
  if (kIdx !== -1) row[kIdx] = "45";

  // 鉄: 1.0-2.0 mg/100g（中央値1.5を使用）
  const feIdx = getIndex("FE");
  if (feIdx !== -1) row[feIdx] = "1.5";

  // 亜鉛: 0.1-0.5 mg/100g（中央値0.3を使用）
  const znIdx = getIndex("ZN");
  if (znIdx !== -1) row[znIdx] = "0.3";

  // マンガン: 0.1 mg以下/100g（0.1を使用）
  const mnIdx = getIndex("MN");
  if (mnIdx !== -1) row[mnIdx] = "0.1";

  // 灰分（ASH）: 主にカルシウムなので高い値
  const ashIdx = getIndex("ASH");
  if (ashIdx !== -1) row[ashIdx] = "38.5"; // 約38.5%（カルシウム38% + その他）

  // 水分（WATER）: 殻は乾燥しているので低い値
  const waterIdx = getIndex("WATER");
  if (waterIdx !== -1) row[waterIdx] = "1.0";

  // structured_food_name
  const structuredIdx = getIndex("structured_food_name");
  if (structuredIdx !== -1) {
    row[structuredIdx] = JSON.stringify({
      baseName: "鶏卵",
      formModifiers: ["殻"],
    });
  }

  // reason
  const reasonIdx = getIndex("reason");
  if (reasonIdx !== -1) {
    row[reasonIdx] = "鶏卵殻はカルシウムが豊富で、犬のレシピ素材として適している";
  }

  // score
  const scoreIdx = getIndex("score");
  if (scoreIdx !== -1) row[scoreIdx] = "8";

  // has_amino_acid_data, has_fatty_acid_data
  const hasAminoIdx = getIndex("has_amino_acid_data");
  if (hasAminoIdx !== -1) row[hasAminoIdx] = "0";
  const hasFattyIdx = getIndex("has_fatty_acid_data");
  if (hasFattyIdx !== -1) row[hasFattyIdx] = "0";

  // search_keys
  const searchKeysIdx = getIndex("search_keys");
  if (searchKeysIdx !== -1) {
    row[searchKeysIdx] = JSON.stringify([
      "鶏卵殻",
      "けいらんかく",
      "ケイランカク",
      "卵殻",
      "らんかく",
      "ランカク",
      "たまごの殻",
      "egg shell",
      "eggshell",
      "chicken egg shell",
    ]);
  }

  // tag_name_ja, tag_name_en
  const tagNameJaIdx = getIndex("tag_name_ja");
  if (tagNameJaIdx !== -1) row[tagNameJaIdx] = "鶏卵殻";
  const tagNameEnIdx = getIndex("tag_name_en");
  if (tagNameEnIdx !== -1) row[tagNameEnIdx] = "Egg Shell";

  // is_recipe_ingredient
  const isRecipeIdx = getIndex("is_recipe_ingredient");
  if (isRecipeIdx !== -1) row[isRecipeIdx] = "TRUE";

  // recipe_label_path
  const recipeLabelIdx = getIndex("recipe_label_path");
  if (recipeLabelIdx !== -1) row[recipeLabelIdx] = "卵 > 殻";

  // cooking_label: RAW（調理なしの状態）
  const cookingLabelIdx = getIndex("cooking_label");
  if (cookingLabelIdx !== -1) row[cookingLabelIdx] = "RAW";

  return row;
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  // 入力CSVを読み込み
  console.log("入力CSVを読み込んでいます...");
  const content = await readFile(inputFile, "utf-8");
  const records = parseCSVRecords(content);

  if (records.length === 0) {
    throw new Error("入力CSVが空です");
  }

  const headers = records[0];
  const dataRows = records.slice(1);

  console.log(`入力データ: ${dataRows.length}件`);

  // 鶏卵殻の行を作成
  console.log("鶏卵殻の行を作成しています...");
  const eggShellRow = createEggShellRow(headers);

  // 新しいデータに追加
  const newDataRows = [...dataRows, eggShellRow];
  console.log(`出力データ: ${newDataRows.length}件（+1件追加）`);

  // CSV出力
  console.log("CSVを出力しています...");
  const escapedHeaders = headers.map(escapeCSVField);
  const escapedRows = newDataRows.map((row) =>
    row.map(escapeCSVField).join(",")
  );

  const csvContent = [escapedHeaders.join(","), ...escapedRows].join("\n");
  await writeFile(outputFile, csvContent, "utf-8");
  console.log(`結果を保存: ${outputFile}`);

  console.log("\n処理が完了しました！");
}

main().catch((error) => {
  console.error("エラーが発生しました:", error);
  process.exit(1);
});

