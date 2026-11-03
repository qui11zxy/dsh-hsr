/**
 * 名字匹配：把用户给的名字对到索引里的一条（或一组）记录上。
 *
 * 规则是分级的——完全相等 > 前缀 > 包含 > 编辑距离；同级里 id 小的优先，
 * 让"三月七"稳定落在最早的那个版本上。索引只含名字/命途/属性这类轻量字段，
 * 详情要另外去取。
 */

/** 开拓者的各种叫法，命中后落到 8001–8010 这一组。 */
const NICKNAME_KEYS = new Set([
  '开拓者',
  '星',
  '穹',
  'nickname',
  'trailblazer',
  'thetrailblazer',
  'stella',
  'caelus',
]);

const PUNCTUATION_RE = /[\s\u3000"'`~!@#$%^&*()_+\-=[\]{}\\|;:,.<>/?·•★☆「」『』【】、，。！？；：（）]/g;

/**
 * 规范化一个名字：去注音、去标点空白、全角转半角、转小写。
 * @param {unknown} value 原始名字。
 * @returns {string} 规范化结果。
 */
export function normalizeName(value) {
  if (typeof value !== 'string') return '';
  let text = value.normalize('NFKC');
  text = text.replace(/\{RUBY_B#[^{}]*\}|\{RUBY_E#\}/g, '');
  text = text.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  text = text.replace(PUNCTUATION_RE, '');
  return text.toLowerCase();
}

/** 编辑距离，超过 `limit` 直接返回 limit+1。 */
function distance(a, b, limit) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * 给一个候选打匹配分。
 * @param {string} query 规范化后的查询名。
 * @param {string[]} names 该候选的所有名字（各语言）。
 * @returns {number} 0 表示不匹配，越高越好。
 */
function scoreOf(query, names) {
  let best = 0;
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized.length === 0) continue;
    if (normalized === query) return 1000;
    if (normalized.startsWith(query) || query.startsWith(normalized)) {
      best = Math.max(best, 800 - Math.abs(normalized.length - query.length));
      continue;
    }
    if (normalized.includes(query) || query.includes(normalized)) {
      best = Math.max(best, 600 - Math.abs(normalized.length - query.length));
      continue;
    }
    const limit = query.length >= 4 ? 2 : 1;
    const d = distance(query, normalized, limit);
    if (d <= limit) best = Math.max(best, 400 - d * 50);
  }
  return best;
}

/**
 * 判断查询是不是在指开拓者。
 * @param {string} query 规范化后的查询名。
 * @returns {boolean} 是否指开拓者。
 */
export function isNicknameQuery(query) {
  return NICKNAME_KEYS.has(query);
}

/**
 * 在索引里找出与查询最匹配的条目。
 * @param {Record<string, object>} index 以 id 为键的索引。
 * @param {string} name 用户给的名字。
 * @param {(entry: object) => boolean} [accept] 额外过滤（命途、属性、星级等）。
 * @returns {{id: string, entry: object}[]} 命中的条目，按分数与 id 排序。
 */
export function findEntries(index, name, accept) {
  const query = normalizeName(name);
  if (query.length === 0) return [];
  const hits = [];
  for (const [id, entry] of Object.entries(index)) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (accept && !accept(entry)) continue;
    const names = [entry.zh, entry.en].filter((value) => typeof value === 'string');
    const score = scoreOf(query, names);
    if (score > 0) hits.push({ id, entry, score });
  }
  hits.sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));
  return hits;
}
