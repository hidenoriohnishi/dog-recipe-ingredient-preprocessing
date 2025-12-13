# 最終成果物

このフォルダには、成分表分析前処理プロジェクトの最終成果物が含まれています。

## ファイル一覧

### 1. `final-nutrition.csv`

**最終的な栄養成分データCSVファイル**

- **行数**: 1,314行（ヘッダー1行 + データ1,313行）
- **列数**: 64列
- **エンコーディング**: UTF-8
- **形式**: 通常のCSV（ヘッダーは英語の列名）

#### 主な列の構成

1. **基本情報（3列）**
   - `food_group`: 食品群（食品分類グループ番号）
   - `food_number`: 食品番号（食品固有の識別番号）
   - `food_name`: 食品名

2. **一般成分（5列）**
   - `WATER`: 水分（g/100g）
   - `PROT-`: たんぱく質（g/100g）
   - `FAT-`: 脂質（g/100g）
   - `FIB-`: 食物繊維総量（g/100g）
   - `ASH`: 灰分（g/100g）

3. **エネルギー（2列）**
   - `ENERC_KCAL`: エネルギー（kcal/100g）
   - `ME_KCAL_100G`: 代謝エネルギー（kcal/100g、計算値）

4. **ミネラル（10列）**
   - `CA`, `P`, `NA`, `K`, `MG`, `FE`, `ZN`, `CU`, `MN`, `ID`, `SE`

5. **ビタミン（10列）**
   - `RETOL`, `VITD`, `TOCPHA`, `THIA`, `RIBF`, `NIA`, `VITB6A`, `VITB12`, `FOL`, `PANTAC`

6. **その他（3列）**
   - `structured_food_name`: 構造化食品名（JSON形式）
   - `reason`: 犬用レシピ素材として選定した理由
   - `score`: スコア（1-10）

7. **データ完全性フラグ（2列）**
   - `has_amino_acid_data`: アミノ酸データの有無（1/0）
   - `has_fatty_acid_data`: 脂肪酸データの有無（1/0）

8. **アミノ酸（14列）**
   - `ILE`, `LEU`, `LYS`, `MET`, `CYS`, `AAS`, `PHE`, `TYR`, `AAA`, `THR`, `TRP`, `VAL`, `HIS`, `ARG`

9. **脂肪酸（9列）**
   - `FACID`: 脂肪酸総量
   - `FAPU`: 多価不飽和脂肪酸
   - `FAPUN3`: n-3系多価不飽和脂肪酸
   - `FAPUN6`: n-6系多価不飽和脂肪酸
   - `F18D2N6`: リノール酸
   - `F18D3N3`: α-リノレン酸
   - `F20D5N3`: EPA（イコサペンタエン酸）
   - `F22D6N3`: DHA（ドコサヘキサエン酸）
   - `F20D4N6`: アラキドン酸

10. **拡張データ（5列）**
    - `search_keys`: 検索キーワード（JSON配列）
    - `tag_name_ja`: 日本語タグ名
    - `tag_name_ja_detail`: 日本語タグ名詳細
    - `tag_name_en`: 英語タグ名
    - `tag_name_en_detail`: 英語タグ名詳細

#### データの特徴

- すべての値は「可食部100g当たり」の単位
- 空欄や`-`は未測定または検出されなかったことを示す
- 括弧付きの値（例: `(0)`, `(550)`）は推定値または計算値
- `ME_KCAL_100G`はmodified Atwater法で計算された代謝エネルギー

### 2. `column-metadata.json`

**CSV列のメタデータ（構造化ドキュメント）**

- **形式**: JSON
- **用途**: LLMがCSVの列の意味を理解する際の参考資料

#### 構造

```json
{
  "version": "1.0",
  "description": "CSV列のメタデータ（元のJSONヘッダー情報を保持）",
  "columns": [
    {
      "columnIndex": 0,
      "columnName": "food_group",
      "type": "identifier",
      "name": "食品群",
      "description": "食品分類グループ番号（2桁）",
      "originalHeader": "{...}"
    },
    ...
  ]
}
```

