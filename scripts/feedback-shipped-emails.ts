/**
 * **Tell a reader their feedback is live**, once the deploy that ships it has
 * been verified.
 *
 *     npx tsx scripts/feedback-shipped-emails.ts                      # dry run, against origin/main
 *     npx tsx scripts/feedback-shipped-emails.ts --send               # what the deploy does
 *     npx tsx scripts/feedback-shipped-emails.ts --sha <commit> --cap 40 --send
 *     npx tsx scripts/feedback-shipped-emails.ts --retry <owner_id>/<report_id> --send
 *
 * `npm run deploy` runs this itself, as its last step, against the commit it
 * just shipped. The commands above are for a person.
 *
 * **It reconciles rather than diffs.** The reports whose note says `shipped`
 * in src/feedback-endings.generated.ts at that commit, joined in production to
 * their rows, their owners' current confirmed addresses and the ledger
 * `spideryarn.feedback_shipped_emails`: every one from a reader with no `sent`
 * (or in-flight) row gets one email. So a deploy whose step did not run, or
 * died half way, is caught up by the next one. Greg's words, the alternatives
 * and what is deferred: docs/plans/261002f-email-readers-when-their-feedback-ships.md.
 *
 * Never an admin (Greg: *"other than an admin - I will already be aware"*),
 * never an id two owners share, never an account without a confirmed address,
 * and never more than `RECIPIENT_CAP` letters in one run unless a person says
 * `--cap`. A CLI, so `console.log`; it prints account and report ids, never an
 * address.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { isAdmin } from "../src/admin.js";
import { sslDecisionFor } from "../src/db/ssl.js";
import { type Email, type EmailEnv, type SendResult, sendEmail } from "../src/email.js";
import { readEnvProd } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { FEEDBACK_KINDS, type FeedbackKind } from "../src/types.js";
import { migratorUrlFrom } from "./deploy-checks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GENERATED_REPO_PATH = "src/feedback-endings.generated.ts";

/**
 * **More letters than this in one run sends nothing**, unless a person passes
 * `--cap`. A deploy ships a handful of reports, and until 2026-10-02 every one
 * of them was Greg's. A run past this is likelier to be a bug — a map that
 * changed meaning, a ledger that was emptied — than a good day, and a mass
 * mailing cannot be taken back.
 */
export const RECIPIENT_CAP = 20;

/** The deploy step's name, also in `AFTER_THE_FACT_CHECKS`: the code is live, only a letter is missing. */
export const STEP_NAME = "feedback shipped emails";

const ENTRY = /^\s*"(spya-[a-z0-9]{6})":\s*"(shipped|declined|awaiting)",?\s*$/;

/**
 * The ids the generated map says shipped. **Throws rather than answer "none"**
 * when the file is not the shape this expects — any line that names a report
 * and does not parse, or no entries at all — because a parser that quietly
 * misses lines would quietly miss readers.
 */
export function shippedIdsIn(generated: string): string[] {
  const shipped: string[] = [];
  let entries = 0;
  for (const line of generated.split("\n")) {
    if (!line.includes('"spya-')) continue;
    const match = ENTRY.exec(line);
    if (!match?.[1]) throw new Error(`${GENERATED_REPO_PATH}: a line this does not understand: ${JSON.stringify(line.trim())}`);
    entries++;
    if (match[2] === "shipped") shipped.push(match[1]);
  }
  if (entries === 0) throw new Error(`${GENERATED_REPO_PATH}: no report endings found — has its format changed?`);
  return shipped.sort();
}

/** The ledger's states. `sending` is in flight, or a send that may have gone; only a person moves it on. */
export type LedgerStatus = "sending" | "sent" | "failed";

/** One `spideryarn.feedback` row for a shipped id, with what the join found. */
export interface ShippedRow {
  readonly ownerId: string;
  readonly reportId: string;
  readonly kind: string | null;
  readonly createdAt: Date;
  /** The owner's current, confirmed address; null when there is none we may use. */
  readonly email: string | null;
  /** Its ledger row's status, null when it has none. */
  readonly ledger: LedgerStatus | null;
  /** The reservation generation observed while planning. */
  readonly ledgerAttempts: number | null;
}

export type SkipReason =
  | "an admin's"
  | "already emailed"
  | "id shared by several owners"
  | "no confirmed address"
  | "a send that may have gone, or was interrupted — needs a person";

