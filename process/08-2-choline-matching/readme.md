# 08-2: コリンデータのマッチング

## 概要

MEXTの各食品に対して、USDAコリンデータベースから最適なマッチを見つけ、コリン値を追加します。

全てのUSDA食品名をプロンプトに含めて処理します。

## 入力

- `../07-normalize-headers/result/final-nutrition.csv` - MEXT栄養データ
- `../08-1-usda-choline/result/usda-choline.csv` - USDAコリンデータ

## 出力

- `result/choline-mapping.json` - マッチング結果
- `result/progress.json` - 進捗状態

## 実行

```bash
pnpm run process:8-2
```
