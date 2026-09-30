/**
 * Read and write the REMOTE Supabase project's auth configuration.
 *
 *     npx tsx scripts/supabase-auth-config.ts show
 *     npx tsx scripts/supabase-auth-config.ts apply [--dry-run]
 *     npx tsx scripts/supabase-auth-config.ts smtp [--dry-run]
 *     npx tsx scripts/supabase-auth-config.ts templates [--dry-run]
 *
 * `apply` writes the Google sign-in settings; `smtp` writes the outgoing-mail
 * settings (Resend, since 2026-09-29 — docs/project/email.md); `templates`
 * writes the subject and HTML of the two auth emails in scope, read from
 * supabase/config.toml and supabase/templates/ (since 2026-09-30). They are
 * separate commands so that fixing one never re-sends another's secret.
 *
 * Written on 2026-08-27, when "Continue with Google" on www.spideryarn.com
 * returned `{"msg":"Unsupported provider: provider is not enabled"}` — the
 * remote project had Google switched off, and the last two plans had left that
 * as a dashboard chore nobody had done. See
 * docs/plans/260827i-google-sign-in-production.md.
 *
 * ## Why not the dashboard
 *
 * Six clicks in a browser leave nothing behind. Nothing to re-run after a
 * project is restored from backup, nothing to read back, nothing to diff, and
 * nothing that says *what* was set when somebody asks in a month. `show` prints
 * the settings this app depends on; each writing command then re-reads
 * them from the server rather than reporting its own intentions.
 *
 * ## Why not `supabase config push`
 *
 * The CLI has exactly that command, it is one word, and it would be a
 * catastrophe. It sends the whole of supabase/config.toml at the remote —
 * including `[auth.external.google].skip_nonce_check = true`, whose own comment
 * in that file says in capitals that it is LOCAL ONLY (Google's nonce check is
 * real work on a real project), and a `site_url` of `http://localhost:5273`.
 * The obvious command is the wrong one.
 *
 * ## The field names were read, not remembered
 *
 * Every key written below — the Google, SMTP, email-rate-limit and template fields —
 * comes from the live OpenAPI document at
 * https://api.supabase.com/api/v1-json, schema `UpdateAuthConfigBody`. That
 * matters because the API takes a partial object and **ignores keys it does not
 * know** — an invented field name produces a 200, a success message, and no
 * change at all. Which is the pattern in docs/reusable/silent-success.md, with
 * a login on the end of it.
 *
 * Two shapes in there are worth knowing and are easy to get backwards:
 *
 *   * `uri_allow_list` is a **comma-separated string**, not an array. The spec
 *     types it `string`, and `site_url` is typed with the pattern `^[^,]+$` —
 *     which is the same fact seen from the other side.
 *   * `/**` and not `/*` in a glob. One star does not cross a slash, so `/*`
 *     matches `/auth` and not `/auth/callback`. It looks right and silently
 *     matches nothing.
 *
 * ## The token
 *
 * `SUPABASE_ACCESS_TOKEN`, a personal access token from
 * https://supabase.com/dashboard/account/tokens, in `.env.local`. The Supabase
 * CLI on this machine is already logged in and its token is in the macOS
 * keychain; an agent cannot read that (the sandbox blocks
 * `security find-generic-password`, correctly), but a human can hand it over
 * for one command without it being written down anywhere:
 *
 *     SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" \
 *       -a access-token -w | sed 's/^go-keyring-base64://' | base64 -d) \
 *       npx tsx scripts/supabase-auth-config.ts show
 *
 * **`-a access-token` is not optional**, and leaving it off is not a no-op: the
 * CLI keeps several items under that service name, `-s` alone returns whichever
 * comes first, and here that is a *project's* secret keyed by its ref. It
 * decodes cleanly, looks like a credential, and the API answers
 * `401 JWT could not be decoded`. Written down because the first version of
 * this comment had it wrong and cost Greg a confusing minute.
 *
 * This token is a *management* credential — it can create and delete projects.
 * Nothing in this script prints it, and `.env.local` is gitignored.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";

import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";

loadEnvLocal();

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The production origin, and the thing every other value here is derived from.
 *
 * `spideryarn.com` 308s to `www.spideryarn.com` (measured 2026-08-27), so the
 * `www` spelling is the one a reader's browser is actually on when it asks for
 * a sign-in, and therefore the one `redirectTo` carries.
 */
