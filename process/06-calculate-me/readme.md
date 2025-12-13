# プロセス 06-calculate-me: 代謝エネルギー計算

## 概要

05-3の最終栄養データCSVに、代謝エネルギー（ME）を計算して追加するプロセスです。

spec.md 6.3に従い、modified Atwater法で代謝エネルギーを算出します。

## 入力

1. **05-3**: `../05-3-merge-extensions/result/final-nutrition.csv` - 拡張データ付き栄養データCSV

## 出力

### `result/final-nutrition.csv`

05-3のCSVに以下のカラムを追加：

| カラム名 | 説明 |
|----------|------|
| ME_KCAL_100G | 代謝エネルギー（kcal/100g） |

## 計算式

spec.md 6.3に従い、以下の式で計算します：

```
NFE_g_100g = 100 - (water + protein + fat + fiber + ash)
me_kcal_100g = 3.5*protein + 8.5*fat + 3.5*max(0, NFE)
```

### 係数

- たんぱく質: 3.5 kcal/g
- 脂質: 8.5 kcal/g
- 炭水化物（NFE）: 3.5 kcal/g

### データ処理

- 空文字、"-"、括弧付き値は0として扱う
- 小数点第2位まで計算

## ファイル構造

```
process/06-calculate-me/
├── index.ts
├── readme.md
└── result/
    └── final-nutrition.csv
```
