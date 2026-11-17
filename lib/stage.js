/**
 * 深渊关卡：忘却之庭、虚构叙事、末日幻影、异相仲裁。
 *
 * 取数分三步：
 * 1. 读每个玩法的索引（`maze.json` / `maze_extra.json` / `maze_boss.json` / `maze_peak.json`），
 *    按 `live_begin` ~ `live_end` 选出当前生效的那一期；
 * 2. 读关卡详情：忘却之庭、虚构叙事、末日幻影取三间（星启模式那一间，加上它前面
 *    那关的上下两间）；异相仲裁取当前一期（id 最大的一关；测试模式下数据比稳定版
 *    多一条，取倒数第二）；
 * 3. 从关卡的波次里找出主怪（一般是第二波），再查怪物详情拿弱点与技能特点。
 *
 * 怪物技能只留「机制」，不列技能名：把描述里「对指定我方单体造成 X 属性伤害」这类
 * 纯伤害句去掉，剩下的机制句标成「技能特点」。
 *
 * 图片索引、掉落、关卡配置、关卡 id 一律不输出。
 */

import { normalizeName } from './match.js';
import { plainText } from './text.js';

/** 四个玩法的定义：索引文件名、详情目录名、中英文名与别名。 */
export const STAGE_MODES = [
  {
    key: 'maze',
    index: 'maze',
    folder: 'maze',
    zh: '忘却之庭',
    en: 'Memory of Chaos',
    aliases: ['忘却之庭', '混沌回忆', '记忆之庭', 'memory of chaos', 'moc'],
  },
  {
    key: 'story',
    index: 'maze_extra',
    folder: 'story',
    zh: '虚构叙事',
    en: 'Unknowable Domain',
    aliases: ['虚构叙事', '不可知领域', 'unknowable domain', 'ud'],
  },
  {
    key: 'boss',
    index: 'maze_boss',
    folder: 'boss',
    zh: '末日幻影',
    en: 'Apocalyptic Shadow',
    aliases: ['末日幻影', '历战余影', 'apocalyptic shadow', 'as'],
  },
  {
    key: 'peak',
    index: 'maze_peak',
    folder: 'peak',
    zh: '异相仲裁',
    en: 'Peak Arbitration',
    aliases: ['异相仲裁', '异象仲裁', '仲裁', 'peak arbitration', 'pa'],
  },
];

/** 标签。 */
const LABELS = {
  zh: {
    title: '当前深渊关卡',
    starLaunch: '星启模式',
    limit: '限时',
    enemyTypes: '敌方属性',
    goals: '目标',
    starGoal: '额外目标',
    wave: '第 {n} 波',
    mainMonster: '主怪',
    weakness: '弱点（可削韧属性）',
    resist: '抗性',
    laterWaves: '第一波小怪',
    noMonster: '这一关没有查到主怪。',
    inactive: '（当前不在开放期，显示最近的一期）',
    more: '等 {n} 条',
    traits: '技能特点',
    effects: '关卡增益',
    options: '增益选项',
    tags: '关卡词条',
    bossLevel: '首领关',
    nothing: '（没有查到进行中的深渊关卡。）',
    only: '只查',
    chamber: '第 {n} 间',
  },
  en: {
    title: 'Current Challenge Stages',
    starLaunch: 'Star Launch',
    limit: 'Time limit',
    enemyTypes: 'Enemy types',
    goals: 'Goals',
    starGoal: 'Extra goal',
    wave: 'Wave {n}',
    mainMonster: 'Main enemy',
    weakness: 'Weakness (elements that break its toughness)',
    resist: 'Resistances',
    laterWaves: 'First-wave enemies',
    noMonster: 'No main enemy found for this stage.',
    inactive: ' (not currently open, showing the closest one)',
    more: 'and {n} more',
    traits: 'Skill traits',
    effects: 'Stage buffs',
    options: 'Buff options',
    tags: 'Stage tags',
    bossLevel: 'Boss stage',
    nothing: '(no challenge stage found.)',
    only: 'only',
    chamber: 'Part {n}',
  },
};

