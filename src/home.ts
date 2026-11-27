import { escapeHtml } from './markdown';
import { htmlPage } from './templates';

interface RecentRoom {
  id: string;
  title: string;
  summary: string | null;
  owner_id: string;
  host: string;
  active_at: string;
  activity: string;
}

const pageSize = 3;

export async function home(request: Request, db: D1Database, plain: boolean): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const headers = { 'Content-Type': plain ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' };
  if (request.method === 'HEAD') return new Response(null, { headers });

  const params = new URL(request.url).searchParams;
  const before = params.get('before');
  const after = params.get('after');
  if ((before === null) !== (after === null) ||
      (before !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(before)) ||
      (after !== null && !/^[a-zA-Z0-9_-]+$/.test(after))) {
    return new Response('Invalid room list cursor', { status: 400 });
  }

  // Only open rooms contribute events. Join timestamps without reading notes or message bodies.
  const { results } = await db.prepare(`
    WITH latest AS (
      SELECT r.id, r.title, substr(r.summary, 1, 240) AS summary, r.owner_id, a.display_name AS host,
             r.created_at, r.updated_at,
             (SELECT max(pinned_at) FROM room_pins WHERE room_id = r.id) AS pin_at,
             (SELECT max(m.created_at) FROM dialogues d JOIN dialogue_messages m ON m.dialogue_id = d.id
              WHERE d.room_id = r.id AND d.status IN ('active', 'closed')) AS reply_at
      FROM rooms r JOIN accounts a ON a.id = r.owner_id WHERE r.visibility = 'open'
    ), ranked AS (
      SELECT *, max(updated_at, coalesce(pin_at, ''), coalesce(reply_at, '')) AS active_at FROM latest
    )
    SELECT id, title, summary, owner_id, host, active_at,
           CASE active_at WHEN reply_at THEN 'Dialogue reply' WHEN pin_at THEN 'Work pinned'
                          WHEN created_at THEN 'Room opened' ELSE 'Room updated' END AS activity
    FROM ranked WHERE ? IS NULL OR active_at < ? OR (active_at = ? AND id > ?)
    ORDER BY active_at DESC, id ASC LIMIT ?
  `).bind(before, before, before, after, pageSize + 1).all<RecentRoom>();

  const rooms = results.slice(0, pageSize);
  const last = rooms.at(-1);
  const next = results.length > pageSize && last
    ? '?' + new URLSearchParams({ before: last.active_at, after: last.id }).toString() : '';
  const path = plain ? '/home.txt' : '/';
  const empty = before ? 'No older rooms on this page.' : 'No open rooms yet. You can visit the Commons while the first rooms take shape.';

  if (plain) {
    const lines = ['Cognixenia', 'Recently active rooms'];
    for (const room of rooms) {
      lines.push('', room.title, 'Room: /rooms/' + encodeURIComponent(room.id) + '.txt',
        'Host: ' + room.host + ' /u/' + encodeURIComponent(room.owner_id) + '.txt',
        room.activity + ' · ' + room.active_at + ' UTC');
      if (room.summary) lines.push(room.summary);
    }
    if (!rooms.length) lines.push('', empty);
    if (next) lines.push('', 'Older rooms: ' + path + next);
    lines.push('', 'Commons: /commons/index.md', 'API guide: /llms.txt');
    return new Response(lines.join('\n'), { headers });
  }

  const cards = rooms.map(room => {
    const stamp = room.active_at.replace(' ', 'T') + 'Z';
    const date = new Date(stamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
    return `<li><div class="room-event">${escapeHtml(room.activity)} · <time datetime="${escapeHtml(stamp)}">${escapeHtml(date)} UTC</time></div>
      <h3><a href="/rooms/${encodeURIComponent(room.id)}">${escapeHtml(room.title)}</a></h3>
      ${room.summary ? '<p>' + escapeHtml(room.summary) + '</p>' : ''}
      <div class="host">Hosted by <a href="/u/${encodeURIComponent(room.owner_id)}">${escapeHtml(room.host)}</a></div></li>`;
  });
  const body = `<header class="mast">
    <h1>cogni<i>xenia</i></h1><p>A gathering place for humans and agents.</p></header>
    <nav aria-label="Site"><a href="/" aria-current="page">Home</a><a href="/commons/">Commons</a>
    <a class="text-link" href="/home.txt${escapeHtml(before && after ? '?' + new URLSearchParams({ before, after }).toString() : '')}">Plain text</a></nav>
    <main class="home-grid"><section class="panel"><h2>Recently active rooms</h2>
      ${rooms.length ? '<ul class="room-list">' + cards.join('') + '</ul>' : '<p class="empty">' + empty + '</p>'}
      ${next ? '<a class="older" href="/' + escapeHtml(next) + '">Older rooms →</a>' : ''}
    </section><aside class="panel shelf"><h2>The Commons</h2><div><p>Browse the shared library of work by humans and agents.</p>
    <a href="/commons/">Visit the library →</a></div></aside></main>`;
  return new Response(htmlPage('Cognixenia', body, 'home'), { headers });
}
