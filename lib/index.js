/**
 * dsh-hsr —— 《崩坏：星穹铁道》资料查询插件。
 *
 * 对外提供五个工具，参数都是一行 flag 文本：
 * - `hsr-find`  查角色、光锥、遗器套装，或列清单；
 * - `hsr-help`  用法说明；
 * - `hsr-rule`  查询规则与游戏规则知识库；
 * - `hsr-exp`   查询经验与配队经验；
 * - `hsr-stage` 查当前深渊关卡与主怪特点。
 *
 * 取数、匹配、裁剪都在内部完成，对外不暴露任何地址、文件名或中间步骤。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearModelNotes, loadNotes, notePaths, readUserNotes, writeUserNotes } from './experience.js';
import { renderHelp } from './help.js';
import { readSection, renderIndex } from './knowledge.js';
import { findEntries, isNicknameQuery, normalizeName } from './match.js';
import { renderCharacter, renderLightcone, renderList, renderRelicSets } from './render.js';
import { renderStages, resolveMode } from './stage.js';
import { describeProxy, readSettings, settingsPath, writeSettings } from './settings.js';
import { plainText } from './text.js';
import {
  DataUnavailable,
  loadDetail,
  loadIndex,
  loadMonsterDetail,
  loadMonsterIndex,
  loadRelicSets,
  loadStageDetail,
  loadStageIndex,
  resolveVersion,
} from './source.js';
import { parseArgs, TOOL_NAMES, UsageError } from './tool.js';

export const name = 'dsh-hsr';
// webServer 必须是硬依赖：行是并发挂载的，等 apply 里再找服务可能还没起来，
// 那样路由会静默注册不上去，请求落到 SPA 兜底上，表现就是 404/405。
export const inject = ['tools', 'webServer'];

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONFIG_FILE = path.join(ROOT, 'config', 'config.json');
const MACRO_FILE = path.join(ROOT, 'config', 'safety.macro');
const RULES_FILE = path.join(ROOT, 'rules', 'rules.md');
const GAME_RULES_FILE = path.join(ROOT, 'rules', 'game.md');
const EXPERIENCE_FILE = path.join(ROOT, 'experience', 'base.md');
const TEAM_EXPERIENCE_FILE = path.join(ROOT, 'experience', 'team-base.md');

const API_SETTINGS = '/dsh-hsr/api/settings';
const API_CLEAR = '/dsh-hsr/api/clear-model-notes';

/** 输出结构：一段文本。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '给用户看的正文' },
  },
  required: ['text'],
  additionalProperties: false,
};

/** 各工具的参数说明。 */
const TOOL_PARAMETERS = {
  find: {
    type: 'object',
    properties: {
      args: {
        type: 'string',
        description:
          '一行参数，例如 "--role 三月七"、"--lightcone 银河铁道之夜"、"--relicset 云无留迹的过客"、"--role --list --baseType 记忆"。可用：--role、--lightcone、--relicset、--list、--baseType、--damageType、--star、--lang。',
      },
    },
    required: ['args'],
    additionalProperties: false,
  },
  help: {
    type: 'object',
    properties: {
      args: {
        type: 'string',
        description: '可留空。留空或给 "--lang 中" 都行，用来切换说明语言。',
      },
    },
    required: [],
    additionalProperties: false,
  },
  rule: {
    type: 'object',
    properties: {
      args: {
        type: 'string',
        description:
          '一行参数，例如 "--rule"、"--teamKnowledge"、"--teamKnowledge --section 3.6"。可用：--rule、--teamKnowledge、--section、--lang。',
      },
    },
    required: ['args'],
    additionalProperties: false,
  },
  exp: {
    type: 'object',
    properties: {
      args: {
        type: 'string',
        description: '一行参数，例如 "--exp"（查询经验）、"--exp --team"（配队经验）。可用：--exp、--team、--lang。',
      },
    },
    required: ['args'],
    additionalProperties: false,
  },
  stage: {
    type: 'object',
    properties: {
      args: {
        type: 'string',
        description:
          '一行参数，可留空（查全部深渊玩法）。例如 "--stage 忘却之庭"、"--stage 虚构叙事"、"--stage 末日幻影"、"--stage 异相仲裁 3"。可用：--stage、--lang。',
      },
    },
    required: [],
    additionalProperties: false,
  },
};