/** 一个技能描述里，最多保留多少条机制。 */
const TRAIT_LIMIT = 6;

/** 描述里出现这些词，说明这句在讲机制，不只是打伤害。 */
const MECHANIC_HINT =
  /(降低|提高|减少|提升|增加|无视|减免|额外|抗性|回复|恢复|获得|失去|陷入|状态|层|削韧|韧性|护盾|召唤|施放|释放|行动|回合|能量|战技点|抵抗|击破|弱点|增益|减益|标记|嘲讽|持续|概率|受到攻击|抵消|免疫|封锁|减速|加速|延后|提前|冻结|缴械|沉默|禁锢|蓄力|承受)/;

/** 英文描述里的机制词。 */
const MECHANIC_HINT_EN =
  /(reduce|increas|lessen|ignores|resist|recover|restore|gain|lose|enter|stagger|toughness|shield|summon|perform|release|action|turn|energy|skill point|break|weakness|buff|debuff|mark|taunt|duration|chance|immune|seal|slow|speed up|delay|advance|freeze|disarm|silence|charge|additional turn)/i;

/** 句首的纯伤害描述：整段去掉，只留后面的机制。 */
const DAMAGE_LEAD_ZH = /^[^，,。；;]{0,24}对[^，,]{0,24}?造成[^，,]{0,24}?伤害[，,]?\s*/;
const DAMAGE_LEAD_EN = /^[^,.]{0,80}?(?:deals|damage|inflicts)[^,.]{0,80}?(?:damage|dmg)[^,.]{0,24}[,.]?\s*/i;

/**
 * 解析时间窗口字符串（形如 `2026-11-02 04:00:00`）。
 * @param {unknown} text 原始字符串。
 * @returns {Date|null} 解析结果。
 */
function parseWindow(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  const normalized = text.trim().replace(' ', 'T');
  const value = new Date(normalized);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * 从索引里挑当前生效的条目。
 * @param {Record<string, object>} index 索引。
 * @param {number} now 当前时间戳。
 * @returns {{id: string, entry: object, active: boolean}|null} 命中的条目。
 */
export function pickLiveEntry(index, now = Date.now()) {
  const withWindow = [];
  for (const [id, entry] of Object.entries(index || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const begin = parseWindow(entry.live_begin);
    const end = parseWindow(entry.live_end);
    if (!begin || !end) continue;
    withWindow.push({ id, entry, begin, end });
  }
  if (withWindow.length === 0) return null;
  const active = withWindow.find((item) => item.begin.getTime() <= now && now <= item.end.getTime());
  if (active) return { id: active.id, entry: active.entry, active: true };
  // 不在开放期时，取最近的一期：已经开始的里最近的那个，没有就从最早的开始。
  const started = withWindow.filter((item) => item.begin.getTime() <= now);
  const pool = started.length > 0 ? started : withWindow;
  pool.sort((a, b) => Math.abs(a.begin.getTime() - now) - Math.abs(b.begin.getTime() - now));
  return { id: pool[0].id, entry: pool[0].entry, active: false };
}

/**
 * 从关卡详情里挑出要展示的关卡。
 * @param {string} mode 玩法 key。
 * @param {object|object[]} detail 关卡详情。
 * @returns {object[]} 关卡数组。
 */
export function selectLevels(mode, detail) {
  if (!detail || typeof detail !== 'object') return [];
  if (mode === 'peak') {
    const levels = Array.isArray(detail.pre_level) ? detail.pre_level.slice() : [];
    if (detail.boss_level && typeof detail.boss_level === 'object') levels.push(detail.boss_level);
    return levels;
  }
  const all = mode === 'maze'
    ? (Array.isArray(detail) ? detail : [])
    : (Array.isArray(detail?.level) ? detail.level : []);
  if (all.length === 0) return [];
  // 星启模式这一期一共三间：上一关的两间（上/下半），加上星启模式自己的一间。
  // 上一关在数据里是两间（event_id_list1 / event_id_list2），星启只有一个 event_id_list，
  // 所以取最后两关就正好是三间。
  return all.slice(-2);
}
/**
 * 取一关里的所有波次，按「间」分组。
 *
 * 一关最多两间：上半在 `event_id_list1`，下半在 `event_id_list2`；
 * 星启模式那一关只有一间，直接放在 `event_id_list` 里。
 * 这里保留分组，渲染时才能把两间的怪分开，不会混在一起。
 * @param {object} level 关卡。
 * @returns {{chamber: number, stage: object}[]} 波次列表，`chamber` 从 1 起。
 */
function collectStages(level) {
  const rows = [];
  let chamber = 1;
  for (const key of ['event_id_list', 'event_id_list1', 'event_id_list2']) {
    const list = level?.[key];
    if (!Array.isArray(list) || list.length === 0) continue;
    for (const stage of list) {
      if (stage && typeof stage === 'object') rows.push({ chamber, stage });
    }
    chamber += 1;
  }
  return rows;
}

/**
 * 从一波的怪物表里取出怪物 id。
 * @param {object} wave 一波。
 * @returns {string[]} 怪物 id。
 */
function monsterIdsOf(wave) {
  if (!wave || typeof wave !== 'object') return [];
  const ids = [];
  for (const [key, value] of Object.entries(wave)) {
    if (!key.startsWith('monster')) continue;
    if (typeof value === 'number') ids.push(String(value));
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'number') ids.push(String(item));
      }
    }
  }
  return ids;
}

