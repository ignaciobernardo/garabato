#!/usr/bin/env node
// Garabato session server.
//
//   garabato [target] [--port 7777] [--out .garabato] [--once] [--no-open]
//   garabato mcp
//
// Serves a page with Garabato already on it: the reviewer talks and draws, presses "Send to
// agent", and the feedback lands in the project as .garabato/<time>/feedback.md + feedback.json +
// frames/. `target` is a dev-server port (4321), a URL (http://localhost:5173/pricing) or a
// folder / HTML file. Without one it looks for a dev server on the usual ports.
//
// `garabato mcp` speaks the Model Context Protocol over stdio, so an agent can open a review and
// wait for the feedback as a tool call. No dependencies.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'extension', 'garabato.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PREFIX = '/__garabato';
const TAG = `<script defer src="${PREFIX}/garabato.js" data-bridge="${PREFIX}/api"></script>`;
const DEV_PORTS = [5173, 4321, 3000, 3001, 8080, 8000, 5000, 4200, 8888, 1234];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
};

// stdout is reserved for results (feedback paths in the CLI, JSON-RPC in MCP mode): talk on stderr
const log = (...a) => console.error(...a);

// ───────────────────────────── helpers
function isListening(port, host = 'localhost') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host, autoSelectFamily: true });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(500, () => done(false));
  });
}

async function resolveTarget(arg) {
  if (!arg) {
    for (const p of DEV_PORTS) if (await isListening(p)) return { kind: 'proxy', url: new URL(`http://localhost:${p}/`) };
    return null;
  }
  arg = String(arg).trim();
  if (/^\d+$/.test(arg)) return { kind: 'proxy', url: new URL(`http://localhost:${arg}/`) };
  if (/^https?:\/\//i.test(arg)) return { kind: 'proxy', url: new URL(arg) };
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(arg)) return { kind: 'proxy', url: new URL('http://' + arg) };
  const p = path.resolve(arg);
  const st = await fsp.stat(p).catch(() => null);
  if (st?.isDirectory()) return { kind: 'static', root: p, start: '/' };
  if (st?.isFile()) return { kind: 'static', root: path.dirname(p), start: '/' + encodeURIComponent(path.basename(p)) };
  throw new Error(`"${arg}" isn't a port, a URL or a file/folder`);
}

const describeTarget = (t) => (t.kind === 'proxy' ? `proxying ${t.url.origin}` : `serving ${t.root}`);

function injectTag(html) {
  if (html.includes(`${PREFIX}/garabato.js`)) return html;
  const m = html.match(/<head(\s[^>]*)?>/i);
  if (m) return html.slice(0, m.index + m[0].length) + TAG + html.slice(m.index + m[0].length);
  const b = html.toLowerCase().lastIndexOf('</body>');
  return b >= 0 ? html.slice(0, b) + TAG + html.slice(b) : html + TAG;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      const onError = (e) => { server.off('listening', onListening); if (e.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1); else reject(e); };
      const onListening = () => { server.off('error', onError); resolve(server.address().port); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    };
    attempt(port, 20);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, code, body) {
  const out = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(out), 'cache-control': 'no-store' });
  res.end(out);
}

