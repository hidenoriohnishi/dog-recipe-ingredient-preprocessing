import { z } from "zod";

/**
 * =====================================================
 * 日本食品標準成分表 - 食品名構造化スキーマ + パーサー
 * =====================================================
 */

// ==========================================
// 列挙型定義
// ==========================================

/**
 * 食品の最終状態（調理・保存の結果）
 */
export const FoodStateEnum = z.enum([
  // 未加工
  "生",
  // 加熱調理（湿式）
  "ゆで", "水煮", "蒸し",
  // 加熱調理（油式）
  "油いため", "フライ", "天ぷら", "から揚げ", "素揚げ", "ソテー",
  // 加熱調理（乾式）
  "焼き", "いり",
  // 電子レンジ
  "電子レンジ調理",
  // 乾燥・保存
  "乾", "乾燥", "冷凍",
  // 漬物系
  "塩漬", "ぬかみそ漬", "甘酢漬", "しょうゆ漬", "みそ漬",
  // 缶詰・加工
  "缶詰", "水煮缶詰",
  // 干物
  "素干し", "煮干し", "丸干し",
  // 燻製
  "くん製",
  // 抽出
  "浸出液",
  // 前処理
  "塩抜き", "水戻し",
]);

/**
 * 形態修飾子（物理的状態）
 */
export const FormModifierEnum = z.enum([
  "皮つき", "皮なし",
  "脂身つき", "皮下脂肪なし", "赤肉", "脂身",
  "全粒",
  "全卵", "卵黄", "卵白",
]);

/**
 * 生産・栽培方法
 */
export const ProductionMethodEnum = z.enum([
  "養殖", "天然", "菌床栽培", "原木栽培",
]);

// ==========================================
// メインスキーマ
// ==========================================

export const StructuredFoodNameSchema = z.object({
  /** 基本食品名 */
  baseName: z.string(),

  /** 品種・種類・製品形態 */
  variety: z.string().optional(),

  /** 部位 */
  part: z.string().optional(),

  /** 形態修飾子（複数可） */
  formModifiers: z.array(FormModifierEnum).optional(),

  /** 生産方法 */
  productionMethod: ProductionMethodEnum.optional(),

  /** 産地 */
  origin: z.string().optional(),

  /** 最終状態（調理・保存） */
  state: FoodStateEnum.optional(),

  /** 等級 */
  grade: z.string().optional(),

  /** 補足情報 */
  notes: z.array(z.string()).optional(),
});

export type StructuredFoodName = z.infer<typeof StructuredFoodNameSchema>;
export type FoodState = z.infer<typeof FoodStateEnum>;
export type FormModifier = z.infer<typeof FormModifierEnum>;
export type ProductionMethod = z.infer<typeof ProductionMethodEnum>;

// ==========================================
// パーサー用定数
// ==========================================

const STATE_VALUES = new Set<string>(FoodStateEnum.options);
const FORM_MODIFIER_VALUES = new Set<string>(FormModifierEnum.options);
const PRODUCTION_METHOD_VALUES = new Set<string>(ProductionMethodEnum.options);

const PART_PATTERNS = new Set([
  // 植物部位
  "葉", "根", "茎", "茎葉", "果実", "花序", "花らい", "若芽", "若茎",
  "若ざや", "塊根", "球茎", "りん茎", "根茎", "塊茎", "胞子茎", "結球葉",
  "葉柄", "芽ばえ", "砂じょう", "じょうのう", "果汁", "果皮",
  // 動物部位
  "もも", "むね", "かた", "ばら", "ロース", "かたロース", "リブロース",
  "サーロイン", "ランプ", "そともも", "ヒレ", "手羽", "手羽さき", "手羽もと",
  "ささみ", "肝臓", "心臓", "舌", "じん臓", "きも", "胴", "貝柱",
]);

const ORIGIN_PATTERNS = new Set(["国産", "輸入", "米国産", "中国産", "ブラジル産"]);

