// @vitest-environment jsdom
/**
 * **Checking the claims the reader picked, on screen** — Debate's Claims with
 * its tick boxes, the box for a claim of your own, Check and Dig further.
 * src/web/ReceptionAndClaimsPanel.tsx § `OwnerListedClaims`, src/web/sources-claim-checks.ts.
 * Plan docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3 and § 5,
 * stage 3.
 *
 * What a reader could otherwise be misled or overcharged by, each case red
 * first: Check pressable when it should not be; a POST carrying anything but
 * ids and the typed words; the same page drawn twice under one claim; Dig
 * further sending more than one claim; and *found nothing* said over a claim
 * the search never answered.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checksOwner, claimListOf, claimListOwner } from "./helpers/sources-claims-owner.js";
import { sourcesHead } from "./helpers/sources-head.js";
import type {
  BlockId,
  SourcesClaimCheckRequest,
  SourcesClaimCheckResult,
  SourcesClaimCheckRow,
  SourcesClaimCheckTarget,
  SourcesClaimCheck,
  ListedClaim,
} from "../src/types.js";
import type { UseReception } from "../src/web/useReception.js";
import type { UseSourcesClaimChecks } from "../src/web/useSourcesClaimChecks.js";
import type { UseSourcesClaims } from "../src/web/useSourcesClaims.js";
import {
  SOURCES_CLAIM_CHECK_EARLIER,
  SOURCES_CLAIM_CHECK_FOUND_NOTHING,
  SOURCES_CLAIM_CHECK_NOT_ANSWERED,
  SOURCES_CLAIM_CHECK_OWN_LABEL,
  SOURCES_CLAIM_CHECK_PENDING,
  SOURCES_CLAIM_CHECK_YOUR_CLAIM,
} from "../src/messages.js";

const { ReceptionAndClaimsPanel } = await import("../src/web/ReceptionAndClaimsPanel.js");

const BLOCK = "spya-k3m9qt" as BlockId;

const LISTED: ListedClaim[] = [
  { id: "spya-cdm2a4", blockId: BLOCK, quote: "a starter needs cool water", statement: "Cool water suits a starter." },
  { id: "spya-cdm2b5", blockId: BLOCK, quote: "salt slows it down", statement: "Salt slows fermentation." },
  { id: "spya-cdm2c6", blockId: BLOCK, quote: "rye peaks sooner", statement: "Rye peaks sooner." },
  { id: "spya-cdm2d7", blockId: BLOCK, quote: "feed it twice a day", statement: "Feed twice daily." },
  { id: "spya-cdm2e8", blockId: BLOCK, quote: "warmth speeds it up", statement: "Warmth speeds it." },
];
const [A, B] = LISTED as [ListedClaim, ListedClaim];

const NO_RECEPTION: UseReception = {
  status: "none",
  reception: null,
  stale: false,
  outdated: false,
  slug: "a-piece",
  error: null,
  retryRead: async () => {},
  job: null,
  failed: null,
  stalled: false,
  starting: false,
  automatic: false,
  ensure: async () => {},
  regenerate: async () => {},
  cancel: () => {},
  rewriting: false,
  refresh: async () => {},
};

function row(url: string, over: Partial<SourcesClaimCheckRow> = {}): SourcesClaimCheckRow {
  return {
    id: `spya-r${url.length.toString().padStart(5, "a").replace(/[0-9]/g, "b")}`,
    url,
    title: `Page at ${url}`,
    sourceQuote: "words copied from that page",
    relation: "qualifies",
    lean: "neither",
    applies: "How it bears.",
    ...over,
  } as SourcesClaimCheckRow;
}

function listedTarget(c: ListedClaim): SourcesClaimCheckTarget {
  return { kind: "listed", claimId: c.id, blockId: c.blockId, quote: c.quote, statement: c.statement };
}

function check(
  id: string,
  targets: SourcesClaimCheckTarget[],
  results: SourcesClaimCheckResult[],
  over: Partial<SourcesClaimCheck> = {},
): SourcesClaimCheck {
  return {
    id,
    status: "done",
    listSourceHash: "hash",
    promptVersion: "debate-check/1",
    digFurther: false,
    targets,
    results,
    createdAt: "2026-10-09T10:00:00.000Z",
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const sent: SourcesClaimCheckRequest[] = [];

function paint(
  checks: Partial<UseSourcesClaimChecks> = {},
  list: Partial<UseSourcesClaims> = {},
): void {
  const claimList = claimListOwner({ status: "ready", claimList: claimListOf(LISTED), ...list });
  const owned = checksOwner({
    check: async (request: SourcesClaimCheckRequest) => {
      sent.push(request);
      return true;
    },
    ...checks,
  });
  act(() => {
    root.render(
      createElement(ReceptionAndClaimsPanel, {
        /* Sources' chip row, as `SourcesBand` hands it (since 2026-10-09). */
        head: sourcesHead({
          view: "claims",
          onView: () => {},
          ownerSlug: NO_RECEPTION.slug,
          reception: NO_RECEPTION.reception,
          claimList: { kind: "owner", status: claimList.status, claimList: claimList.claimList, checks: owned.checks },
        }),
        access: {
          kind: "owner",
          owner: NO_RECEPTION,
          claimList,
          checks: owned,
          citers: { result: { kind: "no-doi" }, retry: () => {} },
          claimChats: { summaries: [], onCheck: () => {}, onLens: () => {}, onOpen: () => {} },
        },
        onJump: () => {},
        view: "claims",
        onView: () => {},
        order: "prioritised",
        onOrder: () => {},
        blockOrder: new Map(),
        relevance: null,
        onRelevance: () => {},
        articleYear: null,
        thread: null,
        onThread: () => {},
        articleTitle: "A piece",
      }),
    );
  });
}

