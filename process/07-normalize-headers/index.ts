import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');

const csvInputFile = join(__dirname, '../06-calculate-me/result/final-nutrition.csv');
const outputCsvFile = join(resultDir, 'final-nutrition.csv');
const metadataFile = join(resultDir, 'column-metadata.json');

interface ColumnMetadata {
  columnIndex: number;
  columnName: string;
  type?: string;
  name?: string;
  description?: string;
  unit?: string;
  code?: string;
  category?: string;
  subcategory?: string;
  basis?: string;
  originalHeader: string;
  [key: string]: any; // その他のフィールド
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

/**
 * ヘッダー文字列を解析
 */
function parseHeader(header: string): any {
  try {
    return JSON.parse(header);
  } catch {
    return null;
  }
}

/**
 * 列名を生成（code優先、なければnameから生成）
 */
function generateColumnName(metadata: any, rawHeader: string): string {
  // codeがあればそれを使用
  if (metadata?.code) {
    return metadata.code;
  }

  // component_idがあればそれを使用（アミノ酸・脂肪酸など）
  if (metadata?.component_id) {
    return metadata.component_id;
  }

  // nameがあれば、それをベースに生成
  if (metadata?.name) {
    const name = metadata.name;
    // 既存のマッピング
    const nameMap: { [key: string]: string } = {
      '食品群': 'food_group',
      '食品番号': 'food_number',
      '食品名': 'food_name',
      '構造化食品名': 'structured_food_name',
      '理由': 'reason',
      'スコア': 'score',
      'searchKeys': 'search_keys',
      'tagNameJa': 'tag_name_ja',
      'tagNameJaDetail': 'tag_name_ja_detail',
      'tagNameEn': 'tag_name_en',
      'tagNameEnDetail': 'tag_name_en_detail',
    };
    
    if (nameMap[name]) {
      return nameMap[name];
    }
    
    // その他の場合はnameをそのまま使用（英語の場合）
    return name;
  }

  // JSONでない場合は、生の列名をスネークケースに変換
  if (!metadata) {
    return rawHeader
      .replace(/\s+/g, '_')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
  }

  // フォールバック
  return `column_${rawHeader.substring(0, 20).replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
}

/**
 * メタデータを抽出
 */
function extractMetadata(header: string, index: number): ColumnMetadata {
  const parsed = parseHeader(header);
  
  // 生の列名（JSONでない）の場合の処理
  if (!parsed) {
    const nameMap: { [key: string]: string } = {
      '構造化食品名': 'structured_food_name',
      '理由': 'reason',
      'スコア': 'score',
    };
    
    const columnName = nameMap[header] || header
      .replace(/\s+/g, '_')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
    
    const metadata: ColumnMetadata = {
      columnIndex: index,
      columnName: columnName,
      originalHeader: header,
      name: header,
      type: 'raw',
    };
    
    return metadata;
  }
  
  // JSON形式のヘッダーの場合
  const columnName = generateColumnName(parsed, header);
  
  const metadata: ColumnMetadata = {
    columnIndex: index,
    columnName: columnName,
    originalHeader: header,
  };

  // すべてのフィールドをコピー
  Object.keys(parsed).forEach(key => {
    metadata[key] = parsed[key];
  });

  return metadata;
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('=== 07: ヘッダー正規化 ===\n');
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
  console.log(`カラム数: ${headerRow.length}列`);

  // メタデータを抽出
  const columnMetadata: ColumnMetadata[] = [];
  const newHeaders: string[] = [];

  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i];
    const metadata = extractMetadata(header, i);
    columnMetadata.push(metadata);
    newHeaders.push(metadata.columnName);
  }

  console.log(`\n列名を生成しました: ${newHeaders.length}列`);

  // メタデータをJSONファイルに保存
  const metadataOutput = {
    version: '1.0',
    description: 'CSV列のメタデータ（元のJSONヘッダー情報を保持）',
    columns: columnMetadata,
  };

  await writeFile(metadataFile, JSON.stringify(metadataOutput, null, 2), 'utf-8');
  console.log(`メタデータを保存: ${metadataFile}`);

  // 新しいCSVを生成
  const outputLines = [
    newHeaders.map(escapeCSV).join(','),
    ...dataRows.map(row => row.map(escapeCSV).join(',')),
  ];

  await writeFile(outputCsvFile, outputLines.join('\n'), 'utf-8');

  console.log(`\n処理完了: ${outputCsvFile}`);
  console.log(`総行数: ${dataRows.length}`);
  console.log(`総列数: ${newHeaders.length}`);
  
  // 列名のサンプルを表示
  console.log(`\n列名サンプル（最初の10列）:`);
  newHeaders.slice(0, 10).forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
}

main().catch(console.error);
