# Review 2: the fixes to your findings, plus hover cards on the rest of Diagram mode

You reviewed the spinner/retry work earlier and returned three findings. This asks two things:

**(A)** Check that each of your three findings is actually fixed, and that the fix did not
introduce something worse. Be hard on this — a fix that changes the shape of a bug rather than
removing it is the failure mode.

**(B)** Review a second, separate change on top: hover cards on the remaining controls.

Be adversarial. "This is fine" is a welcome finding; say so plainly.

---

# Part A — your three findings and what was done

## A1. You said: a failed revalidation replaces ready data

> In both hooks, the ready-state guard only prevents painting `loading`; execution continues into
> the POST. … If that hidden refresh fails, the catch replaces the ready data with `NONE`/`IDLE`,
> removing dotted lines or blanking the scatter.

The re-fetch itself was left in place (the server caches, and the round trip is what the existing
comment already contemplated). What changed is the `catch`, in both hooks:

```ts
      } catch (err) {
        // An abort is this component leaving, not a failure. Reporting it would
        // put an error in the strip every time the reader changed picture.
        if (stop.signal.aborted) return;
        /* **A failed revalidation must not take the picture away**, and the
           guard above was only half of that. It suppressed the *spinner* when
           an answer was already held, and this line then replaced the answer
           itself with nothing — so one flaky repeat, on a toggle back to a
           picture that was complete, emptied the band and reported a failure
           about a picture the reader already had. It is the rule `useSketch`
           and `useIdeas` write down, applied to the hook that had not got it.
           ⟨Sol⟩, 2026-08-30.

           There is nothing to say to the reader here: what is on screen is
           still the answer, and a sentence about a request they did not make
           would be reporting our own bookkeeping. `retry` is offered only from
           `error`, which is now reachable only when there is nothing to lose. */
        setState((was) =>
          was.slug === slug && was.status === "ready"
            ? was
            : { ...IDLE, slug, status: "error", error: (err as Error).message },
        );
      }
```

```ts
      } catch (err) {
        // An abort is this component leaving, not a failure. Reporting it would
        // put an error in the strip every time the reader changed picture.
        if (stop.signal.aborted) return;
        /* **A failed revalidation must not take the dotted lines away.** See
           the twin of this in `useProjection` for the whole reason: the guard
           above suppressed the spinner when an answer was already held, and
           this replaced the answer, so a flaky repeat on a toggle back to Force
           erased lines that were correctly drawn. ⟨Sol⟩, 2026-08-30. */
        setState((was) =>
          was.slug === slug && was.status === "ready"
            ? was
            : {
                slug,
                status: "error",
                pairs: NONE,
                model: null,
                blocks: 0,
                error: (err as Error).message,
              },
        );
      }
```

Two tests, both watched failing first:

