# Review: loading spinners and a retry button in Diagram mode

You are reviewing built code, not a plan. Be adversarial. Some findings are welcome to be
"this is fine"; say so plainly. Check each claim against the code quoted below.

## What was asked for

Greg, 2026-08-30, two messages:

> Make sure the diagrams in Diagram mode show loading spinners if they're generating

> And/or a button to trigger generation if needed

## What Diagram mode is

A band beside the article with four pictures behind a chip row (`src/web/DiagramPanel.tsx`):

- **Force** — a graph. Four of its five kinds of edge are arithmetic the browser already has, so
  it draws immediately. The fifth (dotted, "semantic") needs `POST /api/similar/:slug`, which
  costs an embedding call. The picture is never blocked on it; one line of 10.5px chrome beside
  the picture reports the state.
- **Drift** and **Trail** — scatter plots of one dot per paragraph. Both have *nothing* to draw
  until `POST /api/projection/:slug` answers. While they wait, `layoutDiagram` returns null and
  the panel renders `Waiting`, which already had a spinner.
- **Sketch** — a model-authored scene, `$0.20` and about two minutes, run as a pipeline step
  through the job queue. It is never drawn until a reader presses a button. Its own component,
  `src/web/SketchView.tsx`.

## What was found missing, and changed

1. **Force's strip was text-only while the call was in flight.** It said "Reading the article for
   related passages…" in the same faint grey as the sentence it shows when the answer lands.
2. **Neither fetch had a retry.** Both run once from an effect. A failed request left the reason
   on screen and no verb anywhere — the only way back was to leave the mode and re-enter it.
3. **Sketch said nothing about a redraw it did not start.** `useStepJob` reads the job queue
   rather than remembering the click, precisely so a run from the CLI / the shelf / another tab
   shows up. `SketchView`'s ready branch ignored `view.job` entirely, so a picture already on
   screen would change under the reader two minutes later with nothing having said it would.

## The code

### `src/web/useProjection.ts` (whole file)

