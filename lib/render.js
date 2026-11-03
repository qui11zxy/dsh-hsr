/**
 * 渲染层：把详情 JSON 裁成一段可读文本。
 *
 * 只保留"这个人/这把武器有什么用"的信息——简介、满级基础属性、行迹加成、
 * 技能、额外能力、星魂（光锥是叠影）。图片索引、语音、故事、推荐装备、
 * 成长曲线、升级材料一律丢掉。
 */

import { plainText, ratioOrFlat, resolveParamRef } from './text.js';

const ROLES_WITH_IMAGES = new Set(['icon', 'bg_image_path', 'figure']);

/** 从 `CombatPowerAvatarRarityType5` 这类字符串里取星级。 */
function starOf(rank, fallback) {
  if (typeof rank === 'string') {
    const matched = /(\d)\s*$/.exec(rank);
    if (matched) return Number(matched[1]);
  }
  return fallback;
}

/** 光锥星级兜底：id 第二位 0→3★，1~2→4★，3~4→5★。 */
function lightconeStarFromId(id) {
  const digit = Number(String(id)[1]);
  if (digit === 0) return 3;
  if (digit === 1 || digit === 2) return 4;
  return 5;
}

function trimFixed(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  const fixed = value.toFixed(digits);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/** 百分比展示：0.192 → 19.2%。 */
function asPercent(value, digits = 2) {
  return `${trimFixed(value * 100, digits)}%`;
}

/** 取本地化名称（config 里的三元组）。 */
const SERIES_REF_RE = /#\{series_ref_skill_desc:[^,]*,\s*(\d+)\s*,\s*(\d+)\s*\}/g;

/**
 * 展开数据源里的内嵌技能引用（形如 #{series_ref_skill_desc:UIText_SeriesSkillDescFormat,151129,2}），
 * 替换成被引用技能在该等级的说明正文。
 * @param {string} text 已渲染的文本。
 * @param {object} detail 角色详情。
 * @param {object} ctx 渲染上下文。
 * @returns {string} 文本。
 */
function withSeriesRefs(text, detail, ctx) {
  if (typeof text !== 'string' || !text.includes('#{series_ref_skill_desc')) return text;
  const skills = detail?.skills && typeof detail.skills === 'object' ? detail.skills : {};
  return text.replace(SERIES_REF_RE, (_match, skillId, level) => {
    const skill = skills[String(skillId)];
    const lv = Number(level);
    // 详情里说明正文挂在技能顶层，每个等级只给 param_list。
    const body = skill ? skill.desc : null;
    if (!body) return '';
    const lvEntry = skill.level && skill.level[lv] ? skill.level[lv] : null;
    const params = lvEntry && Array.isArray(lvEntry.param_list) ? lvEntry.param_list : [];
    return plainText(body, params, ctx);
  });
}

const FULL_WIDTH_TO_HALF = [
  ['（', ' ('],
  ['）', ')'],
  ['｜', ' | '],
  ['：', ': '],
];

/**
 * 英文输出里把中文标点换成半角，免得中英混排。
 * @param {string} text 文本。
 * @param {string} lang 语言。
 * @returns {string} 文本。
 */
function localizePunctuation(text, lang) {
  if (lang !== 'en') return text;
  let out = text;
  for (const [from, to] of FULL_WIDTH_TO_HALF) out = out.split(from).join(to);
  return out.replace(/ +/g, ' ');
}

function localized(table, key, lang) {
  const row = table && key ? table[key] : null;
  if (!row) return typeof key === 'string' ? key : '';
  return row[lang] || row.zh || key;
}

/** 命途/属性/标签的展示名。 */
function displayName(config, table, key, lang) {
  return localized(config[table], key, lang);
}

/**
 * 依 m00441 的口径挑技能显示等级。
 * 技能被行迹点引用时用行迹点的 `max_level`（这就是实战满级），
 * 否则退回技能自身等级表的长度。
 */
function pickLevels(skill, treeMax) {
  const table = skill && typeof skill.level === 'object' && skill.level !== null ? skill.level : {};
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const theory = keys.length > 0 ? keys[keys.length - 1] : 0;
  if (theory === 0) return [];
  // 行迹点上的 max_level 就是实战满级；没有时按"理论满级"折算。
  const actual =
    Number.isInteger(treeMax) && treeMax > 0 && treeMax <= theory
      ? treeMax
      : theory >= 15
        ? 10
        : theory >= 7
          ? 6
          : theory;
  // 级数够多的只给满级那一档，短表（秘技、固有行迹）才逐级列。
  return theory >= 7 ? [actual] : keys;
}

/** 取某一级的 param_list。 */
function paramsOf(skill, level) {
  const entry = skill?.level?.[String(level)];
  return Array.isArray(entry?.param_list) ? entry.param_list : [];
}

/**
 * 削韧值。数据源 show_stance_list 的三个位置依次是
 * [单体/主目标, 全体, 相邻目标]，没命中该目标时是 0。
 * 单攻 [30,0,0] / 群攻 [0,60,0] / 扩散 [60,0,30] / 弹射 [30,0,0]（每段）。
 */
function stanceOf(skill, labels) {
  const list = Array.isArray(skill?.show_stance_list) ? skill.show_stance_list : [];
  const [main = 0, all = 0, adjacent = 0] = list.map((n) => (Number.isFinite(n) ? n : 0));
  const parts = [];
  if (main > 0) parts.push(adjacent > 0 || all > 0 ? `${main}（${labels.mainTarget}）` : String(main));
  if (all > 0) parts.push(`${all}（${labels.allTargets}）`);
  if (adjacent > 0) parts.push(`${adjacent}（${labels.adjacent}）`);
  if (parts.length === 0) return '';
  const perHit = skill?.tag === 'Bounce' ? `（${labels.perHit}）` : '';
  return `｜${labels.break} ${parts.join(' / ')}${perHit}`;
}

/** 收集术语解释表。 */function collectExtras(buckets) {
  const seen = new Map();
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [key, value] of Object.entries(bucket)) {
      if (!value || typeof value !== 'object') continue;
      if (!seen.has(key)) seen.set(key, value);
    }
  }
  return [...seen.values()];
}

