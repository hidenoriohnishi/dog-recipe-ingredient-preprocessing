# 09-1-2: USDA食品名Embedding

## 概要

09-1-1で正規化したUSDA食品データの説明（description）をOpenAI Embedding APIでベクトル化します。
このembeddingは、後続の09-2でMEXTとUSDAの食品名マッチングに使用します。

## 入力

- `../09-1-1-usda-normalize/result/usda-foods.json` - 正規化されたUSDA食品データ

## 出力

- `result/batches/batch-XXXX.json` - バッチごとのembedding（分割保存）
- `result/progress.json` - 処理進捗

### 出力形式（各バッチファイル）

```json
[
  {
    "fdc_id": "167512",
    "description": "Pillsbury Golden Layer Buttermilk Biscuits...",
    "embedding": [0.123, -0.456, ...]
  },
  ...
]
```

**注意**: 全embeddingをまとめると約400MB以上になるため、バッチごとに分割保存しています。

## 技術仕様

- **モデル**: text-embedding-3-large
- **次元数**: 3072
- **バッチサイズ**: 100件/リクエスト
- **再開可能**: progress.jsonで処理済みを記録

## 実行

```bash
pnpm run process:9-1-2
```

## 料金

各バッチごとにトークン数と料金を表示します。