```ts
/**
 * **Where every paragraph sits on the plane the embeddings describe**, fetched
 * when — and only when — a picture is drawn that uses it.
 *
 * `POST /api/projection/:slug` (src/projection.ts). The sibling of
 * [useSimilar.ts](./useSimilar.ts), and deliberately the same shape: same gate,
 * same "an answer belongs to one article" rule, same refusal to blank the
 * picture on a failure. Two hooks rather than one because the two answers are
 * wanted by different pictures at different moments, and a reader who never
 * presses Drift should not buy its arithmetic.
 *
 * ## Three rules, all of them about not lying to the reader
 *
 * **`enabled` is the whole gate.** This and `useSimilar` are the only fetches
 * in the reading view that spend money without a button saying so. Pressing a
 * diagram toggle is not a purchase decision, so the request happens on exactly
 * the two pictures that draw it and never on the third. The vectors are
 * shared with `useSimilar`'s answer on the server, so a reader who has already
 * opened Force pays only for the arithmetic.
 *
 * **It blocks the picture, and the picture says so.** Unlike Force — which is
 * four fifths drawn without any of this — Drift and Trail have *nothing* to
 * draw without it. Until 2026-08-30 they borrowed the Tree while they waited,
 * on the reasoning that a picture of something real with a line of explanation
 * beats a spinner over an empty box. The Tree has been cut, and the reasoning
 * had a hole in it anyway: a mode that answers a question you did not ask,
 * under small type explaining that it is not the picture you pressed, is a
 * worse failure than an honest wait. `layoutDiagram` now returns null and the
 * panel draws the spinner (DiagramPanel.tsx § Waiting).
 *
 * **A failure is not a blank.** If the request fails, the reason — the
 * server's own words, ending in a code the reader can quote — stands where the
 * picture would have been. Failing to nothing at all is the
 * [silent-success](../../docs/reusable/silent-success.md) shape.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectionPoint, ProjectionResponse, SkipCounts } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

type ProjectionStatus = "idle" | "loading" | "ready" | "error";

export interface UseProjection {
  status: ProjectionStatus;
  points: ProjectionPoint[];
  /** How many topics the model's grouping found room for. 0 until it answers. */
  k: number;
  /** What fraction of the article's variation each axis holds, 0–1. */
  variance: [number, number];
  /** How many paragraphs were embedded — fewer than the article has. */
  blocks: number;
  /** How many were not, by reason. The dots do not tile the article. */
  skipped: SkipCounts;
  model: string | null;
  error: string | null;
  /**
   * Ask again.
   *
   * The fetch runs once from an effect, so before this existed a reader whose
   * request failed — a quota, a dropped connection, a deploy mid-flight — had
   * the reason on screen and no verb anywhere: the only way back was to leave
   * the mode and come in again, which nothing said. Greg, 2026-08-30:
   * *"And/or a button to trigger generation if needed."*
   *
   * Stable, so a panel can hand it to a button without rerendering the picture.
   */
  retry(): void;
}

/** Nothing, shared — a new `[]` each render would relayout the picture every time. */
const NONE: ProjectionPoint[] = [];
const NO_SKIPS: SkipCounts = { nonProse: 0, tooShort: 0, capped: 0 };
const ZERO: [number, number] = [0, 0];

const NO_RETRY = () => {};

const IDLE: UseProjection = {
  status: "idle",
  points: NONE,
  k: 0,
  variance: ZERO,
  blocks: 0,
  skipped: NO_SKIPS,
  model: null,
  error: null,
  retry: NO_RETRY,
};

export function useProjection(slug: string, enabled: boolean): UseProjection {
  /* **The state holds the data, never the verb.** `retry` is added on the way
     out, so no `setState` here has to remember to carry it. */
  const [state, setState] = useState<Omit<UseProjection, "retry"> & { slug: string }>({
    ...IDLE,
    slug,
  });
  /* **A counter, not a boolean.** Two failures in a row are two presses, and a
     flag that was already true on the second one would set state to the value
     it already held and re-run nothing. */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /* **Whose answer this is.** These coordinates are about one article's
     paragraphs, so drawing the previous one's would be a picture confidently
     about the wrong text.

     **As the app is wired today this can never be false** — `App.tsx` keys the
     article components on the slug, so a slug change remounts this hook rather
     than handing it a new slug. The comment here used to claim the opposite.
     `useSimilar` carries the same guard and the same correction; read the
     longer version there for why both are kept. */
  const mine = state.slug === slug;

  /* `attempt` is in the dependency list and is read nowhere in the body, which
     is exactly what makes it work and exactly what the rule objects to: it is a
     token whose only job is to be different, so that pressing Try again re-runs
     an effect whose real inputs have not changed. Removing it, as the fix
     offers, would leave a button that sets state and fetches nothing. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above — `attempt` is the retry token, not a value
  useEffect(() => {
    if (!enabled) return;
    /* Not cleared when `enabled` goes false: stepping from Drift to Trail and
       back must not throw away an answer already paid for. The server caches
       too, so a second request would be cheap — but it would still be a round
       trip, and the dots would visibly vanish and return for no reason the
       reader could see. */
    const stop = new AbortController();
    setState((s) =>
      s.slug === slug && s.status === "ready" ? s : { ...IDLE, slug, status: "loading" },
    );
    void (async () => {
      try {
        /* **POST, because the first call spends money.** GET is meant to be
           safe, and a browser, a proxy or a prefetcher is entitled to repeat a
           GET without asking anybody — which for this route would be paying to
           embed the article again. src/routes.ts says the same from the other
           end. */
        const res = await apiFetch(`/api/projection/${encodeURIComponent(slug)}`, {
          method: "POST",
          signal: stop.signal,
        });
        const body = await readJson<ProjectionResponse>(res);
        if (stop.signal.aborted) return;
        setState({
          slug,
          status: "ready",
          points: body.points,
          k: body.k,
          variance: body.variance,
          blocks: body.blocks,
          skipped: body.skipped,
          model: body.model,
          error: null,
        });
      } catch (err) {
        // An abort is this component leaving, not a failure. Reporting it would
        // put an error in the strip every time the reader changed picture.
        if (stop.signal.aborted) return;
        setState({ ...IDLE, slug, status: "error", error: (err as Error).message });
      }
    })();
    return () => stop.abort();
  }, [slug, enabled, attempt]);

  /* `IDLE` rather than the stale state while an answer belongs to another
     article: stable empty values, so the layout memo downstream does not rerun
     on every render.

     Memoised because the spread is a new object every render otherwise, and the
     one thing downstream that takes the whole object — `Waiting` — would then
     rerender on every scroll. The fields it holds are the same references
     either way, which is what keeps the layout memos below from rerunning. */
  return useMemo(() => ({ ...(mine ? state : IDLE), retry }), [mine, state, retry]);
}

```

