# プロセス 05-3-merge-extensions: 拡張データのマージ

## 概要

04-1の栄養データCSVに、05-1の検索キーワードと05-2のタグ名をマージして完成品を作成するプロセスです。

## 入力

1. **04-1**: `../04-1-merge-tables/result/merged-nutrition.csv` - 栄養データCSV
2. **05-1**: `../05-1-search-keys/result/search-keys.json` - 検索キーワード
3. **05-2**: `../05-2-tag-names/result/tag-names.json` - タグ名

## 出力

### `result/final-nutrition.csv`

04-1のCSVに以下のカラムを追加：

| カラム名 | 説明 |
|----------|------|
| searchKeys | 検索キーワード（JSON配列） |
| tagNameJa | 日本語タグ名 |
| tagNameJaDetail | 日本語詳細（オプション） |
| tagNameEn | 英語タグ名 |
| tagNameEnDetail | 英語詳細（オプション） |

## ファイル構造

```
process/05-3-merge-extensions/
├── index.ts
├── readme.md
└── result/
    └── final-nutrition.csv
```


