/**
 * CSV→JSON変換スクリプト
 * 
 * 99-resultのfoods.csvをJSONに変換し、api/src/data/foods.jsonとして出力
 * 
 * 実行: npx tsx scripts/convert-csv.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, '../../data-process/99-result/result/foods.csv');
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/foods.json');
const METADATA_PATH = path.resolve(__dirname, '../../data-process/99-result/result/column-metadata.json');

interface ColumnMetadata {
  columnIndex: number;
  columnName: string;
  type?: string;
  name?: string;
  unit?: string;
  code?: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
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
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}

function parseValue(value: string): number | string | null {
  // 空文字、'-'、'Tr'（微量）はnull
  if (value === '' || value === '-' || value === 'Tr') {
    return null;
  }
  
  // 括弧で囲まれた推計値は括弧を除去して数値化
  const trimmed = value.replace(/^\((.+)\)$/, '$1');
  
  // 数値として解析を試みる
  const num = parseFloat(trimmed);
  if (!isNaN(num)) {
    return num;
  }
  
  // 数値でなければ文字列として返す
  return value;
}

async function main() {
  console.log('CSV→JSON変換を開始...');
  
  // CSVファイルを読み込み
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  // ヘッダー行を解析
  const headers = parseCSVLine(lines[0]);
  console.log(`カラム数: ${headers.length}`);
  
  // メタデータを読み込み（単位情報など）
  const metadataContent = fs.readFileSync(METADATA_PATH, 'utf-8');
  const metadata = JSON.parse(metadataContent);
  
  // 各行をオブジェクトに変換
  const foods: Record<string, unknown>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const food: Record<string, unknown> = {};
    
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = values[j] || '';
      
      // 識別子カラムとタグ情報カラムは文字列のまま
      if (['food_group', 'food_number', 'food_name', 'food_name_en', 'usda_fdc_id', 'tag_name', 'diff', 'search_keywords'].includes(header)) {
        food[header] = value || null;
      } else {
        food[header] = parseValue(value);
      }
    }
    
    foods.push(food);
  }
  
  console.log(`変換完了: ${foods.length}件`);
  
  // 出力ディレクトリを作成
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // JSONとして出力
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(foods, null, 2));
  console.log(`出力完了: ${OUTPUT_PATH}`);
  
  // ファイルサイズを確認
  const stats = fs.statSync(OUTPUT_PATH);
  console.log(`ファイルサイズ: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);
