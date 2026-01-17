# Dog Recipe API

犬のレシピ生成用のCloudflare Worker APIです。

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. CSVデータの変換

`data-process/99-result/result/foods.csv`をJSONに変換します：

```bash
npm run convert-csv
```

これにより`src/data/foods.json`が生成されます。

### 3. 環境変数の設定

Cloudflare Workersの環境変数`API_KEYS`を設定します。JSON形式で以下のように設定してください：

```json
[["ACCESS_KEY_1", "SECRET_KEY_1"], ["ACCESS_KEY_2", "SECRET_KEY_2"]]
```

#### ローカル開発環境での設定

`.dev.vars`ファイルを作成（gitignoreに追加推奨）：

```
API_KEYS=[["test_access_key", "test_secret_key"]]
```

#### 本番環境での設定

```bash
wrangler secret put API_KEYS
```

またはCloudflareダッシュボードから設定します。

## 認証

すべてのAPIエンドポイント（`/health`を除く）はHMAC認証が必要です。

### Bearerトークン形式

```
Authorization: Bearer ACCESS_KEY:HMAC_SIGNATURE
```

### HMAC署名の計算

```
HMAC_SIGNATURE = HMAC-SHA256(METHOD + PATH + BODY, SECRET_KEY)
```

- `METHOD`: HTTPメソッド（例: `GET`, `POST`）
- `PATH`: パスとクエリ文字列（例: `/foods/01001` または `/foods/search`）
- `BODY`: リクエストボディ（GETリクエストの場合は空文字列）

### 例: Node.jsでの署名計算

```javascript
const crypto = require('crypto');

function computeSignature(method, path, body, secretKey) {
  const message = `${method}${path}${body}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

const accessKey = 'test_access_key';
const secretKey = 'test_secret_key';
const method = 'GET';
const path = '/foods/01001';
const body = '';

const signature = computeSignature(method, path, body, secretKey);
const bearerToken = `${accessKey}:${signature}`;

// Authorization: Bearer test_access_key:abc123...
```

## API エンドポイント

### GET /health

ヘルスチェック（認証不要）

**レスポンス:**
```json
{
  "status": "ok"
}
```

### GET /foods/:id

指定されたIDの食品を取得（認証必要）

**例:**
```
GET /foods/01001
Authorization: Bearer ACCESS_KEY:HMAC_SIGNATURE
```

**レスポンス:**
```json
{
  "foods": [
    {
      "food_group": "01",
      "food_number": "01001",
      "food_name": "アマランサス　玄穀",
      "food_name_en": "Amaranth grain, raw",
      "CA": 160,
      "NA": 1,
      "score": 8,
      ...
    }
  ]
}
```

### GET /foods?ids=...

複数のIDで食品を取得（認証必要）

**例:**
```
GET /foods?ids=01001,01002,01003
Authorization: Bearer ACCESS_KEY:HMAC_SIGNATURE
```

**レスポンス:**
```json
{
  "foods": [...]
}
```

### POST /foods/search

栄養素やスコアで検索（認証必要）

**リクエストボディ:**
```json
{
  "filters": [
    { "column": "CA", "operator": "gte", "value": 100 },
    { "column": "NA", "operator": "lte", "value": 50 },
    { "column": "score", "operator": "gte", "value": 9 }
  ],
  "sort": { "column": "NA", "order": "asc" },
  "limit": 30,
  "offset": 0
}
```

**フィルターオペレーター:**
- `eq`: 等しい
- `gte`: 以上
- `gt`: より大きい
- `lte`: 以下
- `lt`: より小さい

**ソート:**
- `asc`: 昇順
- `desc`: 降順

**レスポンス:**
```json
{
  "total": 125,
  "foods": [...]
}
```

## 開発

### ローカル開発サーバーの起動

```bash
npm run dev
```

### 型チェック

```bash
npm run type-check
```

### デプロイ

```bash
npm run deploy
```
