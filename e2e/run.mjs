// Builds the app under a repo subpath, serves it, and runs every browser suite in e2e/.
// Usage: npm run e2e [suite ...]     (e.g. npm run e2e lock i18n)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = ['e2e1', 'e2e2', 'e2e3', 'e2e4', 'ver', 'xss', 'linkrep', 'pdftest', 'mob', 'restore', 'uni', 'pag', 'fold', 'math', 'notes', 'a11y', 'lock', 'i18n', 'feat2', 'imp', 'pagenum', 'tocpages', 'caption', 'bookmark', 'styles', 'crop', 'pdftext', 'perf', 'cols', 'track', 'split', 'wcomments', 'gdoc', 'resp'];
// Note: e2e2 continues from the browser profile e2e1 leaves behind, so run them together (or run everything).
const wanted = process.argv.slice(2);
const list = wanted.length ? wanted : SUITES;
const PORT = process.env.E2E_PORT || '4173';

if (!process.env.E2E_SKIP_BUILD) {
  const b = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-e2e', '--emptyOutDir'], { cwd: root, stdio: 'inherit', env: { ...process.env, BASE_PATH: '/my-repo/' } });
  if (b.status !== 0) process.exit(1);
}

const server = spawn('node', ['e2e/server.mjs', path.join(root, 'dist-e2e'), '/my-repo/', PORT], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const failed = [];
for (const name of list) {
  const file = path.join(root, 'e2e', `${name}.mjs`);
  if (!fs.existsSync(file)) { console.log(`? ${name}: no such suite`); failed.push(name); continue; }
  process.stdout.write(`• ${name} … `);
  const run = () => spawnSync('node', [file], { cwd: root, encoding: 'utf8', timeout: 240000, env: { ...process.env, APP_BASE: `http://localhost:${PORT}/my-repo/` } });
  let r = run();
  let out = `${r.stdout || ''}${r.stderr || ''}`;
  // A browser that fails to start (busy machine) is not a product failure: retry once.
  if (r.status !== 0 && /Failed to launch the browser/.test(out)) {
    r = run();
    out = `${r.stdout || ''}${r.stderr || ''}`;
  }
  const bad = out.split('\n').filter((l) => /^FAIL/.test(l));
  const ok = (out.match(/^ok /gm) || []).length;
  if (r.status !== 0 || bad.length) {
    console.log(`FAILED (exit ${r.status})`);
    console.log(bad.join('\n') || out.split('\n').slice(-15).join('\n'));
    failed.push(name);
  } else {
    console.log(`passed (${ok} checks)`);
  }
}
server.kill();
console.log(failed.length ? `\n${failed.length} suite(s) failed: ${failed.join(', ')}` : `\nAll ${list.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