/**
 * 渲染一个角色。
 * @param {object} detail 角色详情。
 * @param {object} entry 索引条目（含 zh/en/baseType/damageType/rank）。
 * @param {{lang: string, labels: object, config: object}} ctx 渲染上下文。
 * @returns {string} 文本。
 */
export function renderCharacter(detail, entry, ctx) {
  const { lang, labels, config } = ctx;
  const rawName = detail?.name || entry?.zh || entry?.en || '未知角色';
  // 开拓者的名字在数据源里是占位符，显示成配置里的第一个称呼。
  const name = rawName.includes('{NICKNAME}')
    ? String(config.nickname?.[lang] || rawName).split('&')[0]
    : plainText(rawName, [], { nickname: config.nickname?.[lang] });
  const star = starOf(detail?.rarity || entry?.rank, 4);
  const damageType = displayName(config, 'damageTypes', detail?.damage_type || entry?.damageType, lang);
  const baseType = displayName(config, 'baseTypes', detail?.base_type || entry?.baseType, lang);
  const lines = [`# ${name}（${star}★ / ${damageType} / ${baseType}）`];
  // sp_need 是能量上限；黄泉(9 层残梦)、星神★阿哈(8 个笑点) 这类角色走自己的机制
  // 而不是能量条，数值远低于正常水平，这时能量上限与回能都不显示。
  const hasEnergy = Number.isFinite(detail?.sp_need) && detail.sp_need >= 50;

  const intro = plainText(detail?.desc, [], { nickname: config.nickname?.[lang] });
  if (intro) lines.push(`${labels.intro}：${intro}`);

  const stats = detail?.stats?.['6'] || detail?.stats?.[6];
  if (stats) {
    lines.push('', `## ${labels.title}`);
    const parts = [
      `${labels.hp} ${trimFixed(stats.hp_base, 3)}`,
      `${labels.attack} ${trimFixed(stats.attack_base, 3)}`,
      `${labels.defence} ${trimFixed(stats.defence_base, 3)}`,
      `${labels.speed} ${trimFixed(stats.speed_base, 3)}`,
      `${labels.criticalChance} ${asPercent(stats.critical_chance ?? 0, 1)}`,
      `${labels.criticalDamage} ${asPercent(stats.critical_damage ?? 0, 1)}`,
      `${labels.aggro} ${trimFixed(stats.base_aggro ?? 0, 3)}`,
    ];
    if (hasEnergy) parts.push(`${labels.energy} ${detail.sp_need}`);
    lines.push(parts.join('｜'));
  }

  const treeNodes = [];
  const seenPoints = new Set();
  for (const group of Object.values(detail?.skill_trees || {})) {
    for (const node of Object.values(group || {})) {
      const key = node?.point_id ?? `${node?.point_name}|${node?.point_trigger_key}`;
      if (seenPoints.has(key)) continue;
      seenPoints.add(key);
      treeNodes.push(node);
    }
  }

  // 行迹属性加成：把 point_type=1 的节点按 property_type 求和
  const bonuses = new Map();
  for (const node of treeNodes) {
    if (node?.point_type !== 1 || !Array.isArray(node.status_add_list)) continue;
    for (const add of node.status_add_list) {
      if (!add || typeof add.value !== 'number') continue;
      const key = add.property_type || add.name;
      const current = bonuses.get(key);
      if (current) current.value += add.value;
      else bonuses.set(key, { name: add.name || add.property_type || '', value: add.value });
    }
  }
  if (bonuses.size > 0) {
    lines.push('', `## ${labels.traces}`);
    const parts = [...bonuses.values()].map((item) => {
      const flat = /Delta$/.test(String(item.name)) || Math.abs(item.value) >= 1;
      return flat ? `${item.name} +${trimFixed(item.value, 3)}` : `${item.name} +${asPercent(item.value, 1)}`;
    });
    lines.push(parts.join('｜'));
  }

  // 技能：先按行迹点的顺序展开，再补上没被引用的
  const skills = detail?.skills && typeof detail.skills === 'object' ? detail.skills : {};
  const ordered = [];
  const used = new Set();
  const pushSkill = (id, treeMax) => {
    const skill = skills[String(id)];
    if (!skill || used.has(String(id))) return;
    used.add(String(id));
    ordered.push({ skill, treeMax });
  };
  const treeOrder = [...treeNodes]
    .filter((node) => node && (node.point_type === 2 || node.point_type === 4 || node.point_type === 6))
    .sort((a, b) => Number(a.point_trigger_key ?? 0) - Number(b.point_trigger_key ?? 0));
  for (const node of treeOrder) {
    const ids = Array.isArray(node.level_up_skill_id) ? node.level_up_skill_id : [];
    if (ids.length === 0) continue;
    // 一个节点挂多个技能时，后面的是同一技能的分支形态，正文里已经写过，不重复成段。
    for (const id of ids.slice(1)) used.add(String(id));
    pushSkill(ids[0], node.max_level);
  }
  const skipNames = new Set(['攻击', '结束', '取消', 'Attack', 'End', 'Cancel']);
  for (const [id, skill] of Object.entries(skills)) {
    if (used.has(id)) continue;
    if (!skill || skill.type === 'MazeNormal') continue;
    if (skipNames.has(skill.name)) continue;
    if (!skill.type_name) continue;
    pushSkill(id, undefined);
  }

  if (ordered.length > 0) {
    lines.push('', `## ${labels.skills}`);
    const extras = [];
    for (const { skill, treeMax } of ordered) {
      const typeName = skill.type_name || '';
      const tagName = skill.tag ? displayName(config, 'tags', skill.tag, lang) : '';
      const title = [typeName, skill.name].filter(Boolean).join('｜');
      const regen = hasEnergy ? `｜${labels.energyRegen} ${Number.isFinite(skill.sp_base) ? skill.sp_base : 0}` : '';
      lines.push('', `### ${title}${tagName ? `（${tagName}）` : ''}${regen}${stanceOf(skill, labels)}`);
      const levels = pickLevels(skill, treeMax);
      for (const level of levels) {
        const text = plainText(skill.desc, paramsOf(skill, level), { nickname: config.nickname?.[lang] });
        if (!text) continue;
        lines.push(levels.length > 1 ? `Lv.${level}：${text}` : text);
      }
      extras.push(skill.extra);
    }

    const abilities = treeNodes
      .filter((node) => node?.point_type === 3 && node.point_name)
      .sort((a, b) => Number(a.point_trigger_key ?? 0) - Number(b.point_trigger_key ?? 0));
    if (abilities.length > 0) {
      lines.push('', `## ${labels.abilities}`);
      for (const node of abilities) {
        const text = plainText(node.point_desc, Array.isArray(node.param_list) ? node.param_list : [], {
          nickname: config.nickname?.[lang],
        });
        lines.push(`- ${node.point_name}${text ? `：${text}` : ''}`);
        extras.push(node.extra);
      }
    }
  }

  const ranks = detail?.ranks && typeof detail.ranks === 'object' ? detail.ranks : {};
  const rankKeys = Object.keys(ranks).sort((a, b) => Number(a) - Number(b));
  if (rankKeys.length > 0) {
    lines.push('', `## ${labels.ranks}`);
    for (const key of rankKeys) {
      const rank = ranks[key];
      if (!rank) continue;
      const text = plainText(rank.desc, Array.isArray(rank.param_list) ? rank.param_list : [], {
        nickname: config.nickname?.[lang],
      });
      lines.push(`${key}. ${rank.name}${text ? `：${text}` : ''}`);
    }
  }

  const exRanks = detail?.ex_ranks && typeof detail.ex_ranks === 'object' ? detail.ex_ranks : {};
  const exKeys = Object.keys(exRanks);
  if (exKeys.length > 0) {
    lines.push('', `## ${labels.exRanks}`);
    for (const key of exKeys) {
      const rank = exRanks[key];
      if (!rank) continue;
      const text = plainText(rank.desc, Array.isArray(rank.param_list) ? rank.param_list : [], {
        nickname: config.nickname?.[lang],
      });
      const tag = rank.tag ? `（${rank.tag}）` : '';
      lines.push(`- ${rank.name}${tag}${text ? `：${text}` : ''}`);
    }
  }

  const memo = detail?.memosprite;
  if (memo && typeof memo === 'object' && memo.name) {
    lines.push('', `## ${labels.memosprite}`);
    const ownerHp = Number(stats?.hp_base);
    const ownerSpeed = Number(stats?.speed_base);
    const hpParams = skills[String(memo.hp_skill)] ? paramsOf(skills[String(memo.hp_skill)], pickLevels(skills[String(memo.hp_skill)], undefined).at(-1)) : [];
    const hpBase = resolveParamRef(memo.hp_base, hpParams);
    const hpInherit = resolveParamRef(memo.hp_inherit, hpParams);
    const speedBase = resolveParamRef(memo.speed_base, hpParams);
    const speedInherit = resolveParamRef(memo.speed_inherit, hpParams);
    lines.push(`### ${memo.name}${Number.isFinite(memo.aggro) ? `（${labels.aggro} ${memo.aggro}）` : ''}`);
    const hpParts = [];
    if (Number.isFinite(ownerHp) && Number.isFinite(hpInherit) && hpInherit > 0) {
      hpParts.push(`${trimFixed(ownerHp * hpInherit, 1)}（${name}${labels.hp}的 ${asPercent(hpInherit, 1)}）`);
    }
    if (Number.isFinite(hpBase) && hpBase > 0) hpParts.push(trimFixed(hpBase, 1));
    if (hpParts.length > 0) lines.push(`${labels.hp}：${hpParts.join(' + ')}`);

    const speedParts = [];
    if (Number.isFinite(ownerSpeed) && Number.isFinite(speedInherit) && speedInherit > 0) {
      speedParts.push(`${trimFixed(ownerSpeed * speedInherit, 1)}（${name}${labels.speed}的 ${asPercent(speedInherit, 1)}）`);
    }
    if (Number.isFinite(speedBase) && speedBase > 0) speedParts.push(trimFixed(speedBase, 1));
    if (speedParts.length > 0) lines.push(`${labels.speed}：${speedParts.join(' + ')}`);

    for (const skill of Object.values(memo.skills || {})) {
      if (!skill || !skill.name) continue;
      const typeName = skill.type_name || '';
      const tagName = skill.tag ? displayName(config, 'tags', skill.tag, lang) : '';
      lines.push('', `#### ${[typeName, skill.name].filter(Boolean).join('｜')}${tagName ? `（${tagName}）` : ''}${stanceOf(skill, labels)}`);
      const levels = pickLevels(skill, undefined);
      for (const level of levels) {
        const text = plainText(skill.desc, paramsOf(skill, level), { nickname: config.nickname?.[lang] });
        if (text) lines.push(levels.length > 1 ? `Lv.${level}：${text}` : text);
      }
    }
  }

  const unique = detail?.unique && typeof detail.unique === 'object' ? detail.unique : {};
  const uniqueKeys = Object.keys(unique);
  if (uniqueKeys.length > 0) {
    lines.push('', `## ${labels.unique}`);
    for (const key of uniqueKeys) {
      const item = unique[key];
      if (!item) continue;
      const params = Array.isArray(item.param) ? item.param : [];
      const text = plainText(item.desc, params, { nickname: config.nickname?.[lang] });
      lines.push(`- ${item.name || key}${text ? `：${text}` : ''}`);
    }
  }

  const extras = collectExtras([detail?.skills, detail?.ranks, detail?.ex_ranks, detail?.unique]);
  if (extras.length > 0 && extras.length <= 8) {
    lines.push('', `## ${labels.glossary}`);
    for (const item of extras) {
      const text = plainText(item.desc, Array.isArray(item.param) ? item.param : [], { nickname: config.nickname?.[lang] });
      const summary = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      lines.push(`- ${item.name}：${summary}`);
    }
  }

  const text = lines
    .map((line) => withSeriesRefs(line, detail, { nickname: config.nickname?.[lang] }))
    .join('\n');
  return localizePunctuation(text, lang);
}

