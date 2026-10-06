/**
 * **The ledger behind "your feedback is live"**, against a real database —
 * the production-shaped join to `auth.users`, and the reserve / send /
 * complete steps on `spideryarn.feedback_shipped_emails`.
 * scripts/feedback-shipped-emails.ts;
 * docs/plans/261002f-email-readers-when-their-feedback-ships.md.
 *
 * **No real email can leave**: `send` is a fake, and
 * tests/setup/provider-guard.ts refuses api.resend.com at the network anyway.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { renderModule } from "../scripts/feedback-endings.js";
import { type RunDeps, runShippedEmails } from "../scripts/feedback-shipped-emails.js";
import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb } from "../src/db/client.js";
import type { Email, SendResult } from "../src/email.js";
import type { FeedbackEnding } from "../src/feedback-ending-values.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import type { NewFeedback } from "../src/store/contracts.js";
import { pgFeedbackStore } from "../src/store/pg-feedback.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

const { pool } = await pgReady({
  suite: "tests/feedback-shipped-emails-ledger.test.ts",
  tables: ["spideryarn.feedback", "spideryarn.feedback_shipped_emails"],
  keepPool: true,
  max: 2,
});

/* Owners minted per run under a stem of this file's own, so a sweep cannot take another suite's rows. */
const STEM = "0000f5e0-0000-4000-8000-";
const mint = () => `${STEM}${randomUUID().slice(-12)}` as OwnerId;
const READER = mint();
const UNCONFIRMED = mint();
const DELETED = mint();
const BANNED = mint();
const OTHER = mint();
const addressOf = (owner: string) => `shipped-${owner}@example.invalid`;

function report(id: string): NewFeedback {
  return {
    id,
    reporterEmail: "at-filing@example.invalid",
    body: "SECRET-BODY the words a reader typed",
    kind: "suggestion",
    consented: false,
    url: "https://www.spideryarn.com/read/a-piece",
    slug: null,
    buildCommit: "abc1234",
    environment: "development",
    requestVercelId: null,
    diagnostics: null,
    screenshot: null,
  };
}

async function file(owner: OwnerId, id: string): Promise<void> {
  await runAsOwner(owner, () => pgFeedbackStore.submit(report(id)));
}

async function ledger(): Promise<{ owner_id: string; report_id: string; status: string; attempts: number; detail: string | null }[]> {
  const r = await pool.query(
    "select owner_id::text, report_id, status, attempts, detail from spideryarn.feedback_shipped_emails where owner_id::text like $1 order by report_id",
    [`${STEM}%`],
  );
  return r.rows;
}

async function sweep(): Promise<void> {
  await pool.query("delete from spideryarn.feedback where owner_id::text like $1", [`${STEM}%`]);
}

const shippedMap = (ids: string[]) =>
  renderModule(new Map(ids.map((id): [string, FeedbackEnding] => [id, "shipped"]).sort()));

function deps(results: SendResult[] = []): RunDeps & { sent: Email[]; said: string[] } {
  const sent: Email[] = [];
  const said: string[] = [];
  return {
    db: pool,
    sent,
    said,
    say: (line) => said.push(line),
    send: async (email) => {
      sent.push(email);
      return results.shift() ?? { kind: "sent", id: "fake" };
    },
    now: new Date("2026-10-02T15:00:00Z"),
  };
}

beforeAll(async () => {
  for (const owner of [READER, UNCONFIRMED, DELETED, BANNED, OTHER]) {
    await seedAuthUser(pool, { id: owner, email: addressOf(owner) });
  }
  await seedAuthUser(pool, { id: ADMIN_USER_ID_LOCAL, email: "admin@example.invalid", onConflictDoNothing: true });
  /* seedAuthUser leaves an account unconfirmed; four of these are confirmed, and two of those are then retired. */
  await pool.query("update auth.users set email_confirmed_at = now() where id = any($1::uuid[])", [
    [READER, DELETED, BANNED, OTHER],
  ]);
  await pool.query("update auth.users set deleted_at = now() where id = $1", [DELETED]);
  await pool.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [BANNED]);
});

