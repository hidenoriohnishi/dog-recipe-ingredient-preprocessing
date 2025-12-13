# 04-1: 成分表マージ

## 概要

3つの成分表を「食品番号」をキーとしてマージし、レシピ生成に必要な列のみを含む新しい表を作成する。

## 入力

1. `03-2-filter-by-score/result/filtered-by-score.csv` - フィルタ済み食品表（ベース）
2. `04-0/amino_acid_composition.csv` - アミノ酸成分表
3. `04-0/fatty_acid_composition.csv` - 脂肪酸成分表
4. `04-0/plan.json` - マージ設定

## 出力

`result/merged-nutrition.csv` - マージ済み成分表（58列）

## マージ仕様

`04-0/plan.json`に従い、各テーブルから以下の列を抽出してマージする：

### filtered_food_table から（33列）

#### 基本情報
- 食品群、食品番号、食品名

#### 一般成分
- 水分(WATER)、たんぱく質(PROT-)、脂質(FAT-)、食物繊維総量(FIB-)、灰分(ASH)

#### エネルギー
- エネルギー(ENERC_KCAL) ※kcal

#### ミネラル（HARD/SUPP制約対応）
- カルシウム(CA)、リン(P)、ナトリウム(NA)
- カリウム(K)、マグネシウム(MG)、鉄(FE)、亜鉛(ZN)、銅(CU)、マンガン(MN)
- ヨウ素(ID)、セレン(SE)

#### ビタミン（SUPP制約対応）
- レチノール(RETOL)、ビタミンD(VITD)
- αトコフェロール(TOCPHA)
- ビタミンB1(THIA)、ビタミンB2(RIBF)、ナイアシン(NIA)
- ビタミンB6(VITB6A)、ビタミンB12(VITB12)、葉酸(FOL)、パントテン酸(PANTAC)

#### その他
- 構造化食品名、理由、スコア

### データ完全性フラグ（2列）
- `has_amino_acid_data`: アミノ酸成分表にデータが存在するか（1/0）
- `has_fatty_acid_data`: 脂肪酸成分表にデータが存在するか（1/0）

### amino_acid_table から（14列）
- イソロイシン(ILE)、ロイシン(LEU)、リシン(LYS)
- メチオニン(MET)、シスチン(CYS)、含硫アミノ酸(AAS)
- フェニルアラニン(PHE)、チロシン(TYR)、芳香族アミノ酸(AAA)
- スレオニン(THR)、トリプトファン(TRP)、バリン(VAL)
- ヒスチジン(HIS)、アルギニン(ARG)

### fatty_acid_table から（9列）
- 脂肪酸総量(FACID)
- 多価不飽和脂肪酸(FAPU)、n-3系多価不飽和脂肪酸(FAPUN3)、n-6系多価不飽和脂肪酸(FAPUN6)
- リノール酸(F18D2N6)、α-リノレン酸(F18D3N3)
- EPA(F20D5N3)、DHA(F22D6N3)、アラキドン酸(F20D4N6)

## 変更履歴

- v3: AAFCO SUPP制約対応のため、ミネラル6種・ビタミン8種・食品群・エネルギーを追加
- v2: データ完全性フラグ（has_amino_acid_data, has_fatty_acid_data）を追加
- v1: 初版
