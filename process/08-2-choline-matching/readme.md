# 08-2: コリンデータのマッチング

## 概要

MEXTの各食品に対して、USDAコリンデータベースから最適なマッチを見つけ、コリン値を追加します。

## 処理方式

AIツールコール方式を採用：

1. AIにMEXT食品の情報を渡す
2. AIが `search_usda` ツールを使って関連するUSDA食品を検索
3. AIが最適なマッチを選択、またはマッチなしと判断
4. マッチした場合はコリン値を適用

## ツール

### search_usda(query: string)

- キーワードでUSDA食品を検索
- 大文字小文字を正規化
- マッチ率でソート
- 上位30件を返す

## 入力

- `../07-normalize-headers/result/final-nutrition.csv` - MEXT栄養データ
- `../08-1-usda-choline/result/usda-choline.csv` - USDAコリンデータ

## 出力

- `result/choline-mapping.json` - マッチング結果（レビュー用）
- `result/final-with-choline.csv` - コリン追加済みCSV
- `result/progress.json` - 進捗状態（中断再開用）

## 実行

```bash
pnpm run process:8-2
```
