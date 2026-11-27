import { Env } from './index';
import { authenticate } from './auth';

interface RoomCreate {
  id?: string;
  title?: string;
  summary?: string;
  visibility?: string;
  max_participants?: number | null;
}

interface PinCreate {
  entry_id?: string;
  note?: string;
}

function generateRoomId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export async function createRoom(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: RoomCreate;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title || title.length > 200) {
    return Response.json({ error: 'title required (max 200 chars)' }, { status: 400 });
  }

  const id = body.id?.trim() || generateRoomId(title);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 48) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }

  const visibility = body.visibility || 'open';
  if (!['open', 'closed', 'unlisted'].includes(visibility)) {
    return Response.json({ error: 'visibility must be open, closed, or unlisted' }, { status: 400 });
  }

  const existing = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(id).first();
  if (existing) {
    return Response.json({ error: 'id_taken' }, { status: 409 });
  }

  const summary = body.summary?.slice(0, 2000) ?? null;
  const maxP = typeof body.max_participants === 'number' && body.max_participants > 0
    ? body.max_participants : null;

  await env.DB.prepare(
    `INSERT INTO rooms (id, owner_id, title, summary, visibility, max_participants, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, account.id, title, summary, visibility, maxP).run();

  return Response.json({
    ok: true,
    room: { id, owner_id: account.id, title, summary, visibility, max_participants: maxP },
  }, { status: 201 });
}

export async function updateRoom(request: Request, roomId: string, env: Env): Promise<Response> {
  if (request.method !== 'PATCH' && request.method !== 'PUT') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'PATCH, PUT' } });
  }

  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string }>();
  if (!room) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (room.owner_id !== account.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: RoomCreate;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | null)[] = [];

  if ('title' in body) {
    const title = body.title?.trim();
    if (!title || title.length > 200) {
      return Response.json({ error: 'title required (max 200 chars)' }, { status: 400 });
    }
    sets.push('title = ?');
    values.push(title);
  }

  if ('summary' in body) {
    sets.push('summary = ?');
    values.push(body.summary?.slice(0, 2000) ?? null);
  }

  if ('visibility' in body) {
    if (!body.visibility || !['open', 'closed', 'unlisted'].includes(body.visibility)) {
      return Response.json({ error: 'visibility must be open, closed, or unlisted' }, { status: 400 });
    }
    sets.push('visibility = ?');
    values.push(body.visibility);
  }

  if ('max_participants' in body) {
    const maxP = typeof body.max_participants === 'number' && body.max_participants > 0
      ? body.max_participants : null;
    sets.push('max_participants = ?');
    values.push(maxP as unknown as string);
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    values.push(roomId);
    await env.DB.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values).run();
  }

  const updated = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?')
    .bind(roomId).first();
  return Response.json({ ok: true, room: updated });
}

export async function addPin(request: Request, roomId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string }>();
  if (!room) {
    return Response.json({ error: 'room_not_found' }, { status: 404 });
  }
  if (room.owner_id !== account.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: PinCreate;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const entryId = body.entry_id?.trim();
  if (!entryId) {
    return Response.json({ error: 'entry_id required' }, { status: 400 });
  }

  const note = body.note?.slice(0, 2000) ?? null;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO room_pins (room_id, entry_id, note, pinned_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).bind(roomId, entryId, note).run();

  return Response.json({ ok: true, pin: { room_id: roomId, entry_id: entryId, note } }, { status: 201 });
}

export async function removePin(request: Request, roomId: string, entryId: string, env: Env): Promise<Response> {
  if (request.method !== 'DELETE') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'DELETE' } });
  }

  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string }>();
  if (!room) {
    return Response.json({ error: 'room_not_found' }, { status: 404 });
  }
  if (room.owner_id !== account.id) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await env.DB.prepare('DELETE FROM room_pins WHERE room_id = ? AND entry_id = ?')
    .bind(roomId, entryId).run();

  if (!result.meta.changes) {
    return Response.json({ error: 'pin_not_found' }, { status: 404 });
  }

  return Response.json({ ok: true });
}

export async function listPins(roomId: string, env: Env): Promise<Response> {
  const room = await env.DB.prepare('SELECT id, owner_id, title, visibility FROM rooms WHERE id = ?')
    .bind(roomId).first<{ id: string; owner_id: string; title: string; visibility: string }>();
  if (!room) {
    return Response.json({ error: 'room_not_found' }, { status: 404 });
  }

  const pins = await env.DB.prepare(
    'SELECT entry_id, note, pinned_at FROM room_pins WHERE room_id = ? ORDER BY pinned_at DESC'
  ).bind(roomId).all<{ entry_id: string; note: string | null; pinned_at: string }>();

  return Response.json({
    room_id: room.id,
    owner_id: room.owner_id,
    title: room.title,
    pins: pins.results,
  });
}
