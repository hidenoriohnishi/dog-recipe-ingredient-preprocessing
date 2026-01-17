import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFoodName } from './food-name-scheme.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../01-csv/result/claude-json-header.csv');

async function main() {
  // resultディレクトリを作成
  await mkdir(resultDir, { recursive: true });

  console.log('CSVファイルを読み込んでいます...');
  
  // CSVファイルを読み込む
  const csvContent = await readFile(inputFile, 'utf-8');
  
  // 改行を含むフィールドに対応したCSVパース
  const records = parseCSVRecords(csvContent);

  if (records.length === 0) {
    throw new Error('CSVファイルが空です');
  }

  // ヘッダー行を処理
  const headerColumns = records[0];
  
  // 食品名の列のインデックスを探す（4列目、インデックス3）
  const foodNameIndex = 3;
  
  // 新しいヘッダーに「構造化食品名」列を追加
  const newHeader = [...headerColumns, '構造化食品名'];
  const outputLines: string[] = [formatCSVLine(newHeader)];

  console.log(`データ行を処理中... (全${records.length - 1}行)`);

  // データ行を処理
  for (let i = 1; i < records.length; i++) {
    const columns = records[i];
    
    // 備考欄（最後の列）の改行を\n（文字列）に置き換え
    if (columns.length > 0) {
      const lastIndex = columns.length - 1;
      // 改行文字を\nという文字列に置き換え
      columns[lastIndex] = columns[lastIndex]
        .replace(/\r\n/g, '\\n')
        .replace(/\r/g, '\\n')
        .replace(/\n/g, '\\n');
    }
    
    // 食品名を取得（4列目）
    const foodName = columns[foodNameIndex] || '';
    
    // 食品名を構造化
    const structuredName = parseFoodName(foodName);
    
    // 構造化されたデータをJSON文字列に変換
    const structuredNameJson = JSON.stringify(structuredName);
    
    // 新しい列を追加
    const newColumns = [...columns, structuredNameJson];
    outputLines.push(formatCSVLine(newColumns));

    if (i % 100 === 0) {
      console.log(`処理中: ${i}/${records.length - 1}行`);
    }
  }

  // 結果をファイルに書き出し
  const outputPath = join(resultDir, 'claude-json-header-with-structured-names.csv');
  await writeFile(outputPath, outputLines.join('\n'), 'utf-8');

  console.log(`処理完了: ${outputPath}`);
  console.log(`処理行数: ${records.length - 1}行`);
}

/**
 * CSV全体をパース（改行を含むフィールドに対応）
 */
function parseCSVRecords(csvContent: string): string[][] {
  const records: string[][] = [];
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvContent.length) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // エスケープされたダブルクォート
        current += '"';
        i += 2;
        continue;
      } else {
        // クォートの開始/終了
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (!inQuotes) {
      if (char === ',') {
        // フィールドの区切り
        fields.push(current);
        current = '';
        i++;
        continue;
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        // レコードの区切り（改行）
        fields.push(current);
        current = '';
        if (fields.some(f => f.trim())) {
          // 空でないレコードのみ追加
          records.push([...fields]);
        }
        fields.length = 0;
        if (char === '\r' && nextChar === '\n') {
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

  // 最後のフィールドとレコードを追加
  if (current || fields.length > 0) {
    fields.push(current);
    if (fields.some(f => f.trim())) {
      records.push([...fields]);
    }
  }

  return records;
}

/**
 * CSV行をフォーマット（ダブルクォートでエスケープ）
 */
function formatCSVLine(columns: string[]): string {
  return columns.map(col => {
    // カンマ、ダブルクォート、改行が含まれる場合はエスケープ
    if (col.includes(',') || col.includes('"') || col.includes('\n')) {
      return `"${col.replace(/"/g, '""')}"`;
    }
    return col;
  }).join(',');
}

main().catch(console.error);

