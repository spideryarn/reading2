/**
 * A Playwright browser that is **signed in**, with no human anywhere in it.
 *
 *     npx tsx scripts/browser-sign-in.ts                     # prove it works
 *     npx tsx scripts/browser-sign-in.ts --at /?at=spya-k6fpme --shot /tmp/x.png
 *
 * ## Why this exists
 *
 * Every route past the gate needs a session (src/auth.ts), so a fresh browser on
 * the remote box can look at the landing page and nothing else. That is most of
 * what browser testing is for, and it is written into
 * docs/project/browser-testing-playwright.md as the thing that page could not
 * check.
 *
 * The credential was already there. `npm run db:seed-owner` has written a
 * password-holding `greg@gregdetre.com` since 2026-08-31, generated per machine
 * into `~/.config/spideryarn/local-admin-password`
 * (docs/plans/260831ab-seed-local-admin-user-for-remote-box.md). No Google, no
 * dashboard, no human. Nothing knew how to hand it to a browser; this does.
 *
 * ## It types into the real form, and that is a choice
 *
 * Three shortcuts exist and each was rejected for a reason worth keeping:
 *
 * - **Write the session into `localStorage`.** The SDK's storage shape is a
 *   private detail that has changed between versions, so guessing it gives you a
 *   browser that looks signed in to us and is signed out to the app — the
 *   silent-success pattern with a login on it. scripts/seed-local-session.ts
 *   wrote this down first.
 * - **Call `supabase.auth.signInWithPassword` inside the page**, reaching the
 *   app's own client through `import('/src/web/lib/supabase.ts')` as
 *   scripts/measure-cpu.ts does. It works, and only against the Vite dev server,
 *   which serves modules by source path. A built bundle has no such path.
 * - **A magic link and `verifyOtp`**, which is what measure-cpu.ts uses because
 *   it drives a Chrome it did not launch and had no password at the time. It
 *   needs the service-role key; this needs nothing privileged at all.
 *
 * Filling the form costs about a second more than any of them and exercises the
 * path a person uses, so a broken sign-in screen fails here rather than in front
 * of Greg.
 *
 * ## The evidence is a 200 from the server, not a rendered page
 *
 * `signIn` waits for `GET /api/library` to answer 200. A form that submitted, a
 * spinner that appeared, even a shelf heading — all of those are things the
 * client draws, and the client draws most of them whether or not the gate
 * accepted anything. The one fact worth waiting for is that the server took the
 * token. docs/reusable/silent-success.md.
 *
 * **And a 200 does not say whose session it is**, which is the half the first
 * version of this file got wrong: it printed "signed in as greg@gregdetre.com"
 * while having observed only that *some* accepted token reached the library
 * route. `/api/library` answers 200 for any authenticated user. GPT Sol, on the
 * built code, 2026-09-01.
 *
 * So both halves are asserted, independently:
 *
 * - **Who.** The password grant's own response is captured and its access
 *   token's `sub` compared with `ADMIN_USER_ID_LOCAL`. That is a *decode*, not a
 *   verification, and src/auth.ts is emphatic that decoding a token is never
 *   authentication — correctly, because there the token is a stranger's claim.
 *   Here it is the answer to a password *we* just supplied, and the question is
 *   "which account did I get", not "should this person be let in".
 *   `signInAs` in scripts/db-seed-owner.ts reads it the same way for the same
 *   reason.
 * - **What.** The library response is parsed, and has to be JSON carrying an
 *   `articles` array. A status alone would be satisfied by an HTML fallback.
 */
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";

import type { Browser, BrowserContext, Page, Response } from "playwright-core";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { isMain } from "../src/is-main.js";
import { readAdminCredentials } from "./seed-accounts.js";

/**
 * System Chrome, named explicitly, because a bare `chromium.launch()` asks for
 * Playwright's own bundled build and provisioning no longer downloads it —
 * docs/project/browser-control.md § On the remote box.
 *
 * Two defaults rather than one so this is runnable on the laptop too, even
 * though the laptop's answer for browser work is the Claude-in-Chrome extension.
 * `SPIDERYARN_CHROME` overrides both.
 */
const CHROME_BY_PLATFORM: Readonly<Record<string, string>> = {
  linux: "/usr/bin/google-chrome-stable",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
};

