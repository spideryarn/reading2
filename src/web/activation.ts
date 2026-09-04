/**
 * **The reader just pressed this.** One fact, recorded by the two controls that
 * are in a position to know it, and read by the panel that is about to decide
 * whether to spend a model call.
 *
 * Five surfaces start a paid pipeline step on their own when the reader opens
 * them with nothing there yet — Glossary, Ideas, Quotes, Timeline, and the
 * Sketch picture inside Diagram. Greg's rule is
 * *"if the user **clicks** a mode that hasn't been run yet, automatically run
 * it"*, and the word that carries the money is **clicks**.
 *
 * ## Why a mount is not a click
 *
 * The first version of this feature fired from `status === "none"` after mount,
 * on the reasoning that with the arrow keys gone from the radiogroups
 * (docs/plans/260831ai-…, stage 0) "selection is always an explicit gesture".
 * That is false, and GPT Sol found it. A panel mounts with nobody having
 * pressed anything when:
 *
 *  - a `?mode=ideas` link is pasted, bookmarked or shared;
 *  - Back or Forward walks through mode entries — `?mode=` is `history: "push"`;
 *  - the metadata or tweets page links in through `withMode`;
 *  - a history entry predates the feature entirely.
 *
 * So the press is made into data rather than inferred from the state that
 * follows it. Everything else shows the empty state and its button, and spends
 * nothing.
 *
 * ## Why a boolean will not do
 *
 * The token is `{nonce, sessionEpoch, slug, target, owner}`, and every field is
 * load bearing:
 *
 *  - **`nonce`** so that pressing the mode you are already in mints something
 *    new. Without it, a reader whose first press met a failed GET could never
 *    ask again without leaving the mode and coming back — the mode did not
 *    change, so no effect would re-run and nothing at all would happen.
 *  - **`sessionEpoch`** — `jobEngine.epoch()`, which moves whenever the tab's
 *    reader changes — so a press made by the previous reader cannot be spent by
 *    the next one.
 *  - **`slug`** so a press that navigates to a *different* article cannot arm a
 *    panel there.
 *  - **`target`** so that clicking Ideas and then Quotes within a second does
 *    not let the second overwrite and lose the first. They are separate
 *    entries; neither disturbs the other.
 *  - **`owner`** so that the press can only ever be spent by the mount that was
 *    on screen when it was made — § A press belongs to the band that was on
 *    screen, which is the whole of it.
 *
 * And consumption is **synchronous and atomic** — a `delete` that reports
 * whether it removed anything — because React `<StrictMode>` invokes every
 * effect twice, and two invocations reading a token and then clearing it would
 * both pass.
 *
 * ## A press belongs to the band that was on screen
 *
 * **`owner`** is the fifth field, and it is the one that makes the rule true
 * rather than nearly true. The first mount of that panel to see a token
 * **claims** it, and from then on no other mount can ever spend it: a later
 * arrival at the same band finds the token owned by a mount that is gone,
 * retires it, and spends nothing.
 *
 * This is a reversal. Until 2026-09-02 a token whose panel unmounted before its
 * GET settled was deliberately *kept*, so that the press would be honoured the
 * next time that band was on screen. GPT Sol showed what that buys: press
 * Ideas, press Quotes over it, and then reach Ideas again by **Back** — and the
 * Back step starts a paid job. *"The later Back step is still what causes the
 * paid request."* The three bounds the old note offered — one attempt per
 * `(slug, step)`, the session epoch, the tab's life — cap what it can cost and
 * none of them ties the spending to the navigation that authorised it, which is
 * the actual rule: **only a click auto-runs; Back and Forward spend nothing.**
 *
 * The cost, said out loud and chosen: a press whose GET is still in flight when
 * the reader navigates away is **dropped**, so Ideas → Quotes inside a second
 * runs only Quotes. That is a failure to spend, which is the safe direction of
 * the two; the design it replaces took the other one.
 *
 * **Ownership is claimed, not released**, and that is deliberate: React
 * `<StrictMode>` runs every effect's setup, then its cleanup, then its setup
 * again, so a cleanup that retired the token would retire it on mount and the
 * feature would never fire in development. Nothing here runs on teardown.
 * Retirement happens at the moment a *different* mount asks, which is the only
 * moment at which it matters.
 *
 * ## What else retires a token
 *
 * The panel consumes it as soon as its own GET **settles** with an answer:
 * `none` (run it) or `ready` (there is one already). A GET that **failed** is
 * not an answer, and keeps the press — src/web/useAutoRun.ts § A failed read is
 * not an answer. That used to be dangerous, because a kept token could fire
 * against whatever mounted next; `owner` is what makes it safe, since the only
 * mount that can spend it is the one still looking at the error.
 *
 * ## What this module is deliberately not
 *
 * It is not a queue of work and it is not permission to spend. It says only
 * *the reader pressed this control, once, just now*. Whether that costs
 * anything is the panel's own question, answered against its own GET, and
 * capped by `jobEngine.beginAutoAttempt` — one automatic attempt per
 * `(slug, step)` per tab session, so a failure cannot loop.
 *
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2b.
 */