/**
 * 渲染一把光锥。
 * @param {object} detail 光锥详情。
 * @param {object} entry 索引条目。
 * @param {{lang: string, labels: object, config: object}} ctx 渲染上下文。
 * @returns {string} 文本。
 */
export function renderLightcone(detail, entry, ctx) {
  const { lang, labels, config } = ctx;
  const name = plainText(detail?.name || entry?.zh || entry?.en || '未知光锥', [], {
    nickname: config.nickname?.[lang],
  });
  const star = starOf(detail?.rarity || entry?.rank, lightconeStarFromId(entry?.id ?? ''));
  const baseType = displayName(config, 'baseTypes', detail?.base_type || entry?.baseType, lang);
  const lines = [`# ${name}（${star}★ / ${baseType}）`];

  const stats = Array.isArray(detail?.stats) ? detail.stats : [];
  const last = stats[stats.length - 1];
  if (last && Number.isFinite(last.max_level)) {
    const at = (base, add) => (Number.isFinite(base) ? base : 0) + (Number.isFinite(add) ? add : 0) * (last.max_level - 1);
    lines.push('', `## ${labels.title}`);
    lines.push(
      [
        `${labels.hp} ${trimFixed(at(last.base_hp, last.base_hp_add), 2)}`,
        `${labels.attack} ${trimFixed(at(last.base_attack, last.base_attack_add), 2)}`,
        `${labels.defence} ${trimFixed(at(last.base_defence, last.base_defence_add), 2)}`,
      ].join('｜'),
    );
  }

  const refinement = detail?.refinements;
  if (refinement && typeof refinement === 'object') {
    const levels = refinement.level && typeof refinement.level === 'object' ? refinement.level : {};
    const keys = Object.keys(levels).sort((a, b) => Number(a) - Number(b));
    lines.push('', `## ${labels.skills}｜${refinement.name || ''}`);
    const first = keys[0] ? levels[keys[0]] : null;
    const firstParams = Array.isArray(first?.param_list) ? first.param_list : [];
    const body = plainText(refinement.desc, firstParams, { nickname: config.nickname?.[lang] });
    if (body) lines.push(body);
    if (keys.length > 1) {
      const rows = keys.map((key) => {
        const params = Array.isArray(levels[key]?.param_list) ? levels[key].param_list : [];
        const rankLabel = labels.refinement === 'Superimposition' ? `S${key}` : `${key} 阶`;
        return `${rankLabel} ${params.map((value) => ratioOrFlat(value)).join(' / ')}`;
      });
      lines.push('', rows.join('｜'));
    }
  }

  const flavor = plainText(detail?.desc, [], { nickname: config.nickname?.[lang] });
  if (flavor) lines.push('', flavor);
  return localizePunctuation(lines.join('\n'), lang);
}

