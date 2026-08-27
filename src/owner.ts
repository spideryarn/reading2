/**
 * Who owns a row.
 *
 * Every table that a **person** owns carries `owner_id uuid not null references
 * auth.users(id)`, decided before there was any auth to populate it —
 * docs/project/database.md. Not every table: `article_revisions`,
 * `revision_blocks`, `block_identities`, `revision_step_runs`, `chat_messages`
 * and `queue_state` do not — each belongs to a row that does (an article, a
 * revision, a thread), and carrying the owner twice is a second copy to disagree
 * with the first.
 *
 * **`ai_calls` was on that list and came off it on 2026-08-28**, which is worth
 * saying rather than quietly editing. Good rule, wrong table, for two reasons:
 * its `article_id` is `on delete set null`, so deleting an article would strip a
 * billing row of its person permanently and without erroring; and not every
 * call has an article at all — a library search, or an ordinary chat with
 * nothing open. See `aiCalls` in src/db/schema.ts.
 *
 * This file is where the value comes from, and since 2026-08-27 there are two
 * answers rather than one: **inside an API request it is whoever signed in**,
 * and outside one — the CLI, the pipeline, a test — it is the environment.
 *
 * ## Why an AsyncLocalStorage rather than an argument
 *
 * Eleven call sites read this, spread across seven store modules, and every one
 * of them is four or five frames below a route handler. Threading an owner
 * argument down to them means an extra parameter on roughly forty functions
 * including the ones the CLI shares — and the CLI has no request, so every one
 * of those parameters would have to be optional, which is exactly the shape
 * that lets a caller forget it and get the wrong person's data.
 *
 * `AsyncLocalStorage` is Node's own answer to request-scoped state, it survives
 * every `await` in a route, and it costs the store modules nothing: they go on
 * calling `currentOwnerId()`.
 *
 * **`run()` with a fresh box per request, never `enterWith`.** `enterWith`
 * mutates the *calling* context, and with HTTP keep-alive several requests on
 * one socket can share one — so request two could read request one's owner in
 * the window before its own gate ran. That is the worst bug this file could
 * have (one reader served another's shelf) and it would be invisible in
 * testing, where connections are not reused. `run()` cannot do it: the box does
 * not exist outside the callback. src/routes.ts § `handleApi`.
 *
 * ## The box is mutable, and empty until the gate fills it
 *
 * `handleApi` opens the scope *before* it authenticates, because the gate's own
 * refusal has to be logged inside the same `try`. So the box starts empty, and
 * `currentOwnerId()` **throws** while it is — it does not quietly fall back to
 * the environment. A store read that happens before the gate is a bug, and the
 * fallback would answer it with Greg's own owner id: the request would succeed,
 * return real data, and look exactly like it worked.
 * docs/reusable/silent-success.md.
 *
 * **It is not the only file that changes when a second person arrives**, and an
 * earlier version of this comment said it was. Nothing in src/store/pg.ts
 * filtered on `owner_id` — with one owner there was nothing to filter — so a
 * second user saw the first one's library. GPT Sol raised it in review,
 * 2026-08-26, and again against the built auth code on 2026-08-27:
 *
 * > any person who can create a Supabase account can see and change the same
 * > library, profile, chats, searches and reader state, and can run paid model
 * > operations
 *
 * Those queries are now written. Every path from a slug to an article carries
 * `and(eq(articles.ownerId, currentOwnerId()))`, which is the whole of the
 * isolation: the other six owned tables are reached through an `articleId` that
 * came from one of them. `articles.slug` stays globally unique, deliberately,
 * because it is the URL contract — so two people ingesting the same URL is
 * still an open question rather than a thing that works.
 *
 * **`not null` on purpose**: a row with no owner is not a state this system
 * has. So there is no "anonymous" fallback here and there should never be one —
 * an unset owner in production must fail loudly at the boundary rather than
 * write a row nobody can be shown to have made.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { OwnerId } from "./types.js";

/**
 * A `auth.users(id)`, re-exported.
 *
 * **Defined in src/types.ts**, since 2026-08-27, and re-exported here so that
 * every file already importing it from `owner.ts` goes on working — this is
 * where it reads as belonging, and it is the name people reach for.
 *
 * It had to move because `Job` gained an `ownerId` and `src/types.ts` is shared
 * with the browser, while this file imports `node:async_hooks`. A pure type has
 * no business dragging a Node built-in towards the client bundle, and
 * `tests/client-imports.test.ts` says so by path rather than by whether the
 * import happens to be erasable.
 */