const SITE_URL = "https://www.spideryarn.com";

/**
 * Where Supabase is allowed to send a reader after a provider answers.
 *
 * **Exact paths, not `/**`.** This app has exactly one return address —
 * `callbackUrl()` in src/web/lib/supabase.ts, used by both `signInWithOAuth`
 * and `signUp`, and nothing else in src/web/ passes a `redirectTo` at all. A
 * `/**` would let this project bounce a reader carrying a one-time code to any
 * path on those hosts; naming the one path we use costs nothing today.
 * GPT Sol's suggestion, and the price is that **adding a new return address
 * (a password-reset landing, say) means adding it here too** — it will fail
 * silently otherwise, see below.
 *
 * A rejected `redirect_to` does not error. Supabase substitutes `site_url` and
 * carries on, so the reader arrives signed in on the wrong address rather than
 * seeing anything go wrong. That is why the list has to be right rather than
 * merely permissive-enough, and why `site_url` matters even though every
 * request here supplies its own `redirect_to`.
 *
 * The `vercel.app` entries trust every deployment under those names. A known
 * cost, accepted while the account is one person's, and it shrinks the day the
 * generated hostnames are removed — docs/project/deployment.md § Who can reach
 * it.
 *
 * No `localhost` entry. Local development signs in against the *local* Supabase
 * stack, which has its own allow-list in supabase/config.toml; an entry here
 * would let this project redirect to a developer's machine and buy nothing.
 */
const ALLOW_LIST = [
  "https://www.spideryarn.com/auth/callback",
  /* The apex 308s to `www` at Vercel's edge, before any of our code runs, so
     nothing can currently ask to return here. One line against the day that
     redirect changes. */
  "https://spideryarn.com/auth/callback",
  "https://spideryarn-greg-detre.vercel.app/auth/callback",
  "https://spideryarn-*-greg-detre.vercel.app/auth/callback",
  /* Probably redundant — `*` spans hyphens, so the glob above should already
     match `spideryarn-reading2-<hash>-greg-detre…`. Kept because "probably" is
     doing the work in that sentence: a redundant entry costs nothing, and the
     failure if the glob's separator set is not what I think it is would be a
     preview deployment that cannot sign in for no visible reason. */
  "https://spideryarn-reading2-*-greg-detre.vercel.app/auth/callback",
];

/** The settings this app depends on, and the only ones `show` prints. */
const WATCHED = [
  "site_url",
  "uri_allow_list",
  "external_google_enabled",
  "external_google_client_id",
  "external_google_secret",
  "external_google_skip_nonce_check",
  "external_email_enabled",
  "disable_signup",
  "mailer_autoconfirm",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_admin_email",
  "smtp_sender_name",
  "rate_limit_email_sent",
  "mailer_subjects_confirmation",
  "mailer_templates_confirmation_content",
  "mailer_subjects_recovery",
  "mailer_templates_recovery_content",
] as const;

/**
 * The auth emails with our own words, as GoTrue names them. Only the two the
 * work covers: a sign-up confirmation and a password recovery. Adding one is
 * a line here, a section in supabase/config.toml and a file in
 * supabase/templates/. docs/plans/260930h-auth-emails-in-spideryarn-s-voice.md.
 */
export const EMAIL_TEMPLATES = ["confirmation", "recovery"] as const;

/**
 * The fields `templates` writes, built from supabase/config.toml.
 *
 * **config.toml is the one home for the subject lines**, and the local stack
 * reads the same sections, so what production sends and what the local mail
 * catcher shows cannot drift apart. `content_path` there is relative to the
 * repo root (the Supabase CLI's convention), so it is resolved against `root`.
 *
 * Refuses a missing section, subject or file, a path other than
 * `supabase/templates/<name>.html`, any template action other than the one
 * `{{ .ConfirmationURL }}` action link, or any link other than that action and
 * the hello@ mailto link. A PATCH of `""` would quietly put Supabase's default
 * back, and a swapped path would send the wrong email under the right subject.
 */
