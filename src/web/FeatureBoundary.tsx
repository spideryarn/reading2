/**
 * **One mode may break without taking the article with it.**
 *
 * `main.tsx` wraps the whole app in the single `AppBoundary`, whose fallback
 * *replaces its children* — so until 2026-09-05 a throw inside one panel's
 * render took the prose, the spine, the dock and every route with it, and left
 * the reader three sentences of apology on an empty page. Nothing was known to
 * throw there; the problem was the blast radius. This is the smaller boundary:
 * the failed mode is replaced by a band-shaped fallback, and everything else on
 * the page goes on working.
 *
 * ## Why it is at the composition point rather than inside the panel
 *
 * A boundary cannot catch a throw from the component it lives in, so it cannot
 * be inside the controller. And it must not be around the *panel* alone: the
 * mode's own computation — Ideas' resolution memos and its layout effect, which
 * is where a throw is actually likely — runs in the **controller**, one level
 * up. A boundary around `IdeasPanel` would contain the least likely half. So
 * this wraps `<IdeasBand>` / `<VisitorIdeasBand>` where `Reader` composes them,
 * which is the one place that encloses both.
 *
 * ## The four things that reset it, and nothing else
 *
 *  - **`resetKey`** — `` `${slug}|${owner ? "owner" : "visitor"}` ``, supplied
 *    by the caller. Two honest limits on it: `owner`/`visitor` is an access
 *    *class*, not an access identity, and a feature with a genuine sub-mode
 *    must put **that sub-mode's own identity** in the key — Remember's
 *    `?remember=`, Diagram's picture chips. Not the top-level `mode`, which a
 *    sub-mode does not change; the key carried it until Sol's F18 pointed out
 *    that it is dead for a boundary mounted only inside one mode, and that
 *    copying it would document the wrong extension point. Owner A → owner B on
 *    the same slug is safe because `ArticlePage` remounts `Reader` when the
 *    reader changes, so the boundary is destroyed structurally rather than
 *    reset.
 *  - **the retry button**, which simply clears `broken`. That is enough on its
 *    own: the broken render already replaced and unmounted the feature, so
 *    there is nothing left to reuse and clearing the flag necessarily mounts a
 *    fresh one. A generation counter keyed onto the child used to sit here and
 *    reset nothing further — Sol 2026-09-05, F14.
 *  - **a changed non-null press identity**, once. `Dock` arms a token on every
 *    press including a press on the mode you are already in, so without this a
 *    reader who pressed Ideas at the fallback would arm a token that nothing
 *    rendered could claim and nothing would retire — parked behind the
 *    fallback, and spendable by whichever mount came next. The last nonce
 *    reset for is recorded **whether or not the boundary is broken**, so a
 *    press made while healthy cannot spuriously reset it after a later
 *    failure; and a `null` press resets nothing, which is what stops the
 *    retirement below from immediately un-breaking the boundary.
 *  - **unmounting**, structurally.
 *
 * Scrolling, typing and `?at=` edits appear in none of them.
 *
 * ## The words are here rather than in `src/messages.ts`
 *
 * The same rule `AppBoundary`'s `[render]` follows: `src/messages.ts` is for
 * **failures a model call can return**, and a component that threw while being
 * drawn is not one. What this takes from docs/project/copy.md is the part about
 * the reader — a bracketed code, last, so somebody can quote seven characters
 * instead of paraphrasing a sentence, and prose that says what happened, whose
 * fault it is and what to do next. And, as in `AppBoundary`, no `error.message`
 * and no article prose: an error's text can be a provider's body, a model's
 * output or the piece itself, and this component cannot know which.
 *
 * docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.
 */
import { Component, type ErrorInfo, type ReactNode, useSyncExternalStore } from "react";

import {
  activationIdentity,
  pendingActivation,
  retireActivation,
  subscribeActivations,
  type ActivationIdentity,
  type AutoRunTarget,
} from "./activation.js";
import { nameOfThrown, recordLog } from "./log-buffer.js";
import { captureClientFailure } from "./monitoring.js";