```tsx
describe("a second request that fails, over an answer that already landed", () => {
  /** A successful projection holding nothing, for the routes a test is not about. */
  const EMPTY_PROJECTION = {
    model: "m", blocks: 0, k: 0, variance: [0, 0],
    skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points: [],
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it("keeps Force's dotted lines when the repeat request is refused", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      /* **A body per route.** The detour below is through Drift, which reads
         `points.length` off whatever comes back — an empty object takes the
         whole render down, and a stub that answers the wrong shape tests the
         code against a server that does not exist. */
      if (!String(url).includes("/api/similar/")) return new Response(JSON.stringify(EMPTY_PROJECTION), { status: 200 });
      asked += 1;
      return asked === 1
        ? new Response(JSON.stringify({ model: "m", blocks: 7, eligible: 7, omitted: 0, pairs: [] }), { status: 200 })
        : new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });

    mount("force");
    await settle();
    const before = host.querySelector(".diag-note")?.textContent ?? "";
    expect(before, "the first answer never landed").toContain("7 passages");

    /* Away and back, which is what a reader does with a chip row. The panel
       stays mounted — `root.render` on the same root with the same component —
       so the hook's state is the same state, which is the whole point. */
    mount("drift");
    await settle();
    mount("force");
    await settle();
    expect(asked, "the second visit did not re-ask, so this proves nothing").toBeGreaterThan(1);

    const after = host.querySelector(".diag-note")?.textContent ?? "";
    expect(after, "a failed repeat blanked an answer the reader already had").toContain("7 passages");
    expect(after, "a failed repeat reported a failure about a picture that is fine").not.toContain("E_QUOTA");
  });

  it("keeps Drift's dots when the repeat request is refused", async () => {
    /* `id`, `x`, `y`, `c` — the real `ProjectionPoint`. Two ids the fixture
       article actually has, because `scatter.ts` drops any point whose block the
       article no longer holds, and a fixture that lied here would draw nothing
       and read as the bug this test is about. */
    const points = [
      { id: "spya-b0", x: -0.4, y: 0.1, c: 0 },
      { id: "spya-b2", x: 0.4, y: -0.1, c: 1 },
    ];
    let asked = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      if (!String(url).includes("/api/projection/")) {
        return new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), { status: 200 });
      }
      asked += 1;
      return asked === 1
        ? new Response(
            JSON.stringify({
              model: "m", blocks: 2, k: 2, variance: [0.2, 0.1],
              skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points,
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });

    mount("drift");
    await settle();
    expect(host.querySelectorAll("svg .diag-node").length, "the first answer never drew").toBeGreaterThan(0);

    mount("force");
    await settle();
    mount("drift");
    await settle();
    expect(asked, "the second visit did not re-ask, so this proves nothing").toBeGreaterThan(1);

    expect(
      host.querySelectorAll("svg .diag-node").length,
      "a failed repeat emptied a picture that was already drawn",
    ).toBeGreaterThan(0);
    expect(host.querySelector(".diag-wait"), "a drawn picture was replaced by a failure").toBeNull();
  });
});

```

Questions for you: Is `was.slug === slug && was.status === "ready"` the right guard — can `was`
be a ready answer for a *different* slug and slip through, or a ready answer that is about to be
made stale by something else? Should a failed revalidation be silent, or should the reader be told
something? Does `retry` remain reachable in every state where the reader is actually stuck? And is
leaving the redundant re-fetch in place defensible, or should the effect skip the POST when it
already holds a ready answer for this slug?

## A2. You said: a Sketch redraw failure disappears as though it succeeded

`useStepJob` now tracks a job this mount *watched running*, not only one it started:

```ts
  const [seenId, setSeenId] = useState<string | null>(null);
  useEffect(() => {
    if (job) setSeenId(job.id);
  }, [job]);
  const stopped = useMemo(() => {
    /* `startedId` first: a job that fails between the POST and the next poll is
       never seen running, so the press is the only record of it. */
    const id = startedId ?? seenId;
    const mine = id ? queue.jobs.find((j) => j.id === id) : undefined;
    if (!mine) return null;
    if (mine.status === "error") return mine.error ?? "The job failed.";
    if (mine.status === "cancelled") return "Stopped.";
    return null;
  }, [queue.jobs, startedId, seenId]);
```

and `SketchView`'s ready branch reports it:

```tsx
      {/* **And the spinner going away is not the same as the work succeeding.**
          A redraw that came back failed left the picture standing and said
          nothing, which reads as a completed run that changed nothing — after
          two minutes and $0.20. The server's own words, per copy.md. ⟨Sol⟩. */}
      {!view.job && view.failed && <p className="sk-failed">{view.failed}</p>}
```

Test, watched failing first (it moves a fake clock so the 8s poll sees the job change from
`running` to `error`):

```tsx
  it("says so when a redraw somebody else started comes back failed", async () => {
    serving([RUNNING]);
    await mount();
    expect(host.querySelector(".sk-busy"), "it never looked busy, so this proves nothing").not.toBeNull();

    /* The job leaves the running set and reappears as an error. The poll is on
       an 8s timer, so the clock has to move for the panel to see it. */
    queue = [FAILED];
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });

    expect(host.querySelector(".sk-busy"), "still claiming to be working").toBeNull();
    const gone = host.querySelector(".sk-failed");
    expect(gone, "the redraw failed and the panel said nothing at all").not.toBeNull();
    expect(gone?.textContent, "the server's own reason was thrown away").toContain("E_MODEL_FORBIDDEN");
    expect(host.querySelector("svg.sk-svg"), "the old picture should stand").not.toBeNull();
  });
```