const ticks = () => [...host.querySelectorAll<HTMLInputElement>(".rcp-listed-tick")];
const checkButton = () => host.querySelector<HTMLButtonElement>("button.rcp-check-send");
const digButtons = () => [...host.querySelectorAll<HTMLButtonElement>("button.rcp-dig")];
const segments = () => [...host.querySelectorAll(".rcp-views [role='radio']")].map((b) => b.textContent ?? "");
const claimItem = (id: string) => host.querySelector(`.rcp-listed-claim[data-claim="${id}"]`);

function tick(i: number): void {
  act(() => {
    ticks()[i]?.click();
  });
}

function type(words: string): void {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="${SOURCES_CLAIM_CHECK_OWN_LABEL}"]`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, words);
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressCheck(): Promise<void> {
  await act(async () => {
    checkButton()?.click();
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sent.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Check", () => {
  it("is off with nothing picked, and names how many claims a press would search", async () => {
    paint();
    expect(ticks()).toHaveLength(LISTED.length);
    expect(checkButton()?.disabled).toBe(true);
    expect(checkButton()?.textContent).toBe("Check");
    await pressCheck();
    expect(sent).toEqual([]);
    tick(0);
    expect(checkButton()?.disabled).toBe(false);
    expect(checkButton()?.textContent).toBe("Check 1 claim");
  });

  it("posts the ticked ids and the typed words, and nothing else", async () => {
    paint();
    tick(1);
    type("  Salt is fine in moderation  ");
    expect(checkButton()?.textContent).toBe("Check 2 claims");
    await pressCheck();
    expect(sent).toEqual([{ claimIds: [B.id], own: "Salt is fine in moderation" }]);
    /* What was picked has become a check. */
    expect(ticks().some((t) => t.checked)).toBe(false);
  });

  it("is off over more than four claims", () => {
    paint();
    for (let i = 0; i < 4; i++) tick(i);
    expect(checkButton()?.disabled).toBe(false);
    tick(4);
    expect(checkButton()?.textContent).toBe("Check 5 claims");
    expect(checkButton()?.disabled).toBe(true);
    /* Four ticks and a typed claim is five too. */
    tick(4);
    type("one more");
    expect(checkButton()?.disabled).toBe(true);
  });

  it("is off while this tab's check is out, and while another tab's is", () => {
    paint();
    tick(0);
    expect(checkButton()?.disabled).toBe(false);
    paint({ sending: true });
    expect(checkButton()?.disabled).toBe(true);
    expect(ticks()[0]?.disabled).toBe(true);
    const pending = check("spya-chk234", [listedTarget(A)], [], { status: "pending" });
    paint({ checks: [pending] });
    expect(checkButton()?.disabled).toBe(true);
    /* The positive control: nothing out, a tick, and it is on. */
    paint({ checks: [] });
    expect(checkButton()?.disabled).toBe(false);
  });

  it("holds while check history loads or fails without saying a paid search is running", () => {
    paint({ status: "loading" });
    expect(checkButton()?.disabled).toBe(true);
    expect(host.textContent).not.toContain(SOURCES_CLAIM_CHECK_PENDING);
    expect(checkButton()?.querySelector(".spin")).toBeNull();

    paint({ status: "error", error: "The checks could not be read." });
    expect(checkButton()?.disabled).toBe(true);
    expect(host.textContent).toContain("The checks could not be read.");
    expect(host.textContent).not.toContain(SOURCES_CLAIM_CHECK_PENDING);
    expect(checkButton()?.querySelector(".spin")).toBeNull();
  });

  it("is not offered on a stale list: no boxes, no Check", () => {
    paint({}, { stale: true });
    expect(ticks()).toHaveLength(0);
    expect(checkButton()).toBeNull();
  });
});

describe("what the checks found", () => {
  it("draws a page once under a claim, however many checks found it", () => {
    const first = check("spya-chk234", [listedTarget(A)], [
      { claimId: A.id, outcome: "answered", rows: [row("https://a.example/one"), row("https://a.example/two")] },
    ]);
    const second = check(
      "spya-chk345",
      [listedTarget(A)],
      [{ claimId: A.id, outcome: "answered", rows: [row("https://a.example/two"), row("https://a.example/three")] }],
      { digFurther: true },
    );
    paint({ checks: [first, second] });
    const titles = [...(claimItem(A.id)?.querySelectorAll(".rcp-item a.rcp-title") ?? [])].map((a) => a.textContent);
    expect(titles).toEqual(["Page at https://a.example/one", "Page at https://a.example/two", "Page at https://a.example/three"]);
    /* The segment counts the rows on screen, a page once per claim. */
    expect(segments()[2]).toBe("Claims3");
  });

  it("says found nothing only for an explicit empty answer, and something else when a claim was not answered", () => {
    const done = check(
      "spya-chk234",
      [listedTarget(A), listedTarget(B)],
      [
        { claimId: A.id, outcome: "answered", rows: [] },
        { claimId: B.id, outcome: "not-answered" },
      ],
    );
    paint({ checks: [done] });
    expect(claimItem(A.id)?.textContent).toContain(SOURCES_CLAIM_CHECK_FOUND_NOTHING);
    expect(claimItem(A.id)?.textContent).not.toContain(SOURCES_CLAIM_CHECK_NOT_ANSWERED);
    expect(claimItem(B.id)?.textContent).toContain(SOURCES_CLAIM_CHECK_NOT_ANSWERED);
    expect(claimItem(B.id)?.textContent).not.toContain(SOURCES_CLAIM_CHECK_FOUND_NOTHING);
  });

  it("draws a check made from an earlier version of the article apart, read-only, never under the claim", () => {
    const old = check(
      "spya-chk234",
      [listedTarget(A)],
      [{ claimId: A.id, outcome: "answered", rows: [row("https://a.example/one")] }],
      { listSourceHash: "an-older-list" },
    );
    const again = check(
      "spya-chk345",
      [listedTarget(A)],
      [{ claimId: A.id, outcome: "answered", rows: [row("https://a.example/one"), row("https://a.example/two")] }],
      { listSourceHash: "an-older-list", digFurther: true, createdAt: "2026-10-09T11:00:00.000Z" },
    );
    paint({ checks: [old, again] });
    expect(claimItem(A.id)?.querySelector(".rcp-item")).toBeNull();
    const earlier = host.querySelector(".rcp-check-earlier");
    expect(earlier?.textContent).toContain(SOURCES_CLAIM_CHECK_EARLIER);
    /* One group for the one target, headed by its stored quote and statement, a page once. */
    const groups = earlier?.querySelectorAll(".rcp-checked-claim") ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.textContent).toContain(A.quote);
    expect(groups[0]?.textContent).toContain(A.statement);
    expect(groups[0]?.querySelectorAll(".rcp-item")).toHaveLength(2);
    /* Read-only: no Dig further, no box. */
    expect(earlier?.querySelectorAll("button.rcp-dig")).toHaveLength(0);
    expect(earlier?.querySelectorAll("input[type='checkbox']")).toHaveLength(0);
    expect(digButtons()).toHaveLength(0);
  });

  it("draws a typed claim from an earlier version in that group too, as your claim", () => {
    const own: SourcesClaimCheckTarget = { kind: "own", claimId: "spya-own234", text: "Rye is easier" };
    paint({
      checks: [
        check("spya-chk234", [own], [{ claimId: own.claimId, outcome: "answered", rows: [row("https://b.example/x")] }], {
          listSourceHash: "an-older-list",
        }),
      ],
    });
    const earlier = host.querySelector(".rcp-check-earlier");
    expect(earlier?.textContent).toContain(`${SOURCES_CLAIM_CHECK_YOUR_CLAIM}: `);
    expect(earlier?.textContent).toContain("Rye is easier");
    expect(earlier?.querySelectorAll(".rcp-item")).toHaveLength(1);
    expect(earlier?.querySelectorAll("button.rcp-dig")).toHaveLength(0);
  });

  it("draws a check under the claim with the same quote when the list was made again with new ids (E5)", async () => {
    const before = check(
      "spya-chk234",
      [{ ...listedTarget(A), claimId: "spya-old111" }],
      [{ claimId: "spya-old111", outcome: "answered", rows: [row("https://a.example/one")] }],
    );
    paint({ checks: [before] });
    expect(claimItem(A.id)?.querySelectorAll(".rcp-item")).toHaveLength(1);
    expect(host.querySelector(".rcp-checked-claim")).toBeNull();
    await act(async () => {
      claimItem(A.id)?.querySelector<HTMLButtonElement>("button.rcp-dig")?.click();
    });
    expect(sent).toEqual([{ digFurther: A.id }]);
  });

  it("draws a checked claim the new list does not name as its own group, with its jump, rows and Dig further (E5)", async () => {
    const gone: SourcesClaimCheckTarget = {
      kind: "listed",
      claimId: "spya-gone11",
      blockId: BLOCK,
      quote: "a line no longer listed",
      statement: "A claim the new list dropped.",
    };
    paint({
      checks: [
        check("spya-chk234", [gone], [
          { claimId: gone.claimId, outcome: "answered", rows: [row("https://g.example/1"), row("https://g.example/1")] },
        ]),
      ],
    });
    const group = host.querySelector(".rcp-checked-claim");
    expect(group?.textContent).toContain("a line no longer listed");
    expect(group?.textContent).toContain("A claim the new list dropped.");
    expect(group?.querySelector(".block-ref")).not.toBeNull();
    expect(group?.querySelectorAll(".rcp-item")).toHaveLength(1);
    expect(group?.closest(".rcp-check-earlier")).toBeNull();
    await act(async () => {
      group?.querySelector<HTMLButtonElement>("button.rcp-dig")?.click();
    });
    expect(sent).toEqual([{ digFurther: "spya-gone11" }]);
  });

  it("draws a typed claim as your claim, with its rows", () => {
    const own: SourcesClaimCheckTarget = { kind: "own", claimId: "spya-own234", text: "Rye is easier" };
    paint({
      checks: [check("spya-chk234", [own], [{ claimId: own.claimId, outcome: "answered", rows: [row("https://b.example/x")] }])],
    });
    const group = host.querySelector(".rcp-own-claim");
    expect(group?.textContent).toContain(`${SOURCES_CLAIM_CHECK_YOUR_CLAIM}: `);
    expect(group?.textContent).toContain("Rye is easier");
    expect(group?.querySelectorAll(".rcp-item")).toHaveLength(1);
  });
});

describe("Dig further", () => {
  it("is offered on a claim a finished check looked at, and sends that one claim alone", async () => {
    const done = check("spya-chk234", [listedTarget(A)], [{ claimId: A.id, outcome: "answered", rows: [] }]);
    paint({ checks: [done] });
    /* A ticked claim elsewhere must not ride along. */
    tick(1);
    expect(digButtons()).toHaveLength(1);
    await act(async () => {
      digButtons()[0]?.click();
    });
    expect(sent).toEqual([{ digFurther: A.id }]);
  });

  it("is held while a check is out", () => {
    const done = check("spya-chk234", [listedTarget(A)], [{ claimId: A.id, outcome: "answered", rows: [] }]);
    paint({ checks: [done], sending: true });
    expect(digButtons()[0]?.disabled).toBe(true);
  });
});
