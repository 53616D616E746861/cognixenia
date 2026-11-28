import type { Env } from './index';
import { authenticate, json, mailbox, readBody, withinIpLimit } from './auth';

const memberCap = 3;
const acknowledgement = { ok: true, message: 'Your request has been received. If approved, you can sign in with this email address.' };
const invitation = { ok: true, message: 'Eligible recipients will receive an email. You can also share the /join page directly.' };

export async function requestAccess(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  const email = mailbox(body.email);
  const note = body.note ?? '';
  if (!email || typeof note !== 'string' || note.length > 500) return json({ error: 'invalid_email_or_note' }, 400);
  if (!env.AUTH_CODE_SECRET || env.AUTH_CODE_SECRET.length < 32) return json({ error: 'admission_unavailable' }, 503);
  if (!await withinIpLimit(request, env, 'signup-request', 6)) return json({ error: 'rate_limited' }, 429);

  const [capacity] = await env.DB.batch<Record<string, number>>([
    env.DB.prepare("SELECT count(*) AS pending FROM signup_applications WHERE state='pending'"),
    env.DB.prepare(`INSERT INTO signup_applications(email,note,state)
      SELECT ?,?, 'pending' WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email=?)
      AND (SELECT count(*) FROM signup_applications WHERE state='pending') < 1000
      ON CONFLICT(email) DO NOTHING`).bind(email, note.trim(), email),
  ]);
  if (Number(capacity.results[0].pending) >= 1000) return json({ error: 'review_queue_full' }, 503);
  return json(acknowledgement, 202);
}

export async function inviteMember(request: Request, env: Env): Promise<Response> {
  const member = await authenticate(request, env);
  if (!member) return json({ error: 'unauthorized' }, 401);
  const body = await readBody(request);
  const email = mailbox(body?.email);
  if (!email) return json({ error: 'invalid_email' }, 400);
  const quota = "SELECT count(*) FROM signup_applications WHERE decided_by=? AND member_invite=1 AND decided_at>unixepoch()-86400";
  const [count, grant] = await env.DB.batch<Record<string, number>>([
    env.DB.prepare('SELECT (' + quota + ') AS used').bind(member.id),
    env.DB.prepare(`INSERT INTO signup_applications(email,state,decided_by,decided_at,member_invite,next_notice_at)
      SELECT ?, 'approved', ?, unixepoch(), 1, unixepoch()
      WHERE (${quota}) < ? AND NOT EXISTS (SELECT 1 FROM accounts WHERE email=?)
      ON CONFLICT(email) DO UPDATE SET state='approved', decided_by=excluded.decided_by,
        decided_at=excluded.decided_at, member_invite=1, next_notice_at=excluded.next_notice_at
      WHERE signup_applications.state='pending' RETURNING id`).bind(email, member.id, member.id, memberCap, email),
  ]);
  if (Number(count.results[0].used) >= memberCap) return json({ error: 'daily_invite_limit', limit: memberCap }, 429);
  if (grant.results.length) await deliverNotice(env, Number(grant.results[0].id));
  return json(invitation, 202);
}

function isAdmin(email: string | null, env: Env): boolean {
  return !!email && (env.SIGNUP_ADMIN_EMAILS ?? '').split(',').some(item => item.trim().toLowerCase() === email);
}

export async function reviewAdmissions(request: Request, env: Env, id?: number, decision?: string): Promise<Response> {
  const admin = await authenticate(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);
  if (!isAdmin(admin.email, env)) return json({ error: 'forbidden' }, 403);
  if (id === undefined) {
    const rows = await env.DB.prepare("SELECT id,email,note,created_at FROM signup_applications WHERE state='pending' ORDER BY id LIMIT 100").all();
    return json({ requests: rows.results });
  }
  const approve = decision === 'approve';
  const change = await env.DB.prepare(`UPDATE signup_applications SET state=?, decided_by=?, decided_at=unixepoch(),
    next_notice_at=CASE WHEN ? THEN unixepoch() ELSE NULL END WHERE id=? AND state='pending' RETURNING id`)
    .bind(approve ? 'approved' : 'declined', admin.id, Number(approve), id).first();
  if (!change) return json({ error: 'request_no_longer_pending' }, 409);
  if (approve) await deliverNotice(env, id);
  return json({ ok: true });
}

// The approval itself is durable before sending. A short lease protects overlapping sends.
async function deliverNotice(env: Env, id: number): Promise<void> {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return;
  const grant = await env.DB.prepare(`UPDATE signup_applications SET notice_attempts=notice_attempts+1,
    next_notice_at=CASE WHEN notice_attempts>=4 THEN NULL ELSE unixepoch()+600 END WHERE id=? AND state='approved' AND notice_attempts<5 AND next_notice_at<=unixepoch()
    RETURNING email, notice_attempts`).bind(id).first<{email: string; notice_attempts: number}>();
  if (!grant) return;
  let sent = false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json',
        'Idempotency-Key': 'cognixenia-admission-' + env.ENVIRONMENT + '-' + id },
      body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [grant.email], subject: 'You can join Cognixenia',
        text: 'Your invitation to Cognixenia is ready. Visit https://cognixenia.com/join and sign in with this email address to create your profile.' }),
    });
    sent = res.ok;
  } catch { /* A later scheduled delivery can retry. */ }
  // Retry transient failures, with a ceiling on the number of sends per grant.
  const next = sent || grant.notice_attempts >= 5 ? null : Math.floor(Date.now()/1000) + 600 * grant.notice_attempts;
  await env.DB.prepare("UPDATE signup_applications SET next_notice_at=? WHERE id=? AND state='approved' AND notice_attempts=?")
    .bind(next, id, grant.notice_attempts).run();
}

export async function retryNotices(env: Env): Promise<void> {
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return;
  const { results } = await env.DB.prepare("SELECT id FROM signup_applications WHERE state='approved' AND next_notice_at<=unixepoch() ORDER BY next_notice_at LIMIT 10").all<{id: number}>();
  for (const row of results) await deliverNotice(env, row.id);
}
