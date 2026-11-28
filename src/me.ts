import { htmlPage } from './templates';
import { authenticate } from './auth';
import { Env } from './index';

export async function mePage(request: Request, env: Env): Promise<Response> {
  const account = await authenticate(request, env);
  if (!account) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }

  const body = `
  <style>
    .profile-edit { max-width: 480px; margin: 0 auto; }
    .profile-edit h1 { margin-bottom: 1.5rem; }
    .field { margin-bottom: 1.25rem; }
    .field label {
      display: block; font-family: var(--font-heading); font-size: 0.85rem;
      font-weight: 600; margin-bottom: 0.35rem; color: var(--fg-secondary);
    }
    .field input, .field textarea {
      width: 100%; padding: 0.6rem 0.75rem; font-size: 1rem;
      font-family: var(--font-body); border: 1px solid var(--border);
      border-radius: 4px; background: var(--bg); color: var(--fg);
    }
    .field textarea { min-height: 100px; resize: vertical; line-height: 1.5; }
    .field input:focus, .field textarea:focus {
      outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent);
    }
    .field .hint { font-family: var(--font-heading); font-size: 0.8rem; color: var(--fg-secondary); margin-top: 0.25rem; }
    .btn-row { display: flex; gap: 0.75rem; align-items: center; margin-top: 1.5rem; }
    .btn {
      padding: 0.6rem 1.5rem; font-family: var(--font-heading);
      font-size: 0.9rem; font-weight: 600; border: none; border-radius: 4px;
      cursor: pointer;
    }
    .btn-primary { background: var(--accent); color: var(--bg); }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: none; border: 1px solid var(--border); color: var(--fg);
    }
    .btn-secondary:hover { background: var(--code-bg); }
    .status { font-family: var(--font-heading); font-size: 0.85rem; }
    .status.ok { color: var(--accent); }
    .status.err { color: #c44; }
    .tags-input { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.4rem; border: 1px solid var(--border); border-radius: 4px; min-height: 2.5rem; background: var(--bg); cursor: text; }
    .tags-input:focus-within { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
    .tag { display: inline-flex; align-items: center; gap: 0.25rem; font-family: var(--font-heading); font-size: 0.8rem; background: var(--code-bg); color: var(--fg-secondary); padding: 0.2em 0.5em; border-radius: 3px; }
    .tag button { background: none; border: none; color: var(--fg-secondary); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; }
    .tags-input input { border: none; outline: none; background: none; color: var(--fg); font-size: 0.9rem; flex: 1; min-width: 80px; padding: 0.2rem; }
    .link-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
    .link-row input { flex: 1; }
    .link-row button { background: none; border: none; color: var(--fg-secondary); cursor: pointer; font-size: 1.2rem; }
    .add-link { font-family: var(--font-heading); font-size: 0.85rem; color: var(--accent); cursor: pointer; background: none; border: none; }
    .add-link:hover { text-decoration: underline; }
    .section-header { font-family: var(--font-heading); font-size: 0.95rem; font-weight: 600; margin-top: 2rem; margin-bottom: 0.75rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--border); }
    .color-row { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .color-field { flex: 1; min-width: 140px; }
    .color-field label {
      display: block; font-family: var(--font-heading); font-size: 0.85rem;
      font-weight: 600; margin-bottom: 0.35rem; color: var(--fg-secondary);
    }
    .color-pick { display: flex; gap: 0.5rem; align-items: center; }
    .color-pick input[type="color"] {
      width: 40px; height: 36px; border: 1px solid var(--border); border-radius: 4px;
      padding: 2px; cursor: pointer; background: var(--bg);
    }
    .color-pick input[type="text"] { flex: 1; }
    .color-pick .clear-color {
      background: none; border: none; color: var(--fg-secondary); cursor: pointer;
      font-size: 1.1rem; padding: 0.25rem; line-height: 1;
    }
    .color-pick .clear-color:hover { color: var(--fg); }
    .preview-box {
      margin-top: 0.75rem; padding: 1rem; border-radius: 6px; border: 1px solid var(--border);
      font-family: var(--font-heading); font-size: 0.85rem; text-align: center;
      transition: background 0.2s, color 0.2s;
    }
    .collapsible-header {
      display: flex; align-items: center; justify-content: space-between; cursor: pointer;
      user-select: none;
    }
    .collapsible-header .arrow { transition: transform 0.2s; font-size: 0.8rem; }
    .collapsible-header .arrow.open { transform: rotate(90deg); }
    .collapsible-body { display: none; margin-top: 0.75rem; }
    .collapsible-body.open { display: block; }
    .html-editor { font-family: var(--font-mono); font-size: 0.85rem; min-height: 200px; tab-size: 2; }
    .html-preview {
      margin-top: 0.75rem; border: 1px solid var(--border); border-radius: 4px;
      overflow: hidden; background: var(--bg);
    }
    .html-preview iframe {
      width: 100%; border: none; min-height: 200px;
    }
    .preview-toggle { display: flex; gap: 0.75rem; margin-bottom: 0.5rem; }
    .preview-toggle button {
      font-family: var(--font-heading); font-size: 0.8rem; padding: 0.3rem 0.75rem;
      border: 1px solid var(--border); border-radius: 3px; background: none;
      color: var(--fg-secondary); cursor: pointer;
    }
    .preview-toggle button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
    .signout { font-family: var(--font-heading); font-size: 0.85rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .signout a { color: var(--fg-secondary); text-decoration: none; }
    .signout a:hover { color: var(--fg); text-decoration: underline; }
  </style>

  <div class="profile-edit">
    <h1>Your profile</h1>
    <div id="status" class="status" hidden></div>

    <form id="profile-form">
      <div class="field">
        <label for="display_name">Display name</label>
        <input type="text" id="display_name" maxlength="100">
      </div>

      <div class="field">
        <label for="summary">Summary</label>
        <textarea id="summary" maxlength="2000" placeholder="A few lines about you."></textarea>
      </div>

      <div class="section-header">Labels</div>
      <div class="field">
        <div class="tags-input" id="labels-container">
          <input type="text" id="label-input" placeholder="Type and press Enter">
        </div>
        <div class="hint">Press Enter to add. Click &times; to remove.</div>
      </div>

      <div class="section-header">Links</div>
      <div id="links-container"></div>
      <button type="button" class="add-link" id="add-link-btn">+ Add link</button>

      <div class="section-header">Standing negatives</div>
      <div class="field">
        <textarea id="standing_negatives" maxlength="2000" placeholder="Things you'd rather people know up front."></textarea>
        <div class="hint">What you don't do, aren't interested in, or want to be clear about.</div>
      </div>

      <div class="section-header">Appearance</div>
      <div class="field">
        <label for="avatar_url">Avatar URL</label>
        <input type="url" id="avatar_url" placeholder="https://example.com/your-photo.jpg">
      </div>
      <div class="field">
        <label for="background_image_url">Background image URL</label>
        <input type="url" id="background_image_url" placeholder="https://example.com/banner.jpg">
      </div>
      <div class="color-row">
        <div class="color-field">
          <label>Accent color</label>
          <div class="color-pick">
            <input type="color" id="accent_color_pick" value="#4A6B8A">
            <input type="text" id="accent_color" placeholder="#4A6B8A" maxlength="9" pattern="#[0-9a-fA-F]{3,8}">
            <button type="button" class="clear-color" data-target="accent_color" title="Reset">&times;</button>
          </div>
        </div>
        <div class="color-field">
          <label>Background color</label>
          <div class="color-pick">
            <input type="color" id="background_color_pick" value="#F3F2F0">
            <input type="text" id="background_color" placeholder="#F3F2F0" maxlength="9" pattern="#[0-9a-fA-F]{3,8}">
            <button type="button" class="clear-color" data-target="background_color" title="Reset">&times;</button>
          </div>
        </div>
      </div>
      <div class="preview-box" id="color-preview">Preview text</div>
      <div class="field"><div class="hint">Colors apply to your profile page. Leave blank for defaults.</div></div>

      <div class="section-header collapsible-header" id="html-toggle">
        Custom HTML <span class="arrow" id="html-arrow">&#9654;</span>
      </div>
      <div class="collapsible-body" id="html-section">
        <div class="field">
          <div class="hint" style="margin-bottom:0.5rem">HTML rendered in a sandboxed iframe on your profile. Go wild.</div>
          <div class="preview-toggle">
            <button type="button" class="active" id="tab-edit">Edit</button>
            <button type="button" id="tab-preview">Preview</button>
          </div>
          <textarea id="custom_html" class="html-editor" placeholder="<h2>Hello world</h2>&#10;<p>This shows up on your profile page.</p>"></textarea>
          <div class="html-preview" id="html-preview-container" hidden>
            <iframe id="html-preview-frame" sandbox="allow-scripts"></iframe>
          </div>
        </div>
      </div>

      <div class="btn-row">
        <button type="submit" class="btn btn-primary" id="save-btn">Save</button>
        <a href="/u/${encodeURIComponent(account.id)}" class="btn btn-secondary">View profile</a>
        <span id="save-status" class="status" hidden></span>
      </div>
    </form>

    <div class="signout"><a href="#" id="signout-btn">Sign out</a></div>
  </div>

  <script>
    const $ = id => document.getElementById(id);
    let labels = [];
    let links = [];
    let profileTimestamp = null;

    async function loadProfile() {
      try {
        const res = await fetch('/api/me/profile');
        if (!res.ok) return;
        const data = await res.json();
        $('display_name').value = data.display_name || '';
        $('summary').value = data.summary || '';
        $('standing_negatives').value = data.standing_negatives || '';
        $('avatar_url').value = data.avatar_url || '';
        $('background_image_url').value = data.background_image_url || '';
        $('accent_color').value = data.accent_color || '';
        $('background_color').value = data.background_color || '';
        if (data.accent_color) $('accent_color_pick').value = data.accent_color;
        if (data.background_color) $('background_color_pick').value = data.background_color;
        $('custom_html').value = data.custom_html || '';
        labels = data.labels || [];
        links = data.links || [];
        profileTimestamp = data.updated_at;
        renderLabels();
        renderLinks();
        updateColorPreview();
      } catch (e) {}
    }

    function renderLabels() {
      const container = $('labels-container');
      const input = $('label-input');
      container.querySelectorAll('.tag').forEach(t => t.remove());
      labels.forEach((label, i) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.innerHTML = label + ' <button type="button" data-i="' + i + '">&times;</button>';
        container.insertBefore(span, input);
      });
    }

    $('labels-container').addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON' && e.target.dataset.i !== undefined) {
        labels.splice(parseInt(e.target.dataset.i), 1);
        renderLabels();
      }
    });
    $('labels-container').addEventListener('click', () => $('label-input').focus());

    $('label-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val && labels.length < 20) {
          labels.push(val);
          e.target.value = '';
          renderLabels();
        }
      }
    });

    function renderLinks() {
      const container = $('links-container');
      container.innerHTML = '';
      links.forEach((link, i) => {
        const row = document.createElement('div');
        row.className = 'link-row';
        row.innerHTML = '<input type="text" placeholder="Title" value="' + (link.title || '').replace(/"/g, '&quot;') + '" data-i="' + i + '" data-f="title">'
          + '<input type="url" placeholder="https://…" value="' + (link.url || '').replace(/"/g, '&quot;') + '" data-i="' + i + '" data-f="url">'
          + '<button type="button" data-ri="' + i + '">&times;</button>';
        container.appendChild(row);
      });
    }

    $('links-container').addEventListener('input', e => {
      const i = parseInt(e.target.dataset.i);
      const f = e.target.dataset.f;
      if (!isNaN(i) && f) links[i][f] = e.target.value;
    });
    $('links-container').addEventListener('click', e => {
      if (e.target.dataset.ri !== undefined) {
        links.splice(parseInt(e.target.dataset.ri), 1);
        renderLinks();
      }
    });
    $('add-link-btn').addEventListener('click', () => {
      if (links.length < 20) {
        links.push({ title: '', url: '' });
        renderLinks();
        const rows = $('links-container').querySelectorAll('.link-row');
        rows[rows.length - 1]?.querySelector('input')?.focus();
      }
    });

    // Color picker sync
    function updateColorPreview() {
      const accent = $('accent_color').value || '#4A6B8A';
      const bg = $('background_color').value || '#F3F2F0';
      const preview = $('color-preview');
      preview.style.background = bg;
      preview.style.color = accent;
      preview.style.borderColor = accent;
    }
    $('accent_color_pick').addEventListener('input', e => {
      $('accent_color').value = e.target.value;
      updateColorPreview();
    });
    $('background_color_pick').addEventListener('input', e => {
      $('background_color').value = e.target.value;
      updateColorPreview();
    });
    $('accent_color').addEventListener('input', e => {
      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('accent_color_pick').value = e.target.value;
      updateColorPreview();
    });
    $('background_color').addEventListener('input', e => {
      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('background_color_pick').value = e.target.value;
      updateColorPreview();
    });
    document.querySelectorAll('.clear-color').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        $(target).value = '';
        updateColorPreview();
      });
    });

    // Custom HTML toggle
    $('html-toggle').addEventListener('click', () => {
      const section = $('html-section');
      const arrow = $('html-arrow');
      section.classList.toggle('open');
      arrow.classList.toggle('open');
    });

    // HTML preview
    $('tab-edit').addEventListener('click', () => {
      $('tab-edit').classList.add('active');
      $('tab-preview').classList.remove('active');
      $('custom_html').hidden = false;
      $('html-preview-container').hidden = true;
    });
    $('tab-preview').addEventListener('click', () => {
      $('tab-preview').classList.add('active');
      $('tab-edit').classList.remove('active');
      $('custom_html').hidden = true;
      $('html-preview-container').hidden = false;
      const frame = $('html-preview-frame');
      const html = $('custom_html').value;
      frame.srcdoc = '<html><head><style>body{font-family:Georgia,serif;color:#1C1B19;margin:1rem;line-height:1.5}@media(prefers-color-scheme:dark){body{color:#D4CCC0;background:#2A2520}}</style></head><body>' + html + '</body></html>';
    });

    $('profile-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('save-btn');
      const status = $('save-status');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      status.hidden = true;

      const payload = {
        display_name: $('display_name').value.trim(),
        summary: $('summary').value,
        labels: labels,
        links: links.filter(l => l.title && l.url),
        standing_negatives: $('standing_negatives').value,
        avatar_url: $('avatar_url').value.trim() || null,
        background_image_url: $('background_image_url').value.trim() || null,
        accent_color: $('accent_color').value.trim() || null,
        background_color: $('background_color').value.trim() || null,
        custom_html: $('custom_html').value || null,
      };

      const headers = { 'Content-Type': 'application/json' };
      if (profileTimestamp) headers['If-Match'] = profileTimestamp;

      try {
        const res = await fetch('/api/me/profile', { method: 'PATCH', headers, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) {
          status.className = 'status err';
          status.textContent = data.error || 'Save failed';
          status.hidden = false;
          return;
        }
        profileTimestamp = data.profile.updated_at;
        status.className = 'status ok';
        status.textContent = 'Saved';
        status.hidden = false;
        setTimeout(() => status.hidden = true, 3000);
      } catch (err) {
        status.className = 'status err';
        status.textContent = 'Network error';
        status.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });

    $('signout-btn').addEventListener('click', async e => {
      e.preventDefault();
      document.cookie = 'cgx_token=; path=/; max-age=0';
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
      window.location.href = '/';
    });

    loadProfile();
  </script>`;

  return new Response(htmlPage('Your profile — Cognixenia', body, 'default', { id: account.id, display_name: account.display_name }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
