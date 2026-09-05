/**
 * The plan, and the two buttons that leave for Stripe.
 *
 * One read (`GET /api/billing/usage`) and three POSTs, which is the whole of the
 * billing client — there is no billing UI to build, because Checkout and the
 * Customer Portal are hosted and we never touch a card
 * (docs/project/billing.md § *We never touch a card*).
 *
 * ## Leaving the page is the success case
 *
 * `upgrade` and `manage` both end in `location.assign(...)` to an address Stripe
 * returned. So the *whole* of what this hook does on success is navigate away,
 * and `busy` is never cleared on that path on purpose: the tab is going, and
 * putting the button back to "Upgrade" for the half-second before it does reads
 * as the click having done nothing.
 *
 * What is cleared is the failure path, which is the one the reader is left
 * looking at.
 *
 * ## The Checkout return, and why it is a POST rather than a look at the URL
 *
 * Stripe sends the reader back to `/profile?checkout={CHECKOUT_SESSION_ID}`.
 * That query parameter is not evidence of anything — anybody can type one — so
 * the page does not read it as "they paid". It hands it to
 * `POST /api/billing/confirm`, which retrieves the session from Stripe and
 * proves it belongs to whoever is signed in before syncing
 * (src/billing/checkout.ts).
 *
 * And it is a **convenience, not the mechanism**: the webhook is what makes a
 * subscription real. If confirm fails, the plan still arrives — a moment later,
 * on the next load — so a failure here is worth a quiet line rather than an
 * alarm.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { isPurchase } from "../billing-plan.js";
import type { BillingSummary } from "../billing-plan.js";
import { apiFetch, readJson } from "./lib/api.js";

/** What the Checkout return said, once we have asked the server about it. */
export type CheckoutReturn =
  /** Nothing in the address bar; the ordinary case. */
  | { kind: "none" }
  /** They pressed Back or closed Stripe's page. Nothing was charged. */
  | { kind: "cancelled" }
  | { kind: "checking" }
  | { kind: "confirmed" }
  /** We could not confirm it here. The webhook still will. */
  | { kind: "unconfirmed"; why: string };

export interface UseBilling {
  /** `null` until the first read lands — "don't know yet", not "no plan". */
  summary: BillingSummary | null;
  /** Why the read failed, or null. A failed read leaves `summary` alone. */
  error: string | null;
  /** Which button is mid-request, so only that one shows it. */
  busy: null | { kind: "upgrade"; tierId: string } | { kind: "manage" };
  /** Why the last button press failed, or null. Cleared by the next press. */
  actionError: string | null;
  /** What came back from a Checkout redirect, if this load is one. */
  checkout: CheckoutReturn;
  /** Buy a tier: ask for a Checkout Session, then go to it. */
  upgrade(tierId: string): void;
  /** Open the hosted Portal — invoices, card, cancellation. */
  manage(): void;
  reload(): void;
}

/**
 * The body, once it has been checked to be the answer this bundle understands.
 *
 * **`readJson<BillingSummary>` was a cast, and a cast is not a check** — it is
 * `JSON.parse(text) as T` and nothing else (./lib/api.ts). So every guarantee
 * the type makes held only while the server was the version this client was
 * built against, and during a deploy it is not: a browser holding yesterday's
 * bundle gets today's route, and a rollback runs it the other way round for as
 * long as it takes. A reply carrying the `canCheckout`/`offers` pair `purchase`
 * replaced on 2026-09-04 has no `purchase` at all, and `summary.purchase.kind`
 * on `undefined` throws **inside a render** — which blanks the whole billing
 * area rather than showing the plan that did arrive. GPT Sol, 2026-09-04.
 *
 * Throwing puts it on the read's existing failure path: `summary` is left alone
 * and a line appears saying what is on screen may be out of date, which is the
 * same treatment a 500 gets and the right one for "this answer cannot be drawn".
 * The message is a reader's sentence rather than a developer's, because it is
 * rendered.
 *
 * `isPurchase` (../billing-plan.ts) is the whole of the checking, deliberately:
 * the non-empty tuple, and which of the four doors this is, are the invariants
 * the components read straight off without asking.
 */
function checkedSummary(body: unknown): BillingSummary {
  const summary = body as BillingSummary | null;
  if (!summary || !isPurchase(summary.purchase)) {
    throw new Error("This page and the server are out of step — reload to read your plan again.");
  }
  return summary;
}

