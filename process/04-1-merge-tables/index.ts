import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const BASE_DIR = path.dirname(__filename);
const PLAN_JSON = path.join(BASE_DIR, "../04-0/plan.json");
const FILTERED_CSV = path.join(BASE_DIR, "../03-2-filter-by-score/result/filtered-by-score.csv");
const AMINO_CSV = path.join(BASE_DIR, "../04-0/amino_acid_composition.csv");
const FATTY_CSV = path.join(BASE_DIR, "../04-0/fatty_acid_composition.csv");
const OUTPUT_CSV = path.join(BASE_DIR, "result/merged-nutrition.csv");

// plan.jsonの型定義
interface Plan {
  tables: {
    filtered_food_table: {
      keep_codes: string[];
      keep_names: string[];
      keep_raw: string[];
    };
    amino_acid_table: {
      keep_component_ids: string[];
    };
    fatty_acid_table: {
      keep_component_ids: string[];
    };
  };
}

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

function main() {
  console.log("=== 04-1: 成分表マージ ===\n");

  // plan.jsonを読み込み
  const plan: Plan = JSON.parse(fs.readFileSync(PLAN_JSON, "utf-8"));
  const { filtered_food_table, amino_acid_table, fatty_acid_table } = plan.tables;

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
  
  // keep_names（識別子系）
  for (const name of filtered_food_table.keep_names) {
    const idx = findColumnIndex(filtered.headers, h => getHeaderField(h, "name") === name);
    if (idx >= 0) {
      filteredColIndices.push({ idx, header: filtered.headers[idx] });
    } else {
      console.warn(`警告: keep_names "${name}" が見つかりません`);
    }
  }
  
  // keep_codes（栄養素系）
  for (const code of filtered_food_table.keep_codes) {
    const idx = findColumnIndex(filtered.headers, h => getHeaderField(h, "code") === code);
    if (idx >= 0) {
      filteredColIndices.push({ idx, header: filtered.headers[idx] });
    } else {
      console.warn(`警告: keep_codes "${code}" が見つかりません`);
    }
  }
  
  // keep_raw（生の列名）
  for (const raw of filtered_food_table.keep_raw) {
    const idx = filtered.headers.indexOf(raw);
    if (idx >= 0) {
      filteredColIndices.push({ idx, header: raw });
    } else {
      console.warn(`警告: keep_raw "${raw}" が見つかりません`);
    }
  }

  // aminoから保持するカラムのインデックスを取得（元のJSONヘッダーも保持）
  const aminoColIndices: { idx: number; header: string }[] = [];
  for (const code of amino_acid_table.keep_component_ids) {
    const idx = findColumnIndex(amino.headers, h => getHeaderField(h, "component_id") === code);
    if (idx >= 0) {
      aminoColIndices.push({ idx, header: amino.headers[idx] });
    } else {
      console.warn(`警告: amino keep_component_ids "${code}" が見つかりません`);
    }
  }

  // fattyから保持するカラムのインデックスを取得（元のJSONヘッダーも保持）
  const fattyColIndices: { idx: number; header: string }[] = [];
  for (const code of fatty_acid_table.keep_component_ids) {
    const idx = findColumnIndex(fatty.headers, h => getHeaderField(h, "component_id") === code);
    if (idx >= 0) {
      fattyColIndices.push({ idx, header: fatty.headers[idx] });
    } else {
      console.warn(`警告: fatty keep_component_ids "${code}" が見つかりません`);
    }
  }

  console.log(`\nfiltered列: ${filteredColIndices.length}列`);
  console.log(`amino列: ${aminoColIndices.length}列`);
  console.log(`fatty列: ${fattyColIndices.length}列`);

  // データ完全性フラグのヘッダー
  const aminoDataHeader = '{"type": "flag", "name": "has_amino_acid_data", "description": "アミノ酸成分表にデータが存在するか", "values": {"1": "あり", "0": "なし"}}';
  const fattyDataHeader = '{"type": "flag", "name": "has_fatty_acid_data", "description": "脂肪酸成分表にデータが存在するか", "values": {"1": "あり", "0": "なし"}}';

  // マージ実行
  const outputHeaders = [
    ...filteredColIndices.map(c => c.header),
    aminoDataHeader,
    fattyDataHeader,
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
      aminoRow ? "1" : "0",
      fattyRow ? "1" : "0",
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
