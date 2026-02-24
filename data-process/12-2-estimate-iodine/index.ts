import { mkdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");

const inputFile = join(
  __dirname,
  "../12-1-merge-additional-foods/result/final-nutrition-with-egg-shell.csv"
);
const estimatesFile = join(__dirname, "iodine-estimates.json");
const outputFile = join(resultDir, "final-nutrition-with-iodine-estimate.csv");

interface IodineEstimate {
  food_number: string;
  food_name: string;
  water: number;
  estimated_id_ug: number;
  method: string;
  reference_foods: string[];
  confidence: string;
  notes: string;
}

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

function isIdMissing(value: string): boolean {
  const v = (value ?? "").trim();
  return v === "" || v === "-";
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log("=== 12-2: 海藻ヨウ素推定値の補完 ===\n");

  const estimatesContent = await readFile(estimatesFile, "utf-8");
  const estimatesData = JSON.parse(estimatesContent) as { estimates: IodineEstimate[] };
  const estimatesList = estimatesData.estimates;
  const estimateByFoodNumber = new Map<string, IodineEstimate>();
  for (const e of estimatesList) {
    estimateByFoodNumber.set(e.food_number, e);
  }
  console.log(`推定データ読み込み: ${estimatesList.length}件`);

  const csvContent = await readFile(inputFile, "utf-8");
  const records = parseCSVRecords(csvContent);
  if (records.length === 0) {
    throw new Error("入力CSVが空です");
  }

  const headers = records[0];
  const dataRows = records.slice(1);

  const idIdx = headers.indexOf("ID");
  const foodNumberIdx = headers.indexOf("food_number");
  if (idIdx === -1) throw new Error("IDカラムが見つかりません");
  if (foodNumberIdx === -1) throw new Error("food_numberカラムが見つかりません");

  const newHeaders = [
    ...headers.slice(0, idIdx + 1),
    "ID_estimated",
    ...headers.slice(idIdx + 1),
  ];

  let filledCount = 0;
  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };

  const newRows = dataRows.map((row) => {
    const foodNumber = row[foodNumberIdx] ?? "";
    const idValue = row[idIdx] ?? "";
    const estimate = estimateByFoodNumber.get(foodNumber);

    if (estimate && isIdMissing(idValue)) {
      filledCount++;
      byConfidence[estimate.confidence] = (byConfidence[estimate.confidence] ?? 0) + 1;
      return [
        ...row.slice(0, idIdx),
        String(estimate.estimated_id_ug),
        "true",
        ...row.slice(idIdx + 1),
      ];
    }

    return [
      ...row.slice(0, idIdx),
      row[idIdx],
      "",
      ...row.slice(idIdx + 1),
    ];
  });

  const csvLines = [
    newHeaders.map(escapeCSVField).join(","),
    ...newRows.map((row) => row.map(escapeCSVField).join(",")),
  ];
  await writeFile(outputFile, csvLines.join("\n"), "utf-8");

  console.log(`\n補完結果:`);
  console.log(`  補完件数: ${filledCount}件`);
  console.log(`  high: ${byConfidence.high ?? 0}件`);
  console.log(`  medium: ${byConfidence.medium ?? 0}件`);
  console.log(`  low: ${byConfidence.low ?? 0}件`);
  console.log(`\n出力: ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