export function chromePath(): string {
  const named = process.env.SPIDERYARN_CHROME;
  if (named) return named;
  const guess = CHROME_BY_PLATFORM[platform()];
  if (guess && existsSync(guess)) return guess;
  throw new Error(
    `no Chrome found for platform ${platform()}${guess ? ` at ${guess}` : ""}.\n` +
      "  Set SPIDERYARN_CHROME to its path. On the box it is installed by\n" +
      "  infra/hetzner/provision.sh; see docs/project/browser-control.md.",
  );
}

/**
 * Where the dev server is.
 *
 * **5273 is a default, not a promise.** `npm run dev` moves to 5274 without
 * saying much when another agent in this shared tree already holds the port, and
 * a check pointed at the wrong one fails in a way that reads as a broken app —
 * docs/project/browser-testing.md § and check the port, not just the server.
 */
export function baseUrl(): string {
  return process.env.SPIDERYARN_BASE_URL ?? "http://localhost:5273";
}

/**
 * The seeded sign-in for this machine, or a thrown refusal that says what to run.
 *
 * `id` is the account this address is *supposed* to be on — a constant, not
 * something read back — so `signIn` can compare it against what actually came
 * back. `/api/admin/*` gates on this uuid rather than the address, and an
 * account holding the right email on the wrong id is a real failure with a silent
 * symptom (docs/postmortems/260828f-admin-id-was-the-local-one.md).
 */
export function devCredentials(home: string = homedir()): {
  email: string;
  password: string;
  id: string;
} {
  const found = readAdminCredentials(home);
  if (!found.ok) throw new Error(found.why);
  return { email: found.email, password: found.password, id: ADMIN_USER_ID_LOCAL };
}

/**
 * The `sub` in a JWT's payload, or nothing.
 *
 * **A decode, and deliberately not a verification** — see the header. It is used
 * to answer "which account did the password I just typed get me", which is a
 * question about our own request, not a decision about a stranger's.
 */
export function subOf(accessToken: string): string | undefined {
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof claims.sub === "string" ? claims.sub : undefined;
  } catch {
    return undefined;
  }
}

export interface SignedIn {
  email: string;
  /** The `sub` the grant actually returned, checked against the constant. */
  id: string;
  /** How many articles the shelf came back with — evidence, and often the news. */
  articles: number;
  /** How long the whole sign-in took, so a run says something measurable. */
  ms: number;
}

/**
 * Sign this page in, and do not return until the server has agreed.
 *
 * Starts at `/login` rather than `/`: both render the same `SignInControls`, but
 * the landing page is a pitch with the form some way down it, and `/login` is
 * the short screen that exists precisely so somebody can be *sent* to it
 * (src/web/SignInPage.tsx). The form itself starts collapsed behind the Google
 * button, so there is a click before there is a field.
 */