export function useBilling(): UseBilling {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<UseBilling["busy"]>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutReturn>({ kind: "none" });
  const [attempt, setAttempt] = useState(0);

  /* Which read is the newest. A `reload` fired while the first is still in
     flight can otherwise land in the wrong order and write the older answer
     over the newer one — the same out-of-order guard `useProfile` carries, and
     here it would show a plan from before a Checkout completed. */
  const generation = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is not read in here — it IS the trigger. `reload` bumps it, and so does a confirmed Checkout, which is the whole of "the plan has just changed, read it again". Biome cannot see a dependency whose only job is to change; useExperimental.ts carries the same line for the same reason.
  useEffect(() => {
    const mine = ++generation.current;
    apiFetch("/api/billing/usage")
      .then((r) => readJson<unknown>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        setSummary(checkedSummary(body));
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        /* **`summary` is left alone.** A refresh that fails should leave the
           plan on screen with a line saying it may be stale, rather than
           replacing a true answer with an empty card. Same rule as the shelf's
           admin table. */
        setError(e.message);
      });
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * The Checkout return, run once per load.
   *
   * `?checkout=cancelled` is Stripe's own `cancel_url`, so it means the reader
   * left without paying — said plainly, because "nothing has been charged" is
   * the thing somebody who has just backed out of a payment page wants to read.
   *
   * Anything else is treated as a session id and handed to the server, which is
   * the only thing that can say whether it is one. **The address is cleaned
   * either way**, with `replaceState` rather than a navigation, so a reload does
   * not confirm the same session again and the id is not left in the history for
   * whoever borrows the laptop.
   */
  useEffect(() => {
    const found = new URLSearchParams(location.search).get("checkout");
    if (!found) return;
    history.replaceState(null, "", location.pathname);

    if (found === "cancelled") {
      setCheckout({ kind: "cancelled" });
      return;
    }

    let live = true;
    setCheckout({ kind: "checking" });
    apiFetch("/api/billing/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: found }),
    })
      .then((r) => readJson<{ status: string | null }>(r))
      .then(() => {
        if (!live) return;
        setCheckout({ kind: "confirmed" });
        /* The plan has just changed, so the card above must not go on showing
           the old one. */
        setAttempt((n) => n + 1);
      })
      .catch((e: Error) => live && setCheckout({ kind: "unconfirmed", why: e.message }));
    return () => {
      live = false;
    };
  }, []);

  /**
   * Ask for a URL and go to it. The two buttons differ only in what they post.
   *
   * `location.assign` rather than `window.open`: this is a redirect the reader
   * asked for, and a popup is the thing a browser blocks when it arrives after
   * an `await`.
   */
  const leaveFor = useCallback(
    (which: NonNullable<UseBilling["busy"]>, path: string, body: unknown) => {
      if (busy) return;
      setBusy(which);
      setActionError(null);
      apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => readJson<{ kind?: string; url: string }>(r))
        .then((answer) => {
          if (!answer.url) throw new Error("No address came back to send you to.");
          /* **`kind` may say `portal` in answer to a checkout**, when the
             account turns out to have a subscription that is not over — an
             `unpaid` one, say, which is unentitled and still collectable
             (src/billing/checkout.ts § *Over is a shorter list than
             unentitled*). We follow it, because the Portal is where that reader
             needs to be. The page says nothing about the swap: it is leaving,
             and a sentence rendered for the half-second before a navigation is a
             sentence nobody reads. */
          /* `busy` deliberately stays set — see the header. */
          location.assign(answer.url);
        })
        .catch((e: Error) => {
          setActionError(e.message);
          setBusy(null);
        });
    },
    [busy],
  );

  const upgrade = useCallback(
    (tierId: string) => {
      /* **Only a tier id crosses the wire.** The price is the server's, read
         from `billing_tiers`; a `price` field in this body would be *refused*
         rather than ignored (`parseCheckoutRequest`), and no currency is sent
         at all — hosted Checkout picks one from the customer's location, which
         is the whole reason the price carries three. */
      leaveFor({ kind: "upgrade", tierId }, "/api/billing/checkout", { tierId });
    },
    [leaveFor],
  );

  const manage = useCallback(() => {
    /* No body worth sending: the only thing it could carry is a customer id,
       and that comes from the reader's own row. */
    leaveFor({ kind: "manage" }, "/api/billing/portal", {});
  }, [leaveFor]);

  return { summary, error, busy, actionError, checkout, upgrade, manage, reload };
}
