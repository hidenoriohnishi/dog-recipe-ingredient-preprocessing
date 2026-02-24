import { mkdir, readFile, writeFile, copyFile, access } from "fs/promises";
import { constants } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resultDir = join(__dirname, "result");

// 入力ファイル
const inputFiles = {
  csv: join(__dirname, "../13-1-add-tags/result/final-nutrition-with-tags.csv"),
  columnMetadata: join(__dirname, "../07-normalize-headers/result/column-metadata.json"),
  specAdditional: join(__dirname, "../../sample-result/spec-additional.md"),
  readme: join(__dirname, "readme.md"),
};

// 出力ファイル
const outputFiles = {
  csv: join(resultDir, "foods.csv"),
  columnMetadata: join(resultDir, "column-metadata.json"),
  specAdditional: join(resultDir, "spec-additional.md"),
  readme: join(resultDir, "readme.md"),
};

// 10-1/11-1/12-1で使用される最終的なカラム順序
const FINAL_COLUMN_ORDER = [
  // 1. 基本情報（識別子）
  'food_group',
  'REFUSE',
  'food_number',
  'food_name',
  'food_name_en',
  
  // 2. 基本栄養素・エネルギー
  'WATER',
  'PROT-',
  'FAT-',
  'FIB-',
  'ASH',
  'ENERC_KCAL',
  'ME_KCAL_100G',
  
  // 3. ミネラル（13種）
  'CA',
  'P',
  'NA',
  'K',
  'MG',
  'FE',
  'ZN',
  'CU',
  'MN',
  'ID',
  'SE',
  'CR',
  'MO',
  'usda_iodine_ug',
  'usda_selenium_ug',
  'usda_chromium_ug',
  'usda_molybdenum_ug',
  
  // 4. ビタミン（12種 + コリン + USDA補完）
  'RETOL',
  'VITD',
  'TOCPHA',
  'THIA',
  'RIBF',
  'NIA',
  'VITB6A',
  'VITB12',
  'FOL',
  'PANTAC',
  'VITK',
  'BIOT',
  'usda_choline_mg',
  'usda_biotin_ug',
  'usda_vitamin_k_ug',
  'usda_vitamin_c_mg',
  
  // 5. アミノ酸（14種）
  'ILE',
  'LEU',
  'LYS',
  'MET',
  'CYS',
  'AAS',
  'PHE',
  'TYR',
  'AAA',
  'THR',
  'TRP',
  'VAL',
  'HIS',
  'ARG',
  
  // 6. 脂肪酸（9種）
  'FACID',
  'FAPU',
  'FAPUN3',
  'FAPUN6',
  'F18D2N6',
  'F18D3N3',
  'F20D5N3',
  'F22D6N3',
  'F20D4N6',
  
  // 7. メタデータ（スコア・参照情報）
  'score',
  'usda_fdc_id',
  
  // 8. タグ情報（ユーザー向け）
  'tag_name',
  'diff',
  'search_keywords'
];

interface ColumnMetadataItem {
  columnIndex: number;
  columnName: string;
  originalHeader?: string;
  type?: string;
  name?: string;
  description?: string;
  unit?: string;
  category?: string;
  subcategory?: string;
  code?: string;
  basis?: string;
  [key: string]: unknown;
}

interface ColumnMetadata {
  version: string;
  description: string;
  columns: ColumnMetadataItem[];
}

/**
 * カラムメタデータを最終CSVに合わせて更新
 */