/**
 * 渲染列表。
 * @param {'role'|'lightcone'} kind 列表类型。
 * @param {{id: string, entry: object}[]} rows 条目。
 * @param {{lang: string, labels: object, config: object, total: number, filters: string}} ctx 上下文。
 * @returns {string} 文本。
 */
export function renderList(kind, rows, ctx) {
  const { lang, labels, config, total, filters } = ctx;
  const relic = relicLabels(config, lang);
  const title =
    kind === 'role'
      ? (lang === 'en' ? 'Characters' : '角色列表')
      : kind === 'lightcone'
        ? (lang === 'en' ? 'Light Cones' : '光锥列表')
        : relic.list;
  const lines = [`# ${title}`];
  for (const { id, entry } of rows) {
    if (kind === 'role') {
      const nickname = String(entry.zh || '') === '{NICKNAME}';
      const name = nickname
        ? config.nickname?.[lang] || '开拓者'
        : plainText(entry.zh || entry.en, [], { nickname: config.nickname?.[lang] });
      const star = starOf(entry.rank, 4);
      const damageType = displayName(config, 'damageTypes', entry.damageType, lang);
      const baseType = displayName(config, 'baseTypes', entry.baseType, lang);
      lines.push(`${name}（${star}★ ${damageType} ${baseType}）`);
    } else if (kind === 'lightcone') {
      const name = plainText(entry.zh || entry.en, [], { nickname: config.nickname?.[lang] });
      const star = starOf(entry.rank, lightconeStarFromId(id));
      const baseType = displayName(config, 'baseTypes', entry.baseType, lang);
      lines.push(`${name}（${star}★ ${baseType}）`);
    } else {
      const name = plainText(entry.zh || entry.en, [], { nickname: config.nickname?.[lang] });
      const slot = relicSlot(entry) === 'outer' ? relic.outer : relic.inner;
      lines.push(`${name}（${slot}）`);
    }
  }
  const countText = String(labels.count).replace('{n}', String(total));
  const filterText = filters ? String(labels.filtered).replace('{f}', filters) : '';
  lines.push('', `${countText}${filterText}`);
  return localizePunctuation(lines.join('\n'), lang);
}

