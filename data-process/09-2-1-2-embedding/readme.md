# 09-2-1-2: MEXT食品名Embedding（英語翻訳版）

## 概要

09-2-1-1で翻訳した英語食品名をOpenAIのEmbeddingモデルでベクトル化します。
英語でembeddingすることで、USDAとの類似度計算の精度が向上します。

## 入力

- `../09-2-1-1-translate/result/translated-names.json` - 翻訳済み食品名

## 出力

- `result/batches/batch-XXXX.json` - バッチごとのEmbedding結果
  - 各ファイルには最大100件の食品が含まれる
  - 構造: `[{food_number, food_name_ja, food_name_en, embedding: number[]}]`
- `result/progress.json` - 進捗管理ファイル

## 使用モデル

- `text-embedding-3-large`

## バッチサイズ

- 100件ごとにEmbeddingを取得
- 1秒間隔でAPI呼び出し（レートリミット対策）

## 再実行

進捗ファイル（`result/progress.json`）を参照して、中断したところから再開可能です。
全てリセットする場合は `result/` ディレクトリを削除してください。

## 実行

```bash
pnpm run process:9-2-1-2
```
