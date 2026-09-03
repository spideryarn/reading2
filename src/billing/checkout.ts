/**
 * **The door in the wall**: starting a subscription, managing one, and proving a
 * completed Checkout belongs to the reader who is asking about it.
 *
 * Three routes' worth of decisions, kept out of src/routes.ts so that the order
 * of operations below is readable in one place — and so that the Stripe client is
 * a parameter rather than a module import, which is what lets the tests exercise
 * every branch without a network. docs/project/billing.md.
 *
 * ## The customer→owner mapping is the whole guarantee
 *
 * The webhook (src/billing/webhook.ts) looks an event's customer up in
 * `billing_accounts.stripe_customer_id`, and answers 503 when it finds nothing.
 * So if a Checkout Session capable of taking money could exist before that row
 * was committed, a customer could pay and get nothing until Stripe gave up
 * retrying. The browser's return to `/profile` cannot close that window: a
 * redirect is not a delivery guarantee, and the reader may close the tab.
 *
 * `startCheckout` therefore writes the mapping **first**, in this order:
 *
 * 1. the owner, from the gate — never from the request body;
 * 2. `insert billing_accounts (owner_id) on conflict do nothing`, the same anchor
 *    admission uses (src/store/pg-billing.ts);
 * 3. read it back — a customer already there is reused, and a subscription that
 *    is not over sends them to the Portal instead of selling a second one;
 * 4. otherwise create the Stripe customer and claim it with a **conditional**
 *    UPDATE;
 * 5. only then create the Checkout Session, always naming that customer.
 *
 * **Never let Checkout mint the customer.** `customer_creation` and an omitted
 * `customer` both produce a Stripe customer that is unmapped by construction
 * until something writes the mapping afterwards — which is the unreliable
 * return-path design the paragraph above rules out.
 *
 * ## Why the claim is a conditional UPDATE and not a lock
 *
 * `update … set stripe_customer_id = $cus where owner_id = $owner and
 * stripe_customer_id is null` matches one row or none, and **none means a
 * concurrent request won**: at `read committed` the second statement blocks on
 * the first's row lock, then re-evaluates its predicate against the committed
 * value and declines. The loser re-reads, uses the winner's customer, and
 * abandons its own — leaving an orphaned Stripe customer with no subscription,
 * which costs nothing and is invisible to the reader.
 *
 * That is the accepted cost of not taking a lock, and it was a decision rather
 * than an omission: GPT Sol asked for serialisation here and Fable's review found
 * it bought nothing *for the mapping*. `stripe_customer_id` is unique, so two
 * owners can never share one however the race goes.
 *
 * ## What the race really can cost, said plainly
 *
 * An earlier version of this paragraph said the worst a double-click reaches is
 * that orphaned customer. **That is false and GPT Sol caught it** (2026-09-03):
 * the subscription check below and `checkout.sessions.create` have nothing
 * spanning them, so two concurrent requests can both see no subscription and both
 * be handed a payable Session. Complete both and the reader has two
 * subscriptions and two invoices.
 *
 * It is a known, accepted risk rather than an oversight — reusing an open Session
 * was weighed and dropped, because defending against it needs stored session
 * state and expiry handling
 * (docs/plans/260902i-stripe-payments-and-subscription-tiers.md § *Stripe state*).
 * What catches it afterwards is `chooseSubscription`'s multiple-live anomaly,
 * which logs at `error` and never picks quietly. **And that net has a hole worth
 * knowing about**: it counts only *entitled* subscriptions as live, so an
 * `active` beside an `unpaid` is two real invoices and no anomaly reported. If
 * this is ever tightened, Stripe's own "limit customers to one subscription"
 * Checkout setting is the cheapest first move, and it is a dashboard setting
 * nothing in this repository configures or checks.
 *
 * ## Every price comes from the database
 *
 * The request names a **tier id**, and `billing_tiers` says which Stripe price
 * that sells (src/store/pg-tiers.ts). A price id from the browser is never
 * accepted — it would let anyone check out against any price in the Stripe
 * account, including one created for somebody else at a different amount.
 */