export interface Letter {
  readonly ownerId: string;
  readonly reportId: string;
  readonly email: Email;
  /** Compare-and-swap fence for a person's retry. */
  readonly observedAttempts: number | null;
}

export interface ShippedPlan {
  readonly letters: readonly Letter[];
  readonly skipped: ReadonlyMap<SkipReason, readonly string[]>;
  /** Shipped ids with no row at all — notes written for a report filed before the table, say. */
  readonly noRow: number;
  /** The ids behind `noRow`, so an operator can repair a typo or investigate erasure. */
  readonly missingRowIds: readonly string[];
  /** Set when there are more letters than the cap: send none. */
  readonly refused?: string;
}

export interface PlanOptions {
  readonly now: Date;
  readonly cap?: number;
  /** A person's `--retry`: only this report, and a stuck `sending` row may go again. */
  readonly retry?: { readonly ownerId: string; readonly reportId: string };
}

function knownKind(kind: string | null): FeedbackKind | null {
  return (FEEDBACK_KINDS as readonly (string | null)[]).includes(kind) ? (kind as FeedbackKind) : null;
}

/** Which reports get a letter. Pure: rows in, letters out. */
export function planShippedEmails(shippedIds: readonly string[], rows: readonly ShippedRow[], options: PlanOptions): ShippedPlan {
  const skipped = new Map<SkipReason, string[]>();
  const skip = (reason: SkipReason, id: string) => skipped.set(reason, [...(skipped.get(reason) ?? []), id]);
  const letters: Letter[] = [];
  const missingRowIds: string[] = [];
  const shipped = new Set(shippedIds);
  const ids = options.retry ? [options.retry.reportId].filter((id) => shipped.has(id)) : [...shipped].sort();
  for (const reportId of ids) {
    const matches = rows.filter((row) => row.reportId === reportId);
    const only = matches[0];
    if (!only) {
      missingRowIds.push(reportId);
      continue;
    }
    /* Report ids are unique per owner, not globally — the key is (owner_id, id)
       — and a note names an id, not an owner, so two owners means we cannot
       say whose report shipped. */
    if (matches.length > 1) skip("id shared by several owners", reportId);
    else if (options.retry && only.ownerId !== options.retry.ownerId) continue;
    else if (isAdmin(only.ownerId)) skip("an admin's", reportId);
    else if (only.ledger === "sent") skip("already emailed", reportId);
    else if (only.ledger === "sending" && !options.retry)
      skip("a send that may have gone, or was interrupted — needs a person", reportId);
    else if (!only.email) skip("no confirmed address", reportId);
    else {
      const { subject, text } = shippedEmail(knownKind(only.kind), only.createdAt, options.now);
      letters.push({
        ownerId: only.ownerId,
        reportId,
        email: { to: only.email, subject, text, idempotencyKey: feedbackIdempotencyKey(only.ownerId, reportId) },
        observedAttempts: only.ledgerAttempts,
      });
    }
  }
  const cap = options.cap ?? RECIPIENT_CAP;
  if (letters.length > cap) {
    return {
      letters: [],
      skipped,
      noRow: missingRowIds.length,
      missingRowIds,
      refused: `${letters.length} letters to send, more than the cap of ${cap}; sent none. Look at why, then re-run with --cap`,
    };
  }
  return { letters, skipped, noRow: missingRowIds.length, missingRowIds };
}

/** Stable at Resend without disclosing an account id or report id to it. */
export function feedbackIdempotencyKey(ownerId: string, reportId: string): string {
  const delivery = createHash("sha256").update(ownerId).update("\0").update(reportId).digest("hex");
  return `feedback-shipped/${delivery}`;
}

/** "2 October", with the year only when it is not this one. London time. */
function day(date: Date, now: Date): string {
  const year = (d: Date) => new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/London" }).format(d);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    ...(year(date) === year(now) ? {} : { year: "numeric" }),
    timeZone: "Europe/London",
  }).format(date);
}

/**
 * **The letter.** Plain text, and no word of the report itself: the reader
 * knows what they wrote, the Earlier tab shows it, and every copy of their
 * words in Resend's log is one more place an erasure must reach. The date is
 * there so they can tell which report this is. "Shipped a change in response
 * to it", never "fixed" or "built": a shipped ending may be a narrower version,
 * and a split report is shipped when one of its parts is. Greg may change the
 * words freely; the test pins the shape.
 */
