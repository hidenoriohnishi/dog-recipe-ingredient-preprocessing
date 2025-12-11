/**
 * OpenAI APIの料金計算ユーティリティ
 */

// 為替レート（$1 = 150円、変更可能）
export const USD_TO_JPY = 150;

/**
 * モデル別の料金設定（1MトークンあたりのUSD）
 */
export const MODEL_PRICING = {
  'gpt-5-mini-2025-08-07': {
    input: 0.25,   // $0.25 per 1M tokens
    output: 2.00,  // $2.00 per 1M tokens
  },
  'gpt-5': {
    input: 1.25,   // $1.25 per 1M tokens (GPT-5.1の料金)
    output: 10.00, // $10.00 per 1M tokens
  },
  'gpt-5.1': {
    input: 1.25,   // $1.25 per 1M tokens
    output: 10.00, // $10.00 per 1M tokens
  },
  'gpt-5-pro': {
    input: 15.00,  // $15.00 per 1M tokens
    output: 120.00, // $120.00 per 1M tokens
  },
  'gpt-5-nano': {
    input: 0.05,   // $0.05 per 1M tokens
    output: 0.40,  // $0.40 per 1M tokens
  },
} as const;

export type ModelName = keyof typeof MODEL_PRICING;

/**
 * 料金計算結果
 */
export interface CostResult {
  inputTokens: number;
  outputTokens: number;
  inputCostUSD: number;
  outputCostUSD: number;
  totalCostUSD: number;
  totalCostJPY: number;
}

/**
 * トークン数から料金を計算
 */
export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number
): CostResult {
  // モデル名から料金設定を取得（部分一致で検索）
  const pricing = findPricing(modelName);
  
  if (!pricing) {
    console.warn(`料金設定が見つかりません: ${modelName}。デフォルト（gpt-5-mini）を使用します。`);
    const defaultPricing = MODEL_PRICING['gpt-5-mini-2025-08-07'];
    return calculateCostWithPricing(defaultPricing, inputTokens, outputTokens);
  }
  
  return calculateCostWithPricing(pricing, inputTokens, outputTokens);
}

/**
 * 料金設定から直接計算
 */
function calculateCostWithPricing(
  pricing: { input: number; output: number },
  inputTokens: number,
  outputTokens: number
): CostResult {
  const inputCostUSD = (inputTokens / 1_000_000) * pricing.input;
  const outputCostUSD = (outputTokens / 1_000_000) * pricing.output;
  const totalCostUSD = inputCostUSD + outputCostUSD;
  const totalCostJPY = totalCostUSD * USD_TO_JPY;

  return {
    inputTokens,
    outputTokens,
    inputCostUSD,
    outputCostUSD,
    totalCostUSD,
    totalCostJPY,
  };
}

/**
 * モデル名から料金設定を検索（部分一致）
 */
function findPricing(modelName: string): { input: number; output: number } | null {
  // 完全一致を優先
  if (modelName in MODEL_PRICING) {
    return MODEL_PRICING[modelName as ModelName];
  }
  
  // 部分一致で検索
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelName.includes(key) || key.includes(modelName)) {
      return pricing;
    }
  }
  
  return null;
}

/**
 * 料金結果をフォーマットして表示
 */
export function formatCost(cost: CostResult): string {
  return `料金: $${cost.totalCostUSD.toFixed(6)} (¥${cost.totalCostJPY.toFixed(2)}) [入力: ${cost.inputTokens}トークン ($${cost.inputCostUSD.toFixed(6)}), 出力: ${cost.outputTokens}トークン ($${cost.outputCostUSD.toFixed(6)})]`;
}