### `src/web/useSimilar.ts` (whole file)

```ts
/**
 * **The embedding model's view of the article**, fetched when — and only when —
 * a picture is drawn that uses it.
 *
 * Greg, 2026-08-27: *"when we generate the Force diagram, let's generate an
 * embedding for each block, and add dotted links between the most similar
 * handful of blocks, to see what that does to the shape of the Force diagram."*
 *
 * `POST /api/similar/:slug` (src/similar.ts), which embeds the blocks the first
 * time it is asked and serves the answer out of memory afterwards.
 *
 * ## Three rules, all of them about not lying to the reader
 *
 * **`enabled` is the whole gate.** This is the only fetch in the reading view
 * that spends money without a button labelled with what it costs. Pressing a
 * diagram toggle is not a purchase decision, so the request happens on exactly
 * one of the three pictures and never on the other two — and the moment `force`
 * is no longer the picture, nothing further is requested. Cheap, bounded and
 * cached, but the bound has to be somewhere and this is it.
 *
 * **It never blocks the picture.** Force draws immediately from the tree and
 * the words; the dotted lines are folded in on a later render. Nothing is drawn
 * *over* the diagram, because a spinner over something already four fifths
 * drawn tells the reader the wrong thing about what is missing. The wait lives
 * in the one line of chrome beside the picture instead — a spinner and
 * "Reading the article for related passages…", because a line that only changes
 * its words reads as a caption rather than as work in progress.
 *
 * **A failure is not a blank.** If the request fails the picture keeps its other
 * four kinds of line and the strip says so. Silently drawing three kinds where
 * four were promised is the [silent-success](../../docs/reusable/silent-success.md)
 * shape: everything looks fine and one claim has quietly gone missing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SimilarPair, SimilarResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

type SimilarStatus = "idle" | "loading" | "ready" | "error";

export interface UseSimilar {
  status: SimilarStatus;
  pairs: SimilarPair[];
  /** Which embedding model answered, for the footer strip. */
  model: string | null;
  /** How many blocks were embedded — fewer than the article has; short ones are skipped. */
  blocks: number;
  error: string | null;
  /**
   * Ask again. See `retry` in [useProjection.ts](./useProjection.ts) — same
   * reason, same shape, and the same sentence of Greg's behind both.
   */
  retry(): void;
}

/** Nothing, shared — a new `[]` each render would rebuild the graph every time. */
const NONE: SimilarPair[] = [];

/** The data half, with no verb in it — see `state` below. */
type SimilarState = Omit<UseSimilar, "retry"> & { slug: string };

export function useSimilar(slug: string, enabled: boolean): UseSimilar {
  /* **The state holds the data, never the verb.** `retry` is added on the way
     out, so no `setState` here has to remember to carry it. */
  const [state, setState] = useState<SimilarState>({
    slug,
    status: "idle",
    pairs: NONE,
    model: null,
    blocks: 0,
    error: null,
  });
  /* A counter rather than a boolean: two failures in a row are two presses, and
     a flag already true on the second would re-run nothing. */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /* **Whose answer this is.** The answer is about one article's passages, so
     showing the previous one's dotted lines over the new article would be a
     picture confidently about the wrong text. Returning `idle` for a slug we
     have not answered for yet is the honest report.

     **As the app is wired today this can never be false**, and the comment
     used to claim the opposite — that the reader can move to another article
     without this component unmounting. They cannot: `App.tsx` keys both
     `OwnedArticle` and `VisitorArticle` on the slug ("Keyed on the slug so
     switching article remounts"), and `DiagramPanel` is inside that subtree,
     so a slug change destroys this hook rather than handing it a new slug.
     No test exercises the transition either.

     Kept anyway. It costs one string comparison, it is the invariant written
     down where the invariant is used, and it is the half that survives if
     someone ever drops that key — which is exactly the kind of change nobody
     would think to look here for. */
  const mine = state.slug === slug;

  /* `attempt` is in the dependency list and is read nowhere in the body, which
     is exactly what makes it work and exactly what the rule objects to: it is a
     token whose only job is to be different, so that pressing Try again re-runs
     an effect whose real inputs have not changed. Removing it, as the fix
     offers, would leave a button that sets state and fetches nothing. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above — `attempt` is the retry token, not a value
  useEffect(() => {
    if (!enabled) return;
    /* **Not reset to `idle` when `enabled` goes false**, and not cleared
       between kinds either: toggling away from Force and back must not throw
       away an answer already paid for. The server caches too, so a second
       request would be cheap — but it would still be a round trip, and the
       dotted lines would visibly disappear and come back for no reason the
       reader could see. */
    const stop = new AbortController();
    setState((s) =>
      s.slug === slug && s.status === "ready"
        ? s
        : { slug, status: "loading", pairs: NONE, model: null, blocks: 0, error: null },
    );
    void (async () => {
      try {
        /* **POST, because the first call spends money.** GET is meant to be
           safe, and a browser, a proxy or a prefetcher is entitled to repeat a
           GET without asking anybody — which for this route would be paying to
           embed the article again. src/routes.ts says the same thing from the
           other end. */
        const res = await apiFetch(`/api/similar/${encodeURIComponent(slug)}`, {
          method: "POST",
          signal: stop.signal,
        });
        const body = await readJson<SimilarResponse>(res);
        if (stop.signal.aborted) return;
        setState({
          slug,
          status: "ready",
          pairs: body.pairs,
          model: body.model,
          blocks: body.blocks,
          error: null,
        });
      } catch (err) {
        // An abort is this component leaving, not a failure. Reporting it would
        // put an error in the strip every time the reader changed picture.
        if (stop.signal.aborted) return;
        setState({
          slug,
          status: "error",
          pairs: NONE,
          model: null,
          blocks: 0,
          error: (err as Error).message,
        });
      }
    })();
    return () => stop.abort();
  }, [slug, enabled, attempt]);

  /* `NONE` rather than `state.pairs` while an answer belongs to another
     article: a stable empty array, so the graph memo downstream does not
     rebuild on every render.

     Memoised for the reason `useProjection`'s twin is: without it the object is
     new on every render, and the fields inside it are the same references
     either way, which is what keeps the graph memo from rebuilding. */
  return useMemo(
    () =>
      mine
        ? { ...state, retry }
        : { slug, status: "idle" as const, pairs: NONE, model: null, blocks: 0, error: null, retry },
    [mine, state, retry, slug],
  );
}

```

