# 09-3: AI最適候補選択

PURE研究の距離計算で取得した上位5件の候補から、AIを使って最適な1件を選定します。

## 入力

- `../08-3-merge-choline/result/final-with-choline.csv` - MEXT食品データ
- `../09-2-pure-distance/result/distance-top20.json` - 距離計算結果（最大20件、適切なカテゴリー内）
- `../09-1-usda-normalize/result/usda-foods.json` - USDA食品データ

## 処理内容

1. 距離計算結果から候補がある食品を抽出
2. 各食品の上位5件の候補をAIに提示
3. AIが食品名の類似性と栄養距離を考慮して最適な1件を選定
4. 選定結果を保存
5. 最終CSVにUSDAマッピング情報を追加

### AI選定の判断基準

**基本方針**: 食材として同一または近種のものだけをマッチ。無理にマッチさせない。

1. **食材としての同一性・近種性**（最優先）
   - 同じ食材であること（例: 米→rice、鶏肉→chicken）
   - 近種も可（例: あじ→mackerel系、さけ→salmon系）
2. **調理状態の柔軟性**: 調理状態が異なっても可
3. **部位の柔軟性**: 同じ食材なら部位が異なっても可
4. **マッチしない場合**: 候補に同一または近種がなければNO_MATCH
   - 例: しいたけの候補にパプリカしかない → NO_MATCH
   - 栄養価が近いだけでは不十分。食材として同一または近種であることが必須

### 目的

MEXTで足りていない栄養素（塩素（塩化物CHLORIDE）とCHOLIN）の量を推定するために、USDAから最も近い食材を選定します。

## 出力

- `result/usda-mapping.json` - マッピング結果
- `result/final-nutrition.csv` - USDAマッピング情報を追加した最終CSV
- `result/progress.json` - 進捗情報

### JSON構造（usda-mapping.json）

```json
[
  {
    "mext_food_number": "01001",
    "mext_food_name": "アマランサス　玄穀",
    "usda_fdc_id": "170683",
    "usda_description": "Amaranth grain, uncooked",
    "distance": 0.45,
    "match_reason": "アマランサスとAmaranth grainは同じ食材で、栄養距離も小さい"
  }
]
```

### CSV追加列

- `usda_fdc_id`: USDA食品のFDC ID
- `usda_description`: USDA食品の説明
- `usda_match_distance`: 栄養距離
- `usda_chlorine_mg`: USDAの塩素(Cl)値 (mg/100g)
- `usda_choline_mg`: USDAのコリン値 (mg/100g)

## 実行

```bash
pnpm run process:9-3
```

## 注意事項

- バッチ処理で進捗を保存するため、中断しても再開可能
- APIレート制限を考慮して1秒待機
- 料金計算と表示を各バッチごとに行う
