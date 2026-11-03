/**
 * 经验层：查询经验与配队经验各成一套，每套三段。
 *
 * - 基础经验：随插件发布，只读。
 * - 模型检验：模型可以直接用文件工具改写。
 * - 用户经验：用户在设置页里填写，也可以直接改文件。
 *
 * 文件不存在时按空内容处理，并在首次读取时把目录与空文件建好，
 * 这样负责写经验的模型知道该往哪里写。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 两类经验的文件名。 */
const KINDS = {
  query: { model: 'model.md', user: 'user.md' },
  team: { model: 'model-team.md', user: 'user-team.md' },
};

/** 经验文件所在目录（用户主目录下）。 */
export function experienceDir() {
  return path.join(os.homedir(), '.dsh', 'dsh-hsr', 'experience');
}

/**
 * 某一类经验的两个可写文件路径。
 * @param {'query'|'team'} kind 经验类别。
 * @returns {{dir: string, model: string, user: string}} 路径。
 */
export function notePaths(kind) {
  const names = KINDS[kind] ?? KINDS.query;
  const dir = experienceDir();
  return {
    dir,
    model: path.join(dir, names.model),
    user: path.join(dir, names.user),
  };
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function ensureFiles() {
  try {
    await fs.mkdir(experienceDir(), { recursive: true });
    for (const kind of Object.keys(KINDS)) {
      const paths = notePaths(kind);
      for (const file of [paths.model, paths.user]) {
        try {
          await fs.access(file);
        } catch {
          await fs.writeFile(file, '', 'utf8');
        }
      }
    }
  } catch {
    // 主目录不可写时退化成"只有基础经验"，不影响查询。
  }
}

/** 读用户自己写的那一段。 */
export async function readUserNotes(kind) {
  return readIfExists(notePaths(kind).user);
}

/** 写用户自己写的那一段（设置页保存时调用）。 */
export async function writeUserNotes(kind, text) {
  const paths = notePaths(kind);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.user, String(text ?? ''), 'utf8');
}

/** 清空模型写下的检验经验，两类一起清。 */
export async function clearModelNotes() {
  const cleared = [];
  for (const kind of Object.keys(KINDS)) {
    const paths = notePaths(kind);
    try {
      await fs.mkdir(paths.dir, { recursive: true });
      await fs.writeFile(paths.model, '', 'utf8');
      cleared.push(paths.model);
    } catch {
      // 清不掉的路径不报错，交给调用方提示。
    }
  }
  return cleared;
}

/**
 * 读一套经验并拼成一段文本。
 * @param {'query'|'team'} kind 经验类别。
 * @param {string} baseFile 随插件发布的基础经验文件路径。
 * @param {{lang?: string}} options 语言。
 * @returns {Promise<string>} 拼好的文本。
 */
export async function loadNotes(kind, baseFile, options = {}) {
  await ensureFiles();
  const paths = notePaths(kind);
  const [base, model, user] = await Promise.all([
    readIfExists(baseFile),
    readIfExists(paths.model),
    readIfExists(paths.user),
  ]);
  const zh = options.lang !== 'en';
  const sections = [
    [zh ? '基础经验（插件自带）' : 'Base notes (bundled)', base],
    [zh ? `模型检验（可编辑：${paths.model}）` : `Model notes (editable: ${paths.model})`, model],
    [zh ? `用户经验（用户编辑：${paths.user}）` : `User notes (user-edited: ${paths.user})`, user],
  ];
  const lines = [];
  for (const [title, body] of sections) {
    lines.push(`### ${title}`);
    const text = String(body || '').trim();
    lines.push(text.length > 0 ? text : (zh ? '（暂无）' : '(empty)'));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