async function updateColumnMetadata(): Promise<void> {
  // 既存のメタデータを読み込み
  const content = await readFile(inputFiles.columnMetadata, "utf-8");
  const originalMetadata: ColumnMetadata = JSON.parse(content);

  // 07-のメタデータからカラム名でマップを作成
  const columnMap = new Map<string, ColumnMetadataItem>();
  for (const col of originalMetadata.columns) {
    columnMap.set(col.columnName, col);
  }

  // 追加カラムの定義
  const additionalColumns: Record<string, Partial<ColumnMetadataItem>> = {
    food_name_en: {
      type: "identifier",
      name: "食品名（英語）",
      description: "食品の英語名称"
    },
    REFUSE: {
      type: "nutrient",
      basis: "購入重量に対する割合",
      category: "基本情報",
      name: "廃棄率",
      unit: "%",
      code: "REFUSE",
      description: "食品の廃棄部分の割合。購入重量100gに対して廃棄部分が20%の場合、可食部は80gとなります。"
    },
    usda_choline_mg: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ビタミン",
      name: "コリン（USDA）",
      unit: "mg",
      code: "CHOLN_USDA",
      description: "USDA FoodData Centralからマッチングしたコリン含有量"
    },
    usda_iodine_ug: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ミネラル",
      name: "ヨウ素（USDA）",
      unit: "μg",
      code: "ID_USDA",
      description: "USDA FoodData Centralからマッチングしたヨウ素含有量（MEXT欠損補完用）"
    },
    usda_selenium_ug: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ミネラル",
      name: "セレン（USDA）",
      unit: "μg",
      code: "SE_USDA",
      description: "USDA FoodData Centralからマッチングしたセレン含有量（MEXT欠損補完用）"
    },
    usda_chromium_ug: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ミネラル",
      name: "クロム（USDA）",
      unit: "μg",
      code: "CR_USDA",
      description: "USDA FoodData Centralからマッチングしたクロム含有量（MEXT欠損補完用）"
    },
    usda_molybdenum_ug: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ミネラル",
      name: "モリブデン（USDA）",
      unit: "μg",
      code: "MO_USDA",
      description: "USDA FoodData Centralからマッチングしたモリブデン含有量（MEXT欠損補完用）"
    },
    usda_biotin_ug: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ビタミン",
      name: "ビオチン（USDA）",
      unit: "μg",
      code: "BIOT_USDA",
      description: "USDA FoodData Centralからマッチングしたビオチン含有量（MEXT欠損補完用）"
    },
    usda_vitamin_k_ug: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ビタミン",
      name: "ビタミンK（USDA）",
      unit: "μg",
      code: "VITK_USDA",
      description: "USDA FoodData CentralからマッチングしたビタミンK含有量（MEXT欠損補完用）"
    },
    usda_vitamin_c_mg: {
      type: "nutrient",
      basis: "可食部100g当たり",
      category: "ビタミン",
      name: "ビタミンC（USDA）",
      unit: "mg",
      code: "VITC_USDA",
      description: "USDA FoodData CentralからマッチングしたビタミンC含有量（MEXT欠損補完用）"
    },
    usda_fdc_id: {
      type: "identifier",
      name: "USDA FDC ID",
      description: "USDA FoodData Central ID（マッチした場合）"
    },
    score: {
      type: "metadata",
      name: "スコア",
      description: "犬のレシピ素材適性スコア（1-10）"
    },
    tag_name: {
      type: "tag",
      name: "タグネーム",
      description: "ユーザーが最も自然に呼ぶ食材の名前。短くシンプルなもの。",
      category: "タグ情報"
    },
    diff: {
      type: "tag",
      name: "差分",
      description: "同じタグネームを持つ食材を区別するための情報。調理方法、部位、状態などを表す。",
      category: "タグ情報"
    },
    search_keywords: {
      type: "tag",
      name: "サーチキーワード",
      description: "検索時に使用するキーワード。漢字表記、別名、表記揺れなどを含む。スペース区切りで複数指定可能。",
      category: "タグ情報"
    }
  };

  // 新しいメタデータを構築
  const newColumns: ColumnMetadataItem[] = [];
  
  for (let i = 0; i < FINAL_COLUMN_ORDER.length; i++) {
    const columnName = FINAL_COLUMN_ORDER[i];
    
    // 既存のメタデータから取得
    const existingCol = columnMap.get(columnName);
    
    if (existingCol) {
      // 既存のメタデータを使用（インデックスを更新）
      newColumns.push({
        ...existingCol,
        columnIndex: i
      });
    } else if (additionalColumns[columnName]) {
      // 追加カラムの定義を使用
      const additional = additionalColumns[columnName];
      newColumns.push({
        columnIndex: i,
        columnName: columnName,
        originalHeader: JSON.stringify(additional),
        ...additional
      } as ColumnMetadataItem);
    } else {
      // 未定義のカラム（警告）
      console.warn(`警告: カラム ${columnName} のメタデータが見つかりません`);
      newColumns.push({
        columnIndex: i,
        columnName: columnName,
        type: "unknown",
        name: columnName
      });
    }
  }

  // 新しいメタデータオブジェクトを作成
  const newMetadata: ColumnMetadata = {
    version: "2.2",
    description: "CSV列のメタデータ（13-1処理完了版、タグ情報追加）",
    columns: newColumns
  };

  await writeFile(outputFiles.columnMetadata, JSON.stringify(newMetadata, null, 2), "utf-8");
}