### `src/web/DiagramPanel.tsx` — the Force strip

```tsx
      {kind === "force" && similar.status !== "idle" && (
        <p className="diag-note" role="status">
          {/* **The spinner, in the strip rather than over the picture.** Greg,
              2026-08-30: *"Make sure the diagrams in Diagram mode show loading
              spinners if they're generating."* Force is four fifths drawn while
              this call is in flight, so a spinner across it would say the wrong
              thing about what is missing — but a line of 10.5px grey that only
              changes its *words* when the answer lands does not read as work in
              progress either, it reads as a caption. Size 11 to sit on this
              strip's own line rather than doubling its height. */}
          {similar.status === "loading" && (
            <>
              <LoaderCircle className="cmt-spinner" size={11} aria-hidden="true" />
              Reading the article for related passages…
            </>
          )}
          {/* **Counted from the lines actually drawn, not from the pairs that
              came back.** Those are different numbers: the client drops pairs
              whose passages sit in one section, and pairs whose sections the
              reading-order chain already joins. Reporting the pairs would say
              "28 passages embedded" over a picture with no dotted lines on it —
              true about the request, and wrong about the page. */}
          {similar.status === "ready" &&
            (drawnSemantic > 0
              ? `${drawnSemantic} dotted ${drawnSemantic === 1 ? "link" : "links"} from ${similar.blocks} passages · ${similar.model}`
              : `${similar.blocks} passages embedded, and nothing came back that the picture does not already say`)}
          {/* **The server's own words, for the reason the projection strip
              above gives.** This said "Could not reach the embedding model" for
              every failure, including the one that was actually happening for
              the whole of this feature's life in production — an account not
              allowed to use the model, which no amount of reaching would have
              fixed. It also threw away a bracketed code the reader could quote.
              ⟨Sol⟩, 2026-08-28. */}
          {similar.status === "error" && (
            <>
              {`There are no dotted lines, and the rest of the picture is unaffected. ${similar.error ?? "The reason did not come back."}`}{" "}
              {/* **A verb to go with the reason.** The fetch runs once from an
                  effect, so without this the reader has the failure on screen
                  and nothing to do about it — the only way back is to leave the
                  mode and come in again, which nothing says. Greg, 2026-08-30:
                  *"And/or a button to trigger generation if needed."* */}
              <TryAgain onClick={similar.retry} what="the dotted lines" />
            </>
          )}
        </p>
      )}
```

