/**
 * ID指定取得ハンドラー
 * 
 * GET /foods/:id
 * GET /foods?ids=01001,01002,01003
 */

import { Context } from 'hono';
import { Env, GetFoodsResponse } from '../types';
import { getFoodById, getFoodsByIds } from '../data/load-foods';

export async function handleGetFoods(c: Context<{ Bindings: Env }>): Promise<Response> {
  // パスパラメータからIDを取得（例: /foods/01001）
  const id = c.req.param('id');
  if (id) {
    const food = getFoodById(id);
    
    if (!food) {
      return c.json(
        {
          error: 'Not Found',
          message: `Food with ID ${id} not found`,
        },
        404
      );
    }
    
    const response: GetFoodsResponse = {
      foods: [food],
    };
    
    return c.json(response);
  }
  
  // クエリパラメータから複数のIDを取得（例: ?ids=01001,01002,01003）
  const idsParam = c.req.query('ids');
  if (idsParam) {
    const ids = idsParam.split(',').map(id => id.trim()).filter(id => id);
    
    if (ids.length === 0) {
      return c.json(
        {
          error: 'Bad Request',
          message: 'ids parameter is required and must contain at least one ID',
        },
        400
      );
    }
    
    const foods = getFoodsByIds(ids);
    const response: GetFoodsResponse = {
      foods,
    };
    
    return c.json(response);
  }
  
  // IDが指定されていない場合
  return c.json(
    {
      error: 'Bad Request',
      message: 'Either path parameter or ids query parameter is required',
    },
    400
  );
}