import type Stripe from "stripe";

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { billingAccounts } from "../db/schema.js";
import { errorFields, log } from "../log.js";
import { BILLING_NOT_AVAILABLE, BILLING_UNREACHABLE, NOTHING_TO_MANAGE } from "../messages.js";
import type { OwnerId } from "../owner.js";
import { readTiers } from "../store/pg-tiers.js";
import { PUBLIC_ORIGIN } from "../urls.js";
import { StripeConfigError, assertLivemode, isProductionDeployment, stripeClient } from "./stripe.js";
import { type SyncResult, syncSubscriptionFromStripe } from "./sync.js";
import { isTerminalStatus } from "./tiers.js";
import type { TierRow } from "./tiers.js";

const logger = log("http");

/** An error carrying the HTTP status it should be reported as — as src/routes.ts does. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * The Stripe surface these three routes use, and nothing else.
 *
 * A structural subset of `Stripe` rather than the class itself, so a test's fake
 * is three small functions instead of a client. The real client satisfies it —
 * `stripeClient()` is assigned to it below, so a drift in the SDK's signatures
 * is a compile error here rather than a surprise in production.
 */
export interface StripeCheckout {
  readonly customers: {
    create(params: Stripe.CustomerCreateParams): Promise<Stripe.Customer>;
  };
  readonly checkout: {
    readonly sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
  readonly billingPortal: {
    readonly sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<Stripe.BillingPortal.Session>;
    };
  };
}

/** The seams. Both default to the real thing, so forgetting to inject cannot make a build inert. */
export interface CheckoutDeps {
  readonly stripe?: StripeCheckout;
  readonly sync?: (customerId: string) => Promise<SyncResult>;
}

/**
 * Where Stripe sends the reader back to.
 *
 * **Built here, never from a request header.** A `Host` an attacker chooses would
 * become the address a paying customer is returned to, and `X-Forwarded-Host` is
 * the version of that mistake which looks careful. The same reasoning as
 * `PUBLIC_ORIGIN` in src/urls.ts, which is where the production value lives.
 *
 * Production is decided first and reads no variable, so nothing in the
 * environment can point a real customer's return anywhere but at us.
 * `SPIDERYARN_BASE_URL` exists for a local dev server that is not on 5273 —
 * every worktree after the first gets 5274, 5275… (docs/project/worktrees.md).
 */
export function billingReturnOrigin(): string {
  if (isProductionDeployment()) return PUBLIC_ORIGIN;

  const configured = process.env.SPIDERYARN_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      /* Fall through to the deployment host. A malformed override is worth a
         line rather than a throw on the one route that sells things. */
    }
    logger.warn({ configured }, "SPIDERYARN_BASE_URL is not an http(s) URL, so it was ignored");
  }

  const preview = process.env.VERCEL_URL?.trim();
  if (preview) return preview.includes("://") ? preview : `https://${preview}`;

  return "http://localhost:5273";
}

/** Where a finished or abandoned Checkout lands. `/profile` is the billing surface. */
function returnUrls(): { success: string; cancel: string } {
  const origin = billingReturnOrigin();
  return {
    /* `{CHECKOUT_SESSION_ID}` is Stripe's own template, filled in on the
       redirect. It is the *only* thing the success page gets, and
       `confirmCheckout` proves it belongs to whoever is signed in before it
       syncs — see that function. */
    success: `${origin}/profile?checkout={CHECKOUT_SESSION_ID}`,
    cancel: `${origin}/profile?checkout=cancelled`,
  };
}

/**
 * The client, with a configuration problem turned into something a reader can read.
 *
 * `stripeConfigProblem()` names a key and a mode, which is what an operator needs
 * and what a reader must never see. 503 rather than 500: this deployment cannot
 * sell anything, and it is not a fault in what was asked for.
 */
