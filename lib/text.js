/**
 * 富文本净化：把数据源里的标记文本压成可读纯文本。
 *
 * 处理四类东西：
 * 1. 花括号占位符 —— `{NICKNAME}`、`{F#少女}{M#少年}`（性别二选一）、`{RUBY_B#…}{RUBY_E#}`（注音）。
 * 2. 参数占位符 —— `#N[i]` / `#N[f1]` / `#N[f2]`，取值来自该级的 `param_list`；
 *    后面紧跟 `%` 时一律 ×100（数据里存的是比例），`[i]` 保留最多 3 位小数、`[f1]`/`[f2]` 定 1、2 位。
 * 3. HTML 标签 —— `<color=#RRGGBBAA>`、`<unbreak>`、`<u>`、`<i>`、`<b>`。
 * 4. 双重转义的换行 —— 源数据里是字面反斜杠加 n，还原成真换行。
 */

const TAG_RE = /<\/?(?:color(?:=[^>]*)?|unbreak|u|i|b)>/g;
const RUBY_RE = /\{RUBY_B#[^{}]*\}|\{RUBY_E#\}/g;
const GENDER_PAIR_RE = /\{F#([^{}]*)\}\{M#([^{}]*)\}/g;
const GENDER_SINGLE_RE = /\{([FM])#([^{}]*)\}/g;
const PLACEHOLDER_RE = /#(\d+)\[(i|f1|f2|p)\](\s*%?)/g;

/** 去掉多余的尾零，最多保留 `digits` 位小数。 */
function trimFixed(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  const fixed = value.toFixed(digits);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/** 普通数值：整数不带小数点，小数最多 3 位。 */
function trimNumber(value) {
  return trimFixed(value, 3);
}

/**
 * 把一段标记文本压成纯文本。
 * @param {unknown} input 原始文本。
 * @param {number[]} [params] 当前等级的 `param_list`。
 * @param {{ nickname?: string, gender?: 'F'|'M' }} [opts] 名字与性别选择。
 * @returns {string} 可读文本；非字符串输入返回空串。
 */
export function plainText(input, params = [], opts = {}) {
  if (typeof input !== 'string' || input.length === 0) return '';
  let text = input;

  text = text.replace(/\{NICKNAME\}/g, opts.nickname || '开拓者');
  text = text.replace(RUBY_RE, '');
  text = text.replace(GENDER_PAIR_RE, (_m, female, male) => (opts.gender === 'M' ? male : female));
  text = text.replace(GENDER_SINGLE_RE, (_m, _kind, body) => body);

  const list = Array.isArray(params) ? params : [];
  text = text.replace(PLACEHOLDER_RE, (whole, index, kind, suffix) => {
    const value = list[Number(index) - 1];
    if (typeof value !== 'number' || !Number.isFinite(value)) return whole;
    const percent = suffix.trim() === '%';
    if (kind === 'f1') return trimFixed(percent ? value * 100 : value, 1) + suffix;
    if (kind === 'f2') return trimFixed(percent ? value * 100 : value, 2) + suffix;
    if (percent) return trimFixed(value * 100, 3) + suffix;
    return trimNumber(value) + suffix;
  });

  text = text.replace(TAG_RE, '');
  text = text.replace(/\\n/g, '\n').replace(/\\t/g, ' ').replace(/\\r/g, '');
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t\u3000]+$/g, '').replace(/^[ \t\u3000]+/g, ''))
    .join('\n');
  return text.trim();
}

/**
 * 把一个可能是参数引用的数值字段（如忆灵基础值 `#6`）解析成数字。
 * @param {unknown} ref 形如 `"#6"` 的引用或直接的数字。
 * @param {number[]} params 引用所指技能的 `param_list`。
 * @returns {number|null} 解析结果，失败为 null。
 */
export function resolveParamRef(ref, params) {
  if (typeof ref === 'number' && Number.isFinite(ref)) return ref;
  if (typeof ref !== 'string') return null;
  const matched = /^#(\d+)$/.exec(ref.trim());
  if (!matched) {
    const literal = Number(ref);
    return Number.isFinite(literal) ? literal : null;
  }
  const value = Array.isArray(params) ? params[Number(matched[1]) - 1] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 百分比或平值展示：小于 1 的数按百分比（×100），其余原样。
 * @param {number} value 原始数值。
 * @returns {string} 展示文本。
 */
export function ratioOrFlat(value) {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) < 1) return `${trimFixed(value * 100, 2)}%`;
  return trimNumber(value);
}
