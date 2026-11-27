import { Env } from './index';

interface Session {
  token: string;
  account_id: string;
  expires_at: string;
}

interface Account {
  id: string;
  display_name: string;
  kind: string;
  email: string | null;
  api_key: string | null;
}

export async function authenticate(request: Request, env: Env): Promise<Account | null> {
  const apiKey = request.headers.get('X-Api-Key');
  if (apiKey) {
    return env.DB.prepare('SELECT id, display_name, kind, email, api_key FROM accounts WHERE api_key = ?')
      .bind(apiKey).first<Account>();
  }

  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const session = await env.DB.prepare(
      `SELECT account_id FROM sessions WHERE token = ? AND expires_at > datetime('now')`
    ).bind(token).first<{ account_id: string }>();
    if (!session) return null;
    return env.DB.prepare('SELECT id, display_name, kind, email, api_key FROM accounts WHERE id = ?')
      .bind(session.account_id).first<Account>();
  }

  return null;
}

function generateCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function generateApiKey(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return 'cgx_' + Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function generateId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export async function requestCode(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await env.DB.prepare('DELETE FROM auth_codes WHERE email = ?').bind(email).run();
  await env.DB.prepare('INSERT INTO auth_codes (email, code, expires_at) VALUES (?, ?, ?)')
    .bind(email, code, expiresAt).run();

  console.log(`[AUTH] Code for ${email}: ${code} (expires ${expiresAt})`);

  return Response.json({ ok: true, message: 'Code sent. Check server logs until email delivery is wired up.' });
}

export async function verifyCode(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let body: { email?: string; code?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const code = body.code?.trim();
  if (!email || !code) {
    return Response.json({ error: 'email_and_code_required' }, { status: 400 });
  }

  const row = await env.DB.prepare(
    `SELECT rowid FROM auth_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')`
  ).bind(email, code).first<{ rowid: number }>();

  if (!row) {
    return Response.json({ error: 'invalid_or_expired_code' }, { status: 401 });
  }

  await env.DB.prepare('UPDATE auth_codes SET used = 1 WHERE rowid = ?').bind(row.rowid).run();

  let account = await env.DB.prepare('SELECT id, display_name, kind FROM accounts WHERE email = ?')
    .bind(email).first<{ id: string; display_name: string; kind: string }>();

  if (!account) {
    const displayName = body.display_name?.trim();
    if (!displayName) {
      return Response.json({ error: 'display_name_required_for_new_account' }, { status: 400 });
    }
    const id = generateId(displayName);
    const existing = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?').bind(id).first();
    if (existing) {
      return Response.json({ error: 'id_taken', suggested_id: id }, { status: 409 });
    }
    await env.DB.prepare(
      `INSERT INTO accounts (id, display_name, kind, email, created_at) VALUES (?, ?, 'human', ?, datetime('now'))`
    ).bind(id, displayName, email).run();
    await env.DB.prepare(
      `INSERT INTO profiles (account_id, updated_at) VALUES (?, datetime('now'))`
    ).bind(id).run();
    account = { id, display_name: displayName, kind: 'human' };
  }

  await env.DB.prepare(`UPDATE accounts SET last_seen_at = datetime('now') WHERE id = ?`)
    .bind(account.id).run();

  const token = generateToken();
  const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, account.id, sessionExpires).run();

  return Response.json({
    ok: true,
    token,
    expires_at: sessionExpires,
    account: { id: account.id, display_name: account.display_name, kind: account.kind },
  });
}

export async function registerAgent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let body: { id?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const displayName = body.display_name?.trim();
  if (!displayName) {
    return Response.json({ error: 'display_name_required' }, { status: 400 });
  }

  const id = body.id?.trim() || generateId(displayName);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return Response.json({ error: 'invalid_id', detail: 'Only letters, numbers, hyphens and underscores.' }, { status: 400 });
  }

  const existing = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?').bind(id).first();
  if (existing) {
    return Response.json({ error: 'id_taken' }, { status: 409 });
  }

  const apiKey = generateApiKey();
  await env.DB.prepare(
    `INSERT INTO accounts (id, display_name, kind, api_key, created_at) VALUES (?, ?, 'agent', ?, datetime('now'))`
  ).bind(id, displayName, apiKey).run();
  await env.DB.prepare(
    `INSERT INTO profiles (account_id, updated_at) VALUES (?, datetime('now'))`
  ).bind(id).run();

  return Response.json({
    ok: true,
    account: { id, display_name: displayName, kind: 'agent' },
    api_key: apiKey,
  }, { status: 201 });
}

export async function getMe(request: Request, env: Env): Promise<Response> {
  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({
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
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }

  return Response.json({ ok: true });
}
