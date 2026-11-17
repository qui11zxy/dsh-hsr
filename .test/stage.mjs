/**
 * 自测：伪造 ctx.tools.register，抓到五个工具的 definition，逐条调 execute。
 */
import { apply } from '../lib/index.js';

const registered = [];
const ctx = {
  tools: {
    register(def) {
      registered.push(def);
      return () => {};
    },
  },
  webServer: {
    register(def) {
      return () => {};
    },
  },
  effect(cb) {
    const dispose = cb();
    return dispose;
  },
};

apply(ctx, {});

console.log('tools:', registered.map((d) => d.name).join(', '));

const byName = new Map(registered.map((d) => [d.name, d]));

async function run(name, args) {
  const def = byName.get(name);
  if (!def) {
    console.log(`MISSING TOOL ${name}`);
    return;
  }
  const exec = { signal: new AbortController().signal };
  const out = await def.execute({ args }, exec);
  const text = out?.text ?? '';
  const lines = text.split('\n');
  console.log(`--- ${name} ${JSON.stringify(args)} -> ${lines.length} lines`);
  console.log(lines.slice(0, 26).join('\n'));
  if (lines.length > 26) console.log(`... (+${lines.length - 26} more)`);
  return text;
}

const results = [];
results.push(await run('hsr-stage', '--stage 忘却之庭'));
results.push(await run('hsr-stage', '--stage 末日幻影'));
results.push(await run('hsr-stage', '--stage 虚构叙事'));
results.push(await run('hsr-stage', '--stage 异相仲裁 1'));
results.push(await run('hsr-stage', ''));
results.push(await run('hsr-stage', '--stage 乱写'));
results.push(await run('hsr-help', ''));
results.push(await run('hsr-find', '--role 三月七'));
