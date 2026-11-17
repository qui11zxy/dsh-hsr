/**
 * 使用说明：`hsr-help` 的正文。
 *
 * 五个工具分工是固定的：
 * - `hsr-find`  查角色、光锥、遗器套装、列清单；
 * - `hsr-help`  本文件，用法说明；
 * - `hsr-rule`  规则：查询规则与游戏规则知识库；
 * - `hsr-exp`   经验：查询经验与配队经验；
 * - `hsr-stage` 深渊关卡与主怪特点。
 *
 * 参数名与写法各工具通用，不带 `--` 的名字一律按中文名匹配。
 */

/** 每个工具的一句话职责。 */
const TOOL_ROWS = [
  ['hsr-find', '查角色、光锥、遗器套装，或列清单'],
  ['hsr-help', '用法说明与例子'],
  ['hsr-rule', '查询规则、游戏规则知识库（目录与分节）'],
  ['hsr-exp', '查询经验、配队经验'],
  ['hsr-stage', '查当前深渊关卡与主怪特点'],
];

/** 各工具的参数表。 */
const PARAM_ROWS = [
  ['--role <名字>', 'hsr-find', '查角色：满级属性、行迹加成、技能、额外能力、星魂、忆灵、推荐光锥'],
  ['--lightcone <名字>', 'hsr-find', '查光锥：满级基础属性、叠影 1~5 阶'],
  ['--relicset <名字>', 'hsr-find', '查遗器套装：内圈/外圈与 2 件、4 件套效果'],
  ['--list', 'hsr-find', '列清单，可配 --baseType / --damageType / --star 筛选'],
  ['--baseType <命途>', 'hsr-find', '按命途筛选：毁灭、巡猎、智识、同谐、虚无、存护、丰饶、记忆、欢愉'],
  ['--damageType <属性>', 'hsr-find', '按属性筛选（只对角色）：物理、火、冰、风、雷、量子、虚数'],
  ['--star <3|4|5>', 'hsr-find', '按星级筛选（只对光锥）'],
  ['--lang <中|英>', '全部', '输出语言，默认中文'],
  ['--rule', 'hsr-rule', '查询规则：什么时候查、怎么查、怎么答'],
  ['--teamKnowledge', 'hsr-rule', '配队知识：游戏规则目录 + 配队经验（篇幅长，默认只给目录）'],
  ['--section <编号|标题>', 'hsr-rule', '取游戏规则里的某一节，配合 --teamKnowledge 用；all 取全文'],
  ['--exp', 'hsr-exp', '查询经验（查资料时怎么少出错）'],
  ['--exp --team', 'hsr-exp', '配队经验（配队、排轴、估面板时怎么算）'],
  ['--stage <玩法>', 'hsr-stage', '深渊关卡：忘却之庭、虚构叙事、末日幻影给三间（星启模式与它前面那关的上下两间），异相仲裁给当前一期（三关 + 王棋关）'],
];

/** 例子。 */
const EXAMPLE_ROWS = [
  ['--role 三月七', 'hsr-find', '角色完整面板'],
  ['--role 开拓者', 'hsr-find', '开拓者所有形态（按 --baseType 收窄）'],
  ['--role --list --baseType 记忆', 'hsr-find', '所有记忆命途角色'],
  ['--lightcone 银河铁道之夜', 'hsr-find', '光锥满级属性与叠影'],
  ['--relicset 云无留迹的过客', 'hsr-find', '遗器套装内外圈与效果'],
  ['--teamKnowledge', 'hsr-rule', '配队前先取规则目录'],
  ['--teamKnowledge --section 3.6', 'hsr-rule', '再取需要的某一节'],
  ['--exp --team', 'hsr-exp', '配队前取配队经验'],
  ['--stage 忘却之庭', 'hsr-stage', '当前忘却之庭星启三间的主怪'],
  ['--stage 异相仲裁 3', 'hsr-stage', '异相仲裁第 3 关'],
];

/**
 * 渲染使用说明。
 * @param {'zh'|'en'} lang 语言。
 * @returns {string} 正文。
 */