// ==========================================
// パース関数
// ==========================================

/**
 * 食品名をパースして構造化
 * 
 * @example
 * parseFoodName("こむぎ　［小麦粉］　薄力粉　1等")
 * // => { original: "...", categoryPath: ["小麦粉"], baseName: "こむぎ", variety: "薄力粉", grade: "1等" }
 * 
 * @example
 * parseFoodName("＜魚類＞　（さけ・ます類）　たいせいようさけ　養殖　皮つき　生")
 * // => { categoryPath: ["魚類", "さけ・ます類"], baseName: "たいせいようさけ", productionMethod: "養殖", formModifiers: ["皮つき"], state: "生" }
 */
export function parseFoodName(name: string): StructuredFoodName {
  const parts = name.split("　").map(p => p.trim()).filter(p => p);

  const formModifiers: FormModifier[] = [];
  const notes: string[] = [];
  const unclassified: string[] = [];

  let part: string | undefined;
  let productionMethod: ProductionMethod | undefined;
  let origin: string | undefined;
  let state: FoodState | undefined;
  let grade: string | undefined;

  for (const p of parts) {
    // ＜カテゴリ＞ - カテゴリパスは生成しないが、notesに追加（記号を外す）
    if (p.startsWith("＜") && p.endsWith("＞")) {
      notes.push(p.slice(1, -1)); // 記号を外す
      continue;
    }

    // ［カテゴリ］ - カテゴリパスは生成しないが、notesに追加（記号を外す）
    if (p.startsWith("［") && p.endsWith("］")) {
      notes.push(p.slice(1, -1)); // 記号を外す
      continue;
    }

    // （類）または（補足） - カテゴリパスは生成しないが、notesに追加（記号を外す）
    if (p.startsWith("（") && p.endsWith("）")) {
      notes.push(p.slice(1, -1)); // 記号を外す
      continue;
    }

    // 状態
    if (STATE_VALUES.has(p)) {
      state = p as FoodState;
      continue;
    }

    // 形態修飾子
    if (FORM_MODIFIER_VALUES.has(p)) {
      formModifiers.push(p as FormModifier);
      continue;
    }

    // 生産方法
    if (PRODUCTION_METHOD_VALUES.has(p)) {
      productionMethod = p as ProductionMethod;
      continue;
    }

    // 産地
    if (ORIGIN_PATTERNS.has(p)) {
      origin = p;
      continue;
    }

    // 部位
    if (PART_PATTERNS.has(p)) {
      part = p;
      continue;
    }

    // 等級
    if (/^\d等$/.test(p)) {
      grade = p;
      continue;
    }

    // 未分類
    unclassified.push(p);
  }

  // baseName, variety の決定
  const baseName = unclassified[0] ?? "";
  const variety = unclassified.length > 1 ? unclassified.slice(1).join(" ") : undefined;

  // 結果オブジェクト構築
  const result: StructuredFoodName = {
    baseName,
  };

  if (variety) result.variety = variety;
  if (part) result.part = part;
  if (formModifiers.length > 0) result.formModifiers = formModifiers;
  if (productionMethod) result.productionMethod = productionMethod;
  if (origin) result.origin = origin;
  if (state) result.state = state;
  if (grade) result.grade = grade;
  if (notes.length > 0) result.notes = notes;

  return result;
}

// ==========================================
// ユーティリティ関数
// ==========================================

/**
 * 状態以外の属性で比較用キーを生成
 * 同じキー = 調理状態のみが異なる同一食品
 */
export function getGroupKey(food: StructuredFoodName): string {
  return [
    food.baseName,
    food.variety,
    food.part,
    food.productionMethod,
    food.origin,
    ...(food.formModifiers ?? []).sort(),
    food.grade,
  ].filter(Boolean).join("/");
}

/**
 * シンプルな検索用キー
 */
export function getSearchKey(food: StructuredFoodName): string {
  return [
    food.baseName,
    food.variety,
  ].filter(Boolean).join("/");
}