export async function signIn(page: Page, base: string = baseUrl()): Promise<SignedIn> {
  const { email, password, id } = devCredentials();
  const started = Date.now();

  await page.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "or use an email address" }).click();
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill(password);

  /* Both armed BEFORE the click. Either can answer before an `await` on the
     click resolves, and a listener attached afterwards would wait 30s for a
     response that had already been and gone. */
  const grant = page
    .waitForResponse((r: Response) => r.url().includes("/auth/v1/token"), { timeout: 30_000 })
    .then(async (r) => ({ status: r.status(), body: await r.text() }))
    .catch(() => undefined);
  const library = page
    .waitForResponse((r: Response) => new URL(r.url()).pathname === "/api/library", {
      timeout: 30_000,
    })
    /* Read the body here rather than after the race: a `Response` whose page has
       navigated on cannot always be read later. */
    .then(async (r) => ({ kind: "api" as const, status: r.status(), body: await r.text() }))
    /* Resolving rather than rejecting, so the race is decided by whichever
       *answers*, and the no-response case gets this file's message instead of
       Playwright's timeout — which says nothing about a sign-in. Sol's finding 6. */
    .catch(() => ({ kind: "never" as const, status: 0, body: "" }));

  /* `exact`, because Playwright matches an accessible name by substring and
     "Sign in with Google" contains "Sign in". Clicking that one navigates to
     Google and this function never returns. */
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  /* The form's own error, raced against the success. Without this a wrong
     password is a 30-second wait whose message is about a response that never
     arrived, when the page has been saying `Invalid login credentials` in a
     `role="alert"` since the first second. */
  const failed = page
    .getByRole("alert")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(async () => ({
      kind: "alert" as const,
      status: 0,
      body: await page.getByRole("alert").first().innerText(),
    }))
    .catch(() => ({ kind: "never" as const, status: 0, body: "" }));

  const outcome = await Promise.race([library, failed]);

  if (outcome.kind === "alert") {
    throw new Error(
      `sign-in was refused: ${outcome.body.trim()}\n` +
        "  If that is `Invalid login credentials`, the account and the password file have\n" +
        "  drifted apart — run `npm run db:seed-owner`, which sets it and says what it did.\n" +
        "  If it mentions a rate limit, that is 30 sign-ins per five minutes on the local\n" +
        "  stack (supabase/config.toml). Wait five minutes; nothing here can hurry it.",
    );
  }
  if (outcome.kind === "never") {
    throw new Error(
      `no GET /api/library and no error on the page within 30s of submitting ${base}/login.\n` +
        "  Is the dev server the one you think? `npm run dev` moves to 5274 when another\n" +
        "  agent in this tree already holds 5273 — docs/project/browser-testing.md.",
    );
  }
  if (outcome.status !== 200) {
    throw new Error(
      `signed in, but GET /api/library answered ${outcome.status}.\n` +
        "  The form worked and the gate did not accept the session, which is the failure\n" +
        "  this check exists for. 401 → src/auth.ts; 503 → is SUPABASE_URL reachable?",
    );
  }

  /* **Not just a status.** A 200 carrying an HTML shell would satisfy the line
     above and mean nothing; this is the shape the shelf actually reads. */
  let articles: number;
  try {
    const shelf = JSON.parse(outcome.body) as { articles?: unknown };
    if (!Array.isArray(shelf.articles)) throw new Error("no `articles` array");
    articles = shelf.articles.length;
  } catch (err) {
    throw new Error(
      `GET /api/library answered 200 with something that is not the shelf: ` +
        `${err instanceof Error ? err.message : String(err)}.\n` +
        `  First 120 characters: ${JSON.stringify(outcome.body.slice(0, 120))}\n` +
        "  A 200 alone is satisfied by the dev server's SPA fallback, which is why this\n" +
        "  reads the body.",
    );
  }

  /* **And who.** See the header: `/api/library` is happy with anybody's session,
     so the identity comes from the grant we just made. */
  const token = await grant;
  if (token?.status !== 200) {
    throw new Error(
      `the shelf loaded, but the password grant itself was not seen (status ` +
        `${token?.status ?? "none"}), so who this session belongs to is unknown.\n` +
        "  Refusing to print an identity nothing observed.",
    );
  }
  const sub = subOf((JSON.parse(token.body) as { access_token?: string }).access_token ?? "");
  if (sub !== id) {
    throw new Error(
      `signed in as ${email}, but the token is for ${sub ?? "an account with no sub"}, not ${id}.\n` +
        "  src/admin.ts gates on the id, not the address, so that session is not the\n" +
        "  administrator however right the email looks. Run `npm run db:seed-owner`, which\n" +
        "  refuses and says which of the two things to do.",
    );
  }

  return { email, id, articles, ms: Date.now() - started };
}

export interface SignedInBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  who: SignedIn;
}

/**
 * Launch, sign in, hand back the page. The caller closes `browser`.
 *
 * A fresh `newContext` every time and no saved `storageState`: signing in takes
 * about a second and a half, and a cached session file is one more thing that
 * can be stale in a way that reads as a broken app. Add caching when something
 * shows it is needed.
 */
export async function signedInBrowser(options: {
  base?: string;
  viewport?: { width: number; height: number };
} = {}): Promise<SignedInBrowser> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath(),
    /* The box runs as an unprivileged user with no user namespaces to spare, so
       Chrome's own sandbox cannot start. scripts/remote-smoke-browser.mjs. */
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const who = await signIn(page, options.base ?? baseUrl());
    return { browser, context, page, who };
  } catch (err) {
    /* A leaked Chrome on a box running many agents is not a small mess, and the
       caller cannot close a browser it was never handed. */
    await browser.close().catch(() => {});
    throw err;
  }
}

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