/** 各工具的说明。 */
const TOOL_DESCRIPTIONS = {
  find:
    '查询《崩坏：星穹铁道》的资料：角色（满级属性、行迹加成、技能、额外能力、星魂、忆灵、推荐光锥）、光锥（满级属性、叠影）、遗器套装（内外圈与套装效果），或用 --list 列清单。参数：--role 名字、--lightcone 名字、--relicset 名字、--list、--baseType 命途、--damageType 属性、--star 星级、--lang 中/英。',
  help:
    '《崩坏：星穹铁道》资料查询的使用说明：五个工具各管什么、每个参数怎么写、有哪些例子。参数可留空，或用 --lang 中/英 切语言。',
  rule:
    '读《崩坏：星穹铁道》的规则：--rule 返回查询规则与查询经验；--teamKnowledge 返回游戏规则目录与配队经验（规则较长，默认只给目录），再用 --teamKnowledge --section <编号或标题> 取需要的那一节。参数：--rule、--teamKnowledge、--section、--lang。',
  exp:
    '读《崩坏：星穹铁道》的经验：--exp 返回查询经验（查资料时怎么少出错）；--exp --team 返回配队经验（配队、排轴、估算进战面板时怎么算）。参数：--exp、--team、--lang。',
  stage:
    '查《崩坏：星穹铁道》当前的深渊关卡：忘却之庭、虚构叙事、末日幻影只给最后一关（星启模式）的主怪，异相仲裁给全部关卡。输出关卡名、目标、主怪弱点（可削韧属性）、抗性与技能特点（只留机制，不列技能名）。敌人技能仅供参考。参数：--stage 玩法名（可留空查全部）、--lang。',
};

/** --lang 的各种写法。 */
const LANG_ALIASES = { zh: 'zh', 中: 'zh', 中文: 'zh', chinese: 'zh', en: 'en', 英: 'en', 英文: 'en', english: 'en' };

function readConfig() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  return JSON.parse(raw);
}

/**
 * 数据模式判定。
 *
 * - `config/safety.macro` 存在 → 测试模式，用最新版本（内容更新，但可能有未验证的数据）；
 * - 不存在 → 安全模式，用稳定版本。
 *
 * 这个宏文件不进仓库（`.gitignore` 里有 `*.macro`），只有本地调试时才会出现。
 */
