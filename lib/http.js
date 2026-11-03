/**
 * 网络层：直连或经 HTTP 代理取一个 JSON。
 *
 * 代理写法接受 `127.0.0.1:7897`、`http://127.0.0.1:7897` 两种；
 * 走 CONNECT 隧道后再在隧道上发一个 HTTP/1.1 请求，因此不依赖任何第三方库。
 *
 * 所有失败都收敛成 `NetError`，消息里不出现主机名、路径以外的任何地址信息 ——
 * 调用方只把它转成一句固定提示。
 */

import http from 'node:http';
import tls from 'node:tls';
import zlib from 'node:zlib';

/** 网络取数失败。 */
export class NetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetError';
  }
}

/** 代理写法不合法时抛出，消息可直接展示。 */
export class ProxyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProxyError';
  }
}

const HEADER_LIMIT = 32 * 1024;
const BODY_LIMIT = 24 * 1024 * 1024;

/**
 * 解析代理写法。
 * @param {string} raw 用户填的代理，空串表示直连。
 * @returns {{host: string, port: number}|null} 代理地址；空串返回 null。
 */
export function parseProxy(raw) {
  const text = String(raw ?? '').trim();
  if (text.length === 0) return null;
  let body = text;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(body);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== 'http' && name !== 'https') {
      throw new ProxyError('代理只支持 http:// 形式，例如 127.0.0.1:7897。');
    }
    body = body.slice(scheme[0].length);
  }
  body = body.replace(/\/+$/, '');
  if (body.includes('@')) body = body.slice(body.lastIndexOf('@') + 1);
  const matched = /^\[([^\]]+)\](?::(\d+))?$/.exec(body) || /^([^:]+)(?::(\d+))?$/.exec(body);
  if (!matched) throw new ProxyError('代理写法看不懂，请填 127.0.0.1:7897 这样的地址。');
  const host = matched[1];
  const port = matched[2] === undefined ? 8080 : Number(matched[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ProxyError('代理端口不对，请填 127.0.0.1:7897 这样的地址。');
  }
  return { host, port };
}