export type { OwnerId } from "./types.js";

/**
 * The fixed local development owner, created by `npm run db:seed-owner`.
 *
 * A valid v4-shaped uuid that no generator will mint, so it cannot collide with
 * a real user. Fixed rather than random so that it survives `npm run db:reset`
 * and is identical on a fresh clone — see scripts/db-seed-owner.ts for why the
 * random alternative rots.
 */
export const DEV_OWNER_ID = "00000000-0000-4000-8000-000000000001" as OwnerId;

/**
 * Deliberately not a real address. Nothing logs in locally, so this value is
 * never used for anything but telling one seeded row from another, and a
 * personal email in committed source earns nothing. Override with
 * `SPIDERYARN_OWNER_EMAIL` if you want the local Studio to show yours.
 */
export const DEV_OWNER_EMAIL = process.env.SPIDERYARN_OWNER_EMAIL ?? "dev@spideryarn.local";

/** Narrow a string to an `OwnerId`, checking it is uuid-shaped. */
function asOwnerId(value: string): OwnerId {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`not a uuid: ${value}`);
  }
  return value as OwnerId;
}

/**
 * The request currently being served, if there is one.
 *
 * A mutable box rather than the id itself, because `handleApi` opens the scope
 * before it knows who is calling — see the header. One box per `run()`, so two
 * requests can never share it.
 */
interface OwnerScope {
  owner: OwnerId | null;
}

const scope = new AsyncLocalStorage<OwnerScope>();

/**
 * Serve one request with a fresh, empty owner box.
 *
 * Wrapped around the whole of `handleApi` rather than started after the gate,
 * so that a store read reaching `currentOwnerId()` before anyone has been
 * authenticated finds an *empty* box and throws — rather than finding no box at
 * all and falling through to the environment, which is the case this whole
 * mechanism exists to make impossible.
 */
export function runInRequest<T>(fn: () => T): T {
  return scope.run({ owner: null }, fn);
}

/**
 * Say who this request is from. Called once, by the gate, and nowhere else.
 *
 * Throws outside a request rather than doing nothing, because "the owner did
 * not take" is the failure that would hand one reader another's shelf, and it
 * must not be a thing that can happen quietly.
 */
export function setRequestOwner(owner: OwnerId): void {
  const box = scope.getStore();
  if (!box) throw new Error("setRequestOwner outside a request scope. See src/owner.ts.");
  box.owner = owner;
}

/** Whether we are inside an API request at all. For tests and for `currentOwnerId`. */
export function inRequest(): boolean {
  return scope.getStore() !== undefined;
}

/**
 * The signed-in owner if we are serving a request, and `null` if we are not.
 *
 * **The difference between "filter this" and "do not filter this".** A route
 * handler must only ever see its own reader's jobs; the housekeeping sweep that
 * deletes finished ones has to see everybody's, or a job belonging to a real
 * user could never be tidied away by a process that is not that user.
 *
 * So the question is not "who is the owner" — `currentOwnerId()` answers that
 * and throws outside a request — but "is there a reader to answer to". Inside a
 * request there is; on a timer, in the CLI, in the pipeline, there is not.
 * src/jobs.ts is the one caller.
 */
export function requestOwner(): OwnerId | null {
  return scope.getStore()?.owner ?? null;
}

