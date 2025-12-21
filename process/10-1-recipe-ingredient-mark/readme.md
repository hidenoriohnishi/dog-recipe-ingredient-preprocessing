# 10-1: レシピ実績食材マーキング

MEXTの栄養データ（`final-nutrition.csv`）の各食品について、`10-0/ingredients-structured.json`の最下層ラベルに該当するものをAIに判定させ、該当すれば「レシピ実績食材」としてフラグを追加したCSVを出力します。

## 入力

- `../10-0/ingredients-structured.json` – 犬のレシピで使用された食材ラベルの階層構造
- `../09-3-ai-select/result/final-nutrition.csv` – MEXT食品データ

## 処理内容

1. 食材ラベルを最下層まで展開し、各ラベルのパスと代表的な食材名をまとめてAIに提示
2. MEXT食品を20件ずつのバッチにまとめ、食品名・タグ・検索キーワードなどのメタ情報を添えてAIに送信
3. AIには「日常的に使われる食材を優先し、極端にマイナーな食材は慎重にラベル付けする」方針を与え、理由＋ラベルパスのみを出力させる
4. ラベルパスが1件でも返ってきた食品を`TRUE`とみなし、理由とともにCSVへ追記（空なら`FALSE`）
5. 各バッチ処理のたびに`progress.json`と`batch-results/batch-{n}.json`を更新するため、途中停止しても再開可能

## 出力

- `result/final-nutrition-with-recipe-flag.csv` – 元CSVに以下の列を追加した最終成果物
  - `recipe_ai_reason`: 判定理由（理由→フラグ→ラベルの順で追記）
  - `is_recipe_ingredient`: `TRUE` or `FALSE`
  - `recipe_label_paths`: AIが採用したラベルパス（複数の場合は" | "区切り）
- `result/progress.json` – 処理済み食品番号とヘッダー書き込み状態を保持
- `result/batch-results/batch-{n}.json` – バッチ単位のAI応答ログ

## 実行

```bash
pnpm run process:10-1
```

> **Note:** OpenAI APIキー (`OPENAI_API_KEY`) を設定してから実行してください。途中で終了した場合は同じコマンドを再実行すると未処理分から再開します。
