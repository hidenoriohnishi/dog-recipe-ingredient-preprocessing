import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");

// 入力ファイル
const inputFile = join(
  __dirname,
  "../12-1-merge-additional-foods/result/final-nutrition-with-egg-shell.csv"
);
const originalDataFile = join(
  __dirname,
  "../01-csv/result/claude-json-header.csv"
);
const outputFile = join(resultDir, "final-nutrition-with-refuse-rate.csv");

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

// ヘッダーからJSONをパースして特定のフィールドを取得
function getHeaderField(header: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(header);
    return parsed[field];
  } catch {
    return undefined;
  }
}

// ヘッダーからcodeで列インデックスを取得
function findColumnIndex(headers: string[], code: string): number {
  return headers.findIndex((h) => {
    try {
      return getHeaderField(h, "code") === code;
    } catch {
      return false;
    }
  });
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log("=== 13-1: 廃棄率の追加 ===\n");

  // 12-1の結果CSVを読み込み
  console.log("12-1の結果CSVを読み込んでいます...");
  console.log(`入力ファイル: ${inputFile}`);
  const inputContent = await readFile(inputFile, "utf-8");
  const inputRecords = parseCSVRecords(inputContent);

  if (inputRecords.length === 0) {
    throw new Error("入力CSVが空です");
  }

  const inputHeaders = inputRecords[0];
  const inputRows = inputRecords.slice(1);

  console.log(`カラム数: ${inputHeaders.length}`);
  console.log(`入力データ: ${inputRows.length}件`);

  // 元データCSVを読み込み
  console.log("\n元データCSVを読み込んでいます...");
  console.log(`元データファイル: ${originalDataFile}`);
  const originalContent = await readFile(originalDataFile, "utf-8");
  const originalRecords = parseCSVRecords(originalContent);

  if (originalRecords.length === 0) {
    throw new Error("元データCSVが空です");
  }

  const originalHeaders = originalRecords[0];
  const originalRows = originalRecords.slice(1);

  console.log(`元データ: ${originalRows.length}件`);

  // 元データから食品番号と廃棄率のインデックスを取得
  // 食品番号はnameで検索
  const originalFoodNumberIdxByName = originalHeaders.findIndex((h) => {
    try {
      return getHeaderField(h, "name") === "食品番号";
    } catch {
      return false;
    }
  });

  const refuseIdx = findColumnIndex(originalHeaders, "REFUSE");

  if (originalFoodNumberIdxByName === -1) {
    throw new Error("元データから食品番号の列が見つかりません");
  }
  if (refuseIdx === -1) {
    throw new Error("元データから廃棄率（REFUSE）の列が見つかりません");
  }

  console.log(`\n元データの食品番号列インデックス: ${originalFoodNumberIdxByName}`);
  console.log(`元データの廃棄率列インデックス: ${refuseIdx}`);

  // 元データから廃棄率のマップを作成（食品番号 -> 廃棄率）
  const refuseRateMap = new Map<string, string>();
  for (const row of originalRows) {
    if (row.length > originalFoodNumberIdxByName && row.length > refuseIdx) {
      const foodNumber = row[originalFoodNumberIdxByName]?.trim();
      const refuseRate = row[refuseIdx]?.trim() || "";
      if (foodNumber) {
        refuseRateMap.set(foodNumber, refuseRate);
      }
    }
  }

  console.log(`廃棄率マップ: ${refuseRateMap.size}件`);

  // 入力データの食品番号列インデックスを取得
  const inputFoodNumberIdx = inputHeaders.indexOf("food_number");
  if (inputFoodNumberIdx === -1) {
    throw new Error("入力データからfood_numberの列が見つかりません");
  }

  console.log(`\n入力データの食品番号列インデックス: ${inputFoodNumberIdx}`);

  // 新しいヘッダーを作成（food_groupの後にREFUSEを追加）
  const foodGroupIdx = inputHeaders.indexOf("food_group");
  const newHeaders = [...inputHeaders];
  
  // food_groupの後にREFUSEを挿入
  const refuseHeader = "REFUSE";
  if (foodGroupIdx !== -1) {
    newHeaders.splice(foodGroupIdx + 1, 0, refuseHeader);
  } else {
    // food_groupが見つからない場合は先頭に追加
    newHeaders.unshift(refuseHeader);
  }

  console.log(`\n新しいヘッダー: ${newHeaders.length}列（+1列追加）`);

  // データ行に廃棄率を追加
  const newRows: string[][] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of inputRows) {
    const foodNumber = row[inputFoodNumberIdx]?.trim();
    const refuseRate = foodNumber ? refuseRateMap.get(foodNumber) || "" : "";

    if (refuseRate) {
      matchedCount++;
    } else {
      unmatchedCount++;
    }

    // 新しい行を作成（food_groupの後にREFUSEを挿入）
    const newRow = [...row];
    if (foodGroupIdx !== -1) {
      newRow.splice(foodGroupIdx + 1, 0, refuseRate);
    } else {
      newRow.unshift(refuseRate);
    }
    newRows.push(newRow);
  }

  console.log(`\nマッチした廃棄率: ${matchedCount}件`);
  console.log(`マッチしなかった廃棄率: ${unmatchedCount}件`);

  // CSV出力
  console.log("\nCSVを出力しています...");
  const escapedHeaders = newHeaders.map(escapeCSVField);
  const escapedRows = newRows.map((row) =>
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
