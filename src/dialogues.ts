import { Env } from './index';
import { authenticate } from './auth';

function generateDialogueId(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return 'dlg-' + Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function generateMessageId(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return 'msg-' + Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

export async function proposeDialogue(request: Request, roomId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body: { partner_id: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.partner_id) {
    return Response.json({ error: 'partner_id required' }, { status: 400 });
  }

  if (body.partner_id === account.id) {
    return Response.json({ error: 'cannot_dialogue_with_self' }, { status: 400 });
  }

  const room = await env.DB.prepare('SELECT owner_id, visibility FROM rooms WHERE id = ?')
    .bind(roomId).first<{ owner_id: string; visibility: string }>();
  if (!room) return Response.json({ error: 'room_not_found' }, { status: 404 });

  // Both participants must have write access
  const proposerOk = await hasWriteAccess(roomId, account.id, room.owner_id, env);
  if (!proposerOk) return Response.json({ error: 'you_lack_write_access' }, { status: 403 });

  const partnerOk = await hasWriteAccess(roomId, body.partner_id, room.owner_id, env);
  if (!partnerOk) return Response.json({ error: 'partner_lacks_write_access' }, { status: 403 });

  const id = generateDialogueId();
  const title = body.title?.slice(0, 200) ?? null;

  await env.DB.prepare(
    `INSERT INTO dialogues (id, room_id, participant_a, participant_b, title, status, proposed_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'proposed', ?, datetime('now'))`
  ).bind(id, roomId, account.id, body.partner_id, title, account.id).run();

  return Response.json({
    ok: true,
    dialogue: { id, room_id: roomId, participant_a: account.id, participant_b: body.partner_id, title, status: 'proposed' },
  }, { status: 201 });
}

export async function acceptDialogue(request: Request, roomId: string, dialogueId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const dialogue = await env.DB.prepare(
    'SELECT * FROM dialogues WHERE id = ? AND room_id = ?'
  ).bind(dialogueId, roomId).first<{
    id: string; participant_a: string; participant_b: string; status: string; proposed_by: string;
  }>();

  if (!dialogue) return Response.json({ error: 'dialogue_not_found' }, { status: 404 });
  if (dialogue.status !== 'proposed') {
    return Response.json({ error: 'not_pending', status: dialogue.status }, { status: 409 });
  }

  // Only the partner (non-proposer) can accept
  const isPartner = (dialogue.proposed_by === dialogue.participant_a && account.id === dialogue.participant_b)
    || (dialogue.proposed_by === dialogue.participant_b && account.id === dialogue.participant_a);
  if (!isPartner) {
    return Response.json({ error: 'only_partner_can_accept' }, { status: 403 });
  }

  await env.DB.prepare(
    `UPDATE dialogues SET status = 'active', accepted_at = datetime('now') WHERE id = ?`
  ).bind(dialogueId).run();

  return Response.json({ ok: true, dialogue_id: dialogueId, status: 'active' });
}

export async function postMessage(request: Request, roomId: string, dialogueId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const dialogue = await env.DB.prepare(
    'SELECT * FROM dialogues WHERE id = ? AND room_id = ?'
  ).bind(dialogueId, roomId).first<{
    id: string; participant_a: string; participant_b: string; status: string;
  }>();

  if (!dialogue) return Response.json({ error: 'dialogue_not_found' }, { status: 404 });
  if (dialogue.status !== 'active') {
    return Response.json({ error: 'dialogue_not_active', status: dialogue.status }, { status: 409 });
  }

  if (account.id !== dialogue.participant_a && account.id !== dialogue.participant_b) {
    return Response.json({ error: 'not_a_participant' }, { status: 403 });
  }

  let body: { body: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const text = body.body?.trim();
  if (!text || text.length > 10000) {
    return Response.json({ error: 'body required (max 10000 chars)' }, { status: 400 });
  }

  const id = generateMessageId();
  await env.DB.prepare(
    `INSERT INTO dialogue_messages (id, dialogue_id, author_id, body, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(id, dialogueId, account.id, text).run();

  return Response.json({
    ok: true,
    message: { id, dialogue_id: dialogueId, author_id: account.id, body: text },
  }, { status: 201 });
}

export async function closeDialogue(request: Request, roomId: string, dialogueId: string, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const account = await authenticate(request, env);
  if (!account) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const dialogue = await env.DB.prepare(
    'SELECT participant_a, participant_b, status FROM dialogues WHERE id = ? AND room_id = ?'
  ).bind(dialogueId, roomId).first<{ participant_a: string; participant_b: string; status: string }>();

  if (!dialogue) return Response.json({ error: 'dialogue_not_found' }, { status: 404 });

  // Either participant or the room owner can close
  const room = await env.DB.prepare('SELECT owner_id FROM rooms WHERE id = ?').bind(roomId).first<{ owner_id: string }>();
  const canClose = account.id === dialogue.participant_a
    || account.id === dialogue.participant_b
    || (room && account.id === room.owner_id);

  if (!canClose) return Response.json({ error: 'not_authorized_to_close' }, { status: 403 });

  await env.DB.prepare(
    `UPDATE dialogues SET status = 'closed', closed_at = datetime('now') WHERE id = ?`
  ).bind(dialogueId).run();

  return Response.json({ ok: true, dialogue_id: dialogueId, status: 'closed' });
}

export async function listDialogues(roomId: string, env: Env): Promise<Response> {
  const room = await env.DB.prepare('SELECT id, title FROM rooms WHERE id = ?')
    .bind(roomId).first<{ id: string; title: string }>();
  if (!room) return Response.json({ error: 'room_not_found' }, { status: 404 });

  const rows = await env.DB.prepare(`
    SELECT d.id, d.title, d.status, d.created_at, d.accepted_at, d.closed_at,
           a1.display_name as participant_a_name, a1.id as participant_a,
           a2.display_name as participant_b_name, a2.id as participant_b,
           (SELECT COUNT(*) FROM dialogue_messages WHERE dialogue_id = d.id) as message_count
    FROM dialogues d
    JOIN accounts a1 ON d.participant_a = a1.id
    JOIN accounts a2 ON d.participant_b = a2.id
    WHERE d.room_id = ?
    ORDER BY d.created_at DESC
  `).bind(roomId).all();

  return Response.json({ room_id: roomId, dialogues: rows.results });
}

export async function getDialogue(roomId: string, dialogueId: string, env: Env): Promise<Response> {
  const dialogue = await env.DB.prepare(`
    SELECT d.*, a1.display_name as participant_a_name, a2.display_name as participant_b_name
    FROM dialogues d
    JOIN accounts a1 ON d.participant_a = a1.id
    JOIN accounts a2 ON d.participant_b = a2.id
    WHERE d.id = ? AND d.room_id = ?
  `).bind(dialogueId, roomId).first();

  if (!dialogue) return Response.json({ error: 'dialogue_not_found' }, { status: 404 });

  const messages = await env.DB.prepare(`
    SELECT dm.id, dm.author_id, a.display_name as author_name, dm.body, dm.created_at
    FROM dialogue_messages dm
    JOIN accounts a ON dm.author_id = a.id
    WHERE dm.dialogue_id = ?
    ORDER BY dm.created_at ASC
  `).bind(dialogueId).all();

  return Response.json({ dialogue, messages: messages.results });
}

export async function getDialogueText(roomId: string, dialogueId: string, env: Env): Promise<Response> {
  const dialogue = await env.DB.prepare(`
    SELECT d.*, a1.display_name as participant_a_name, a2.display_name as participant_b_name
    FROM dialogues d
    JOIN accounts a1 ON d.participant_a = a1.id
    JOIN accounts a2 ON d.participant_b = a2.id
    WHERE d.id = ? AND d.room_id = ?
  `).bind(dialogueId, roomId).first<{
    id: string; title: string | null; status: string;
    participant_a: string; participant_b: string;
    participant_a_name: string; participant_b_name: string;
    created_at: string;
  }>();

  if (!dialogue) return new Response('Dialogue not found', { status: 404 });

  const messages = await env.DB.prepare(`
    SELECT dm.id, dm.author_id, a.display_name as author_name, dm.body, dm.created_at
    FROM dialogue_messages dm
    JOIN accounts a ON dm.author_id = a.id
    WHERE dm.dialogue_id = ?
    ORDER BY dm.created_at ASC
  `).bind(dialogueId).all<{
    id: string; author_id: string; author_name: string; body: string; created_at: string;
  }>();

  const lines: string[] = [];
  lines.push(`# ${dialogue.title || 'Untitled dialogue'}`);
  lines.push(`Between: ${dialogue.participant_a_name} and ${dialogue.participant_b_name}`);
  lines.push(`Room: /rooms/${roomId}`);
  lines.push(`Status: ${dialogue.status}`);
  lines.push(`Started: ${dialogue.created_at}`);
  lines.push('');

  for (const msg of messages.results) {
    lines.push(`## ${msg.author_name} (${msg.created_at})`);
    lines.push(`Message: /rooms/${roomId}/dialogues/${dialogueId}/messages/${msg.id}`);
    lines.push('');
    lines.push(msg.body);
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function hasWriteAccess(roomId: string, accountId: string, ownerId: string, env: Env): Promise<boolean> {
  if (accountId === ownerId) return true;
  const p = await env.DB.prepare(
    'SELECT role, accepted_at FROM room_participants WHERE room_id = ? AND account_id = ?'
  ).bind(roomId, accountId).first<{ role: string; accepted_at: string | null }>();
  return !!(p && p.accepted_at && p.role === 'writer');
}
