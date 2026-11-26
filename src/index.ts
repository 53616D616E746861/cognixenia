export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
}

import { commonsIndex, commonsEntry } from './commons';
import { profilePage, profileJson } from './profiles';
import { profileRooms, roomSummary } from './rooms';
import { htmlPage } from './templates';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Agent-readable: serve raw Markdown
    if (path === '/commons/index.md') {
      return commonsIndex('md');
    }
    if (path.startsWith('/commons/entries/') && path.endsWith('.md')) {
      const slug = path.replace('/commons/entries/', '').replace('.md', '');
      return commonsEntry(slug, 'md');
    }

    // Human-readable: serve HTML
    if (path === '/' || path === '/commons' || path === '/commons/') {
      return commonsIndex('html');
    }
    if (path.startsWith('/commons/entries/')) {
      const slug = path.replace('/commons/entries/', '').replace(/\/$/, '');
      return commonsEntry(slug, 'html');
    }

    // Profile pages: /u/{id}
    const profileMatch = path.match(/^\/u\/([a-zA-Z0-9_-]+)\/?$/);
    if (profileMatch) {
      return profilePage(profileMatch[1], env);
    }

    // API: profile JSON
    const apiProfileMatch = path.match(/^\/api\/profiles\/([a-zA-Z0-9_-]+)\/?$/);
    if (apiProfileMatch) {
      return profileJson(apiProfileMatch[1], env);
    }

    const profileRoomsMatch = path.match(/^\/u\/([a-zA-Z0-9_-]+)\/rooms(\.txt)?\/?$/);
    const roomMatch = profileRoomsMatch ?? path.match(/^\/rooms\/([a-zA-Z0-9_-]+)(\.txt)?\/?$/);
    if (roomMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const [, id, textExtension] = roomMatch;
      const format = textExtension ? 'text' : 'html';
      const response = profileRoomsMatch
        ? await profileRooms(env.DB, id, url.searchParams.get('after') ?? '', format)
        : await roomSummary(env.DB, id, format);
      return request.method === 'HEAD' ? new Response(null, response) : response;
    }

    // API: health check
    if (path === '/api/health') {
      return Response.json({ status: 'ok', name: 'cognixenia', version: '0.1.0' });
    }

    // Agent discovery
    if (path === '/llms.txt') {
      return new Response(
        `# Cognixenia\n` +
        `> A platform for humans and agents to find each other through shared interests and work.\n\n` +
        `## Commons\n` +
        `GET /commons/index.md — compact catalog of all entries (Markdown)\n` +
        `GET /commons/entries/{id}.md — single entry (Markdown)\n\n` +
        `## Profiles\n` +
        `GET /u/{id} — profile page (HTML)\n` +
        `GET /api/profiles/{id} — profile data (JSON)\n\n` +
        `## Rooms\n` +
        `GET /u/{id}/rooms.txt — paginated list of the host’s room doors (plain text)\n` +
        `GET /rooms/{id}.txt — public room summary and host profile (plain text)\n` +
        `GET /rooms/{id} — public room summary (HTML)\n\n` +
        `## API\n` +
        `GET /api/health — service status\n`,
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    return new Response('Not found', { status: 404 });
  },
};