function openBrowser(url) {
  // Garabato needs Chrome (tab capture with preferCurrentTab, speech recognition)
  const [cmd, args] = process.platform === 'darwin' ? ['open', ['-a', 'Google Chrome', url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', 'chrome', url]]
      : ['xdg-open', [url]];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
  p.on('error', () => {});
  p.on('exit', (code) => { if (code && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); });
  p.unref();
}

const downPage = (t, e) => `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Waiting for ${t.origin}</title>
<body style="font:15px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#333">
<div style="text-align:center"><b>Nothing is answering at ${t.origin} yet.</b><br>Start your dev server; this page retries every 2 seconds.<br><small style="color:#999">${String(e.code || e.message)}</small></div>`;

// ───────────────────────────── session: one review server
class Session extends EventEmitter {
  constructor(target, { port = 7777, out = '.garabato' } = {}) {
    super();
    this.target = target;
    this.wantPort = port;
    this.out = path.resolve(out);
    this.sockets = new Set();
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      log('garabato:', e.message);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e.message));
    }));
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
    this.server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    this.port = await listen(this.server, this.wantPort);
    this.origin = `http://localhost:${this.port}`;
    this.url = this.origin + (this.target.kind === 'proxy' ? this.target.url.pathname + this.target.url.search : this.target.start);
    return this;
  }

  close() {
    for (const s of this.sockets) s.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  async handle(req, res) {
    const u = new URL(req.url, this.origin);
    if (u.pathname.startsWith(PREFIX + '/')) return this.own(req, res, u.pathname.slice(PREFIX.length));
    if (this.target.kind === 'proxy') return this.proxy(req, res);
    return this.serveStatic(req, res, u);
  }

  async own(req, res, p) {
    if (p === '/garabato.js') {
      const js = await fsp.readFile(SCRIPT);
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(js);
    }
    if (p === '/api/ping') return json(res, 200, { ok: true, version: VERSION });
    if (p === '/api/feedback' && req.method === 'POST') {
      // a custom header forces a CORS preflight we never answer, so other sites can't post here
      if (req.headers['x-garabato'] !== '1') return json(res, 403, { error: 'forbidden' });
      const body = JSON.parse((await readBody(req, 150 * 1024 * 1024)).toString('utf8'));
      const saved = await this.save(body);
      res.on('finish', () => this.emit('feedback', saved));
      return json(res, 200, { ok: true, path: path.relative(process.cwd(), saved.dir) || '.' });
    }
    return json(res, 404, { error: 'not found' });
  }

  async save(body) {
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    let dir = path.join(this.out, stamp);
    for (let i = 2; fs.existsSync(dir); i++) dir = path.join(this.out, `${stamp}-${i}`);
    const files = [];
    for (const f of Array.isArray(body.files) ? body.files : []) {
      const name = String(f.name || '');
      if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name) || name.includes('..')) continue;
      const dest = path.join(dir, name);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, f.base64 != null ? Buffer.from(String(f.base64), 'base64') : String(f.text ?? ''));
      files.push(name);
    }
    this.hintGitignore();
    return { dir, md: path.join(dir, 'feedback.md'), files, page: String(body.page || ''), title: String(body.title || ''), at: d.toISOString() };
  }

  hintGitignore() {
    if (this.hinted) return;
    this.hinted = true;
    const gi = path.join(process.cwd(), '.gitignore');
    if (!this.out.startsWith(process.cwd()) || !fs.existsSync(gi)) return;
    const rel = path.relative(process.cwd(), this.out).split(path.sep)[0];
    if (!fs.readFileSync(gi, 'utf8').split('\n').some((l) => l.replace(/^\/|\/$/g, '').trim() === rel)) log(`  Tip: add ${rel}/ to .gitignore`);
  }

  proxy(req, res) {
    const t = this.target.url, secure = t.protocol === 'https:';
    const headers = { ...req.headers, host: t.host };
    if (headers.origin) headers.origin = t.origin;
    if (headers.referer) headers.referer = headers.referer.replace(this.origin, t.origin);
    const up = (secure ? https : http).request({
      protocol: t.protocol, hostname: t.hostname, port: t.port || (secure ? 443 : 80),
      method: req.method, path: req.url, headers, autoSelectFamily: true,
    }, (ur) => {
      const h = { ...ur.headers };
      for (const k of ['content-security-policy', 'content-security-policy-report-only', 'connection', 'keep-alive']) delete h[k];
      if (h.location?.startsWith(t.origin)) h.location = this.origin + h.location.slice(t.origin.length);
      if (secure && h['set-cookie']) h['set-cookie'] = h['set-cookie'].map((c) => c.replace(/;\s*Secure/gi, '').replace(/;\s*Domain=[^;]+/gi, '').replace(/;\s*SameSite=None/gi, '; SameSite=Lax'));
      const isHTML = /text\/html/i.test(h['content-type'] || '') && req.method !== 'HEAD' && ![204, 304].includes(ur.statusCode);
      if (!isHTML) { res.writeHead(ur.statusCode, ur.statusMessage, h); ur.pipe(res); return; }
      const enc = String(h['content-encoding'] || '').toLowerCase();
      const stream = enc.includes('gzip') ? ur.pipe(zlib.createGunzip()) : enc === 'br' ? ur.pipe(zlib.createBrotliDecompress()) : enc === 'deflate' ? ur.pipe(zlib.createInflate()) : ur;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
      stream.on('end', () => {
        const out = Buffer.from(injectTag(Buffer.concat(chunks).toString('utf8')));
        delete h['content-encoding']; delete h['transfer-encoding'];
        h['content-length'] = out.length;
        h['cache-control'] = 'no-store';
        res.writeHead(ur.statusCode, ur.statusMessage, h);
        res.end(out);
      });
    });
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(downPage(t, e));
    });
    req.pipe(up);
  }

  // websockets (Vite/Next/Astro hot reload) go straight through
  upgrade(req, socket, head) {
    if (this.target.kind !== 'proxy') return socket.destroy();
    const t = this.target.url, secure = t.protocol === 'https:';
    const port = Number(t.port) || (secure ? 443 : 80);
    const up = secure ? tls.connect({ host: t.hostname, port, servername: t.hostname }) : net.connect({ host: t.hostname, port, autoSelectFamily: true });
    up.once(secure ? 'secureConnect' : 'connect', () => {
      let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        let v = req.rawHeaders[i + 1];
        if (/^host$/i.test(k)) v = t.host;
        else if (/^origin$/i.test(k)) v = t.origin;
        raw += `${k}: ${v}\r\n`;
      }
      up.write(raw + '\r\n');
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    const kill = () => { socket.destroy(); up.destroy(); };
    up.on('error', kill); socket.on('error', kill);
    up.on('close', () => socket.destroy()); socket.on('close', () => up.destroy());
  }

  async serveStatic(req, res, u) {
    const root = this.target.root;
    let p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
    if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    let st = await fsp.stat(p).catch(() => null);
    if (st?.isDirectory()) { p = path.join(p, 'index.html'); st = await fsp.stat(p).catch(() => null); }
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(injectTag(`<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font:15px system-ui;padding:40px">Not found: ${u.pathname.replace(/[<>&"]/g, '')}</p>`));
    }
    const ext = path.extname(p).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    if (ext === '.html' || ext === '.htm') {
      const out = Buffer.from(injectTag(await fsp.readFile(p, 'utf8')));
      res.writeHead(200, { 'content-type': type, 'content-length': out.length, 'cache-control': 'no-store' });
      return res.end(out);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  }
}

