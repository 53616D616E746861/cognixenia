import { Env } from './index';
import { authenticate } from './auth';

interface ProfileUpdate {
  summary?: string | null;
  avatar_url?: string | null;
  labels?: string[] | null;
  links?: { title: string; url: string }[] | null;
  standing_negatives?: string | null;
  accent_color?: string | null;
  background_color?: string | null;
  background_image_url?: string | null;
  custom_html?: string | null;
  display_name?: string;
}

const MAX_SUMMARY = 2000;
const MAX_CUSTOM_HTML = 256 * 1024;
const MAX_LABELS = 20;
const MAX_LINKS = 20;
const MAX_NEGATIVES = 2000;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function validateColor(c: string | null | undefined): string | null {
  if (!c) return null;
  return COLOR_RE.test(c) ? c : null;
}

export async function updateProfile(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH' && request.method !== 'PUT') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'PATCH, PUT' } });
  }

  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ProfileUpdate;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | null)[] = [];

  if ('display_name' in body) {
    const name = body.display_name?.trim();
    if (!name || name.length > 100) {
      return Response.json({ error: 'display_name must be 1-100 characters' }, { status: 400 });
    }
    await env.DB.prepare('UPDATE accounts SET display_name = ? WHERE id = ?')
      .bind(name, account.id).run();
  }

  if ('summary' in body) {
    const val = body.summary?.slice(0, MAX_SUMMARY) ?? null;
    sets.push('summary = ?');
    values.push(val);
  }

  if ('avatar_url' in body) {
    sets.push('avatar_url = ?');
    values.push(body.avatar_url ?? null);
  }

  if ('labels' in body) {
    const labels = body.labels ?? [];
    if (labels.length > MAX_LABELS) {
      return Response.json({ error: `max ${MAX_LABELS} labels` }, { status: 400 });
    }
    sets.push('labels = ?');
    values.push(labels.length ? JSON.stringify(labels) : null);
  }

  if ('links' in body) {
    const links = body.links ?? [];
    if (links.length > MAX_LINKS) {
      return Response.json({ error: `max ${MAX_LINKS} links` }, { status: 400 });
    }
    for (const link of links) {
      if (!link.title || !link.url) {
        return Response.json({ error: 'each link needs title and url' }, { status: 400 });
      }
    }
    sets.push('links = ?');
    values.push(links.length ? JSON.stringify(links) : null);
  }

  if ('standing_negatives' in body) {
    const val = body.standing_negatives?.slice(0, MAX_NEGATIVES) ?? null;
    sets.push('standing_negatives = ?');
    values.push(val);
  }

  if ('accent_color' in body) {
    sets.push('accent_color = ?');
    values.push(validateColor(body.accent_color));
  }

  if ('background_color' in body) {
    sets.push('background_color = ?');
    values.push(validateColor(body.background_color));
  }

  if ('background_image_url' in body) {
    sets.push('background_image_url = ?');
    values.push(body.background_image_url ?? null);
  }

  if ('custom_html' in body) {
    const html = body.custom_html ?? null;
    if (html && html.length > MAX_CUSTOM_HTML) {
      return Response.json({ error: `custom_html max ${MAX_CUSTOM_HTML} bytes` }, { status: 400 });
    }
    sets.push('custom_html = ?');
    values.push(html);
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    values.push(account.id);
    await env.DB.prepare(
      `UPDATE profiles SET ${sets.join(', ')} WHERE account_id = ?`
    ).bind(...values).run();
  }

  const profile = await env.DB.prepare(`
    SELECT a.id, a.display_name, a.kind,
           p.summary, p.avatar_url, p.labels, p.links,
           p.standing_negatives, p.accent_color, p.background_color,
           p.background_image_url, p.updated_at
    FROM accounts a
    LEFT JOIN profiles p ON a.id = p.account_id
    WHERE a.id = ?
  `).bind(account.id).first();

  return Response.json({
    ok: true,
    profile: {
      id: profile!.id,
      display_name: profile!.display_name,
      kind: profile!.kind,
      summary: profile!.summary,
      avatar_url: profile!.avatar_url,
      labels: profile!.labels ? JSON.parse(profile!.labels as string) : [],
      links: profile!.links ? JSON.parse(profile!.links as string) : [],
      standing_negatives: profile!.standing_negatives,
      accent_color: profile!.accent_color,
      background_color: profile!.background_color,
      background_image_url: profile!.background_image_url,
      updated_at: profile!.updated_at,
    },
  });
}

export async function getOwnProfile(request: Request, env: Env): Promise<Response> {
  const account = await authenticate(request, env);
  if (!account) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const profile = await env.DB.prepare(`
    SELECT a.id, a.display_name, a.kind,
           p.summary, p.avatar_url, p.labels, p.links,
           p.standing_negatives, p.accent_color, p.background_color,
           p.background_image_url, p.custom_html, p.updated_at
    FROM accounts a
    LEFT JOIN profiles p ON a.id = p.account_id
    WHERE a.id = ?
  `).bind(account.id).first();

  if (!profile) {
    return Response.json({ error: 'profile_not_found' }, { status: 404 });
  }

  return Response.json({
    id: profile.id,
    display_name: profile.display_name,
    kind: profile.kind,
    summary: profile.summary,
    avatar_url: profile.avatar_url,
    labels: profile.labels ? JSON.parse(profile.labels as string) : [],
    links: profile.links ? JSON.parse(profile.links as string) : [],
    standing_negatives: profile.standing_negatives,
    accent_color: profile.accent_color,
    background_color: profile.background_color,
    background_image_url: profile.background_image_url,
    custom_html: profile.custom_html,
    updated_at: profile.updated_at,
  });
}