Questions: `useStepJob` is shared by four other surfaces (`useGlossary`, `useSummaries`,
`useIdeas`, `Tweets.tsx`), all of which render `failed` under a `JobProgress` button. Does widening
`failed` to cover a job started elsewhere break any of their assumptions — in particular, can a
surface now show a failure for a job the reader never asked for and has no way to dismiss? Is
`startedId ?? seenId` the right precedence? Does `seenId` ever go stale in a way that reports an
old failure as news? And is the `.sk-failed` message reachable/clearable — it persists for the
life of the mount.

## A3. You said: the comments claim Force and Projection share embeddings, and they do not

Both comments now say the opposite, naming `article-vectors.ts`'s own record of the debt. Two other
comment inaccuracies you noted (the memo "prevents `Waiting` rerendering" claim, and my
"hittable on touch" on the retry button) are corrected too. Nothing else changed. Please confirm
the corrected text is now accurate rather than merely different.

---

# Part B — hover cards on the rest of the controls

Greg, 2026-08-30: *"add detailed tooltips to the various diagram-buttons etc to explain how things
work."*

The four picture chips already had Floating UI hover cards. Everything under them had a `title`
attribute: the Sideways/Colour chips, the lane legend, the step bar's readout. Sketch's Back,
scene row and Enlarge likewise.

**The card component**, moved out of `DiagramPanel` into `Tooltip.tsx` (because `SketchView` wants
it too and `DiagramPanel` renders `SketchView`):

```tsx
/**
 * **The card a control carries**: what it is, then how it
 * works and what it costs.
 *
 * One shape rather than five, because the row of chips proved the shape and
 * everything under it then grew a `title` attribute instead. It lives here
 * rather than in `DiagramPanel` because `SketchView` wants it too, and
 * `DiagramPanel` renders `SketchView` — so the panel cannot be the one to
 * export it. Greg asked for the
 * chips' cards in 2026-08-27 — *"add tooltips when hovering over each Diagram
 * button to explain how it works"* — and came back on 2026-08-30 for the rest:
 * *"add detailed tooltips to the various diagram-buttons etc to explain how
 * things work."*
 *
 * **A `title` is not a small version of this**, and that is the whole argument
 * for the change. It waits about a second, cannot be styled, truncates at the
 * OS's idea of a line, and **does not exist at all on a touch device** — which
 * is the device the step bar below was specifically built for. For a sentence
 * whose job is to say what a control means, that is close to not being there.
 *
 * The second paragraph is always the one a reader cannot work out by pressing:
 * where the answer comes from, what it costs, or what the control does *not*
 * promise. The first they could have guessed; the second is why the card is
 * worth a hover.
 */
export function ControlTip({ head, what, how }: { head: string; what: string; how: string }) {
  return (
    <>
      <div className="tip-soon-head">{head}</div>
      <p>{what}</p>
      <p className="tip-soon-how">{how}</p>
    </>
  );
}

```

**The option chips** — `Choice` now wraps each radio in a `Tooltip` inside a `TooltipGroup`, and
its roving-focus move changed because of it:

