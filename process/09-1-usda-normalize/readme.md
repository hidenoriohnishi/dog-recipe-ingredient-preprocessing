# 09-1: USDA前処理・正規化

USDA SR Legacyデータを正規化し、各食品の栄養素データをJSON形式でまとめます。

## 入力

- `../09-0/FoodData_Central_sr_legacy_food_csv_2018-04/food.csv` - 食品マスタ
- `../09-0/FoodData_Central_sr_legacy_food_csv_2018-04/food_nutrient.csv` - 食品-栄養素マッピング
- `../09-0/FoodData_Central_sr_legacy_food_csv_2018-04/nutrient.csv` - 栄養素マスタ

## 処理内容

1. 3つのCSVファイルを読み込み
2. 各食品（fdc_id）について、栄養素IDと値のマッピングを作成
3. 栄養素名と単位情報を結合
4. JSON形式で出力

## 出力

- `result/usda-foods.json` - 正規化されたUSDA食品データ

### JSON構造

```json
{
  "167512": {
    "fdc_id": "167512",
    "description": "Pillsbury Golden Layer Buttermilk Biscuits...",
    "food_category_id": "18",
    "nutrients": {
      "1003": {
        "name": "Protein",
        "amount": 5.88,
        "unit": "G"
      },
      "1004": {
        "name": "Total lipid (fat)",
        "amount": 13.24,
        "unit": "G"
      }
    }
  }
}
```

## 実行

```bash
pnpm run process:9-1
```
