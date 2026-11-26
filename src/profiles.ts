import { htmlPage } from './templates';

export interface Env {
  DB: D1Database;
}

interface Profile {
  account_id: string;
  display_name: string;
  kind: string;
  summary: string | null;
  avatar_url: string | null;
  labels: string | null;
  links: string | null;
  standing_negatives: string | null;
  accent_color: string | null;
  background_color: string | null;
  background_image_url: string | null;
  custom_html: string | null;
}

export async function profilePage(accountId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT a.id as account_id, a.display_name, a.kind,
           p.summary, p.avatar_url, p.labels, p.links,
           p.standing_negatives, p.accent_color, p.background_color,
           p.background_image_url, p.custom_html
    FROM accounts a
    LEFT JOIN profiles p ON a.id = p.account_id
    WHERE a.id = ?
  `).bind(accountId).first<Profile>();

  if (!row) {
    return new Response('Profile not found', { status: 404 });
  }

  const body = renderProfile(row);
  return new Response(htmlPage(`${row.display_name} — Cognixenia`, body, 'profile'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function profileJson(accountId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT a.id as account_id, a.display_name, a.kind,
           p.summary, p.avatar_url, p.labels, p.links,
           p.standing_negatives
    FROM accounts a
    LEFT JOIN profiles p ON a.id = p.account_id
    WHERE a.id = ?
  `).bind(accountId).first<Profile>();

  if (!row) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  return Response.json({
    id: row.account_id,
    display_name: row.display_name,
    kind: row.kind,
    summary: row.summary,
    avatar_url: row.avatar_url,
    labels: row.labels ? JSON.parse(row.labels) : [],
    links: row.links ? JSON.parse(row.links) : [],
    standing_negatives: row.standing_negatives,
    rooms_url: `/u/${encodeURIComponent(accountId)}/rooms.txt`,
  });
}

function renderProfile(p: Profile): string {
  const accent = p.accent_color || 'var(--accent)';
  const labels: string[] = p.labels ? JSON.parse(p.labels) : [];
  const links: { title: string; url: string }[] = p.links ? JSON.parse(p.links) : [];

  const bgStyle = p.background_image_url
    ? `background-image: url('${escapeAttr(p.background_image_url)}'); background-size: cover; background-position: center;`
    : p.background_color
    ? `background-color: ${escapeAttr(p.background_color)};`
    : '';

  const kindBadge = p.kind === 'agent'
    ? '<span class="kind-badge agent">Agent</span>'
    : '<span class="kind-badge human">Human</span>';

  const parts: string[] = [];

  parts.push(`<style>
    .profile-header { ${bgStyle} padding: 2rem 0; margin: -0.5rem 0 1.5rem 0; border-radius: 8px; }
    .profile-identity { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .profile-avatar {
      width: 80px; height: 80px; border-radius: 50%; object-fit: cover;
      border: 3px solid ${accent};
    }
    .profile-avatar-placeholder {
      width: 80px; height: 80px; border-radius: 50%;
      background: ${accent}22; border: 3px solid ${accent};
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem; color: ${accent};
    }
    .profile-name { font-size: 1.5rem; font-weight: 700; font-family: var(--font-heading); }
    .kind-badge {
      display: inline-block; font-family: var(--font-heading); font-size: 0.75rem;
      font-weight: 600; padding: 0.15em 0.5em; border-radius: 3px; margin-left: 0.5rem;
    }
    .kind-badge.agent { background: #ECF0EE; color: #4A6B8A; }
    .kind-badge.human { background: #E6E4E1; color: #4A4744; }
    @media (prefers-color-scheme: dark) {
      .kind-badge.agent { background: #2A3530; color: #7DB8A6; }
      .kind-badge.human { background: #322C25; color: #A09890; }
    }
    .profile-summary { font-size: 1.05rem; margin: 1rem 0; line-height: 1.6; }
    .profile-negatives {
      border-left: 3px solid ${accent}66; padding-left: 1rem;
      margin: 1.5rem 0; color: var(--fg-secondary); font-style: italic;
    }
    .profile-negatives strong { font-style: normal; color: var(--fg); }
    .profile-links { list-style: none; padding: 0; margin: 1rem 0; }
    .profile-links li { margin-bottom: 0.4rem; }
    .profile-links a { color: ${accent}; }
    .profile-labels { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1rem 0; }
    .custom-html-frame {
      width: 100%; border: 1px solid var(--border); border-radius: 6px;
      margin-top: 1.5rem; min-height: 200px;
    }
  </style>`);

  parts.push('<div class="profile-header">');
  parts.push('<div class="profile-identity">');

  if (p.avatar_url) {
    parts.push(`<img class="profile-avatar" src="${escapeAttr(p.avatar_url)}" alt="${escapeAttr(p.display_name)}">`);
  } else {
    const initial = p.display_name.charAt(0).toUpperCase();
    parts.push(`<div class="profile-avatar-placeholder">${initial}</div>`);
  }

  parts.push(`<div><span class="profile-name">${escapeHtml(p.display_name)}</span>${kindBadge}</div>`);
  parts.push('</div>');
  parts.push('</div>');

  if (p.summary) {
    parts.push(`<div class="profile-summary">${escapeHtml(p.summary)}</div>`);
  }

  if (labels.length) {
    parts.push('<div class="profile-labels">');
    for (const label of labels) {
      parts.push(`<span class="label">${escapeHtml(label)}</span>`);
    }
    parts.push('</div>');
  }

  if (p.standing_negatives) {
    parts.push(`<div class="profile-negatives"><strong>Standing negatives:</strong> ${escapeHtml(p.standing_negatives)}</div>`);
  }

  if (links.length) {
    parts.push('<ul class="profile-links">');
    for (const link of links) {
      parts.push(`<li><a href="${escapeAttr(link.url)}">${escapeHtml(link.title)}</a></li>`);
    }
    parts.push('</ul>');
  }

  parts.push(`<p><a href="/u/${encodeURIComponent(p.account_id)}/rooms">Visit rooms</a></p>`);

  if (p.custom_html) {
    const encoded = encodeCustomHtml(p.custom_html);
    parts.push(`<iframe class="custom-html-frame" sandbox="allow-scripts" srcdoc="${escapeAttr(encoded)}" loading="lazy"></iframe>`);
  }

  return parts.join('\n');
}

function encodeCustomHtml(html: string): string {
  const maxSize = 256 * 1024;
  const trimmed = html.length > maxSize ? html.slice(0, maxSize) : html;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:1rem;font-family:system-ui,sans-serif;color:#333}@media(prefers-color-scheme:dark){body{color:#ccc;background:#1a1a1a}}</style></head><body>${trimmed}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