function billingClient(deps: CheckoutDeps): StripeCheckout {
  if (deps.stripe) return deps.stripe;
  /* Annotated rather than returned directly: this line is where the real client
     is checked against `StripeCheckout`, so an SDK whose signatures moved is a
     compile error here instead of a runtime surprise on the route that sells. */
  const client: StripeCheckout = stripeClient();
  return client;
}

/**
 * A failure the Stripe SDK raised, by the discriminant it puts on every one.
 *
 * `type` is declared on `StripeError` itself and is always a `Stripe…` name —
 * `StripeConnectionError`, `StripeAPIError`, `StripeInvalidRequestError` and so
 * on. Read structurally rather than with `instanceof Stripe.errors.StripeError`,
 * because the client is injectable here and a test's fake is not the SDK.
 */
function isStripeFailure(err: unknown): err is Error & { type: string; statusCode?: number } {
  const type = (err as { type?: unknown }).type;
  return err instanceof Error && typeof type === "string" && type.startsWith("Stripe");
}

/**
 * Run one billing route, and answer every failure with something a reader can read.
 *
 * Three kinds come out of these routes and they must not be flattened:
 *
 * - **`StripeConfigError`** — an unset key, a key from the wrong mode, or a
 *   `livemode` on a retrieved object that disagrees with the deployment. This
 *   deployment cannot take money at all: **503**, `BILLING_NOT_AVAILABLE`.
 * - **A Stripe SDK failure** — a timeout, a rate limit, a 500 from their side, a
 *   customer that has been deleted. **502**, `BILLING_UNREACHABLE`, and another
 *   go is worth offering. Until 2026-09-03 these escaped untouched and the
 *   dispatcher put **Stripe's own sentence** in the response with a 500 beside
 *   it (GPT Sol), which is both the wrong status and the provider's words on a
 *   reader's screen.
 * - **Anything already carrying a status** — the 400s, 404s and 409s this file
 *   throws on purpose. Rethrown untouched.
 *
 * Everything else is a bug in this file and stays a 500 with its stack, which is
 * what gets it reported. Mapping those to 502 as well would be tidier and would
 * quietly relabel our faults as Stripe's.
 */
async function orBillingUnavailable<T>(what: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof StripeConfigError) {
      logger.error(
        { what, ...errorFields(err) },
        "refusing a billing request: Stripe is misconfigured",
      );
      throw httpError(503, BILLING_NOT_AVAILABLE.message);
    }
    if (typeof (err as { status?: unknown }).status === "number") throw err;
    if (isStripeFailure(err)) {
      logger.error(
        { what, stripeType: err.type, stripeStatus: err.statusCode, ...errorFields(err) },
        "a billing request failed at Stripe",
      );
      throw httpError(502, BILLING_UNREACHABLE.message);
    }
    throw err;
  }
}

/* ------------------------------------------------------------ the request -- */

/** What the browser may ask for: a tier we sell, and optionally which currency. */
export interface CheckoutRequest {
  readonly tierId: string;
  readonly currency?: string;
}

/**
 * Read the body: a tier id, optionally a currency, and a named list of refusals.
 *
 * **A `price`/`priceId` field is not merely ignored, it is refused**, and the
 * difference matters: silently dropping it would let a caller believe they had
 * chosen a price and be charged for something else, and it would leave no sign
 * in a log that somebody had tried. The price always comes from the tier row.
 *
 * Fields that are neither in the allowlist nor in that refusal list *are* ignored
 * — this is not a strict schema, and saying so beats a docstring that claims it
 * refuses everything it does not recognise. What matters is that nothing outside
 * `tierId` and `currency` can reach Stripe, which is a property of the two lines
 * below rather than of the refusal list.
 */
