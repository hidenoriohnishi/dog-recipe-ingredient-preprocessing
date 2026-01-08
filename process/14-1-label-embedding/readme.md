# 14-1: ラベルEmbedding生成

ingredients-structured.jsonの各末端ラベルに対して、text-embedding-3-largeでembeddingを生成します。

## 目的

レシピで使用される食材ラベル（例：「切り干し大根」「小松菜」など）のembeddingを生成し、14-2の距離計算で使用します。

## 入力

- `../10-0/ingredients-structured.json` – レシピ食材の構造化データ

## 処理内容

1. ingredients-structured.jsonから末端ラベルを抽出
2. 各ラベルに対して:
   - ラベル名とバリエーションから検索テキストを生成
   - text-embedding-3-largeでembeddingを生成
3. 結果をJSONファイルに保存

## 出力

- `result/label-embeddings.json` – ラベルのembeddingデータ
- `result/progress.json` – 処理進捗

## 料金

- モデル: text-embedding-3-large
- 料金: $0.13 / 1M tokens

## 実行

```bash
pnpm run process:14-1
```

## 注意事項

- OpenAI APIキーが必要です（`.env`ファイルに`OPENAI_API_KEY`を設定）
- ネットワーク接続が必要です
- 途中で中断しても、progress.jsonに進捗が保存されているため、再実行時に続きから処理されます

