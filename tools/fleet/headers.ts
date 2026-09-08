/**
 * The response headers that hold whether or not the code below them is correct.
 *
 * GPT Astra's A6, 2026-09-08, and it was careful to say it was naming an
 * **architectural exposure** rather than claiming an exploit exists — it called
 * the client's React text rendering a good decision. The exposure is real
 * anyway, and it is peculiar to this tool:
 *
 * **This page is a privileged renderer of hostile content.** Its reader is one
 * person, but what it renders — session titles, pending questions, pane
 * excerpts, transcript tails — is written by ~40 autonomous agents that are
 * themselves processing untrusted input: web pages, article text, other agents'
 * output. And since 2026-09-08 the page can type into those same sessions. So
 * the content and the capability meet in one document, which is the situation a
 * CSP is actually for.
 *
 * TWO THINGS THE ORIGIN CHECK DOES NOT DO, which is why this file exists
 * alongside it rather than instead of it:
 *
 *  - **It does not stop framing.** A malicious page can embed the real
 *    dashboard and get somebody to click through it; every request that results
 *    is same-origin and correctly signed, because it really is the dashboard
 *    making it. `frame-ancestors 'none'` is the fix, and `X-Frame-Options` is
 *    the same instruction for anything that predates it.
 *  - **It does not survive an XSS.** Script running in this origin defeats every
 *    CSRF protection here by construction, because it *is* the origin. The CSP
 *    is the layer that assumes the escaping failed.
 *
 * SET ONCE IN `handler()`, BEFORE ROUTING, rather than merged into each
 * `writeHead`. There are five response paths in this tool and two of them are in
 * modules built by other agents; a header that has to be remembered at each exit
 * is one that will be missing from the sixth. `setHeader` values survive a later
 * `writeHead`, so the routes need to know nothing about this.
 */
import type { ServerResponse } from "node:http";

/**
 * `default-src 'none'` and then only what this page provably needs.
 *
 * The allowances, each with its reason, because a CSP nobody can explain is one
 * that gets widened by the next person who hits a console error:
 *
 *  - `script-src 'self'` — one content-hashed bundle from `web/dist/`. No CDN,
 *    no inline script, no `eval`. Vite's production build needs none of those.
 *  - `style-src 'self'` plus `style-src-attr 'unsafe-inline'` — the stylesheet
 *    is a real file, but React writes `style="..."` attributes for measured
 *    layout. Splitting the two directives is the point: inline *attributes* are
 *    permitted, inline `<style>` blocks are not, and the second is the one an
 *    injection would use.
 *  - `img-src 'self' data:` — the favicon is inlined as a data URI.
 *  - `connect-src 'self'` — `/api/state`, `/api/live`, and the write routes.
 *  - `base-uri 'none'` — an injected `<base>` retargets every relative URL on
 *    the page, including the ones the write routes are posted to.
 *  - `form-action 'none'` — there is no `<form>` here and there should not be
 *    one; a POST to somewhere else is exactly what an injection would want.
 *  - `frame-ancestors 'none'` — see the module comment. This is the clickjacking
 *    one and it is the reason A6 was raised before answer buttons ship.
 *
 * Deliberately NOT `upgrade-insecure-requests`: this is served over plain HTTP
 * on a tailnet address, and upgrading would break the page rather than secure
 * it. The transport is Tailscale's, not ours.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

/**
 * Everything that is not the CSP.
 *
 * `X-Frame-Options` duplicates `frame-ancestors` on purpose — belt and braces
 * costs one header, and the failure mode of getting this wrong is silent.
 *
 * `nosniff` matters more here than it looks: this server serves files off disk
 * by extension, and `TYPES` falls back to `application/octet-stream` for
 * anything it does not recognise. Without `nosniff` a browser may decide for
 * itself that an unrecognised file is HTML.
 *
 * `Referrer-Policy: no-referrer` because a tailnet hostname and a session id in
 * a URL fragment are not things to hand to anywhere else.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CSP,
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // **`microphone=(self)` since 2026-09-08, because voice dictation landed.**
  //
  // The line above used to say `microphone=()` and predicted its own successor:
  // *"when it lands, `microphone=(self)` goes here deliberately rather than by
  // discovering that the feature does not work."* It was discovered the second
  // way — a browser pass on the built page found one console line,
  // `Permissions policy violation: microphone is not allowed in this document`,
  // under a mic button that failed with `[mic-no-start]` and looked exactly like
  // the box's missing audio hardware. Worth recording, because the prediction
  // was right and the process still went the other way round.
  //
  // `(self)` and not `*`: this page's own script may open a microphone, an
  // iframe of somebody else's may not — and `frame-ancestors 'none'` above means
  // there should be no frames here at all.
  //
  // Camera, geolocation and payment stay closed. Nothing here wants them, and a
  // policy that names what it allows is one somebody can check.
  "permissions-policy": "camera=(), microphone=(self), geolocation=(), payment=()",
};

/** Applied to every response, before anything decides what the response is. */
export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}