export function templatesBody(
  configToml: string,
  root: string,
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): Record<string, string> {
  const config = parseToml(configToml) as {
    auth?: { email?: { template?: Record<string, { subject?: unknown; content_path?: unknown }> } };
  };
  const sections = config.auth?.email?.template ?? {};
  const body: Record<string, string> = {};
  for (const name of EMAIL_TEMPLATES) {
    const section = sections[name];
    const subject = section?.subject;
    const contentPath = section?.content_path;
    if (typeof subject !== "string" || subject.trim() === "") {
      throw new Error(`supabase/config.toml has no subject for [auth.email.template.${name}].`);
    }
    if (subject !== subject.trim()) {
      throw new Error(`[auth.email.template.${name}] subject has leading or trailing whitespace.`);
    }
    if (typeof contentPath !== "string" || contentPath === "") {
      throw new Error(`supabase/config.toml has no content_path for [auth.email.template.${name}].`);
    }
    const expected = `supabase/templates/${name}.html`;
    if (path.relative(root, path.resolve(root, contentPath)) !== expected) {
      throw new Error(`[auth.email.template.${name}] content_path must be ${expected}, not ${contentPath}.`);
    }
    const html = read(path.resolve(root, contentPath));
    /* The rendered link itself, not the variable anywhere: a comment that
       mentions it — or holds a whole disabled anchor — must not pass with the
       working button deleted. Go-template actions are still checked against
       the unstripped source below because Go evaluates them inside comments. */
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
    const hrefs = [
      ...withoutComments.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi),
    ].map(
      (match) => match[1] ?? match[2] ?? match[3],
    );
    if (hrefs.filter((href) => href === "{{ .ConfirmationURL }}").length !== 1) {
      throw new Error(`${contentPath} needs exactly one href="{{ .ConfirmationURL }}", its button.`);
    }
    if (
      hrefs.length !== 2 ||
      hrefs.filter((href) => href === "mailto:hello@spideryarn.com").length !== 1
    ) {
      throw new Error(`${contentPath} must have one action link and one hello@ mailto link, no others.`);
    }
    const actions = html.match(/\{\{[\s\S]*?\}\}/g) ?? [];
    const outsideActions = html.replace(/\{\{[\s\S]*?\}\}/g, "");
    if (
      actions.length !== 1 ||
      actions[0] !== "{{ .ConfirmationURL }}" ||
      /\{\{|\}\}/.test(outsideActions)
    ) {
      throw new Error(`${contentPath} may contain only Go-template action {{ .ConfirmationURL }}.`);
    }
    body[`mailer_subjects_${name}`] = subject;
    body[`mailer_templates_${name}_content`] = html;
  }
  return body;
}

/**
 * Outgoing auth mail — confirmations, password resets, magic links — through
 * Resend's SMTP relay rather than Supabase's built-in sender.
 *
 * The built-in one is capped at 2 emails an hour for the whole project (read
 * from the live config, 2026-09-29), with `mailer_autoconfirm` off, so the
 * third email sign-up in an hour got no confirmation at all. 30 an hour is
 * Supabase's own default once custom SMTP is on, and sits well inside Resend's
 * free-plan 100 a day.
 *
 * Values from https://resend.com/docs/send-with-supabase-smtp. The password is
 * a Resend API key; the user is the literal string `resend`.
 */
const SMTP = {
  smtp_host: "smtp.resend.com",
  smtp_port: "465",
  smtp_user: "resend",
  /* The site's one contact address (docs/project/website-text.md), so a
     reader who replies to a confirmation reaches a person. */
  smtp_admin_email: "hello@spideryarn.com",
  smtp_sender_name: "Spideryarn",
  rate_limit_email_sent: 30,
};

function envFromProd(name: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, ".env.prod"), "utf8");
  } catch {
    return undefined;
  }
  const match = new RegExp(`^${name}=(.*)$`, "m").exec(text);
  return match?.[1]?.trim().replace(/^"|"$/g, "");
}

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

