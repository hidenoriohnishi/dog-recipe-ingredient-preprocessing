/**
 * Cloudflare Worker API for dog recipe generation
 * 
 * This API uses the processed data from the data-process package.
 */

import { Hono } from 'hono';
import { authMiddleware } from './auth';
import { handleGetFoods } from './handlers/getFoods';
import { handleSearchFoods } from './handlers/searchFoods';
import { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// ヘルスチェック（認証不要）
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// ID指定取得（認証必要）
app.get('/foods/:id', authMiddleware, handleGetFoods);

app.get('/foods', authMiddleware, handleGetFoods);

// 検索API（認証必要）
app.post('/foods/search', authMiddleware, handleSearchFoods);

export default app;
