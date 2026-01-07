# 13-2: 食材リストの分割

13-1で正規化された食材データから、全食材リストと代表食材リストの2つを生成します。

## 入力

- `../13-1-canonical-food-mark/result/final-nutrition-with-canonical.csv` – 正規化情報を含む全食材データ

## 処理内容

1. 入力CSVを読み込む
2. 正規化名辞書（canonical-foods.json）を生成

## 出力

- `result/canonical-foods.json` – 正規化名辞書
  - キー: `canonical_name`（正規化名）
  - 値: そのグループに属する食材のリスト（`food_number`, `food_name`, `is_canonical`のみ）

## 実行

```bash
pnpm run process:13-2
```