import type { Mode } from "../modes.js";
import type { StepName } from "../types.js";
import { jobEngine } from "./jobEngine.js";

/**
 * The six surfaces a press can start.
 *
 * Spelt as `StepName`s because that is what they are — the step each panel's
 * job runs — which is also what `beginAutoAttempt` is keyed on. Naming them
 * twice, once for the token and once for the guard, is how the two would come
 * to disagree.
 *
 * **Two of them are chips inside Diagram rather than modes**, and they are the
 * two that spend the most: `sketch` and `illustrated`. See `MODE_TARGET` below
 * for why the mode itself arms nothing.
 */
export type AutoRunTarget = Extract<
  StepName,
  "glossary" | "ideas" | "quotes" | "timeline" | "sketch" | "illustrated"
>;

/**
 * Which mode's button arms which target, and the four that do.
 *
 * **`diagram` is not here**, and that is right — and it matters more since
 * 2026-09-04, when Diagram came out from behind the experimental-features
 * switch and its default picture became the Sketch. Opening Diagram still costs
 * nothing: with no sketch drawn it lands on an empty state that says the price
 * and the wait and draws nothing (SketchView.tsx). Adding `diagram: "sketch"`
 * to this table would turn every press of a bar button that is now in front of
 * every reader into a ~$0.20, two-minute job. The Sketch chip inside the mode
 * arms `sketch` itself, because it is the chip that is the gesture — and the
 * Illustrated chip beside it arms `illustrated` for the same reason and a
 * dearer one: $0.27–$0.40 a press.
 *
 * Everything else in `MODES` is either free (Plain, Hierarchy, Outline,
 * Summary — they read the tree that is already there) or stores nothing at all
 * (Search, Chat, Referee, Remember).
 */
const MODE_TARGET: Partial<Record<Mode, AutoRunTarget>> = {
  glossary: "glossary",
  ideas: "ideas",
  quotes: "quotes",
  timeline: "timeline",
};

/**
 * **One mount of one panel.** Compared by reference and never read, so nothing
 * about the panel leaks into this module and nothing here can be forged by a
 * value that happens to be equal.
 */
export type ActivationOwner = symbol;

interface Activation {
  /** Distinct per press, so pressing the same button twice is two presses. */
  nonce: number;
  /** `jobEngine.epoch()` when it was minted. A different reader cannot spend it. */
  sessionEpoch: number;
  slug: string;
  target: AutoRunTarget;
  /**
   * The mount that may spend it, claimed by the first one to look, and `null`
   * only in the gap between the click and that panel's first effect — which is
   * one commit, because the click changes the mode and the panel mounts with
   * it. See § A press belongs to the band that was on screen.
   */
  owner: ActivationOwner | null;
}

/**
 * One pending press per `(slug, target)`.
 *
 * A `Map` rather than a single slot: see § Why a boolean will not do. Two rapid
 * presses on different modes are two intents, and the reader made both.
 */
const pending = new Map<string, Activation>();
const subscribers = new Set<() => void>();
let nonces = 0;