interface BoundaryProps {
  /** What the reader calls the thing that broke — "Ideas", not "IdeasBand". */
  name: string;
  slug: string;
  /** What a press on this mode's dock button arms, or `null` if nothing does. */
  target: AutoRunTarget | null;
  /** The press pending at the seam, read once per render by the wrapper. */
  press: ActivationIdentity | null;
  resetKey: string;
  /** Put the reader back on the prose. `Reader`'s own `setMode("plain")`. */
  onPlain(): void;
  children: ReactNode;
}

/**
 * **Reads the press, then renders the boundary.**
 *
 * The subscription lives here rather than in `Reader` so that it costs nothing
 * in the twelve other modes: this component only exists where a boundary does.
 *
 * `pendingActivation` is the snapshot because it returns a **primitive** — a
 * snapshot handing back a fresh object every call never compares equal and
 * `useSyncExternalStore` would loop. The full identity is then filled in with a
 * plain read, keyed on the nonce just observed (`activationIdentity`), so a
 * token that changed in between comes back `null` rather than as a mixture of
 * two presses.
 *
 * Reading the store during render is a read. The only write is
 * `retireActivation` in `componentDidCatch`, which is commit phase.
 */
export function FeatureBoundary({
  name,
  slug,
  target,
  resetKey,
  onPlain,
  children,
}: {
  name: string;
  slug: string;
  target: AutoRunTarget | null;
  resetKey: string;
  onPlain(): void;
  children: ReactNode;
}) {
  const read = () => (target === null ? null : pendingActivation(slug, target));
  const nonce = useSyncExternalStore(subscribeActivations, read, read);
  const press = target === null || nonce === null ? null : activationIdentity(slug, target, nonce);
  return (
    <FeatureErrorBoundary
      name={name}
      slug={slug}
      target={target}
      press={press}
      resetKey={resetKey}
      onPlain={onPlain}
    >
      {children}
    </FeatureErrorBoundary>
  );
}

interface BoundaryState {
  broken: boolean;
  /** The `resetKey` the rest of this state is about. */
  keySeen: string;
  /**
   * The last non-null press nonce this boundary has taken account of.
   *
   * Recorded on the *healthy* render that first saw it as well as on a reset,
   * because the alternative — recording it only while broken — would let a
   * press made before a failure reset the boundary immediately after one.
   */
  pressSeen: number | null;
}

class FeatureErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = {
    broken: false,
    keySeen: this.props.resetKey,
    pressSeen: this.props.press?.nonce ?? null,
  };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { broken: true };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    const nonce = props.press?.nonce ?? null;
    /* A different feature, a different reader class, or a different sub-mode
       for a feature that has one: this boundary's state was about something
       else and none of it carries over. */
    if (props.resetKey !== state.keySeen) {
      return { keySeen: props.resetKey, broken: false, pressSeen: nonce };
    }
    /* A fresh Dock press. Clearing `broken` lets the controller mount and claim
       it; if that render fails too, `componentDidCatch` retires the same
       identity and we are back here with nothing pending. */
    if (nonce !== null && nonce !== state.pressSeen) {
      return { pressSeen: nonce, broken: false };
    }
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* `componentStack` is deliberately not sent, for the reason `AppBoundary`
       gives: it is a list of component display names, which is safe, but it
       arrives as one free-text blob and this is not the place to start making
       exceptions to "no free text leaves the machine". The stack in the error
       already names the file and the line. */
    void info;

    /* **Retirement goes first, before any diagnostic touches the error.** The
       thing this whole file exists for is that the reader keeps the article and
       the press cannot be spent later; reporting it is a nicety on top. A
       diagnostic must never be able to swallow the containment — and one did:
       `error` is whatever the component threw, so `throw null` used to make
       `error.name` raise a `TypeError` out of `componentDidCatch` itself, which
       skipped the retirement below and left `AppBoundary` to replace the whole
       reader. Sol, 2026-09-05, F10.

       **The press the caught render was holding**, taken from props rather
       than looked up now: by the time this runs a *newer* press may have
       arrived, and retiring that one is precisely what must not happen.

       Said exactly, because the obvious phrasing is wrong. React answers a
       throw in a concurrent render by re-rendering the whole root
       synchronously and letting it throw again, so the render that is finally
       *caught* need not be the first one that threw, and `this.props` here is
       the caught one's — not necessarily the first attempt's. What that buys
       is still the whole of the guarantee, because the gap it leaves is
       unreachable: a press is armed by a real `onClick`, and a click cannot
       interleave with React's synchronous recovery pass. A press that arrives
       after the caught render began survives, and that is what
       tests/a-broken-mode-leaves-the-article-readable.test.tsx § the boundary
       will not retire a token newer than the one its render was holding pins.
       src/web/activation.ts § retireActivation.

       **And it is wrapped, because it is now the one thing here that can
       throw.** Same class of bug as F10: a handler that can itself throw is not
       a handler — it would skip the report below and escape into `AppBoundary`,
       which would then replace the article, which is the failure this file
       exists to prevent. `retireActivation` deletes the token and *then*
       notifies, and `emit()` calls subscriber callbacks with no containment of
       its own, so the money is safe either way and this is defensive. Sol,
       2026-09-06, F17. */
    const { slug, target, press } = this.props;
    try {
      if (target !== null && press !== null) retireActivation(slug, target, press);
    } catch (retirementError) {
      captureClientFailure(retirementError, {
        boundary: "feature",
        feature: this.props.name,
        phase: "retire-activation",
      });
    }

    captureClientFailure(error, { boundary: "feature", feature: this.props.name });
    /* And into the ring buffer beside the requests that led here — the run-up,
       which is the half a reader filing a report can give us and a stack trace
       cannot. The **name only**: `error.message` is not sent for the same
       reason it is not rendered. src/web/log-buffer.ts § ClientErrorLogEntry.

       Not `error.name`: the parameter is typed `Error` and the runtime value
       need not be one, so the read is `nameOfThrown`'s job and not this file's
       — src/web/log-buffer.ts § nameOfThrown, which is where F10 above now
       lives. */
    recordLog({ kind: "client-error", source: "boundary", name: nameOfThrown(error) });
  }

  private retry = (): void => {
    /* No `armActivation`: a retry is not a fresh intent to spend, and the token
       this mode might have spent has already been retired. And no remount key
       either — by the time this button exists the feature has already been
       unmounted, so clearing the flag is what mounts a fresh one. */
    this.setState({ broken: false });
  };

  override render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    const { name } = this.props;
    return (
      /* Shaped like the band it stands in for — the same `.mode-band` shell,
         the same width, the same place — so a failure does not move the rest of
         the page. Copied from `VisitorBand` in src/web/PublicChrome.tsx, and
         deliberately with no new CSS of its own. */
      <aside className="mode-band" aria-label={`${name} is not working`}>
        <div
          role="alert"
          className="tw:flex tw:flex-1 tw:flex-col tw:justify-center tw:gap-3 tw:px-4 tw:py-6 tw:text-sm tw:text-ink-faint"
        >
          <p className="tw:m-0 tw:text-ink">
            {name} stopped working while it was being drawn. That’s a fault at our end, not
            anything you did, and the article itself is fine. [mode-render]
          </p>
          <p className="tw:m-0 tw:flex tw:gap-4">
            <button
              type="button"
              onClick={this.retry}
              className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:text-highlight tw:underline"
            >
              Try {name} again
            </button>
            <button
              type="button"
              onClick={this.props.onPlain}
              className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-sm tw:font-medium tw:text-highlight tw:underline"
            >
              Back to the article
            </button>
          </p>
        </div>
      </aside>
    );
  }
}
