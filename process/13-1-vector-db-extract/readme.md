# 13-1: ベクトルDB用embedding text生成

ベクトルデータベースに投入するためのembedding textを生成します。

## 目的

ベクトルデータベースに投入するために、食材に関する説明データからembedding textを生成します。

## 入力

- `../12-1-add-egg-shell/result/final-nutrition-with-egg-shell.csv`

## 処理内容

1. CSVを読み込む
2. 以下のフィールドから単語を抽出：
   - `food_name`: 全角スペース、中黒（・）などで分割
   - `search_keys`: JSON配列としてパースし、各要素を使用
   - `tag_name_ja`: 単語に分割
   - `tag_name_en`: 単語に分割
3. 各単語に対して以下の処理を実行：
   - かっこなどの記号を削除（`[`、`]`、`（`、`）`、`＜`、`＞`など）
   - 英単語は小文字に変換し、複数形を単数形に変換（`pluralize`ライブラリを使用）
4. `tag_name_en`について、bigram（2単語の組み合わせ）を生成して1つの単語として扱う
   - 例：「Rolled Barley」→「rolled」「barley」「rolled barley」の3つが追加される
5. 全ての単語をSetに入れて重複を排除
6. ソートして半角スペースで結合してembedding_textとする
7. 新しいCSVファイルに出力

## 依存関係

- `pluralize`: 英語の複数形を単数形に変換するライブラリ

インストール方法：
```bash
npm install pluralize
npm install --save-dev @types/pluralize
```

## 出力

- `result/vector-db-data.csv` – embedding textデータ（food_number, food_name, embedding_text）

## 実行

```bash
pnpm run process:13-1
```
