# 08-1: USDAコリンデータの変換

## 概要

USDAのコリンデータベース（Choln02）を扱いやすいCSV形式に変換します。

## 入力

- `../08-0/Choln02/FOOD_DES.txt` - 食品定義
- `../08-0/Choln02/NUT_DATA.txt` - 栄養データ
- `../08-0/Choln02/NUTR_DEF.txt` - 栄養素定義

## 出力

- `result/usda-choline.csv` - 統合されたコリンデータ

## 出力カラム

| カラム | 説明 |
|--------|------|
| ndb_no | NDB番号（USDAの食品ID） |
| food_group | 食品グループ番号 |
| food_name | 食品名（英語） |
| total_choline_mg | 総コリン (mg/100g) |
| free_choline_mg | フリーコリン (mg/100g) |
| phosphocholine_mg | ホスホコリン由来 (mg/100g) |
| phosphatidylcholine_mg | ホスファチジルコリン由来 (mg/100g) |
| glycerophosphocholine_mg | グリセロホスホコリン由来 (mg/100g) |
| betaine_mg | ベタイン (mg/100g) |
| sphingomyelin_mg | スフィンゴミエリン由来 (mg/100g) |

## 実行

```bash
pnpm run 08-1
```
