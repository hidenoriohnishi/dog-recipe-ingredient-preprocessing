/**
 * HMAC認証ミドルウェア
 * 
 * Bearerトークン形式: ACCESS_KEY:HMAC_SIGNATURE
 * HMAC_SIGNATURE = HMAC-SHA256(REQUEST_METHOD + REQUEST_PATH + REQUEST_BODY, SECRET_KEY)
 */

import { Context, Next } from 'hono';
import { Env } from './types';

export interface AuthResult {
  success: boolean;
  accessKey?: string;
  error?: string;
}

/**
 * Bearerトークンを解析してACCESS_KEYとHMAC_SIGNATUREを取得
 */
function parseBearerToken(bearerToken: string): { accessKey: string; signature: string } | null {
  // Bearerトークン形式: ACCESS_KEY:HMAC_SIGNATURE
  const parts = bearerToken.split(':');
  if (parts.length !== 2) {
    return null;
  }
  return {
    accessKey: parts[0],
    signature: parts[1],
  };
}

/**
 * HMAC-SHA256を計算
 */
async function computeHMAC(
  secretKey: string,
  method: string,
  path: string,
  body: string
): Promise<string> {
  const message = `${method}${path}${body}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * APIキーを環境変数から読み込み
 */
function loadApiKeys(env: Env): Array<[string, string]> {
  try {
    const keysJson = env.API_KEYS;
    const keys = JSON.parse(keysJson) as Array<[string, string]>;
    
    if (!Array.isArray(keys)) {
      throw new Error('API_KEYS must be an array');
    }
    
    return keys;
  } catch (error) {
    console.error('Failed to parse API_KEYS:', error);
    return [];
  }
}

/**
 * ACCESS_KEYからSECRET_KEYを取得
 */
function getSecretKey(env: Env, accessKey: string): string | null {
  const keys = loadApiKeys(env);
  const found = keys.find(([key]) => key === accessKey);
  return found ? found[1] : null;
}

/**
 * リクエストを認証
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<AuthResult> {
  // Authorizationヘッダーを取得
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      error: 'Missing or invalid Authorization header',
    };
  }
  
  const bearerToken = authHeader.substring(7); // "Bearer "を除去
  const parsed = parseBearerToken(bearerToken);
  
  if (!parsed) {
    return {
      success: false,
      error: 'Invalid bearer token format. Expected: ACCESS_KEY:HMAC_SIGNATURE',
    };
  }
  
  const { accessKey, signature } = parsed;
  
  // SECRET_KEYを取得
  const secretKey = getSecretKey(env, accessKey);
  if (!secretKey) {
    return {
      success: false,
      error: 'Invalid access key',
    };
  }
  
  // リクエストボディを取得
  const method = request.method;
  const url = new URL(request.url);
  const path = url.pathname + url.search;
  
  let body = '';
  if (request.body) {
    const clonedRequest = request.clone();
    body = await clonedRequest.text();
  }
  
  // HMAC署名を計算
  const expectedSignature = await computeHMAC(secretKey, method, path, body);
  
  // 署名を比較（タイミング攻撃対策のため、定数時間比較を使用）
  if (signature !== expectedSignature) {
    return {
      success: false,
      error: 'Invalid signature',
    };
  }
  
  return {
    success: true,
    accessKey,
  };
}

/**
 * 認証ミドルウェア（Hono用）
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const authResult = await authenticateRequest(c.req.raw, c.env);
  
  if (!authResult.success) {
    return c.json(
      {
        error: 'Unauthorized',
        message: authResult.error,
      },
      401
    );
  }
  
  await next();
}
