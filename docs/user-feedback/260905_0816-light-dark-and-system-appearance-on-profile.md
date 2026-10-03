---
reports: spya-nv5bzx
ending: shipped
---
# Light, Dark and System appearance, chosen on /profile

Report `spya-nv5bzx`, a suggestion, from Greg (admin), 2026-09-05, relayed by the Overseer as queue
item `qi-eay7j8xc`, on `https://www.spideryarn.com/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz?at=spya-stdmup&mode=hierarchy&cols=1,2&sort=difficulty&term=spya-mm38z3&idea=spya-rknamq`:

> Allow me to switch between Light, Dark, and System modes (in my Profile page).

**Ending: Shipped**, on `dev`. Plan
[261003e](../plans/261003e-light-dark-and-system-appearance-on-profile.md), with both GPT Sol reviews
and light/dark screenshot pairs of every page checked.

What changed:

- **/profile → Settings → Appearance: System, Light or Dark**, applied the moment it is picked.
  Kept on the device, in `localStorage`, so it is known before first paint and the page never
  flashes the other colour. **Unset is Dark**, so nobody's page changed until they chose.
- **A light palette for everything the app draws**: the brand and surface tokens, the semantic
  layer, every colour scale (each tested against its own page), the remaining hard-coded colours,
  orange used as text and as focus rings (both darkened on the light page to stay legible), and
  Google's own light sign-in button.
- Docs: [web-client.md § Appearance](../project/web-client.md#appearance-light-dark-and-system)
  replaces § Dark mode; design-css-overview.md and colour-scales.md follow.

Deferred, named in web-client.md § Appearance, What it does not do yet: cross-device sync; a picker
anywhere but /profile; the fleet dashboard; pictures with colour baked in (Illustrated images, the
marketing screenshots). The installed iPhone app's status bar (white clock over a light page) has its
own queue entry, `qi-c52veptt`, as a proposal for Greg.
