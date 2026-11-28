import type { Env } from './index';

interface Account {
  id: string;
  display_name: string;
  kind: string;
  email: string | null;
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(size: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(size)).buffer);
}

async function digestToken(token: string): Promise<string> {
  return 'sha256:' + hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

async function keyedDigest(secret: string, ...parts: string[]): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(parts))));
}

export async function authenticate(request: Request, env: Env): Promise<Account | null> {
  const apiKey = request.headers.get('X-Api-Key');
  const token = apiKey ?? request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token || !(apiKey ? /^cgx_[a-f0-9]{48}$/ : /^[a-f0-9]{64}$/).test(token)) return null;
  const digest = await digestToken(token);
  const lookup = env.DB.prepare(apiKey
    ? 'SELECT id, display_name, kind, email FROM accounts WHERE api_key = ?'
    : `SELECT a.id, a.display_name, a.kind, a.email FROM accounts a JOIN sessions s ON s.account_id = a.id
       WHERE s.token = ? AND unixepoch(s.expires_at) > unixepoch()`).bind(digest);
  const account = await lookup.first<Account>();
  if (account) return account;
  // Lazily upgrade pre-release credentials. Concurrent upgrades converge on the same digest.
  await env.DB.prepare(apiKey
    ? 'UPDATE accounts SET api_key = ? WHERE api_key = ?'
    : 'UPDATE sessions SET token = ? WHERE token = ? AND unixepoch(expires_at) > unixepoch()')
    .bind(digest, token).run();
  return lookup.first<Account>();
}

function generateCode(): string {
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= 4294000000);
  return String(sample[0] % 1000000).padStart(6, '0');
}

function generateId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function unavailable(): Response {
  return json({ error: 'email_login_unavailable' }, 503);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}

function mailbox(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@,;<>:"\\]+@[^\s@,;<>:"\\]+\.[^\s@,;<>:"\\]+$/.test(email)
    && !/[\x00-\x1f\x7f]/.test(email) ? email : null;
}

async function withinIpLimit(request: Request, env: Env, operation: string, maximum: number): Promise<boolean> {
  // Cloudflare supplies this header. Outside its edge, missing addresses share one bucket.
  const bucket = await keyedDigest(env.AUTH_CODE_SECRET!, operation, request.headers.get('CF-Connecting-IP') ?? 'unknown');
  const row = await env.DB.prepare(`INSERT INTO auth_limits VALUES (?, unixepoch(), 1)
    ON CONFLICT(bucket) DO UPDATE SET
      hits = CASE WHEN window_start <= unixepoch()-600 THEN 1 ELSE hits+1 END,
      window_start = CASE WHEN window_start <= unixepoch()-600 THEN unixepoch() ELSE window_start END
    WHERE hits < ? OR window_start <= unixepoch()-600 RETURNING hits`).bind(bucket, maximum).first();
  return !!row;
}

export async function requestCode(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  if (!env.AUTH_CODE_SECRET || env.AUTH_CODE_SECRET.length < 32 || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return unavailable();
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const email = mailbox(body.email);
  if (!email) return json({ error: 'invalid_email' }, 400);
  if (!await withinIpLimit(request, env, 'send', 20)) return json({ error: 'rate_limited' }, 429);

  const code = generateCode();
  const digest = await keyedDigest(env.AUTH_CODE_SECRET, 'email-code', email, code);
  const [, , issuance] = await env.DB.batch<{ issued_at: number }>([
    env.DB.prepare('DELETE FROM auth_limits WHERE window_start <= unixepoch()-600'),
    env.DB.prepare('DELETE FROM email_challenges WHERE window_start <= unixepoch()-4200'),
    env.DB.prepare(`INSERT INTO email_challenges(email,digest,issued_at,expires_at,attempts,window_start,sent_count)
      VALUES (?, ?, unixepoch(), unixepoch()+600, 5, unixepoch(), 1)
      ON CONFLICT(email) DO UPDATE SET digest=excluded.digest, issued_at=excluded.issued_at,
        expires_at=excluded.expires_at, attempts=5, claim=NULL,
        sent_count=CASE WHEN window_start <= unixepoch()-3600 THEN 1 ELSE sent_count+1 END,
        window_start=CASE WHEN window_start <= unixepoch()-3600 THEN unixepoch() ELSE window_start END
      WHERE issued_at <= unixepoch()-60 AND (sent_count < 5 OR window_start <= unixepoch()-3600) RETURNING issued_at`).bind(email, digest),
  ]);
  if (!issuance.results.length) return json({ error: 'rate_limited' }, 429);

  let delivered = false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'manual',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [email], subject: 'Your Cognixenia sign-in code',
        text: `Your Cognixenia sign-in code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.` }),
    });
    delivered = response.ok;
  } catch { /* Transport and provider failures use the same public response. */ }
  if (!delivered) {
    await env.DB.prepare('UPDATE email_challenges SET attempts=0 WHERE email=? AND digest=? AND issued_at=?')
      .bind(email, digest, issuance.results[0].issued_at).run();
    return unavailable();
  }
  return json({ ok: true, message: 'Check your email for your sign-in code.' });
}

