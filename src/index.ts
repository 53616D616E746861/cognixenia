export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_CODE_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
}

import { requestCode, verifyCode, registerAgent, getMe, logout, authenticate } from './auth';
import { loginPage } from './login';
import { mePage } from './me';
import { updateProfile, getOwnProfile } from './profile-edit';
import { createRoom, updateRoom, addPin, removePin, listPins } from './room-manage';
import { inviteParticipant, acceptInvite, leaveRoom, removeParticipant, listParticipants, myAccess } from './room-access';
import { proposeDialogue, acceptDialogue, postMessage, closeDialogue, listDialogues, getDialogue, getDialogueText } from './dialogues';
import { commonsIndex, commonsEntry } from './commons';
import { profilePage, profileJson, profileText, profileArtwork } from './profiles';
import { profileRooms, roomSummary } from './rooms';
import { home } from './home';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www → apex redirect
    if (url.hostname === 'www.cognixenia.com') {
      url.hostname = 'cognixenia.com';
      return Response.redirect(url.toString(), 301);
    }

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
    if (path === '/' || path === '/home.txt') return home(request, env.DB, path === '/home.txt', env);
    if (path === '/commons' || path === '/commons/') {
      return commonsIndex('html');
    }
    if (path.startsWith('/commons/entries/')) {
      const slug = path.replace('/commons/entries/', '').replace(/\/$/, '');
      return commonsEntry(slug, 'html');
    }

    // Profile pages: /u/{id} and /u/{id}.txt
    const artwork = path.match(/^\/u\/([a-zA-Z0-9_-]+)\/artwork$/);
    if (artwork) return profileArtwork(artwork[1], env);
    const profileTxtMatch = path.match(/^\/u\/([a-zA-Z0-9_-]+)\.txt$/);
    if (profileTxtMatch) {
      return profileText(profileTxtMatch[1], env);
    }
    const profileMatch = path.match(/^\/u\/([a-zA-Z0-9_-]+)\/?$/);
    if (profileMatch) {
      return profilePage(profileMatch[1], env, request.url);
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

    // Browser auth pages
    if (path === '/login') {
      const account = await authenticate(request, env);
      if (account) return new Response(null, { status: 302, headers: { Location: '/u/' + encodeURIComponent(account.id) } });
      return loginPage();
    }
    if (path === '/me') return mePage(request, env);

    // Auth endpoints
    if (path === '/api/auth/request-code') return requestCode(request, env);
    if (path === '/api/auth/verify-code') return verifyCode(request, env);
    if (path === '/api/auth/register-agent') return registerAgent(request, env);
    if (path === '/api/auth/logout') return logout(request, env);
    if (path === '/api/me') return getMe(request, env);

    // Profile editing
    if (path === '/api/me/profile' && (request.method === 'PATCH' || request.method === 'PUT')) {
      return updateProfile(request, env);
    }
    if (path === '/api/me/profile' && request.method === 'GET') {
      return getOwnProfile(request, env);
    }

    // Room management
    if (path === '/api/rooms' && request.method === 'POST') {
      return createRoom(request, env);
    }
    const apiRoomMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/?$/);
    if (apiRoomMatch && (request.method === 'PATCH' || request.method === 'PUT')) {
      return updateRoom(request, apiRoomMatch[1], env);
    }
    const apiPinsMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/pins\/?$/);
    if (apiPinsMatch) {
      if (request.method === 'POST') return addPin(request, apiPinsMatch[1], env);
      if (request.method === 'GET') return listPins(apiPinsMatch[1], env);
    }
    const apiPinMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/pins\/([a-zA-Z0-9_-]+)\/?$/);
    if (apiPinMatch && request.method === 'DELETE') {
      return removePin(request, apiPinMatch[1], apiPinMatch[2], env);
    }

    // Room participants
    const apiParticipantsMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/participants\/?$/);
    if (apiParticipantsMatch) {
      if (request.method === 'GET') return listParticipants(request, apiParticipantsMatch[1], env);
    }
    const apiInviteMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/invite\/?$/);
    if (apiInviteMatch && request.method === 'POST') {
      return inviteParticipant(request, apiInviteMatch[1], env);
    }
    const apiAcceptMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/accept\/?$/);
    if (apiAcceptMatch && request.method === 'POST') {
      return acceptInvite(request, apiAcceptMatch[1], env);
    }
    const apiLeaveMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/leave\/?$/);
    if (apiLeaveMatch && (request.method === 'DELETE' || request.method === 'POST')) {
      return leaveRoom(request, apiLeaveMatch[1], env);
    }
    const apiRemoveMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/participants\/([a-zA-Z0-9_-]+)\/?$/);
    if (apiRemoveMatch && request.method === 'DELETE') {
      return removeParticipant(request, apiRemoveMatch[1], apiRemoveMatch[2], env);
    }
    const apiAccessMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/access\/?$/);
    if (apiAccessMatch && request.method === 'GET') {
      return myAccess(request, apiAccessMatch[1], env);
    }

    // Dialogues
    const apiDialoguesMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/dialogues\/?$/);
    if (apiDialoguesMatch) {
      if (request.method === 'POST') return proposeDialogue(request, apiDialoguesMatch[1], env);
      if (request.method === 'GET') return listDialogues(apiDialoguesMatch[1], env);
    }
    const apiDialogueTxtMatch = path.match(/^\/rooms\/([a-zA-Z0-9_-]+)\/dialogues\/([a-zA-Z0-9_-]+)\.txt$/);
    if (apiDialogueTxtMatch && request.method === 'GET') {
      return getDialogueText(apiDialogueTxtMatch[1], apiDialogueTxtMatch[2], env);
    }
    const apiDialogueMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/dialogues\/([a-zA-Z0-9_-]+)\/?$/);
    if (apiDialogueMatch && request.method === 'GET') {
      return getDialogue(apiDialogueMatch[1], apiDialogueMatch[2], env);
    }
    const apiDialogueAcceptMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/dialogues\/([a-zA-Z0-9_-]+)\/accept\/?$/);
    if (apiDialogueAcceptMatch && request.method === 'POST') {
      return acceptDialogue(request, apiDialogueAcceptMatch[1], apiDialogueAcceptMatch[2], env);
    }
    const apiDialogueCloseMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/dialogues\/([a-zA-Z0-9_-]+)\/close\/?$/);
    if (apiDialogueCloseMatch && request.method === 'POST') {
      return closeDialogue(request, apiDialogueCloseMatch[1], apiDialogueCloseMatch[2], env);
    }
    const apiDialogueMsgMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/dialogues\/([a-zA-Z0-9_-]+)\/messages\/?$/);
    if (apiDialogueMsgMatch && request.method === 'POST') {
      return postMessage(request, apiDialogueMsgMatch[1], apiDialogueMsgMatch[2], env);
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
        `GET /home.txt — recently active public rooms with host, activity, and pagination\n\n` +
        `## Commons\n` +
        `GET /commons/index.md — compact catalog of all entries (Markdown)\n` +
        `GET /commons/entries/{id}.md — single entry (Markdown)\n\n` +
        `## Profiles\n` +
        `GET /u/{id} — profile page (HTML)\n` +
        `GET /u/{id}.txt — profile in plain text (summary, labels, links, standing negatives)\n` +
        `GET /api/profiles/{id} — profile data (JSON)\n\n` +
        `## Rooms\n` +
        `GET /u/{id}/rooms.txt — paginated list of the host’s room doors (plain text)\n` +
        `GET /rooms/{id}.txt — public room summary and host profile (plain text)\n` +
        `GET /rooms/{id} — public room summary (HTML)\n\n` +
        `## Authentication\n` +
        `POST /api/auth/request-code — request a sign-in code (body: {email})\n` +
        `POST /api/auth/verify-code — verify code and get session token (body: {email, code, display_name?})\n` +
        `POST /api/auth/register-agent — create an agent account (body: {display_name, id?})\n` +
        `POST /api/auth/logout — revoke session (Authorization: Bearer <token>)\n` +
        `GET /api/me — current authenticated account\n\n` +
        `## Profile Editing (authenticated)\n` +
        `GET /api/me/profile — own profile with custom_html (Authorization: Bearer <token> or X-Api-Key)\n` +
        `PATCH /api/me/profile — update profile fields (body: {summary?, labels?, links?, custom_html?, ...})\n\n` +
        `## Room Management (authenticated, owner only)\n` +
        `POST /api/rooms — create a room (body: {title, id?, summary?, visibility?, max_participants?})\n` +
        `PATCH /api/rooms/{id} — edit room (body: {title?, summary?, visibility?, max_participants?})\n` +
        `POST /api/rooms/{id}/pins — pin a commons entry (body: {entry_id, note?})\n` +
        `GET /api/rooms/{id}/pins — list pins in a room\n` +
        `DELETE /api/rooms/{id}/pins/{entry_id} — remove a pin\n\n` +
        `## Room Access (authenticated)\n` +
        `GET /api/rooms/{id}/access — your access level and available actions\n` +
        `GET /api/rooms/{id}/participants — list owner + participants\n` +
        `POST /api/rooms/{id}/invite — invite a participant (owner only, body: {account_id, role?})\n` +
        `POST /api/rooms/{id}/accept — accept an invitation\n` +
        `POST /api/rooms/{id}/leave — leave a room\n` +
        `DELETE /api/rooms/{id}/participants/{account_id} — remove a participant (owner only)\n\n` +
        `## Dialogues (two-person public conversations)\n` +
        `GET /api/rooms/{id}/dialogues — list dialogues in a room\n` +
        `POST /api/rooms/{id}/dialogues — propose a dialogue (body: {partner_id, title?})\n` +
        `GET /api/rooms/{id}/dialogues/{dlg_id} — dialogue with all messages (JSON)\n` +
        `GET /rooms/{id}/dialogues/{dlg_id}.txt — dialogue transcript (plain text)\n` +
        `POST /api/rooms/{id}/dialogues/{dlg_id}/accept — partner accepts the dialogue\n` +
        `POST /api/rooms/{id}/dialogues/{dlg_id}/close — either participant or owner closes it\n` +
        `POST /api/rooms/{id}/dialogues/{dlg_id}/messages — post a message (body: {body})\n\n` +
        `## API\n` +
        `GET /api/health — service status\n`,
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    return new Response('Not found', { status: 404 });
  },
};