beforeEach(sweep);

afterAll(async () => {
  await sweep();
  await pool.query("delete from auth.users where id::text like $1", [`${STEM}%`]);
  await pool.end();
  await closeDb();
});

describe("the reconcile against a real database", () => {
  it("writes to a confirmed reader's current address, and to nobody else", async () => {
    const good = mintId();
    const unconfirmed = mintId();
    const deleted = mintId();
    const banned = mintId();
    const shared = mintId();
    const admin = mintId();
    await file(READER, good);
    await file(UNCONFIRMED, unconfirmed);
    await file(DELETED, deleted);
    await file(BANNED, banned);
    await file(READER, shared);
    await file(OTHER, shared);
    await file(ADMIN_USER_ID_LOCAL as OwnerId, admin);

    const d = deps();
    const result = await runShippedEmails(shippedMap([good, unconfirmed, deleted, banned, shared, admin]), { send: true }, d);

    expect(result).toEqual({ sent: 1, problems: [] });
    expect(d.sent.map((e) => e.to)).toEqual([addressOf(READER)]);
    expect(d.sent[0]?.text).not.toContain("SECRET-BODY");
    expect(d.sent[0]?.idempotencyKey).toMatch(/^feedback-shipped\/[0-9a-f]{64}$/);
    expect(d.sent[0]?.idempotencyKey).not.toContain(READER);
    expect(d.sent[0]?.idempotencyKey).not.toContain(good);
    expect(await ledger()).toEqual([{ owner_id: READER, report_id: good, status: "sent", attempts: 1, detail: null }]);
    expect(d.said.join("\n")).toContain(`no confirmed address: ${[unconfirmed, deleted, banned].sort().join(", ")}`);
    expect(d.said.join("\n")).toContain(`id shared by several owners: ${shared}`);
    expect(d.said.join("\n")).not.toContain("@");
    await pool.query("delete from spideryarn.feedback where id = $1", [admin]);
  });

  it("sends once: a second deploy finds the row sent", async () => {
    const id = mintId();
    await file(READER, id);
    await runShippedEmails(shippedMap([id]), { send: true }, deps());
    const again = deps();
    const result = await runShippedEmails(shippedMap([id]), { send: true }, again);
    expect(again.sent).toEqual([]);
    expect(result).toEqual({ sent: 0, problems: [] });
  });

  it("a definite failure is retried by the next deploy", async () => {
    const id = mintId();
    await file(READER, id);
    const first = await runShippedEmails(shippedMap([id]), { send: true }, deps([{ kind: "failed", reason: "Resend answered 422" }]));
    expect(first.problems).toHaveLength(1);
    expect(await ledger()).toMatchObject([{ status: "failed", attempts: 1, detail: "failed: Resend answered 422" }]);

    const second = deps();
    expect(await runShippedEmails(shippedMap([id]), { send: true }, second)).toEqual({ sent: 1, problems: [] });
    expect(await ledger()).toMatchObject([{ status: "sent", attempts: 2, detail: null }]);
  });

  it("a send that may have gone is left for a person, and only --retry sends it again", async () => {
    const id = mintId();
    await file(READER, id);
    await runShippedEmails(shippedMap([id]), { send: true }, deps([{ kind: "failed", reason: "TypeError", ambiguous: true }]));
    expect(await ledger()).toMatchObject([{ status: "sending", detail: "may have gone: TypeError" }]);

    const deploy = deps();
    const next = await runShippedEmails(shippedMap([id]), { send: true }, deploy);
    expect(deploy.sent).toEqual([]);
    expect(next.problems.join("\n")).toContain("stuck in 'sending'");

    const person = deps();
    const retried = await runShippedEmails(shippedMap([id]), { send: true, retry: { ownerId: READER, reportId: id } }, person);
    expect(person.sent).toHaveLength(1);
    expect(retried).toEqual({ sent: 1, problems: [] });
    expect(await ledger()).toMatchObject([{ status: "sent", attempts: 2 }]);
  });

  it("keeps Resend idempotency conflicts for a person instead of retrying them automatically", async () => {
    for (const providerError of ["concurrent_idempotent_requests", "invalid_idempotent_request"] as const) {
      const id = mintId();
      await file(READER, id);
      const first = deps([{ kind: "failed", reason: `Resend answered 409 ${providerError}`, providerError }]);
      expect((await runShippedEmails(shippedMap([id]), { send: true }, first)).problems).toHaveLength(1);
      expect(await ledger()).toMatchObject([{ report_id: id, status: "sending", attempts: 1 }]);

      const deploy = deps();
      expect((await runShippedEmails(shippedMap([id]), { send: true }, deploy)).problems.join("\n")).toContain("stuck");
      expect(deploy.sent).toEqual([]);
      await pool.query("delete from spideryarn.feedback where owner_id = $1 and id = $2", [READER, id]);
    }
  });

  it("lets only one overlapping retry call the provider", async () => {
    const id = mintId();
    await file(READER, id);
    await runShippedEmails(shippedMap([id]), { send: true }, deps([{ kind: "failed", reason: "TypeError", ambiguous: true }]));

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const firstBase = deps();
    const first: RunDeps & { sent: Email[]; said: string[] } = {
      ...firstBase,
      send: async (email) => {
        firstBase.sent.push(email);
        started();
        await held;
        return { kind: "sent", id: "fake" };
      },
    };
    const retry = { send: true, retry: { ownerId: READER, reportId: id } } as const;
    const firstRun = runShippedEmails(shippedMap([id]), retry, first);
    await entered;
    const second = deps();
    const secondResult = await runShippedEmails(shippedMap([id]), retry, second);
    release();
    await firstRun;

    expect(firstBase.sent).toHaveLength(1);
    expect(second.sent).toEqual([]);
    expect(secondResult.problems).toHaveLength(1);
  });

  it("reports a shipped id that has no feedback row", async () => {
    const missing = mintId();
    const d = deps();
    const result = await runShippedEmails(shippedMap([missing]), { send: true }, d);
    expect(result.sent).toBe(0);
    expect(d.said.join("\n")).toContain(missing);
  });

  it("reports a targeted retry that does not name an eligible owner and report", async () => {
    const id = mintId();
    await file(READER, id);
    const result = await runShippedEmails(
      shippedMap([id]),
      { send: true, retry: { ownerId: OTHER, reportId: id } },
      deps(),
    );
    expect(result.sent).toBe(0);
    expect(result.problems.join("\n")).toContain("retry target");
  });

  it("a dry run sends nothing and writes nothing", async () => {
    const id = mintId();
    await file(READER, id);
    const d = deps();
    await runShippedEmails(shippedMap([id]), { send: false }, d);
    expect(d.sent).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect(d.said.join("\n")).toContain(`would email account ${READER}, report ${id}`);
  });

  it("past the cap, sends none and writes none", async () => {
    const a = mintId();
    const b = mintId();
    await file(READER, a);
    await file(OTHER, b);
    const d = deps();
    const result = await runShippedEmails(shippedMap([a, b]), { send: true, cap: 1 }, d);
    expect(d.sent).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect(result.problems.join("\n")).toContain("more than the cap of 1");
  });

  it("erasing the report erases its ledger row", async () => {
    const id = mintId();
    await file(READER, id);
    await runShippedEmails(shippedMap([id]), { send: true }, deps());
    await pool.query("delete from spideryarn.feedback where owner_id = $1 and id = $2", [READER, id]);
    expect(await ledger()).toEqual([]);
  });
});
