import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const BASE_DIR = path.dirname(__filename);
const FILTERED_CSV = path.join(BASE_DIR, "../03-2-filter-by-score/result/filtered-by-score.csv");
const AMINO_CSV = path.join(BASE_DIR, "../04-0/amino_acid_composition.csv");
const FATTY_CSV = path.join(BASE_DIR, "../04-0/fatty_acid_composition.csv");
const OUTPUT_CSV = path.join(BASE_DIR, "result/merged-nutrition.csv");

// CSVをパース（ヘッダーはJSON形式の文字列）
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split("\n").filter(line => line.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => parseCSVLine(line));
  return { headers, rows };
}

// CSV行をパース（ダブルクォートと改行を含む値に対応）
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// ヘッダーからcomponent_idやnameでインデックスを取得
function findColumnIndex(headers: string[], matcher: (header: string) => boolean): number {
  return headers.findIndex(h => {
    try {
      return matcher(h);
    } catch {
      return false;
    }
  });
}

// ヘッダー文字列から特定のフィールドを抽出
function getHeaderField(header: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(header);
    return parsed[field];
  } catch {
    return undefined;
  }
}

// filtered_food_tableから保持する列
const FILTERED_KEEP_CODES = ["WATER", "PROT-", "FAT-", "FIB-", "ASH", "CA", "P", "NA", "RETOL", "VITD", "ID", "SE"];
const FILTERED_KEEP_NAMES = ["食品番号", "食品名"];
const FILTERED_KEEP_RAW = ["構造化食品名", "理由", "スコア"];

// amino_acid_tableから保持する列（component_id）
const AMINO_KEEP_CODES = ["ILE", "LEU", "LYS", "MET", "CYS", "AAS", "PHE", "TYR", "AAA", "THR", "TRP", "VAL", "HIS", "ARG"];

// fatty_acid_tableから保持する列（component_id）
const FATTY_KEEP_CODES = ["FACID", "FAPU", "FAPUN3", "FAPUN6", "F18D2N6", "F18D3N3", "F20D5N3", "F22D6N3", "F20D4N6"];

function main() {
  console.log("=== 04-1: 成分表マージ ===\n");

  // ファイル読み込み
  const filteredContent = fs.readFileSync(FILTERED_CSV, "utf-8");
  const aminoContent = fs.readFileSync(AMINO_CSV, "utf-8");
  const fattyContent = fs.readFileSync(FATTY_CSV, "utf-8");

  const filtered = parseCSV(filteredContent);
  const amino = parseCSV(aminoContent);
  const fatty = parseCSV(fattyContent);

  console.log(`filtered-by-score.csv: ${filtered.rows.length} 行`);
  console.log(`amino_acid_composition.csv: ${amino.rows.length} 行`);
  console.log(`fatty_acid_composition.csv: ${fatty.rows.length} 行`);

  // 各テーブルの食品番号インデックス
  const filteredFoodIdIdx = findColumnIndex(filtered.headers, h => getHeaderField(h, "name") === "食品番号");
  const aminoFoodIdIdx = findColumnIndex(amino.headers, h => getHeaderField(h, "original_name") === "食品番号" || getHeaderField(h, "display_name") === "食品番号");
  const fattyFoodIdIdx = findColumnIndex(fatty.headers, h => getHeaderField(h, "original_name") === "食品番号" || getHeaderField(h, "display_name") === "食品番号");

  console.log(`\nfilteredFoodIdIdx: ${filteredFoodIdIdx}, aminoFoodIdIdx: ${aminoFoodIdIdx}, fattyFoodIdIdx: ${fattyFoodIdIdx}`);

  // amino, fattyをMapに変換
  const aminoMap = new Map<string, string[]>();
  for (const row of amino.rows) {
    aminoMap.set(row[aminoFoodIdIdx], row);
  }

  const fattyMap = new Map<string, string[]>();
  for (const row of fatty.rows) {
    fattyMap.set(row[fattyFoodIdIdx], row);
  }

  // filteredから保持するカラムのインデックスを取得（元のJSONヘッダーも保持）
  const filteredColIndices: { idx: number; header: string }[] = [];
  
  for (const name of FILTERED_KEEP_NAMES) {
    const idx = findColumnIndex(filtered.headers, h => getHeaderField(h, "name") === name);
    if (idx >= 0) filteredColIndices.push({ idx, header: filtered.headers[idx] });
  }
  
  for (const code of FILTERED_KEEP_CODES) {
    const idx = findColumnIndex(filtered.headers, h => getHeaderField(h, "code") === code);
    if (idx >= 0) filteredColIndices.push({ idx, header: filtered.headers[idx] });
  }
  
  for (const raw of FILTERED_KEEP_RAW) {
    const idx = filtered.headers.indexOf(raw);
    if (idx >= 0) filteredColIndices.push({ idx, header: raw });
  }

  // aminoから保持するカラムのインデックスを取得（元のJSONヘッダーも保持）
  const aminoColIndices: { idx: number; header: string }[] = [];
  for (const code of AMINO_KEEP_CODES) {
    const idx = findColumnIndex(amino.headers, h => getHeaderField(h, "component_id") === code);
    if (idx >= 0) aminoColIndices.push({ idx, header: amino.headers[idx] });
  }

  // fattyから保持するカラムのインデックスを取得（元のJSONヘッダーも保持）
  const fattyColIndices: { idx: number; header: string }[] = [];
  for (const code of FATTY_KEEP_CODES) {
    const idx = findColumnIndex(fatty.headers, h => getHeaderField(h, "component_id") === code);
    if (idx >= 0) fattyColIndices.push({ idx, header: fatty.headers[idx] });
  }

  console.log(`\nfiltered列: ${filteredColIndices.length}列`);
  console.log(`amino列: ${aminoColIndices.length}列`);
  console.log(`fatty列: ${fattyColIndices.length}列`);

  // マージ実行
  const outputHeaders = [
    ...filteredColIndices.map(c => c.header),
    ...aminoColIndices.map(c => c.header),
    ...fattyColIndices.map(c => c.header),
  ];

  const outputRows: string[][] = [];
  let matchedAmino = 0;
  let matchedFatty = 0;

  for (const row of filtered.rows) {
    const foodId = row[filteredFoodIdIdx];
    const aminoRow = aminoMap.get(foodId);
    const fattyRow = fattyMap.get(foodId);

    if (aminoRow) matchedAmino++;
    if (fattyRow) matchedFatty++;

    const outputRow = [
      ...filteredColIndices.map(c => row[c.idx] || ""),
      ...aminoColIndices.map(c => aminoRow?.[c.idx] || ""),
      ...fattyColIndices.map(c => fattyRow?.[c.idx] || ""),
    ];
    outputRows.push(outputRow);
  }

  console.log(`\nマッチ結果:`);
  console.log(`  アミノ酸表: ${matchedAmino}/${filtered.rows.length} (${((matchedAmino / filtered.rows.length) * 100).toFixed(1)}%)`);
  console.log(`  脂肪酸表: ${matchedFatty}/${filtered.rows.length} (${((matchedFatty / filtered.rows.length) * 100).toFixed(1)}%)`);

  // CSV出力
  const escapeCSV = (val: string): string => {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const csvContent = [
    outputHeaders.map(escapeCSV).join(","),
    ...outputRows.map(row => row.map(escapeCSV).join(",")),
  ].join("\n");

  fs.writeFileSync(OUTPUT_CSV, csvContent, "utf-8");
  console.log(`\n出力: ${OUTPUT_CSV}`);
  console.log(`合計: ${outputRows.length} 行 × ${outputHeaders.length} 列`);
}

main();