function isTestMode() {
  try {
    fs.accessSync(MACRO_FILE);
    // 有宏 = 测试模式 = 用最新版本。
    return true;
  } catch {
    return false;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

/** 把用户给的命途/属性/星级说法归一成索引里的键。 */
function resolveKey(config, table, value) {
  const query = normalizeName(value);
  if (query.length === 0) return null;
  for (const [key, row] of Object.entries(config[table] || {})) {
    const names = [key, row.zh, row.en, ...(Array.isArray(row.aliases) ? row.aliases : [])];
    if (names.some((item) => normalizeName(item) === query)) return key;
  }
  return null;
}

function labelOf(config, table, key, lang) {
  const row = config[table]?.[key];
  return row ? row[lang] || row.zh || key : key;
}

/**
 * 配队知识：游戏规则篇幅不固定，按知识库的方式给——默认只返回目录，
 * 模型看完目录再用 --section 取需要的那一节，避免每次塞几百行。
 */
function renderTeamKnowledge(game, notes, { lang, section }) {
  const en = lang === 'en';
  const hint = en
    ? 'The rules are long, so only the contents are listed. Read one section with `--teamKnowledge --section 3` (number or title both work; `--section all` returns everything).'
    : '规则较长，这里只给目录。要看某一节：`--teamKnowledge --section 3`（编号或标题都行，`--section all` 取全文）。';
  const emptyHint = en ? '(the rules file is empty)' : '（规则文件还是空的，可以自己往 rules/game.md 里写）';

  if (section !== null && section !== undefined) {
    const found = readSection(game, section);
    if (found !== null) {
      return [`## ${en ? 'Game Rules' : '游戏规则'}｜${found.title}`, '', found.text].join('\n');
    }
    return [
      en ? `No section matches "${section}".` : `没有找到「${section}」这一节。`,
      '',
      `## ${en ? 'Game Rules (contents)' : '游戏规则（目录）'}`,
      '',
      renderIndex(game, { hint, emptyHint }),
    ].join('\n');
  }

  return [
    `## ${en ? 'Game Rules (contents)' : '游戏规则（目录）'}`,
    '',
    renderIndex(game, { hint, emptyHint }),
    '',
    `## ${en ? 'Team Experience' : '配队经验'}`,
    '',
    notes,
  ].join('\n');
}

const INDEX_FILE = { role: 'character', lightcone: 'lightcone' };

/** 解析语言。 */
function resolveLang(config, parsed) {
  if (parsed.lang === null) return config.defaultLanguage || 'zh';
  const lang = LANG_ALIASES[parsed.lang.toLowerCase()];
  if (lang === undefined) {
    throw new UsageError('--lang 只支持 中 或 英（zh / en）。');
  }
  return lang;
}

/**
 * hsr-find：查角色、光锥、遗器套装，或列清单。
 * @param {string} input 参数行。
 * @returns {Promise<string>} 正文。
 */
async function runFind(input) {
  const config = readConfig();
  const testMode = isTestMode();
  const parsed = parseArgs(input, { scope: 'find' });
  const lang = resolveLang(config, parsed);
  const labels = config.stats?.[lang] || config.stats?.zh || {};

  const baseType = parsed.baseType === null ? null : resolveKey(config, 'baseTypes', parsed.baseType);
  if (parsed.baseType !== null && baseType === null) {
    throw new UsageError(`没有「${parsed.baseType}」这个命途。`);
  }
  const damageType = parsed.damageType === null ? null : resolveKey(config, 'damageTypes', parsed.damageType);
  if (parsed.damageType !== null && damageType === null) {
    throw new UsageError(`没有「${parsed.damageType}」这个属性。`);
  }

  if (parsed.kind === 'relicset') {
    const version = await resolveVersion(testMode);
    const sets = await loadRelicSets(version);
    if (parsed.list) {
      const rows = Object.entries(sets)
        .filter(([, entry]) => typeof entry === 'object' && entry !== null)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, entry]) => ({ id, entry }));
      if (rows.length === 0) return '没有遗器套装数据。';
      return renderList('relicset', rows, { lang, labels, config, total: rows.length, filters: '' });
    }
    const hits = findEntries(sets, parsed.name, () => true);
    if (hits.length === 0) return `没有找到叫「${parsed.name}」的遗器套装。`;
    const topScore = hits[0].score ?? 0;
    const top = hits.filter((hit) => (hit.score ?? 0) === topScore);
    return renderRelicSets(top, { lang, labels, config });
  }

  if (parsed.list) {
    const kind = parsed.kind ?? 'role';
    const version = await resolveVersion(testMode);
    const index = await loadIndex(INDEX_FILE[kind], version);
    const filters = [];
    if (baseType) filters.push(`${lang === 'en' ? 'Path' : '命途'}=${labelOf(config, 'baseTypes', baseType, lang)}`);
    if (damageType) filters.push(`${lang === 'en' ? 'Type' : '属性'}=${labelOf(config, 'damageTypes', damageType, lang)}`);
    if (parsed.star !== null) filters.push(`${lang === 'en' ? 'Rarity' : '星级'}=${parsed.star}★`);

    const rows = [];
    const dedupe = new Set();
    for (const [id, entry] of Object.entries(index)) {
      if (typeof entry !== 'object' || entry === null) continue;
      if (baseType && entry.baseType !== baseType) continue;
      if (damageType && entry.damageType !== damageType) continue;
      if (parsed.star !== null) {
        const matched = /(\d)\s*$/.exec(String(entry.rank || ''));
        if (!matched || Number(matched[1]) !== parsed.star) continue;
      }
      const key = `${entry.zh}|${entry.baseType}|${entry.damageType}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      rows.push({ id, entry });
    }
    rows.sort((a, b) => Number(a.id) - Number(b.id));
    if (rows.length === 0) return '没有符合条件的条目。';
    return renderList(kind, rows, {
      lang,
      labels,
      config,
      total: rows.length,
      filters: filters.join('，'),
    });
  }

  const version = await resolveVersion(testMode);
  const kind = parsed.kind;
  const index = await loadIndex(INDEX_FILE[kind], version);

  const accept = (entry) => {
    if (baseType && entry.baseType !== baseType) return false;
    if (damageType && entry.damageType !== damageType) return false;
    if (parsed.star !== null) {
      const matched = /(\d)\s*$/.exec(String(entry.rank || ''));
      if (!matched || Number(matched[1]) !== parsed.star) return false;
    }
    return true;
  };

  const query = normalizeName(parsed.name);
  let hits;
  if (kind === 'role' && isNicknameQuery(query)) {
    hits = Object.entries(index)
      .filter(([, entry]) => String(entry?.zh || '') === '{NICKNAME}' && accept(entry))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([id, entry]) => ({ id, entry, score: 1000 }));
  } else {
    hits = findEntries(index, parsed.name, accept);
  }

  if (hits.length === 0) {
    const suffix = baseType || damageType || parsed.star !== null ? '（当前筛选条件下）' : '';
    const kindLabel = kind === 'role' ? '角色' : '光锥';
    return `没有找到${suffix}叫「${parsed.name}」的${kindLabel}。`;
  }

  const topScore = hits[0].score ?? 0;
  const top = hits.filter((hit) => (hit.score ?? 0) === topScore);
  const multiple = top.length > 1;
  const chosen = top[0];

  const detail = await loadDetail(INDEX_FILE[kind], version, lang, chosen.id);
  // 推荐光锥在详情里只有 id，要再取一次光锥索引才能显示名字。
  const lightconeIndex =
    kind === 'role' && Array.isArray(detail?.lightcones) && detail.lightcones.length > 0
      ? await loadIndex('lightcone', version)
      : null;
  const text =
    kind === 'role'
      ? renderCharacter(detail, chosen.entry, { lang, labels, config, lightconeIndex })
      : renderLightcone(detail, chosen.entry, { lang, labels, config });

  if (!multiple) return text;

  const names = top
    .slice(0, 6)
    .map((hit) => {
      if (kind === 'role') {
        const path_ = labelOf(config, 'baseTypes', hit.entry.baseType, lang);
        const element = labelOf(config, 'damageTypes', hit.entry.damageType, lang);
        return `${hit.entry.zh}（${element} / ${path_}）`;
      }
      return `${hit.entry.zh}（${labelOf(config, 'baseTypes', hit.entry.baseType, lang)}）`;
    })
    .join('、');
  const hint =
    lang === 'en'
      ? `\n\n（There are ${top.length} matches: ${names}. Add --baseType or --damageType to pick one.）`
      : `\n\n（「${parsed.name}」有 ${top.length} 个条目：${names}。可加 --baseType 或 --damageType 指定。）`;
  return text + hint;
}

/**
 * hsr-stage：查当前深渊关卡（忘却之庭、虚构叙事、末日幻影、异相仲裁）。
 * @param {string} input 参数行。
 * @returns {Promise<string>} 正文。
 */
async function runStage(input) {
  const config = readConfig();
  const testMode = isTestMode();
  const parsed = parseArgs(input, { scope: 'stage' });
  const lang = resolveLang(config, parsed);

  let only = null;
  let peakId = null;
  if (parsed.stage !== null) {
    const resolved = resolveMode(parsed.stage);
    if (!resolved) {
      throw new UsageError(`没有「${parsed.stage}」这个深渊玩法。`);
    }
    only = [resolved.mode.key];
    peakId = resolved.peakId;
  }

  const version = await resolveVersion(testMode);

  // 怪物的 id 常常是「子体 id」，详情要按父体取，所以先建一张子→父的对照表。
  const monsterIndex = await loadMonsterIndex(version);
  const parentOf = new Map();
  for (const [id, entry] of Object.entries(monsterIndex)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const child of Array.isArray(entry.child) ? entry.child : []) {
      // child 可能是 id 本体，也可能是对象。
      const childId = String(typeof child === 'object' ? child?.id ?? '' : child ?? '');
      if (childId.length === 0) continue;
      if (!parentOf.has(childId)) parentOf.set(childId, id);
    }
  }

  const detailCache = new Map();
  const fetchMonster = async (rawId) => {
    const id = String(rawId);
    if (detailCache.has(id)) return detailCache.get(id);
    const parentId = parentOf.get(id) ?? id;
    let detail = null;
    try {
      detail = await loadMonsterDetail(version, lang, parentId);
    } catch {
      detail = null;
    }
    if (!detail) {
      detailCache.set(id, null);
      return null;
    }
    const children = Array.isArray(detail.child) ? detail.child : [];
    // 优先取与关卡里那个 id 完全一致的子体；找不到就用父体自身。
    const child =
      children.find((item) => String(item?.id ?? '') === id) ??
      children.find((item) => String(item?.id ?? '') === parentId) ??
      children[0] ??
      null;
    const nameEntry = monsterIndex[parentId];
    const name = plainMonsterName(nameEntry, detail, lang);
    const info = { id, parentId, name, child };
    detailCache.set(id, info);
    return info;
  };

  const text = await renderStages({
    version,
    lang,
    config,
    only,
    peakId,
    fetchMonster,
    loadIndex: (indexName, ver) => loadStageIndex(indexName, ver),
    loadDetail: (folder, ver, lang2, id) => loadStageDetail(folder, ver, lang2, id),
  });
  return text;
}

/** 怪物名：索引里的名字优先，其次详情里的。 */
function plainMonsterName(indexEntry, detail, lang) {
  const raw = indexEntry?.[lang] || indexEntry?.zh || indexEntry?.en || detail?.name || '';
  return plainText(String(raw), []);
}

/**
 * hsr-rule：查询规则、游戏规则知识库。
 * @param {string} input 参数行。
 * @returns {Promise<string>} 正文。
 */
async function runRule(input) {
  const config = readConfig();
  const parsed = parseArgs(input, { scope: 'rule' });
  const lang = resolveLang(config, parsed);

  if (parsed.teamKnowledge) {
    const game = readText(GAME_RULES_FILE);
    const notes = await loadNotes('team', TEAM_EXPERIENCE_FILE, { lang });
    return renderTeamKnowledge(game, notes, { lang, section: parsed.section });
  }

  const kind = parsed.team ? 'team' : 'query';
  const baseFile = kind === 'team' ? TEAM_EXPERIENCE_FILE : EXPERIENCE_FILE;
  const notes = await loadNotes(kind, baseFile, { lang });
  const rules = readText(RULES_FILE);
  return [rules, '', '## 经验', '', notes].join('\n');
}

/**
 * hsr-exp：查询经验与配队经验。
 * @param {string} input 参数行。
 * @returns {Promise<string>} 正文。
 */
async function runExp(input) {
  const config = readConfig();
  const parsed = parseArgs(input, { scope: 'exp' });
  const lang = resolveLang(config, parsed);

  const kind = parsed.team ? 'team' : 'query';
  const baseFile = kind === 'team' ? TEAM_EXPERIENCE_FILE : EXPERIENCE_FILE;
  const notes = await loadNotes(kind, baseFile, { lang });
  const title = kind === 'team' ? (lang === 'en' ? 'Team Experience' : '配队经验') : (lang === 'en' ? 'Experience' : '经验');
  return [`## ${title}`, '', notes].join('\n');
}

/**
 * hsr-help：用法说明。
 * @param {string} input 参数行。
 * @returns {Promise<string>} 正文。
 */
async function runHelp(input) {
  const config = readConfig();
  const parsed = parseArgs(input, { scope: 'help' });
  const lang = resolveLang(config, parsed);
  return renderHelp(lang);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 256 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

async function snapshot() {
  const counts = await Promise.all([readUserNotes('query'), readUserNotes('team')]);
  const stored = readSettings();
  return {
    proxy: stored.proxy,
    resolved: describeProxy(),
    query: counts[0],
    team: counts[1],
    paths: {
      settings: settingsPath(),
      query: notePaths('query').user,
      team: notePaths('team').user,
      model: notePaths('query').model,
      modelTeam: notePaths('team').model,
    },
  };
}

/** 只接受同源请求：跨站页面不该能改这里的设置。 */
function sameOrigin(request) {
  const site = request.headers?.['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers?.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers?.host;
  } catch {
    return false;
  }
}

function registerRoutes(server) {
  const disposers = [];
  disposers.push(
    server.register({
      kind: 'exact',
      path: API_SETTINGS,
      handler: async (request, response) => {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'forbidden' });
          return;
        }
        if (request.method === 'GET') {
          sendJson(response, 200, await snapshot());
          return;
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'GET, POST' });
          response.end();
          return;
        }
        try {
          const body = await readBody(request);
          if (typeof body.proxy === 'string') writeSettings({ proxy: body.proxy });
          if (typeof body.query === 'string') await writeUserNotes('query', body.query);
          if (typeof body.team === 'string') await writeUserNotes('team', body.team);
          sendJson(response, 200, await snapshot());
        } catch (error) {
          sendJson(response, 500, { error: String(error?.message || error) });
        }
      },
    }),
  );
  disposers.push(
    server.register({
      kind: 'exact',
      path: API_CLEAR,
      handler: async (request, response) => {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'forbidden' });
          return;
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' });
          response.end();
          return;
        }
        try {
          const cleared = await clearModelNotes();
          sendJson(response, 200, { cleared, ...(await snapshot()) });
        } catch (error) {
          sendJson(response, 500, { error: String(error?.message || error) });
        }
      },
    }),
  );
  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose();
    }
  };
}

