# 犬の健康レシピ生成仕様（線型計画法＋LLM）

## 1. コンディション入力

### 1.1 必須入力

* `body_weight_kg`（体重）
* `life_stage`：`ADULT` / `PUPPY`
* `neuter_status`：`NEUTERED` / `INTACT`
* `activity_level`：`INACTIVE` / `NORMAL` / `WORK_LIGHT` / `WORK_MODERATE` / `WORK_HEAVY`

### 1.2 任意入力（レシピ候補集合の制約）

* `include_ingredients[]`：必ず使いたい食材（量 `g` 固定 or `[min_g,max_g]`）
* `exclude_ingredients[]`：使わない食材
* `avoid_keywords[]`：食品名フィルタ（例：辛味、香辛料など任意）
* `preferred_ingredients[]`：好み（目的関数の加点）

---

## 2. 1日必要エネルギー（kcal/day）の算出

### 2.1 定義

* `RER_kcal_day = 70 * (body_weight_kg ^ 0.75)` ([AAHA][1])
* `MER_kcal_day = RER_kcal_day * life_stage_factor` ([AAHA][1])

### 2.2 life_stage_factor（犬）

* `NEUTERED`：1.4–1.6 ([AAHA][1])
* `INTACT`：1.6–1.8 ([AAHA][1])
* `INACTIVE`：1.0–1.2 ([AAHA][1])
* `PUPPY`：

  * `<4 months`：3.0
  * `>=4 months`：2.0 ([AAHA][1])
* `WORK_LIGHT`：1.6–2.0 / `WORK_MODERATE`：2.0–5.0 / `WORK_HEAVY`：5.0–11.0 ([AAHA][1])

### 2.3 係数の確定ルール（単一値に落とす）

* 範囲がある係数は、初期値として次を採用：

  * `NEUTERED`=1.5、`INTACT`=1.7、`INACTIVE`=1.1、`WORK_LIGHT`=1.8、`WORK_MODERATE`=3.0、`WORK_HEAVY`=7.0
* 体重推移（BW）とBCSで調整する、という運用注記を表示できるようにする ([AAHA][1])

---

## 3. 栄養基準（AAFCO：1000 kcal MEあたり）

### 3.1 プロファイル選択

* `life_stage=ADULT` → **Adult Maintenance**
* `life_stage=PUPPY` → **Growth & Reproduction**（子犬用途）

AAFCOはライフステージ別に「成長・繁殖」と「成犬維持」の2プロファイルを持つ ([U.S. Food and Drug Administration][2])

### 3.2 栄養素テーブル（1000 kcal MEあたり）

下記は AAFCO calorie basis 表の値。 ([AAFCO][3])

#### 3.2.1 マクロ

* Crude Protein (g): `PUPPY 56.3` / `ADULT 45.0`
* Crude Fat (g): `PUPPY 21.3` / `ADULT 13.8`

#### 3.2.2 必須脂肪酸・比

* Linoleic acid (g): `PUPPY 3.3` / `ADULT 2.8`
* alpha-Linolenic (g): `PUPPY 0.2` / `ADULT ND`
* EPA + DHA (g): `PUPPY 0.1` / `ADULT ND`
* (Linoleic + Arachidonic) : (alpha-Linolenic + EPA + DHA) ratio max: `30:1` ([AAFCO][3])

#### 3.2.3 ミネラル（min / max）

* Calcium (g): `PUPPY min 3.0` / `ADULT min 1.25` / `max 6.25 (4.5)` ([AAFCO][3])

  * `4.5 g` の最大値は Growth/All Life Stages に適用される ([AAFCO][3])
* Phosphorus (g): `PUPPY min 2.5` / `ADULT min 1.00` / `max 4.0`
* Ca:P ratio: `min 1:1` / `max 2:1`
* Potassium (g): `PUPPY 1.5` / `ADULT 1.5`
* Sodium (g): `PUPPY 0.80` / `ADULT 0.20`
* Chloride (g): `PUPPY 1.10` / `ADULT 0.30`
* Magnesium (g): `PUPPY 0.10` / `ADULT 0.15`
* Iron (mg): `PUPPY 22` / `ADULT 10`
* Copper (mg): `PUPPY 3.1` / `ADULT 1.83`
* Manganese (mg): `PUPPY 1.8` / `ADULT 1.25`
* Zinc (mg): `PUPPY 25` / `ADULT 20`
* Iodine (mg): `PUPPY 0.25` / `ADULT 0.25` / `max 2.75`
* Selenium (mg): `PUPPY 0.09` / `ADULT 0.08` / `max 0.5`

