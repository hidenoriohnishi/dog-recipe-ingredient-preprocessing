# 09-2-2: 食品名距離計算

## 概要

MEXTとUSDAの食品名embeddingを使用して、コサイン類似度による距離を計算し、
各MEXT食品に対してUSDAの上位200件をリストアップします。

## 入力

- `../09-2-1-2-embedding/result/batches/*.json` - MEXT食品名embedding（英語翻訳版、バッチ分割）
- `../09-1-2-usda-embedding/result/batches/*.json` - USDA食品名embedding（バッチ分割）

## 出力

- `result/name-distance-top200.json` - 各MEXT食品の候補（上位200件）

### 出力形式

```json
{
  "01001": {
    "food_number": "01001",
    "food_name": "アマランサス　玄穀",
    "candidates": [
      {
        "fdc_id": "170683",
        "description": "Amaranth grain, uncooked",
        "similarity": 0.89
      },
      ...
    ]
  },
  ...
}
```

## 計算方法

**コサイン類似度**を使用：

$$similarity = \frac{A \cdot B}{||A|| \times ||B||}$$

## 実行

```bash
pnpm run process:9-2-2
```