```tsx
function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange(next: T): void;
  options: { value: T; label: string; blurb: string; how: string }[];
}) {
  return (
    /* The caption sits OUTSIDE the radiogroup. A `<span>` among the radios is a
       child of a role that does not want one, and it would also make the
       group's children off-by-one from its options — which is exactly the sort
       of index the focus move below has to get right. */
    <div className="diag-opt">
      <span className="diag-opt-label">{label}</span>
      {/* **Hover cards, not `title` attributes** — see `ControlTip`. These are
          the chips that decide what an axis *means*, which is the one thing a
          reader cannot recover by pressing them and looking: two arrangements
          of the same dots both look like arrangements of dots. Grouped, so
          reading along the row is one gesture. */}
      <div className="diag-opt-set" role="radiogroup" aria-label={label}>
        <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {options.map((o, i) => (
        <Tooltip
          key={o.value}
          placement="bottom"
          /* Same finding as the kind chips': the card is wider than a chip and
             these sit near the band's left edge, so without this the card is
             thrown sideways onto the neighbours the reader is reading towards.
             Tooltip.tsx § keepSide. */
          keepSide
          className="tip-soon"
          content={<ControlTip head={o.label} what={o.blurb} how={o.how} />}
        >
        {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern — see the kind switcher above */}
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={`diag-opt-btn${o.value === value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const d =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -1
                  : 0;
            if (d === 0) return;
            e.preventDefault();
            // Wraps, as the radio pattern specifies.
            const at = (i + d + options.length) % options.length;
            const next = options[at];
            if (!next) return;
            onChange(next.value);
            /* **And focus follows.** The newly-checked radio is the new tab
               stop, so leaving focus behind means the next arrow press runs the
               *old* button's handler and steps from the same place — you can
               reach the neighbour and never anything past it. Tab then also
               lands back inside the group instead of leaving it. The kind
               switcher above already does this; this one did not until GPT Sol
               read it, and the failure is one press away from looking fine. */
            /* **By value, not by walking the parent's children.** Each button
               is now wrapped in a `<Tooltip>`, and although the wrapper clones
               its child rather than adding an element — so the walk still
               happens to work — relying on that is one refactor away from a
               control that silently stops moving. The kind switcher above was
               changed the same way and for the same reason. */
            /* Scoped to *this* group with `closest`, not to the document:
               there are two of these rows on screen at once, and a value name
               shared between them would otherwise move focus into the other
               one. Nothing collides today, which is what would make that bug
               arrive later and look like nothing to do with this line. */
            e.currentTarget
              .closest(".diag-opt-set")
              ?.querySelector<HTMLElement>(`[data-diag-opt="${next.value}"]`)
              ?.focus();
          }}
          data-diag-opt={o.value}
          >
            {o.label}
          </button>
        </Tooltip>
        ))}
        </TooltipGroup>
      </div>
    </div>
  );
}
```

**The step bar**, which is where the two real problems were:

```tsx
      <div className="diag-step">
        <Tooltip
          placement="top"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head={`Previous ${unit}`}
              what={
                canStep(-1)
                  ? `Moves the article back one ${unit}, and the mark in the picture with it.`
                  : `Nothing to go back to — you are at the first ${unit} the picture draws.`
              }
              how={STEP_HOW}
            />
          }
        >
          {/* **`aria-disabled`, not `disabled`, and the card is the whole
              reason.** A disabled button cannot be focused and does not fire
              mouse events, so its card is unreachable by any route — and the
              reader who most wants to know why this button is dead is exactly
              the reader who cannot open the sentence saying so. So it stays in
              the tab order, keeps its greyed look, announces itself as
              unavailable, and the press does nothing. Nothing had to be added
              for that last part: `stepTo` already returns when `stepTarget`
              gives no row, which is the same condition `canStep` reports — so
              the button was never doing anything at the ends anyway, and
              `disabled` was only ever the styling and the announcement. */}
          <button
            type="button"
            className="diag-step-btn"
            onClick={() => stepTo(-1)}
            aria-disabled={!canStep(-1)}
            aria-label={`Previous ${unit}`}
          >
            <ChevronUp size={22} />
          </button>
        </Tooltip>
        {/* `aria-live` off: this changes on every scroll, and a screen reader
            announcing "12 of 47" continuously while the reader moves down the
            page is noise over the prose they are actually reading. The buttons
            say what they do, and the card below says where you have landed. */}
        <Tooltip
          placement="top"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head="Where you are"
              what={
                starts.length > 0
                  ? `The ${unit} you are standing in, out of ${starts.length} the picture draws.`
                  : "There is nothing to step through in this picture yet."
              }
              how={`The unit is read off what is actually drawn rather than off which picture is lit — so it says ${unit} here, and would say something else on a picture made of different rows.`}
            />
          }
        >
          {/* **A tab stop, because the card on it is otherwise unreachable.**
              This is the one place that says what a press of the arrows moves
              *by* — a section here, a paragraph on the two scatters — and the
              number beside it is a count of exactly that unit. A card on an
              element nothing can focus is a card a keyboard reader cannot open,
              which is the same failure the `title` attribute had for touch. So
              the readout takes a tab stop it does not need for its own sake. */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: see above — the tab stop exists so the hover card on this readout is reachable by keyboard, which is the whole point of it not being a `title` */}
          <span className="diag-step-at" tabIndex={0}>
            {starts.length > 0 ? `${rung} / ${starts.length}` : "—"}
          </span>
        </Tooltip>
        <Tooltip
          placement="top"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head={`Next ${unit}`}
              what={
                canStep(1)
                  ? `Moves the article on one ${unit}, and the mark in the picture with it.`
                  : `Nothing to go on to — you are at the last ${unit} the picture draws.`
              }
              how={STEP_HOW}
            />
          }
        >
          <button
            type="button"
            className="diag-step-btn"
            onClick={() => stepTo(1)}
            aria-disabled={!canStep(1)}
            aria-label={`Next ${unit}`}
          >
            <ChevronDown size={22} />
          </button>
        </Tooltip>
      </div>