#### 3.2.4 ビタミン・その他（min / max）

* Vitamin A (IU): `min 1250` / `max 62500`
* Vitamin D (IU): `min 125` / `max 750`
* Vitamin E (IU): `min 12.5`
* Thiamine (mg): `0.56`
* Riboflavin (mg): `1.3`
* Pantothenic acid (mg): `3.0`
* Niacin (mg): `3.4`
* Pyridoxine (mg): `0.38`
* Folic acid (mg): `0.054`
* Vitamin B12 (mg): `0.007`
* Choline (mg): `340` ([AAFCO][3])

#### 3.2.5 必須アミノ酸（min）

（AAFCO表に準拠して保持する：`Arginine, Histidine, Isoleucine, Leucine, Lysine, Methionine, Methionine-Cystine, Phenylalanine, Phenylalanine-Tyrosine, Threonine, Tryptophan, Valine`） ([AAFCO][3])

---

## 4. 制約の重要度と適用方式

### 4.1 ランク

* **HARD**：必ず満たす（不成立なら解を採用しない）
* **SOFT**：できるだけ満たす（ペナルティ最小化）
* **SUPP**：サプリメント変数で満たす（食材のみでの達成を要求しない）
* **OFF**：評価・表示のみ（最適化に使わない）

### 4.2 ランク割当（デフォルト）

**HARD**

* Crude Protein min
* Crude Fat min
* Calcium min / max（PUPPY は max=4.5g、ADULT は max=6.25g） ([AAFCO][3])
* Phosphorus min / max
* Ca:P ratio（1.0〜2.0）

**SOFT**

* Linoleic acid min
* PUPPY の alpha-Linolenic min
* PUPPY の EPA+DHA min
* omega6:omega3 ratio max

**SUPP**

* Iodine（min/max）、Selenium（min/max）
* Vitamin A / D / E、B群、Choline
* Iron / Copper / Zinc / Manganese / Sodium / Chloride / Potassium / Magnesium
* 必須アミノ酸（アミノ酸成分表を結合できる場合は SOFT に昇格）

**OFF**

* それ以外のMEXT列（機能性・嗜好・細分類のみの成分など）

---

## 5. 食材安全フィルタ（最優先）

候補食材集合から、以下をデフォルト除外（名称・カテゴリ・原材料キーワードで判定）：

* チョコレート、キシリトール、アルコール、カフェイン/コーヒー、ぶどう/レーズン、マカダミア等 ([ASPCA][4])

---

## 6. 日本（MEXT 2023）データの使用と正規化

### 6.1 データセット

* MEXT 2023 の本表（Excel）と脂肪酸成分表（Excel）を使用可能とする ([文部科学省][5])

### 6.2 正規化スキーマ（Canonical）

各食材レコードは以下を持つ（単位は MEXT の“100gあたり”を基本）：

* `protein_g_100g`
* `fat_g_100g`
* `water_g_100g`
* `ash_g_100g`
* `fiber_g_100g`（MEXT列に対応するもの）
* `calcium_mg_100g`
* `phosphorus_mg_100g`
* `linoleic_mg_100g` / `ala_mg_100g` / `epa_mg_100g` / `dha_mg_100g`（脂肪酸表から）
* `retinol_ug_100g`
* `vitd_ug_100g`
* `iodine_ug_100g`
* `selenium_ug_100g`
* `me_kcal_100g`（下記で算出）

### 6.3 代謝エネルギー（ME）の算出（食材）

AAFCOの考え方に従い、modified Atwater で ME を算出する（kcal/100g） ([AAHA][1])

* `NFE_g_100g = 100 - (water + protein + fat + fiber + ash)`
* `me_kcal_100g = 3.5*protein + 8.5*fat + 3.5*max(0, NFE)`

---

## 7. 単位変換（AAFCO ⇄ MEXT）

* Vitamin D：`IU = ug * 40` ([栄養補助食品局 (ODS)][6])
* Vitamin A（レチノール由来として扱う）：`IU = RAE_ug / 0.3` ([グリコ][7])
* mg ⇄ µg：`mg = µg / 1000`
* g ⇄ mg：`g = mg / 1000`
* 脂肪酸 mg ⇄ g：`g = mg / 1000`

