import { htmlPage } from './templates';

export function loginPage(): Response {
  const body = `
  <style>
    .auth-form { max-width: 360px; margin: 2rem auto; }
    .auth-form h1 { text-align: center; margin-bottom: 0.5rem; }
    .auth-form .subtitle { text-align: center; color: var(--fg-secondary); margin-bottom: 2rem; font-size: 0.95rem; }
    .field { margin-bottom: 1.25rem; }
    .field label {
      display: block; font-family: var(--font-heading); font-size: 0.85rem;
      font-weight: 600; margin-bottom: 0.35rem; color: var(--fg-secondary);
    }
    .field input {
      width: 100%; padding: 0.6rem 0.75rem; font-size: 1rem;
      font-family: var(--font-body); border: 1px solid var(--border);
      border-radius: 4px; background: var(--bg); color: var(--fg);
    }
    .field input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
    .btn {
      width: 100%; padding: 0.65rem; font-family: var(--font-heading);
      font-size: 0.95rem; font-weight: 600; border: none; border-radius: 4px;
      background: var(--accent); color: var(--bg); cursor: pointer;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #c44; font-family: var(--font-heading); font-size: 0.85rem; margin-bottom: 1rem; }
    .step { display: none; }
    .step.active { display: block; }
    .code-input {
      letter-spacing: 0.5em; text-align: center; font-family: var(--font-mono); font-size: 1.5rem;
    }
    .back-link { font-family: var(--font-heading); font-size: 0.85rem; margin-top: 1rem; text-align: center; }
    .back-link a { color: var(--accent); cursor: pointer; text-decoration: none; }
    .back-link a:hover { text-decoration: underline; }
  </style>

  <div class="auth-form">
    <h1>Sign in</h1>
    <p class="subtitle">Enter your email to get a sign-in code.</p>

    <div id="error" class="error" hidden></div>

    <div id="step-email" class="step active">
      <form id="email-form">
        <div class="field">
          <label for="email">Email address</label>
          <input type="email" id="email" name="email" required autocomplete="email" autofocus>
        </div>
        <button type="submit" class="btn" id="email-btn">Send code</button>
      </form>
    </div>

    <div id="step-code" class="step">
      <p class="subtitle" id="code-hint" style="margin-bottom:1rem"></p>
      <form id="code-form">
        <div class="field">
          <label for="code">6-digit code</label>
          <input type="text" id="code" name="code" class="code-input" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" required autocomplete="one-time-code">
        </div>
        <div class="field" id="name-field" hidden>
          <label for="display_name">Display name (new account)</label>
          <input type="text" id="display_name" name="display_name" maxlength="100" placeholder="How you'd like to appear">
        </div>
        <button type="submit" class="btn" id="code-btn">Verify</button>
      </form>
      <div class="back-link"><a id="back-btn">Use a different email</a></div>
    </div>
  </div>

  <script>
    const $ = id => document.getElementById(id);
    let userEmail = '';

    function showError(msg) {
      const el = $('error');
      el.textContent = msg;
      el.hidden = false;
    }
    function clearError() { $('error').hidden = true; }

    $('email-form').addEventListener('submit', async e => {
      e.preventDefault();
      clearError();
      const btn = $('email-btn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      userEmail = $('email').value.trim().toLowerCase();
      try {
        const res = await fetch('/api/auth/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail }),
        });
        const data = await res.json();
        if (!res.ok) { showError(data.error || 'Something went wrong'); return; }
        $('step-email').classList.remove('active');
        $('step-code').classList.add('active');
        $('code-hint').textContent = 'Code sent to ' + userEmail;
        $('name-field').hidden = false;
        $('code').focus();
      } catch (err) {
        showError('Network error. Try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send code';
      }
    });

    $('code-form').addEventListener('submit', async e => {
      e.preventDefault();
      clearError();
      const btn = $('code-btn');
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      const code = $('code').value.trim();
      const displayName = $('display_name').value.trim();
      const payload = { email: userEmail, code };
      if (displayName) payload.display_name = displayName;
      try {
        const res = await fetch('/api/auth/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.error === 'display_name_required_for_new_account') {
            showError('This is a new account — please enter a display name.');
            $('name-field').hidden = false;
            $('display_name').focus();
          } else {
            showError(data.error || 'Invalid or expired code');
          }
          return;
        }
        const maxAge = 30 * 24 * 60 * 60;
        document.cookie = 'cgx_token=' + data.token + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
        window.location.href = '/u/' + encodeURIComponent(data.account.id);
      } catch (err) {
        showError('Network error. Try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Verify';
      }
    });

    $('back-btn').addEventListener('click', () => {
      clearError();
      $('step-code').classList.remove('active');
      $('step-email').classList.add('active');
      $('email').focus();
    });
  </script>`;

  return new Response(htmlPage('Sign in — Cognixenia', body), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
