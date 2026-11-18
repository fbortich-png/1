// Usage: node render.js <outDir> [w h fps] [--times 0,2.5,...]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const out = path.resolve(args[0] || 'frames');
const W = +(args[1] || 1920), H = +(args[2] || 1080), FPS = +(args[3] || 30);
const ti = args.indexOf('--times');
const times = ti >= 0 ? args[ti + 1].split(',').map(Number) : null;
const startI = args.indexOf('--from') >= 0 ? +args[args.indexOf('--from') + 1] : 0;
const endI = args.indexOf('--to') >= 0 ? +args[args.indexOf('--to') + 1] : Math.round(15 * FPS);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  pg.on('console', m => console.log('[page]', m.text()));
  pg.on('pageerror', e => console.log('[err]', e.message));
  await pg.goto(`http://127.0.0.1:${port}/render/index.html?w=${W}&h=${H}`);
  await pg.waitForFunction('window.READY === true', null, { timeout: 120000 });
  const list = times || Array.from({ length: endI - startI }, (_, k) => (startI + k) / FPS);
  const t0 = Date.now();
  for (let k = 0; k < list.length; k++) {
    const t = list[k];
    const url = await pg.evaluate((t) => { window.renderAt(t); return document.querySelector('canvas').toDataURL('image/png'); }, t);
    const name = times ? `t_${t.toFixed(2)}.png` : `f_${String(startI + k).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    if (k % 30 === 0) console.log(`frame ${startI + k} t=${t.toFixed(2)} ${((Date.now() - t0) / (k + 1) / 1000).toFixed(2)}s/frame`);
  }
  await b.close(); srv.close();
});
