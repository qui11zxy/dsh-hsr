/**
 * 本机设置：代理、经验文本，都存在 `~/.dsh/dsh-hsr/settings.json` 与相邻的文件里。
 *
 * 代理的取值规则（设置页里也是这么写的）：
 * - 留空 → 跟随系统代理（环境变量 HTTPS_PROXY / HTTP_PROXY，其次 Windows 的 Internet 设置）；
 * - 填 `direct` → 强制直连；
 * - 填 `127.0.0.1:7897` 这类地址 → 就走它。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

/** 插件的数据目录（用户主目录下）。 */
export function dataDir() {
  return path.join(os.homedir(), '.dsh', 'dsh-hsr');
}

/** 设置文件路径。 */
export function settingsPath() {
  return path.join(dataDir(), 'settings.json');
}

const DIRECT = 'direct';

function normalize(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return { proxy: typeof value.proxy === 'string' ? value.proxy.trim() : '' };
}

/** 读设置；文件不存在或损坏时返回默认值。 */
export function readSettings() {
  try {
    return normalize(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    return normalize(null);
  }
}

/** 写设置；只接受 proxy 一个字段。 */
export function writeSettings(patch) {
  const next = normalize({ ...readSettings(), ...(patch || {}) });
  fs.mkdirSync(dataDir(), { recursive: true });
  const temp = `${settingsPath()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, settingsPath());
  return next;
}

function pickEnvProxy() {
  const names = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

let systemProxyCache = { at: 0, value: '' };

function pickSystemProxy() {
  if (process.platform !== 'win32') return '';
  const now = Date.now();
  if (now - systemProxyCache.at < 30000) return systemProxyCache.value;
  let value = '';
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const query = execFileSync('reg', ['query', key], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(query);
    if (enabled) {
      const matched = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(query);
      const raw = matched ? matched[1].trim() : '';
      if (raw.includes('=')) {
        const parts = raw.split(';').map((part) => part.trim()).filter(Boolean);
        const https = parts.find((part) => part.toLowerCase().startsWith('https='));
        const http = parts.find((part) => part.toLowerCase().startsWith('http='));
        const chosen = https || http || parts[0];
        value = chosen.includes('=') ? chosen.slice(chosen.indexOf('=') + 1) : chosen;
      } else {
        value = raw;
      }
    }
  } catch {
    value = '';
  }
  systemProxyCache = { at: now, value };
  return value;
}

/**
 * 算出本次请求该用的代理。
 * @returns {string} 代理地址；空串表示直连。
 */
export function resolveProxy() {
  const configured = readSettings().proxy;
  if (configured.toLowerCase() === DIRECT) return '';
  if (configured.length > 0) return configured;
  const fromEnv = pickEnvProxy();
  if (fromEnv.length > 0) return fromEnv;
  return pickSystemProxy();
}

/** 设置页展示用的当前代理来源。 */
export function describeProxy() {
  const configured = readSettings().proxy;
  if (configured.toLowerCase() === DIRECT) return { proxy: '', source: 'direct' };
  if (configured.length > 0) return { proxy: configured, source: 'setting' };
  const fromEnv = pickEnvProxy();
  if (fromEnv.length > 0) return { proxy: fromEnv, source: 'env' };
  const fromSystem = pickSystemProxy();
  if (fromSystem.length > 0) return { proxy: fromSystem, source: 'system' };
  return { proxy: '', source: 'none' };
}
