# 09-2-1-1: MEXT食品名 日英翻訳

## 概要

MEXT（日本食品標準成分表）の各食材の名前をAIで英語に翻訳します。
これにより、USDAとの食品名マッチングの精度が向上します。

## 入力

- `../07-normalize-headers/result/final-nutrition.csv` - MEXT食品データ

## 出力

- `result/translated-names.json` - 翻訳結果
- `result/progress.json` - 進捗管理ファイル

### 出力形式

```json
[
  {
    "food_number": "01001",
    "food_name_ja": "アマランサス　玄穀",
    "food_name_en": "Amaranth grain, raw"
  },
  ...
]
```

## 使用モデル

- `gpt-4.1-2025-04-14`

## バッチサイズ

- 50件ごとにAI翻訳
- 1秒間隔でAPI呼び出し（レートリミット対策）

## 翻訳ルール

1. USDAで使われる一般的な英語名に翻訳
2. 調理方法も含める（例: "生" → "raw", "焼き" → "grilled"）
3. 魚は一般的な英語名を使用（例: "コイ" → "Carp"）
4. カテゴリ接頭辞（＜魚類＞など）は除去

## 再実行

進捗ファイル（`result/progress.json`）を参照して、中断したところから再開可能です。
全てリセットする場合は `result/` ディレクトリを削除してください。

## 実行

```bash
pnpm run process:9-2-1-1
```