export async function verifyCode(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  if (!env.AUTH_CODE_SECRET || env.AUTH_CODE_SECRET.length < 32) return unavailable();
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const email = mailbox(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) return json({ error: 'email_and_code_required' }, 400);
  if (!await withinIpLimit(request, env, 'verify', 60)) return json({ error: 'rate_limited' }, 429);
  const digest = await keyedDigest(env.AUTH_CODE_SECRET, 'email-code', email, code);
  const invalid = () => json({ error: 'invalid_or_expired_code' }, 401);
  const active = 'email=? AND attempts>0 AND claim IS NULL AND expires_at>unixepoch()';
  const [, challenge] = await env.DB.batch([
    env.DB.prepare(`UPDATE email_challenges SET attempts=attempts-1 WHERE ${active} AND digest<>?`).bind(email, digest),
    env.DB.prepare(`SELECT email FROM email_challenges WHERE ${active} AND digest=?`).bind(email, digest),
  ]);
  if (!challenge.results.length) return invalid();

  const existing = await env.DB.prepare('SELECT id FROM accounts WHERE email=?').bind(email).first();
  const name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const id = generateId(name);
  if (!existing && (!id || name.length > 100)) return json({ error: 'display_name_required_for_new_account' }, 400);
  const token = randomHex(32);
  const claim = await digestToken(token);
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  const claimed = 'EXISTS (SELECT 1 FROM email_challenges WHERE email=? AND claim=?)';
  // One D1 transaction claims the challenge, creates the account if needed, and issues the session.
  // Each dependent write is guarded by this invocation's unique claim, including on a concurrent retry.
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE email_challenges SET claim=? WHERE ${active} AND digest=?
      AND (EXISTS (SELECT 1 FROM accounts WHERE email=?) OR NOT EXISTS (SELECT 1 FROM accounts WHERE id=?))`)
      .bind(claim, email, digest, email, id),
    env.DB.prepare(`INSERT INTO accounts(id, display_name, kind, email)
      SELECT ?, ?, 'human', ? WHERE ${claimed} AND NOT EXISTS (SELECT 1 FROM accounts WHERE email=?)`)
      .bind(id, name, email, email, claim, email),
    env.DB.prepare(`INSERT INTO profiles(account_id) SELECT id FROM accounts WHERE email=? AND ${claimed}
      ON CONFLICT(account_id) DO NOTHING`).bind(email, email, claim),
    env.DB.prepare(`UPDATE accounts SET last_seen_at=datetime('now') WHERE email=? AND ${claimed}`).bind(email, email, claim),
    env.DB.prepare(`INSERT INTO sessions(token,account_id,expires_at) SELECT ?,id,? FROM accounts WHERE email=? AND ${claimed}`)
      .bind(claim, expires, email, email, claim),
    env.DB.prepare(`SELECT id, display_name, kind FROM accounts WHERE email=? AND ${claimed}`).bind(email, email, claim),
  ]);
  const account = results[5].results[0];
  if (!account) {
    if (!existing && await env.DB.prepare(`SELECT 1 FROM email_challenges WHERE ${active} AND digest=?`).bind(email, digest).first()) {
      return json({ error: 'id_taken', suggested_id: id }, 409);
    }
    return invalid();
  }
  return json({ ok: true, token, expires_at: expires, account });
}

export async function registerAgent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (!displayName || displayName.length > 100) return json({ error: 'display_name_required' }, 400);
  if (body.id != null && typeof body.id !== 'string') return json({ error: 'invalid_id' }, 400);
  const id = body.id?.trim() || generateId(displayName);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return json({ error: 'invalid_id' }, 400);

  const apiKey = 'cgx_' + randomHex(24);
  const digest = await digestToken(apiKey);
  const [insert] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO accounts(id, display_name, kind, api_key) VALUES (?, ?, 'agent', ?)
      ON CONFLICT(id) DO NOTHING`).bind(id, displayName, digest),
    env.DB.prepare('INSERT INTO profiles(account_id) SELECT id FROM accounts WHERE id=? AND api_key=?')
      .bind(id, digest),
  ]);
  if (!insert.meta.changes) return json({ error: 'id_taken' }, 409);
  return json({ ok: true, account: { id, display_name: displayName, kind: 'agent' }, api_key: apiKey }, 201);
}

export async function getMe(request: Request, env: Env): Promise<Response> {
  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return json({
    id: account.id,
    display_name: account.display_name,
    kind: account.kind,
    email: account.email,
  });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    if (/^[a-f0-9]{64}$/.test(token)) {
      await env.DB.prepare('DELETE FROM sessions WHERE token IN (?, ?)').bind(await digestToken(token), token).run();
    }
  }

  return Response.json({ ok: true });
}
