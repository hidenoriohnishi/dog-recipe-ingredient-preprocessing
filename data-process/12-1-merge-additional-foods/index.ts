import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");

// 入力: 10-1のクリーンアップ済みデータ
const inputFile = join(
  __dirname,
  "../10-1-clean-data/result/cleaned-final-nutrition.csv"
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
 * 
 * 10-1で出力されるカラム:
 * - 基本情報: food_group, food_number, food_name, food_name_en
 * - 基本栄養素: WATER, PROT-, FAT-, FIB-, ASH, ENERC_KCAL, ME_KCAL_100G
 * - ミネラル: CA, P, NA, K, MG, FE, ZN, CU, MN, ID, SE
 * - ビタミン: RETOL, VITD, TOCPHA, THIA, RIBF, NIA, VITB6A, VITB12, FOL, PANTAC, usda_choline_mg
 * - アミノ酸: ILE, LEU, LYS, MET, CYS, AAS, PHE, TYR, AAA, THR, TRP, VAL, HIS, ARG
 * - 脂肪酸: FACID, FAPU, FAPUN3, FAPUN6, F18D2N6, F18D3N3, F20D5N3, F22D6N3, F20D4N6
 * - メタデータ: score, usda_fdc_id
 */
function createEggShellRow(headers: string[]): string[] {
  const row: string[] = new Array(headers.length).fill("");

  // 列インデックスを取得
  const getIndex = (name: string) => headers.indexOf(name);

  // 基本情報
  const foodGroupIdx = getIndex("food_group");
  const foodNumberIdx = getIndex("food_number");
  const foodNameIdx = getIndex("food_name");
  const foodNameEnIdx = getIndex("food_name_en");

  if (foodGroupIdx !== -1) row[foodGroupIdx] = "12";
  if (foodNumberIdx !== -1) row[foodNumberIdx] = "12024";
  if (foodNameIdx !== -1) row[foodNameIdx] = "鶏卵　殻";
  if (foodNameEnIdx !== -1) row[foodNameEnIdx] = "Chicken egg shell";

  // =====================================================
  // 栄養成分（egg-shell.mdの情報を基に）
  // =====================================================

  // --- 基本栄養素 ---

  // 水分（WATER）: 殻は乾燥しているので低い値
  const waterIdx = getIndex("WATER");
  if (waterIdx !== -1) row[waterIdx] = "1.0";

  // タンパク質: 卵殻膜にタンパク質が含まれる（約3%程度）
  const protIdx = getIndex("PROT-");
  if (protIdx !== -1) row[protIdx] = "3.0";

  // 脂質: ほぼ0
  const fatIdx = getIndex("FAT-");
  if (fatIdx !== -1) row[fatIdx] = "0";

  // 食物繊維: 0（動物性なので）
  const fibIdx = getIndex("FIB-");
  if (fibIdx !== -1) row[fibIdx] = "0";

  // 灰分（ASH）: 主にカルシウムなので高い値（約96%）
  const ashIdx = getIndex("ASH");
  if (ashIdx !== -1) row[ashIdx] = "96.0";

  // エネルギー: 殻はほぼエネルギーがない（タンパク質由来のみ）
  const enercIdx = getIndex("ENERC_KCAL");
  if (enercIdx !== -1) row[enercIdx] = "12";

  // 代謝エネルギー: 殻は消化されないのでほぼ0
  const meIdx = getIndex("ME_KCAL_100G");
  if (meIdx !== -1) row[meIdx] = "0";

  // --- ミネラル ---

  // カルシウム: 38,000 mg/100g
  const caIdx = getIndex("CA");
  if (caIdx !== -1) row[caIdx] = "38000";

  // リン: 150-160 mg/100g（中央値155を使用）
  const pIdx = getIndex("P");
  if (pIdx !== -1) row[pIdx] = "155";

  // ナトリウム: 160 mg/100g
  const naIdx = getIndex("NA");
  if (naIdx !== -1) row[naIdx] = "160";

  // カリウム: 40-50 mg/100g（中央値45を使用）
  const kIdx = getIndex("K");
  if (kIdx !== -1) row[kIdx] = "45";

  // マグネシウム: 370-400 mg/100g（中央値385を使用）
  const mgIdx = getIndex("MG");
  if (mgIdx !== -1) row[mgIdx] = "385";

  // 鉄: 1.0-2.0 mg/100g（中央値1.5を使用）
  const feIdx = getIndex("FE");
  if (feIdx !== -1) row[feIdx] = "1.5";

  // 亜鉛: 0.1-0.5 mg/100g（中央値0.3を使用）
  const znIdx = getIndex("ZN");
  if (znIdx !== -1) row[znIdx] = "0.3";

  // 銅: データなし
  const cuIdx = getIndex("CU");
  if (cuIdx !== -1) row[cuIdx] = "";

  // マンガン: 0.1 mg以下/100g（0.1を使用）
  const mnIdx = getIndex("MN");
  if (mnIdx !== -1) row[mnIdx] = "0.1";

  // ヨウ素: データなし
  const idIdx = getIndex("ID");
  if (idIdx !== -1) row[idIdx] = "";

  // セレン: データなし
  const seIdx = getIndex("SE");
  if (seIdx !== -1) row[seIdx] = "";

  // --- ビタミン ---
  // 卵殻にはビタミンがほぼ含まれないため、すべて空またはTr

  const vitaminColumns = [
    "RETOL", "VITD", "TOCPHA", "THIA", "RIBF", "NIA",
    "VITB6A", "VITB12", "FOL", "PANTAC", "usda_choline_mg"
  ];
  for (const col of vitaminColumns) {
    const idx = getIndex(col);
    if (idx !== -1) row[idx] = "";
  }

  // --- アミノ酸 ---
  // 卵殻膜には若干のタンパク質があるが、主要な栄養源ではないため空
  const aminoAcidColumns = [
    "ILE", "LEU", "LYS", "MET", "CYS", "AAS",
    "PHE", "TYR", "AAA", "THR", "TRP", "VAL", "HIS", "ARG"
  ];
  for (const col of aminoAcidColumns) {
    const idx = getIndex(col);
    if (idx !== -1) row[idx] = "";
  }

  // --- 脂肪酸 ---
  // 卵殻には脂質がほぼないため、すべて空
  const fattyAcidColumns = [
    "FACID", "FAPU", "FAPUN3", "FAPUN6",
    "F18D2N6", "F18D3N3", "F20D5N3", "F22D6N3", "F20D4N6"
  ];
  for (const col of fattyAcidColumns) {
    const idx = getIndex(col);
    if (idx !== -1) row[idx] = "";
  }

  // --- メタデータ ---

  // score: カルシウム補給目的での適性スコア
  const scoreIdx = getIndex("score");
  if (scoreIdx !== -1) row[scoreIdx] = "8";

  // usda_fdc_id: USDAにマッチするデータなし
  const usdaFdcIdIdx = getIndex("usda_fdc_id");
  if (usdaFdcIdIdx !== -1) row[usdaFdcIdIdx] = "";

  return row;
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log("=== 12-1: 鶏卵殻データの追加 ===\n");

  // 入力CSVを読み込み
  console.log("入力CSVを読み込んでいます...");
  console.log(`入力ファイル: ${inputFile}`);
  const content = await readFile(inputFile, "utf-8");
  const records = parseCSVRecords(content);

  if (records.length === 0) {
    throw new Error("入力CSVが空です");
  }

  const headers = records[0];
  const dataRows = records.slice(1);

  console.log(`カラム数: ${headers.length}`);
  console.log(`入力データ: ${dataRows.length}件`);

  // 鶏卵殻の行を作成
  console.log("\n鶏卵殻の行を作成しています...");
  const eggShellRow = createEggShellRow(headers);

  // 作成したデータの確認
  console.log("作成された鶏卵殻データ:");
  const displayColumns = ["food_group", "food_number", "food_name", "food_name_en", "CA", "MG", "P", "ASH"];
  for (const col of displayColumns) {
    const idx = headers.indexOf(col);
    if (idx !== -1) {
      console.log(`  ${col}: ${eggShellRow[idx] || "(空)"}`);
    }
  }

  // 新しいデータに追加
  const newDataRows = [...dataRows, eggShellRow];
  console.log(`\n出力データ: ${newDataRows.length}件（+1件追加）`);

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