export function parseCheckoutRequest(body: unknown): CheckoutRequest {
  const bag = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  for (const forbidden of ["price", "priceId", "price_id", "customer", "ownerId", "owner_id"]) {
    if (forbidden in bag) {
      throw httpError(
        400,
        `Expected { tierId }. The ${forbidden} is decided by the server, not by the request.`,
      );
    }
  }

  const tierId = bag.tierId;
  if (typeof tierId !== "string" || tierId.trim() === "") {
    throw httpError(400, "Expected { tierId } naming a tier this app sells");
  }

  const currency = bag.currency;
  if (currency !== undefined && (typeof currency !== "string" || !/^[a-z]{3}$/.test(currency))) {
    throw httpError(400, "Expected { currency } to be a three-letter lower-case code");
  }

  return currency === undefined
    ? { tierId: tierId.trim() }
    : { tierId: tierId.trim(), currency };
}

/**
 * The tier this request names, and the price it sells.
 *
 * `active` is required here, unlike in `tierForPrice`, and the asymmetry is the
 * point: `active` decides what may be **sold**, while somebody already subscribed
 * to a retired tier keeps their allowance. Selling a retired tier is exactly what
 * retiring it is meant to stop.
 *
 * ## `readTiers`, not the cached `allTiers`
 *
 * `allTiers()` holds the table for thirty seconds, which is right for admission —
 * it runs on every ingest and a slightly stale *quota* is harmless. It is wrong
 * here, and GPT Sol found it (2026-09-03): a session minted from a stale snapshot
 * can sell a tier somebody has just retired, or the price they have just replaced
 * — and **the damage is not bounded by the thirty seconds**, because a Checkout
 * Session stays payable for about a day and the subscription it creates then
 * bills on the old price for as long as it lasts. `recordTierPrice` clears only
 * the cache in the setup script's own process, so a running web instance never
 * hears about the change at all.
 *
 * The cost is one extra pair of statements per press of *Upgrade*, which is a
 * thing that happens a handful of times a day.
 */
async function tierToSell(
  tierId: string,
): Promise<TierRow & { stripePriceId: string; livemode: boolean }> {
  const tiers = await readTiers();
  const tier = tiers.find((t) => t.id === tierId);

  /* A tier that does not exist, or one somebody retired: the *request* named
     something we do not sell, so it is a 400. */
  if (!tier || !tier.active) {
    logger.warn(
      { tierId, found: Boolean(tier), active: tier?.active },
      "a checkout named a tier this deployment does not sell",
    );
    throw httpError(400, "That is not a plan this app sells");
  }

  /* **An active tier with no Stripe price is our fault, not theirs**, and it was
     a 400 until GPT Sol separated the two (2026-09-03). It means nobody has run
     `scripts/stripe-setup.ts` against this deployment's key, and telling the
     reader they asked for something that does not exist sends them looking for a
     mistake they did not make. `livemode` is required with it so the mode check
     downstream has a boolean rather than a null that would quietly read as "not
     live" in a test-mode deployment. */
  if (!tier.stripePriceId || tier.livemode === null) {
    logger.error(
      { tierId },
      "an active tier has no Stripe price on its row, so it cannot be sold — run scripts/stripe-setup.ts",
    );
    throw httpError(503, BILLING_NOT_AVAILABLE.message);
  }

  return { ...tier, stripePriceId: tier.stripePriceId, livemode: tier.livemode };
}

/** Which currency to charge in, refusing one the tier is not priced in. */
function currencyToCharge(tier: TierRow, asked: string | undefined): string | undefined {
  if (asked === undefined) return undefined;
  if (!(asked in tier.amounts)) {
    throw httpError(400, `This plan is not priced in ${asked.toUpperCase()}`);
  }
  return asked;
}

/* --------------------------------------------------------------- the row -- */

/** The columns these routes decide from. */
const ACCOUNT_COLUMNS = {
  stripeCustomerId: billingAccounts.stripeCustomerId,
  stripeSubscriptionId: billingAccounts.stripeSubscriptionId,
  status: billingAccounts.status,
} as const;

