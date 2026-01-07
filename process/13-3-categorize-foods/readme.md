# 13-3: 食材の3段階分類

代表食材と一般レシピ食材を照合して、食材を3種類に分類します。

## 入力

- `../13-1-canonical-food-mark/result/final-nutrition-with-canonical.csv` – 正規化情報を含む全食材データ
- `../10-0/ingredients-structured.json` – 一般レシピ食材のリスト

## 処理内容

1. ingredients-structured.jsonから全ての食材名を抽出
2. 代表食材（is_canonical=TRUE）のcanonical_nameがingredients-structured.jsonに含まれるかチェック
3. 食材を3種類に分類：
   - **1: 一般レシピ食材** - 代表食材で、ingredients-structured.jsonに含まれる
   - **2: canonical-food** - 代表食材だが、ingredients-structured.jsonに含まれない
   - **3: その他** - バリエーション食材（is_canonical=FALSE）

## 出力

- `result/final-nutrition-categorized.csv` – `food_category`列を追加したCSV
  - `food_category`: "recipe_ingredient" | "canonical_food" | "variation"

## 実行

```bash
pnpm run process:13-3
```

