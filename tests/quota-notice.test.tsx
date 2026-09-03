// @vitest-environment jsdom
/**
 * **A refusal a reader can act on.**
 *
 * The quota has refused ingests since 2026-09-03 with a message ending *"the
 * Upgrade button on your profile page sets one up"* — and until this component
 * there was no such button, and no link either. The reader was told where to go
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
 * subscribing — a link to `/profile` under *"we could not reach Stripe"* would
 * send somebody to buy their way out of an outage. Asserting only the presence
 * of a link would pass an implementation that put one under everything, which is
 * the version of this that would be worse than the sentence alone.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  BILLING_NOT_AVAILABLE,
  BILLING_UNREACHABLE,
  NOTHING_TO_MANAGE,
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

it("puts a way to the plan page beside each of the three quota refusals", () => {
  /* Built through `ingestQuotaReached` rather than from literal strings, so this
     asks about the real messages the API sends and not a copy of them. */
  const refusals = [
    ingestQuotaReached({ limit: 3 }),
    ingestQuotaReached({ limit: 20, resetAt: new Date("2026-10-03") }),
    ingestQuotaReached({ limit: 3, lapsed: true }),
  ];
  for (const refusal of refusals) {
    const drawn = draw(refusal.message);
    /* The server's own sentence, unaltered — the client never rewrites copy. */
    expect(drawn.text).toContain(refusal.message);
    expect(drawn.links).toEqual(["/profile"]);
  }
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