export function shippedEmail(kind: FeedbackKind | null, createdAt: Date, now: Date): { subject: string; text: string } {
  const when = day(createdAt, now);
  const what =
    kind === "problem"
      ? "you told us about a problem"
      : kind === "suggestion"
        ? "you sent us a suggestion"
        : "you sent us feedback";
  return {
    subject: "A change based on your feedback is now live on Spideryarn",
    text: [
      "Hello,",
      `On ${when} ${what} through the Feedback button in Spideryarn. We've shipped a change in response to it, and it is now live.`,
      "Thank you. Reports like yours are how Spideryarn gets better.",
      "You can see what you've sent us, and which of it has shipped, under Feedback → Earlier.",
      "If it isn't quite what you had in mind, just reply to this email.",
      "Greg\nSpideryarn",
    ].join("\n\n"),
  };
}

/**
 * Every row for these ids, whoever owns it (the shared-id check needs them
 * all), with the owner's current address only if it is confirmed, the account
 * is not deleted and not banned, and the row's ledger status.
 */
export const SHIPPED_ROWS_SQL = `
  select f.owner_id::text as owner_id, f.id, f.kind, f.created_at,
         nullif(u.email, '') as email, l.status as ledger, l.attempts as ledger_attempts
  from spideryarn.feedback f
  left join auth.users u
    on u.id = f.owner_id
   and u.email_confirmed_at is not null
   and u.deleted_at is null
   and (u.banned_until is null or u.banned_until <= now())
  left join spideryarn.feedback_shipped_emails l
    on l.owner_id = f.owner_id and l.report_id = f.id
  where f.id = any($1::text[])`;

/**
 * **Reserve**: of any number of runs, one takes the row. A new row, or a
 * `failed` one; a person's retry may also take `sending`. Never `sent`.
 */
const RESERVE_SQL = (retry: boolean) => `
  insert into spideryarn.feedback_shipped_emails (owner_id, report_id, status, attempts)
  values ($1::uuid, $2, 'sending', 1)
  on conflict (owner_id, report_id) do update
     set status = 'sending', attempts = feedback_shipped_emails.attempts + 1, detail = null, updated_at = now()
   where ${
     retry
       ? `(feedback_shipped_emails.status = 'failed'
          or (feedback_shipped_emails.status = 'sending'
              and feedback_shipped_emails.attempts = $3
              and (feedback_shipped_emails.detail is not null
                   or feedback_shipped_emails.updated_at < now() - interval '10 minutes')))`
       : "feedback_shipped_emails.status = 'failed'"
   }
  returning attempts`;

/** Renew the attempt immediately before the provider call, or discover that a newer retry took it. */
const RENEW_SQL = `
  update spideryarn.feedback_shipped_emails
     set updated_at = now()
   where owner_id = $1::uuid and report_id = $2 and status = 'sending' and attempts = $3
  returning attempts`;

/** **Complete**, only if the row is still this attempt's. */
const COMPLETE_SQL = `
  update spideryarn.feedback_shipped_emails
     set status = $3, detail = $4, updated_at = now()
   where owner_id = $1::uuid and report_id = $2 and status = 'sending' and attempts = $5
  returning attempts`;

/** The two calls this needs from `pg`; a `Pool` has both. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface RunDeps {
  /** Production, or the test database. Read-only for a dry run. */
  readonly db: Queryable;
  readonly send: (email: Email, label: string) => Promise<SendResult>;
  readonly say: (line: string) => void;
  readonly now?: Date;
}

export interface RunOptions {
  readonly send: boolean;
  readonly cap?: number;
  readonly retry?: { readonly ownerId: string; readonly reportId: string };
}

/** What a run did. `problems` empty means nothing needs a person. */
export interface RunResult {
  readonly sent: number;
  readonly problems: readonly string[];
}

/** Provider outcomes which prove another same-key request exists are ambiguous, not safe to auto-retry. */
export function ledgerOutcome(result: SendResult): { status: LedgerStatus; detail: string | null } {
  const idempotencyConflict =
    result.kind === "failed" &&
    (result.providerError === "concurrent_idempotent_requests" || result.providerError === "invalid_idempotent_request");
  if (result.kind === "sent") return { status: "sent", detail: null };
  if (result.kind === "failed" && (result.ambiguous || idempotencyConflict)) {
    return { status: "sending", detail: `may have gone: ${result.reason}` };
  }
  return { status: "failed", detail: `${result.kind}: ${result.reason}` };
}