interface Account {
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly status: string | null;
}

/**
 * Make sure this owner has a billing row, then read it.
 *
 * The anchor `insert … on conflict do nothing` is the same one `reserveIngest`
 * does, and for a related reason: everything afterwards addresses a row that
 * must already exist. Two statements rather than one transaction — there is
 * nothing here to serialise, because the conditional UPDATE that claims the
 * customer does its own deciding.
 */
async function anchorAndRead(ownerId: OwnerId): Promise<Account> {
  const db = getDb();
  await db
    .insert(billingAccounts)
    .values({ ownerId })
    .onConflictDoNothing({ target: billingAccounts.ownerId });

  const [row] = await db
    .select(ACCOUNT_COLUMNS)
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);
  if (!row) throw new Error(`billing_accounts row for ${ownerId} is missing right after its insert`);
  return row;
}

/** Read the row without creating one — for the routes that only ask. */
async function readAccount(ownerId: OwnerId): Promise<Account | undefined> {
  const [row] = await getDb()
    .select(ACCOUNT_COLUMNS)
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerId, ownerId))
    .limit(1);
  return row;
}

/**
 * Does this account already have a subscription that selling another would
 * duplicate?
 *
 * A subscription id with a status that is **not terminal**. A null status beside
 * a subscription id counts as not terminal on purpose: it is a row nothing has
 * synced, and sending that reader to the Portal shows them what they have,
 * whereas selling them a second subscription charges them twice.
 */
function hasOpenSubscription(account: Account): boolean {
  return Boolean(account.stripeSubscriptionId) && !isTerminalStatus(account.status);
}

/**
 * Create a Stripe customer for this owner and write the mapping down, or adopt
 * the one a concurrent request wrote first.
 *
 * See the header for why zero rows means "somebody else won" rather than "the
 * update failed", and why the orphaned customer is accepted.
 */
async function claimCustomer(
  stripe: StripeCheckout,
  ownerId: OwnerId,
): Promise<string> {
  /* `owner_id` in metadata is recovery and assertion data — something to read in
     the Stripe dashboard when a support conversation starts — and never a source
     of truth. The mapping is the row. */
  const customer = await stripe.customers.create({ metadata: { owner_id: ownerId } });
  assertLivemode(customer.livemode, `customer ${customer.id}`);

  const claimed = await getDb()
    .update(billingAccounts)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(
      and(eq(billingAccounts.ownerId, ownerId), isNull(billingAccounts.stripeCustomerId)),
    )
    .returning({ ownerId: billingAccounts.ownerId });
  if (claimed.length === 1) return customer.id;

  const winner = await readAccount(ownerId);
  if (!winner?.stripeCustomerId) {
    /* The UPDATE matched nothing and the column is still null, which the
       predicate says cannot happen. Loud rather than papered over: the
       alternative is creating a second customer in a loop. */
    throw new Error(
      `could not claim a Stripe customer for ${ownerId}: the update matched no row and the ` +
        "column is still empty",
    );
  }
  logger.info(
    { ownerId, abandoned: customer.id, using: winner.stripeCustomerId },
    "a concurrent checkout mapped this owner's Stripe customer first, so ours is abandoned",
  );
  return winner.stripeCustomerId;
}

/* ------------------------------------------------------------- the routes -- */

/** Where to send the browser next, and which of the two doors it is. */
export type CheckoutStarted =
  | { readonly kind: "checkout"; readonly url: string; readonly sessionId: string }
  /** They already have a subscription, so this is the Portal rather than a sale. */
  | { readonly kind: "portal"; readonly url: string };

/**
 * `POST /api/billing/checkout` — start a subscription, or manage the one they have.
 *
 * The order of operations is the guarantee; see the header. Everything the
 * request may decide is a tier id and a currency, both checked against
 * `billing_tiers` before Stripe hears about them.
 */
