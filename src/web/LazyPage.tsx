/**
 * A page that is not in the bundle yet: the wait, the failure, and the way out.
 *
 * `/admin` and `/design` are the two routes a reader never visits, so their
 * code is fetched when somebody asks for the address rather than before
 * everybody's first article (docs/plans/260905i-lazy-load-admin-and-design-routes.md).
 * That buys a small number of bytes and one thing worth more: a boundary, so
 * that the next thing added to the administrator's table — a chart library, a
 * CSV writer — cannot arrive in every reader's startup unnoticed.
 * [`tests/eager-client-graph.test.ts`](../../tests/eager-client-graph.test.ts)
 * is what holds it.
 *
 * ## Why a loader and a route key, rather than children
 *
 * Two separate reasons, and each one is a bug that was going to happen.
 *
 * **A rejected `React.lazy` never retries.** React stores the rejection on the
 * lazy component's payload and re-throws that same result forever
 * (`react/cjs/react.development.js` § `lazyInitializer`). So a *Try again* that
 * merely remounts the same lazy component type is permanently broken — it looks
 * like a button, it changes nothing, and no test that only checks the button
 * exists would ever say so. Each attempt therefore constructs a **fresh** lazy
 * type, which is what `attempt` is doing in the memo below. GPT Sol's F2 on the
 * plan, 2026-09-05.
 *
 * **And a failure must not follow the reader to the next route.** `App`'s
 * branches each `return` a tree, and `<LazyPage>` sits in the same position in
 * both the `design` branch and the `admin` one — so without a key React reuses
 * this instance across the two, and `/design`'s broken boundary would still be
 * broken when the reader typed `/admin`. Worse, the *loaded* component could
 * persist: same position, same type, different `load` prop. The route key
 * removes the instance rather than trying to reconcile it, which is the same
 * argument `App.tsx` makes for keying `Library` by reader id.
 *
 * ## The words, and the reporting
 *
 * Per [copy.md](../../docs/project/copy.md): what happened without assuming the
 * reader knows what a chunk is, whose fault it is, what to do next, and a
 * bracketed `[chunk]` last so a report can quote four characters. **Reloading
 * usually fixes it** is in there because it is true and load-bearing rather
 * than filler — the commonest real cause is a deploy replacing the hashed
 * assets under a tab that was already open, and asking for the same dead URL
 * again cannot fix that.
 *
 * `error.message` is never rendered and never sent, the same rule and the same
 * reason as [`AppBoundary.tsx`](AppBoundary.tsx). And the boundary reports,
 * because it is now the *nearest* boundary: without these two calls a chunk
 * failure would show the reader `[chunk]` and show Sentry nothing at all, which
 * is Sol's F7.
 */
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  lazy,
  useMemo,
  useState,
} from "react";
import { LoaderCircle } from "lucide-react";

import { Link } from "./Link.js";
import { nameOfThrown, recordLog } from "./log-buffer.js";
import { captureClientFailure } from "./monitoring.js";
import { LIBRARY_HREF } from "./router.js";

/**
 * What `React.lazy` is handed.
 *
 * `{ default: … }` rather than the module, because neither `AdminPage.tsx` nor
 * `DesignPage.tsx` has a default export and React reads `module.default` — so
 * the loaders in App.tsx pick the named export out themselves. A bare
 * `lazy(() => import("./AdminPage.js"))` would send every `/admin` visit
 * straight to the surface below (Sol F1).
 */
export type PageLoader = () => Promise<{ default: ComponentType }>;

/** The wait. Quiet on purpose: nobody asked for a progress bar. */
function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="tw:flex tw:justify-center tw:py-16 tw:text-muted-foreground"
    >
      <LoaderCircle className="cmt-spinner" size={13} />
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  onRetry: () => void;
}

class ChunkBoundary extends Component<BoundaryProps, { broken: boolean }> {
  override state = { broken: false };

  /** So one failure is reported once, however many times React re-renders it. */
  private reported = false;

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* `componentStack` deliberately not sent — one free-text blob, and this is
       not the file that starts making exceptions to "no free text leaves the
       machine". AppBoundary.tsx makes the argument in full. */
    void info;
    if (this.reported) return;
    this.reported = true;
    captureClientFailure(error, { boundary: "lazy-route" });
    /* `source: "boundary"` because that is what this is — a React boundary that
       tore a subtree down — and the vocabulary in log-buffer.ts is closed. The
       Sentry tag above is where "which boundary" is recorded. The name only:
       `error.message` is not sent, for the reason at ClientErrorLogEntry. And
       not `error.name`: the parameter is typed `Error` and the runtime value
       need not be one, so the read is `nameOfThrown`'s job and not this file's
       — src/web/log-buffer.ts § nameOfThrown. */
    recordLog({ kind: "client-error", source: "boundary", name: nameOfThrown(error) });
  }

  override render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    return (
      <div
        role="alert"
        className="tw:mx-auto tw:max-w-lg tw:px-6 tw:py-16 tw:text-center tw:text-sm tw:leading-relaxed"
      >
        <p>
          Part of Spideryarn didn’t arrive, so this page can’t be drawn. That’s a fault
          here, not anything you did — most often this app was updated while your tab sat
          open, and the piece this page needed had moved. Reloading the page usually fixes
          it. [chunk]
        </p>
        <p className="tw:mt-4 tw:opacity-70">
          <button
            type="button"
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-highlight tw:underline"
            onClick={this.props.onRetry}
          >
            Try again
          </button>{" "}
          asks for it once more without reloading. Or go back to{" "}
          <Link href={LIBRARY_HREF} className="tw:text-highlight tw:underline">
            your shelf
          </Link>
          .
        </p>
      </div>
    );
  }
}

/**
 * One route's worth of code, fetched when the reader arrives at it.
 *
 * `load` must be **module-scope**: it is a `useMemo` dependency, so an inline
 * arrow would be a new function on every render and would build a new lazy type
 * — and therefore start a new fetch — every time anything above re-rendered.
 */
export function LazyPage({ load, routeKey }: { load: PageLoader; routeKey: string }) {
  const [attempt, setAttempt] = useState(0);
  const Page = useMemo(() => {
    /* `attempt` and `routeKey` are both dependencies for their own sake rather
       than for a value: building a new lazy type is the only way to get one
       that has not already cached a rejection, and these are the two things
       that mean "start again". See the header.

       **`routeKey` is not redundant beside `load`.** All four routes here
       happen to pass distinct loader functions, so today `load` alone would
       rebuild — but nothing in this component's signature says they must, and
       GPT Sol demonstrated the hole: one loader shared by two routes, rejected
       under the first, keeps re-throwing that same rejection under the second,
       because the boundary remounts while the lazy payload does not. Code
       review of this file, 2026-09-05, F9. */
    void attempt;
    void routeKey;
    return lazy(load);
  }, [load, routeKey, attempt]);
  return (
    <ChunkBoundary key={`${routeKey}:${attempt}`} onRetry={() => setAttempt((n) => n + 1)}>
      <Suspense fallback={<Loading />}>
        <Page />
      </Suspense>
    </ChunkBoundary>
  );
}
