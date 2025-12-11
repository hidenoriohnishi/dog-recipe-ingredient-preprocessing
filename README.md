# 成分表分析 前処理プロジェクト

このプロジェクトでは、成分表データを段階的に加工していきます。

### 00-original
元のデータファイルを格納しています。
- **入力**: なし（元データ）
- **内容**: 成分分析表のXLSファイルで、Header部分が多段の結合セルとなっているため、Claudeを使って整形したデータ
- **出力**: `result/claude-json-header.xlsx`

### 01-csv: CSVに変更
ExcelファイルをCSV形式に変換します。
- **入力**: `00-original/result/claude-json-header.xlsx`
- **処理**: Excelファイルを読み込み、最初のシートをCSV形式に変換
- **出力**: `result/claude-json-header.csv`

### 02-food-name-normalize: 食品名の構造化
CSVファイルの食品名列を構造化し、新しい列として追加します。
- **入力**: `01-csv/result/claude-json-header.csv`
- **処理**: 各行の食品名（4列目）を`parseFoodName`関数で構造化し、JSON文字列として新しい列に追加
- **出力**: `result/claude-json-header-with-structured-names.csv`