/**
 * Open a page and say whether it is **the page you asked for**.
 *
 * The first version waited for `document.querySelector("main, aside")`, called
 * that "something only the real page has", and it is nothing of the kind: the
 * landing page, the library, the profile, the sign-in screen and `NotSharedPage`
 * all render a `<main>`. So `--at /read/not-a-real-article` printed `ok` next to
 * a page reading *Not shared*. GPT Sol's fourth finding, 2026-09-01, with the
 * command to reproduce it.
 *
 * What is checked instead is what the *server* said while the page loaded:
 *
 * - **no 401 or 403** on any `/api/` call — that is the signed-out shape, and it
 *   is also what a session belonging to somebody else looks like on somebody's
 *   article;
 * - **no other failure status either.** `--at /read/nothing-here` reaches
 *   `NotSharedPage`, which renders `<main>`, fetched `/api/jobs` perfectly
 *   happily, and 404ed only on the article — so "at least one 2xx" was still
 *   satisfied and the run still said `ok`. Measured after the first fix, which
 *   is why this rule is "nothing failed" rather than "something succeeded";
 * - **at least one 2xx** from `/api/`, so a page that fetched nothing at all is
 *   not mistaken for a page that loaded;
 * - **no sign-in field on screen**, which is the one client-side check worth
 *   having because it is precise rather than generic.
 *
 * Every `/api/` call it saw is printed either way, so a 404 that does not fail
 * the run is still in front of you.
 */
async function open(page: Page, target: string): Promise<string[]> {
  const seen: { path: string; status: number }[] = [];
  const listen = (response: Response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/")) seen.push({ path: pathname, status: response.status() });
  };
  page.on("response", listen);
  try {
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("main, aside") !== null, undefined, {
      timeout: 30_000,
    });
    /* The app fetches after it mounts, so the landmark above can be on screen
       before any request has been answered. Wait for the network to settle
       rather than reading `seen` the moment the DOM appears. */
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    const calls = seen.map((r) => `${r.status} ${r.path}`);
    const refused = seen.filter((r) => r.status === 401 || r.status === 403);
    if (refused.length > 0) {
      throw new Error(
        `${target} was refused: ${refused.map((r) => `${r.status} ${r.path}`).join(", ")}\n` +
          "  The session is not signed in, or not signed in as whoever owns this.",
      );
    }
    const failed = seen.filter((r) => r.status >= 400);
    if (failed.length > 0) {
      throw new Error(
        `${target} loaded, but ${failed.length} of its api calls failed: ` +
          `${failed.map((r) => `${r.status} ${r.path}`).join(", ")}\n` +
          "  A 404 on the article is what a slug that does not exist looks like: the page\n" +
          "  still renders, as `Not shared`, with a `<main>` and a title.\n" +
          `  All ${calls.length} call(s): ${calls.join(", ")}`,
      );
    }
    if (!seen.some((r) => r.status >= 200 && r.status < 300)) {
      throw new Error(
        `${target} rendered without a single successful /api/ call.\n` +
          `  Saw: ${calls.length > 0 ? calls.join(", ") : "nothing at all"}\n` +
          "  The dev server answers 200 with the app shell for every path it does not know,\n" +
          "  so a page appearing is not the same as a page existing.",
      );
    }
    if ((await page.locator("#signin-email").count()) > 0) {
      throw new Error(`${target} is showing the sign-in form — the session did not survive.`);
    }
    return calls;
  } finally {
    page.off("response", listen);
  }
}

if (isMain(import.meta.url)) {
  const base = flag("base") ?? baseUrl();
  const at = flag("at");
  const shot = flag("shot");
  let session: SignedInBrowser | undefined;
  try {
    session = await signedInBrowser({ base });
    const { page, who } = session;
    const lines = [
      `ok  signed in as ${who.email} (${who.id}) in ${who.ms}ms, ` +
        `GET /api/library → 200 with ${who.articles} article(s)`,
    ];

    if (at) {
      const target = new URL(at, base).href;
      const calls = await open(page, target);
      lines.push(`    ${target} → ${JSON.stringify(await page.title())}`);
      lines.push(`    ${calls.length} api call(s): ${calls.join(", ") || "none"}`);
    }
    if (shot) {
      await page.screenshot({ path: shot, fullPage: false });
      lines.push(`    screenshot ${shot}`);
    }
    console.log(lines.join("\n"));
  } catch (err) {
    console.error(`FAIL ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await session?.browser.close().catch(() => {});
  }
}
