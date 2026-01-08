import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore - pluralize doesn't have type definitions
import pluralize from 'pluralize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../12-1-add-egg-shell/result/final-nutrition-with-egg-shell.csv');
const outputFile = join(resultDir, 'vector-db-data.csv');

// =====================================================
// CSV パース
// =====================================================

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

function escapeCSVField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return field;
}

// =====================================================
// テキスト処理
// =====================================================

/**
 * テキストを単語に分割する
 * 全角スペース、半角スペース、各種記号で分割
 */
function splitIntoWords(text: string): string[] {
  if (!text || text.trim() === '') {
    return [];
  }

  // 全角スペース、半角スペース、各種区切り文字（中黒含む）で分割
  const words = text
    .split(/[\s　、，,・]+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);

  return words;
}

/**
 * 記号を削除する（かっこ、角かっこなど）
 */
function removeSymbols(text: string): string {
  // 角かっこ、丸かっこ、不等号、その他の記号を削除（全角・半角両方）
  return text
    .replace(/[\[\]［］【】（）()「」『』〈〉《》＜＞]/g, '')
    .trim();
}

/**
 * 文字列を正規化する（全角・半角スペースの削除、見えない文字の削除）
 */
function normalizeText(text: string): string {
  // 全角・半角スペースを削除
  let normalized = text.replace(/[\s　]+/g, '');
  
  // 見えない文字（制御文字など）を削除
  normalized = normalized.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  
  return normalized;
}

/**
 * 英単語を小文字に変換し、複数形を単数形に変換
 */
function normalizeEnglishWord(text: string): string {
  // 英字が含まれている場合のみ処理
  if (!/[a-zA-Z]/.test(text)) {
    return text;
  }

  // 小文字に変換
  const lowercased = text.toLowerCase();

  // 複数形を単数形に変換
  const singular = pluralize.singular(lowercased);

  return singular;
}

/**
 * 英語のテキストからbigram（2単語の組み合わせ）を生成
 */
function generateBigrams(words: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    bigrams.push(bigram);
  }
  return bigrams;
}

/**
 * embedding textを生成する
 */
function generateEmbeddingText(
  foodName: string,
  searchKeys: string,
  tagNameJa: string,
  tagNameEn: string
): string {
  const wordSet = new Set<string>();

  // 1. food_nameを単語に分割
  const foodNameWords = splitIntoWords(foodName);
  for (const word of foodNameWords) {
    const cleaned = removeSymbols(word);
    if (cleaned) {
      const normalized = normalizeText(cleaned);
      if (normalized) {
        wordSet.add(normalizeEnglishWord(normalized));
      }
    }
  }

  // 2. search_keysをパースして各単語を追加
  try {
    // JSON配列としてパース
    const searchKeysArray = JSON.parse(searchKeys);
    if (Array.isArray(searchKeysArray)) {
      for (const key of searchKeysArray) {
        if (typeof key === 'string' && key.trim()) {
          // search_keysの各要素を分割（スペースで区切られている場合がある）
          const keyWords = splitIntoWords(key);
          for (const keyWord of keyWords) {
            const cleaned = removeSymbols(keyWord);
            if (cleaned) {
              const normalized = normalizeText(cleaned);
              if (normalized) {
                wordSet.add(normalizeEnglishWord(normalized));
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // JSONパースに失敗した場合は文字列として扱う
    const searchKeysWords = splitIntoWords(searchKeys);
    for (const word of searchKeysWords) {
      const cleaned = removeSymbols(word);
      if (cleaned) {
        const normalized = normalizeText(cleaned);
        if (normalized) {
          wordSet.add(normalizeEnglishWord(normalized));
        }
      }
    }
  }

  // 3. tag_name_jaを単語に分割
  if (tagNameJa && tagNameJa.trim()) {
    const tagJaWords = splitIntoWords(tagNameJa);
    for (const word of tagJaWords) {
      const cleaned = removeSymbols(word);
      if (cleaned) {
        const normalized = normalizeText(cleaned);
        if (normalized) {
          wordSet.add(normalizeEnglishWord(normalized));
        }
      }
    }
  }

  // 4. tag_name_enを単語に分割し、単数形に変換してbigramも生成
  if (tagNameEn && tagNameEn.trim()) {
    const tagEnWords = splitIntoWords(tagNameEn);
    const normalizedEnWords: string[] = [];
    
    // 各単語を正規化（小文字化、単数形化）
    for (const word of tagEnWords) {
      const cleaned = removeSymbols(word);
      if (cleaned) {
        const normalized = normalizeText(cleaned);
        if (normalized) {
          const englishNormalized = normalizeEnglishWord(normalized);
          normalizedEnWords.push(englishNormalized);
          wordSet.add(englishNormalized);
        }
      }
    }
    
    // bigramを生成（2単語の組み合わせ）
    if (normalizedEnWords.length >= 2) {
      const bigrams = generateBigrams(normalizedEnWords);
      for (const bigram of bigrams) {
        wordSet.add(bigram);
      }
    }
  }

  // 5. ソートして半角スペースで結合
  const sortedWords = Array.from(wordSet).sort();
  return sortedWords.join(' ');
}

// =====================================================
// メイン処理
// =====================================================

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log('CSVファイルを読み込んでいます...');
  const csvContent = await readFile(inputFile, 'utf-8');
  const records = parseCSVRecords(csvContent);

  if (records.length < 2) {
    throw new Error('CSVファイルにデータがありません');
  }

  const headers = records[0];
  const dataRows = records.slice(1);
  console.log(`データ行数: ${dataRows.length}行`);

  // 必要なカラムのインデックスを取得
  const foodNumberIndex = headers.indexOf('food_number');
  const foodNameIndex = headers.indexOf('food_name');
  const searchKeysIndex = headers.indexOf('search_keys');
  const tagNameJaIndex = headers.indexOf('tag_name_ja');
  const tagNameEnIndex = headers.indexOf('tag_name_en');

  if (
    foodNumberIndex === -1 ||
    foodNameIndex === -1 ||
    searchKeysIndex === -1 ||
    tagNameJaIndex === -1 ||
    tagNameEnIndex === -1
  ) {
    throw new Error('必要な列が見つかりません');
  }

  // embedding textを生成
  console.log('embedding textを生成しています...');
  const outputHeaders = ['food_number', 'food_name', 'embedding_text'];
  const outputRows: string[][] = [];
  outputRows.push(outputHeaders.map(escapeCSVField));

  for (const row of dataRows) {
    const foodNumber = row[foodNumberIndex] || '';
    const foodName = row[foodNameIndex] || '';
    const searchKeys = row[searchKeysIndex] || '';
    const tagNameJa = row[tagNameJaIndex] || '';
    const tagNameEn = row[tagNameEnIndex] || '';

    const embeddingText = generateEmbeddingText(foodName, searchKeys, tagNameJa, tagNameEn);

    const newRow = [foodNumber, foodName, embeddingText];
    outputRows.push(newRow.map(escapeCSVField));
  }

  // CSVファイルに書き込み
  const csvOutput = outputRows.map(row => row.join(',')).join('\n');
  await writeFile(outputFile, csvOutput, 'utf-8');
  console.log(`embedding textデータを保存: ${outputFile}`);
  console.log(`データ件数: ${outputRows.length - 1}件`);
  console.log('\n処理完了！');
}

main().catch(console.error);