/**
 * 找出主怪：第一波之后的所有怪（第一波通常是小怪）；只有一波时就用那一波。
 * @param {object[]} waves 所有波次。
 * @returns {{waveIndex: number, ids: string[]}[]} 主怪分组。
 */
export function pickMainMonsters(waves) {
  if (!Array.isArray(waves) || waves.length === 0) return [];
  const groups = [];
  for (let index = 1; index < waves.length; index += 1) {
    const ids = monsterIdsOf(waves[index]);
    if (ids.length > 0) groups.push({ waveIndex: index, ids });
  }
  if (groups.length > 0) return groups;
  const ids = monsterIdsOf(waves[0]);
  return ids.length > 0 ? [{ waveIndex: 0, ids }] : [];
}

/**
 * 把一段描述切成句子。
 * @param {string} text 描述。
 * @returns {string[]} 句子。
 */
function splitSentences(text) {
  const parts = [];
  const re = /[^。；;\n]+[。；;]?/g;
  let matched;
  while ((matched = re.exec(text)) !== null) {
    const part = matched[0].trim();
    if (part.length > 0) parts.push(part);
  }
  return parts;
}

/**
 * 判断一句是不是「只讲打伤害」的纯伤害句。
 * @param {string} clause 一句描述。
 * @param {boolean} en 是否英文。
 * @returns {boolean} 是纯伤害句时为 true。
 */
function isDamageOnly(clause, en) {
  const damaged = en
    ? /(?:deals|damage|inflicts|causes)[^,.;]{0,40}(?:damage|dmg)/i.test(clause)
    : /(?:造成|受到|造成|受到)[^，,。；;]{0,8}伤害/.test(clause);
  if (!damaged) return false;
  if (en ? MECHANIC_HINT_EN.test(clause) : MECHANIC_HINT.test(clause)) return false;
  return true;
}

/**
 * 从技能描述里抽出「机制句」：去掉纯伤害描述，只留特殊机制。
 *
 * 做法是按句切，再把句子里纯打伤害的分句去掉，剩下的合起来算一条机制，
 * 这样「召唤A，每个召唤物被消灭时，削减自身韧性」不会被拆成三条碎片。
 * @param {unknown} desc 原始描述。
 * @param {string} [lang] 语言。
 * @returns {string[]} 机制句列表。
 */
