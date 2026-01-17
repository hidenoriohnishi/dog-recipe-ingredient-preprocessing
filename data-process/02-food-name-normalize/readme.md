# プロセス 02-food-name-normalize: 食品名の構造化

## 概要
CSVファイルの食品名列を構造化し、新しい列として追加するプロセスです。

## 入力
- `../01-csv/result/claude-json-header.csv` - CSV形式の成分表データ

## 処理内容
- CSVファイルを読み込む
- 各行の食品名（4列目）を`parseFoodName`関数で構造化
- 構造化されたデータをJSON文字列として「構造化食品名」列に追加
- 新しいCSVファイルとして出力

## 出力
- `result/claude-json-header-with-structured-names.csv` - 構造化食品名列が追加されたCSVファイル

## 構造化スキーマ
`food-name-scheme.ts`で定義されたスキーマを使用して、以下の情報を抽出します：
- `original`: 元の食品名
- `categoryPath`: カテゴリ階層
- `baseName`: 基本食品名
- `variety`: 品種・種類
- `part`: 部位
- `formModifiers`: 形態修飾子
- `productionMethod`: 生産方法
- `origin`: 産地
- `state`: 最終状態（調理・保存）
- `grade`: 等級
- `notes`: 補足情報

