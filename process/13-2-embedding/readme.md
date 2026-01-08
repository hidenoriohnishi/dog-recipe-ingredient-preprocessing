# 13-2: Embedding生成

text-embedding-3-largeを使用して、食材のembedding textからベクトルデータを生成します。

## 目的

ベクトルデータベースに投入するために、食材のembedding textをベクトル化します。

## 入力

- `../13-1-vector-db-extract/result/vector-db-data.csv` – embedding textデータ

## 処理内容

1. CSVを読み込む
2. バッチ処理（100件ずつ）でOpenAI Embedding APIを呼び出す
3. 各食材のembedding textに対してベクトルデータを取得
4. 結果をJSONファイルに保存
5. 料金を表示

## 出力

- `result/embeddings.json` – ベクトルデータ（food_number, food_name, embedding_text, embedding）
- `result/progress.json` – 処理進捗

## 料金

- モデル: text-embedding-3-large
- 料金: $0.13 / 1M tokens

## 実行

```bash
pnpm run process:13-2
```

## 注意事項

- OpenAI APIキーが必要です（`.env`ファイルに`OPENAI_API_KEY`を設定）
- ネットワーク接続が必要です
- 途中で中断しても、progress.jsonに進捗が保存されているため、再実行時に続きから処理されます