/**
 * The project ref, out of a Supabase URL, refusing anything that is not a
 * remote project.
 *
 * **The refusal is the reason this is a function and not a constant.** Pointing
 * a config writer at the local stack is the mistake that costs an afternoon,
 * because every write appears to succeed — a Docker container answers, GoTrue
 * restarts, the settings really do change, and nothing anywhere says you have
 * been configuring your laptop. `.env.local` holds `http://127.0.0.1:54361`,
 * `loadEnvLocal()` makes that file beat the shell, and the two variables are
 * one letter apart.
 *
 * Exported, and tested in tests/supabase-auth-config.test.ts, because a guard
 * that has never been seen to fire is not a guard. See
 * docs/reusable/silent-success.md.
 *
 * @throws if the URL is missing, unparseable, or not `*.supabase.co`
 */
export function refFromUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("No SUPABASE_URL in .env.prod. See docs/project/database.md.");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`SUPABASE_URL is not a URL: ${url}`);
  }
  const ref = host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : "";
  if (ref === "" || ref.includes(".")) {
    throw new Error(
      `SUPABASE_URL is ${url}, which is not a remote Supabase project.\n` +
        "This script only ever talks to production; the local stack is configured in supabase/config.toml.",
    );
  }
  return ref;
}

function projectRef(): string {
  try {
    return refFromUrl(envFromProd("SUPABASE_URL") ?? process.env.SUPABASE_URL);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
}

async function api(
  ref: string,
  token: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    die(`Supabase Management API said ${res.status}:\n${text.slice(0, 800)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function isSecret(key: string): boolean {
  return key.endsWith("_secret") || key === "smtp_pass";
}

/** Secrets are never printed, but their presence is a thing worth knowing. */
function display(key: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "<unset>";
  if (isSecret(key)) return "<set>";
  if (key === "external_google_client_id") {
    const id = String(value);
    return `${id.slice(0, 12)}… (${id.length} chars)`;
  }
  if (key.startsWith("mailer_templates_")) {
    return `<${String(value).length} chars of HTML>`;
  }
  if (key === "uri_allow_list") {
    const entries = String(value).split(",").filter(Boolean);
    return entries.length === 0 ? "<empty>" : `\n      ${entries.join("\n      ")}`;
  }
  return String(value);
}

function report(config: Record<string, unknown>): void {
  for (const key of WATCHED) {
    console.log(`  ${key.padEnd(32)} ${display(key, config[key])}`);
  }
}

function googleBody(): Record<string, unknown> {
  const clientId = process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID;
  const secret = process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET;
  if (!clientId || !secret) {
    die(
      "\nNo SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID / _SECRET in .env.local.\n" +
        "They are the OAuth client shared with the old app — docs/plans/260826w-auth-supabase.md.",
    );
  }

  return {
    external_google_enabled: true,
    external_google_client_id: clientId,
    external_google_secret: secret,
    /* Explicitly false, not merely omitted. The local stack sets it true
       because GoTrue's nonce check cannot succeed against a container, and this
       is the one place where copying that across would be silent and wrong. */
    external_google_skip_nonce_check: false,
    site_url: SITE_URL,
    uri_allow_list: ALLOW_LIST.join(","),
  };
}

function smtpBody(): Record<string, unknown> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    die(
      "\nNo RESEND_API_KEY in .env.local.\n" +
        "It is the sending-only key scoped to spideryarn.com —\n" +
        "docs/project/email.md.",
    );
  }
  return { ...SMTP, smtp_pass: key };
}

function fileTemplatesBody(): Record<string, string> {
  try {
    return templatesBody(readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8"), ROOT);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (command !== "show" && command !== "apply" && command !== "smtp" && command !== "templates") {
    die("Usage: npx tsx scripts/supabase-auth-config.ts <show|apply|smtp|templates> [--dry-run]");
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    die(
      "No SUPABASE_ACCESS_TOKEN.\n\n" +
        "Make one at https://supabase.com/dashboard/account/tokens and put it in .env.local —\n" +
        "that is the reliable way, and it survives a CLI logout.\n\n" +
        "Or hand this one command the CLI's own token. Note `-a access-token`: without it\n" +
        "the keychain returns a different item under the same service name, and the API\n" +
        "answers `401 JWT could not be decoded`.\n\n" +
        '  SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" \\\n' +
        "    -a access-token -w | sed 's/^go-keyring-base64://' | base64 -d) \\\n" +
        `    npx tsx scripts/supabase-auth-config.ts ${command}\n`,
    );
  }

  const ref = projectRef();
  console.log(`project ${ref}\n`);

  const before = await api(ref, token);
  console.log("before:");
  report(before);

  if (command === "show") return;

  const body =
    command === "smtp"
      ? smtpBody()
      : command === "templates"
        ? fileTemplatesBody()
        : googleBody();

  console.log("\nwriting:");
  for (const [key, value] of Object.entries(body)) {
    console.log(`  ${key.padEnd(32)} ${display(key, value)}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing was written. (The GET above did happen.)");
    return;
  }

  await api(ref, token, { method: "PATCH", body: JSON.stringify(body) });

  /* A second GET rather than the PATCH's own response body. The API takes a
     partial object and ignores keys it does not recognise, so a 200 proves the
     request was well-formed and nothing else. Reading it back from the server
     is the only way to know a field landed. */
  const after = await api(ref, token);
  console.log("\nafter:");
  report(after);

  /**
   * Did each field land?
   *
   * Secrets cannot be compared literally, and `uri_allow_list` is a *set* that
   * happens to travel as a comma-separated string. An API free to trim, reorder
   * or dedupe the latter would otherwise make this shout about a write that
   * worked perfectly, and a check that cries wolf is a check that gets ignored
   * the day it is right. Ordinary scalar fields compare through `String` because
   * GET has returned both JSON numbers and strings for numeric configuration.
   */
  const landed = (key: string, sent: unknown): boolean => {
    /* A secret's *value* never comes back, but its presence does — and checking
       presence is the difference between "we cannot verify this" and "we did
       not look". A field name the API ignored leaves this empty, which is the
       failure this whole read-back exists for. What no GET can prove is that
       the secret is the RIGHT one; only the corresponding end-to-end operation
       does that — a Google sign-in or an auth email sent by Supabase. Sol's
       original finding. */
    if (isSecret(key)) {
      const got = after[key];
      return typeof got === "string" && got !== "";
    }
    const got = after[key];
    if (key === "uri_allow_list") {
      const parts = (v: unknown) =>
        new Set(
          String(v ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      const want = parts(sent);
      const have = parts(got);
      return want.size === have.size && [...want].every((entry) => have.has(entry));
    }
    return String(got ?? "") === String(sent);
  };

  const wrong = Object.entries(body).filter(([key, value]) => !landed(key, value));

  if (wrong.length > 0) {
    console.error(
      `\n${wrong.length} setting(s) did not read back exactly as sent: ${wrong.map(([k]) => k).join(", ")}\n` +
        "The API accepts unknown keys silently, and any server-side normalization would also\n" +
        "appear here. Inspect the read-back above before retrying; check field names against\n" +
        "https://api.supabase.com/api/v1-json (schema UpdateAuthConfigBody).",
    );
    process.exit(1);
  }

  const hasSecret = Object.keys(body).some(isSecret);
  console.log(
    `\nAll ${Object.keys(body).length} settings read back as written${hasSecret ? " — secrets by presence only" : ""}.`,
  );
  console.log(
    command === "smtp"
      ? "Now send a real one: request a password reset, and look for it in Resend's Emails log."
      : command === "templates"
        ? "Now send both real emails: sign up with a fresh address and request a recovery, then\n" +
          "check both subjects and buttons in the inbox (and Resend's Emails log)."
        : "Now: ./scripts/check-remote-auth.sh   (google must flip to ON)",
  );
}

/* Only when run, never when imported — tests/supabase-auth-config.test.ts imports
   `refFromUrl` from here, and a bare `await main()` would make that a live call
   to the Management API. Same guard as scripts/run-codex.ts. */
if (isMain(import.meta.url)) {
  await main();
}
