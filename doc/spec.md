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

---

## 11. データ品質に関する注記（MEXT 2023 実データからのフィードバック）

### 11.1 アミノ酸・脂肪酸データの欠損状況

MEXT 2023 のアミノ酸成分表・脂肪酸成分表は、本表（食品成分表）とは別に提供されており、すべての食品に対してデータが収録されているわけではない。

犬のレシピ候補として選定した1,314食品に対する収録状況：

| データ | 収録あり | 欠損 | 収録率 |
|--------|----------|------|--------|
| アミノ酸成分表 | 1,105件 | 209件 | 84.1% |
| 脂肪酸成分表 | 1,065件 | 249件 | 81.1% |

#### 欠損の傾向

**アミノ酸データが欠損している主な食品（たんぱく質1g以上）：120件**
- 調理済み品（焼き、ゆで、油いため等）
- 部位・品種の細分化データ（和牛・輸入牛の部位別等）
- マイナーな食材（やつめうなぎ干しやつめ、大豆はいが等）
- 油脂類（植物油はたんぱく質0gのため問題なし）

**脂肪酸データが欠損している主な食品（脂質1g以上）：47件**
- パン類、赤米・黒米、白色種とうもろこし等の穀類
- 大豆製品のバリエーション（凝固剤別豆腐等）
- 調理済み品（油いため等）

### 11.2 上限制約の有無と設計判断

AAFCOの栄養基準を確認した結果：

| 栄養素カテゴリ | 最小値（min） | 最大値（max） |
|----------------|---------------|---------------|
| 必須アミノ酸 | あり | **なし** |
| 必須脂肪酸 | あり | **なし** |
| omega6:omega3 比率 | - | **30:1** |

**設計判断**：
- アミノ酸・脂肪酸には上限制約がないため、データ欠損は「不足」方向にしか影響しない
- これらの制約はSOFTまたはSUPP（サプリで補完）として扱うため、データ欠損があっても解が得られなくなることはない
- したがって、**データ欠損のある食品もDBから除外しない**

### 11.3 omega6:omega3 比率計算時の注意

脂肪酸成分表において、n-3系またはn-6系が0またはTr（微量）の食品が存在する：

| パターン | 件数 | 比率計算への影響 |
|----------|------|------------------|
| n-6系のみあり（n-3系が0/Tr） | 199件 | 分母が0になるリスク |
| n-3系のみあり（n-6系が0/Tr） | 32件 | 比率は0に近づく |

**対処方針**：
- Tr（微量）は0.001g等の小さな正の値として扱う
- 比率はレシピ全体の合計値で計算する（個別食材では計算しない）
- n-3系を含む食材（魚類等）がレシピに含まれることで分母が0になることを回避

### 11.4 データ完全性フラグ

食材データベース（merged-nutrition.csv）には、各食材のアミノ酸・脂肪酸データの有無を示すフラグカラムが含まれる：

| カラム名 | 値 | 説明 |
|----------|-----|------|
| `has_amino_acid_data` | 1 / 0 | アミノ酸成分表にデータが存在するか |
| `has_fatty_acid_data` | 1 / 0 | 脂肪酸成分表にデータが存在するか |

これにより、レシピ生成時に以下が可能：
- データ完全性の高い食材を優先的に選択
- 欠損データを含むレシピに警告を付与
- 欠損データのカバレッジを計算

### 11.6 MEXT成分表の表記ルール（凡例）

「日本食品標準成分表（八訂）増補2023年」では、成分値に以下の特殊記号・表記が使用されている：

#### 基本記号
| 記号 | 意味 |
|------|------|
| `-` | 未測定 |
| `0` | 最小記載量の1/10未満、または検出されなかった |
| `Tr` | 微量（Trace）: 最小記載量の1/10以上5/10未満 |

#### 括弧付き表記（推定値・計算値）
| 記号 | 意味 |
|------|------|
| `(0)` | 推定値: 文献等により含まれていないと推定 |
| `(Tr)` | 推定値: 微量に含まれていると推定 |
| `(数値)` | 計算値・類推値: 以下のいずれかに該当 |

**括弧付き数値 `(数値)` の発生条件：**
- 諸外国の食品成分表から借用した場合
- 原材料配合割合（レシピ）等を基に計算した場合
- 類似食品の収載値から類推・計算により求めた場合