// ───────────────────────────── CLI
function parseArgs(argv) {
  const a = { _: [], port: 7777, out: '.garabato', once: false, open: true };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--port' || x === '-p') a.port = Number(argv[++i]);
    else if (x.startsWith('--port=')) a.port = Number(x.slice(7));
    else if (x === '--out' || x === '-o') a.out = argv[++i];
    else if (x.startsWith('--out=')) a.out = x.slice(6);
    else if (x === '--once') a.once = true;
    else if (x === '--no-open') a.open = false;
    else if (x === '--help' || x === '-h') a.help = true;
    else if (x === '--version' || x === '-v') a.version = true;
    else a._.push(x);
  }
  return a;
}

const HELP = `Garabato ${VERSION}: talk through a web page while you draw on it; your agent gets the feedback.

Usage
  garabato [target] [options]   open a review session
  garabato mcp                  run as an MCP server (stdio) for coding agents

Target
  4321                          a dev server port
  http://localhost:5173/about   a URL (local dev servers work best)
  ./dist  or  page.html         a folder or an HTML file
  (nothing)                     look for a dev server on ${DEV_PORTS.join(', ')}

Options
  --port <n>     review server port (default 7777)
  --out <dir>    where feedback is saved (default .garabato)
  --once         exit after the first feedback (handy for agents running it in the background)
  --no-open      don't open Chrome

Each "Send to agent" saves <out>/<time>/feedback.md, feedback.json and frames/*.jpg,
and prints the path of feedback.md on stdout.`;

async function cli(argv) {
  const args = parseArgs(argv);
  if (args.help) return void console.log(HELP);
  if (args.version) return void console.log(VERSION);
  if (args._[0] === 'mcp') return mcp(args);
  let target;
  try { target = await resolveTarget(args._[0]); } catch (e) { log(e.message); process.exit(1); }
  if (!target) { log(`No dev server found on ports ${DEV_PORTS.join(', ')}. Start one, or pass a port, URL or folder:\n  garabato 4321`); process.exit(1); }
  const s = await new Session(target, { port: args.port, out: args.out }).start();
  log(`\n  Garabato ${VERSION}\n  Review:   ${s.url}\n  Target:   ${describeTarget(target)}\n  Feedback: ${path.relative(process.cwd(), s.out) || '.'}/\n`);
  log(args.once ? '  Waiting for "Send to agent"…\n' : '  Waiting for feedback. Ctrl+C to stop.\n');
  if (args.open) openBrowser(s.url);
  s.on('feedback', async (f) => {
    process.stdout.write(`Feedback saved: ${path.relative(process.cwd(), f.md)}\n`);
    if (args.once) { await s.close(); process.exit(0); }
  });
  process.on('SIGINT', () => { s.close().then(() => process.exit(0)); });
}