async function shippedRows(db: Queryable, ids: readonly string[]): Promise<ShippedRow[]> {
  const result = await db.query(SHIPPED_ROWS_SQL, [ids]);
  return (
    result.rows as {
      owner_id: string;
      id: string;
      kind: string | null;
      created_at: Date | string;
      email: string | null;
      ledger: LedgerStatus | null;
      ledger_attempts: number | null;
    }[]
  ).map((r) => ({
    ownerId: r.owner_id,
    reportId: r.id,
    kind: r.kind,
    createdAt: new Date(r.created_at),
    email: r.email,
    ledger: r.ledger,
    ledgerAttempts: r.ledger_attempts == null ? null : Number(r.ledger_attempts),
  }));
}

/**
 * Reconcile the shipped map against production and, when `send` is set, send.
 * Throws on a map it cannot read or a database it cannot reach; every send is a
 * value, recorded in the ledger.
 */
export async function runShippedEmails(generated: string, options: RunOptions, deps: RunDeps): Promise<RunResult> {
  const ids = shippedIdsIn(generated);
  const plan = planShippedEmails(ids, await shippedRows(deps.db, ids), {
    now: deps.now ?? new Date(),
    ...(options.cap === undefined ? {} : { cap: options.cap }),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  });

  const problems: string[] = [];
  /* Admins' and already-sent reports are nearly all of them, every deploy: counts only. */
  for (const [reason, skippedIds] of plan.skipped) {
    if (reason === "an admin's" || reason === "already emailed") deps.say(`${skippedIds.length} ${reason}`);
    else deps.say(`not emailed, ${reason}: ${skippedIds.join(", ")}`);
  }
  const stuck = plan.skipped.get("a send that may have gone, or was interrupted — needs a person");
  if (stuck) {
    problems.push(
      `${stuck.length} report(s) stuck in 'sending': ${stuck.join(", ")} — check Resend's log, then --retry <owner_id>/<report_id> or mark the row 'sent'`,
    );
  }
  if (plan.missingRowIds.length > 0) {
    deps.say(
      `not emailed, ${plan.missingRowIds.length} shipped report id(s) have no feedback row: ${plan.missingRowIds.join(", ")} — check the note or whether the report was erased`,
    );
  }
  if (options.retry && plan.letters.length === 0) {
    problems.push(
      `retry target ${options.retry.ownerId}/${options.retry.reportId} is not eligible in this map and database; nothing was sent`,
    );
  }
  if (plan.refused) return { sent: 0, problems: [...problems, plan.refused] };
  if (plan.letters.length === 0) {
    deps.say("no reader is owed a letter");
    return { sent: 0, problems };
  }

  let sent = 0;
  for (const letter of plan.letters) {
    const what = `account ${letter.ownerId}, report ${letter.reportId}`;
    if (!options.send) {
      deps.say(`would email ${what}`);
      continue;
    }
    const retrying = options.retry !== undefined;
    const reserved = await deps.db.query(
      RESERVE_SQL(retrying),
      retrying ? [letter.ownerId, letter.reportId, letter.observedAttempts] : [letter.ownerId, letter.reportId],
    );
    const attempts = (reserved.rows[0] as { attempts?: number } | undefined)?.attempts;
    if (attempts === undefined) {
      deps.say(`another run has ${what}; left alone`);
      if (options.retry) problems.push(`retry target could not be reserved because another attempt has ${what}`);
      continue;
    }
    const renewed = await deps.db.query(RENEW_SQL, [letter.ownerId, letter.reportId, attempts]);
    if (renewed.rows.length === 0) {
      problems.push(`attempt no longer owns ${what}; no email was sent`);
      continue;
    }
    const result = await deps.send(letter.email, "feedback shipped");
    const { status, detail } = ledgerOutcome(result);
    const completed = await deps.db.query(COMPLETE_SQL, [
      letter.ownerId,
      letter.reportId,
      status,
      detail?.slice(0, 200) ?? null,
      attempts,
    ]);
    if (completed.rows.length === 0) {
      problems.push(`email outcome was not recorded because a newer ledger attempt owns ${what}; check it before retrying`);
      continue;
    }
    if (status === "sent") {
      sent++;
      deps.say(`emailed ${what}`);
    } else {
      problems.push(`not emailed (${detail}): ${what}${status === "failed" ? " — the next deploy tries again" : ""}`);
    }
  }
  return { sent, problems };
}

