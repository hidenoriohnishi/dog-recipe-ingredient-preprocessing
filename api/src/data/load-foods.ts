/**
 * foods.jsonを読み込む
 */

import foodsData from './foods.json';
import { Food } from '../types';

// JSONデータをFood型の配列としてキャスト
export const foods: Food[] = foodsData as Food[];

/**
 * food_numberでインデックスを作成（高速検索用）
 */
const foodsById = new Map<string, Food>();
for (const food of foods) {
  foodsById.set(food.food_number, food);
}

/**
 * IDで食品を取得
 */
export function getFoodById(id: string): Food | undefined {
  return foodsById.get(id);
}

/**
 * 複数のIDで食品を取得
 */
export function getFoodsByIds(ids: string[]): Food[] {
  return ids
    .map(id => getFoodById(id))
    .filter((food): food is Food => food !== undefined);
}