export async function startCheckout(
  ownerId: OwnerId,
  request: CheckoutRequest,
  deps: CheckoutDeps = {},
): Promise<CheckoutStarted> {
  return await orBillingUnavailable("checkout", async () => {
    const stripe = billingClient(deps);
    const tier = await tierToSell(request.tierId);
    /* **The price's own mode, checked against the deployment's.** A row written
       by a run of scripts/stripe-setup.ts against the other mode's key is the way
       this goes wrong, and selling against it would either charge a real card in
       a test deployment or hand out entitlement for a test card in production.
       A boolean by the time it gets here: `tierToSell` refuses a null `livemode`
       outright, so that this line cannot be handed a null and quietly pass it as
       "not live". */
    assertLivemode(tier.livemode, `price ${tier.stripePriceId}`);
    const currency = currencyToCharge(tier, request.currency);

    const account = await anchorAndRead(ownerId);
    if (hasOpenSubscription(account)) {
      /* The schema's `billing_accounts_subscription_needs_customer` check means a
         subscription id cannot exist without a customer, so this is not a maybe. */
      const customerId = account.stripeCustomerId;
      if (!customerId) {
        throw new Error(`${ownerId} has a subscription with no Stripe customer, which the schema forbids`);
      }
      logger.info(
        { ownerId, status: account.status },
        "this account already has a subscription, so checkout became the portal",
      );
      return { kind: "portal", url: await portalUrl(stripe, customerId) } satisfies CheckoutStarted;
    }

    const customerId = account.stripeCustomerId ?? (await claimCustomer(stripe, ownerId));

    /* **Only now.** The mapping is committed, so a webhook for this customer can
       already find its owner — which is the whole reason for the order above. */
    const urls = returnUrls();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      /* Explicit, always. See the header: a Stripe-minted customer is unmapped
         by construction. */
      customer: customerId,
      /* Redundant with the mapping and deliberately so — it is what a person
         reconciling a payment by hand reads, and what the success return path
         checks the session against. Never a source of truth. */
      client_reference_id: ownerId,
      line_items: [{ price: tier.stripePriceId, quantity: 1 }],
      ...(currency ? { currency } : {}),
      success_url: urls.success,
      cancel_url: urls.cancel,
      subscription_data: { metadata: { owner_id: ownerId, tier: tier.id } },
    });
    assertLivemode(session.livemode, `checkout session ${session.id}`);
    if (!session.url) {
      /* A hosted session with no URL is nothing the reader can be sent to. 502
         rather than 500: the failure is Stripe's answer, not our arithmetic. */
      throw httpError(502, "Stripe did not return a checkout page to send you to");
    }
    return { kind: "checkout", url: session.url, sessionId: session.id } satisfies CheckoutStarted;
  });
}