export function extractTraits(desc, lang = 'zh') {
  const text = plainText(desc, []);
  if (text.length === 0) return [];
  const en = lang === 'en';
  const traits = [];
  for (const sentence of splitSentences(text)) {
    const clauses = sentence
      .split(/[，,]/)
      .map((clause) => clause.replace(/^[，,、。；;\s]+/, '').replace(/[。；;\s]+$/, '').trim())
      .filter((clause) => clause.length > 0);
    const kept = clauses.filter((clause) => !isDamageOnly(clause, en));
    if (kept.length === 0) continue;
    // 去掉句首的连接词，读起来更顺。
    const trait = kept.join('，').replace(/^(?:并且|并且|并|且|同时|然后|接着)/, '');
    if (trait.length === 0) continue;
    if (!traits.includes(trait)) traits.push(trait);
  }
  return traits;
}

/**
 * 已知固定取值的目标：文本里带占位符，但数据里没给 `param`。
 * 全部历史关卡里，这类目标只要带了取值就都是这个数。
 */
const GOAL_FALLBACK_PARAMS = new Map([
  ['无法战斗角色不超过<unbreak>#1[i]</unbreak>名', 1],
  ['No more than <unbreak>#1[i]</unbreak> downed character(s)', 1],
]);

/**
 * 把关卡目标转成文字。
 *
 * 目标文本里带 `#1` 这类占位符，取值来自该目标自己的 `param`；
 * 有些目标没带取值（例如「无法战斗角色不超过 N 名」），那就从同一份数据里
 * 找同名且带取值的其它目标来补，补不到再退到已知的固定取值。
 * @param {object} goal 目标。
 * @param {Map<string, number>} [fallback] 目标文本 → 取值。
 * @returns {string} 目标文字。
 */
function goalText(goal, fallback) {
  const name = typeof goal?.name === 'string' ? goal.name : '';
  if (name.length === 0) return '';
  const raw = goal?.param;
  if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
    return plainText(name, [Number(raw)]);
  }
  const known = fallback?.get(name) ?? GOAL_FALLBACK_PARAMS.get(name);
  if (Number.isFinite(known)) return plainText(name, [known]);
  return plainText(name.replace(/#\d+\[[^\]]*\]/g, ''), []).replace(/\s{2,}/g, ' ');
}

/**
 * 把一关的挑战目标转成文字列表。
 * @param {object} level 关卡。
 * @param {Map<string, number>} [fallback] 目标文本 → 取值。
 * @returns {string[]} 目标列表。
 */
function goalsOf(level, fallback) {
  const lines = [];
  for (const goal of Array.isArray(level?.challenge) ? level.challenge : []) {
    if (!goal || typeof goal !== 'object') continue;
    const text = goalText(goal, fallback);
    if (text) lines.push(text);
  }
  return lines;
}

/**
 * 收集一份关卡数据里所有带取值的目标，作为其它目标的取值来源。
 * @param {object|object[]} detail 关卡详情。
 * @returns {Map<string, number>} 目标文本 → 取值。
 */
function collectGoalParams(detail) {
  const map = new Map();
  const levels = Array.isArray(detail)
    ? detail
    : Array.isArray(detail?.level)
      ? detail.level
      : [
          ...(Array.isArray(detail?.pre_level) ? detail.pre_level : []),
          ...(detail?.boss_level ? [detail.boss_level] : []),
        ];
  for (const level of levels) {
    for (const goal of Array.isArray(level?.challenge) ? level.challenge : []) {
      if (!goal || typeof goal !== 'object') continue;
      const value = Number(goal.param);
      if (typeof goal.name === 'string' && Number.isFinite(value) && !map.has(goal.name)) {
        map.set(goal.name, value);
      }
    }
  }
  return map;
}

/**
 * 渲染一组「名称 + 说明」的增益或词条。
 * @param {string} title 小标题。
 * @param {object[]} list 条目列表。
 * @param {object} labels 标签。
 * @returns {string[]} 文本行。
 */
function renderEffects(title, list, labels) {
  const rows = Array.isArray(list) ? list : [];
  if (rows.length === 0) return [];
  const lines = [`- ${title}：`];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = plainText(row.name, []);
    const desc = plainText(row.desc, Array.isArray(row.param) ? row.param : []);
    if (!name && !desc) continue;
    lines.push(`  - ${name}${desc ? `：${desc}` : ''}`);
  }
  return lines.length > 1 ? lines : [];
}