/** 每个工具的处理器。 */
const RUNNERS = {
  find: runFind,
  help: runHelp,
  rule: runRule,
  exp: runExp,
  stage: runStage,
};

export function apply(ctx, _config) {
  const disposers = [];

  for (const [scope, runner] of Object.entries(RUNNERS)) {
    const definition = {
      name: TOOL_NAMES[scope],
      description: TOOL_DESCRIPTIONS[scope],
      parameters: TOOL_PARAMETERS[scope],
      isConcurrencySafe: () => true,
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      execute: async (args, exec) => {
        exec?.signal?.throwIfAborted?.();
        const input = typeof args?.args === 'string' ? args.args : '';
        try {
          const text = await runner(input);
          return { text };
        } catch (error) {
          if (error instanceof DataUnavailable && error.plain) return { text: error.message };
          if (error instanceof UsageError || error instanceof DataUnavailable) {
            return { text: `查询未完成：${error.message}` };
          }
          return { text: `查询未完成：插件内部出错（${error?.message || error}）。` };
        }
      },
    };
    const disposeTool = ctx.tools.register(definition);
    // 注意：ctx.effect(cb) 会立刻执行 cb，并把 cb 的返回值当销毁函数。
    disposers.push(disposeTool);
  }
  ctx.effect?.(() => () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose();
    }
  }, 'dsh-hsr: tools');

  const server = ctx.webServer ?? ctx.get?.('webServer');
  let routeCount = 0;
  if (server && typeof server.register === 'function') {
    const disposeRoutes = registerRoutes(server);
    // 注意：ctx.effect(cb) 会立刻执行 cb，并把 cb 的返回值当销毁函数。
    // 写成 () => disposeRoutes() 就变成「挂载即注销」，路由一条不留，
    // 请求全被前端静态兜底接走（GET 404 / POST 405）。
    ctx.effect?.(() => disposeRoutes, 'dsh-hsr: settings routes');
    routeCount = 2;
  }
  markBoot(routeCount, Boolean(server));
}

/**
 * 启动标记：`~/.dsh/dsh-hsr/boot.json`。
 *
 * 只用来判断「插件本体有没有挂上、路由有没有注册」，出问题时看一眼就知道卡在哪一步；
 * 不影响查询，写不进去也不算错误。
 */
function markBoot(routes, server) {
  try {
    const file = path.join(path.dirname(settingsPath()), 'boot.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ at: new Date().toISOString(), routes, webServer: server }, null, 2)}\n`,
    );
  } catch {
    // 只读环境或无主目录权限时跳过。
  }
}

export default { name, inject, apply };
