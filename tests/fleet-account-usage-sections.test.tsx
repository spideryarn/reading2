// @vitest-environment jsdom
/**
 * **ONE SECTION PER ACCOUNT-SUBSCRIPTION**, from a checkpoint the real store
 * wrote to the words on screen. Plan 260910c, and Greg's ask:
 *
 * > The Usage Limits page should have sections for each Claude and Codex
 * > account-subscription, summarising 5d and weekly X% used and when they
 * > reset.
 *
 * ## The join is drawn through the real composer, for the reason its sibling is
 *
 * The class of bug this area keeps producing is a producer with no consumer:
 * every part tested, the edge between them missing, nothing red
 * (docs/postmortems/260908b). So the first test goes through every hop with
 * nothing faked — the real store writes a checkpoint, `statePayload` composes
 * what `server.ts` serves, `parseFleetState` reads it as the browser does, and
 * the component renders text into a DOM. Unit tests with injected fakes cannot
 * see whether the real things are wired together.
 *
 * The rest drive the component directly, because *what does an unreadable
 * section look like* is a rendering question and does not need a disk.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { readCheckpointFeeds } from "../tools/fleet/overseer-status.js";
import { statePayload } from "../tools/fleet/state.js";
import { AccountUsageSections } from "../tools/fleet/web/src/AccountUsageSections";
import {
  CLOCK_SKEW_UNMEASURED,
  parseAccountUsage,
  parseFleetState,
  type AccountUsageView,
} from "../tools/fleet/web/src/types";
import type { AccountUsageSection, StoredAccountUsage } from "../tools/fleet/wire.js";
import { describeRefusal, openStore, type OverseerStore } from "../tools/overseer/store.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const roots: string[] = [];
const opened: OverseerStore[] = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const store of opened.splice(0)) store.close();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function screen(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function draw(view: AccountUsageView, now: number): void {
  act(() => root.render(<AccountUsageSections view={view} asOf={now} skew={CLOCK_SKEW_UNMEASURED} />));
}

/* BASE is now, not a wall-clock instant. A fixture pinned to a date ages past
   every threshold the moment the suite runs on another day, and this component
   has one staleness threshold plus reset instants that must be in the future to
   mean anything. */
const BASE = Date.now();
const ago = (ms: number): string => new Date(BASE - ms).toISOString();
const ahead = (ms: number): string => new Date(BASE + ms).toISOString();

function claudeSection(over: Partial<Extract<AccountUsageSection, { family: "claude" }>> = {}): AccountUsageSection {
  return {
    name: "mindstone",
    family: "claude",
    role: "pool",
    origin: "registered",
    displayEmail: "greg@mindstone.com",
    providerAccountId: "provider-mindstone",
    takenAt: ago(60_000),
    reading: {
      kind: "windows",
      windows: [
        { kind: "value", window: "five_hour", utilizationPercent: 41, resetsAt: ahead(2 * 60 * 60_000) },
        { kind: "value", window: "seven_day", utilizationPercent: 12, resetsAt: ahead(5 * 24 * 60 * 60_000) },
      ],
    },
    ...over,
  } as AccountUsageSection;
}

function codexSection(over: Partial<Extract<AccountUsageSection, { family: "codex" }>> = {}): AccountUsageSection {
  return {
    name: "ambient",
    family: "codex",
    role: "orchestrator",
    origin: "ambient",
    displayEmail: null,
    providerAccountId: "provider-codex",
    takenAt: ago(90_000),
    reading: {
      kind: "buckets",
      resetCredits: null,
      buckets: [
        {
          limitId: "codex",
          limitName: null,
          planType: "pro",
          credits: null,
          individualLimit: null,
          spendControlReached: false,
          rateLimitReachedType: null,
          windows: [
            {
              kind: "value",
              slot: "primary",
              windowMinutes: 300,
              usedPercent: 8,
              resetsAt: ahead(3 * 60 * 60_000),
              resetsAtMs: BASE + 3 * 60 * 60_000,
            },
          ],
        },
      ],
    },
    ...over,
  } as AccountUsageSection;
}

function published(
  accounts: readonly AccountUsageSection[],
  problems: readonly string[] = [],
): AccountUsageView {
  return { kind: "published", collectedAt: ago(60_000), accounts, problems, coordinatorWrittenAt: ago(30_000) };
}

/* ------------------------------------------------------------------ *
 * THE JOIN, END TO END.
 * ------------------------------------------------------------------ */

