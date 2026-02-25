/**
 * 検索APIハンドラー
 * 
 * POST /foods/search
 */

import { Context } from 'hono';
import { Env, SearchRequest, SearchResponse, Food, FilterCondition, SortCondition } from '../types';
import { foods } from '../data/load-foods';

/**
 * フィルター条件を適用
 */
function applyFilter(food: Food, filter: FilterCondition): boolean {
  const value = food[filter.column as keyof Food];
  
  // null値の処理
  if (value === null || value === undefined) {
    return false;
  }
  
  // ブールフィールドの処理
  if (filter.column === 'ID_estimated') {
    if (filter.operator === 'eq') {
      const boolTarget = String(filter.value) === 'true';
      return !!(value) === boolTarget;
    }
    return false;
  }

  // 文字列フィールドの処理
  const stringFields = ['food_group', 'food_number', 'food_name', 'food_name_en', 'usda_fdc_id', 'tag_name', 'diff', 'search_keywords'];
  const isStringField = stringFields.includes(filter.column);
  
  if (isStringField) {
    if (filter.operator === 'eq') {
      return String(value) === String(filter.value);
    }
    return false;
  }
  
  // 数値フィールドの処理
  const foodValue = typeof value === 'number' ? value : parseFloat(String(value));
  const filterValue = typeof filter.value === 'number' ? filter.value : parseFloat(String(filter.value));
  
  if (isNaN(foodValue) || isNaN(filterValue)) {
    return false;
  }
  
  switch (filter.operator) {
    case 'eq':
      return foodValue === filterValue;
    case 'gte':
      return foodValue >= filterValue;
    case 'gt':
      return foodValue > filterValue;
    case 'lte':
      return foodValue <= filterValue;
    case 'lt':
      return foodValue < filterValue;
    default:
      return false;
  }
}

/**
 * ソート条件を適用
 */
function compareFoods(a: Food, b: Food, sort: SortCondition): number {
  const aValue = a[sort.column as keyof Food];
  const bValue = b[sort.column as keyof Food];
  
  // null値の処理（nullは最後に）
  if (aValue === null || aValue === undefined) {
    return 1;
  }
  if (bValue === null || bValue === undefined) {
    return -1;
  }
  
  const aNum = typeof aValue === 'number' ? aValue : parseFloat(String(aValue));
  const bNum = typeof bValue === 'number' ? bValue : parseFloat(String(bValue));
  
  if (isNaN(aNum) || isNaN(bNum)) {
    // 数値でない場合は文字列として比較
    const aStr = String(aValue);
    const bStr = String(bValue);
    const comparison = aStr.localeCompare(bStr);
    return sort.order === 'asc' ? comparison : -comparison;
  }
  
  const comparison = aNum - bNum;
  return sort.order === 'asc' ? comparison : -comparison;
}

export async function handleSearchFoods(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const body = await c.req.json() as SearchRequest;
    
    // フィルター適用
    let filteredFoods = foods;
    
    if (body.filters && body.filters.length > 0) {
      filteredFoods = foods.filter(food =>
        body.filters!.every(filter => applyFilter(food, filter))
      );
    }
    
    // ソート適用
    if (body.sort) {
      filteredFoods = [...filteredFoods].sort((a, b) =>
        compareFoods(a, b, body.sort!)
      );
    }
    
    const total = filteredFoods.length;
    
    // オフセット・リミット適用
    const offset = body.offset || 0;
    const limit = body.limit || filteredFoods.length;
    
    const paginatedFoods = filteredFoods.slice(offset, offset + limit);
    
    const response: SearchResponse = {
      total,
      foods: paginatedFoods,
    };
    
    return c.json(response);
  } catch (error) {
    return c.json(
      {
        error: 'Bad Request',
        message: error instanceof Error ? error.message : 'Invalid request body',
      },
      400
    );
  }
}
