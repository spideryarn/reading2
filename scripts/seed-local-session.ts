/**
 * Sign a measuring browser into the **local** Supabase, without a human.
 *
 * ## Why this exists
 *
 * Every route past the gate needs a session, so a fresh Chrome profile can
 * measure the sign-in screen and nothing else. That blocked the one number
 * [docs/project/performance.md](../docs/project/performance.md) most wanted —
 * what the reading view costs — for two days, behind "one human step, once".
 *
 * The step is gone. `npm run db:start` already runs a whole Supabase in Docker
 * on this laptop, its service-role key is in `.env.local`, and
 * [supabase-local.md](../docs/project/supabase-local.md) is explicit that those
 * keys are not secrets: they are the same fixed strings in every local install.
 *
 * ## Why a magic link rather than writing localStorage
 *
 * The obvious shortcut — mint a token and poke it into `localStorage` — needs
 * the exact shape the SDK stores, which is a private detail that has changed
 * between versions (it is base64-prefixed JSON under `sb-<ref>-auth-token`
 * today). Guessing it produces a browser that looks signed in to us and is
 * signed out to the app, which is the [silent-success](../docs/reusable/silent-success.md)
 * pattern with a login on it.
 *
 * So this asks the admin API for a real magic link and hands its `hashed_token`
 * to **the app's own SDK instance**, via `verifyOtp`. That client stores the
 * session under the key it reads, in the format its version writes. **We never
 * parse or write a token.**
 *
 * ## Why not just open the link
 *
 * Because the app is on `flowType: "pkce"`, and following the link lands on
 * `?code=…` which the SDK can only exchange using the code verifier **it stored
 * when it began the flow**. A fresh browser never began one. The exchange fails
 * silently — `_getSessionFromURL` returns the error to its caller and notifies
 * no subscriber ([useSession.ts](../src/web/useSession.ts) documents this) — and
 * you are left measuring a landing page that looks like an article still
 * loading. That happened here first, and it is why every run now prints what is
 * actually on screen.
 *
 * ## The guard
 *
 * It refuses to run against anything but `127.0.0.1` / `localhost`. A
 * service-role key is unlimited, and a script that mints sessions for arbitrary
 * users must not be one `.env` away from doing that to production.
 *
 *     npx tsx scripts/seed-local-session.ts --redirect http://localhost:5273/
 *
 * Prints one URL. Open it in the browser you want signed in — see
 * `--local-sign-in` in [measure-cpu.ts](measure-cpu.ts), which does exactly
 * that and then measures.
 */
import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

/** Local only, and checked on the host rather than on a substring of the URL. */
function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `refusing to mint a session against ${host} — this script is for the local Supabase only`,
    );
  }
}

interface AdminUser {
  id: string;
  email?: string;
  last_sign_in_at?: string | null;
}

export interface LocalLink {
  /** The full `/auth/v1/verify?...` URL. Useless to a PKCE client — see below. */
  actionLink: string;
  /**
   * The one that actually works here.
   *
   * The app is on `flowType: "pkce"` ([lib/supabase.ts](../src/web/lib/supabase.ts)), so following
   * a magic link lands on `?code=…` and the SDK then wants the **code verifier it stored when it
   * started the flow**. A browser that did not start the flow has no verifier, so the exchange
   * fails and you get a signed-out page that looks exactly like a signed-in one that has not
   * finished loading. Handing this hash to `auth.verifyOtp({ type: "magiclink", token_hash })`
   * skips the PKCE handshake entirely and lets the SDK store the session itself.
   */
  hashedToken: string;
}

export async function localMagicLink(redirectTo: string): Promise<LocalLink> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_URL is not set — is .env.local present?");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — is .env.local present?");
  assertLocal(base);

  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

  const email = flag("email", "");
  let target = email;
  if (!target) {
    const res = await fetch(`${base}/auth/v1/admin/users?per_page=50`, { headers });
    if (!res.ok) throw new Error(`admin/users ${res.status} — is \`npm run db:start\` running?`);
    const body = (await res.json()) as { users?: AdminUser[] };
    const users = body.users ?? [];
    if (users.length === 0) {
      throw new Error("no users in the local Supabase — sign in once locally, or pass --email");
    }
    /* The most recently used account, because a local install accumulates
       throwaways and the interesting one is the one with the articles. */
    const newest = [...users].sort(
      (a, b) => Date.parse(b.last_sign_in_at ?? "") - Date.parse(a.last_sign_in_at ?? ""),
    )[0];
    target = newest?.email ?? "";
    if (!target) throw new Error("the local user has no email address — pass --email");
  }

  const res = await fetch(`${base}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "magiclink", email: target, options: { redirect_to: redirectTo } }),
  });
  if (!res.ok) {
    throw new Error(`generate_link ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const link = (await res.json()) as { action_link?: string; hashed_token?: string };
  if (!link.action_link || !link.hashed_token) {
    throw new Error("generate_link returned no action_link/hashed_token");
  }
  return { actionLink: link.action_link, hashedToken: link.hashed_token };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  localMagicLink(flag("redirect", "http://localhost:5273/")).then(
    (link) => console.log(link.actionLink),
    (err: Error) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
