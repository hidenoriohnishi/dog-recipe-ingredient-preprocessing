# プロセス 07-normalize-headers: ヘッダー正規化

## 概要

06のCSVファイルのJSON形式ヘッダーを、通常の列名（適切な英語名）に変換するプロセスです。
元のJSONヘッダーが持っていた情報量を落とさずに、構造化ドキュメントとして別ファイルに保存します。

## 入力

1. **06**: `../06-calculate-me/result/final-nutrition.csv` - 代謝エネルギー計算済みCSV

## 出力

### `result/final-nutrition.csv`

通常の列名（英語）を使用したCSVファイル。

列名の生成ルール：
- `code`フィールドがある場合は、それを列名として使用（例: `WATER`, `PROT-`, `CA`など）
- `code`がない場合は、`name`から適切な英語名を生成
- 生の列名（JSONでない）は、スネークケースに変換

### `result/column-metadata.json`

元のJSONヘッダーの情報をすべて保持した構造化ドキュメント。

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

このメタデータファイルは、LLMがCSVの列の意味を理解する際の参考資料として使用できます。

## ファイル構造

```
process/07-normalize-headers/
├── index.ts
├── readme.md
└── result/
    ├── final-nutrition.csv
    └── column-metadata.json
```
