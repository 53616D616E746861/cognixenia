import { escapeHtml } from './markdown';
import { htmlPage } from './templates';

interface PublicRoom {
  title: string;
  summary: string | null;
  owner_id: string;
  display_name: string;
}

export async function roomSummary(db: D1Database, id: string, format: 'html' | 'text'): Promise<Response> {
  // The door is public even for closed rooms. Its query only selects public metadata.
  const room = await db.prepare(`
    SELECT rooms.title, rooms.summary, rooms.owner_id, accounts.display_name
    FROM rooms JOIN accounts ON accounts.id = rooms.owner_id
    WHERE rooms.id = ?
  `).bind(id).first<PublicRoom>();

  if (!room) {
    return new Response('Room not found', { status: 404 });
  }

  const summary = room.summary?.trim() || 'The host has not added a summary yet.';
  const ownerId = encodeURIComponent(room.owner_id);
  const roomPath = `/rooms/${encodeURIComponent(id)}`;
  if (format === 'text') {
    const text = [
      room.title,
      `Host: ${room.display_name}`,
      '',
      summary,
      '',
      `Host profile: /api/profiles/${ownerId}`,
      `Browser view: ${roomPath}`,
    ].join('\n');
    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const title = escapeHtml(room.title);
  const body = `<main>
    <h1>${title}</h1>
    <p>Hosted by <a href="/u/${ownerId}">${escapeHtml(room.display_name)}</a></p>
    <p style="white-space: pre-line">${escapeHtml(summary)}</p>
    <p><a href="${roomPath}.txt" type="text/plain">Plain text</a></p>
  </main>`;
  return new Response(htmlPage(`${title} — Cognixenia`, body, 'room'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

interface ListedRoom {
  id: string;
  title: string;
  visibility: 'open' | 'closed';
}

export async function profileRooms(
  db: D1Database, ownerId: string, after: string, format: 'html' | 'text',
): Promise<Response> {
  const host = await db.prepare('SELECT display_name FROM accounts WHERE id = ?')
    .bind(ownerId).first<{ display_name: string }>();
  if (!host) return new Response('Profile not found', { status: 404 });

  // Closed rooms have public doors. Unlisted rooms are only reachable by direct link.
  const pageSize = 20;
  const { results } = await db.prepare(`
    SELECT id, title, visibility FROM rooms
    WHERE owner_id = ? AND visibility IN ('open', 'closed') AND id > ?
    ORDER BY id LIMIT ?
  `).bind(ownerId, after, pageSize + 1).all<ListedRoom>();
  const rooms = results.slice(0, pageSize);
  const base = `/u/${encodeURIComponent(ownerId)}/rooms`;
  const listPath = format === 'text' ? base + '.txt' : base;
  const next = results.length > pageSize
    ? `${listPath}?after=${encodeURIComponent(rooms[pageSize - 1].id)}`
    : null;
  const title = `Rooms hosted by ${host.display_name}`;
  const empty = after ? 'No more listed rooms.' : 'No listed rooms yet.';

  if (format === 'text') {
    const lines = rooms.map(room =>
      `${room.title} (${room.visibility})\n/rooms/${encodeURIComponent(room.id)}.txt`);
    return new Response([
      title, lines.join('\n\n') || empty,
      ...(next ? [`Next page: ${next}`] : []),
      `Host profile: /api/profiles/${encodeURIComponent(ownerId)}`,
    ].join('\n\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const items = rooms.map(room =>
    `<li><a href="/rooms/${encodeURIComponent(room.id)}">${escapeHtml(room.title)}</a> (${room.visibility})</li>`);
  const body = [
    `<main><h1>${escapeHtml(title)}</h1>`,
    items.length ? `<ul>${items.join('')}</ul>` : `<p>${empty}</p>`,
    next ? `<p><a rel="next" href="${next}">Next page</a></p>` : '',
    `<p><a href="/u/${encodeURIComponent(ownerId)}">Host profile</a></p></main>`,
  ].join('\n');
  return new Response(htmlPage(escapeHtml(title), body, 'rooms'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
