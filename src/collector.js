// Tiny evidence collector: the mock wallet POSTs every request/decision here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { STATE, COLLECTOR_PORT, COLLECTOR_URL } from './paths.js';

const entries = [];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true' };

export function startCollector({ quiet = false } = {}) {
  return new Promise((resolve) => {
    const file = path.join(STATE, 'wallet-log.jsonl');
    fs.mkdirSync(STATE, { recursive: true });
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method === 'POST' && url.pathname === '/log') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try { const e = JSON.parse(body); entries.push(e); fs.appendFileSync(file, JSON.stringify(e) + '\n'); } catch {}
          res.writeHead(204, cors); res.end();
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/log') {
        const run = url.searchParams.get('run');
        const out = run ? entries.filter((e) => e.run === run) : entries;
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out));
      }
      if (url.pathname === '/health') { res.writeHead(200, cors); return res.end('ok'); }
      res.writeHead(404, cors); res.end();
    });
    srv.on('error', (e) => {
      if (e.code === 'EADDRINUSE') { if (!quiet) console.log(`  collector already running on :${COLLECTOR_PORT}`); resolve(null); }
      else throw e;
    });
    srv.listen(COLLECTOR_PORT, '127.0.0.1', () => { if (!quiet) console.log(`  evidence collector  ${COLLECTOR_URL}`); resolve(srv); });
  });
}

export async function fetchLog(run) {
  const r = await fetch(`${COLLECTOR_URL}?run=${encodeURIComponent(run)}`);
  return r.json();
}