it("draws a section for every account the Overseer wrote, through every real hop", () => {
  const dir = mkdtempSync(join(tmpdir(), "fleet-account-usage-"));
  roots.push(dir);
  const open = openStore({ root: dir, now: () => new Date(BASE) });
  if (!open.ok) throw new Error(`could not open the store: ${describeRefusal(open.refusal)}`);
  opened.push(open.store);

  const accountUsage: StoredAccountUsage = {
    kind: "reading",
    collectedAt: ago(60_000),
    problems: [],
    accounts: [claudeSection(), codexSection()],
  };
  const written = open.store.checkpoint({ lastGoodSnapshotAt: null, tick: true, accountUsage });
  expect(written.ok).toBe(true);

  const payload = statePayload({
    snapshot: null,
    error: null,
    health: null,
    refreshMs: 60_000,
    answeringEnabled: false,
    attemptedAt: null,
    /* Required since source-ordering stage 1 (215b0af8). No snapshot, so no
       inventory: that session's own rule is that the stamp says "no
       collection" exactly when there is none, and its tests use this value. */
    producer: { instance: "1a2b3c4d", publication: 0, inventory: null },
    readCheckpoint: () => readCheckpointFeeds(dir),
  });
  const parsed = parseFleetState(JSON.parse(payload), BASE);
  if (!parsed.ok) throw new Error(`the payload did not parse: ${parsed.why}`);

  draw(parsed.state.accountUsage, BASE);
  const text = screen();
  expect(text).toContain("Claude subscriptions");
  expect(text).toContain("Codex subscriptions");
  expect(text).toContain("greg@mindstone.com");
  /* Greg's rule, and the one the whole page now follows: X% used, and only X%
     used. The complement is never on screen for the reader to disentangle. */
  expect(text).toContain("41% used");
  expect(text).toContain("12% used");
  expect(text).toContain("8% used");
  expect(text).not.toContain("% left");
  expect(text).toContain("resets in");
});

/* ------------------------------------------------------------------ *
 * WHAT THE SECTIONS REFUSE TO CLAIM.
 * ------------------------------------------------------------------ */

/**
 * **THE PAGE RE-DERIVES EXPIRY, IT DOES NOT INHERIT IT.**
 *
 * A five-hour window can reset between the checkpoint being written and the
 * page being looked at, and the reading itself is republished for up to five
 * minutes after that. A section drawing a collection-time answer would show a
 * percentage for a window that no longer exists. GPT Sol's P1 on this plan.
 */
it("stops drawing a percentage once the window it describes has reset under us", () => {
  draw(
    published([
      claudeSection({
        reading: {
          kind: "windows",
          windows: [
            /* Perfectly valid when it was taken — the reset was ahead of the
               collection instant — and past now. */
            { kind: "value", window: "five_hour", utilizationPercent: 41, resetsAt: ago(10 * 60_000) },
            { kind: "value", window: "seven_day", utilizationPercent: 12, resetsAt: ahead(5 * 24 * 60 * 60_000) },
          ],
        },
      }),
    ]),
    BASE,
  );
  const text = screen();
  expect(text).not.toContain("41% used");
  expect(text).toContain("so its cached number describes nothing");
  /* The window that has NOT reset is untouched: the rule is about a void
     reading, not about hiding the section. */
  expect(text).toContain("12% used");
});

it("withholds numbers when the section's own reading instant cannot be compared with this clock", () => {
  draw(published([claudeSection({ takenAt: ahead(60 * 60_000) })]), BASE);
  expect(screen()).toContain("reading instant is in the future or cannot be compared");
  expect(screen()).not.toContain("41% used");
  expect(screen()).not.toContain("12% used");
});

it("draws no number at all for an account it could not read", () => {
  draw(
    published([
      claudeSection({ reading: { kind: "unknown", why: "usage request failed with HTTP 401" } }),
    ]),
    BASE,
  );
  /* Not "does not say 0%" — a bug rendering NaN or undefined would pass that.
     The claim is that no percentage of any kind reaches the screen. */
  expect(screen()).not.toMatch(/\d+(\.\d+)?%/);
  expect(screen()).toContain("usage request failed with HTTP 401");
});

it("refuses a numeric wire section with no provider identity", () => {
  const raw = {
    kind: "published",
    collectedAt: ago(60_000),
    coordinatorWrittenAt: ago(30_000),
    problems: [],
    accounts: [{ ...claudeSection(), providerAccountId: null }],
  };
  const parsed = parseAccountUsage(raw);
  expect(parsed.kind).toBe("feed-unreadable");
  draw(parsed, BASE);
  expect(screen()).not.toMatch(/\d+(\.\d+)?%/);
});