const keyOf = (slug: string, target: AutoRunTarget) => `${slug}\u0000${target}`;

const emit = () => {
  for (const fn of [...subscribers]) fn();
};

/**
 * **The reader pressed the control for this target.** Called from a real
 * `onClick`, and from nowhere else.
 *
 * Not from `setMode` or any other query-state setter: that is what Back and
 * Forward move, and history must never manufacture an activation.
 */
export function armActivation(slug: string, target: AutoRunTarget): void {
  nonces += 1;
  pending.set(keyOf(slug, target), {
    nonce: nonces,
    sessionEpoch: jobEngine.epoch(),
    slug,
    target,
    owner: null,
  });
  emit();
}

/**
 * The same, for a press on one of the bottom bar's mode buttons. A mode with no
 * paid artefact behind it arms nothing, silently — which is most of them.
 */
export function armActivationForMode(slug: string, mode: Mode): void {
  const target = MODE_TARGET[mode];
  if (target) armActivation(slug, target);
}

/**
 * The pending nonce for this panel, or null. `useSyncExternalStore`'s snapshot.
 *
 * A number rather than the token, so the snapshot is a primitive React can
 * compare without a memo, and so nothing downstream can hold a reference to a
 * token it has not consumed.
 */
export function pendingActivation(slug: string, target: AutoRunTarget): number | null {
  return pending.get(keyOf(slug, target))?.nonce ?? null;
}

/**
 * **This mount, and no other, may spend this press.** Called before anything
 * else, on every run of the panel's auto-run effect.
 *
 * Three answers in one boolean, and the false ones are different:
 *
 *  - **no such token** — nothing pressed, or it has already been spent;
 *  - **owned by another mount** — the press was made while a different mount of
 *    this panel was on screen and that mount is gone. The token is **retired
 *    here**, which is the whole of the fix for the Back-spends-a-press bug;
 *  - **ours** — claimed on the first call and idempotent afterwards, which is
 *    what makes `<StrictMode>`'s setup / cleanup / setup harmless.
 */
export function claimActivation(
  slug: string,
  target: AutoRunTarget,
  nonce: number,
  owner: ActivationOwner,
): boolean {
  const key = keyOf(slug, target);
  const held = pending.get(key);
  if (!held || held.nonce !== nonce) return false;
  if (held.owner === null) {
    held.owner = owner;
    return true;
  }
  if (held.owner === owner) return true;
  /* Somebody else's press, and its panel is not this one. Retire it rather than
     leave it lying about for the next mount to ask the same question of. */
  pending.delete(key);
  emit();
  return false;
}

/**
 * **Spend it, once.** True exactly once per press, to exactly one caller.
 *
 * Synchronous, and the delete happens before this function returns, which is
 * what makes `<StrictMode>`'s double-invoked effect harmless: the second
 * invocation finds nothing.
 *
 * `nonce` is checked so that a press which arrived *after* this render — the
 * reader pressing again while the GET was still in flight — is not spent by an
 * effect that was about to run for the older one. `owner` is checked for the
 * same reason `claimActivation` checks it, and belt-and-braces: the only caller
 * claims first, and a second caller that did not would otherwise be spending a
 * press made on a screen it was never on.
 */
export function consumeActivation(
  slug: string,
  target: AutoRunTarget,
  nonce: number,
  owner: ActivationOwner,
): boolean {
  const key = keyOf(slug, target);
  const held = pending.get(key);
  if (!held || held.nonce !== nonce) return false;
  if (held.owner !== null && held.owner !== owner) return false;
  pending.delete(key);
  /* **The session it was minted in, checked at the last moment rather than at
     mint time.** The reader can sign out between the press and the GET
     settling, and the engine's generation is the one thing that knows. The
     token is dropped either way — it is spent or it is stale, and neither
     leaves it lying about. */
  const live = held.sessionEpoch === jobEngine.epoch();
  emit();
  return live;
}

export function subscribeActivations(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/** Back to a fresh store. For tests, and for nothing else. */
export function resetActivations(): void {
  pending.clear();
  nonces = 0;
  emit();
}
