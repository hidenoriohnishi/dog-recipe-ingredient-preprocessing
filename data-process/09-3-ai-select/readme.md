# 09-3: USDAマッチング選定（機械的選択）

## 概要

09-2-3で計算された距離データを使用して、各MEXT食品に対して最適なUSDA食品を機械的に選択し、栄養素データ（Chlorine, Choline）を取得します。

## 選択アルゴリズム

各MEXT食品について、`combined_score`が最大の候補を選択します。

`combined_score`は09-2-3で以下のように計算されています：
- `combined_score = name_similarity * 0.6 + nutrient_similarity * 0.4`
- `nutrient_similarity = 1 / (1 + nutrient_distance)`

つまり、名前の類似度を60%、栄養素の類似度を40%の重みで組み合わせたスコアです。

## 入力

1. **07-normalize-headers/result/final-nutrition.csv**: MEXT食品データ
2. **09-2-3-pure-distance/result/distance-top50.json**: 距離計算結果（各食品に対する上位50候補）
3. **09-1-1-usda-normalize/result/usda-foods.json**: USDA食品データ（栄養素情報含む）
4. **09-2-1-1-translate/result/translated-names.json**: MEXT食品名の英語翻訳

## 出力

**result/final-nutrition.csv**: MEXT CSVに以下の列を追加
- `usda_fdc_id`: マッチしたUSDA食品のID
- `usda_choline_mg`: Choline (mg/100g)
- `food_name_en`: 英語翻訳名（09-2-1-1で生成）

## 実行

```bash
pnpm process:9-3
```

## 処理フロー

1. 距離データを読み込み
2. USDA食品データを読み込み
3. 翻訳名データを読み込み
4. 各MEXT食品について、`combined_score`が最大の候補を選択
5. 選択されたUSDA食品からCholineの値を取得
6. 英語翻訳名を取得
7. MEXT CSVに追加列を付けて出力