### `src/web/DiagramPanel.tsx` — `Waiting` and `TryAgain`

```tsx
function Waiting({ projection }: { projection: UseProjection | null }) {
  /* No projection is being waited for, so there is nothing this can say about
     why. Unreachable today — see the call site — and deliberately a real
     sentence rather than a `throw` or a blank, because the one thing a reader
     must never get here is an empty band with no explanation. */
  if (projection === null) return <p className="diag-wait">This picture has nothing to draw yet.</p>;
  if (projection.status === "error") {
    return (
      /* **A column, and the sentence gets its own element.** `.diag-wait` is a
         centred flex row — right for a spinner beside six words, wrong here: the
         reason is the server's own and runs to three lines in a 288px band, and
         a row would stand the button beside it and squeeze both. `wide` turns
         the axis rather than letting the text wrap around the button. */
      <div className="diag-wait wide" role="status">
        <span>
          Could not place these paragraphs.{" "}
          {projection.error ?? "The reason did not come back."}
        </span>
        {/* Unlike Force, this failure leaves the band with nothing in it at all,
            so the button is the only thing on screen the reader can press. */}
        <TryAgain onClick={projection.retry} what="this picture" />
      </div>
    );
  }
  /* Ready, and no dots came back at all: an article of one long paragraph, or
     one that is all headings. **Not "fewer than two"** — that is `kept`'s guard,
     which is a different threshold about a picture that did draw. This branch is
     `points.length === 0`, so the honest number is none. */
  if (projection.status === "ready") {
    return (
      <p className="diag-wait" role="status">
        Nothing here to place: a paragraph needs a dozen words before the model can say what it is
        about, and none of this article's do.
      </p>
    );
  }
  return (
    <p className="diag-wait" role="status">
      <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" />
      Reading the article paragraph by paragraph…
    </p>
  );
}

/**
 * **The second try**, shown beside a failure and nowhere else.
 *
 * Both fetches in this panel run once from an effect, and until 2026-08-30 a
 * reader whose request failed had the server's reason on screen and no verb
 * anywhere — the way back was to leave the mode and come in again, which nothing
 * said. Greg: *"And/or a button to trigger generation if needed."*
 *
 * A plain `<button>` rather than shadcn's, because both places it lands are a
 * sentence of 10.5–12.5px chrome and a real button in the middle of a sentence
 * changes the line height around it. It is inline text with a hit area, which is
 * what `.diag-again` gives it.
 *
 * `what` goes in the accessible name, never in the visible label: two failures
 * can be on screen at once — the projection's, in the band, and the
 * embeddings', in the strip above it — and "Try again" twice over is a screen
 * reader announcing two identical buttons that do different things.
 */
function TryAgain({ onClick, what }: { onClick(): void; what: string }) {
  return (
    <button type="button" className="diag-again" onClick={onClick} aria-label={`Try ${what} again`}>
      Try again
    </button>
  );
}
```