#### 各列のメタデータに含まれる情報

- `columnIndex`: 列のインデックス（0始まり）
- `columnName`: CSVで使用されている列名
- `type`: 列のタイプ（identifier, nutrient, flag, extensionなど）
- `name`: 日本語名
- `description`: 説明
- `unit`: 単位
- `code`: MEXTコード
- `category`: カテゴリ（一般成分、無機質、ビタミンなど）
- `originalHeader`: 元のJSON形式ヘッダー（完全な情報を保持）

このファイルにより、LLMは各列の意味、単位、カテゴリなどの詳細情報を参照できます。

### 3. `spec.md`

**犬の健康レシピ生成仕様書**

- **内容**: 線型計画法とLLMを使用したレシピ生成システムの完全な仕様
- **主要セクション**:
  - コンディション入力
  - 1日必要エネルギー（kcal/day）の算出
  - 栄養基準（AAFCO：1000 kcal MEあたり）
  - 制約の重要度と適用方式
  - 食材安全フィルタ
  - 日本（MEXT 2023）データの使用と正規化
  - 単位変換（AAFCO ⇄ MEXT）
  - 最適化（線型計画）
  - 出力形式
  - データ品質に関する注記

この仕様書に基づいて、`final-nutrition.csv`のデータが加工されています。

### 4. `SPEC_COMPARISON.md`

**spec.mdとの列名比較結果**

- **内容**: spec.md 6.2節「正規化スキーマ（Canonical）」で指定されている列名と、実際に生成されたCSVの列名の比較結果
- **結論**: 
  - spec.md 6.2節は理想的な形式を示しているが、実際の実装ではMEXTの元のコード名を使用
  - spec.md 11.7節「食材データベースのカラム構成」とは一致している
  - メタデータファイルにより、列の意味は完全に保持されている

## データの使用例

### CSVの読み込み例（Python）

```python
import pandas as pd

# CSVを読み込む
df = pd.read_csv('final-nutrition.csv')

# 特定の栄養素でフィルタリング
high_protein = df[df['PROT-'] > 20]

# 代謝エネルギーでソート
sorted_by_me = df.sort_values('ME_KCAL_100G', ascending=False)
```

### メタデータの参照例

```python
import json

# メタデータを読み込む
with open('column-metadata.json', 'r', encoding='utf-8') as f:
    metadata = json.load(f)

# 特定の列の情報を取得
for col in metadata['columns']:
    if col['columnName'] == 'WATER':
        print(f"列名: {col['columnName']}")
        print(f"説明: {col['description']}")
        print(f"単位: {col['unit']}")
        break
```

## データソース

- **MEXT 2023**: 日本食品標準成分表（八訂）増補2023年
- **アミノ酸成分表**: MEXT 2023 アミノ酸成分表
- **脂肪酸成分表**: MEXT 2023 脂肪酸成分表

## 注意事項

1. **データの欠損**: 一部の食品でアミノ酸・脂肪酸データが欠損している場合があります（`has_amino_acid_data`, `has_fatty_acid_data`フラグで確認可能）

2. **単位の統一**: すべての値は「可食部100g当たり」の単位です。レシピ生成時は適切に変換してください。

3. **代謝エネルギー**: `ME_KCAL_100G`はmodified Atwater法で計算されています。spec.md 6.3節を参照してください。

4. **列名の命名規則**: spec.md 6.2節の理想的な形式（`protein_g_100g`など）ではなく、MEXTの元のコード名（`PROT-`など）を使用しています。詳細は`SPEC_COMPARISON.md`を参照してください。

## 次のステップ

このデータを使用して、以下の処理を実行できます：

1. **レシピ生成**: 線型計画法を使用して、AAFCO栄養基準を満たすレシピを生成
2. **栄養分析**: 各食材の栄養価を分析
3. **検索機能**: `search_keys`を使用した食材検索
4. **タグ分類**: `tag_name_ja`、`tag_name_en`を使用した食材分類

詳細は`spec.md`を参照してください。
