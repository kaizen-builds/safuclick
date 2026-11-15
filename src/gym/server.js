// Phishing gym: one official SafuSwap + config-driven scam variants, each on its own port/host.
import http from 'node:http';
import fs from 'node:fs';
import { p, readJSON, COLLECTOR_URL, STATE } from '../paths.js';
import { startCollector } from '../collector.js';
import path from 'node:path';

export const VARIANTS_FILE = p('gym', 'variants.json');
export const LOOP_VARIANT_FILE = path.join(STATE, 'loop-variant.json');
export const LOOP_PORT = 4110;

export function loadSites() {
  const cfg = readJSON(VARIANTS_FILE);
  const sites = [cfg.official, ...cfg.variants];
  const loop = readJSON(LOOP_VARIANT_FILE, null);
  if (loop) sites.push({ ...loop, port: LOOP_PORT });
  return sites;
}
export const siteUrl = (s) => `http://${s.host}:${s.port}/`;

function serve(port) {
  const tpl = () => fs.readFileSync(p('src', 'gym', 'public', 'app.html'), 'utf8');
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // Re-read config every request so the scammer agent can hot-swap traps.
    const site = loadSites().find((s) => s.port === port);
    if (!site) { res.writeHead(503); return res.end('no site configured on this port (yet)'); }
    if (url.pathname === '/__safu/wallet.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(p('src', 'wallet', 'mock-wallet.js')));
    }
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(p('src', 'gym', 'public', 'app.js')));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const pub = { id: site.id, title: site.title, router: site.router, traps: site.traps || [] };
      const html = tpl().replaceAll('{{TITLE}}', site.title).replaceAll('{{ID}}', site.id)
        .replace('{{COLLECTOR}}', JSON.stringify(COLLECTOR_URL)).replace('{{CONFIG}}', JSON.stringify(pub));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.writeHead(404); res.end('not found');
  });
}

export async function startGym({ quiet = false } = {}) {
  const servers = [await startCollector({ quiet })];
  const ports = [...new Set([...loadSites().map((s) => s.port), LOOP_PORT])];
  for (const port of ports) {
    const srv = serve(port);
    await new Promise((resolve, reject) => {
      srv.once('error', (e) => (e.code === 'EADDRINUSE' ? resolve() : reject(e)));
      srv.listen(port, '127.0.0.1', resolve);
    });
    servers.push(srv);
  }
  if (!quiet) {
    console.log('\n  🏋️  SafuClick phishing gym is up (mock wallet, mock contracts, no real funds)\n');
    for (const s of loadSites()) console.log(`  ${s.id === 'official' ? '✅' : '🎣'} ${s.id.padEnd(10)} ${siteUrl(s)}${s._truth ? '   ← ' + s._truth : ''}`);
    console.log(`  🧪 loop slot   http://<any>.localhost:${LOOP_PORT}/  (scammer agent plants evolved traps here)\n`);
  }
  return { close: () => servers.forEach((s) => s && s.close()) };
}
