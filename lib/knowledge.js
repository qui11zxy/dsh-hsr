/**
 * 把长篇规则文件当成迷你知识库用：先给目录，再按编号或标题取某一节。
 *
 * `rules/game.md` 是使用者自己维护的战斗规则，篇幅不固定（作者那份近 300 行）。
 * 每次调用都把全文塞进上下文太浪费，所以 `--teamKnowledge` 只返回目录，
 * 模型看完目录再用 `--teamKnowledge --section 3.6` 取需要的那一节。
 */

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;
const NUMBER_RE = /^(\d+(?:\.\d+)*)[.．、]?\s+/;

/**
 * 切出所有标题及其行范围。行号 0 基，`end` 为开区间：取到下一个
 * 同级或更高级标题为止，所以父节包含它所有子节。
 */
export function indexSections(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const headings = [];
  lines.forEach((line, i) => {
    const matched = HEADING_RE.exec(line);
    if (!matched) return;
    const title = matched[2].replace(/^[#\s]+/, '').trim();
    const numberMatch = NUMBER_RE.exec(title);
    headings.push({
      line: i,
      level: matched[1].length,
      title,
      number: numberMatch ? numberMatch[1] : '',
      index: headings.length,
    });
  });
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    let end = lines.length;
    let children = 0;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= current.level) {
        end = headings[j].line;
        break;
      }
      children += 1;
    }
    current.end = end;
    current.children = children;
  }
  return { lines, headings };
}

function stripNumber(title) {
  return title.replace(NUMBER_RE, '');
}

/** 目录：只列到二级与三级标题，够模型判断该取哪一节。 */
export function renderIndex(text, { hint, emptyHint } = {}) {
  const { headings } = indexSections(text);
  const rows = headings.filter((h) => h.level >= 2 && h.level <= 3);
  if (rows.length === 0) return emptyHint || '';
  const out = [hint || ''].filter(Boolean);
  for (const heading of rows) {
    const label = heading.number ? `${heading.number}　${stripNumber(heading.title)}` : heading.title;
    const indent = heading.level >= 3 ? '　　' : '';
    const scope = heading.children > 0 ? `含 ${heading.children} 个小节` : `${heading.end - heading.line} 行`;
    out.push(`${indent}${label}（${scope}）`);
  }
  const leaf = headings.find((h) => h.level >= 3 && !h.number);
  if (leaf) out.push(`（像「${leaf.title}」这种没有编号的小节，直接用标题取。）`);
  return out.join('\n');
}

/**
 * 按「3」「3.6」「伤害计算」「击破」这类写法找节：先精确匹配编号，
 * 再匹配标题包含关系，都找不到返回 null。命中父节时整节（含子节）返回。
 */
export function readSection(text, selector) {
  const raw = String(selector ?? '').trim();
  if (!raw) return null;
  if (raw === 'all' || raw === '全部' || raw === '所有') {
    return { heading: null, title: '全文', text: String(text ?? '') };
  }
  const { lines, headings } = indexSections(text);
  const wanted = raw.replace(/[．。]/g, '.').replace(/^第/, '').replace(/节$/, '').trim();
  let hit = headings.find((h) => h.number === wanted)
    || headings.find((h) => h.number.startsWith(`${wanted}.`));
  if (!hit) {
    const plain = wanted.toLowerCase();
    hit = headings.find((h) => h.title.toLowerCase().includes(plain))
      || headings.find((h) => stripNumber(h.title).toLowerCase().includes(plain));
  }
  if (!hit) return null;
  const bodyLines = lines.slice(hit.line, hit.end);
  // 标题行已经作为返回值的第一行给出，正文里不再重复。
  if (bodyLines.length > 0 && HEADING_RE.test(bodyLines[0])) {
    bodyLines.shift();
    if (bodyLines[0] !== undefined && bodyLines[0].trim() === '') bodyLines.shift();
  }
  const body = bodyLines.join('\n').trimEnd();
  return { heading: hit, title: hit.title, text: body };
}