/**
 * Run something as a named owner, in a scope of its own.
 *
 * For **work that outlives the request that asked for it**. An
 * `AsyncLocalStorage` context is captured when an async resource is created,
 * and a p-queue task is a plain callback stored in an array — so the context it
 * runs in is whoever's continuation happened to drain the queue, not whoever
 * enqueued it. Measured, because it is not what you would guess: with
 * concurrency 1, Alice's job followed by Bob's gives
 *
 *     a-start: alice   a-end: alice
 *     b-start: alice   b-end: alice
 *
 * — Bob's whole task in Alice's context, because it is invoked from inside the
 * completion of Alice's. GPT Sol raised it against the built code, 2026-08-27;
 * the numbers above are from running it here.
 *
 * Nothing in the pipeline reads `currentOwnerId()` today, so that is a landmine
 * rather than a live bug. It becomes a live one the moment queued work reaches
 * the Postgres store, and by then it would write one reader's article under
 * another reader's name and report success. So the owner is captured on the job
 * and re-entered here, rather than inherited.
 */
export function runAsOwner<T>(owner: OwnerId, fn: () => T): T {
  return scope.run({ owner }, fn);
}

/**
 * The owner to stamp on rows written here, and to filter every read by.
 *
 * **Inside a request, the signed-in user — and the environment does not get a
 * vote.** That ordering is the load-bearing part. `SPIDERYARN_OWNER_ID` used to
 * win outright, and docs/project/deployment.md tells you to set it on Vercel;
 * had the env kept priority, deploying exactly as documented would have handed
 * every signed-in stranger Greg's own owner id, every query would have matched,
 * and the isolation added on 2026-08-27 would have been dead code that looked
 * like it was working. docs/reusable/silent-success.md.
 *
 * Outside a request — the CLI, the pipeline, `npm run db:import`, a test — the
 * environment is the only answer there is, and that is unchanged.
 */
export function currentOwnerId(): OwnerId {
  const box = scope.getStore();
  if (box) {
    if (box.owner) return box.owner;
    /* Inside a request with nobody in the box: a store read happened before the
       gate ran, or the gate was removed. Loud, because the alternative answer
       available here — the environment's owner — is a real person's data. */
    throw Object.assign(
      new Error(
        "A store read reached currentOwnerId() before the request was authenticated. " +
          "The gate in src/routes.ts fills the box; see src/owner.ts.",
      ),
      { status: 500 },
    );
  }

  return environmentOwnerId();
}

/**
 * The owner this *process* was configured with, whoever is currently asking.
 *
 * Almost always the wrong function — `currentOwnerId()` is the one you want,
 * and inside a request this deliberately ignores the reader. It exists for one
 * job: stamping records that were written before they carried an owner.
 *
 * The case is `src/jobs.ts`, whose `data/_jobs/` files predate the field. That
 * load is lazy, so it happens on whichever request first asks for the jobs
 * list — and `currentOwnerId()` there would hand every legacy job to whoever
 * happened to look at the page first. The right answer is fixed rather than
 * whoever is asking: at the time those files were written there was exactly one
 * owner, and it is this one.
 */
export function environmentOwnerId(): OwnerId {
  const fromEnv = process.env.SPIDERYARN_OWNER_ID;
  if (fromEnv) return asOwnerId(fromEnv);

  /**
   * **In production, an unconfigured owner is an error, not a default.**
   *
   * The first version of this function fell back to `DEV_OWNER_ID`
   * unconditionally — which contradicted the paragraph at the top of this file
   * saying an unset owner "must fail loudly at the boundary". It would have
   * failed, eventually, as an `auth.users` foreign key violation, because the
   * development user does not exist in the production project. That reads as a
   * database bug and sends you to the schema, which is the wrong place: the
   * actual fault is one missing environment variable, and it is three layers
   * away by the time anything complains.
   *
   * Caught by Fable in review, 2026-08-26.
   */
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error(
      "SPIDERYARN_OWNER_ID is not set, and there is no development owner in " +
        "production. Set it, or wire up the beta gate so the session user " +
        "supplies it. See src/owner.ts.",
    );
  }

  return DEV_OWNER_ID;
}
