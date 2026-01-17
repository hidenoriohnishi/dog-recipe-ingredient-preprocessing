import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const originalFile = join(__dirname, '../00-original/result/claude-json-header.xlsx');

async function main() {
  // resultディレクトリを作成
  await mkdir(resultDir, { recursive: true });

  console.log('Excelファイルを読み込んでいます...');
  
  // Excelファイルを読み込む
  const fileBuffer = await readFile(originalFile);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

  // 最初のシートを取得
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // CSVに変換
  const csv = XLSX.utils.sheet_to_csv(worksheet);

  // CSVファイルとして書き出し
  const outputPath = join(resultDir, 'claude-json-header.csv');
  await writeFile(outputPath, csv, 'utf-8');

  console.log(`CSV変換完了: ${outputPath}`);
}

main().catch(console.error);

