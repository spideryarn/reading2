// @vitest-environment jsdom
/**
 * **THE USAGE CARD**, from a checkpoint the real store wrote to the words on
 * screen — and the stage's acceptance line as an assertion:
 *
 * > the page says what it knows about the current account and what it cannot
 * > tell; **thirty sessions affected by one quota window create one incident**.
 * >
 * > — docs/plans/260908f, § Usage visibility
 *
 * ## The join, and why it is drawn through the real composer
 *
 * The class of bug this area keeps producing is a producer with no consumer:
 * every part tested, the edge between them missing, nothing red
 * (docs/postmortems/260908b). `collectUsage` had been measuring this since the
 * morning of 2026-09-08 and storing it every 300 seconds, and nothing rendered
 * it — `tools/fleet/attention.ts` says in as many words that it *"ignores
 * `cursor` and `usage` entirely"*. So the first test here goes through all five
 * hops with nothing faked: the real store writes a checkpoint, `statePayload`
 * composes the payload `server.ts` serves, `parseFleetState` — the browser's
 * own parser — reads it, and the card renders text into a DOM.
 *
 * The rest drive the card directly, because *what does a cleared limit look
 * like* is a rendering question and does not need a disk.
 *
 * ## The three clocks in play, which is why the fixture is relative
 *
 * `BASE` is now. A checkpoint pinned to a wall-clock time would age past every
 * threshold the moment the suite ran on another day — the mistake
 * fleet-overseer-panel.test.tsx records making — and this card has one
 * threshold of its own plus two reset instants that must be in the future to
 * mean anything.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCheckpointFeeds } from "../tools/fleet/overseer-status.js";
import { statePayload } from "../tools/fleet/state.js";
import { UsageCard } from "../tools/fleet/web/src/UsagePanel";
import {
  CLOCK_SKEW_UNMEASURED,
  parseFleetState,
  parseUsage,
  shiftToBrowserClock,
  type UsageView,
} from "../tools/fleet/web/src/types";
import type { RateLimitHit, ScanCoverage, StoredUsage, UsageReport } from "../tools/fleet/wire.js";
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

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-usage-card-"));
  roots.push(dir);
  return dir;
}

/** The page's text, whitespace flattened, so an assertion reads like a sentence. */
function screen(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function draw(usage: UsageView | null, now: number, receivedAt: number | null = now): void {
  act(() =>
    root.render(<UsageCard usage={usage} codex={null} now={now} receivedAt={receivedAt} skew={CLOCK_SKEW_UNMEASURED} />),
  );
}

const BASE = Date.now();
const ago = (ms: number): string => new Date(BASE - ms).toISOString();

/**
 * A CONCLUSIVE scan — nothing unreadable, nothing truncated, a window longer
 * than the longest live rejection. `absenceGapReason` refuses a `none` off
 * anything less, on both sides of the wire, so a fixture that means "we looked
 * everywhere and found nothing" has to actually mean it.
 */
const COVERAGE: ScanCoverage = {
  transcriptsFound: 240,
  transcriptsSelected: 240,
  transcriptsOpened: 240,
  transcriptsUnreadable: 0,
  unreadableWhy: [],
  linesScanned: 232961,
  candidateLines: 90,
  linesParsed: 90,
  malformedCandidates: 0,
  quotaLimitsWithoutErrorSignal: 0,
  truncatedByLimit: false,
  sinceMs: 691_200_000,
  tookMs: 41_233,
};

/**
 * **THIRTY CONVERSATIONS, THREE REJECTIONS EACH, ONE WINDOW.**
 *
 * What a filled five-hour window on a busy box actually produces — measured
 * shape, from the 27 rejections sharing one `resetsAt` on 2026-09-08. The
 * acceptance line is that these ninety lines become one thing on screen.
 */
function ninetyRejections(resetsAtMs: number): RateLimitHit[] {
  const hits: RateLimitHit[] = [];
  for (let session = 0; session < 30; session += 1) {
    for (let retry = 0; retry < 3; retry += 1) {
      const hitAtMs = BASE - 60 * 60_000 + session * 1_000 + retry * 30_000;
      hits.push({
        id: `hit-${session}-${retry}`,
        window: "five_hour",
        resetsAtMs,
        hitAtMs,
        hitAt: new Date(hitAtMs).toISOString(),
        status: "rejected",
        claudeSessionId: `conversation-${session}`,
        transcriptPath: `/home/greg/.claude/projects/x/conversation-${session}.jsonl`,
        message: "You've hit your session limit",
      });
    }
  }
  return hits;
}

function storedReport(over: Partial<UsageReport> = {}): StoredUsage {
  const resetsAtMs = BASE + 2 * 60 * 60_000;
  const hits = ninetyRejections(resetsAtMs);
  const active = hits[0];
  if (active === undefined) throw new Error("the fixture produced no rejections");
  return {
    kind: "report",
    report: {
      account: {
        kind: "value",
        email: "greg@example.test",
        orgId: "org-1111",
        orgName: "An organisation",
        subscriptionType: "max",
        accountUuid: "acct-1111",
        rateLimitTier: "default_claude_max_20x",
      },
      cache: {
        kind: "value",
        accountUuid: "acct-1111",
        fetchedAtMs: BASE - 10 * 60_000,
        ageMs: 10 * 60_000,
        windows: [
          {
            kind: "value",
            window: "five_hour",
            utilizationPercent: 96,
            /* ANTHROPIC'S OWN FORMAT, microseconds and a numeric offset. A
               strict `toISOString()` round trip rejects it, which used to void
               the whole cache — tests/fleet-usage-feed.test.ts § the header. */
            resetsAt: `${new Date(resetsAtMs).toISOString().slice(0, -1)}670+00:00`,
            resetsAtMs,
            msUntilReset: 2 * 60 * 60_000,
          },
          {
            kind: "unknown",
            window: "nimbus_quill",
            why: "no resets_at, so the utilization (0) cannot be checked for validity",
          },
        ],
      },
      rateLimits: { kind: "hits", hits, coverage: COVERAGE },
      verdict: {
        level: "limited",
        reasons: ["a five_hour rejection is in force until the window resets"],
        activeLimit: { ...active, resetsAtMs },
      },
      collectedAt: ago(3 * 60_000),
      tookMs: 41_400,
      ...over,
    },
  };
}

describe("the join, all five hops", () => {
  it("turns ninety rejections in a real checkpoint into one incident on screen", () => {
    const dir = tempRoot();
    const result = openStore({ root: dir, now: () => new Date(BASE - 20_000) });
    if (!result.ok) throw new Error(`could not open the store: ${describeRefusal(result.refusal)}`);
    opened.push(result.store);
    result.store.checkpoint({ lastGoodSnapshotAt: ago(40_000), tick: true, usage: storedReport() });

    /* THE FUNCTION PRODUCTION GOES THROUGH. `statePayload()` in server.ts is
       one call to this with the same deps. */
    const payload: unknown = JSON.parse(
      statePayload({
        snapshot: null,
        error: null,
        health: null,
        refreshMs: 60_000,
        answeringEnabled: true,
        attemptedAt: null,
        readCheckpoint: () => readCheckpointFeeds(dir),
      }),
    );
    const receivedAt = Date.now();
    const read = parseFleetState(payload, receivedAt);
    expect(read.ok, read.ok ? "" : read.why).toBe(true);
    if (!read.ok) return;

    draw(read.state.usage, receivedAt, receivedAt);

    /* **THE ACCEPTANCE LINE.** Ninety rejections across thirty conversations
       are ONE incident, and the number a person acts on — when work can resume
       — appears once rather than ninety times. */
    expect(screen()).toContain("30 conversations, 90 rejections");
    /* **ONCE, NOT MERELY PRESENT.** The acceptance line is that ninety
       rejections become ONE thing; a card that drew the row thirty times would
       satisfy `toContain` while failing the requirement exactly. So count the
       rows, and count the reset instant they would each have repeated.
       GPT Sol's P2(4), 2026-09-09. */
    /* **COUNTED WHERE THEY LIVE, NOT AS A TOTAL.** A bare `li` count was the
       right assertion when the card had one list. It now has three — incidents,
       verdict reasons, and the cache entries that carried no usable number — so
       a total would move for a good reason and a bad one indistinguishably, and
       the number would be edited rather than read. The requirement has not
       changed and is pinned directly instead: **one incident row**, whatever
       else the card grows around it (plan 260909c). */
    expect(container.querySelectorAll('[data-slot="usage-provenance"] li').length).toBe(1);
    /* Three stats: both cached windows — one with a reading, one without — and
       — new on 2026-09-09 — **when work can actually resume**, which is the
       number this whole card exists to deliver and which used to be reachable
       only by reading an incident row's third line. It is drawn from
       `dueBackAt`, the window that frees up LAST, so a reader who acts on it is
       not caught out by a second window still in force. */
    expect(container.querySelectorAll('[data-slot="stat-value"], [data-slot="stat-absent"]').length).toBe(3);
    expect(screen()).toContain("Work can resume in");
    /* **`nimbus_quill` GETS ITS OWN CARD, and no window is folded away.** A
       draft folded the windows that never carried a number into a disclosure;
       it was withdrawn on GPT Sol's UL-03 because it partitioned by epistemic
       state when only relevance justified it, and `UsageWindowName` is `string`
       so nothing in the data says which windows are ancillary. Pinned here so
       the idea cannot come back without this assertion being read. */
    expect(container.querySelectorAll('[data-slot="stat-absent"]').length).toBe(1);
    expect(screen()).toContain("nimbus_quill");
    expect(screen()).toContain("no resets_at, so the utilization (0) cannot be checked for validity");
    /* **THE CACHE'S OWN AGE, WHICH IS NOT THE READING'S.** A fresh pass can
       republish a cache fetched hours earlier, so a card showing only
       `collectedAt` makes a stale percentage read as freshly taken — Sol's
       UL-04, found by diffing the old render against the new one. */
    expect(screen()).toContain("cached 10m ago");
    expect(screen().match(/five_hour has not reset yet/g)).toHaveLength(1);
    expect(screen()).toContain("five_hour has not reset yet");
    /* **AND IT DOES NOT SAY "IN FORCE".** Only the verdict may claim the
       account is blocked: an unexpired 429 from a subscription Greg has since
       swapped away from is indistinguishable here, and an earlier draft of this
       row drew IN FORCE over a live verdict of UNKNOWN. `IncidentRow`'s header.

       Scoped to the ROW rather than to the whole card: the phrase belongs in
       the producer's own verdict sentences, which this card prints verbatim,
       and a blanket refusal of it would forbid the one place it is earned. */
    expect(screen()).not.toMatch(/five_hour\s+is in force/);

    /* WHAT IT KNOWS ABOUT THE ACCOUNT. */
    expect(screen()).toContain("greg@example.test");
    expect(screen()).toContain("default_claude_max_20x");
    expect(screen()).toContain("This account is rate-limited.");

    /* **THREE CLOCKS ON EVERY INSTANT** — Greg's *"I'm bouncing between
       London/Athens"*. The labels, on the reset time and on the reading's own
       timestamp. */
    expect(screen()).toMatch(/resets .*UTC · .*London · .*Athens/);
    expect(screen()).toMatch(/Reading taken 3m ago — .*UTC · .*London · .*Athens/);

    /* THE POSITIVE CONTROL, under the answer. */
    expect(screen()).toContain("scanned 240 of 240 selected transcripts");
    expect(screen()).toContain("232,961 lines");

    /* THE CACHE IS A HINT AND IS LABELLED AS ONE, and its awkward timestamp
       format survived the projection rather than voiding the window. */
    expect(screen()).toContain("Cached headroom");
    expect(screen()).toContain("96%");
    /* A window with no reset instant is a sentence, never a zero. */
    expect(screen()).toContain("nimbus_quill");
  });
});

describe("the card, against its own clock", () => {
  it("reads a limit whose window has since reset as history, not as a live block", () => {
    /* A POST-RESET OLD 429 IS HISTORY — the plan's words. The producer said
       `limited`, truthfully, about the moment it looked; the window has since
       cleared, and repeating the verdict would put a red banner over an account
       that is free. The clock gets the last word. */
    const stored = storedReport();
    if (stored.kind !== "report") throw new Error("unreachable");
    const past = BASE - 30 * 60_000;
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(3 * 60_000),
        account: stored.report.account,
        level: "limited",
        reasons: ["a five_hour rejection was in force when this reading was taken"],
        cache: { kind: "unknown", why: "~/.claude.json could not be read" },
        limits: {
          kind: "incidents",
          incidents: [
            {
              id: "five_hour@past",
              window: "five_hour",
              resetsAt: new Date(past).toISOString(),
              conversations: ["conversation-0"],
              rejections: 3,
              unidentifiedRejections: 0,
              firstHitAt: ago(90 * 60_000),
              lastHitAt: ago(70 * 60_000),
            },
          ],
          coverage: COVERAGE,
        },
        /* BOTH HALVES OF THE INCIDENT KEY — a `dueBackAt` with no window is
           refused, because it would match every window resetting at that
           instant. wire.ts § `dueBackWindow`. */
        dueBackAt: new Date(past).toISOString(),
        dueBackWindow: "five_hour",
      },
    });
    draw(feed, BASE);
    expect(screen()).toContain("The limit that stopped this account has since reset.");
    expect(screen()).toContain("Every rejection this scan found names a window that has already reset.");
    expect(screen()).toContain("cleared");
    /* **AND IT DOES NOT ALSO SAY "Work can resume in — Unknown".** The first
       draft drew that card here, reading the same passed instant the headline
       had just resolved, and answering `Unknown` to a question the sentence
       above had answered. Two components disagreeing about one instant in view
       of each other. GPT Sol's UL-01, 2026-09-09 — and this test is what was
       missing, since it asserted the headline and never looked at the card. */
    expect(screen()).not.toContain("Work can resume in");
  });

  it("shows the unreset window in full and counts the ones that have already gone", () => {
    /* **NINE INCIDENTS, ONE OF THEM UNRESET** — what the live checkpoint held
       on 2026-09-08. Nine equal rows put the one that matters in the middle of
       a wall of dates, and the history is kept as evidence rather than as rows
       to act on. `Incidents` has the argument. */
    const soon = BASE + 3 * 60 * 60_000;
    const incidents = [
      {
        id: "seven_day@soon",
        window: "seven_day",
        resetsAt: new Date(soon).toISOString(),
        conversations: ["a", "b"],
        rejections: 27,
        unidentifiedRejections: 0,
        firstHitAt: null,
        lastHitAt: null,
      },
      ...Array.from({ length: 8 }, (_unused, index) => ({
        id: `five_hour@old-${index}`,
        window: "five_hour",
        resetsAt: new Date(BASE - (index + 1) * 24 * 60 * 60_000).toISOString(),
        conversations: ["c"],
        rejections: 3,
        unidentifiedRejections: 0,
        firstHitAt: null,
        lastHitAt: null,
      })),
    ];
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "unknown", why: "not read" },
        level: "unknown",
        reasons: ["8 rejections found, none of them confirmed in force for this account"],
        cache: { kind: "unknown", why: "not read" },
        limits: { kind: "incidents", incidents, coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    expect(screen()).toContain("seven_day has not reset yet");
    expect(screen()).toContain("8 earlier windows in the range this scan covered");
    /* The history is a count, not eight rows: only the unreset one is spelled out. */
    expect(screen()).not.toContain("has reset — history, not a live block");
  });

  it("counts a rejection with no conversation id rather than inventing a session", () => {
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "unknown", why: "`claude auth status` exited 1" },
        level: "unknown",
        reasons: [],
        cache: { kind: "unknown", why: "~/.claude.json could not be read" },
        limits: {
          kind: "incidents",
          incidents: [
            {
              id: "five_hour@soon",
              window: "five_hour",
              resetsAt: new Date(BASE + 60 * 60_000).toISOString(),
              conversations: ["conversation-0"],
              rejections: 3,
              unidentifiedRejections: 2,
              firstHitAt: null,
              lastHitAt: null,
            },
          ],
          coverage: COVERAGE,
        },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    expect(screen()).toContain("1 conversation, 3 rejections");
    expect(screen()).toContain("2 of them from a conversation this scan could not name");
    /* AN UNKNOWN LEVEL IS NOT ROUNDED DOWN TO FINE. */
    expect(screen()).toContain("This page cannot tell how much headroom this account has.");
    expect(screen()).toContain("Which account this is could not be read");
  });

  it("says a quiet account is quiet only beside the evidence that it looked", () => {
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "logged-out", projectsDirectory: "/home/greg/.claude/projects" },
        level: "ok",
        reasons: [],
        cache: { kind: "unknown", why: "~/.claude.json could not be read" },
        limits: { kind: "none", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    expect(screen()).toContain("No rejection was found in the window this scan covered.");
    /* THE ZERO IS NEVER ALONE. */
    expect(screen()).toContain("scanned 240 of 240 selected transcripts");
    /* Logged out is an answer, and the one thing here a person can fix. */
    expect(screen()).toContain("Nobody is logged in on this box");
  });

  it("draws no percentage at all for an expired cached window", () => {
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        /* A NAMED ACCOUNT, because an `attributed` cache is only readable
           against one: the browser parser now checks the cache's uuid is THIS
           summary's, which is the clause it had been assuming the server made.
           GPT Sol's P1(1) in round two. */
        account: { kind: "value", email: "greg@example.test", accountUuid: "acct-1111", orgId: null, orgName: null, subscriptionType: "max", rateLimitTier: null },
        level: "unknown",
        reasons: [],
        cache: {
          kind: "attributed",
          fetchedAt: ago(48 * 60_000),
          accountUuid: "acct-1111",
          windows: [
            {
              kind: "expired",
              window: "five_hour",
              resetsAt: ago(27 * 60_000),
              why: "the cached 70% describes a window that reset 27 minutes before this reading",
            },
          ],
        },
        limits: { kind: "unknown", why: "the scan was interrupted", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    /* **THE STATE WORD CARRIES IT NOW, AND THE PRODUCER'S SENTENCE EXPLAINS IT.**
       Until 2026-09-09 this pinned a prefix the card wrote — "this window has
       already reset, so the cached number describes nothing: " — glued in front
       of a `why` that already said exactly that, so the card printed the fact
       twice and ran to eleven lines on a phone. The prefix went; the meaning is
       pinned in two pieces instead, and the second is the producer's own words
       rather than ours. */
    expect(container.querySelector('[data-slot="stat-absent"]')?.textContent).toBe("Unknown");
    /* THE STALE NUMBER SURVIVES ONLY AS PROSE. There is no numeric field for a
       renderer to find, so it cannot come back wearing a percentage label. */
    expect(screen()).toContain("the cached 70% describes");
    expect(screen()).not.toMatch(/\b70%\s*resets/);
    expect(container.querySelector('[data-slot="stat-value"]')).toBeNull();
    /* AN UNKNOWN SCAN IS NOT `no limits hit`. */
    expect(screen()).toContain("this page cannot tell whether anything was rejected");
  });

  it("stops drawing a percentage once the window it describes has reset under us", () => {
    /* **THE PRODUCER SAID `value` AND OUR CLOCK SAYS OTHERWISE, AND OURS IS
       NEWER.** A five-hour window resets while a page is open, and an older
       report is deliberately carried forward when a scan falls over — so the
       `value` arm is not a promise that the window is still live. Drawing "96%
       — which has now passed, so this number is void" put the void number back
       on screen through the renderer, having kept it out of the type.
       GPT Sol's P1(1), 2026-09-09. */
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(90 * 60_000),
        /* A NAMED ACCOUNT, because an `attributed` cache is only readable
           against one: the browser parser now checks the cache's uuid is THIS
           summary's, which is the clause it had been assuming the server made.
           GPT Sol's P1(1) in round two. */
        account: { kind: "value", email: "greg@example.test", accountUuid: "acct-1111", orgId: null, orgName: null, subscriptionType: "max", rateLimitTier: null },
        level: "unknown",
        reasons: [],
        cache: {
          kind: "attributed",
          fetchedAt: ago(90 * 60_000),
          accountUuid: "acct-1111",
          windows: [
            { kind: "value", window: "five_hour", utilizationPercent: 96, resetsAt: ago(30 * 60_000) },
            { kind: "value", window: "seven_day", utilizationPercent: 41, resetsAt: new Date(BASE + 60 * 60_000).toISOString() },
          ],
        },
        limits: { kind: "unknown", why: "the scan was interrupted", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    /* **THE VOID NUMBER IS NOWHERE ON THE CARD**, which is the whole assertion
       and is unchanged. `96%` may not appear as the value, in the evidence, in
       a tooltip, or anywhere else. */
    expect(screen()).not.toContain("96%");
    /* The window that has passed says WHICH KIND of absence it is, in a word,
       rather than drawing a dash — GPT Sol's S2-01, 2026-09-09. It used to read
       "five_hour — this window reset at …" as one run-on row; it is now a card
       whose label is the window, whose value is the state, and whose reason is
       the sentence. The substance is identical and pinned piece by piece. */
    const five = container.querySelector('[data-slot="stat-absent"]');
    expect(five?.textContent).toBe("Unknown");
    expect(screen()).toContain("five_hour");
    expect(screen()).toContain("this window reset at");
    expect(screen()).toContain("so its cached number describes nothing");
    /* The window that has NOT passed still shows its number: the rule is about
       a void reading, not about hiding the cache. Both forms are on screen —
       the producer's `41% used`, and the `59% left` the reader actually asked
       for — so the derived number can be checked against the source one. */
    expect(screen()).toContain("41%");
    expect(screen()).toContain("59% left");
  });

  it("does not invent a severity of its own for a window the verdict calls fine", () => {
    /* **THE CARD MAY NOT SECOND-GUESS THE VERDICT.** A draft coloured each
       window by thresholds this file made up — alarm under 10% left, needs
       under 25% — and GPT Sol measured what that costs against the producer's
       actual default of 80% used: at 75% the card would shout `needs` while the
       verdict still said `ok`, and at 90% `alarm` against a producer saying only
       `approaching`. A card contradicting the sentence above it is the second
       interpretation of one measurement this file's header forbids.

       **This is the mutation the rest of the suite could not see.** Re-adding
       those thresholds left all fourteen tests green, because every other
       assertion is about words and this one is about colour. Asserted on the
       ink class, which is the only place the invented severity could show.
       GPT Sol's UL-05, 2026-09-09. */
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "value", email: "greg@example.test", accountUuid: "acct-1111", orgId: null, orgName: null, subscriptionType: "max", rateLimitTier: null },
        /* **A COMBINATION THE PRODUCER CAN ACTUALLY EMIT.** The first version of
           this test used 95% used against `ok`, which its 80% threshold cannot
           produce — the mutation was still caught, but a fixture the real system
           cannot reach is a test that proves something about nothing. GPT Sol's
           round-two P2. 75% against `ok` is inside the threshold and is exactly
           where the withdrawn `left <= 25` rule would have shouted `needs` over
           a verdict saying the account is fine. */
        level: "ok",
        reasons: [],
        cache: {
          kind: "attributed",
          fetchedAt: ago(60_000),
          accountUuid: "acct-1111",
          windows: [
            {
              kind: "value",
              window: "five_hour",
              utilizationPercent: 75,
              resetsAt: new Date(BASE + 60 * 60_000).toISOString(),
            },
          ],
        },
        limits: { kind: "none", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    const value = container.querySelector('[data-slot="stat-value"]');
    expect(value?.textContent).toBe("25% left");
    expect(value?.className).not.toContain("alarm");
    expect(value?.className).not.toContain("needs");
    /* **AND NOT THE REASSURING COLOUR EITHER**, which the first fix got wrong:
       it used the `work` tone, and `work` is this palette's green — the status
       colour of a session that is running. On a headroom figure green does not
       read as "measured", it reads as "healthy", so `5% left` would have been
       drawn as good news. A severity claim in the opposite direction is still a
       severity claim. */
    expect(value?.className).not.toContain("work");
  });

  it("does not print floating-point debris as the answer to how much is left", () => {
    /* **`100 - 99.99` IS `0.010000000000005116`.** Both parsers require a
       finite value in [0, 100], so the complement can never be negative, NaN or
       over 100 — but it can be sixteen digits of noise in the largest text on
       the card, which is the one place on this page a reader is meant to look
       first. GPT Sol's UL-06, 2026-09-09. Rounded to one place, then trailing
       zeroes dropped: 42 stays `42`, and 0.01 becomes `0`, which is the safe
       direction because it does not overstate the headroom. */
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "value", email: "greg@example.test", accountUuid: "acct-1111", orgId: null, orgName: null, subscriptionType: "max", rateLimitTier: null },
        level: "approaching",
        reasons: [],
        cache: {
          kind: "attributed",
          fetchedAt: ago(60_000),
          accountUuid: "acct-1111",
          windows: [
            {
              kind: "value",
              window: "five_hour",
              utilizationPercent: 99.99,
              resetsAt: new Date(BASE + 60 * 60_000).toISOString(),
            },
          ],
        },
        limits: { kind: "none", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    expect(container.querySelector('[data-slot="stat-value"]')?.textContent).toBe("0% left");
    expect(screen()).not.toContain("0.0100000");
    /* The producer's own number survives beside the derived one, so the
       rounding can be checked rather than trusted. */
    expect(screen()).toContain("99.99% used");
  });

  it("will not draw another account's percentages under this account's name", () => {
    /* THE P0 OF 2026-09-09, at the far end of the wire: the arm carries no
       windows at all, so there is nothing for this card to render even if it
       wanted to. */
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "value", email: "greg@example.test", accountUuid: "acct-1111", orgId: null, orgName: null, subscriptionType: "max", rateLimitTier: null },
        level: "unknown",
        reasons: [],
        cache: {
          kind: "unattributed",
          why: "the cached utilisation belongs to account acct-2222 and the logged-in account is acct-1111 — probably a /login swap since the cache was written",
          fetchedAt: ago(45 * 60_000),
          accountUuid: "acct-2222",
        },
        limits: { kind: "unknown", why: "the scan was interrupted", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    draw(feed, BASE);
    expect(screen()).toContain("acct-2222");
    expect(screen()).toContain("probably a /login swap");
    expect(screen()).not.toMatch(/\d+%/);
  });

  it("corrects ages against the clock skew and leaves the wall-clock instants alone", () => {
    /* **THE ONE PROPERTY THE OTHER TESTS CANNOT SEE**, because they all pass
       `CLOCK_SKEW_UNMEASURED`, which shifts by zero — so removing or reversing
       `shiftMsToBrowserClock` inside this card would leave them all green.
       GPT Sol's P2(3), 2026-09-09.

       The box's clock is ten minutes AHEAD of this browser's. An age computed
       without correcting for that reads ten minutes too small; the absolute
       instant printed in three zones must not move at all, because it is the
       instant the window actually resets. */
    const skewMs = 10 * 60_000;
    const collectedAt = new Date(BASE + skewMs - 60_000).toISOString();
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: collectedAt,
      summary: {
        collectedAt,
        account: { kind: "unknown", why: "not read" },
        level: "unknown",
        reasons: [],
        cache: { kind: "unknown", why: "not read" },
        limits: { kind: "none", coverage: COVERAGE },
        dueBackAt: null,
      },
    });
    act(() =>
      root.render(
        <UsageCard usage={feed} codex={null} now={BASE} receivedAt={BASE} skew={{ kind: "known", ms: skewMs }} />,
      ),
    );
    /* CORRECTED: one minute by the box's clock is one minute here. Uncorrected
       it would be "in the future", which this card renders as unreadable. */
    expect(screen()).toContain("Reading taken 1m ago");
    /* AND UNSHIFTED: the printed instant is the box's own, to the minute. */
    expect(screen()).toContain(collectedAt.slice(11, 16));
  });

  it("refuses an attributed cache belonging to a different account than the summary names", () => {
    /* **THE BROWSER'S OWN REFUSAL, WHICH WAS NOT ONE FOR A ROUND.** The server
       cannot emit this today; the point is that the second parser must not
       depend on that being true, or it has moved the check rather than
       duplicated it. GPT Sol's P1(1) in round two, 2026-09-09. */
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "value", email: "b@example.test", accountUuid: "acct-B", orgId: null, orgName: null, subscriptionType: "max", rateLimitTier: null },
        level: "unknown",
        reasons: [],
        cache: {
          kind: "attributed",
          fetchedAt: ago(10 * 60_000),
          accountUuid: "acct-A",
          windows: [{ kind: "value", window: "five_hour", utilizationPercent: 96, resetsAt: new Date(BASE + 60 * 60_000).toISOString() }],
        },
        limits: { kind: "none", coverage: COVERAGE },
        dueBackAt: null,
        dueBackWindow: null,
      },
    });
    expect(feed.kind).toBe("feed-unreadable");
    draw(feed, BASE);
    expect(screen()).not.toContain("96%");
  });

  it("badges only the incident the producer attributed, not every one resetting at that instant", () => {
    /* `five_hour` and `seven_day` are both aligned to the hour, so sharing a
       reset instant is ordinary. Matching on the instant alone put an
       attributed badge on a cluster the daemon explicitly could not attribute.
       GPT Sol's P1(3) in round two, 2026-09-09. */
    const shared = new Date(BASE + 90 * 60_000).toISOString();
    const incident = (window: string) => ({
      id: `${window}@${shared}`,
      window,
      resetsAt: shared,
      conversations: ["a"],
      rejections: 2,
      unidentifiedRejections: 0,
      firstHitAt: null,
      lastHitAt: null,
    });
    const feed = parseUsage({
      kind: "published",
      coordinatorWrittenAt: ago(20_000),
      summary: {
        collectedAt: ago(60_000),
        account: { kind: "unknown", why: "not read" },
        level: "limited",
        reasons: ["a five_hour rejection is in force"],
        cache: { kind: "unknown", why: "not read" },
        limits: { kind: "incidents", incidents: [incident("five_hour"), incident("seven_day")], coverage: COVERAGE },
        dueBackAt: shared,
        dueBackWindow: "five_hour",
      },
    });
    draw(feed, BASE);
    /* Both rows are drawn — both windows are genuinely unreset — and exactly
       one of them carries the attributed wording. */
    expect(screen()).toContain("five_hour has not reset yet");
    expect(screen()).toContain("seven_day has not reset yet");
    expect(container.querySelectorAll("li.tw\\:border-l-alarm")).toHaveLength(1);
  });

  it("does not blow up the whole payload parse on an instant at the edge of the calendar", () => {
    /* **`shiftToBrowserClock` COULD THROW `RangeError`**, and it is called from
       `parseFleetState` — so one field at the far end of history took down the
       parse of the entire payload: no rows, no inbox, no status. Both inputs
       are individually valid; their difference is not. GPT Sol's P0(2) in round
       two, 2026-09-09. */
    const extreme = new Date(8.64e15).toISOString();
    expect(() => shiftToBrowserClock(extreme, { kind: "known", ms: -86_400_000 })).not.toThrow();
    /* Unshiftable degrades to unshifted — the behaviour this function already
       has for anything it cannot move — rather than to null or to a throw. */
    expect(shiftToBrowserClock(extreme, { kind: "known", ms: -86_400_000 })).toBe(extreme);
    /* And an ordinary instant still shifts, so the guard has not disabled it. */
    const ordinary = "2026-09-08T12:00:00.000Z";
    expect(shiftToBrowserClock(ordinary, { kind: "known", ms: 60_000 })).toBe("2026-09-08T11:59:00.000Z");
  });

  it("says which silence it is, arm by arm", () => {
    draw(parseUsage(undefined), BASE);
    expect(screen()).toContain("this server did not report what the account has left");

    draw(parseUsage({ kind: "no-report", why: "no usage pass has run in this Overseer yet", at: ago(20_000) }), BASE);
    expect(screen()).toContain("no usage pass has run in this Overseer yet");
    /* NOT a broken file: nothing here should send somebody to inspect one. */
    expect(screen()).not.toContain("could not be read —");

    /* **AND THE OTHER ONE, WHICH IS NOT THAT.** A report that IS there and
       cannot be read is a producer and a consumer that have come apart, and
       "nothing is wrong with the file" is then false. The two shared one arm
       until GPT Sol's P1(3), 2026-09-09. */
    draw(parseUsage({ kind: "report-unreadable", why: "its account could not be read", at: ago(20_000) }), BASE);
    expect(screen()).toContain("A usage report is there and this build cannot read it");
    expect(screen()).not.toContain("Nothing is wrong with the file");

    draw(parseUsage({ kind: "checkpoint-absent" }), BASE);
    expect(screen()).toContain("no Overseer checkpoint has been published where this server looked");

    draw(parseUsage({ kind: "unsupported-schema", saw: "3", known: 2 }), BASE);
    expect(screen()).toContain("the checkpoint says schema 3 and this page reads schema 2");

    draw(parseUsage({ kind: "invented-by-a-newer-server" }), BASE);
    expect(screen()).toContain("this page does not know the usage reading");

    /* AND ONLY `null` DRAWS NOTHING — no payload has arrived yet. */
    draw(null, BASE);
    expect(screen()).toBe("");
  });
});
