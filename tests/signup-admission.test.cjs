const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const { Miniflare } = require('miniflare');

test('members sponsor an address, other applicants require manual approval', async t => {
  const codes = new Map();
  const welcomes = [];
  let attempts = 0;
  const { outputFiles } = buildSync({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', write: false });
  const mf = new Miniflare({ modules: true, script: outputFiles[0].text, d1Databases: ['DB'],
    bindings: { SIGNUP_ADMIN_EMAILS: 'admin@example.test', AUTH_CODE_SECRET: 'local-only-test-secret-of-32-characters',
      ENVIRONMENT: 'test', AUTH_EMAIL_FROM: 'test@example.test', RESEND_API_KEY: 'local-test' },
    outboundService: async req => {
      const msg = await req.json();
      if (msg.subject.includes('sign-in code')) codes.set(msg.to[0], msg.text.match(/\b\d{6}\b/)[0]);
      else {
        if (msg.to[0] === 'retry@example.test' && ++attempts === 1) return new Response(null, { status: 503 });
        welcomes.push(msg.to[0]);
      }
      return Response.json({ id: 'test-delivery' });
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const schema = fs.readFileSync('schema/db.sql','utf8').replace(/--[^\n]*/g,'');
  await db.batch(schema.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  const api = (path, body, token) => mf.dispatchFetch('https://example.test/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const start = email => api('auth/request-code', { email });
  const apply = email => api('auth/request-access', { email, note: 'I work on interfaces.' });
  async function login(email, display_name, kind = 'human') {
    assert.equal((await start(email)).status, 200);
    return api('auth/verify-code', { email, display_name, kind, code: codes.get(email) });
  }
  await db.prepare("INSERT INTO accounts(id,display_name,email,kind) VALUES ('sam','Sam','admin@example.test','human')").run();
  const admin = (await (await login('admin@example.test')).json()).token;
  assert.ok(admin);
  const guest = 'new@example.test';
  assert.equal((await start(guest)).status, 200);
  assert.ok(!codes.has(guest));
  assert.equal((await api('auth/register-agent', { display_name: 'new', email: guest })).status, 403);
  assert.equal((await apply(guest)).status, 202);
  await apply(guest.toUpperCase());
  assert.equal((await start(guest)).status, 200);
  assert.ok(!codes.has(guest));
  const pending = () => api('admin/signup-requests', undefined, admin).then(r => r.json());
  const requests = (await pending()).requests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].email, guest);
  assert.equal((await api('admin/signup-requests')).status, 401);
  const review = 'admin/signup-requests/' + requests[0].id + '/approve';
  const decisions = await Promise.all([api(review, {}, admin), api(review, {}, admin)]);
  assert.deepEqual(decisions.map(r => r.status).sort(), [200,409]);
  assert.deepEqual(welcomes,[guest]);
  const visitor = await (await login(guest, 'Visitor', 'agent')).json();
  assert.equal(visitor.account.kind, 'agent');
  assert.equal((await api('admin/signup-requests', undefined, visitor.token)).status, 403);
  assert.equal((await api('auth/register-agent', {}, visitor.token)).status, 201);
  assert.equal((await api('auth/register-agent', {}, visitor.token)).status, 409);

  const declined = 'declined@example.test';
  await apply(declined);
  const id = (await pending()).requests[0].id;
  assert.equal((await api('admin/signup-requests/' + id + '/decline', {}, admin)).status, 200);
  const invite = email => api('invites', { email }, visitor.token);
  assert.equal((await invite(declined)).status, 202);
  await start(declined);
  assert.ok(!codes.has(declined));
  assert.ok(!welcomes.includes(declined));

  const addresses = Array.from({ length: 4 }, (_, i) => 'friend' + i + '@example.test');
  await apply(addresses[0]);
  const raced = await Promise.all(addresses.map(invite));
  assert.deepEqual(raced.map(r => r.status).sort(), [202,202,202,429]);
  const sent = welcomes.filter(email => addresses.includes(email));
  assert.equal(new Set(sent).size,3);
  const admitted = await (await login(sent[0], 'Friend')).json();
  assert.ok(admitted.token);
  assert.equal((await db.prepare('SELECT state FROM signup_applications WHERE email=?').bind(sent[0]).first()).state, 'joined');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM accounts').first()).n,3);
  // A challenge issued before a grant is withdrawn cannot create an account.
  const stale = 'stale@example.test';
  await db.prepare("INSERT INTO signup_applications(email,state) VALUES (?, 'approved')").bind(stale).run();
  await start(stale);
  await db.prepare("UPDATE signup_applications SET state='declined' WHERE email=?").bind(stale).run();
  assert.equal((await api('auth/verify-code', { email: stale, display_name: 'Stale', code: codes.get(stale) })).status, 403);
  assert.equal(await db.prepare('SELECT id FROM accounts WHERE email=?').bind(stale).first(), null);

  // A transient mail failure leaves the grant intact and retries the same notice.
  const retry = 'retry@example.test';
  await api('invites', { email: retry }, admin);
  assert.ok(!welcomes.includes(retry));
  const row = await db.prepare('SELECT state,next_notice_at FROM signup_applications WHERE email=?').bind(retry).first();
  assert.equal(row.state, 'approved');
  assert.ok(row.next_notice_at);
  await db.prepare('UPDATE signup_applications SET next_notice_at=unixepoch() WHERE email=?').bind(retry).run();
  const worker = await mf.getWorker();
  await worker.scheduled();
  assert.equal(welcomes.filter(address => address === retry).length, 1);
  assert.match(await (await mf.dispatchFetch('https://example.test/join')).text(), /Request an invitation/);
});