#### レシピ生成での扱い

| 記号 | 数値化 | 備考 |
|------|--------|------|
| `-` | null | 計算から除外 |
| `0` | 0 | そのまま使用 |
| `Tr` | 0.001等 | 小さな正の値として扱う |
| `(0)` | 0 | そのまま使用 |
| `(Tr)` | 0.001等 | 小さな正の値として扱う |
| `(数値)` | 数値 | 括弧を外して使用（精度は測定値より低い可能性あり） |

### 11.7 SUPP制約対応のデータ追加

AAFCO栄養基準のSUPP制約（サプリで補完可能だが、食材データがあればサプリ量を減らせる）に対応するため、以下のデータを食材データベースに追加した：

#### 追加されたミネラル（6種）
| コード | 名称 | 単位 | AAFCO制約 |
|--------|------|------|-----------|
| K | カリウム | mg | min 1.5g/1000kcal |
| MG | マグネシウム | mg | min 0.10-0.15g/1000kcal |
| FE | 鉄 | mg | min 10-22mg/1000kcal |
| ZN | 亜鉛 | mg | min 20-25mg/1000kcal |
| CU | 銅 | mg | min 1.83-3.1mg/1000kcal |
| MN | マンガン | mg | min 1.25-1.8mg/1000kcal |

#### 追加されたビタミン（8種）
| コード | 名称 | 単位 | AAFCO制約 |
|--------|------|------|-----------|
| TOCPHA | αトコフェロール（ビタミンE） | mg | min 12.5IU/1000kcal |
| THIA | ビタミンB1（チアミン） | mg | min 0.56mg/1000kcal |
| RIBF | ビタミンB2（リボフラビン） | mg | min 1.3mg/1000kcal |
| NIA | ナイアシン | mg | min 3.4mg/1000kcal |
| VITB6A | ビタミンB6 | mg | min 0.38mg/1000kcal |
| VITB12 | ビタミンB12 | μg | min 0.007mg/1000kcal |
| FOL | 葉酸 | μg | min 0.054mg/1000kcal |
| PANTAC | パントテン酸 | mg | min 3.0mg/1000kcal |

#### その他の追加カラム
| コード | 名称 | 用途 |
|--------|------|------|
| 食品群 | 食品分類グループ番号（2桁） | カテゴリ分析、レシピバリエーション確保 |
| ENERC_KCAL | エネルギー（kcal） | 参考値（MEは別途算出） |

#### 食材データベースのカラム構成（58列）

1. **基本情報（3列）**: 食品群、食品番号、食品名
2. **一般成分（5列）**: 水分、たんぱく質、脂質、食物繊維総量、灰分
3. **エネルギー（1列）**: エネルギー(kcal)
4. **ミネラル（10列）**: Ca, P, Na, K, Mg, Fe, Zn, Cu, Mn, I, Se
5. **ビタミン（10列）**: レチノール, ビタミンD, αトコフェロール, B1, B2, ナイアシン, B6, B12, 葉酸, パントテン酸
6. **その他（3列）**: 構造化食品名、理由、スコア
7. **データ完全性フラグ（2列）**: has_amino_acid_data, has_fatty_acid_data
8. **アミノ酸（14列）**: ILE, LEU, LYS, MET, CYS, AAS, PHE, TYR, AAA, THR, TRP, VAL, HIS, ARG
9. **脂肪酸（9列）**: 脂肪酸総量, 多価不飽和, n-3系, n-6系, リノール酸, α-リノレン酸, EPA, DHA, アラキドン酸

### 11.5 レシピ出力時のデータ完全性表示

レシピ出力時に、使用した食材のデータ完全性を明示する：

```json
{
  "ingredients": [
    { "name": "鶏むね肉", "grams": 100, "amino_acid_data": true, "fatty_acid_data": true },
    { "name": "オリーブ油", "grams": 10, "amino_acid_data": false, "fatty_acid_data": true }
  ],
  "data_completeness": {
    "amino_acid_coverage": "90%",
    "fatty_acid_coverage": "100%"
  },
  "warnings": ["一部食材でアミノ酸の詳細データがありません"]
}
```
