/**
 * 参数解析：把模型给的一行 `args` 拆成查询意图。
 *
 * 支持 `--flag 值`、`--flag=值`、`--flag --值` 三种写法；布尔 flag 不接受值。
 * 非法输入抛 `UsageError`，消息里只出现合法 flag，不出现任何链接。
 */

/** 参数用法有误。 */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const KIND_FLAGS = new Map([
  ['role', 'role'],
  ['lightcone', 'lightcone'],
  ['relicset', 'relicset'],
]);

/** 其它取值的 flag：名字 → 归一化后的键。 */
const VALUE_FLAGS = new Map([
  ['basetype', 'baseType'],
  ['damagetype', 'damageType'],
  ['star', 'star'],
  ['lang', 'lang'],
  ['section', 'section'],
]);

/** 不带值的 flag。 */
const BOOLEAN_FLAGS = new Map([
  ['list', 'list'],
  ['rule', 'rule'],
  ['exp', 'exp'],
  ['team', 'team'],
  ['teamknowledge', 'teamKnowledge'],
]);

const FLAG_HINT =
  '--role、--lightcone、--relicset、--list、--baseType、--damageType、--star、--lang、--exp、--team、--teamKnowledge、--section';

const KIND_LABEL = { role: '角色', lightcone: '光锥', relicset: '遗器套装' };

const KIND_EXAMPLE = {
  role: '--role 三月七',
  lightcone: '--lightcone 银河铁道之夜',
  relicset: '--relicset 云无留迹的过客',
};

/** 缺值报错：类别 flag 顺带给出一个例子。 */
function missingValue(flagName, key) {
  const example = KIND_EXAMPLE[key];
  return new UsageError(
    example ? `参数 --${flagName} 缺少取值，例如 \`${example}\`。` : `参数 --${flagName} 缺少取值。`,
  );
}

/** 把一行文本切成 token，支持成对引号。 */
function tokenize(input) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let matched;
  while ((matched = re.exec(input)) !== null) {
    const value = matched[1] ?? matched[2] ?? matched[3] ?? '';
    if (value.length > 0) tokens.push(value);
  }
  return tokens;
}

function isKnownFlag(name) {
  return KIND_FLAGS.has(name) || VALUE_FLAGS.has(name) || BOOLEAN_FLAGS.has(name);
}

/**
 * 解析 `args`。
 * @param {string} input 模型给的原始参数行。
 * @returns {{kind: 'role'|'lightcone'|'relicset'|null, name: string|null, list: boolean, rule: boolean, exp: boolean, team: boolean, teamKnowledge: boolean, baseType: string|null, damageType: string|null, star: number|null, lang: string|null}} 解析结果。
 */
export function parseArgs(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new UsageError(`请给出查询内容，例如 \`--role 三月七\`。可用参数：${FLAG_HINT}`);
  }

  const result = {
    kind: null,
    name: null,
    list: false,
    rule: false,
    exp: false,
    team: false,
    teamKnowledge: false,
    baseType: null,
    damageType: null,
    star: null,
    lang: null,
    section: null,
  };

  const tokens = tokenize(input);
  // --list 出现时，--role / --lightcone / --relicset 可以只表示"要列哪一类"，不带名字。
  const listRequested = tokens.some((token) => token.toLowerCase() === '--list');

  const setKind = (kind) => {
    if (result.kind !== null && result.kind !== kind) {
      throw new UsageError('一次只能查一种：角色、光锥或遗器套装。');
    }
    result.kind = kind;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      throw new UsageError(`无法识别的片段「${token}」。请用 flag 形式，可用参数：${FLAG_HINT}`);
    }

    let flagName = '';
    let inlineValue;
    const body = token.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      flagName = body.slice(0, equals);
      inlineValue = body.slice(equals + 1);
    } else {
      flagName = body;
    }
    const key = flagName.toLowerCase();

    if (BOOLEAN_FLAGS.has(key)) {
      if (inlineValue !== undefined) {
        throw new UsageError(`参数 --${flagName} 不需要取值。`);
      }
      result[BOOLEAN_FLAGS.get(key)] = true;
      continue;
    }

    if (!KIND_FLAGS.has(key) && !VALUE_FLAGS.has(key)) {
      throw new UsageError(`未知参数 --${flagName}。可用参数：${FLAG_HINT}`);
    }

    if (KIND_FLAGS.has(key) && listRequested && inlineValue === undefined && tokens[index + 1]?.startsWith('--') !== false) {
      setKind(KIND_FLAGS.get(key));
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = tokens[index + 1];
      if (next === undefined) {
        throw missingValue(flagName, key);
      }
      index += 1;
      if (next.startsWith('--')) {
        const stripped = next.slice(2);
        if (isKnownFlag(stripped.toLowerCase()) || stripped.length === 0) {
          throw missingValue(flagName, key);
        }
        value = stripped;
      } else {
        value = next;
      }
    }
    if (value.length === 0) throw missingValue(flagName, key);

    if (KIND_FLAGS.has(key)) {
      setKind(KIND_FLAGS.get(key));
      result.name = value;
    } else if (VALUE_FLAGS.get(key) === 'baseType') {
      result.baseType = value;
    } else if (VALUE_FLAGS.get(key) === 'damageType') {
      result.damageType = value;
    } else if (VALUE_FLAGS.get(key) === 'star') {
      const star = Number(value);
      if (!Number.isInteger(star) || star < 1 || star > 5) {
        throw new UsageError('--star 只能是 3、4、5。');
      }
      result.star = star;
    } else if (VALUE_FLAGS.get(key) === 'section') {
      result.section = value;
    } else {
      result.lang = value;
    }
  }

  if (result.section !== null && !result.teamKnowledge) {
    throw new UsageError('--section 只能配合 --teamKnowledge 使用，用来取游戏规则里的某一节。');
  }
  if (result.kind === null && !result.list && !result.rule && !result.exp && !result.teamKnowledge) {
    throw new UsageError(`请说明要查什么，例如 \`--role 三月七\`、\`--list\`。可用参数：${FLAG_HINT}`);
  }
  if (result.kind !== null && result.name === null && !result.list) {
    throw new UsageError(`请给出名字，例如 \`--${result.kind} 三月七\`。需要清单请加 --list。`);
  }
  if (result.rule && (result.exp || result.teamKnowledge)) {
    throw new UsageError('--rule 已经包含查询经验，不需要再给 --exp 或 --teamKnowledge。');
  }
  if (result.teamKnowledge && (result.exp || result.list || result.kind !== null)) {
    throw new UsageError('--teamKnowledge 单独使用即可，不需要再给别的查询参数。');
  }
  if (result.team && !result.exp) {
    throw new UsageError('--team 只能配合 --exp 使用，用来读配队经验。');
  }
  if (result.star !== null && result.kind !== 'lightcone') {
    throw new UsageError('--star 只能用于光锥。');
  }
  const filtered = result.baseType !== null || result.damageType !== null;
  if (result.damageType !== null && result.kind !== 'role') {
    throw new UsageError('只有角色有属性维度，--damageType 只能用于角色。');
  }
  if (result.baseType !== null && result.kind === 'relicset') {
    throw new UsageError('遗器套装没有命途之分，--baseType 不能用于遗器。');
  }
  if (filtered && result.kind === null) {
    throw new UsageError('筛选要配合 --role 或 --lightcone 使用。');
  }
  return result;
}

export { KIND_LABEL };