```

Two changes there:
- the readout is a `<span>`, so nothing could focus it and its card was unreachable by keyboard; it
  now takes a tab stop it does not need for its own sake (with a biome suppression saying why);
- the two buttons were `disabled`, which cannot be focused and fires no mouse events — so at the
  ends of the article, exactly when a reader wants to know why the button is dead, the card saying
  so could not be opened by any route. They are `aria-disabled` now. `stepTo` already returned
  early on the same condition `canStep` reports, so no new guard was added.

The CSS moved with it:

```css
.diag-step-btn:hover:not([aria-disabled="true"]) {
  color: var(--highlight);
  border-color: var(--highlight);
  background: var(--highlight-wash);
}
.diag-step-btn:active:not([aria-disabled="true"]) { background: var(--surface-raised); }
/* **Unavailable, not hidden, and not `:disabled` either.** At the two ends of
   the article one of these does nothing, and a button that disappeared would
   move the other one under the reader's thumb between presses. It is
   `aria-disabled` rather than `disabled` because a disabled button cannot be
   focused and fires no mouse events — so its hover card, which is the thing
   that says *why* it is dead, would be unreachable by exactly the reader asking
   the question. See DiagramPanel.tsx § the step bar. */
.diag-step-btn[aria-disabled="true"] { opacity: 0.3; cursor: default; }
```

**The test**, which opens each card and reads it rather than looking for a mark on the trigger:

```tsx
describe("the controls explain themselves", () => {
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  /**
   * **Open the card and read it**, rather than looking for a mark on the
   * trigger.
   *
   * Floating UI puts nothing durable on the trigger — `aria-describedby`
   * appears only while the card is open — so an attribute check is a check that
   * passes on a control with no card at all. Focus is the opener that works
   * here: `Tooltip` includes `useFocus`, and a hover in jsdom does not reach
   * it (measured, not assumed — `mouseover` leaves nothing on screen and
   * `focus()` renders the panel). It is also the interaction that matters most
   * for the ask, because a keyboard reader is the one a `title` serves worst
   * after a touch reader.
   *
   * The card is portalled to the end of `<body>`, so it is looked for in the
   * document rather than in the host.
   */
  const cardFor = async (el: Element): Promise<string> => {
    (el as HTMLElement).focus();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    const card = document.querySelector('[role="tooltip"]');
    const text = card?.textContent ?? "";
    (el as HTMLElement).blur();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    return text;
  };

  /** A card worth having: a name, a sentence, and the sentence a press cannot teach. */
  const isDetailed = (text: string) => text.length > 80;

  it("puts a card on every chip in the picture row", async () => {
    mount("force");
    await settle();
    const chips = [...host.querySelectorAll(".diag-kind")];
    expect(chips.length, "the chip row is not drawn").toBeGreaterThan(3);
    for (const chip of chips) {
      const label = chip.textContent ?? "?";
      expect(isDetailed(await cardFor(chip)), `${label} has no card, or a thin one`).toBe(true);
      expect(chip.hasAttribute("title"), `${label} fell back to a title attribute`).toBe(false);
    }
  });

  it("puts a card on the step bar, which is the one built for a device titles do not reach", async () => {
    mount("force");
    await settle();
    const bar = host.querySelector(".diag-step");
    expect(bar, "the step bar is not drawn").not.toBeNull();
    const parts = [...(bar?.querySelectorAll(".diag-step-btn, .diag-step-at") ?? [])];
    expect(parts.length, "the bar should be two buttons and a readout").toBe(3);
    for (const part of parts) {
      expect(isDetailed(await cardFor(part)), `${part.className} has no card, or a thin one`).toBe(true);
      expect(part.hasAttribute("title"), "a step control fell back to a title").toBe(false);
    }
  });

  it("puts a card on the axis and colour chips, which is where a title used to be", async () => {
    /* These need a drawn scatter: the second control row renders only when
       there are dots. A ready projection with two points is the smallest
       article that gets there. */
    const points = [
      { id: "spya-b0", x: -0.4, y: 0.1, c: 0 },
      { id: "spya-b2", x: 0.4, y: -0.1, c: 1 },
    ];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) =>
      String(url).includes("/api/projection/")
        ? new Response(
            JSON.stringify({
              model: "m", blocks: 2, k: 2, variance: [0.2, 0.1],
              skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points,
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), { status: 200 }),
    );
    mount("drift");
    await settle();

    const opts = [...host.querySelectorAll(".diag-opt-btn")];
    expect(opts.length, "the second control row is not drawn").toBeGreaterThan(2);
    for (const o of opts) {
      const label = o.textContent ?? "?";
      expect(isDetailed(await cardFor(o)), `${label} has no card, or a thin one`).toBe(true);
      expect(o.hasAttribute("title"), `${label} kept its title attribute`).toBe(false);
    }
  });
});

