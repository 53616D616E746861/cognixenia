import { Env } from './index';
import { authenticate } from './auth';

type Role = 'writer' | 'reader';

export async function inviteParticipant(request: Request, roomId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const room = await env.DB.prepare('SELECT owner_id, max_participants FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string; max_participants: number | null }>();
  if (!room) return Response.json({ error: 'room_not_found' }, { status: 404 });
  if (room.owner_id !== account.id) return Response.json({ error: 'not_owner' }, { status: 403 });

  let body: { account_id: string; role?: Role };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.account_id) {
    return Response.json({ error: 'account_id required' }, { status: 400 });
  }

  const role: Role = body.role === 'reader' ? 'reader' : 'writer';

  const target = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?')
    .bind(body.account_id).first();
  if (!target) return Response.json({ error: 'account_not_found' }, { status: 404 });

  if (body.account_id === account.id) {
    return Response.json({ error: 'cannot_invite_self' }, { status: 400 });
  }

  if (room.max_participants !== null) {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) as n FROM room_participants WHERE room_id = ?'
    ).bind(roomId).first<{ n: number }>();
    if (count && count.n >= room.max_participants) {
      return Response.json({ error: 'room_full', max_participants: room.max_participants }, { status: 409 });
    }
  }

  await env.DB.prepare(
    `INSERT INTO room_participants (room_id, account_id, role, invited_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (room_id, account_id) DO UPDATE SET role = excluded.role`
  ).bind(roomId, body.account_id, role, account.id).run();

  return Response.json({ ok: true, room_id: roomId, account_id: body.account_id, role });
}

export async function acceptInvite(request: Request, roomId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const participant = await env.DB.prepare(
    'SELECT role, accepted_at FROM room_participants WHERE room_id = ? AND account_id = ?'
  ).bind(roomId, account.id).first<{ role: string; accepted_at: string | null }>();

  if (!participant) {
    return Response.json({ error: 'not_invited' }, { status: 403 });
  }

  if (participant.accepted_at) {
    return Response.json({ ok: true, already_accepted: true, role: participant.role });
  }

  await env.DB.prepare(
    `UPDATE room_participants SET accepted_at = datetime('now') WHERE room_id = ? AND account_id = ?`
  ).bind(roomId, account.id).run();

  return Response.json({ ok: true, role: participant.role });
}

export async function leaveRoom(request: Request, roomId: string, env: Env): Promise<Response> {
  if (request.method !== 'DELETE' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'DELETE, POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  await env.DB.prepare(
    'DELETE FROM room_participants WHERE room_id = ? AND account_id = ?'
  ).bind(roomId, account.id).run();

  return Response.json({ ok: true });
}

export async function removeParticipant(request: Request, roomId: string, accountId: string, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'DELETE' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string }>();
  if (!room) return Response.json({ error: 'room_not_found' }, { status: 404 });
  if (room.owner_id !== account.id) return Response.json({ error: 'not_owner' }, { status: 403 });

  await env.DB.prepare(
    'DELETE FROM room_participants WHERE room_id = ? AND account_id = ?'
  ).bind(roomId, accountId).run();

  return Response.json({ ok: true });
}

export async function listParticipants(request: Request, roomId: string, env: Env): Promise<Response> {
  const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string }>();
  if (!room) return Response.json({ error: 'room_not_found' }, { status: 404 });

  const owner = await env.DB.prepare('SELECT id, display_name, kind FROM accounts WHERE id = ?')
    .bind(room.owner_id).first<{ id: string; display_name: string; kind: string }>();

  const rows = await env.DB.prepare(`
    SELECT rp.account_id, rp.role, rp.invited_at, rp.accepted_at,
           a.display_name, a.kind
    FROM room_participants rp
    JOIN accounts a ON rp.account_id = a.id
    WHERE rp.room_id = ?
    ORDER BY rp.invited_at
  `).bind(roomId).all<{
    account_id: string; role: string; invited_at: string; accepted_at: string | null;
    display_name: string; kind: string;
  }>();

  const participants = [
    { account_id: owner!.id, display_name: owner!.display_name, kind: owner!.kind, role: 'owner' },
    ...rows.results.map(r => ({
      account_id: r.account_id,
      display_name: r.display_name,
      kind: r.kind,
      role: r.role,
      invited_at: r.invited_at,
      accepted: !!r.accepted_at,
    })),
  ];

  return Response.json({ room_id: roomId, participants });
}

export async function getRoomAccess(roomId: string, accountId: string | null, env: Env): Promise<{
  can_read: boolean;
  can_write: boolean;
  role: 'owner' | 'writer' | 'reader' | 'visitor';
}> {
  const room = await env.DB.prepare('SELECT owner_id, visibility FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string; visibility: string }>();

  if (!room) return { can_read: false, can_write: false, role: 'visitor' };

  if (accountId === room.owner_id) {
    return { can_read: true, can_write: true, role: 'owner' };
  }

  if (accountId) {
    const participant = await env.DB.prepare(
      'SELECT role, accepted_at FROM room_participants WHERE room_id = ? AND account_id = ?'
    ).bind(roomId, accountId).first<{ role: string; accepted_at: string | null }>();

    if (participant && participant.accepted_at) {
      return {
        can_read: true,
        can_write: participant.role === 'writer',
        role: participant.role as 'writer' | 'reader',
      };
    }
  }

  if (room.visibility === 'open') {
    return { can_read: true, can_write: false, role: 'visitor' };
  }

  if (room.visibility === 'unlisted') {
    return { can_read: true, can_write: false, role: 'visitor' };
  }

  // closed: summary always visible, content restricted
  return { can_read: false, can_write: false, role: 'visitor' };
}

export async function myAccess(request: Request, roomId: string, env: Env): Promise<Response> {
  const account = await authenticate(request, env);
  const access = await getRoomAccess(roomId, account?.id ?? null, env);

  const room = await env.DB.prepare('SELECT title, visibility FROM rooms WHERE id = ?')
    .bind(roomId).first<{ title: string; visibility: string }>();
  if (!room) return Response.json({ error: 'room_not_found' }, { status: 404 });

  return Response.json({
    room_id: roomId,
    room_title: room.title,
    visibility: room.visibility,
    authenticated: !!account,
    ...access,
    actions: {
      read_summary: true,
      read_content: access.can_read,
      write: access.can_write,
      manage: access.role === 'owner',
      join: access.role === 'visitor' && room.visibility === 'open',
    },
  });
}
