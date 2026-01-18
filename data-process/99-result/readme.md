# 99-result: 最終成果物集約

このフォルダには、成分表分析前処理プロジェクトの最終成果物が集約されています。

## 概要

12-1までの全処理を経て生成された最終的なデータセットと関連ドキュメントをまとめます。

## 入力

- `../12-1-merge-additional-foods/result/final-nutrition-with-egg-shell.csv` - 最終CSV（廃棄率・鶏卵殻追加済み）
- `../07-normalize-headers/result/column-metadata.json` - 列メタデータ（ベース）
- `../../sample-result/spec-additional.md` - LPモデル詳細仕様（存在する場合のみ）

## 実行

```bash
pnpm run process:99
```

## 出力

### データファイル

1. **`result/foods.csv`** - 最終的な食材データベース
2. **`result/column-metadata.json`** - CSV列のメタデータ

### ドキュメント

3. **`result/spec-additional.md`** - LPモデル詳細仕様（存在する場合のみ）
4. **`result/readme.md`** - データセットの説明

---

## データセットの詳細

### foods.csv

**最終的な栄養成分データCSVファイル**

- **エンコーディング**: UTF-8
- **列数**: 59列（廃棄率追加）

#### 列構成

| カテゴリ | 列数 | 主な列 |
|---------|------|--------|
| 基本情報 | 5 | `food_group`, `REFUSE`, `food_number`, `food_name`, `food_name_en` |
| 基本栄養素・エネルギー | 7 | `WATER`, `PROT-`, `FAT-`, `FIB-`, `ASH`, `ENERC_KCAL`, `ME_KCAL_100G` |
| ミネラル | 11 | `CA`, `P`, `NA`, `K`, `MG`, `FE`, `ZN`, `CU`, `MN`, `ID`, `SE` |
| ビタミン | 11 | `RETOL`, `VITD`, `TOCPHA`, `THIA`, `RIBF`, `NIA`, `VITB6A`, `VITB12`, `FOL`, `PANTAC`, `usda_choline_mg` |
| アミノ酸 | 14 | `ILE`, `LEU`, `LYS`, `MET`, `CYS`, `AAS`, `PHE`, `TYR`, `AAA`, `THR`, `TRP`, `VAL`, `HIS`, `ARG` |
| 脂肪酸 | 9 | `FACID`, `FAPU`, `FAPUN3`, `FAPUN6`, `F18D2N6`, `F18D3N3`, `F20D5N3`, `F22D6N3`, `F20D4N6` |
| メタデータ | 2 | `score`, `usda_fdc_id` |

### column-metadata.json

CSV各列の詳細メタデータ。LLMが列の意味を理解するためのリファレンス。

---

## データの使用例

### Python

```python
import pandas as pd

# CSVを読み込む
df = pd.read_csv('foods.csv')

# 高カルシウム食品を抽出
high_ca = df[df['CA'] > 100].sort_values('CA', ascending=False)

# スコア8以上の食品のみ抽出
good_foods = df[df['score'] >= 8]
```

### メタデータの参照

```python
import json

with open('column-metadata.json', 'r', encoding='utf-8') as f:
    metadata = json.load(f)

# 特定の列の情報を取得
for col in metadata['columns']:
    if col['columnName'] == 'PROT-':
        print(f"名前: {col['name']}")
        print(f"単位: {col.get('unit', 'N/A')}")
        print(f"カテゴリ: {col.get('category', 'N/A')}")
```

---

## データソース

- **MEXT 2023**: 日本食品標準成分表（八訂）増補2023年
- **MEXT アミノ酸成分表**: MEXT 2023 アミノ酸成分表
- **MEXT 脂肪酸成分表**: MEXT 2023 脂肪酸成分表
- **USDA FoodData Central**: SR Legacy Foods (2018)
- **鶏卵殻データ**: 12-0/egg-shell.md（手動追加）

---

## 処理パイプライン

```
00-original        元データ（MEXT Excel）
    ↓
01-csv             CSV変換
    ↓
02-food-name       食品名の構造化
    ↓
03-1               犬用食品スコアリング
    ↓
04-1               アミノ酸・脂肪酸データのマージ
    ↓
06-calculate-me    代謝エネルギー算出
    ↓
07-normalize       ヘッダー正規化
    ↓
09-1/09-2/09-3     USDA FoodData Centralマッチング（コリン取得）
    ↓
10-1               廃棄率の追加
    ↓
11-1               データクリーンアップ（不要列削除・並び替え）
    ↓
12-1               追加食材マージ（鶏卵殻）
    ↓
99-result          最終成果物集約 ← 現在地
```

---

## 注意事項

1. **データの欠損**: 一部の食品でアミノ酸・脂肪酸データが欠損しています

2. **単位の統一**: すべての値は「可食部100g当たり」です

3. **代謝エネルギー**: `ME_KCAL_100G`はmodified Atwater法で計算されています

4. **コリンデータ**: USDAデータベースからマッチングして追加されました。マッチしなかった食品は空欄です

5. **鶏卵殻**: 12-1で手動追加された食材です。カルシウム補給源として使用できます

6. **廃棄率**: 10-1で追加されました。購入重量から可食部重量を計算する際に使用します。廃棄率20%の場合、購入重量100gに対して可食部は80gとなります。
