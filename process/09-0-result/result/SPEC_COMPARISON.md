# spec.mdとの列名比較結果

## 概要

spec.mdの6.2節「正規化スキーマ（Canonical）」で指定されている列名と、実際に生成されたCSVの列名を比較しました。

## 比較結果

### spec.md 6.2節で指定されている列名 vs 実際の列名

| spec.md 6.2（Canonical） | 実際の列名 | 差異 |
|-------------------------|----------|------|
| `protein_g_100g` | `PROT-` | **異なる** - MEXTコード名を使用 |
| `fat_g_100g` | `FAT-` | **異なる** - MEXTコード名を使用 |
| `water_g_100g` | `WATER` | **異なる** - MEXTコード名を使用 |
| `ash_g_100g` | `ASH` | **異なる** - MEXTコード名を使用 |
| `fiber_g_100g` | `FIB-` | **異なる** - MEXTコード名を使用 |
| `calcium_mg_100g` | `CA` | **異なる** - MEXTコード名を使用 |
| `phosphorus_mg_100g` | `P` | **異なる** - MEXTコード名を使用 |
| `linoleic_mg_100g` | `F18D2N6` | **異なる** - component_idを使用 |
| `ala_mg_100g` | `F18D3N3` | **異なる** - component_idを使用 |
| `epa_mg_100g` | `F20D5N3` | **異なる** - component_idを使用 |
| `dha_mg_100g` | `F22D6N3` | **異なる** - component_idを使用 |
| `retinol_ug_100g` | `RETOL` | **異なる** - MEXTコード名を使用 |
| `vitd_ug_100g` | `VITD` | **異なる** - MEXTコード名を使用 |
| `iodine_ug_100g` | `ID` | **異なる** - MEXTコード名を使用 |
| `selenium_ug_100g` | `SE` | **異なる** - MEXTコード名を使用 |
| `me_kcal_100g` | `ME_KCAL_100G` | **異なる** - 大文字とアンダースコアの違い |

### spec.md 11.7節との一致

spec.md 11.7節「食材データベースのカラム構成（58列）」では、実際のデータベースの構造が記載されており、これは現在のCSVの構造と一致しています：

- **基本情報（3列）**: 食品群、食品番号、食品名 → `food_group`, `food_number`, `food_name`
- **一般成分（5列）**: 水分、たんぱく質、脂質、食物繊維総量、灰分 → `WATER`, `PROT-`, `FAT-`, `FIB-`, `ASH`
- **ミネラル（10列）**: Ca, P, Na, K, Mg, Fe, Zn, Cu, Mn, I, Se → `CA`, `P`, `NA`, `K`, `MG`, `FE`, `ZN`, `CU`, `MN`, `ID`, `SE`
- **アミノ酸（14列）**: ILE, LEU, LYS, MET, CYS, AAS, PHE, TYR, AAA, THR, TRP, VAL, HIS, ARG → **一致**
- **脂肪酸（9列）**: 脂肪酸総量, 多価不飽和, n-3系, n-6系, リノール酸, α-リノレン酸, EPA, DHA, アラキドン酸 → `FACID`, `FAPU`, `FAPUN3`, `FAPUN6`, `F18D2N6`, `F18D3N3`, `F20D5N3`, `F22D6N3`, `F20D4N6`

## 結論

1. **spec.md 6.2節（正規化スキーマ）**: 理想的な形式として`protein_g_100g`のような命名規則を提示しているが、実際の実装では使用していない

2. **spec.md 11.7節（実際のデータベース構成）**: 現在のCSVの構造と一致しており、MEXTの元のコード名（`WATER`, `PROT-`, `CA`など）やcomponent_id（`ILE`, `F18D2N6`など）を使用している

3. **差異の理由**: 
   - 6.2節は「正規化スキーマ（Canonical）」として理想的な形式を示している
   - 実際の実装では、MEXTデータの元の形式を保持することで、データの整合性と可読性を確保している
   - メタデータファイル（`column-metadata.json`）により、LLMが列の意味を理解できるようになっている

4. **`me_kcal_100g`の命名**: spec.mdでは`me_kcal_100g`（小文字）だが、実際は`ME_KCAL_100G`（大文字）を使用。これは他のコード名（`ENERC_KCAL`など）と統一するため

## 追加された列（spec.mdに記載なし）

以下の列はspec.md 6.2節には記載されていないが、実際のCSVに含まれている：

- `food_group`, `food_number`, `food_name`（基本情報）
- `ENERC_KCAL`（エネルギー）
- `structured_food_name`, `reason`, `score`（その他）
- `has_amino_acid_data`, `has_fatty_acid_data`（データ完全性フラグ）
- アミノ酸14列、脂肪酸9列（詳細データ）
- `search_keys`, `tag_name_ja`, `tag_name_ja_detail`, `tag_name_en`, `tag_name_en_detail`（拡張データ）

これらはspec.md 11.7節で記載されているか、または実装上の追加項目です。