/**
 * 主怪详情：弱点、抗性、技能特点。
 * @param {object} child 怪物条目。
 * @param {string} name 怪物名。
 * @param {object} labels 标签。
 * @param {object} config 配置。
 * @param {string} lang 语言。
 * @returns {string[]} 文本行。
 */
function renderMonster(child, name, labels, config, lang) {
  const lines = [];
  const weak = Array.isArray(child?.stance_weak_list) ? child.stance_weak_list : [];
  if (weak.length > 0) {
    const named = weak.map((value) => config.damageTypes?.[value]?.[lang] || value);
    lines.push(`- ${labels.weakness}：${named.join('、')}`);
  }
  const resist = Array.isArray(child?.damage_type_resistance) ? child.damage_type_resistance : [];
  const resistText = resist
    .filter((row) => row && Number(row.value) > 0)
    .map((row) => {
      const element = config.damageTypes?.[row.damage_type]?.[lang] || row.damage_type;
      return `${element} ${Math.round(Number(row.value) * 100)}%`;
    });
  if (resistText.length > 0) lines.push(`- ${labels.resist}：${resistText.join('、')}`);

  const skills = Array.isArray(child?.skill_list) ? child.skill_list : [];
  const traits = [];
  for (const skill of skills) {
    if (!skill || typeof skill !== 'object') continue;
    for (const trait of extractTraits(skill.skill_desc, lang)) {
      if (!traits.includes(trait)) traits.push(trait);
    }
  }
  // 同一条机制常被不同技能重复描述，短的被长的覆盖时只留长的。
  const keptTraits = traits.filter(
    (trait) => !traits.some((other) => other !== trait && other.includes(trait)),
  );
  if (keptTraits.length > 0) {
    lines.push(`- ${labels.traits}：`);
    for (const trait of keptTraits.slice(0, TRAIT_LIMIT)) lines.push(`  - ${trait}`);
    if (keptTraits.length > TRAIT_LIMIT) {
      lines.push(`  - ${labels.more.replace('{n}', String(keptTraits.length - TRAIT_LIMIT))}`);
    }
  }
  if (name) lines.unshift(`- ${labels.mainMonster}：${name}`);
  return lines;
}

/**
 * 渲染一关。
 * @param {object} params 参数。
 * @returns {Promise<string[]>} 文本行。
 */
