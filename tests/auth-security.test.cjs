const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const { Miniflare } = require('miniflare');

test('email sign-in and credential lifecycle on local D1', async (t) => {
  const mail = new Map();
  const outboundService = async request => {
    assert.equal(request.url, 'https://api.resend.com/emails');
    const message = await request.json();
    if (message.to[0] === 'failure@example.test') return new Response(null, { status: 503 });
    mail.set(message.to[0], message.text.match(/\b\d{6}\b/)[0]);
    return Response.json({ id: 'test-delivery' });
  };
  const { outputFiles } = buildSync({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', write: false });
  const mf = new Miniflare({ modules: true, script: outputFiles[0].text, d1Databases: ['DB'], outboundService,
    bindings: { AUTH_CODE_SECRET: 'local-only-test-secret-of-32-characters', RESEND_API_KEY: 'local-test', AUTH_EMAIL_FROM: 'test@example.test' } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const sql = fs.readFileSync('schema/db.sql', 'utf8').replace(/--[^\n]*/g, '');
  await db.batch(sql.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  const post = (route, body, headers = {}) => mf.dispatchFetch('https://example.org/api/auth/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const issue = email => post('request-code', { email });
  const verify = (email, code, display_name) => post('verify-code', { email, code, display_name });
  const me = headers => mf.dispatchFetch('https://example.org/api/me', { headers });
  const email = 'visitor@example.test';

  for (const address of [email, 'next@example.test', 'expired@example.test', 'failure@example.test', 'loom@example.test']) {
    await db.prepare("INSERT OR IGNORE INTO signup_applications(email,state) VALUES (?,'approved')").bind(address).run();
  }
  assert.equal((await issue(email)).status, 200);
  const code = mail.get(email);
  assert.match(code, /^\d{6}$/);
  const challenge = await db.prepare('SELECT digest FROM email_challenges WHERE email=?').bind(email).first();
  assert.match(challenge.digest, /^[0-9a-f]{64}$/);
  assert.equal((await issue(email)).status, 200);
  assert.equal(mail.get(email), code);
  assert.equal((await verify(email, code)).status, 400);
  const verified = await Promise.all([verify(email, code, 'Visitor'), verify(email, code, 'Visitor')]);
  assert.deepEqual(verified.map(r => r.status).sort(), [200, 401]);
  const { token } = await verified.find(r => r.ok).json();
  const session = await db.prepare('SELECT token FROM sessions').first();
  assert.match(session.token, /^sha256:/);
  const bearer = token => ({ Authorization: 'Bearer ' + token });
  assert.equal((await me(bearer(token))).status, 200);
  assert.equal((await me(bearer(session.token))).status, 401);
  await post('logout', {}, bearer(token));
  assert.equal((await me(bearer(token))).status, 401);

  const next = 'next@example.test';
  await issue(next);
  const nextCode = mail.get(next);
  assert.equal((await verify(next, nextCode, 'Visitor')).status, 409);
  const wrong = nextCode === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await verify(next, wrong, 'Next')).status, 401);
  assert.equal((await verify(next, nextCode, 'Next')).status, 401);

  const expired = 'expired@example.test';
  await issue(expired);
  await db.prepare('UPDATE email_challenges SET expires_at=unixepoch()-1 WHERE email=?').bind(expired).run();
  assert.equal((await verify(expired, mail.get(expired), 'Expired')).status, 401);
  assert.equal((await issue('failure@example.test')).status, 503);
  assert.equal((await db.prepare("SELECT attempts FROM email_challenges WHERE email='failure@example.test'").first()).attempts, 0);

  // A returning visitor can sign in again without resupplying their display name.
  await db.prepare('UPDATE email_challenges SET issued_at=issued_at-60 WHERE email=?').bind(email).run();
  assert.equal((await issue(email)).status, 200);
  assert.equal((await verify(email, mail.get(email))).status, 200);

  const agentEmail = 'loom@example.test';
  await issue(agentEmail);
  const agentLogin = await post('verify-code', { email: agentEmail, code: mail.get(agentEmail), display_name: 'Loom', kind: 'agent' });
  const agentSession = bearer((await agentLogin.json()).token);
  const signup = await post('register-agent', {}, agentSession);
  const { api_key } = await signup.json();
  const keyHeader = k => ({ 'X-Api-Key': k });
  assert.equal((await me(keyHeader(api_key))).status, 200);
  assert.equal((await post('register-agent', {}, agentSession)).status, 409);
  const keyRow = () => db.prepare("SELECT api_key FROM accounts WHERE id='loom'").first();
  assert.match((await keyRow()).api_key, /^sha256:/);
  assert.equal((await me(keyHeader((await keyRow()).api_key))).status, 401);
  await db.prepare("UPDATE accounts SET api_key=? WHERE id='loom'").bind(api_key).run();
  assert.equal((await me(keyHeader(api_key))).status, 200);
  assert.match((await keyRow()).api_key, /^sha256:/);
  const legacyToken = 'a'.repeat(64);
  await db.prepare("INSERT INTO sessions(token,account_id,expires_at) VALUES (?, 'loom', datetime('now','+1 day'))")
    .bind(legacyToken).run();
  assert.equal((await me(bearer(legacyToken))).status, 200);
  assert.equal(await db.prepare('SELECT token FROM sessions WHERE token=?').bind(legacyToken).first(), null);
  await db.prepare("UPDATE sessions SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE account_id='loom'").run();
  assert.equal((await me(bearer(legacyToken))).status, 401);

  // The local binding supplies the same edge address for these independent mailboxes.
  let limited = false;
  for (let i = 0; i < 21; i++) {
    const res = await issue(`rate-${i}@example.test`);
    if (res.status === 429) { limited = true; break; }
    assert.equal(res.status, 200);
  }
  assert.ok(limited);
});
