/**
 * The last thing between a throw during render and a blank white page.
 *
 * **This app had no error boundary at all until 2026-08-27.** `grep` for
 * `componentDidCatch` across `src/web/` returned nothing, which means React's
 * own behaviour applied: an error thrown while rendering unmounts the whole
 * tree, leaving an empty `#root`, no message, and nothing in the tab but the
 * background colour. A reader cannot tell that apart from a page that never
 * loaded, and neither can anybody they report it to.
 *
 * ## Why it is hand-written rather than `Sentry.ErrorBoundary`
 *
 * `@sentry/react` ships one, and it would do the reporting half correctly. It
 * would also put the *reporting* library in charge of what the reader sees,
 * and reporting is optional here — there is no DSN on a laptop, in a test, or
 * on any deployment nobody has configured. The fallback must work in all of
 * those, so the fallback is ours and the report is a function call inside it.
 *
 * ## The words
 *
 * Per [copy.md](../../docs/project/copy.md): say what happened without assuming
 * the reader knows what a render is, say whose problem it is — **ours**, and
 * unusually this is a case where retrying genuinely cannot help, so it says so
 * — say what to do next, and carry a bracketed code that a test can pin instead
 * of the prose.
 *
 * Deliberately **not** shown: `error.message`. This is the same rule the rest
 * of the app keeps — an error's text can be a provider's error body, a model's
 * output or the article itself, and this component cannot know which. The
 * reader could not act on it anyway. See docs/plans/260826p-error-boundary.md.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { captureClientFailure } from "./monitoring.js";

interface Props {
  children: ReactNode;
}

interface State {
  broken: boolean;
}

export class AppBoundary extends Component<Props, State> {
  override state: State = { broken: false };

  static getDerivedStateFromError(): State {
    return { broken: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* `componentStack` is deliberately not sent. It is a list of component
       display names, which is safe, but it arrives as one free-text blob and
       this file is not the place to start making exceptions to "no free text
       leaves the machine". The stack trace in the error itself already names
       the file and line. */
    void info;
    captureClientFailure(error, { boundary: "app" });
  }

  override render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    return (
      <div
        role="alert"
        className="tw:mx-auto tw:max-w-lg tw:px-6 tw:py-16 tw:text-center tw:text-sm tw:leading-relaxed"
      >
        <p>
          Something in Spideryarn broke while drawing this page. That’s a fault here, not
          anything you did, and reloading will probably hit it again. [render]
        </p>
        <p className="tw:mt-4 tw:opacity-70">
          Going back to the shelf and opening the article again is the thing most likely to
          work.
        </p>
      </div>
    );
  }
}