/** 遗器套装的圈位：有二件与四件效果的是外圈，只有二件的是内圈。 */
export function relicSlot(entry) {
  const set = entry && typeof entry === 'object' ? entry.set : null;
  return set && typeof set === 'object' && set['4'] ? 'outer' : 'inner';
}

function relicLabels(config, lang) {
  return config?.relics?.[lang] ?? config?.relics?.zh ?? {};
}

/**
 * 渲染一个（或多个）遗器套装：名称 + 圈位 + 套装效果。
 * @param {{id: string, entry: object}[]} rows 命中的套装。
 * @param {{lang: string, labels: object, config: object}} ctx 上下文。
 * @returns {string} 文本。
 */
export function renderRelicSets(rows, ctx) {
  const { lang, config } = ctx;
  const labels = relicLabels(config, lang);
  const nickname = config?.nickname?.[lang];
  const lines = [];
  for (const { entry } of rows) {
    const name = plainText(entry.zh || entry.en, [], { nickname });
    const slot = relicSlot(entry) === 'outer' ? labels.outer : labels.inner;
    lines.push(`## ${name}（${slot}）`);
    const set = entry.set && typeof entry.set === 'object' ? entry.set : {};
    for (const tier of ['2', '4']) {
      const block = set[tier];
      if (!block) continue;
      const heading = tier === '2' ? labels.twoPiece : labels.fourPiece;
      const body = plainText(block[lang] ?? block.zh ?? block.en, block.ParamList ?? [], { nickname });
      lines.push(`${heading}｜${body}`);
    }
    lines.push('');
  }
  return localizePunctuation(lines.join('\n').trimEnd(), lang);
}

/** 是否有图片字段需要剥掉（保留导出，供自检用）。 */
export function isImageField(key) {
  return ROLES_WITH_IMAGES.has(key) || /icon|image|figure/i.test(key);
}