/** The generated map as it was at `sha`, or null when the file is not in that commit. */
export function generatedAt(sha: string, cwd = ROOT): string | null {
  try {
    return execFileSync("git", ["show", `${sha}:${GENERATED_REPO_PATH}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * **Production, and the key to send with** — from `.env.prod`, the same file
 * and the same migrator credential the deploy's migration step uses.
 */
export function productionDeps(say: (line: string) => void): { deps: RunDeps; close: () => Promise<void> } {
  const prod = readEnvProd()?.values;
  if (!prod?.DATABASE_URL) throw new Error("no DATABASE_URL in .env.prod — cannot reach production");
  const url = migratorUrlFrom(prod.DATABASE_URL, prod.DATABASE_PASSWORD ?? "");
  const ssl = sslDecisionFor(url);
  if (ssl.mode !== "verified") throw new Error(`TLS mode is ${ssl.mode}: ${ssl.why}`);
  const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl });
  /* An explicit opt-in, never a mutation of process.env: this process is not
     on Vercel, so `sendEmail` would otherwise (rightly) refuse. */
  const env: EmailEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: prod.RESEND_API_KEY,
    SPIDERYARN_EMAIL_SEND: "1",
  };
  return {
    deps: { db: pool, send: (email, label) => sendEmail(email, label, { env }), say },
    close: () => pool.end(),
  };
}

/**
 * **A dry run's database: reads only.** Every query runs on one client inside
 * `begin read only`, so a dry run against production cannot write even if a
 * bug sent it down the sending path.
 */
async function readOnly<T>(pool: Pool, work: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    return await work(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

export interface CliOptions extends RunOptions {
  readonly sha: string;
}

const CLI_VALUE_FLAGS = new Set(["--sha", "--cap", "--retry"]);

function positiveCap(value: string): number {
  const cap = Number(value);
  if (!(Number.isInteger(cap) && cap > 0)) throw new Error("invalid command line");
  return cap;
}

function retryTarget(value: string): NonNullable<RunOptions["retry"]> {
  const match = /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/(spya-[a-z0-9]{6})$/.exec(value);
  if (!match?.[1] || !match[2]) throw new Error("invalid command line");
  return { ownerId: match[1], reportId: match[2] };
}

/** Strict because a missing retry target must never widen `--send` to every report. */
export function parseCliArgs(args: readonly string[]): CliOptions {
  let send = false;
  let sha = "origin/main";
  let cap: number | undefined;
  let retry: RunOptions["retry"];
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!flag || seen.has(flag)) throw new Error("invalid command line");
    seen.add(flag);
    if (flag === "--send") {
      send = true;
      continue;
    }
    if (!CLI_VALUE_FLAGS.has(flag)) throw new Error("invalid command line");
    const supplied = args[++i];
    if (!supplied || supplied.startsWith("--")) throw new Error("invalid command line");
    if (flag === "--sha") sha = supplied;
    else if (flag === "--cap") cap = positiveCap(supplied);
    else retry = retryTarget(supplied);
  }
  return { send, sha, ...(cap === undefined ? {} : { cap }), ...(retry === undefined ? {} : { retry }) };
}

async function cli(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch {
    console.log(
      "usage: npx tsx scripts/feedback-shipped-emails.ts [--sha <commit>] [--cap <n>] [--retry <owner_id>/<report_id>] [--send]",
    );
    process.exitCode = 2;
    return;
  }
  const { send, sha } = options;
  if (sha === "origin/main") execFileSync("git", ["fetch", "origin", "main", "--quiet"], { cwd: ROOT, stdio: "ignore" });
  const generated = generatedAt(sha);
  if (generated === null) {
    console.log(`${GENERATED_REPO_PATH} is not readable at ${sha}`);
    process.exitCode = 1;
    return;
  }
  const { deps, close } = productionDeps((line) => console.log(line));
  try {
    console.log(`the map at ${sha}`);
    const result = send
      ? await runShippedEmails(generated, options, deps)
      : await readOnly(deps.db as Pool, (db) => runShippedEmails(generated, options, { ...deps, db }));
    for (const p of result.problems) console.log(`PROBLEM ${p}`);
    if (!send) console.log("dry run: nothing sent, nothing written (add --send)");
    if (result.problems.length > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

if (isMain(import.meta.url)) await cli();
