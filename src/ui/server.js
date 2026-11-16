// Web UI: paste a link, Kane checks it, download a SafuCard. Scam Arena at /arena.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { p, readJSON, STATE, ROOT } from '../paths.js';
import { check } from '../check.js';
import { safuCard } from '../card.js';
import { readLive } from '../live.js';
import { loadKaneNdjson } from '../kane.js';

const jobs = new Map();
let busy = false;

function safePath(input) {
  if (!input) return null;
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

function stepsFromDir(dir) {
  try { return loadKaneNdjson(path.join(dir, 'kane.ndjson')).steps || []; }
  catch { return []; }
}

function attachLoopSteps(history) {
  const docs = p('docs', 'runs', 'loop');
  const folders = fs.existsSync(docs) ? fs.readdirSync(docs).filter((d) => fs.existsSync(path.join(docs, d, 'kane.ndjson'))) : [];
  for (const h of history || []) {
    for (const side of ['first', 'recheck']) {
      const ev = h[side];
      if (!ev) continue;
      if (ev.kane?.steps?.length) continue;
      const fromRun = ev.runDir && fs.existsSync(path.join(ev.runDir, 'kane.ndjson')) ? ev.runDir : null;
      const hint = `${h.move}-${side}`;
      const match = folders.find((d) => d.includes(h.move) && d.includes(side.replace('first', 'first').replace('recheck', 'recheck')));
      const dir = fromRun || (match && path.join(docs, match));
      if (dir) {
        const steps = stepsFromDir(dir);
        ev.kane = { ...(ev.kane || {}), steps };
        ev.runDir = ev.runDir || dir;
      }
    }
  }
  return history;
}

function arenaPayload() {
  const live = readLive();
  const local = readJSON(path.join(STATE, 'loop', 'history.json'), null);
  // Recorded arena = every recorded loop (loop, loop2, loop-real), same as the website.
  const parts = ['loop', 'loop2', 'loop-real'].map((d) => readJSON(p('docs', 'runs', d, 'history.json'), null)).filter(Boolean);
  const recorded = parts.length ? {
    finishedAt: parts[parts.length - 1].finishedAt,
    credits: parts.reduce((a, x) => a + (x.credits || 0), 0),
    history: parts.flatMap((x) => x.history || []).map((h, i) => ({ ...h, round: i + 1 })),
  } : null;
  const history = attachLoopSteps((local?.history?.length ? local.history : recorded?.history) || []);
  const playbook = readJSON(p('src', 'loop', 'playbook.json'));
  return {
    live,
    source: local?.history?.length ? 'local' : 'recorded',
    finishedAt: (local?.history?.length ? local : recorded)?.finishedAt || null,
    credits: (local?.history?.length ? local : recorded)?.credits || 0,
    history,
    playbook,
  };
}

export function startUI(port = 4200) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    const html = (file) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(p('src', 'ui', file))); };
    if (url.pathname === '/') return html('index.html');
    if (url.pathname === '/arena') return html('arena.html');
    if (url.pathname === '/api/live') return json(200, readLive() || { phase: 'idle' });
    if (url.pathname === '/api/arena') return json(200, arenaPayload());
    if (url.pathname === '/api/check' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      let payload = {}; try { payload = JSON.parse(body || '{}'); } catch { return json(400, { error: 'invalid JSON' }); }
      const replay = payload.replay ? safePath(payload.replay) : null;
      let target = null;
      if (!replay) {
        try { target = new URL(payload.url).toString(); } catch { return json(400, { error: 'invalid URL' }); }
      }
      if (busy) return json(429, { error: 'a check is already running (Kane runs one browser at a time)' });
      const id = crypto.randomBytes(4).toString('hex');
      const job = { id, url: target || replay, status: 'running', log: [], steps: [], realSite: !!payload.realSite };
      jobs.set(id, job); busy = true;
      const orig = console.log;
      console.log = (...a) => { job.log.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')); orig(...a); };
      check(target, { quiet: false, json: false, realSite: !!payload.realSite, replay })
        .then(({ verdict, kane }) => { job.status = 'done'; job.verdict = verdict; job.steps = kane?.steps || verdict.kane?.steps || []; job.card = verdict.card; })
        .catch((e) => { job.status = 'error'; job.error = String(e); })
        .finally(() => { console.log = orig; busy = false; });
      return json(202, { id });
    }
    const card = url.pathname.match(/^\/api\/card\/(\w+)\.svg$/);
    if (card) {
      const j = jobs.get(card[1]);
      if (!j?.verdict) return json(404, { error: 'no card yet' });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="safucard-${card[1]}.svg"` });
      return res.end(safuCard(j.verdict));
    }
    const m = url.pathname.match(/^\/api\/job\/(\w+)$/);
    if (m) { const j = jobs.get(m[1]); return j ? json(200, j) : json(404, { error: 'no such job' }); }
    res.writeHead(404); res.end();
  });
  srv.listen(port, '127.0.0.1', () => console.log(`\n  SafuClick UI → http://127.0.0.1:${port}  ·  Scam Arena → http://127.0.0.1:${port}/arena\n      (start the gym in another terminal: npm run gym)\n`));
  return srv;
}