/** One Portal session for this customer, back to `/profile` when they are done. */
async function portalUrl(stripe: StripeCheckout, customerId: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${billingReturnOrigin()}/profile`,
  });
  assertLivemode(session.livemode, `portal session ${session.id}`);
  return session.url;
}

/**
 * `POST /api/billing/portal` — the hosted place to see invoices, change a card,
 * or cancel.
 *
 * **Refuses an owner with no Stripe customer**, which is somebody who has never
 * started a checkout: there is no billing history to manage, and creating a
 * customer to open an empty Portal would write a mapping nothing is behind.
 */
export async function openPortal(
  ownerId: OwnerId,
  deps: CheckoutDeps = {},
): Promise<{ url: string }> {
  return await orBillingUnavailable("portal", async () => {
    const stripe = billingClient(deps);
    const account = await readAccount(ownerId);
    if (!account?.stripeCustomerId) {
      throw httpError(409, NOTHING_TO_MANAGE.message);
    }
    return { url: await portalUrl(stripe, account.stripeCustomerId) };
  });
}

/**
 * `POST /api/billing/confirm` — the return path from a completed Checkout.
 *
 * **It proves the session belongs to whoever is signed in before it syncs
 * anything.** A callback that syncs whatever session id it is handed lets one
 * reader make this server do work about another's subscription, and — worse — a
 * guessed or shared session id would be a way to find out whether somebody
 * subscribed. So both of the session's owner-bearing fields are checked:
 * `client_reference_id`, which we set, and `customer`, which must equal the
 * mapping already committed for this owner.
 *
 * It is a **convenience, not the mechanism.** The webhook is what makes a
 * subscription real; this exists so the reader who lands back on `/profile`
 * within a second of paying sees their new plan rather than a stale page. Nothing
 * is lost if it never runs.
 */
export async function confirmCheckout(
  ownerId: OwnerId,
  sessionId: string,
  deps: CheckoutDeps = {},
): Promise<{ status: string | null }> {
  return await orBillingUnavailable("confirm", async () => {
    /* Shape-checked before Stripe is asked, so a junk id is a 400 here rather
       than a round trip that comes back 404. */
    if (!/^cs_[A-Za-z0-9_]{4,255}$/.test(sessionId)) {
      throw httpError(400, "Expected { sessionId } to be a Stripe Checkout Session id");
    }

    const stripe = billingClient(deps);
    /* **The account is read before the session**, so a reader who has never
       checked out cannot make this server retrieve arbitrary session ids. */
    const account = await readAccount(ownerId);
    if (!account?.stripeCustomerId) throw notYours(ownerId, sessionId, "no customer is mapped");

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      /* **Only a 404 from Stripe means "no such session".** Everything else — a
         timeout, a rate limit, a revoked key — is rethrown for the wrapper to
         turn into a 502, because answering *no such checkout session* to a
         Stripe outage blames the identifier for something that is not its fault
         and hides the outage from whoever is looking. It said the latter for
         every failure until GPT Sol pointed it out, 2026-09-03. */
      if (isStripeFailure(err) && err.statusCode !== 404) throw err;
      if (err instanceof StripeConfigError) throw err;
      throw notYours(ownerId, sessionId, `Stripe would not return it: ${(err as Error).message}`);
    }
    assertLivemode(session.livemode, `checkout session ${session.id}`);

    const customer =
      typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
    /* **Both have to match**, which is why the refusal is an `||`: either field
       on its own would be enough for somebody who can influence the other. */
    if (session.client_reference_id !== ownerId || customer !== account.stripeCustomerId) {
      throw notYours(ownerId, sessionId, "it names a different owner or customer");
    }

    const result = await (deps.sync ?? syncSubscriptionFromStripe)(customer);
    if (result.kind === "unmapped") {
      /* The mapping was read a moment ago, in this same call, so this means it
         was deleted underneath us. Nothing the reader can act on. */
      logger.error({ ownerId, customerId: customer }, "the customer mapping vanished mid-confirmation");
      throw httpError(503, BILLING_NOT_AVAILABLE.message);
    }
    return { status: result.status };
  });
}

/**
 * The one answer for every way a session is not this reader's.
 *
 * **The same 404, with the same words, every time** — so the status and the body
 * cannot be used to tell "that session does not exist" from "that session is
 * somebody else's", which would make this a way of asking whether a given person
 * subscribed. The reason is logged, where only we read it.
 *
 * **Status and body, not timing**, and the difference is worth stating: a session
 * that does not exist comes back from Stripe's error path while another owner's
 * real one goes through retrieval and two comparisons, so the two take different
 * lengths of time. Reaching either still needs a `cs_…` id that the caller does
 * not have, so this is not a practical way to learn anything — but the claim is
 * about the response, not about the clock. GPT Sol, 2026-09-03.
 */
function notYours(ownerId: OwnerId, sessionId: string, why: string): Error {
  logger.warn({ ownerId, sessionId, why }, "refused a checkout confirmation that is not this reader's");
  return httpError(404, "No such checkout session");
}
