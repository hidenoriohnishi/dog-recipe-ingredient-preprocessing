import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

const csvInputFile = join(__dirname, '../05-3-merge-extensions/result/final-nutrition.csv');
const outputFile = join(resultDir, 'final-nutrition.csv');

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
      if (char === ',') {
        fields.push(current);
        current = '';
        i++;
        continue;
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        fields.push(current);
        current = '';
        if (fields.some(f => f.trim())) {
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

  if (current || fields.length > 0) {
    fields.push(current);
    if (fields.some(f => f.trim())) {
      records.push([...fields]);
    }
  }

  return records;
}

/**
 * CSV値をエスケープ
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * ヘッダー文字列から特定のフィールドを抽出
 */
function getHeaderField(header: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(header);
    return parsed[field];
  } catch {
    return undefined;
  }
}

/**
 * ヘッダーからcodeでカラムインデックスを取得
 */
function findColumnIndexByCode(headers: string[], code: string): number {
  return headers.findIndex(h => {
    try {
      return getHeaderField(h, 'code') === code;
    } catch {
      return false;
    }
  });
}

/**
 * 文字列を数値に変換（空文字、"-"、括弧付きは0として扱う）
 */
function parseNumericValue(value: string): number {
  if (!value || value.trim() === '' || value === '-' || value.startsWith('(')) {
    return 0;
  }
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

/**
 * 代謝エネルギー（ME）を計算
 * spec.md 6.3: me_kcal_100g = 3.5*protein + 8.5*fat + 3.5*max(0, NFE)
 * NFE_g_100g = 100 - (water + protein + fat + fiber + ash)
 */
function calculateME(water: number, protein: number, fat: number, fiber: number, ash: number): number {
  const NFE = 100 - (water + protein + fat + fiber + ash);
  const me = 3.5 * protein + 8.5 * fat + 3.5 * Math.max(0, NFE);
  return Math.round(me * 100) / 100; // 小数点第2位まで
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('=== 06: 代謝エネルギー計算 ===\n');
  console.log('ファイルを読み込んでいます...');

  // CSVを読み込む
  const csvContent = await readFile(csvInputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  // ヘッダー行
  const headerRow = records[0];
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // me_kcal_100g計算に必要なカラムのインデックスを取得
  const waterIdx = findColumnIndexByCode(headerRow, 'WATER');
  const proteinIdx = findColumnIndexByCode(headerRow, 'PROT-');
  const fatIdx = findColumnIndexByCode(headerRow, 'FAT-');
  const fiberIdx = findColumnIndexByCode(headerRow, 'FIB-');
  const ashIdx = findColumnIndexByCode(headerRow, 'ASH');

  if (waterIdx < 0 || proteinIdx < 0 || fatIdx < 0 || fiberIdx < 0 || ashIdx < 0) {
    throw new Error('必要な栄養素カラムが見つかりません');
  }

  console.log(`\nカラムインデックス:`);
  console.log(`  水分(WATER): ${waterIdx}`);
  console.log(`  たんぱく質(PROT-): ${proteinIdx}`);
  console.log(`  脂質(FAT-): ${fatIdx}`);
  console.log(`  食物繊維(FIB-): ${fiberIdx}`);
  console.log(`  灰分(ASH): ${ashIdx}`);

  // me_kcal_100gのヘッダーを追加
  const meHeader = '{"type": "nutrient", "basis": "可食部100g当たり", "category": "エネルギー", "name": "代謝エネルギー", "unit": "kcal", "code": "ME_KCAL_100G"}';
  const extendedHeader = [...headerRow, meHeader];

  // データ行を拡張
  const extendedRows = dataRows.map(row => {
    // 栄養素の値を取得してme_kcal_100gを計算
    const water = parseNumericValue(row[waterIdx] || '0');
    const protein = parseNumericValue(row[proteinIdx] || '0');
    const fat = parseNumericValue(row[fatIdx] || '0');
    const fiber = parseNumericValue(row[fiberIdx] || '0');
    const ash = parseNumericValue(row[ashIdx] || '0');
    const meKcal = calculateME(water, protein, fat, fiber, ash);
    
    return [
      ...row,
      meKcal.toString(),
    ];
  });

  // CSVを生成
  const outputLines = [
    extendedHeader.map(escapeCSV).join(','),
    ...extendedRows.map(row => row.map(escapeCSV).join(',')),
  ];

  await writeFile(outputFile, outputLines.join('\n'), 'utf-8');

  console.log(`\n処理完了: ${outputFile}`);
  console.log(`総行数: ${dataRows.length}`);
  console.log(`me_kcal_100g計算: 完了`);
}

main().catch(console.error);
