import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

const csvInputFile = join(__dirname, '../04-1-merge-tables/result/merged-nutrition.csv');
const searchKeysFile = join(__dirname, '../05-1-search-keys/result/search-keys.json');
const tagNamesFile = join(__dirname, '../05-2-tag-names/result/tag-names.json');
const outputFile = join(resultDir, 'final-nutrition.csv');

interface SearchKeysData {
  [foodNumber: string]: string[];
}

interface TagNamesData {
  [foodNumber: string]: {
    ja: string;
    jaDetail?: string;
    en: string;
    enDetail?: string;
  };
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

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('ファイルを読み込んでいます...');

  // CSVを読み込む
  const csvContent = await readFile(csvInputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  // 検索キーを読み込む
  const searchKeys: SearchKeysData = JSON.parse(await readFile(searchKeysFile, 'utf-8'));
  console.log(`検索キー: ${Object.keys(searchKeys).length}件`);

  // タグ名を読み込む
  const tagNames: TagNamesData = JSON.parse(await readFile(tagNamesFile, 'utf-8'));
  console.log(`タグ名: ${Object.keys(tagNames).length}件`);

  // ヘッダー行
  const headerRow = records[0];
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // 新しいヘッダーを追加
  const newHeaders = [
    '{"type": "extension", "name": "searchKeys", "description": "検索キーワード配列"}',
    '{"type": "extension", "name": "tagNameJa", "description": "日本語タグ名"}',
    '{"type": "extension", "name": "tagNameJaDetail", "description": "日本語タグ名詳細（オプション）"}',
    '{"type": "extension", "name": "tagNameEn", "description": "英語タグ名"}',
    '{"type": "extension", "name": "tagNameEnDetail", "description": "英語タグ名詳細（オプション）"}',
  ];
  const extendedHeader = [...headerRow, ...newHeaders];

  // データ行を拡張
  const extendedRows = dataRows.map(row => {
    const foodNumber = row[1]; // 食品番号は2列目（インデックス1）
    
    // 検索キーを取得
    const keys = searchKeys[foodNumber] || [];
    const searchKeysJson = JSON.stringify(keys);
    
    // タグ名を取得
    const tag = tagNames[foodNumber] || { ja: '', en: '' };
    
    return [
      ...row,
      searchKeysJson,
      tag.ja || '',
      tag.jaDetail || '',
      tag.en || '',
      tag.enDetail || '',
    ];
  });

  // CSVを生成
  const outputLines = [
    extendedHeader.map(escapeCSV).join(','),
    ...extendedRows.map(row => row.map(escapeCSV).join(',')),
  ];

  await writeFile(outputFile, outputLines.join('\n'), 'utf-8');

  // 統計を表示
  let matchedSearchKeys = 0;
  let matchedTagNames = 0;
  for (const row of dataRows) {
    const foodNumber = row[1];
    if (searchKeys[foodNumber]) matchedSearchKeys++;
    if (tagNames[foodNumber]) matchedTagNames++;
  }

  console.log(`\n処理完了: ${outputFile}`);
  console.log(`総行数: ${dataRows.length}`);
  console.log(`検索キーマッチ: ${matchedSearchKeys}/${dataRows.length}`);
  console.log(`タグ名マッチ: ${matchedTagNames}/${dataRows.length}`);
}

main().catch(console.error);