function openTunnel(proxy, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}` },
      timeout: timeoutMs,
    });
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new NetError('proxy refused'));
        return;
      }
      socket.setTimeout(timeoutMs);
      resolve(socket);
    });
    request.once('timeout', () => {
      request.destroy();
      reject(new NetError('timeout'));
    });
    request.once('error', () => reject(new NetError('connect failed')));
    request.end();
  });
}

function secure(socket, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({ socket, servername: host, ALPNProtocols: ['http/1.1'] });
    tlsSocket.setTimeout(timeoutMs);
    tlsSocket.once('secureConnect', () => resolve(tlsSocket));
    tlsSocket.once('timeout', () => {
      tlsSocket.destroy();
      reject(new NetError('tls timeout'));
    });
    tlsSocket.once('error', () => reject(new NetError('tls failed')));
  });
}

function splitHead(buffer) {
  const end = buffer.indexOf('\r\n\r\n');
  if (end < 0) return null;
  const head = buffer.subarray(0, end).toString('latin1');
  const rest = buffer.subarray(end + 4);
  const lines = head.split('\r\n');
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(lines[0] || '')?.[1] ?? 0);
  const headers = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status, headers, rest };
}

function decodeChunked(buffer) {
  const parts = [];
  let offset = 0;
  for (;;) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) return null;
    const size = parseInt(buffer.subarray(offset, lineEnd).toString('latin1').trim(), 16);
    if (!Number.isFinite(size)) return null;
    if (size === 0) return Buffer.concat(parts);
    const start = lineEnd + 2;
    if (buffer.length < start + size + 2) return null;
    parts.push(buffer.subarray(start, start + size));
    offset = start + size + 2;
  }
}

function readBody(socket, head, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [head.rest];
    let settled = false;
    const finish = (buffer) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (head.headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
        const decoded = decodeChunked(buffer);
        if (decoded === null) reject(new NetError('bad chunked body'));
        else resolve(decoded);
        return;
      }
      const length = Number(head.headers['content-length']);
      resolve(Number.isFinite(length) ? buffer.subarray(0, length) : buffer);
    };
    const attempt = () => {
      const buffer = Buffer.concat(chunks);
      if (head.headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
        const decoded = decodeChunked(buffer);
        if (decoded !== null) finish(buffer);
        return;
      }
      const length = Number(head.headers['content-length']);
      if (Number.isFinite(length) && buffer.length >= length) finish(buffer);
    };
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const total = chunks.reduce((sum, part) => sum + part.length, 0);
      if (total > BODY_LIMIT) {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new NetError('body too large'));
        }
        return;
      }
      attempt();
    });
    socket.on('end', () => {
      if (settled) return;
      settled = true;
      const buffer = Buffer.concat(chunks);
      if (head.headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
        const decoded = decodeChunked(buffer);
        if (decoded === null) reject(new NetError('bad chunked body'));
        else resolve(decoded);
        return;
      }
      resolve(buffer);
    });
    socket.on('timeout', () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new NetError('timeout'));
      }
    });
    socket.on('error', () => {
      if (!settled) {
        settled = true;
        reject(new NetError('socket error'));
      }
    });
    attempt();
  });
}

async function requestThroughProxy(target, proxy, timeoutMs) {
  const socket = await openTunnel(proxy, target.hostname, Number(target.port || 443), timeoutMs);
  let tlsSocket;
  try {
    tlsSocket = await secure(socket, target.hostname, timeoutMs);
  } catch (error) {
    socket.destroy();
    throw error;
  }
  const requestText = [
    `GET ${target.pathname}${target.search} HTTP/1.1`,
    `Host: ${target.hostname}`,
    'Accept: application/json',
    'Accept-Encoding: identity',
    'Cache-Control: no-cache',
    'Connection: close',
    '',
    '',
  ].join('\r\n');
  tlsSocket.write(requestText, 'latin1');

  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const done = (finish) => {
      if (settled) return;
      settled = true;
      finish();
    };
    tlsSocket.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > BODY_LIMIT) {
        done(() => {
          tlsSocket.destroy();
          reject(new NetError('body too large'));
        });
        return;
      }
      const all = Buffer.concat(chunks);
      const end = all.indexOf('\r\n\r\n');
      if (end < 0) {
        if (all.length > HEADER_LIMIT) {
          done(() => {
            tlsSocket.destroy();
            reject(new NetError('header too large'));
          });
        }
        return;
      }
      const head = splitHead(all);
      if (head === null) return;
      if (head.headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
        if (decodeChunked(head.rest) !== null) done(() => resolve(all));
        return;
      }
      const length = Number(head.headers['content-length']);
      if (Number.isFinite(length) && head.rest.length >= length) done(() => resolve(all));
    });
    tlsSocket.on('end', () => done(() => resolve(Buffer.concat(chunks))));
    tlsSocket.on('timeout', () => done(() => {
      tlsSocket.destroy();
      reject(new NetError('timeout'));
    }));
    tlsSocket.on('error', (error) => done(() => {
      tlsSocket.destroy();
      reject(error instanceof NetError ? error : new NetError('socket error'));
    }));
  });

  const head = splitHead(buffer);
  if (head === null) throw new NetError('bad response');
  let body = head.rest;
  if (head.headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
    const decoded = decodeChunked(body);
    if (decoded === null) throw new NetError('bad chunked body');
    body = decoded;
  } else {
    const length = Number(head.headers['content-length']);
    if (Number.isFinite(length) && body.length > length) body = body.subarray(0, length);
  }
  if (head.headers['content-encoding']?.toLowerCase() === 'gzip') {
    try {
      body = zlib.gunzipSync(body);
    } catch {
      throw new NetError('bad gzip body');
    }
  }
  return { status: head.status, text: body.toString('utf8') };
}

/**
 * 取回一个 JSON 文本。
 * @param {string} url 完整地址。
 * @param {{proxy?: string, timeoutMs?: number}} options 代理与超时。
 * @returns {Promise<{status: number, text: string}>} 响应。
 */
export async function requestText(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000;
  const proxy = parseProxy(options.proxy);
  const target = new URL(url);
  if (proxy !== null) return requestThroughProxy(target, proxy, timeoutMs);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, text };
  } catch {
    throw new NetError('request failed');
  } finally {
    clearTimeout(timer);
  }
}
