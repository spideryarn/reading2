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
 * docs/plans/auth-ui-and-production.md § The environment variables
 */
import { createClient } from "@supabase/supabase-js";

function required(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY"): string {
  const value = import.meta.env[name];
  if (typeof value === "string" && value !== "") return value;
  throw new Error(
    `${name} is not set. It is compiled into the bundle at build time, so set it ` +
      `before building — in .env.local locally, on the Vercel project for a deploy. ` +
      `See docs/plans/auth-ui-and-production.md.`,
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
