# 13-4: カテゴリ別食材リスト

3つのレイヤーごとに食材名のリストを生成します。

## 入力

- `../13-3-categorize-foods/result/final-nutrition-categorized.csv` – カテゴリ分類済みの食材データ

## 処理内容

1. CSVを読み込む
2. `food_category`で分類
3. 各カテゴリごとに食材名（`food_name`）のリストを生成

## 出力

- `result/food-lists-by-category.json` – カテゴリ別食材名リスト
  ```json
  {
    "recipe_ingredient": ["食材名1", "食材名2", ...],
    "canonical_food": ["食材名1", "食材名2", ...],
    "variation": ["食材名1", "食材名2", ...]
  }
  ```

## 実行

```bash
pnpm run process:13-4
```

