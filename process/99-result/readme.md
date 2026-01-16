# 12-result: 最終成果物集約

このフォルダには、成分表分析前処理プロジェクトの最終成果物が集約されています。

## 概要

11-1までの全処理を経て生成された最終的なデータセットと関連ドキュメントをまとめます。

## 入力

- `../11-1-cooking-variations/result/final-nutrition-with-cooking-variations.csv` - 最終CSV
- `../11-1-cooking-variations/result/cooking-labels.json` - 調理ラベル定義
- `../07-normalize-headers/result/column-metadata.json` - 列メタデータ（ベース）
- `../../doc/spec.md` - 仕様書
- `../../sample-result/spec-additional.md` - LPモデル詳細仕様
- `../07-normalize-headers/SPEC_COMPARISON.md` - 仕様比較

## 実行

```bash
pnpm run process:12
```

## 出力

### データファイル

1. **`result/foods.csv`** - 最終的な食材データベース（全1,499件）
2. **`result/column-metadata.json`** - CSV列のメタデータ
3. **`result/cooking-labels.json`** - 調理ラベル定義とMEXTマッピング

### ドキュメント

4. **`result/spec.md`** - 犬の健康レシピ生成仕様書
5. **`result/spec-additional.md`** - LPモデル詳細仕様
6. **`result/SPEC_COMPARISON.md`** - spec.mdとの列名比較結果
7. **`result/readme.md`** - データセットの説明

---

## データセットの詳細

### foods.csv

**最終的な栄養成分データCSVファイル**

- **行数**: 1,500行（ヘッダー1行 + データ1,499行）
- **列数**: 77列
- **エンコーディング**: UTF-8

#### 列構成

| カテゴリ | 列数 | 主な列 |
|---------|------|--------|
| 基本情報 | 3 | `food_group`, `food_number`, `food_name` |
| 一般成分 | 5 | `WATER`, `PROT-`, `FAT-`, `FIB-`, `ASH` |
| エネルギー | 2 | `ENERC_KCAL`, `ME_KCAL_100G` |
| ミネラル | 11 | `CA`, `P`, `NA`, `K`, `MG`, `FE`, `ZN`, `CU`, `MN`, `ID`, `SE` |
| ビタミン | 11 | `RETOL`, `VITD`, `TOCPHA`, `THIA`, `RIBF`, `NIA`, `VITB6A`, `VITB12`, `FOL`, `PANTAC`, `CHOLN` |
| その他 | 3 | `structured_food_name`, `reason`, `score` |
| データフラグ | 2 | `has_amino_acid_data`, `has_fatty_acid_data` |
| アミノ酸 | 14 | `ILE`, `LEU`, `LYS`, `MET`, `CYS`, `AAS`, `PHE`, `TYR`, `AAA`, `THR`, `TRP`, `VAL`, `HIS`, `ARG` |
| 脂肪酸 | 9 | `FACID`, `FAPU`, `FAPUN3`, `FAPUN6`, `F18D2N6`, `F18D3N3`, `F20D5N3`, `F22D6N3`, `F20D4N6` |
| 拡張データ | 5 | `search_keys`, `tag_name_ja`, `tag_name_ja_detail`, `tag_name_en`, `tag_name_en_detail` |
| USDAマッチング | 6 | `usda_ndb_no`, `usda_food_name`, `usda_fdc_id`, `usda_description`, `usda_match_distance`, `usda_chlorine_mg`, `usda_choline_mg` |
| レシピ実績 | 2 | `is_recipe_ingredient`, `recipe_label_path` |
| 調理状態 | 2 | `cooking_label`, `cooking_variations` |

#### 調理ラベル（cooking_label）

| ラベル | 説明 | 件数 |
|--------|------|------|
| RAW | 調理なし（生） | 679件 |
| DRAINED | 茹でる（ゆで汁を捨てる） | 181件 |
| SEARED | 焼く・炒める | 124件 |
| FOOD_STATE | 加工済み状態（乾物、缶詰、冷凍など） | 123件 |
| SOUPED | 茹でる（汁ごと使う） | 44件 |
| STEAMED | 蒸す・電子レンジ | 20件 |
| FRIED | 揚げる | 6件 |

#### 調理バリエーション（cooking_variations）

同じ食材の異なる調理状態への参照をJSON形式で格納：

```json
{"DRAINED": ["06024"], "SEARED": ["06396", "06397"]}
```

### column-metadata.json

CSV各列の詳細メタデータ。LLMが列の意味を理解するためのリファレンス。

### cooking-labels.json

調理ラベルの定義とMEXT調理状態からのマッピング表。

```json
{
  "labels": {
    "RAW": {"ja": "調理なし", "description": "..."},
    ...
  },
  "mapping": {
    "生": "RAW",
    "ゆで": "DRAINED",
    ...
  }
}
```

---

## データの使用例

### Python

```python
import pandas as pd
import json

# CSVを読み込む
df = pd.read_csv('foods.csv')

# 調理バリエーションを解析
df['cooking_variations'] = df['cooking_variations'].apply(
    lambda x: json.loads(x) if pd.notna(x) and x else {}
)

# RAWの食品のみ抽出
raw_foods = df[df['cooking_label'] == 'RAW']

# レシピ実績のある食品のみ抽出
recipe_foods = df[df['is_recipe_ingredient'] == True]
```

### メタデータの参照

```python
with open('column-metadata.json', 'r', encoding='utf-8') as f:
    metadata = json.load(f)

# 特定の列の情報を取得
for col in metadata['columns']:
    if col['columnName'] == 'PROT-':
        print(f"名前: {col['name']}")
        print(f"単位: {col['unit']}")
        print(f"カテゴリ: {col['category']}")
```

---

## データソース

- **MEXT 2023**: 日本食品標準成分表（八訂）増補2023年
- **MEXT アミノ酸成分表**: MEXT 2023 アミノ酸成分表
- **MEXT 脂肪酸成分表**: MEXT 2023 脂肪酸成分表
- **USDA Choline Database**: USDA Database for the Choline Content of Common Foods, Release 2 (2008)
- **USDA FoodData Central**: SR Legacy Foods (2018)

---

## 処理パイプライン

```
00-original        元データ（MEXT Excel）
    ↓
01-csv             CSV変換
    ↓
02-food-name       食品名の構造化
    ↓
03-1/03-2          犬用食品スコアリング・フィルタ
    ↓
04-1               アミノ酸・脂肪酸データのマージ
    ↓
05-1/05-2/05-3     検索キー・タグ名生成
    ↓
06-calculate-me    代謝エネルギー算出
    ↓
07-normalize       ヘッダー正規化
    ↓
08-1/08-2/08-3     USDAコリンデータのマッチング
    ↓
09-1/09-2/09-3     USDA FoodData Centralマッチング
    ↓
10-1               レシピ実績食材マーキング
    ↓
11-1               調理状態バリエーション検出
    ↓
12-result          最終成果物集約 ← 現在地
```

---

## 注意事項

1. **データの欠損**: 一部の食品でアミノ酸・脂肪酸データが欠損しています（`has_amino_acid_data`, `has_fatty_acid_data`フラグで確認）

2. **単位の統一**: すべての値は「可食部100g当たり」です

3. **代謝エネルギー**: `ME_KCAL_100G`はmodified Atwater法で計算されています

4. **調理バリエーション**: 同じ食材の異なる調理状態を`cooking_variations`で参照できます

5. **コリンデータ**: USDAデータベースからマッチングして追加されました。マッチしなかった食品は空欄です

