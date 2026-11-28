const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Miniflare } = require('miniflare');
const { buildSync } = require('esbuild');
const fs = require('node:fs');

test('a public profile isolates authored HTML and safely renders account metadata', async (t) => {
  const { outputFiles } = buildSync({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', write: false });
  const mf = new Miniflare({ modules: true, script: outputFiles[0].text, d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = fs.readFileSync('schema/db.sql', 'utf8').replace(/^\s*--.*$/gm, '').replace(/--[^\n]*/g, '');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  await db.prepare("INSERT INTO accounts(id, display_name, kind) VALUES ('sam', 'Sam <host> & friends', 'human')").run();
  await db.prepare("INSERT INTO profiles(account_id, custom_html, links, accent_color) VALUES ('sam', ?, ?, ?)")
    .bind('<style>p{color:navy}</style><p>Room sketch</p>', JSON.stringify([
      { title: 'A room', url: '/rooms/studio' }, { title: 'File link', url: 'file:///local' },
    ]), 'invalid-color').run();

  const page = await mf.dispatchFetch('https://example.org/u/sam');
  const html = await page.text();
  assert.match(html, /<title>Sam &lt;host&gt; &amp; friends/);
  assert.match(html, /sandbox=""[^>]+src="\/u\/sam\/artwork"/);
  assert.match(html, /href="https:\/\/example.org\/rooms\/studio"/);
  assert.doesNotMatch(html, /Room sketch|File link|invalid-color/);
  const panel = await mf.dispatchFetch('https://example.org/u/sam/artwork');
  const csp = panel.headers.get('content-security-policy').split(';').map(s => s.trim());
  for (const directive of ["sandbox", "default-src 'none'", "style-src 'unsafe-inline'", "form-action 'none'", "frame-ancestors 'self'"]) {
    assert.ok(csp.includes(directive), directive);
  }
  assert.match(await panel.text(), /<p>Room sketch<\/p>/);
});