it("refuses malformed problem entries rather than hiding part of the warning", () => {
  const parsed = parseAccountUsage({
    kind: "published",
    collectedAt: ago(60_000),
    coordinatorWrittenAt: ago(30_000),
    problems: ["the registry is broken", 7],
    accounts: [claudeSection()],
  });
  expect(parsed.kind).toBe("feed-unreadable");
});

it("refuses two account names for one provider subscription at the browser boundary", () => {
  const parsed = parseAccountUsage({
    kind: "published",
    collectedAt: ago(60_000),
    coordinatorWrittenAt: ago(30_000),
    problems: [],
    accounts: [claudeSection(), claudeSection({ name: "alias" })],
  });
  expect(parsed.kind).toBe("feed-unreadable");
  draw(parsed, BASE);
  expect(screen()).not.toMatch(/\d+(\.\d+)?%/);
});

/**
 * A short list tells the same lie as an empty one, more quietly. If the registry
 * will not parse, every registered account vanishes and the ambient sections
 * draw perfectly — so the page would say "this box has one Claude subscription"
 * with nothing on it to disagree.
 */
it("says loudly when the list of accounts may be incomplete", () => {
  draw(
    published([claudeSection({ name: "ambient", origin: "ambient", role: "orchestrator", displayEmail: null })], [
      "the account registry could not be read, so no registered account is listed here",
    ]),
    BASE,
  );
  const text = screen();
  expect(text).toContain("This list may be incomplete");
  expect(text).toContain("the account registry could not be read");
});

/**
 * `NIMBUS_QUILL` and its friends are rotating windows Anthropic adds and removes
 * without notice. Greg: *"I have no idea what NIMBUS_QUILL is!?"* — so they are
 * collapsed, and **collapsed rather than filtered**, because rule 6 of the eight
 * is that an unrecognised window is a named row.
 */
it("keeps an unrecognised window, collapsed rather than dropped", () => {
  draw(
    published([
      claudeSection({
        reading: {
          kind: "windows",
          windows: [
            { kind: "value", window: "five_hour", utilizationPercent: 41, resetsAt: ahead(2 * 60 * 60_000) },
            { kind: "value", window: "NIMBUS_QUILL", utilizationPercent: 3, resetsAt: ahead(60 * 60_000) },
          ],
        },
      }),
    ]),
    BASE,
  );
  const details = container.querySelector("details");
  expect(details).not.toBeNull();
  expect(details?.hasAttribute("open")).toBe(false);
  expect(details?.textContent ?? "").toContain("NIMBUS_QUILL");
  /* And the headline window is NOT inside the collapsed block. */
  expect(details?.textContent ?? "").not.toContain("5 hours");
});

/**
 * Two independent readings taken minutes apart, and each aged by its own clock.
 * A pass-level timestamp would put a fresh badge on a stale reading, which is
 * the failure this whole subsystem exists to refuse.
 */
it("ages each section by its own reading rather than by the pass", () => {
  draw(
    published([
      claudeSection({ takenAt: ago(45 * 60_000) }),
      codexSection({ takenAt: ago(30_000) }),
    ]),
    BASE,
  );
  const text = screen();
  expect(text).toMatch(/read 45m ago/);
  expect(text).toMatch(/read 30s ago/);
});

/** An empty family heading is a claim; the page says what it actually knows. */
it("does not let an empty family read as 'this box has no Codex subscriptions'", () => {
  draw(published([claudeSection()]), BASE);
  expect(screen()).toContain("That is not the same as there being none");
});

/**
 * *No pass has run* and *a reading is there and this page cannot read it* are
 * different investigations, and telling somebody nothing is wrong in the second
 * case sends them away from the thing that is.
 */
it("separates a pass that has not run from a reading it cannot read", () => {
  draw({ kind: "no-reading", why: "no per-account usage pass has run in this Overseer yet.", at: ago(30_000) }, BASE);
  expect(screen()).toContain("Nothing is wrong with the file");

  draw({ kind: "reading-unreadable", why: "the sections are not ones this build can read.", at: ago(30_000) }, BASE);
  expect(screen()).toContain("come apart");
});

/** A server too old to send the field has made no claim, and the page says so. */
it("does not read an absent field as 'this box has one subscription'", () => {
  expect(parseAccountUsage(undefined)).toEqual({ kind: "not-asked" });
  draw(parseAccountUsage(undefined), BASE);
  expect(screen()).toContain("nothing here has checked");
});
