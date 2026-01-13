import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const BASE_DIR = path.dirname(__filename);
const PLAN_JSON = path.join(BASE_DIR, "../04-0/plan.json");
// 03-2のフィルタリングをスキップし、02の全食材を使用
const FOOD_CSV = path.join(BASE_DIR, "../02-food-name-normalize/result/claude-json-header-with-structured-names.csv");
// スコアデータは03-1から取得
const SCORES_CSV = path.join(BASE_DIR, "../03-1-dog-food-scoring/result/scores.csv");
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

// スコアCSVをパース（シンプルなCSV形式：食品番号,理由,スコア）
function parseScoresCSV(content: string): Map<string, { reason: string; score: string }> {
  const lines = content.split("\n").filter(line => line.trim());
  const scoreMap = new Map<string, { reason: string; score: string }>();
  
  // ヘッダーをスキップ
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    if (parts.length >= 3) {
      const [foodId, reason, score] = parts;
      scoreMap.set(foodId, { reason, score });
    }
  }
  return scoreMap;
}

function main() {
  console.log("=== 04-1: 成分表マージ（全食材対象） ===\n");

  // plan.jsonを読み込み
  const plan: Plan = JSON.parse(fs.readFileSync(PLAN_JSON, "utf-8"));
  const { filtered_food_table, amino_acid_table, fatty_acid_table } = plan.tables;

  // ファイル読み込み
  const foodContent = fs.readFileSync(FOOD_CSV, "utf-8");
  const scoresContent = fs.readFileSync(SCORES_CSV, "utf-8");
  const aminoContent = fs.readFileSync(AMINO_CSV, "utf-8");
  const fattyContent = fs.readFileSync(FATTY_CSV, "utf-8");

  const food = parseCSV(foodContent);
  const scoreMap = parseScoresCSV(scoresContent);
  const amino = parseCSV(aminoContent);
  const fatty = parseCSV(fattyContent);

  console.log(`食品データ (02): ${food.rows.length} 行`);
  console.log(`スコアデータ (03-1): ${scoreMap.size} 件`);
  console.log(`amino_acid_composition.csv: ${amino.rows.length} 行`);
  console.log(`fatty_acid_composition.csv: ${fatty.rows.length} 行`);

  // 各テーブルの食品番号インデックス
  const foodIdIdx = findColumnIndex(food.headers, h => getHeaderField(h, "name") === "食品番号");
  const aminoFoodIdIdx = findColumnIndex(amino.headers, h => getHeaderField(h, "original_name") === "食品番号" || getHeaderField(h, "display_name") === "食品番号");
  const fattyFoodIdIdx = findColumnIndex(fatty.headers, h => getHeaderField(h, "original_name") === "食品番号" || getHeaderField(h, "display_name") === "食品番号");

  console.log(`\nfoodIdIdx: ${foodIdIdx}, aminoFoodIdIdx: ${aminoFoodIdIdx}, fattyFoodIdIdx: ${fattyFoodIdIdx}`);

  // amino, fattyをMapに変換
  const aminoMap = new Map<string, string[]>();
  for (const row of amino.rows) {
    aminoMap.set(row[aminoFoodIdIdx], row);
  }

  const fattyMap = new Map<string, string[]>();
  for (const row of fatty.rows) {
    fattyMap.set(row[fattyFoodIdIdx], row);
  }

  // foodから保持するカラムのインデックスを取得（元のJSONヘッダーも保持）
  const foodColIndices: { idx: number; header: string }[] = [];
  
  // keep_names（識別子系）
  for (const name of filtered_food_table.keep_names) {
    const idx = findColumnIndex(food.headers, h => getHeaderField(h, "name") === name);
    if (idx >= 0) {
      foodColIndices.push({ idx, header: food.headers[idx] });
    } else {
      console.warn(`警告: keep_names "${name}" が見つかりません`);
    }
  }
  
  // keep_codes（栄養素系）
  for (const code of filtered_food_table.keep_codes) {
    const idx = findColumnIndex(food.headers, h => getHeaderField(h, "code") === code);
    if (idx >= 0) {
      foodColIndices.push({ idx, header: food.headers[idx] });
    } else {
      console.warn(`警告: keep_codes "${code}" が見つかりません`);
    }
  }
  
  // keep_raw（生の列名） - 「構造化食品名」は02の出力にある
  // 「理由」と「スコア」は03-1のscores.csvから取得するため、ここでは構造化食品名のみ
  for (const raw of filtered_food_table.keep_raw) {
    if (raw === "理由" || raw === "スコア") {
      // これらは後で追加する
      continue;
    }
    const idx = food.headers.indexOf(raw);
    if (idx >= 0) {
      foodColIndices.push({ idx, header: raw });
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

  console.log(`\nfood列: ${foodColIndices.length}列`);
  console.log(`amino列: ${aminoColIndices.length}列`);
  console.log(`fatty列: ${fattyColIndices.length}列`);

  // スコアデータ用のヘッダー
  const reasonHeader = '{"type": "metadata", "name": "理由", "description": "犬のレシピ素材適性評価の理由"}';
  const scoreHeader = '{"type": "metadata", "name": "スコア", "description": "犬のレシピ素材適性スコア（1-10）"}';
  
  // データ完全性フラグのヘッダー
  const aminoDataHeader = '{"type": "flag", "name": "has_amino_acid_data", "description": "アミノ酸成分表にデータが存在するか", "values": {"1": "あり", "0": "なし"}}';
  const fattyDataHeader = '{"type": "flag", "name": "has_fatty_acid_data", "description": "脂肪酸成分表にデータが存在するか", "values": {"1": "あり", "0": "なし"}}';

  // マージ実行
  const outputHeaders = [
    ...foodColIndices.map(c => c.header),
    reasonHeader,
    scoreHeader,
    aminoDataHeader,
    fattyDataHeader,
    ...aminoColIndices.map(c => c.header),
    ...fattyColIndices.map(c => c.header),
  ];

  const outputRows: string[][] = [];
  let matchedAmino = 0;
  let matchedFatty = 0;
  let matchedScore = 0;

  for (const row of food.rows) {
    const foodId = row[foodIdIdx];
    const aminoRow = aminoMap.get(foodId);
    const fattyRow = fattyMap.get(foodId);
    const scoreData = scoreMap.get(foodId);

    if (aminoRow) matchedAmino++;
    if (fattyRow) matchedFatty++;
    if (scoreData) matchedScore++;

    const outputRow = [
      ...foodColIndices.map(c => row[c.idx] || ""),
      scoreData?.reason || "",
      scoreData?.score || "",
      aminoRow ? "1" : "0",
      fattyRow ? "1" : "0",
      ...aminoColIndices.map(c => aminoRow?.[c.idx] || ""),
      ...fattyColIndices.map(c => fattyRow?.[c.idx] || ""),
    ];
    outputRows.push(outputRow);
  }

  console.log(`\nマッチ結果:`);
  console.log(`  スコアデータ: ${matchedScore}/${food.rows.length} (${((matchedScore / food.rows.length) * 100).toFixed(1)}%)`);
  console.log(`  アミノ酸表: ${matchedAmino}/${food.rows.length} (${((matchedAmino / food.rows.length) * 100).toFixed(1)}%)`);
  console.log(`  脂肪酸表: ${matchedFatty}/${food.rows.length} (${((matchedFatty / food.rows.length) * 100).toFixed(1)}%)`);

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
