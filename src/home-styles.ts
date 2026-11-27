// Scoped to the homepage by htmlPage.
export const homeStyles = `
  body { max-width: 62rem; padding: clamp(.75rem, 3vw, 2rem); }
  .mast {
    position: relative; isolation: isolate; overflow: hidden; padding: clamp(2rem, 6vw, 4.5rem) clamp(1.25rem, 5vw, 3.5rem);
    background: radial-gradient(ellipse at 84% 25%, #3e5668, transparent 53%), linear-gradient(115deg, #182737, #273e50);
    color: #f5ead5; border: 1px solid #47586a; box-shadow: inset 0 0 0 5px #ffffff08;
  }
  .mast h1 { position: relative; font: 500 clamp(3.1rem, 9vw, 6.6rem)/.95 Georgia, serif; letter-spacing: -.065em; }
  .mast h1 i { font-weight: normal; color: #e4c895; }
  .mast p { position: relative; font: normal clamp(.94rem, 2vw, 1.15rem)/1.5 Georgia, serif; margin: 1rem 0 0; }
  .orbit { position: absolute; z-index:-1; width: 22rem; height: 22rem; right:-3.7rem; top:-7rem;
    border-radius:50%; border: 1px solid #d1bc9266;
    background: repeating-radial-gradient(circle, transparent 0 29px, #d5c19a38 30px, transparent 31px);
  }
  .orbit::before, .orbit::after { content:""; position:absolute; border:1px solid #d7c2967a; border-radius:50%; inset:43% -17%; transform: rotate(-35deg); }
  .orbit::after { inset: 12% 26%; transform: rotate(-35deg); }
  nav { gap:1.5rem; justify-content:flex-start; padding:.55rem .95rem; border:1px solid var(--border); border-top:0; margin:0 0 1.5rem; background:var(--code-bg); }
  nav a[aria-current] { color:var(--fg); } nav .text-link { margin-left:auto; }
  main { overflow-wrap:anywhere; }
  .home-grid { display:grid; grid-template-columns:minmax(0,2.35fr) minmax(12rem,1fr); gap:1rem; align-items:start; }
  .panel { border:1px solid var(--border); }
  .panel h2 { margin:0; padding:.5rem 1rem; font:600 .94rem/1.4 var(--font-heading); background:var(--accent-light); color:var(--fg); border-bottom:1px solid var(--border); }
  .room-list { margin:0; padding:0; list-style:none; }
  .room-list li { margin:0; padding:1.1rem 1.2rem; }
  .room-list li + li, .older { border-top:1px dotted var(--border); }
  .room-list h3 { font: bold 1.45rem/1.25 Georgia,serif; margin:.4rem 0; }
  .room-list h3 a { color:var(--fg); text-decoration-thickness:1px; text-underline-offset:.15em; }
  .room-list p { margin:0 0 .6rem; } .host, .room-event, .older, .shelf a { font: .85rem/1.5 var(--font-heading); }
  .room-event, .host { color:var(--fg-secondary); }
  .shelf div, .empty, .older { display:block; padding:1rem 1.2rem; margin:0; }
  .shelf div p { margin:0 0 .65rem; } a:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
  @media(max-width:42rem) { .home-grid { grid-template-columns:1fr; } .orbit { opacity:.5; right:-11rem; } }
`;
