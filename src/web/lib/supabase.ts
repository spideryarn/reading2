/**
 * The Supabase client, made once, for the whole browser session.
 *
 * Module scope on purpose. Two clients on one page means two copies of the
 * session in `localStorage`, two refresh timers racing each other, and a token
 * that is valid in one half of the app and stale in the other.
 *
 * ## `flowType` is the line that is doing work
 *
 * The other three options below are already the browser defaults and are
 * written out anyway, because this is where somebody will come looking to turn
 * one of them off. **`flowType` is not a default.** Leave it out and you get
 * the implicit flow: a token in the URL fragment instead of a `?code=` in the
 * query string, which is a different thing arriving back at `/auth/callback`
 * than anything else in this app expects.
 *
 * ## Missing configuration throws here, loudly
 *
 * `VITE_*` variables are compiled into the bundle **at build time**. Setting
 * them on Vercel after a deploy changes nothing until the next build, and that
 * is the single most common way a Vite app ships pointing at localhost. The
 * failure is otherwise invisible: an `undefined` URL turns into requests to a
 * host that does not exist, and the reader sees a sign-in button that does
 * nothing at all.
 *
 * So it throws, by name, at module load. A blank page with one line in the
 * console beats a page that looks fine and cannot sign anybody in.
 *
 * docs/plans/260826ae-auth-ui-and-production.md § The environment variables
 */
import { createClient } from "@supabase/supabase-js";

/**
 * **The two reads are literal, and `required` indexes an ordinary object.**
 *
 * `import.meta.env[name]` read the same values and was just as correct, but a
 * computed key is invisible to any inventory of what this repo's configuration
 * actually is — the door `SPIDERYARN_ENV_PINNED` sat behind, unseen by every
 * inventory from the day it was written until something enumerated every read
 * (docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md).
 * Built inside the call rather than at module scope so each call reads the
 * environment exactly when it did before; three calls a session, and
 * `tests/google-availability.test.ts` stubs these before importing this module.
 */
function required(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY"): string {
  const configured: Record<"VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY", unknown> = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  const value = configured[name];
  if (typeof value === "string" && value !== "") return value;
  throw new Error(
    `${name} is not set. It is compiled into the bundle at build time, so set it ` +
      `before building — in .env.local locally, on the Vercel project for a deploy. ` +
      `See docs/plans/260826ae-auth-ui-and-production.md.`,
  );
}

/**
 * The publishable key is **not a secret** — it ships in this bundle by design,
 * and it grants nothing on its own. The secret key (`sb_secret_…`) must never
 * appear in any `VITE_` variable; `tests/no-secrets-in-bundle.test.ts` checks.
 */
export const supabase = createClient(
  required("VITE_SUPABASE_URL"),
  required("VITE_SUPABASE_PUBLISHABLE_KEY"),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Consumes the `?code=` on the way back from Google. See AuthCallback.tsx
      // for what this does NOT do, which is tell anybody when it fails.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  },
);

/** Where Google (or anyone else) sends the reader back to. See AuthCallback.tsx. */
export const CALLBACK_PATH = "/auth/callback";

export function callbackUrl(): string {
  return `${location.origin}${CALLBACK_PATH}`;
}

/**
 * Is Google actually switched on for this project?
 *
 * **Written because it wasn't, and the reader saw the raw JSON.** On 2026-08-27
 * Greg pressed Continue with Google on the live site and landed on
 * `supabase.co` looking at
 * `{"code":400,…,"msg":"Unsupported provider: provider is not enabled"}` —
 * no page, no back, nothing of ours anywhere on screen. See
 * docs/plans/260827i-google-sign-in-production.md.
 *
 * A `try`/`catch` around `signInWithOAuth` cannot help with that. It does not
 * make a request: it builds an authorize URL and assigns `location`, so by the
 * time the 400 exists our code has stopped running, on an origin that is not
 * ours. The only place to catch it is *before* the navigation. GPT Sol's
 * suggestion, reviewing the plan.
 *
 * ## It fails open, and that is the important line in this file
 *
 * The answer is `false` **only** when the project says so in as many words.
 * Offline, blocked, slow, a shape we do not recognise — all `true`, and the
 * sign-in proceeds exactly as it would have. A preflight that refuses when it
 * cannot reach the network would turn a flaky connection into "you cannot sign
 * in", which is a worse bug than the one it is guarding against and a much
 * harder one to report.
 *
 * The 2.5-second deadline is the same thought. This runs between a click and a
 * redirect, and a hung request must not be able to hold a reader on a button
 * that appears to have done nothing.
 *
 * Not on first paint. One request per press of one button, on a page that is
 * mostly a screenshot, rather than a request on every load of the landing page
 * to guard against a misconfiguration that ought to be fixed instead.
 */
export async function googleSignInAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${required("VITE_SUPABASE_URL")}/auth/v1/settings`, {
      headers: { apikey: required("VITE_SUPABASE_PUBLISHABLE_KEY") },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return true;
    const body: unknown = await res.json();
    const external = (body as { external?: Record<string, unknown> } | null)?.external;
    if (!external || typeof external !== "object") return true;
    return external.google !== false;
  } catch {
    return true;
  }
}
