/**
 * 五个工具的本地自测：伪造 ctx.tools.register 抓定义，再逐个调用 execute。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mod = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);

const tools = new Map();
const routes = new Map();
const ctx = {
  tools: {
    register(def) {
      tools.set(def.name, def);
      return () => tools.delete(def.name);
    },
  },
  webServer: {
    register(route) {
      routes.set(`${route.kind}:${route.path}`, route);
      return () => routes.delete(`${route.kind}:${route.path}`);
    },
  },
  effect(fn) {
    // 真实语义：立刻执行回调，回调返回的函数是销毁函数（不在这里调用）。
    const dispose = fn();
    if (typeof dispose === 'function') process.on('exit', dispose);
  },
};

mod.apply(ctx, {});
console.log('tools:', [...tools.keys()].join(', '));
console.log('routes:', [...routes.keys()].join(', '));

const problems = [];
const calls = [
  ['hsr-help', ''],
  ['hsr-help', '--lang en'],
  ['hsr-find', '--role 三月七'],
  ['hsr-find', '--role 星神★阿哈'],
  ['hsr-find', '--lightcone 当第一声「阿哈」响起'],
  ['hsr-find', '--relicset 云无留迹的过客'],
  ['hsr-find', '--role --list --baseType 记忆'],
  ['hsr-find', '--lightcone --list --star 5'],
  ['hsr-rule', '--rule'],
  ['hsr-rule', '--teamKnowledge'],
  ['hsr-rule', '--teamKnowledge --section 3.6'],
  ['hsr-exp', '--exp'],
  ['hsr-exp', '--exp --team'],
  // 越界：应该报"请改用另一个工具"
  ['hsr-find', '--rule'],
  ['hsr-rule', '--role 三月七'],
  ['hsr-exp', '--teamKnowledge'],
  ['hsr-help', '--role 三月七'],
  ['hsr-find', ''],
  ['hsr-rule', ''],
];

for (const [tool, args] of calls) {
  const def = tools.get(tool);
  if (!def) {
    problems.push(`缺少工具 ${tool}`);
    continue;
  }
  const out = await def.execute({ args }, {});
  const text = String(out?.text ?? '');
  const bad = ['undefined', 'NaN', '[object', 'http://', 'https://', 'static.nanoka'].filter((m) => text.includes(m));
  const first = text.split('\n')[0] ?? '';
  console.log(`--- ${tool} "${args}" -> ${text.split('\n').length} 行 | ${first.slice(0, 90)}`);
  if (bad.length > 0) problems.push(`${tool} "${args}" 输出含 ${bad.join('/')}`);
  if (text.length === 0) problems.push(`${tool} "${args}" 输出为空`);
}

if (problems.length > 0) {
  console.log('\nproblems:');
  for (const p of problems) console.log(' -', p);
  process.exitCode = 1;
} else {
  console.log('\nproblems: []');
}