---

## 8. 最適化（線型計画）

### 8.1 解く単位

* **1日分（MER_kcal_day）**を直接解く。

### 8.2 変数

* 食材 i の使用量：`x_i_g >= 0`
* サプリ j の使用量：`s_j >= 0`（連続量）

### 8.3 栄養合計

任意の栄養素 `N` の日量：

* `N_total = Σ_i (N_i_per100g / 100 * x_i_g) + Σ_j (N_supp_j_per_unit * s_j)`

エネルギー（日量）：

* `ME_total = Σ_i (me_kcal_100g_i / 100 * x_i_g) + Σ_j (me_kcal_unit_j * s_j)`

### 8.4 必須制約

* `ME_total = MER_kcal_day`
* AAFCOの「1000 kcal MEあたり」制約を日量に変換して適用：

  * `N_total >= N_req_per1000kcal * (MER_kcal_day/1000)`（min）
  * `N_total <= N_max_per1000kcal * (MER_kcal_day/1000)`（max）
* Ca:P 比（線形）

  * `Calcium_total >= 1.0 * Phosphorus_total`
  * `Calcium_total <= 2.0 * Phosphorus_total` ([AAFCO][3])

### 8.5 目的関数（優先順）

1. ルール違反（HARD違反）なし
2. サプリ総量の最小化（`Σ s_j`）
3. 食材点数の最小化（近似として `Σ x_i_g>0` を段階的に抑制、または代理のL1）
4. 嗜好（preferred）食材の加点、避けたい食材の減点

---

## 9. 出力

### 9.1 レシピ構造（機械可読）

* `daily_recipe`：

  * `ingredients[]`: `{mext_food_id, name, form, grams}`
  * `supplements[]`: `{supplement_id, name, amount}`
  * `nutrition_summary`：

    * `MER_kcal_day`
    * `per1000kcal`: 各栄養素の達成値と基準値（min/max）
    * `daily_total`: 各栄養素の日量

### 9.2 説明（人間可読）

* 採用したライフステージ（ADULT/PUPPY）と AAFCO プロファイル
* 主要制約（HARD）の達成状況（不足/過剰がないこと）
* サプリが入った場合：どの不足を補うために入ったか

---

## 10. 参照の根拠（仕様内で使用した外部基準）

* AAFCO Dog Food Nutrient Profiles（1000 kcal ME basis の数値） ([AAFCO][3])
* AAHA 2021（RER/MER式と犬の係数） ([AAHA][1])
* FDA “Complete and Balanced” の説明（AAFCOプロファイル/給餌試験の位置づけ、ライフステージ差） ([U.S. Food and Drug Administration][2])
* MEXT 2023（Excelデータ提供：本表・脂肪酸表ほか） ([文部科学省][5])
* Vitamin D 換算（1 µg = 40 IU） ([栄養補助食品局 (ODS)][6])
* Vitamin A 換算（1 IU = 0.3 µg RAE 相当） ([グリコ][7])
* 有害食品（ASPCA）とキシリトール毒性（FDA） ([ASPCA][4])

[1]: https://www.aaha.org/wp-content/uploads/globalassets/02-guidelines/2021-nutrition-and-weight-management/resourcepdfs/nutritiongl_box1.pdf "NutritionGL_Box1.indd"
[2]: https://www.fda.gov/animal-veterinary/animal-health-literacy/complete-and-balanced-pet-food "“Complete and Balanced” Pet Food | FDA"
[3]: https://www.aafco.org/wp-content/uploads/2023/01/Pet_Food_Report_2013_Annual-Appendix_A.pdf "Microsoft Word - Appendix Item A Corrections to Max Ca Levels Single Column Option"
[4]: https://www.aspca.org/pet-care/aspca-poison-control/people-foods-avoid-feeding-your-pets?utm_source=chatgpt.com "People Foods to Avoid Feeding Your Pets - ASPCA"
[5]: https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html?utm_source=chatgpt.com "日本食品標準成分表（八訂）増補2023年 - 文部科学省"
[6]: https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/?utm_source=chatgpt.com "Vitamin D - Health Professional Fact Sheet - Office of Dietary ..."
[7]: https://www.glico.com/jp/navi/dic/dic_15.html?utm_source=chatgpt.com "ビタミンA（レチノール活性当量） | ビタミン | 栄養成分の ..."
