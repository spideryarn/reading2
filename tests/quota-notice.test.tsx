// @vitest-environment jsdom
/**
 * **A refusal a reader can act on.**
 *
 * The quota has refused ingests since 2026-09-03 with a message naming where a
 * subscription is bought — *"the pricing page sets one up"*, and *"the Upgrade
 * button on your profile page"* before that page could sell anything — and
 * until this component there was no such button, and no link either. The reader was told where to go
 * and given nothing to press. That is
 * docs/reusable/silent-success.md with the person as the thing that fails
 * quietly: the API was correct, the copy was correct, and the reader was stuck.
 *
 * ## Why this file mounts the component rather than reading a function
 *
 * Because the claim under test is *a reader can get out of this*, and the
 * cheaper check — that `isQuotaRefusal` says true — re-states the assumption
 * rather than testing it. `tests/billing-plan.test.ts` covers the classifier;
 * this covers whether anything is drawn from its answer.
 *
 * ## And the mirror case
 *
 * A failure that is **not** the quota must not grow a link. `pay-off`,
 * `pay-down` and `pay-none` are all `pay-` codes and none of them is fixed by
 * subscribing — a link to the plans under *"we could not reach Stripe"* would
 * send somebody to buy their way out of an outage. Asserting only the presence
 * of a link would pass an implementation that put one under everything, which is
 * the version of this that would be worse than the sentence alone.
 *
 * ## The link has to go somewhere the refusal can be got out of
 *
 * The first version of this file asserted `["/pricing"]` for all three refusals,
 * which is what the component did and what GPT Sol found wrong on 2026-09-04: a
 * subscriber at their monthly limit and a reader with an `unpaid` subscription
 * both land on a page that draws no plan button for them, because `canCheckout`
 * is false. *A link somewhere* was never the claim — *a way out* was. So the
 * table below pins a destination per refusal **and** pins the server's own
 * sentence to it, since the prose names a page too and a reader who is offered
 * one page in words and another in a link has been given a choice we made badly.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  BILLING_NOT_AVAILABLE,
  BILLING_UNREACHABLE,
  NOTHING_TO_MANAGE,
  QUOTA_CODES,
  codeOfMessage,
  ingestQuotaReached,
} from "../src/messages.js";
import { QuotaNotice } from "../src/web/QuotaNotice.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Draw one message and hand back what a reader would see and could click. */
function draw(message: string | null): { text: string; links: string[] } {
  act(() => {
    root.render(<QuotaNotice message={message} className="whatever" />);
  });
  return {
    text: host.textContent ?? "",
    links: [...host.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
  };
}

/**
 * The three refusals, the page each is sent to, and why that page.
 *
 * Built through `ingestQuotaReached` rather than from literal strings, so this
 * asks about the real messages the API sends and not a copy of them.
 */
const REFUSALS = [
  {
    why: "never subscribed: there is something to buy, and the prices are on /pricing",
    refusal: ingestQuotaReached({ limit: 3 }),
    href: "/pricing",
  },
  {
    why: "a working subscription at its ceiling: nothing to buy, so /pricing draws no button",
    refusal: ingestQuotaReached({ limit: 20, resetAt: new Date("2026-10-03") }),
    href: "/profile",
  },
  {
    why: "a lapse the client cannot tell terminal from non-terminal: /profile works for both",
    refusal: ingestQuotaReached({ limit: 3, lapsed: true }),
    href: "/profile",
  },
] as const;

it("sends each of the three quota refusals where that refusal can be got out of", () => {
  for (const { why, refusal, href } of REFUSALS) {
    const drawn = draw(refusal.message);
    /* The server's own sentence, unaltered — the client never rewrites copy. */
    expect(drawn.text).toContain(refusal.message);
    expect(drawn.links, why).toEqual([href]);
  }
});

it("names the page it links to, rather than sending the reader two ways at once", () => {
  /* The half that goes stale silently. `pay-lapsed` said "resubscribing from the
     pricing page" while this drew a link to `/pricing` — and both were wrong for
     an `unpaid` subscription, which may not check out. Fixing only the link
     would have left the sentence telling the reader to go somewhere else. */
  for (const { refusal, href } of REFUSALS) {
    const wrongPage = href === "/pricing" ? "profile page" : "pricing page";
    expect(refusal.message, `names ${wrongPage} but links to ${href}`).not.toContain(wrongPage);
  }
});

it("covers every quota code there is, so a fourth refusal cannot be forgotten", () => {
  /* The table above is three hand-written cases, and a fourth `pay-` refusal
     added to `ingestQuotaReached` would simply not appear in it — green, and
     untested. `wayOut` in QuotaNotice.tsx will not compile without an arm for
     it; this is the other half, that somebody looked at where it should go. */
  expect(REFUSALS.map((r) => codeOfMessage(r.refusal.message)).sort()).toEqual(
    [...QUOTA_CODES].sort(),
  );
});

it("leaves an ordinary failure exactly as it was", () => {
  const drawn = draw("We couldn't fetch that page. [net-404]");
  expect(drawn.text).toBe("We couldn't fetch that page. [net-404]");
  expect(drawn.links).toEqual([]);
});

it("offers no upgrade for the billing failures a subscription cannot fix", () => {
  for (const failure of [BILLING_NOT_AVAILABLE, BILLING_UNREACHABLE, NOTHING_TO_MANAGE]) {
    const drawn = draw(failure.message);
    expect(drawn.text).toContain(failure.message);
    expect(drawn.links).toEqual([]);
  }
});

it("draws nothing at all when there is nothing wrong", () => {
  /* The surfaces hand it their error state directly, which is null most of the
     time — so an empty paragraph here would be a permanent blank line under the
     Add box. */
  expect(draw(null).text).toBe("");
  expect(draw("").text).toBe("");
});