// ───────────────────────────── MCP (JSON-RPC 2.0 over stdio, one message per line)
function mcp(args) {
  let session = null;
  const unread = [];
  const waiters = new Set();
  const text = (t) => ({ content: [{ type: 'text', text: t }] });

  const TOOLS = [
    {
      name: 'start_review',
      description: 'Open a web page in Chrome with Garabato on it so the user can review it out loud: they talk and draw on the page, then press "Send to agent". ' +
        'Proxies a running dev server (port or URL, hot reload keeps working) or serves a folder or HTML file. Call wait_for_feedback next to receive what they said and marked.',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Dev server port ("4321"), URL ("http://localhost:5173/pricing"), or path to a folder or HTML file. Omit to find a dev server on the usual ports.' },
          open: { type: 'boolean', description: 'Open Chrome on the review page (default true).' },
        },
      },
    },
    {
      name: 'wait_for_feedback',
      description: "Wait for the user's next Garabato feedback and return it: moments that pair what they said (automatic transcript) with what they marked " +
        '(CSS selector, quoted text, and source file:line when the dev server exposes it), plus screenshots of the page with their drawings. ' +
        'If it times out, call it again to keep waiting.',
      inputSchema: { type: 'object', properties: { timeout_seconds: { type: 'number', description: 'How long to wait, in seconds (default 600).' } } },
    },
    { name: 'stop_review', description: 'Stop the review server.', inputSchema: { type: 'object', properties: {} } },
  ];

  async function feedbackResult(f) {
    const md = await fsp.readFile(f.md, 'utf8').catch(() => '(feedback.md missing)');
    const frames = f.files.filter((n) => n.startsWith('frames/'));
    const rel = path.relative(process.cwd(), f.dir) || '.';
    const content = [{ type: 'text', text: `Feedback on ${f.page} saved in ${rel}/ (feedback.md, feedback.json${frames.length ? ', frames/' : ''}).\n\n${md}` }];
    for (const name of frames.slice(0, 12)) {
      content.push({ type: 'text', text: name });
      content.push({ type: 'image', data: (await fsp.readFile(path.join(f.dir, name))).toString('base64'), mimeType: 'image/jpeg' });
    }
    if (frames.length > 12) content.push({ type: 'text', text: `${frames.length - 12} more frames in ${rel}/frames/.` });
    return { content };
  }

  async function call(name, a = {}) {
    if (name === 'start_review') {
      const target = await resolveTarget(a.target);
      if (!target) throw new Error(`No dev server found on ports ${DEV_PORTS.join(', ')}. Start it first or pass target.`);
      if (session) await session.close();
      session = await new Session(target, { port: args.port, out: args.out }).start();
      session.on('feedback', (f) => {
        const w = waiters.values().next().value;
        if (w) { waiters.delete(w); w(f); } else unread.push(f);
      });
      if (a.open !== false) openBrowser(session.url);
      return text(`Review open at ${session.url} (${describeTarget(target)}). The user talks and draws on the page, then presses "Send to agent". ` +
        `Call wait_for_feedback to receive it. Feedback is also saved under ${path.relative(process.cwd(), session.out) || '.'}/.`);
    }
    if (name === 'wait_for_feedback') {
      if (!session && !unread.length) throw new Error('No review is open. Call start_review first.');
      const f = unread.shift() || await new Promise((resolve) => {
        const w = (x) => { clearTimeout(timer); resolve(x); };
        const timer = setTimeout(() => { waiters.delete(w); resolve(null); }, Math.max(1, Number(a.timeout_seconds) || 600) * 1000);
        waiters.add(w);
      });
      return f ? feedbackResult(f) : text(`No feedback yet; the review is still open at ${session.url}. Call wait_for_feedback again to keep waiting.`);
    }
    if (name === 'stop_review') {
      if (session) { await session.close(); session = null; }
      return text('Review server stopped.');
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications
    try {
      if (method === 'initialize') {
        return send({ jsonrpc: '2.0', id, result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'garabato', version: VERSION },
          instructions: 'Use start_review to open a page for the user to review by talking and drawing on it, then wait_for_feedback to receive their feedback.',
        } });
      }
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      if (method === 'tools/call') {
        let result;
        try { result = await call(params?.name, params?.arguments); } catch (e) { result = { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
        return send({ jsonrpc: '2.0', id, result });
      }
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  });
  rl.on('close', async () => { if (session) await session.close(); process.exit(0); });
}

cli(process.argv.slice(2)).catch((e) => { log(e.stack || e.message); process.exit(1); });
