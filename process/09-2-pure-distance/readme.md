# 09-2: PURE距離計算

MEXTの各食材に対してUSDA SR Legacyの各成分表との栄養距離をPURE研究の方法で計算し、適切なカテゴリー内から候補を最大20件取得します。

## 入力

- `../08-3-merge-choline/result/final-with-choline.csv` - MEXT食品データ
- `../09-1-usda-normalize/result/usda-foods.json` - 正規化されたUSDA食品データ

## 処理内容

1. MEXTとUSDAの共通栄養素をマッピング（10種類）
2. MEXTの食品群とUSDAのカテゴリーをマッピング（明確なものは縛り、曖昧なものは複数許容）
3. 各MEXT食品に対して適切なカテゴリーのUSDA食品との栄養距離を計算
4. 食品群ごとの距離閾値でフィルタリング（通常3、藻類・調味料等は5）
5. 距離でソートして上位20件を抽出

### 栄養素マッピング

- `PROT-` (g) → USDA 1003 Protein (G)
- `FAT-` (g) → USDA 1004 Total lipid (G)
- `CA` (mg) → USDA 1087 Calcium (MG)
- `P` (mg) → USDA 1091 Phosphorus (MG)
- `FE` (mg) → USDA 1089 Iron (MG)
- `ZN` (mg) → USDA 1095 Zinc (MG)
- `MG` (mg) → USDA 1090 Magnesium (MG)
- `THIA` (mg) → USDA 1165 Thiamin (MG)
- `RIBF` (mg) → USDA 1166 Riboflavin (MG)
- `NIA` (mg) → USDA 1167 Niacin (MG)

### 距離計算式

PURE研究の方法に基づき、相対誤差の二乗和の平方根を計算：

$$D = \sqrt{\sum_{j=1}^{n} \left( \frac{USDA_j - MEXT_j}{MEXT_j} \right)^2}$$

- MEXT側の値が0または欠損の栄養素は距離計算から除外
- USDA側の値が欠損の栄養素も除外
- 有効な栄養素が1つもない場合は候補なし
- 食品群ごとの距離閾値でフィルタリング
- 閾値以下の候補がない場合は空の配列

## 出力

- `result/distance-top20.json` - 各MEXT食品の候補（最大20件）

### カテゴリーフィルタリング

明確に対応するカテゴリーは縛り、曖昧なものは複数カテゴリーを許容：
- MEXT 01 (穀類) → USDA 20, 8 (Cereal Grains, Breakfast Cereals)
- MEXT 06 (野菜類) → USDA 11, 16 (Vegetables, Legumes)
- MEXT 09 (藻類) → 全カテゴリー（栄養組成が独特）
- MEXT 10 (魚介類) → USDA 15, 24 (Finfish/Shellfish, Native Foods)
- MEXT 11 (肉類) → USDA 5, 10, 13, 17, 7 (Poultry, Pork, Beef, Lamb/Game, Sausages)
- MEXT 15 (菓子類) → USDA 19, 18, 23 (Sweets, Baked Products, Snacks)
- MEXT 17 (調味料) → USDA 2, 6 (Spices/Herbs, Soups/Sauces)
- MEXT 18 (調理済み) → USDA 22, 21, 25, 6 (Meals, Fast Foods, Restaurant, Soups)

### 距離閾値

食品群ごとに距離閾値を設定：
- 通常: 3.0
- 藻類（09）、砂糖類（03）、調味料（17）、調理済み（18）: 5.0（栄養組成が独特で距離が大きくなりがち）

### JSON構造

```json
{
  "01001": {
    "food_number": "01001",
    "food_name": "アマランサス　玄穀",
    "food_group": "01",
    "candidates": [
      {
        "fdc_id": "170683",
        "description": "Amaranth grain, uncooked",
        "distance": 0.45,
        "food_category_id": "20"
      },
      {
        "fdc_id": "...",
        "description": "...",
        "distance": 0.82,
        "food_category_id": "20"
      }
      // ... 最大20件（食品群ごとの距離閾値以下）
    ]
  }
}
```

## 実行

```bash
pnpm run process:9-2
```

## パフォーマンス

- カテゴリーフィルタリングにより計算量が削減されます
- 処理時間は数分程度を想定
