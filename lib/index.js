/**
 * dsh-hsr —— 《崩坏：星穹铁道》资料查询插件。
 *
 * 只对外提供一个工具 `hsr`，参数是一行 flag 文本。取数、匹配、裁剪都在内部完成，
 * 对外不暴露任何地址、文件名或中间步骤。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearModelNotes, loadNotes, notePaths, readUserNotes, writeUserNotes } from './experience.js';
import { readSection, renderIndex } from './knowledge.js';
import { findEntries, isNicknameQuery, normalizeName } from './match.js';
import { renderCharacter, renderLightcone, renderList, renderRelicSets } from './render.js';
import { describeProxy, readSettings, settingsPath, writeSettings } from './settings.js';
import { DataUnavailable, loadDetail, loadIndex, loadRelicSets, resolveVersion } from './source.js';
import { parseArgs, UsageError } from './tool.js';

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

const PARAMETERS = {
  type: 'object',
  properties: {
    args: {
      type: 'string',
      description:
        '一行参数，例如 "--role --三月七"、"--lightcone --银河铁道之夜"、"--relicset --云无留迹的过客"、"--role --list"、"--rule"、"--teamKnowledge"、"--teamKnowledge --section 3.6"。可用：--role、--lightcone、--relicset、--list、--baseType、--damageType、--star、--lang、--exp、--team、--rule、--teamKnowledge、--section。',
    },
  },
  required: ['args'],
  additionalProperties: false,
};

/** --lang 的各种写法。 */
const LANG_ALIASES = { zh: 'zh', 中: 'zh', 中文: 'zh', chinese: 'zh', en: 'en', 英: 'en', 英文: 'en', english: 'en' };

function readConfig() {
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  return JSON.parse(raw);
}

/** 安全宏：文件存在即安全模式（用稳定版本），否则测试模式（用最新版本）。 */
function isSafeMode() {
  try {
    fs.accessSync(MACRO_FILE);
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

/**
 * 处理一次查询。
 * @param {string} input 参数行。
 * @returns {Promise<string>} 正文。
 */
async function run(input) {
  const config = readConfig();
  const safeMode = isSafeMode();
  const parsed = parseArgs(input);
  const lang = parsed.lang === null ? config.defaultLanguage || 'zh' : LANG_ALIASES[parsed.lang.toLowerCase()];
  if (lang === undefined) {
    throw new UsageError('--lang 只支持 中 或 英（zh / en）。');
  }
  const labels = config.stats?.[lang] || config.stats?.zh || {};

  if (parsed.teamKnowledge) {
    const game = readText(GAME_RULES_FILE);
    const notes = await loadNotes('team', TEAM_EXPERIENCE_FILE, { lang });
    return renderTeamKnowledge(game, notes, { lang, section: parsed.section });
  }

  if (parsed.rule || parsed.exp) {
    const kind = parsed.team ? 'team' : 'query';
    const baseFile = kind === 'team' ? TEAM_EXPERIENCE_FILE : EXPERIENCE_FILE;
    const notes = await loadNotes(kind, baseFile, { lang });
    if (parsed.exp) {
      const title = kind === 'team' ? (lang === 'en' ? 'Team Experience' : '配队经验') : (lang === 'en' ? 'Experience' : '经验');
      return [`## ${title}`, '', notes].join('\n');
    }
    const rules = readText(RULES_FILE);
    return [rules, '', '## 经验', '', notes].join('\n');
  }

  const baseType = parsed.baseType === null ? null : resolveKey(config, 'baseTypes', parsed.baseType);
  if (parsed.baseType !== null && baseType === null) {
    throw new UsageError(`没有「${parsed.baseType}」这个命途。`);
  }
  const damageType = parsed.damageType === null ? null : resolveKey(config, 'damageTypes', parsed.damageType);
  if (parsed.damageType !== null && damageType === null) {
    throw new UsageError(`没有「${parsed.damageType}」这个属性。`);
  }

  if (parsed.kind === 'relicset') {
    const version = await resolveVersion(safeMode);
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
    const version = await resolveVersion(safeMode);
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

  const version = await resolveVersion(safeMode);
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

export function apply(ctx, _config) {
  const definition = {
    name: 'hsr',
    description:
      '查询《崩坏：星穹铁道》的资料：角色（满级属性、行迹加成、技能、额外能力、星魂）、光锥（满级属性、叠影）、遗器套装（内外圈与套装效果）。用 --role 查角色、--lightcone 查光锥、--relicset 查遗器、--list 列清单、--rule 看规则与经验、--teamKnowledge 取配队规则目录与配队经验（配规则 --section 3 取某一节）。',
    parameters: PARAMETERS,
    isConcurrencySafe: () => true,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    execute: async (args, exec) => {
      exec?.signal?.throwIfAborted?.();
      const input = typeof args?.args === 'string' ? args.args : '';
      try {
        const text = await run(input);
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
  ctx.effect?.(() => disposeTool, 'dsh-hsr: hsr tool');

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
