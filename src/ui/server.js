// Minimal web UI: paste a link, Kane checks it, see the verdict card.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { p } from '../paths.js';
import { check } from '../check.js';

const jobs = new Map();
let busy = false;

export function startUI(port = 4200) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(p('src', 'ui', 'index.html'))); }
    if (url.pathname === '/api/check' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      let target; try { target = new URL(JSON.parse(body).url).toString(); } catch { return json(400, { error: 'invalid URL' }); }
      if (busy) return json(429, { error: 'a check is already running (Kane runs one browser at a time)' });
      const id = crypto.randomBytes(4).toString('hex'); const job = { id, url: target, status: 'running', log: [] };
      jobs.set(id, job); busy = true;
      const orig = console.log; // capture progress lines for the UI
      console.log = (...a) => { job.log.push(a.join(' ').replace(/\x1b\[[0-9;]*m/g, '')); orig(...a); };
      check(target, { quiet: false, json: false })
        .then(({ verdict }) => { job.status = 'done'; job.verdict = verdict; })
        .catch((e) => { job.status = 'error'; job.error = String(e); })
        .finally(() => { console.log = orig; busy = false; });
      return json(202, { id });
    }
    const m = url.pathname.match(/^\/api\/job\/(\w+)$/);
    if (m) { const j = jobs.get(m[1]); return j ? json(200, j) : json(404, { error: 'no such job' }); }
    res.writeHead(404); res.end();
  });
  srv.listen(port, '127.0.0.1', () => console.log(`\n  🛡️  SafuClick UI → http://127.0.0.1:${port}  (start the gym in another terminal: npm run gym)\n`));
  return srv;
}