async function renderLevel(params) {
  const { level, entryName, lang, labels, config, fetchMonster, isBoss } = params;
  const lines = [];
  const levelName = plainText(level?.name || '', []);
  const suffix = level?.challenge_special !== undefined ? `（${labels.starLaunch}）` : '';
  const prefix = params.titlePrefix ? `${params.titlePrefix} · ` : '';
  const heading = levelName ? `${prefix}${levelName}` : (entryName || '');
  lines.push(`### ${heading}${suffix}${isBoss ? `（${labels.bossLevel}）` : ''}`);
  const countdown = Number(level?.countdown);
  if (Number.isFinite(countdown) && countdown > 0) {
    const seconds = countdown >= 1000 ? Math.round(countdown / 1000) : countdown;
    lines.push(`- ${labels.limit}：${seconds} 秒`);
  }
  const types = Array.isArray(level?.damage_type) ? level.damage_type : [];
  if (types.length > 0) {
    const named = types.map((value) => config.damageTypes?.[value]?.[lang] || value);
    lines.push(`- ${labels.enemyTypes}：${named.join('、')}`);
  }

  const goals = goalsOf(level, params.goalParams);
  if (goals.length > 0) lines.push(`- ${labels.goals}：${goals.join('；')}`);
  if (level?.challenge_special) {
    const starGoal = goalText(level.challenge_special, params.goalParams);
    if (starGoal) lines.push(`- ${labels.starGoal}：${starGoal}`);
  }

  lines.push(...renderEffects(labels.tags, level?.tag_list, labels));
  if (Array.isArray(params.extraTags) && params.extraTags.length > 0) {
    lines.push(...renderEffects(labels.tags, params.extraTags, labels));
  }

  const stages = collectStages(level);
  const chambers = [...new Set(stages.map((row) => row.chamber))];
  const multiChamber = chambers.length > 1;
  const shown = new Set();
  let found = false;
  for (const row of stages) {
    if (multiChamber) {
      lines.push('');
      lines.push(`##### ${labels.chamber.replace('{n}', String(chambers.indexOf(row.chamber) + 1))}`);
    }
    const waves = Array.isArray(row.stage?.monster_list) ? row.stage.monster_list : [];
    const firstWaveNames = [];
    const groups = pickMainMonsters(waves);
    for (const group of groups) {
      for (const id of group.ids) {
        if (shown.has(id)) continue;
        const info = await fetchMonster(id);
        if (!info) continue;
        shown.add(id);
        found = true;
        lines.push('');
        lines.push(`#### ${labels.wave.replace('{n}', String(group.waveIndex + 1))} · ${info.name}`);
        lines.push(...renderMonster(info.child, info.name, labels, config, lang));
      }
    }
    for (const id of monsterIdsOf(waves[0])) {
      if (shown.has(id)) continue;
      const info = await fetchMonster(id);
      if (info && !firstWaveNames.includes(info.name)) firstWaveNames.push(info.name);
    }
    if (firstWaveNames.length > 0) lines.push(`- ${labels.laterWaves}：${firstWaveNames.join('、')}`);
  }

  // 末日幻影的首领 id 直接写在关卡上，不在波次里。
  if (level?.boss_monster_id) {
    const bossId = String(level.boss_monster_id);
    if (!shown.has(bossId)) {
      const info = await fetchMonster(bossId);
      if (info) {
        shown.add(bossId);
        found = true;
        lines.push('');
        lines.push(`#### ${labels.mainMonster} · ${info.name}`);
        lines.push(...renderMonster(info.child, info.name, labels, config, lang));
      }
    }
  }

  if (!found) lines.push(labels.noMonster);
  return lines;
}

/**
 * 渲染一个玩法的正文。
 * @param {object} params 参数。
 * @returns {Promise<string>} 正文。
 */
async function renderMode(params) {
  const { mode, entry, entryId, levels, lang, labels, config, fetchMonster, isBossLevel } = params;
  const en = lang === 'en';
  const lines = [];
  const modeName = en ? mode.en : mode.zh;
  const entryName = plainText(entry?.[lang] || entry?.zh || entry?.en || '', []);
  lines.push(`## ${modeName}｜${entryName}`);
  if (entry && entry.active === false) lines.push(labels.inactive);

  if (mode.key === 'story') {
    lines.push(...renderEffects(labels.effects, [entry?.buff], labels));
    lines.push(...renderEffects(labels.options, entry?.option, labels));
    lines.push(...renderEffects(labels.options, entry?.sub_option, labels));
  } else if (mode.key === 'boss') {
    lines.push(...renderEffects(labels.effects, [entry?.buff], labels));
    lines.push(...renderEffects(labels.effects, entry?.buff_list1, labels));
    lines.push(...renderEffects(labels.effects, entry?.buff_list2, labels));
    lines.push(...renderEffects(labels.effects, entry?.buff_list3, labels));
  } else if (mode.key === 'peak') {
    lines.push(...renderEffects(labels.effects, params.bossConfig?.buff_list, labels));
  }

  for (const level of levels) {
    lines.push('');
    lines.push(
      ...(await renderLevel({
        level,
        entryName,
        // 异相仲裁的每一关名字都一样（「骑士（一）」这类），靠前面的关卡名区分。
        titlePrefix: mode.key === 'peak' ? entryName : '',
        goalParams: params.goalParams,
        lang,
        labels,
        config,
        fetchMonster,
        traitLimit: params.traitLimit,
        isBoss: Boolean(isBossLevel && isBossLevel(level)),
      })),
    );
  }
  return lines.join('\n');
}

/**
 * 把用户给的玩法名归一成玩法 key。
 * @param {string} value 用户输入。
 * @returns {{mode: object, peakId: string|null}|null} 解析结果。
 */