export function renderHelp(lang) {
  const en = lang === 'en';
  const lines = [];

  lines.push(en ? '# Honkai: Star Rail lookup — how to use' : '# 《崩坏：星穹铁道》资料查询 —— 使用说明');
  lines.push('');
  lines.push(
    en
      ? 'Everything is fetched live from the game data; there is no local copy. Names are matched in Chinese by default.'
      : '所有资料都是联网现查，游戏数据没有本地副本。名字默认按中文匹配。',
  );
  lines.push('');

  lines.push(en ? '## Tools' : '## 五个工具');
  lines.push('');
  lines.push('| 工具 | 干什么 |');
  lines.push('|---|---|');
  for (const [name, what] of TOOL_ROWS) {
    lines.push(`| \`${name}\` | ${en ? EN_TOOL_WHAT[name] : what} |`);
  }
  lines.push('');

  lines.push(en ? '## Arguments' : '## 参数');
  lines.push('');
  lines.push('| 参数 | 工具 | 说明 |');
  lines.push('|---|---|---|');
  for (const [flag, tool, what] of PARAM_ROWS) {
    lines.push(`| \`${flag}\` | ${en ? EN_TOOL_NAME[tool] : tool} | ${en ? EN_PARAM_WHAT[flag] : what} |`);
  }
  lines.push('');
  lines.push(
    en
      ? 'Values may be written as `--role 三月七`, `--role=三月七` or `--role --三月七`. Names with spaces go in quotes: `--lightcone "银河铁道之夜"`.'
      : '取值可以写成 `--role 三月七`、`--role=三月七` 或 `--role --三月七`。名字里有空格时用引号：`--lightcone "银河铁道之夜"`。',
  );
  lines.push('');

  lines.push(en ? '## Examples' : '## 例子');
  lines.push('');
  lines.push('| 参数 | 工具 | 得到 |');
  lines.push('|---|---|---|');
  for (const [args, tool, what] of EXAMPLE_ROWS) {
    lines.push(`| \`${args}\` | ${en ? EN_TOOL_NAME[tool] : tool} | ${en ? EN_EXAMPLE_WHAT[args] : what} |`);
  }
  lines.push('');

  lines.push(en ? '## Notes' : '## 几点约定');
  lines.push('');
  if (en) {
    lines.push('- One query at a time: `--role`, `--lightcone` and `--relicset` cannot be combined.');
    lines.push('- Same name may match several entries; the tool lists them and asks you to narrow it down with `--baseType` or `--damageType`.');
    lines.push('- Numbers are the 80-level values; skills are shown at the level a player actually reaches (level 6 basic ATK, level 10 for the rest).');
    lines.push('- When the network is unreachable the tool says so plainly; it never dumps links or internals.');
    lines.push('- For team building: read `--teamKnowledge` first, then the section you need, then `--exp --team`.');
    lines.push('- Lookups hit the network and are slowish; if you need several entries, fire them in parallel instead of one by one.');
    lines.push('- Enemy skills in `hsr-stage` are for reference only: they list mechanics only, and the game may change them at any time.');
  } else {
    lines.push('- 一次只查一种：`--role`、`--lightcone`、`--relicset` 不能混用。');
    lines.push('- 名字可能对应多个条目，工具会列出来，让你用 `--baseType` 或 `--damageType` 收窄。');
    lines.push('- 数值一律是 80 级口径；技能按玩家实际能到的等级显示（普攻 6 级，其余 10 级）。');
    lines.push('- 连不上时工具只说连不上，不会吐出链接或内部细节。');
    lines.push('- 要配队：先 `--teamKnowledge` 看规则目录，再 `--section` 取需要的那节，最后 `--exp --team` 取配队经验。');
    lines.push('- 查询要联网，比较耗时；要查好几条时尽量并行发，不要一条一条串着查。');
    lines.push('- `hsr-stage` 里的敌人技能仅供参考：只列机制，且游戏随时可能改动。');
  }
  lines.push('');
  return lines.join('\n');
}

/** 英文工具说明。 */
const EN_TOOL_WHAT = {
  'hsr-find': 'Look up characters, light cones, relic sets, or list them',
  'hsr-help': 'This usage guide',
  'hsr-rule': 'Query rules and the game-rule knowledge base',
  'hsr-exp': 'Query notes and team-building notes',
  'hsr-stage': 'Look up the current challenge stages and their main enemies',
};

/** 英文工具名（表里显示成 hsr-xxx）。 */
const EN_TOOL_NAME = {
  'hsr-find': 'hsr-find',
  'hsr-help': 'hsr-help',
  'hsr-rule': 'hsr-rule',
  'hsr-exp': 'hsr-exp',
  'hsr-stage': 'hsr-stage',
  全部: 'any',
};

/** 英文参数说明。 */
const EN_PARAM_WHAT = {
  '--role <名字>': 'Character: 80-level stats, traces, skills, abilities, eidolons, memosprite, recommended light cone',
  '--lightcone <名字>': 'Light cone: 80-level stats and refinement 1~5',
  '--relicset <名字>': 'Relic set: inner/outer and the 2-pc / 4-pc effects',
  '--list': 'List entries, optionally filtered by --baseType / --damageType / --star',
  '--baseType <命途>': 'Filter by Path: Destruction, Hunt, Erudition, Harmony, Nihility, Preservation, Abundance, Remembrance, Elation',
  '--damageType <属性>': 'Filter by element (characters only): Physical, Fire, Ice, Wind, Lightning, Quantum, Imaginary',
  '--star <3|4|5>': 'Filter by rarity (light cones only)',
  '--lang <中|英>': 'Output language, Chinese by default',
  '--rule': 'Query rules: when to look things up and how to answer',
  '--teamKnowledge': 'Team knowledge: game-rule contents plus team notes (long, contents only by default)',
  '--section <编号|标题>': 'One section of the game rules, used with --teamKnowledge; all returns everything',
  '--exp': 'Query notes (how to avoid mistakes when reading game data)',
  '--exp --team': 'Team notes (team building, rotation, panel estimation)',
  '--stage <玩法>': 'Challenge stages: the three chambers of Memory of Chaos / Unknowable Domain / Apocalyptic Shadow (the Star Launch stage plus the two chambers of the stage before it), the current cycle of Peak Arbitration (three stages plus the King stage)',
};

/** 英文例子说明。 */
const EN_EXAMPLE_WHAT = {
  '--role 三月七': 'Full character panel',
  '--role 开拓者': 'Every Trailblazer variant (narrow with --baseType)',
  '--role --list --baseType 记忆': 'All Remembrance characters',
  '--lightcone 银河铁道之夜': 'Light cone stats and refinements',
  '--relicset 云无留迹的过客': 'Relic set slot and effects',
  '--teamKnowledge': 'Read the rule contents before building a team',
  '--teamKnowledge --section 3.6': 'Then fetch just that section',
  '--exp --team': 'Read team-building notes',
  '--stage 忘却之庭': 'Main enemies of the three Star Launch chambers of Memory of Chaos',
  '--stage 异相仲裁 3': 'Peak Arbitration, stage 3',
};
