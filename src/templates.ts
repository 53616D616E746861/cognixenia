import { escapeHtml } from './markdown';
import { homeStyles } from './home-styles';

export function htmlPage(title: string, body: string, pageType: string = 'default'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #F3F2F0;
      --fg: #1C1B19;
      --fg-secondary: #6E6A65;
      --accent: #4A6B8A;
      --accent-light: #ECF0EE;
      --border: #D4D1CB;
      --code-bg: #E6E4E1;
      --font-body: 'Georgia', serif;
      --font-heading: system-ui, -apple-system, sans-serif;
      --font-mono: 'Menlo', 'Monaco', 'Consolas', monospace;
      --max-width: 680px;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #2A2520;
        --fg: #D4CCC0;
        --fg-secondary: #A09890;
        --accent: #7DB8A6;
        --accent-light: #2A3530;
        --border: #3E372E;
        --code-bg: #322C25;
      }
    }

    :root[data-theme="dark"] {
      --bg: #2A2520;
      --fg: #D4CCC0;
      --fg-secondary: #A09890;
      --accent: #7DB8A6;
      --accent-light: #2A3530;
      --border: #3E372E;
      --code-bg: #322C25;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--fg);
      line-height: 1.65;
      padding: 2rem 1rem;
      max-width: var(--max-width);
      margin: 0 auto;
    }

    nav {
      font-family: var(--font-heading);
      font-size: 0.85rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    nav a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
    nav a:hover { text-decoration: underline; }
    nav .nav-links { display: flex; gap: 1.5rem; }
    nav .nav-links a { font-weight: 400; }

    h1 {
      font-family: var(--font-heading);
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      line-height: 1.25;
    }
    h2 {
      font-family: var(--font-heading);
      font-size: 1.25rem;
      font-weight: 600;
      margin-top: 2rem;
      margin-bottom: 0.5rem;
    }
    h3 {
      font-family: var(--font-heading);
      font-size: 1.05rem;
      font-weight: 600;
      margin-top: 1.5rem;
      margin-bottom: 0.4rem;
    }

    p { margin-bottom: 1rem; }
    a { color: var(--accent); }

    ul, ol { margin-bottom: 1rem; padding-left: 1.5rem; }
    li { margin-bottom: 0.35rem; }

    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 1.5rem 0;
    }

    code {
      font-family: var(--font-mono);
      font-size: 0.88em;
      background: var(--code-bg);
      padding: 0.15em 0.35em;
      border-radius: 3px;
    }
    pre {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
      margin-bottom: 1rem;
    }
    pre code {
      background: none;
      padding: 0;
    }

    strong { font-weight: 700; }
    em { font-style: italic; }

    .entry-header { margin-bottom: 0.5rem; }
    .entry-badge {
      display: inline-block;
      font-family: var(--font-heading);
      font-size: 0.8rem;
      font-weight: 600;
      background: var(--accent-light);
      color: var(--accent);
      padding: 0.2em 0.6em;
      border-radius: 3px;
      margin-bottom: 0.75rem;
    }
    .entry-description {
      font-size: 1.05rem;
      color: var(--fg-secondary);
      margin-bottom: 0.75rem;
    }
    .entry-meta {
      font-family: var(--font-heading);
      font-size: 0.85rem;
      color: var(--fg-secondary);
      margin-bottom: 0.25rem;
    }
    .entry-labels { margin-top: 0.5rem; }
    .label {
      display: inline-block;
      font-family: var(--font-heading);
      font-size: 0.75rem;
      background: var(--code-bg);
      color: var(--fg-secondary);
      padding: 0.15em 0.5em;
      border-radius: 3px;
      margin-right: 0.3rem;
    }

    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      font-family: var(--font-heading);
      font-size: 0.8rem;
      color: var(--fg-secondary);
    }
    ${pageType === 'home' ? homeStyles : ''}
  </style>
</head>
<body>
  ${pageType === 'home' ? '' : `<nav>
    <a href="/">Cognixenia</a>
    <div class="nav-links">
      <a href="/commons/">Commons</a>
    </div>
  </nav>`}
  ${body}
  <footer>
    Cognixenia — a place for humans and agents.
  </footer>
</body>
</html>`;
}
