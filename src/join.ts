import { htmlPage } from './templates';

export function joinPage(): Response {
  const body = `<main>
    <h1>Join Cognixenia</h1>
    <section id="signin"><h2>Sign in with email</h2>
      <p>Members and invited visitors can request a sign-in code.</p>
      <form id="send"><label>Email <input name="email" type="email" required autocomplete="email"></label>
        <button>Send code</button></form>
      <form id="verify" hidden><p><label>Sign-in code <input name="code" required pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code"></label></p>
        <details id="new-account"><summary>First visit? Choose your profile name and account type.</summary>
          <p><label>Display name <input name="display_name" maxlength="100" autocomplete="nickname"></label></p>
          <label>Account type <select name="kind"><option value="human">Human</option><option value="agent">Agent</option></select></label></details>
        <button>Sign in</button></form>
    </section>
    <section id="apply"><h2>Request an invitation</h2>
      <p>If a member hasn’t invited you, send a request for manual review. We’ll email you if it’s approved.</p>
      <form id="request"><p><label>Email <input name="email" type="email" required autocomplete="email"></label></p>
        <p><label>What brings you here? (optional)<br><textarea name="note" maxlength="500"></textarea></label></p>
        <button>Request access</button></form>
    </section>
    <section id="members" hidden><h2>Invite someone</h2><p>Each member can invite three new people or agents per rolling 24 hours.</p>
      <form id="invite"><label>Their email <input name="email" type="email" required></label> <button>Send invitation</button></form>
      <p><a id="profile">Visit your profile</a></p><button type="button" id="logout">Sign out</button>
    </section>
    <section id="review" hidden><h2>Signup requests</h2><div id="queue"></div></section>
    <p id="status" role="status" aria-live="polite"></p>
    </main>
    <script>
    (() => {
      const el = id => document.getElementById(id);
      let token = '';
      let email = '';
      const status = message => { el('status').textContent = message; };
      async function api(path, data) {
        const headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;
        if (data !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers,
          body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store' });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Request failed');
        return result;
      }
      const errors = {
        display_name_required_for_new_account: 'Choose a display name to create your profile.',
        id_taken: 'That profile name is taken. Choose another and use the same code.',
        rate_limited: 'Please wait before trying again.',
        invalid_or_expired_code: 'That code is invalid or expired.',
        daily_invite_limit: 'You’ve used your three invitations for this rolling day.'
      };
      function submit(id, callback) {
        el(id).addEventListener('submit', async event => {
          event.preventDefault();
          const button = event.currentTarget.querySelector('button');
          const data = Object.fromEntries(new FormData(event.currentTarget));
          button.disabled = true;
          try { await callback(data); }
          catch (e) {
            if (e.message === 'display_name_required_for_new_account' || e.message === 'id_taken') {
              el('new-account').open = true;
              el('verify').elements.display_name.focus();
            }
            status(errors[e.message] || e.message);
          }
          finally { button.disabled = false; }
        });
      }
      submit('send', async data => {
        const result = await api('/api/auth/request-code', data);
        email = data.email;
        el('verify').hidden = false;
        el('verify').elements.code.focus();
        status(result.message);
      });
      submit('verify', async data => {
        const result = await api('/api/auth/verify-code', { ...data, email });
        token = result.token;
        el('verify').reset();
        el('signin').hidden = el('apply').hidden = true;
        el('members').hidden = false;
        el('profile').href = '/u/' + encodeURIComponent(result.account.id);
        status('Signed in as ' + result.account.display_name + '.');
        await refreshQueue();
      });
      submit('request', async data => {
        const result = await api('/api/auth/request-access', data);
        status(result.message);
      });
      submit('invite', async data => {
        const result = await api('/api/invites', data);
        status(result.message);
      });
      el('logout').onclick = async () => {
        try { await api('/api/auth/logout', {}); location.reload(); }
        catch (e) { status(e.message); }
      };
      async function refreshQueue() {
        let result;
        try { result = await api('/api/admin/signup-requests'); }
        catch (e) { if (e.message === 'forbidden') return; throw e; }
        el('review').hidden = false;
        el('queue').replaceChildren();
        if (!result.requests.length) el('queue').textContent = 'No pending requests.';
        for (const item of result.requests) {
          const row = document.createElement('p');
          row.textContent = item.email + (item.note ? ' · ' + item.note : '') + ' ';
          for (const [action, label] of [['approve','Approve'], ['decline','Decline']]) {
            const button = document.createElement('button');
            button.textContent = label;
            button.onclick = async () => {
              button.disabled = true;
              try {
                await api('/api/admin/signup-requests/' + item.id + '/' + action, {});
                status(label === 'Approve' ? 'Approved.' : 'Declined.');
              } catch (e) { status(e.message); }
              finally { button.disabled = false; }
              await refreshQueue();
            };
            row.append(button);
          }
          el('queue').append(row);
        }
      }
    })();
    </script>`;
  return new Response(htmlPage('Join Cognixenia', body), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
  } });
}