async function main() {
  await mkdir(resultDir, { recursive: true });

  console.log("=== 99-result: 最終成果物集約 ===\n");

  // 1. CSVファイルをコピー
  console.log("1. CSVファイルをコピー...");
  await copyFile(inputFiles.csv, outputFiles.csv);
  console.log(`   入力: ${inputFiles.csv}`);
  console.log(`   出力: ${outputFiles.csv}`);

  // 2. 列メタデータを更新して保存
  console.log("\n2. 列メタデータを更新...");
  await updateColumnMetadata();
  console.log(`   出力: ${outputFiles.columnMetadata}`);

  // 3. spec-additional.mdをコピー（存在する場合のみ）
  console.log("\n3. spec-additional.mdをコピー...");
  try {
    await access(inputFiles.specAdditional, constants.F_OK);
    await copyFile(inputFiles.specAdditional, outputFiles.specAdditional);
    console.log(`   入力: ${inputFiles.specAdditional}`);
    console.log(`   出力: ${outputFiles.specAdditional}`);
  } catch {
    console.log(`   スキップ: ${inputFiles.specAdditional} が見つかりません`);
  }

  // 4. readme.mdをコピー
  console.log("\n4. readme.mdをコピー...");
  await copyFile(inputFiles.readme, outputFiles.readme);
  console.log(`   出力: ${outputFiles.readme}`);

  // 統計情報を表示
  console.log("\n=== 統計情報 ===");
  const csvContent = await readFile(outputFiles.csv, "utf-8");
  const lines = csvContent.split("\n").filter(line => line.trim());
  console.log(`CSVファイル: ${lines.length}行（ヘッダー1行 + データ${lines.length - 1}行）`);

  const headers = lines[0].split(",");
  console.log(`列数: ${headers.length}列`);

  // カラム構成を表示
  console.log("\n=== カラム構成 ===");
  const categories = [
    { name: "基本情報", cols: ["food_group", "REFUSE", "food_number", "food_name", "food_name_en"] },
    { name: "基本栄養素・エネルギー", cols: ["WATER", "PROT-", "FAT-", "FIB-", "ASH", "ENERC_KCAL", "ME_KCAL_100G"] },
    { name: "ミネラル", cols: ["CA", "P", "NA", "K", "MG", "FE", "ZN", "CU", "MN", "ID", "SE", "CR", "MO", "usda_iodine_ug", "usda_selenium_ug", "usda_chromium_ug", "usda_molybdenum_ug"] },
    { name: "ビタミン", cols: ["RETOL", "VITD", "TOCPHA", "THIA", "RIBF", "NIA", "VITB6A", "VITB12", "FOL", "PANTAC", "VITK", "BIOT", "usda_choline_mg", "usda_biotin_ug", "usda_vitamin_k_ug", "usda_vitamin_c_mg"] },
    { name: "アミノ酸", cols: ["ILE", "LEU", "LYS", "MET", "CYS", "AAS", "PHE", "TYR", "AAA", "THR", "TRP", "VAL", "HIS", "ARG"] },
    { name: "脂肪酸", cols: ["FACID", "FAPU", "FAPUN3", "FAPUN6", "F18D2N6", "F18D3N3", "F20D5N3", "F22D6N3", "F20D4N6"] },
    { name: "メタデータ", cols: ["score", "usda_fdc_id"] },
    { name: "タグ情報", cols: ["tag_name", "diff", "search_keywords"] }
  ];

  for (const cat of categories) {
    console.log(`  ${cat.name}: ${cat.cols.length}列`);
  }

  console.log("\n処理が完了しました！");
  console.log(`\n成果物は ${resultDir} に保存されました。`);
}

main().catch((error) => {
  console.error("エラーが発生しました:", error);
  process.exit(1);
});
