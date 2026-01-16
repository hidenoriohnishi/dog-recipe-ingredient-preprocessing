# 09-2-3: 栄養素距離計算（候補絞り込み）

## 概要

09-2-2で計算した食品名距離の上位200候補に対して、栄養素の類似度を計算し、
総合スコアで上位50件に絞り込みます。

犬のレシピ生成のため、AAFCOで使用される栄養素を重視した重み付けを行います。

## 入力

- `../07-normalize-headers/result/final-nutrition.csv` - MEXT食品データ
- `../09-1-1-usda-normalize/result/usda-foods.json` - USDA食品データ
- `../09-2-2-name-distance/result/name-distance-top100.json` - 食品名距離候補

## 出力

- `result/distance-top50.json` - 各MEXT食品の候補（上位50件）

## 処理内容

### 1. 栄養素マッピングと重み付け

AAFCOで重要な栄養素を中心に重み付け（最大/最小 = 10倍以内）：

| 重要度 | 重み | 対象栄養素 |
|--------|------|-----------|
| 最重要 | 1.0 | タンパク質、脂肪 |
| 高 | 0.8 | カルシウム、リン |
| 中高 | 0.5-0.6 | 亜鉛、鉄、マグネシウム |
| 中 | 0.3-0.4 | カリウム、ナトリウム、銅、マンガン、セレン、ビタミンB群 |
| 低 | 0.1-0.2 | 食物繊維、灰分、水分 |

### 2. 距離計算方法

**重み付き対数比距離**を使用：

$$D = \sqrt{\frac{\sum_{i} w_i \cdot (\ln \frac{USDA_i}{MEXT_i})^2}{\sum_{i} w_i}}$$

- 対数比により、栄養素の桁の違いを吸収
- 最低3つ以上の栄養素が一致する場合のみ候補とする

### 3. 総合スコア

名前の類似度と栄養素の類似度を組み合わせ：

$$Score = 0.6 \times NameSimilarity + 0.4 \times \frac{1}{1 + NutrientDistance}$$

名前の類似度を重視（60%）- 同じ魚種・食材が選ばれるように

## 出力形式

```json
{
  "01001": {
    "food_number": "01001",
    "food_name": "アマランサス　玄穀",
    "candidates": [
      {
        "fdc_id": "170683",
        "description": "Amaranth grain, uncooked",
        "name_similarity": 0.89,
        "nutrient_distance": 0.45,
        "combined_score": 0.75,
        "matched_nutrients": 15
      }
    ]
  }
}
```

## 実行

```bash
pnpm run process:9-2-3
```

## 目的

最終的にはコリンと塩素（MEXTにない栄養素）の値をUSDAから推定するための類似食品マッチング。
