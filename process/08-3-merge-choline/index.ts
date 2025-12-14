import { mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, "result");

// 入力ファイル
const mextFile = join(
  __dirname,
  "../07-normalize-headers/result/final-nutrition.csv"
);
const mappingFile = join(
  __dirname,
  "../08-2-choline-matching/result/choline-mapping.json"
);
const metadataInputFile = join(
  __dirname,
  "../07-normalize-headers/result/column-metadata.json"
);

// 出力ファイル
const outputFile = join(resultDir, "final-with-choline.csv");
const metadataOutputFile = join(resultDir, "column-metadata.json");

// マッチング結果
interface MatchResult {
  mext_food_number: string;
  mext_food_name: string;
  usda_ndb_no: string | null;
  usda_food_name: string | null;
  total_choline_mg: number | null;
  match_reason: string;
}

// 列メタデータ
interface ColumnMetadata {
  columnIndex: number;
  columnName: string;
  type?: string;
  name?: string;
  description?: string;
  unit?: string;
  code?: string;
  category?: string;
  subcategory?: string;
  basis?: string;
  originalHeader: string;
  [key: string]: any;
}

interface MetadataFile {
  version: string;
  description: string;
  columns: ColumnMetadata[];
}

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
 * CSVフィールドをエスケープ
 */
function escapeCSVField(field: string, isJsonField: boolean = false): string {
  // 空文字列の場合はそのまま返す
  if (field === "") return "";

  // JSONフィールド（structured_food_name, search_keys）は必ずクォート
  if (isJsonField) {
    // ダブルクォートを2つにエスケープ
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  // 既にクォートされている場合はそのまま返す（元のデータを保持）
  if (field.startsWith('"') && field.endsWith('"')) {
    return field;
  }

  // カンマ、改行、ダブルクォートを含む場合はクォート
  if (field.includes(",") || field.includes("\n") || field.includes('"')) {
    // ダブルクォートを2つにエスケープ
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return field;
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  // MEXTデータを読み込み
  console.log("MEXTデータを読み込んでいます...");
  const mextContent = await readFile(mextFile, "utf-8");
  const mextRecords = parseCSVRecords(mextContent);
  const mextHeaders = mextRecords[0];

  // カラムインデックスを取得
  const foodNumberIdx = mextHeaders.indexOf("food_number");
  const structuredFoodNameIdx = mextHeaders.indexOf("structured_food_name");
  const searchKeysIdx = mextHeaders.indexOf("search_keys");

  const mextDataRows = mextRecords.slice(1);
  console.log(`MEXTデータ: ${mextDataRows.length}件`);

  // マッピング結果を読み込み
  console.log("コリンマッピング結果を読み込んでいます...");
  const mappingContent = await readFile(mappingFile, "utf-8");
  const mapping: MatchResult[] = JSON.parse(mappingContent);
  console.log(`マッピング結果: ${mapping.length}件`);

  // マッピングをマップに変換
  const mappingMap = new Map<string, MatchResult>();
  for (const m of mapping) {
    mappingMap.set(m.mext_food_number, m);
  }

  // 新しいヘッダーを追加
  const newHeaders = [
    ...mextHeaders,
    "CHOLN",
    "usda_ndb_no",
    "usda_food_name",
  ];

  // 新しい行を生成
  const newRows = mextDataRows.map((row) => {
    const foodNumber = row[foodNumberIdx];
    const match = mappingMap.get(foodNumber);

    // 元の行をコピー
    const newRow = [...row];
    
    // コリン列を追加
    newRow.push(
      match?.total_choline_mg?.toString() || "",
      match?.usda_ndb_no || "",
      match?.usda_food_name || "" // usda_food_nameは後でエスケープ時にクォートされる
    );

    return newRow;
  });

  // CSV出力（各フィールドを正しくエスケープ）
  const escapedHeaders = newHeaders.map((h) => escapeCSVField(h));
  const usdaFoodNameIdx = newHeaders.length - 1; // 最後の列がusda_food_name
  const escapedRows = newRows.map((row) => {
    return row.map((field, idx) => {
      // JSONフィールドを特定
      const isJsonField = idx === structuredFoodNameIdx || idx === searchKeysIdx;
      // usda_food_nameもカンマを含む可能性があるのでクォート
      const needsQuote = isJsonField || idx === usdaFoodNameIdx;
      return escapeCSVField(field, needsQuote);
    }).join(",");
  });
  const csvContent = [escapedHeaders.join(","), ...escapedRows].join("\n");
  await writeFile(outputFile, csvContent, "utf-8");

  // メタデータを読み込み
  console.log("列メタデータを読み込んでいます...");
  const metadataContent = await readFile(metadataInputFile, "utf-8");
  const metadata: MetadataFile = JSON.parse(metadataContent);

  // コリン列のメタデータを追加
  const baseIndex = metadata.columns.length;
  metadata.columns.push(
    {
      columnIndex: baseIndex,
      columnName: "CHOLN",
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ビタミン",
      name: "コリン",
      unit: "mg",
      code: "CHOLN",
      source: "USDA",
      originalHeader: JSON.stringify({
        type: "nutrient",
        basis: "可食部100g当たり",
        category: "ビタミン",
        name: "コリン",
        unit: "mg",
        code: "CHOLN",
        source: "USDA",
      }),
    },
    {
      columnIndex: baseIndex + 1,
      columnName: "usda_ndb_no",
      type: "identifier",
      name: "USDA NDB番号",
      description: "USDAデータベースの食品ID（マッチした場合）",
      originalHeader: JSON.stringify({
        type: "identifier",
        name: "USDA NDB番号",
        description: "USDAデータベースの食品ID（マッチした場合）",
      }),
    },
    {
      columnIndex: baseIndex + 2,
      columnName: "usda_food_name",
      type: "identifier",
      name: "USDA食品名",
      description: "USDAデータベースの食品名（マッチした場合）",
      originalHeader: JSON.stringify({
        type: "identifier",
        name: "USDA食品名",
        description: "USDAデータベースの食品名（マッチした場合）",
      }),
    }
  );

  // メタデータを保存
  await writeFile(metadataOutputFile, JSON.stringify(metadata, null, 2), "utf-8");

  // 統計
  const matchedCount = mapping.filter((m) => m.usda_ndb_no).length;
  console.log(`\n処理完了:`);
  console.log(`  マッチ: ${matchedCount}件`);
  console.log(`  NO_MATCH: ${mapping.length - matchedCount}件`);
  console.log(`  CSV出力: ${outputFile}`);
  console.log(`  メタデータ出力: ${metadataOutputFile}`);
}

main().catch(console.error);
