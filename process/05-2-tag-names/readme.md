# プロセス 05-2-tag-names: タグ名生成

## 概要

各食品に対して、UIで表示する際の最適なタグ名を日本語・英語の2言語で生成するプロセスです。

## 入力

### 入力ファイル

1. **04-1の結果**: `../04-1-merge-tables/result/merged-nutrition.csv`
   - 食品番号、食品名、構造化食品名
   
2. **05-1の結果**: `../05-1-search-keys/result/search-keys.json`
   - 検索キーワード一覧（参考情報として使用）

## 処理内容

AIを使用して、各食品に対して最も適切なタグ名を生成：

- **日本語タグ名**: 日本語で最も一般的で適切な呼び名
- **英語タグ名**: 英語で最も一般的で適切な呼び名

### タグ名の要件

1. **簡潔で分かりやすい**
2. **調理状態や品種は含めない**（ベースの食材名のみ）
3. **UIに表示することを想定**

## 出力

### `result/tag-names.json`

```json
{
  "01005": {
    "ja": "大麦",
    "jaDetail": "押麦（七分つき）",
    "en": "Barley",
    "enDetail": "Rolled (70% polished)"
  },
  "01006": {
    "ja": "大麦",
    "jaDetail": "押麦（乾燥）",
    "en": "Barley",
    "enDetail": "Rolled (Dried)"
  },
  ...
}
```

- **ja / en**: ベースの食材名（検索・分類用）
- **jaDetail / enDetail**: 詳細情報（選択時に区別するため）

### `result/progress.json`

処理進捗を記録するJSONファイル。

## 技術仕様

- **使用モデル**: gpt-5-mini-2025-08-07
- **バッチサイズ**: 20件

## ファイル構造

```
process/05-2-tag-names/
├── index.ts
├── readme.md
└── result/
    ├── tag-names.json
    └── progress.json
```
