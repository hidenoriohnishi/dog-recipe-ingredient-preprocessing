#!/usr/bin/env node
/**
 * .varsファイルから環境変数を読み込んで、wrangler secret putを実行するスクリプト
 * 
 * 使用方法:
 *   pnpm tsx scripts/set-secrets.ts
 *   または
 *   npm run set-secrets
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiDir = join(__dirname, '..');

/**
 * .varsファイルを読み込んでパース
 */
function loadVarsFile(): Record<string, string> {
  const varsPath = join(apiDir, '.vars');
  
  try {
    const content = readFileSync(varsPath, 'utf-8');
    const vars: Record<string, string> = {};
    
    // 行ごとに処理
    const lines = content.split('\n');
    
    for (const line of lines) {
      // 空行やコメント行をスキップ
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // KEY=VALUE形式をパース
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) {
        console.warn(`Skipping invalid line: ${trimmed}`);
        continue;
      }
      
      const key = trimmed.substring(0, equalIndex).trim();
      const value = trimmed.substring(equalIndex + 1).trim();
      
      // クォートを除去（オプション）
      const unquotedValue = value.replace(/^["']|["']$/g, '');
      vars[key] = unquotedValue;
    }
    
    return vars;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Error: .vars file not found at ${varsPath}`);
      console.error('Please create .vars file with the following format:');
      console.error('KEY1=value1');
      console.error('KEY2=value2');
      process.exit(1);
    }
    throw error;
  }
}

/**
 * wrangler secret putを実行
 */
function setSecret(key: string, value: string): void {
  try {
    console.log(`Setting secret: ${key}...`);
    
    // 一時ファイルを作成して値を書き込む
    const tempFile = join(tmpdir(), `wrangler-secret-${key}-${Date.now()}.txt`);
    writeFileSync(tempFile, value, 'utf-8');
    
    try {
      // wrangler secret putは標準入力から値を読み取る
      execSync(`wrangler secret put ${key} < "${tempFile}"`, {
        cwd: apiDir,
        stdio: 'inherit',
        shell: true,
      });
      
      console.log(`✓ Successfully set ${key}\n`);
    } finally {
      // 一時ファイルを削除
      try {
        unlinkSync(tempFile);
      } catch {
        // 削除に失敗しても無視
      }
    }
  } catch (error) {
    console.error(`✗ Failed to set ${key}:`, error);
    throw error;
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('Loading .vars file...\n');
  
  const vars = loadVarsFile();
  const keys = Object.keys(vars);
  
  if (keys.length === 0) {
    console.warn('No environment variables found in .vars file');
    process.exit(0);
  }
  
  console.log(`Found ${keys.length} environment variable(s):`);
  keys.forEach(key => console.log(`  - ${key}`));
  console.log('');
  
  // 各環境変数を設定
  for (const key of keys) {
    const value = vars[key];
    setSecret(key, value);
  }
  
  console.log('✓ All secrets have been set successfully!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
