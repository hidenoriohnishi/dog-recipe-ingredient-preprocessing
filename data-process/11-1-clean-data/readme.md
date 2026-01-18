# 11-1-clean-data: データクリーンアップ

10-1までのデータをクリーンアップします。

## 入力
- `10-1-add-refuse-rate/result/final-nutrition-with-refuse-rate.csv`

## 処理
不要になった以下のカラムを削除します：
- `structured_food_name`: 食品名の構造化データ（もう使用しない）
- `has_amino_acid_data`: アミノ酸データの有無フラグ
- `has_fatty_acid_data`: 脂肪酸データの有無フラグ
- `reason`: スコア付けの理由（もう使用しない）

また、カラムを論理的な順序に並び替えます。

## 出力
- `result/cleaned-final-nutrition.csv`: クリーンアップされたCSVファイル