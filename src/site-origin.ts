/**
 * **This deployment's own origin, from configuration and never from a request.**
 *
 * A `Host` an attacker chooses would become an address we hand out as ours —
 * where Stripe returns a paying reader, or where an MCP client is told to sign
 * in — and `X-Forwarded-Host` is the version of that mistake which looks
 * careful. The same reasoning as `PUBLIC_ORIGIN` in src/urls.ts, which is where
 * the production value lives.
 *
 * Production is decided first and reads no variable, so nothing in the
 * environment can point a production address anywhere but at us.
 * `SPIDERYARN_BASE_URL` exists for a local dev server that is not on 5273 —
 * every worktree after the first gets 5274, 5275… (docs/project/worktrees.md).
 * A preview deployment answers its own `VERCEL_URL`.
 *
 * Began as `billingReturnOrigin` in src/billing/checkout.ts, which now calls
 * this; moved here when the remote MCP server (src/mcp/remote.ts) needed the
 * same answer, so that there is one.
 */

import { isProductionDeployment } from "./billing/stripe.js";
import { log } from "./log.js";
import { PUBLIC_ORIGIN } from "./urls.js";

export function siteOrigin(): string {
  if (isProductionDeployment()) return PUBLIC_ORIGIN;

  const configured = process.env.SPIDERYARN_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      /* Fall through to the deployment host. A malformed override is worth a
         line rather than a throw on a route that sells things. */
    }
    log("http").warn({ configured }, "SPIDERYARN_BASE_URL is not an http(s) URL, so it was ignored");
  }

  const preview = process.env.VERCEL_URL?.trim();
  if (preview) return preview.includes("://") ? preview : `https://${preview}`;

  return "http://localhost:5273";
}
