import { mkdir, copyFile, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// コピー元
const cholineCSV = join(__dirname, "../08-3-merge-choline/result/final-with-choline.csv");
const cholineMetadata = join(__dirname, "../08-3-merge-choline/result/column-metadata.json");
const specFile = join(__dirname, "../../doc/spec.md");
const specComparisonFile = join(__dirname, "../07-normalize-headers/SPEC_COMPARISON.md");

// コピー先
const outputCSV = join(__dirname, "final-with-choline.csv");
const outputMetadata = join(__dirname, "column-metadata.json");
const outputSpec = join(__dirname, "spec.md");
const outputSpecComparison = join(__dirname, "SPEC_COMPARISON.md");

async function main() {
  console.log("最終成果物を収集しています...");

  // CSVをコピー
  console.log("  final-with-choline.csv をコピー中...");
  await copyFile(cholineCSV, outputCSV);

  // メタデータをコピー
  console.log("  column-metadata.json をコピー中...");
  await copyFile(cholineMetadata, outputMetadata);

  // spec.mdをコピー
  console.log("  spec.md をコピー中...");
  await copyFile(specFile, outputSpec);

  // SPEC_COMPARISON.mdをコピー
  console.log("  SPEC_COMPARISON.md をコピー中...");
  await copyFile(specComparisonFile, outputSpecComparison);

  // 統計情報を表示
  const csvContent = await readFile(outputCSV, "utf-8");
  const lines = csvContent.split("\n").filter((l) => l.trim()).length;
  const headers = csvContent.split("\n")[0].split(",").length;

  const metadataContent = await readFile(outputMetadata, "utf-8");
  const metadata = JSON.parse(metadataContent);

  console.log("\n処理完了:");
  console.log(`  CSV: ${lines}行, ${headers}列`);
  console.log(`  メタデータ: ${metadata.columns.length}列`);
  console.log(`  出力先: ${__dirname}`);
}

main().catch(console.error);
