Review the plan in docs/plans/261003e-light-dark-and-system-appearance-on-profile.md before it is built. Read-only.

It adds a Light / Dark / System appearance choice on /profile to an app that has been dark-only (docs/project/web-client.md § Dark mode). Read the plan, then check it against the code: styles/tokens.css, styles/colourscales.css, src/web/styles/tokens.css, src/web/tailwind.css, index.html, src/web/main.tsx, src/web/boot.tsx, src/web/ProfilePage.tsx, and a sample of src/web/styles/*.css (site.css, logo-animations.css, mode-band.css, search.css) for the hard-coded colours.

Look especially for:
- anything that would make the page flash the wrong theme on load, or leave a stale theme (bfcache, a second tab, the System listener, Vite's handling of an inline script in index.html, a script-src or nonce anywhere in the server or Vercel config I missed);
- places colour is decided outside CSS (JS that reads computed colours, canvas, SVG fills, screenshot code in src/web/feedback-screenshot.ts, the /design page) that would stay dark;
- whether localStorage-per-device with a dark default is the right simplest version, versus something simpler or a profile column;
- whether the two proposed tests (token parity between the dark and light blocks; no bare white/black in component stylesheets) are checks that can actually fail, and what they would miss;
- the Tailwind @custom-variant dark selector proposed in decision 9: is it correct in Tailwind v4 with the tw: prefix and @layer app;
- anything in the plan that is wrong about the code.

Answer with numbered findings, each P0/P1/P2, the file and line, what is wrong and what to do instead. Then a one-paragraph verdict.