### `src/web/SketchView.tsx` — the new in-flight line, in the ready branch

```tsx
      {/* **A redraw the reader did not start is still a redraw.** `useStepJob`
          reads the queue rather than remembering a click, precisely so a run
          started from the CLI, the shelf or another tab shows up — and this was
          the surface that then did nothing with the answer, so the picture
          changed under the reader two minutes later with nothing having said it
          was going to. Greg, 2026-08-30: *"Make sure the diagrams in Diagram
          mode show loading spinners if they're generating."*

          Not `JobProgress`: that row carries a Stop button and, with no job, the
          Draw button — and offering a $0.20 redraw beside a picture that is
          already there is a product decision this is not. This says what is
          happening and nothing else. The step's own label, off the server, so
          the words are the words the shelf shows for the same run. */}
      {view.job && (
        <p className="sk-busy" role="status">
          <LoaderCircle className="cmt-spinner" size={12} aria-hidden="true" />
          {view.job.status === "queued"
            ? "Waiting for the queue…"
            : (view.job.steps.find((s) => s.name === "sketch")?.label ?? "Drawing…")}
        </p>
      )}

      {notes.length > 0 && <p className="sk-note">{notes.join(" ")}</p>}
```

### `src/web/styles.css` — the new rules

```css
.diag-wait .cmt-spinner { flex: none; }
/* The failure that has a button under it. A row is right for a spinner beside
   six words and wrong for the server's own reason, which runs to three lines in
   this band — side by side, the sentence and the button squeeze each other. */
.diag-wait.wide { flex-direction: column; gap: 0.55rem; }

/* **The second try, drawn as a link and sized as a target.** It sits inside a
   sentence in both places it appears — the wait, and the Force strip above the
   picture — so a real filled button would change the line height around the
   words it belongs to. Underlined rather than coloured alone, because at 10.5px
   on this ground a hue change is not a reliable affordance and
   docs/project/colour-scales.md is emphatic that colour is never the only
   carrier. The padding is what makes it hittable on a touch device without
   taking a line of its own. */
.diag-again {
  display: inline;
  border: 0;
  margin: 0;
  padding: 0.15rem 0.1rem;
  background: none;
  color: var(--ink-soft);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.diag-again:hover, .diag-again:focus-visible { color: var(--ink); }
/* The strip is a paragraph in normal inline flow, not a flex row, so the
   spinner has to be told where the baseline is and given its own gap — `flex:
   none` on `.cmt-spinner` does nothing here. */
.diag-note .cmt-spinner { vertical-align: -0.15em; margin-right: 0.3rem; }
/* A redraw already under way, over a picture that is still readable. Above the
   notes rather than below, because it is the one line here about *now*. */
.sk-busy {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.15rem 0.7rem 0.3rem;
  font-family: var(--font-ui);
  font-size: 0.7rem;
  color: var(--ink-faint);
}
```

### The tests

`tests/diagram-panel-hover.test.tsx`, new describe block:

```tsx
describe("saying it is working, and offering a second try", () => {
  /* A request that never answers, so the panel stays in the state this is
     about. Returning a pending promise rather than a slow one keeps the test
     free of timers. */
  const neverAnswers = () => vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  /** The Force strip — the one line of chrome that picture grows, and on Force
      the only `.diag-note` there is: the projection's own strip belongs to the
      two scatters. Found by class rather than by its words, so a state that has
      lost its sentence fails here rather than quietly matching nothing. */
  const strip = () => host.querySelector(".diag-note");

  it("spins while Force is buying the embeddings", async () => {
    neverAnswers();
    mount("force");
    await settle();
    const note = strip();
    expect(note, "the strip says nothing while the call is in flight").not.toBeNull();
    expect(note?.textContent).toContain("related passages");
    expect(note?.querySelector(".cmt-spinner"), "no spinner while a model call is in flight").not.toBeNull();
  });

  it("stops spinning once the embeddings have landed", async () => {
    mount("force");
    await settle();
    expect(strip()?.querySelector(".cmt-spinner"), "still spinning after the answer").toBeNull();
  });

  it("gives Force a way to ask again when the embeddings fail", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async () => {
      asked += 1;
      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });
    mount("force");
    await settle();
    expect(asked, "the panel never asked").toBeGreaterThan(0);
    expect(strip()?.textContent, "the failure is not on screen").toContain("E_QUOTA");
    const again = strip()?.querySelector<HTMLButtonElement>("button") ?? null;
    expect(again, "a failure with no verb — the reader can only leave the mode").not.toBeNull();
    const before = asked;
    await act(async () => {
      again?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "the button did not start a second request").toBeGreaterThan(before);
  });

  it("gives Drift a way to ask again when the projection fails", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      if (!String(url).includes("/api/projection/")) {
        return new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), { status: 200 });
      }
      asked += 1;
      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });
    mount("drift");
    await settle();
    const wait = host.querySelector(".diag-wait");
    expect(wait?.textContent, "the failure is not on screen").toContain("Could not place");
    const again = wait?.querySelector<HTMLButtonElement>("button") ?? null;
    expect(again, "a failure with no verb — the reader can only leave the mode").not.toBeNull();
    const before = asked;
    await act(async () => {
      again?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "the button did not start a second request").toBeGreaterThan(before);
  });
});

```

`tests/sketch-view-drawing.test.tsx` (new file):

```tsx
// @vitest-environment jsdom
/**
 * **A Sketch that is being redrawn, with the old one still on screen.**
 *
 * Greg, 2026-08-30:
 *
 * > Make sure the diagrams in Diagram mode show loading spinners if they're
 * > generating. And/or a button to trigger generation if needed.
 *
 * The empty state already had both — the sentence about the price, the button,
 * and `JobProgress`'s spinner once it is pressed. The state that had neither
 * was the one where a picture already exists and a `sketch` job is running
 * anyway: from the CLI, from another tab, or from the shelf. `useStepJob` reads
 * the queue rather than remembering the click precisely so that those show up,
 * and this panel was the one surface that then did nothing with the answer —
 * so the picture silently changed under the reader two minutes later with
 * nothing having said it was going to.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Job } from "../src/types.js";
import { SketchView } from "../src/web/SketchView.js";

const BLOCKS: Block[] = [
  { id: "spya-b0" as BlockId, tag: "p", kind: "text", text: "one two three", words: 3, html: "<p>one two three</p>", gistable: true },
];

/** The smallest scene `readSketch` will accept and `paintScene` will draw. */
const SKETCH = {
  version: 1,
  title: "The shape of it",
  caption: "What the argument does",
  scenes: [
    {
      id: "overview",
      title: "The shape of it",
      height: 600,
      items: [
        { kind: "node", shape: "box", x: 200, y: 100, w: 200, h: 60, text: "a claim", size: "sm", block: "spya-b0" },
      ],
    },
  ],
};

/** A `sketch` job the queue says is running for this article. */
const RUNNING: Job = {
  id: "j1",
  slug: "s",
  status: "running",
  steps: [{ name: "sketch", status: "running", label: "Drawing the argument" }],
} as unknown as Job;

let host: HTMLDivElement;
let root: Root;

function serving(jobs: Job[]) {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/sketch/")) {
      return new Response(
        JSON.stringify({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false }),
        { status: 200 },
      );
    }
    /* **`done`, or this never returns.** `useJobs` drives a running job by
       POSTing `advance` in a loop that only `done` ends, and a stub answering
       neither `done` nor `busy` spins without ever awaiting a timer — which
       takes the worker out of memory rather than failing an assertion. The
       polled list below still says `running`, which is what this test is
       about. */
    if (u.includes("/advance")) {
      return new Response(JSON.stringify({ job: jobs[0] ?? null, ran: null, busy: false, done: true }), { status: 200 });
    }
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

beforeEach(() => {
  /* React only recognises `act` when this is set, and without it the async
     setStates from the job poller land outside one — which prints a warning and
     leaves assertions racing the update they are about. */
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/* Two flushes: `apiFetch` asks for a token before it sends, so the sketch and
   the job list land on different microtasks. Asserting after one sees a panel
   that has only half arrived — which is also what a genuinely broken fetch
   looks like. */
async function mount() {
  await act(async () => {
    root.render(<SketchView slug="s" blocks={BLOCKS} atRow={0} onJump={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("a picture on screen while another is being drawn", () => {
  it("draws the picture at all, before anything else is asserted", async () => {
    serving([]);
    await mount();
    expect(host.querySelector("svg.sk-svg"), "no picture, so nothing below means anything").not.toBeNull();
    expect(host.querySelector(".cmt-spinner"), "spinning with no job running").toBeNull();
  });

  it("says a redraw is under way, and spins while it is", async () => {
    serving([RUNNING]);
    await mount();
    expect(host.querySelector("svg.sk-svg"), "the picture went away while it was redrawn").not.toBeNull();
    const busy = host.querySelector(".sk-busy");
    expect(busy, "a two-minute job is running and the panel says nothing").not.toBeNull();
    expect(busy?.querySelector(".cmt-spinner"), "no spinner").not.toBeNull();
    /* The step's own label, off the server, so the words here are the words the
       shelf shows for the same run. */
    expect(busy?.textContent).toContain("Drawing the argument");
  });
});

```

