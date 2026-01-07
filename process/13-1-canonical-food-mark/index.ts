import dotenv from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { calculateCost, formatCost, type CostResult } from '../../utils/cost-calculator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const resultDir = join(__dirname, 'result');
const inputFile = join(__dirname, '../12-1-add-egg-shell/result/final-nutrition-with-egg-shell.csv');
const outputFile = join(resultDir, 'final-nutrition-with-canonical.csv');
const mappingFile = join(resultDir, 'canonical-mapping.json');
const progressFile = join(resultDir, 'progress.json');

// バッチサイズとオーバーラップ
const BATCH_SIZE = 30;
const OVERLAP_SIZE = 20;
const STEP_SIZE = BATCH_SIZE - OVERLAP_SIZE; // 10

interface Progress {
  processedIndices: number[];
  // food_number -> { canonical_name, is_canonical }
  foodMapping: Record<string, { canonical_name: string; is_canonical: boolean }>;
}

interface FoodItem {
  index: number;
  food_number: string;
  food_name: string;
  structured_food_name: string;
  rawRecord: string[];
}

interface CanonicalGroup {
  canonical_name: string;
  representative: string;
  members: string[];
}

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
// 進捗管理
// =====================================================

async function loadProgress(): Promise<Progress> {
  try {
    const content = await readFile(progressFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { processedIndices: [], foodMapping: {} };
  }
}

async function saveProgress(progress: Progress): Promise<void> {
  await writeFile(progressFile, JSON.stringify(progress, null, 2), 'utf-8');
}

// =====================================================
// AI処理
// =====================================================

interface ExistingMapping {
  food_number: string;
  food_name: string;
  canonical_name: string;
}

async function identifyCanonicalGroups(
  foods: FoodItem[],
  existingMappings: ExistingMapping[] = []
): Promise<{ groups: CanonicalGroup[]; cost: CostResult | null }> {
  const foodList = foods.map((f, idx) => {
    return `${idx + 1}. [${f.food_number}] ${f.food_name}`;
  }).join('\n');

  // 既存マッピングのコンテキストを作成
  let existingContext = '';
  if (existingMappings.length > 0) {
    const existingList = existingMappings.map(m => 
      `- [${m.food_number}] ${m.food_name} → 「${m.canonical_name}」`
    ).join('\n');
    existingContext = `
## 既存のグループ（確定済み・参照用）

以下の食品は既にグループ分けが確定しています。
新しい食品が同じ種類であれば、**既存の正規化名に統合してください**。

${existingList}

例：既存に「大麦めん」グループがあり、新しい食品に「大麦めん 焼き」があれば、
「大麦めん」グループに追加してください（新しいグループを作らない）。

`;
  }

  const prompt = `あなたは日本の食材データの専門家です。以下の食品リストを「正規化グループ」に分類してください。
${existingContext}

## 正規化グループとは

同じ食材の異なる状態をまとめたグループです。各グループには：
1. **正規化名（canonical_name）**: ユーザーが検索する際の代表的な名前（調理状態を含まない）
2. **代表食材（representative）**: グループ内で最も基本的な食材の番号
3. **メンバー（members）**: グループに属する全食材の番号

## 最重要ルール：調理状態の違いは同じグループ

**調理状態が違うだけの食材は必ず同じグループにまとめてください。**

- 「大麦めん 乾」と「大麦めん ゆで」→ 同じグループ「大麦めん」
- 「そうめん 乾」と「そうめん ゆで」→ 同じグループ「そうめん」
- 「鶏もも 生」と「鶏もも 焼き」と「鶏もも ゆで」→ 同じグループ「鶏もも肉」
- 「うどん 乾」と「うどん ゆで」→ 同じグループ「うどん」

## グループ化のルール

### 同じグループにすべきもの（同じ正規化名を持つ）：
- **調理状態違い**: 「生」「乾」「ゆで」「焼き」「蒸し」「フライ」「いため」など全て同じグループ
- 産地違い: 「国産」「輸入」「米国産」
- 等級違い: 「1等」「2等」
- 品質違い: 「軟質」「硬質」

### 別グループにすべきもの（異なる正規化名を持つ）：
- 基本食材が違う: 小麦 vs 大麦
- 加工形態が違う: 玄穀 vs 小麦粉 vs パン
- 製品種類が違う: 薄力粉 vs 強力粉 vs 中力粉 / うどん vs そうめん vs 中華めん
- 部位が違う: もも vs むね vs ささみ

## 具体例

### 例1：麺類
入力:
- [01008] おおむぎ　大麦めん　乾
- [01009] おおむぎ　大麦めん　ゆで

出力:
\`\`\`json
{
  "groups": [
    {
      "canonical_name": "大麦めん",
      "representative": "01008",
      "members": ["01008", "01009"]
    }
  ]
}
\`\`\`
※「乾」が代表、「ゆで」はバリエーション

### 例2：手延そうめん
入力:
- [01045] こむぎ　手延そうめん・手延ひやむぎ　乾
- [01046] こむぎ　手延そうめん・手延ひやむぎ　ゆで

出力:
\`\`\`json
{
  "groups": [
    {
      "canonical_name": "手延そうめん",
      "representative": "01045",
      "members": ["01045", "01046"]
    }
  ]
}
\`\`\`
※「乾」が代表、「ゆで」はバリエーション

### 例3：小麦
入力:
- [01012] こむぎ　［玄穀］　国産　普通
- [01013] こむぎ　［玄穀］　輸入　軟質
- [01015] こむぎ　［小麦粉］　薄力粉　1等
- [01016] こむぎ　［小麦粉］　薄力粉　2等

出力:
\`\`\`json
{
  "groups": [
    {
      "canonical_name": "小麦（玄穀）",
      "representative": "01012",
      "members": ["01012", "01013"]
    },
    {
      "canonical_name": "薄力粉",
      "representative": "01015",
      "members": ["01015", "01016"]
    }
  ]
}
\`\`\`

## 正規化名の付け方

- **調理状態を含まない**シンプルな名前にする
- 例：「おおむぎ　大麦めん　乾」→「大麦めん」（×「大麦めん（乾）」）
- 例：「こむぎ　手延そうめん　ゆで」→「手延そうめん」
- 例：「にわとり　もも　皮つき　生」→「鶏もも肉」

## 代表食材の選び方（重要）

**ユーザーがスーパーで最も入手しやすい形態**を代表に選んでください。

### 麺類の場合
- うどん → 「ゆでうどん」が代表（スーパーで最も一般的な形態）
- そうめん → 「乾」が代表（乾麺として売られている）
- パスタ → 「乾」が代表（乾麺として売られている）
- 中華めん → 「生」が代表（生麺として売られている）

### 肉・魚の場合
- 「生」が代表（精肉・鮮魚コーナーで売られている形態）

### 野菜・果物の場合
- 「生」が代表（青果コーナーで売られている形態）

### 穀物・粉類の場合
- 米 → 「精白米」が代表
- 小麦粉 → そのまま（薄力粉、強力粉など）

### 一般原則
1. **スーパーで最も一般的に売られている形態**を代表に
2. 等級があれば「1等」を代表に
3. 産地があれば「国産」を代表に
4. 迷ったら最初のものを代表に

## 食品リスト

${foodList}

## 出力形式

\`\`\`json
{
  "groups": [
    {
      "canonical_name": "正規化名",
      "representative": "代表の食品番号",
      "members": ["メンバーの食品番号", ...]
    },
    ...
  ]
}
\`\`\`

全食品を必ずどこかのグループに入れてください。単独の食品も1つのグループとして出力してください。`;

  const MODEL_NAME = 'gpt-4.1';

  try {
    const result = await generateText({
      model: openai(MODEL_NAME),
      prompt,
      temperature: 0.2,
    });

    // トークン使用量と料金を計算・表示
    const inputTokens = result.usage?.promptTokens || result.usage?.inputTokens || 0;
    const outputTokens = result.usage?.completionTokens || result.usage?.outputTokens || 0;
    const cost = calculateCost(MODEL_NAME, inputTokens, outputTokens);
    console.log(formatCost(cost));

    // JSONを抽出
    const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/) ||
                      result.text.match(/\{[\s\S]*"groups"[\s\S]*\}/);

    if (!jsonMatch) {
      console.error('JSONが見つかりませんでした:', result.text);
      throw new Error('JSONが見つかりませんでした');
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonText);
    const groups: CanonicalGroup[] = parsed.groups || [];

    // 有効な食品番号のみをフィルタ
    const validFoodNumbers = new Set(foods.map(f => f.food_number));
    const filteredGroups = groups.map(g => ({
      canonical_name: g.canonical_name,
      representative: validFoodNumbers.has(g.representative) ? g.representative : g.members[0],
      members: g.members.filter(m => validFoodNumbers.has(m)),
    })).filter(g => g.members.length > 0);

    return { groups: filteredGroups, cost };
  } catch (error) {
    console.error('AI生成エラー:', error);
    // エラー時は各食品を個別グループとして扱う
    return {
      groups: foods.map(f => ({
        canonical_name: f.food_name,
        representative: f.food_number,
        members: [f.food_number],
      })),
      cost: null,
    };
  }
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

  // ヘッダーのインデックスを取得
  const foodNumberIndex = headers.indexOf('food_number');
  const foodNameIndex = headers.indexOf('food_name');
  const structuredIndex = headers.indexOf('structured_food_name');

  if (foodNumberIndex === -1 || foodNameIndex === -1) {
    throw new Error('必要な列が見つかりません');
  }

  // 食品データを抽出
  const foods: FoodItem[] = dataRows.map((row, idx) => ({
    index: idx,
    food_number: row[foodNumberIndex] || '',
    food_name: row[foodNameIndex] || '',
    structured_food_name: structuredIndex !== -1 ? row[structuredIndex] || '' : '',
    rawRecord: row,
  }));

  // 食品番号→食品名のマップを作成
  const foodNumberToName = new Map<string, string>();
  for (const food of foods) {
    foodNumberToName.set(food.food_number, food.food_name);
  }

  // 進捗を読み込む
  const progress = await loadProgress();
  const processedSet = new Set(progress.processedIndices);
  const foodMapping = progress.foodMapping;

  console.log(`処理済みバッチ開始インデックス: ${processedSet.size}件`);
  console.log(`マッピング済み食品: ${Object.keys(foodMapping).length}件`);

  // ヘルパー関数: マッピングファイルを更新
  async function updateMappingFile() {
    // グループごとに整理
    const groupMap = new Map<string, { representative: string; members: string[] }>();
    
    for (const [foodNumber, info] of Object.entries(foodMapping)) {
      const name = info.canonical_name;
      if (!groupMap.has(name)) {
        groupMap.set(name, { representative: '', members: [] });
      }
      const group = groupMap.get(name)!;
      group.members.push(foodNumber);
      if (info.is_canonical) {
        group.representative = foodNumber;
      }
    }

    const groups = Array.from(groupMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, data]) => ({
        canonical_name: name,
        representative: data.representative,
        representative_name: foodNumberToName.get(data.representative) || '',
        members: data.members.sort().map(num => ({
          food_number: num,
          food_name: foodNumberToName.get(num) || '',
          is_canonical: num === data.representative,
        })),
      }));

    const mapping = {
      totalFoods: foods.length,
      mappedFoods: Object.keys(foodMapping).length,
      groupCount: groups.length,
      groups,
    };
    await writeFile(mappingFile, JSON.stringify(mapping, null, 2), 'utf-8');
  }

  // バッチ処理
  let totalCostUSD = 0;
  const totalBatches = Math.ceil((foods.length - OVERLAP_SIZE) / STEP_SIZE);

  for (let startIdx = 0; startIdx < foods.length; startIdx += STEP_SIZE) {
    // 既に処理済みのバッチはスキップ
    if (processedSet.has(startIdx)) {
      continue;
    }

    const endIdx = Math.min(startIdx + BATCH_SIZE, foods.length);
    const batch = foods.slice(startIdx, endIdx);

    // オーバーラップ部分は再処理対象として含める（後のバッチで修正可能にするため）
    // ただし、オーバーラップより前の部分（確定済み）は除外
    const overlapStart = startIdx;
    const confirmedBefore = startIdx > 0 ? startIdx : 0; // このバッチより前で確定した食品
    
    // バッチ内の食品を分類
    const confirmedFoods: FoodItem[] = []; // 確定済み（このバッチより前で処理）
    const processingFoods: FoodItem[] = []; // 今回処理対象
    
    for (const food of batch) {
      const foodIdx = food.index;
      // このバッチの開始位置より前で処理された食品は確定済み
      if (food.food_number in foodMapping && foodIdx < overlapStart) {
        confirmedFoods.push(food);
      } else {
        processingFoods.push(food);
      }
    }
    
    if (processingFoods.length === 0) {
      processedSet.add(startIdx);
      progress.processedIndices = Array.from(processedSet);
      await saveProgress(progress);
      continue;
    }

    // 確定済み食品のマッピング情報
    const confirmedMappings = confirmedFoods.map(f => ({
      food_number: f.food_number,
      food_name: f.food_name,
      canonical_name: foodMapping[f.food_number].canonical_name,
    }));

    const batchNum = Math.floor(startIdx / STEP_SIZE) + 1;
    console.log(`\nバッチ ${batchNum}/${totalBatches}: インデックス ${startIdx}-${endIdx - 1} (処理対象: ${processingFoods.length}件, 確定済み参照: ${confirmedMappings.length}件)`);
    console.log(`食品: ${processingFoods.slice(0, 3).map(f => f.food_name.substring(0, 20)).join(', ')}...`);

    // AI処理（確定済みマッピングをコンテキストとして渡す）
    const result = await identifyCanonicalGroups(processingFoods, confirmedMappings);

    // グループ情報をマッピングに追加
    for (const group of result.groups) {
      for (const member of group.members) {
        foodMapping[member] = {
          canonical_name: group.canonical_name,
          is_canonical: member === group.representative,
        };
      }
    }

    // 進捗を保存
    processedSet.add(startIdx);
    progress.processedIndices = Array.from(processedSet);
    progress.foodMapping = foodMapping;
    await saveProgress(progress);

    // マッピングファイルを更新（途中確認用）
    await updateMappingFile();

    if (result.cost) {
      totalCostUSD += result.cost.totalCostUSD;
    }

    const canonicalCount = result.groups.length;
    console.log(`グループ: ${canonicalCount}件検出 (累計マッピング: ${Object.keys(foodMapping).length}件)`);

    // 最後のバッチでなければ待機
    if (endIdx < foods.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // 結果をCSVに書き込み
  console.log('\n=== CSV出力 ===');
  const newHeaders = [...headers, 'canonical_name', 'is_canonical'];
  const outputRows: string[][] = [];

  // ヘッダー行
  outputRows.push(newHeaders.map(escapeCSVField));

  // データ行
  for (const food of foods) {
    const mapping = foodMapping[food.food_number];
    const canonicalName = mapping?.canonical_name || '';
    const isCanonical = mapping?.is_canonical ? 'TRUE' : 'FALSE';
    const newRow = [...food.rawRecord, canonicalName, isCanonical];
    outputRows.push(newRow.map(escapeCSVField));
  }

  // CSVファイルに書き込み
  const csvOutput = outputRows.map(row => row.join(',')).join('\n');
  await writeFile(outputFile, csvOutput, 'utf-8');
  console.log(`結果を保存: ${outputFile}`);

  // マッピングファイルを最終保存
  await updateMappingFile();
  console.log(`マッピングを保存: ${mappingFile}`);

  // 統計
  const canonicalCount = Object.values(foodMapping).filter(m => m.is_canonical).length;
  const variationCount = Object.values(foodMapping).filter(m => !m.is_canonical).length;

  console.log(`\n処理完了！`);
  console.log(`総食品数: ${foods.length}件`);
  console.log(`マッピング済み: ${Object.keys(foodMapping).length}件`);
  console.log(`代表食材: ${canonicalCount}件`);
  console.log(`バリエーション: ${variationCount}件`);
  console.log(`累計料金: $${totalCostUSD.toFixed(6)} (¥${(totalCostUSD * 150).toFixed(2)})`);
}

main().catch(console.error);
