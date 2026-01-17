# プロセス 01-csv: CSVに変更

## 概要
Excelファイル（.xlsx）をCSV形式に変換するプロセスです。

## 入力
- `../00-original/result/claude-json-header.xlsx` - 元のExcelファイル

## 処理内容
- Excelファイルを読み込む
- 最初のシートをCSV形式に変換する
- UTF-8エンコーディングでCSVファイルとして出力する

## 出力
- `result/claude-json-header.csv` - 変換されたCSVファイル

