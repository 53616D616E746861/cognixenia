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