export function resolveMode(value) {
  const query = normalizeName(value);
  if (query.length === 0) return null;
  for (const mode of STAGE_MODES) {
    const names = [mode.key, mode.zh, mode.en, ...mode.aliases];
    if (names.some((item) => normalizeName(item) === query)) return { mode, peakId: null };
  }
  // 「异相仲裁 3」「peak3」这类：只指第 3 关。
  for (const mode of STAGE_MODES) {
    if (mode.key !== 'peak') continue;
    const names = [mode.key, mode.zh, mode.en, ...mode.aliases].map((item) => normalizeName(item));
    for (const name of names) {
      if (query.startsWith(name)) {
        const digits = query.slice(name.length);
        if (/^\d{1,2}$/.test(digits)) return { mode, peakId: digits };
      }
    }
  }
  return null;
}

/**
 * 判断用户给的玩法名能不能认出来。
 * @param {string} value 用户输入。
 * @returns {boolean} 能认出来时为 true。
 */
export function isKnownStage(value) {
  return resolveMode(value) !== null;
}

/**
 * 生成深渊关卡正文。
 * @param {object} options 参数。
 * @param {string} options.version 数据版本。
 * @param {string} options.lang 语言。
 * @param {object} options.config 配置。
 * @param {string[]} [options.only] 只查这些玩法 key。
 * @param {string} [options.peakId] 只查异相仲裁的这一关。
 * @param {(index: string, version: string) => Promise<object>} options.loadIndex 读索引。
 * @param {(folder: string, version: string, lang: string, id: string) => Promise<object>} options.loadDetail 读关卡详情。
 * @param {(id: string) => Promise<object|null>} options.fetchMonster 查怪物详情。
 * @returns {Promise<string>} 正文。
 */
export async function renderStages(options) {
  const { version, lang, config, only, peakId, fetchMonster, testMode } = options;
  const labels = LABELS[lang] || LABELS.zh;
  const wanted = new Set(only && only.length > 0 ? only : STAGE_MODES.map((mode) => mode.key));
  const sections = [];

  for (const mode of STAGE_MODES) {
    if (!wanted.has(mode.key)) continue;
    const index = await options.loadIndex(mode.index, version);
    const entries = [];
    if (mode.key === 'peak') {
      // 异相仲裁没有开放期，当前关卡是 id 最大的那一关；
      // 测试模式下的数据总比稳定版多一条（更新的那期），所以要退一格。
      const all = [];
      for (const [id, entry] of Object.entries(index)) {
        if (!entry || typeof entry !== 'object') continue;
        if (peakId !== undefined && peakId !== null && String(id) !== String(peakId)) continue;
        all.push({ id, entry, active: true });
      }
      all.sort((a, b) => Number(a.id) - Number(b.id));
      if (peakId === undefined || peakId === null) {
        // 当前一期是 id 最大的那一关；测试模式的数据比正式版多一条最新的，退一格。
        const maxId = all.length > 0 ? Number(all[all.length - 1].id) : 0;
        const target = testMode ? maxId - 1 : maxId;
        const picked = all.filter((item) => Number(item.id) === target).pop();
        if (picked) entries.push(picked);
      } else {
        entries.push(...all);
      }
    } else {
      const picked = pickLiveEntry(index);
      if (!picked) continue;
      entries.push(picked);
    }

    for (const item of entries) {
      const detail = await options.loadDetail(mode.folder, version, lang, item.id);
      const levels = selectLevels(mode.key, detail);
      if (levels.length === 0) continue;
      const body = await renderMode({
        mode,
        entry: item.entry,
        entryId: item.id,
        levels,
        goalParams: collectGoalParams(detail),
        peakId,
        lang,
        labels,
        config,
        fetchMonster,
        bossConfig: detail?.boss_config,
        isBossLevel: (level) => detail?.boss_level === level,
      });
      sections.push(body);
    }
  }

  if (sections.length === 0) return `${labels.title}\n\n${labels.nothing}`;
  return [`# ${labels.title}`, '', sections.join('\n\n')].join('\n');
}
