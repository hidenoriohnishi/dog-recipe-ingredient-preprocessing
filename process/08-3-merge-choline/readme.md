# 08-3: コリンデータの統合

## 概要

08-2で作成したコリンマッピング結果をMEXTデータに統合し、最終CSVを生成します。

## 入力

- `../07-normalize-headers/result/final-nutrition.csv` - MEXT栄養データ
- `../07-normalize-headers/result/column-metadata.json` - 列メタデータ
- `../08-2-choline-matching/result/choline-mapping.json` - コリンマッピング結果

## 出力

- `result/final-with-choline.csv` - コリン追加済みCSV
- `result/column-metadata.json` - コリン列を含む列メタデータ

## 実行

```bash
pnpm run process:8-3
```
