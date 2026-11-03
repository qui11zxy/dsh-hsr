/**
 * 数据源访问层。
 *
 * 每次调用都实时联网取数，不做本地缓存、不落盘：地址、版本号推导都封在内部，
 * 报错信息里也不出现任何链接。
 */

import { requestText, NetError, ProxyError } from './http.js';
import { resolveProxy } from './settings.js';

const ORIGIN = 'https://static.nanoka.cc';
const REQUEST_TIMEOUT_MS = 20000;

/** 连不上时的统一提示。 */
export const NETWORK_FAILED = '无法连接，请检查网络连接或配置可用代理';

/** 数据取不到时抛出，消息可直接展示给用户。 */
export class DataUnavailable extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DataUnavailable';
    this.plain = options.plain === true;
  }
}

async function readJson(path, missingMessage) {
  let proxy = '';
  try {
    proxy = resolveProxy();
  } catch {
    proxy = '';
  }
  let response;
  try {
    response = await requestText(ORIGIN + path, { proxy, timeoutMs: REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof ProxyError) {
      throw new DataUnavailable('代理设置不正确，请填 127.0.0.1:7897 这样的地址。', { plain: true });
    }
    if (error instanceof NetError) throw new DataUnavailable(NETWORK_FAILED, { plain: true });
    throw new DataUnavailable(NETWORK_FAILED, { plain: true });
  }
  if (response.status === 404) throw new DataUnavailable(missingMessage);
  if (response.status !== 200) {
    throw new DataUnavailable('数据源暂时不可用，请稍后再试。');
  }
  try {
    return JSON.parse(response.text);
  } catch {
    throw new DataUnavailable('数据格式异常，请稍后再试。');
  }
}

/**
 * 解析当前应当使用的数据版本。
 * @param {boolean} safeMode 安全模式下用稳定版本，否则用最新版本。
 * @returns {Promise<string>} 版本号。
 */
export async function resolveVersion(safeMode) {
  const manifest = await readJson('/manifest.json', '版本信息暂时取不到，请稍后再试。');
  const hsr = manifest && typeof manifest === 'object' ? manifest.hsr : null;
  const version = safeMode ? hsr?.live : hsr?.latest;
  if (typeof version !== 'string' || version.length === 0) {
    throw new DataUnavailable('版本信息暂时取不到，请稍后再试。');
  }
  return version;
}

/**
 * 读索引（角色或光锥）。
 * @param {'character'|'lightcone'} kind 索引类型。
 * @param {string} version 数据版本。
 * @returns {Promise<Record<string, unknown>>} 以 id 为键的索引。
 */
export async function loadIndex(kind, version) {
  const value = await readJson(
    `/hsr/${version}/${kind}.json`,
    '当前版本的角色与光锥目录取不到，请稍后再试。',
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataUnavailable('数据格式异常，请稍后再试。');
  }
  return value;
}

/**
 * 读遗器套装表。
 * @param {string} version 数据版本。
 * @returns {Promise<Record<string, unknown>>} 以 id 为键的套装表。
 */
export async function loadRelicSets(version) {
  const value = await readJson(
    `/hsr/${version}/relicset.json`,
    '当前版本还没有遗器套装数据，请稍后再试。',
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataUnavailable('数据格式异常，请稍后再试。');
  }
  return value;
}

/**
 * 读一条详情。
 * @param {'character'|'lightcone'} kind 条目类型。
 * @param {string} version 数据版本。
 * @param {string} lang 语言。
 * @param {string} id 条目 id。
 * @returns {Promise<object>} 详情对象。
 */
export async function loadDetail(kind, version, lang, id) {
  const value = await readJson(
    `/hsr/${version}/${lang}/${kind}/${id}.json`,
    '该条目在当前版本还没有收录，换个名字或稍后再试试。',
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataUnavailable('数据格式异常，请稍后再试。');
  }
  return value;
}