## What to look for, and please go past this list

- **Does the retry actually re-fetch?** The counter is in the dependency array and read nowhere in
  the effect body. Is there any state in which pressing it sets state and fetches nothing — for
  example when `enabled` is false, or when the guard `s.status === "ready" ? s : loading` keeps a
  ready state?
- **Double-fetch and races.** `attempt` and `slug`/`enabled` are in one dependency array. Can a
  press start a second request while the first is still in flight, or leave an aborted request's
  result winning?
- **Identity churn.** Both hooks now return a memoised object. `DiagramPanel` reads only fields off
  them (`projection.points`, `projection.k`, `similar.pairs`) into layout memos, and hands the whole
  object to `Waiting`. Is anything now rebuilding per render that was not, or vice versa?
- **`useSimilar`'s not-mine branch** builds its object inline inside the memo with `slug` in the
  dependency list. Correct?
- **The live region.** `.diag-wait` and the Force strip are `role="status"`. A button inside a live
  region, and a live region that changes from a sentence to a sentence-plus-button — is that right,
  or should the button be outside it?
- **Two failures at once.** Force's strip and the band's wait can both be on screen? (Check: they
  cannot — `similar` is gated on `kind === "force"` and `projection` on drift/trail.) If they
  cannot, is the `aria-label` disambiguation dead code that should say so?
- **The Sketch line.** `view.job` comes from a poll every eight seconds. Is `.sk-busy` correct when
  the job is `queued`, when it is `cancelling`, and when it ends in error? Note the reader cannot
  stop it from here — deliberate, since the only Stop lives in the empty state's `JobProgress`. Is
  that defensible or is a stop-less spinner worse than none?
- **The `sk-busy` line renders inside `body`**, which is rendered either in the band or inside a
  full-screen `<dialog>`. Any problem there?
- **Did the tests ever go red for the right reason?** All five new assertions were watched failing
  before the code was written. Is any of them passing for a reason other than the one it names —
  in particular, `expect(x).not.toBeNull()` where `x` can be `undefined`?
- **The OOM trap in the Sketch test.** `useJobs` drives a running job by POSTing `advance` in a
  loop that only `done` ends; a stub answering neither `done` nor `busy` spins with no await and
  takes the worker out of memory. The stub answers `done: true` while the polled list still says
  `running`. Is that a fixture that lies in a way that matters?
- Anything that would only show up in a browser.