```

## What to look for

- **`aria-disabled` instead of `disabled`.** Is the press genuinely inert? `stepTo` returns when
  `stepTarget` gives no row — is that *exactly* `canStep`'s condition, in every state, including
  `starts.length === 0`? Is there any other path to `stepTo` (a key handler, the picture's own
  arrows) that `disabled` was previously blocking and `aria-disabled` is not? Is keeping it in the
  tab order right, or is a focusable dead button worse than an unreachable explanation?
- **The `<span tabIndex={0}>`.** Defensible, or is there a better way to expose that card?
- **`Choice`'s focus move** changed from walking `parentElement.children[at]` to a scoped
  `closest(".diag-opt-set")?.querySelector('[data-diag-opt=…]')`. Is that correct for every
  arrow press including the wrap-around, and does the `Tooltip` wrapper change what `currentTarget`
  is inside `onKeyDown`?
- **`TooltipGroup` nesting.** There is now a group inside `.diag-opt-set`, a group in the chip row
  above it, and a group in `SketchView`'s scene row. Any problem with several delay groups on one
  page, or with a group whose children are conditionally rendered?
- **The test's method.** It focuses a trigger, waits 400ms, and reads `[role="tooltip"]` out of
  `document`. Hover was tried first and does not reach `useFocus`'s sibling in jsdom. Is
  `text.length > 80` a real assertion or theatre? Could this test pass with the card attached to
  the wrong control?
- **Copy.** The cards' second paragraphs make factual claims — about the lane cap of eight, about
  tf-idf across lanes, about Drift and Trail sharing one model call, about the canvas being 760
  units. Check each against the code and say which are wrong. Sources: `src/web/scatter.ts`,
  `src/projection.ts`, `src/web/graph.ts`, `src/sketch-scene.ts`, `src/web/diagram.ts`.
- Anything a browser would show that this cannot.
