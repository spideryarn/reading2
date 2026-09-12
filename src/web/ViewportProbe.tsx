/**
 * **The instrument that unblocks the viewport fit — a trace off a real phone,
 * not a live readout.**
 *
 * Stage 4 of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md.
 * `.mode-band` is `position: fixed`, so its `top` and `bottom` are the *layout*
 * viewport's. Chromium's `interactive-widget=resizes-content` shrinks that
 * viewport when the keyboard opens and the existing rules are already right;
 * WebKit does not implement it (bugs.webkit.org/show_bug.cgi?id=259770) and
 * pans a smaller *visual* viewport over a layout viewport that stays full
 * height. **Whether that actually puts a composer under the keys on Greg's
 * phone is unknown**, and nothing on this box can find out. So this file does
 * not choose any arithmetic and does not touch a stylesheet. It records what
 * the phone says, and the arithmetic waits for it.
 *
 * ## Why it retains samples instead of displaying numbers
 *
 * The frames worth having are the ones while the keyboard is *sliding*, and a
 * reader holding a phone cannot read a number that changes sixty times a
 * second. So every visual-viewport `resize` and `scroll` appends a timestamped
 * sample and nothing is overwritten; the panel shows only a count until it is
 * asked for the trace. GPT Sol F12, 2026-09-06 — an earlier draft was a live
 * readout and could not have held the transient frames it exists to catch.
 *
 * ## Why it measures the dock and the hint, and not only the band
 *
 * The candidate arithmetic is about **the actual occluding bars** — the dock,
 * the home-indicator inset, the install hint and the keyboard all eat the same
 * strip at the bottom of the screen, and the whole question is whether they
 * combine by union or by sum. An instrument that measured only the band's own
 * parts could not have told the two apart. Sol F12 again.
 *
 * ## It measures the real page
 *
 * Nothing here renders a band. It reads whatever band the reader has open —
 * the real `ModeSurface` output, inside the real reader, with the real dock and
 * the real controls bar — through `document.querySelector`. A copy of the band
 * markup on a diagnostic page would measure a replica, which is worth nothing
 * for this question.
 *
 * ## How a custom property gets read as a number
 *
 * `getComputedStyle(el).getPropertyValue("--dock-bottom")` hands back the token
 * stream with variables substituted, which here is `calc(2.5rem + 0px)` — a
 * string, not a length. Two hidden probe spans borrow the tokens into ordinary
 * `width`, `height` and `padding`, which the browser *does* resolve to pixels.
 * The spans sit inside this panel, and the panel is rendered inside `.reader`,
 * which is where `--mode-w` and `--spine-w` are set (App.tsx writes `--mode-w`
 * inline; `--spine-w` is `.reader.spine-on`/`.spine-off` in shell.css). The
 * other six are on `:root` (tokens.css, and narrow-window.css switches
 * `--bar-bottom` and `--dock-bottom` there too) and inherit down. `--kb-inset`
 * is set on nothing but the three dialogs' inline styles, so its resolved `0px`
 * here is the honest answer and the header's raw strings are what say whether a
 * token exists at all.
 *
 * **Checked in Chrome on this box, 2026-09-07**, against the app's own token
 * declarations, because none of it can be checked in jsdom and an instrument
 * that reads zeros looks exactly like a phone with no keyboard.
 * `getPropertyValue("--dock-bottom")` really does come back as
 * `"calc(2.5rem + 0px)"`; the borrowed lengths really do read `44px`, `40px`,
 * `56px`, `288px`, `12px`; `--kb-inset` really is `""` and answers through its
 * `var()` fallback. And the `content-box` above is **load-bearing rather than
 * tidy**: the same span left on the app's global `border-box`, given a padding
 * wider than its width, reported the padding as the width — one token silently
 * reading as another's value, which is precisely the failure this instrument
 * exists to rule out.
 *
 * ## Off unless asked for
 *
 * `?probe=1`, read **once at mount and never subscribed to** — `currentAt()` in
 * params.ts is the same trick and gives the same reason. Without it this
 * renders `null`, registers no listener and adds nothing to the DOM. There is
 * no other way in: an installed iOS web app has no address bar, so the URL has
 * to be there when the app cold-starts.
 */
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { currentProbe } from "./params.js";
import { controlsBar } from "./scroll.js";

/** How many samples are kept before recording stops. */
const CAP = 600;

/**
 * **The oldest samples are the ones kept**, which is the opposite of a ring
 * buffer and deliberate: the first second after a tap on the composer is the
 * whole subject, and a buffer that dropped the front to make room for a
 * hundred frames of somebody scrolling afterwards would throw away the
 * measurement. Clear and go again is the way to take a second reading.
 */
function full(count: number): boolean {
  return count >= CAP;
}

type Vis = "gone" | "off" | "on";

/** `[x, y, width, height]`, rounded — a rectangle costs four numbers, not four keys. */
type Box = [number, number, number, number];

interface Sample {
  /** Milliseconds since the probe started. */
  readonly t: number;
  /**
   * **What fired.** `resize` and `scroll` are the *visual viewport's* — the
   * names predate the window's events being recorded at all, and they stay so
   * that scripts/viewport-trace.ts and every trace already taken still read.
   * `window-resize` and `orientationchange` are the window's, and `laid-out` is
   * the reader re-rendering with a new width. One `resize` for both would make
   * the claim a rotation trace exists to test — *a zoom fired the visual
   * viewport's resize and not the window's* — unprovable. GPT Sol F4,
   * 2026-09-12.
   */
  readonly ev:
    | "start"
    | "resize"
    | "scroll"
    | "window-resize"
    | "orientationchange"
    | "laid-out"
    | "mark";
  /** `[innerWidth, innerHeight, scrollX, scrollY]`. */
  readonly win: Box;
  /** `[width, height, offsetTop, offsetLeft, scale]`, or `null` where there is no `visualViewport`. */
  readonly vv: [number, number, number, number, number] | null;
  /**
   * `[root clientWidth, the width the reader laid out for]`. Beside `win`'s
   * `innerWidth` this is the whole of a rotation question: on iPad Safari a
   * zoom shrinks `innerWidth` and not the root's `clientWidth`
   * (docs/plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md),
   * and the third number says which one the layout believed. `layoutViewportWidth()`
   * is not recorded because it is the `max` of two numbers already here; the
   * reader's stored width is not reconstructable, so it is.
   */
  readonly lay: [number, number | null];
  /** The occlusion tokens, resolved to pixels — see the note above on how. */
  readonly tok: Readonly<Record<string, number | null>>;
  readonly rect: Readonly<Record<string, Box | null>>;
  /** Which element each measured rectangle came from, so a `null` can be told from a miss. */
  readonly of: Readonly<Record<string, string | null>>;
  /** Present and on screen, present and pushed off, or not rendered at all. */
  readonly vis: { readonly dock: Vis; readonly hint: Vis; readonly band: Vis };
  /** `standalone` in the installed app, `browser` in an ordinary tab. */
  readonly dm: string;
  /** `:root[data-bars]` — the switch that takes `--dock-bottom` to `0px` while you read. */
  readonly bars: string;
}

const round = (n: number): number => Math.round(n * 10) / 10;

function box(el: Element | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [round(r.x), round(r.y), round(r.width), round(r.height)];
}

/** `form.chat-composer` — enough to tell one child from another in a trace. */
function sig(el: Element | null): string | null {
  if (!el) return null;
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).join(".") : "";
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
}

function visible(el: Element | null): Vis {
  if (!el) return "gone";
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return "off";
  /* The dock does not unmount when it goes: it slides out on a `translateY`
     (narrow-window.css § a small device), so "is it in the DOM" and "is it
     covering anything" are different questions and only the second one is
     about occlusion. */
  return r.bottom > 0 && r.top < window.innerHeight ? "on" : "off";
}

/**
 * The band's scrolling child, found rather than listed.
 *
 * A per-mode table of selectors would be a second place for the truth to live,
 * and the plan already records that the modes disagree about this — Referee has
 * three scrollers, Outline has none by design, Chat's changes identity with
 * state. Asking the computed style which child actually scrolls is the same
 * question the reader's thumb asks. Two levels deep, because every one of them
 * is a child or a grandchild of the band and walking a whole transcript on
 * every keyboard frame is not free.
 */
function scrollerIn(band: Element): Element | null {
  for (const child of band.children) {
    const o = getComputedStyle(child).overflowY;
    if (o === "auto" || o === "scroll") return child;
    for (const grand of child.children) {
      const g = getComputedStyle(grand).overflowY;
      if (g === "auto" || g === "scroll") return grand;
    }
  }
  return null;
}

/** `width: var(--x)` read back as a number, or `null` where the browser gave us nothing. */
function px(style: CSSStyleDeclaration, prop: string): number | null {
  const n = Number.parseFloat(style.getPropertyValue(prop));
  return Number.isFinite(n) ? round(n) : null;
}

/**
 * **The two hidden spans that turn custom properties into pixels.**
 *
 * `content-box` explicitly, because the app sets `border-box` on everything
 * (tokens.css) and under that a padding wider than the width would be reported
 * as the width — a token silently reading as another token's value, which is
 * exactly the class of failure this instrument exists to avoid. `visibility:
 * hidden` rather than `display: none` so the values are *used* values from a
 * real layout, and `position: absolute` so neither span is in anybody's flow.
 */
const HIDDEN: CSSProperties = {
  position: "absolute",
  visibility: "hidden",
  pointerEvents: "none",
  boxSizing: "content-box",
  top: 0,
  left: 0,
};

/* Which token each borrowed length carries. Split across two spans because one
   element has only so many independent lengths that resolve to pixels. */
const SPAN_A: CSSProperties = {
  ...HIDDEN,
  width: "var(--bar-bottom, 0px)",
  height: "var(--dock-bottom, 0px)",
  paddingTop: "var(--safe-bottom, 0px)",
  paddingBottom: "var(--hint-h, 0px)",
};
const SPAN_B: CSSProperties = {
  ...HIDDEN,
  width: "var(--mode-w, 0px)",
  height: "var(--spine-w, 0px)",
  paddingTop: "var(--kb-inset, 0px)",
  paddingBottom: "var(--safe-top, 0px)",
};

const TOKENS_A = ["--bar-bottom", "--dock-bottom", "--safe-bottom", "--hint-h"] as const;
const TOKENS_B = ["--mode-w", "--spine-w", "--kb-inset", "--safe-top"] as const;

function tokensFrom(a: HTMLElement | null, b: HTMLElement | null): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (a) {
    const s = getComputedStyle(a);
    out["--bar-bottom"] = px(s, "width");
    out["--dock-bottom"] = px(s, "height");
    out["--safe-bottom"] = px(s, "padding-top");
    out["--hint-h"] = px(s, "padding-bottom");
  }
  if (b) {
    const s = getComputedStyle(b);
    out["--mode-w"] = px(s, "width");
    out["--spine-w"] = px(s, "height");
    out["--kb-inset"] = px(s, "padding-top");
    out["--safe-top"] = px(s, "padding-bottom");
  }
  return out;
}

/**
 * **What the browser calls each token before anything resolves it**, recorded
 * once at the top of the trace.
 *
 * The resolved numbers above cannot distinguish "this token is `0px` here" from
 * "this token does not exist and the `var()` fallback answered" — and a
 * mistyped `env()` name resolves to `0px` on every machine we develop on, which
 * is the hazard tokens.css warns about at length. These strings are what says
 * which of the two it was.
 */
function rawTokens(el: Element | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el) return out;
  const s = getComputedStyle(el);
  for (const name of [...TOKENS_A, ...TOKENS_B]) {
    out[name] = s.getPropertyValue(name).trim();
  }
  return out;
}

function displayMode(): string {
  if (typeof window.matchMedia !== "function") return "unknown";
  for (const m of ["standalone", "fullscreen", "minimal-ui", "browser"]) {
    if (window.matchMedia(`(display-mode: ${m})`).matches) return m;
  }
  return "unknown";
}

function take(
  ev: Sample["ev"],
  t: number,
  spanA: HTMLElement | null,
  spanB: HTMLElement | null,
  laidOutWidth: number | null,
): Sample {
  const vv = window.visualViewport ?? null;
  const band = document.querySelector(".mode-band");
  const dock = document.querySelector(".dock");
  const hint = document.querySelector(".install-hint");
  const head = band?.querySelector(":scope > .band-head") ?? null;
  const body = band ? scrollerIn(band) : null;
  /* The thing a keyboard actually hides. Chat's composer is a `<form>`; the
     `activeElement` line beside it is the more general answer, and the one that
     will still be right in a mode this instrument was never pointed at. */
  const composer = band?.querySelector("form, textarea, input") ?? null;
  const focused = document.activeElement === document.body ? null : document.activeElement;

  return {
    t: round(t),
    ev,
    win: [
      round(window.innerWidth),
      round(window.innerHeight),
      round(window.scrollX),
      round(window.scrollY),
    ],
    vv: vv
      ? [round(vv.width), round(vv.height), round(vv.offsetTop), round(vv.offsetLeft), vv.scale]
      : null,
    lay: [round(document.documentElement.clientWidth), laidOutWidth],
    tok: tokensFrom(spanA, spanB),
    rect: {
      /* `controlsBar()` rather than a bare query, for the reason it gives:
         since 2026-09-08 the bar is not always drawn, and an unscoped
         `.controls` then finds an author's own paragraph. A probe that recorded
         a piece of prose as the chrome would be worse than one that recorded
         nothing — the whole point of this file is to be believed about a device
         nobody here is holding. `null` is the honest answer for a page with no
         bar, and `box` already produces it. */
      controls: box(controlsBar()),
      dock: box(dock),
      hint: box(hint),
      band: box(band),
      head: box(head),
      body: box(body),
      composer: box(composer),
      focus: box(focused),
    },
    of: { body: sig(body), composer: sig(composer), focus: sig(focused) },
    vis: { dock: visible(dock), hint: visible(hint), band: visible(band) },
    dm: displayMode(),
    bars: document.documentElement.dataset.bars ?? "",
  };
}

/**
 * The trace, as one line per sample so a human can scroll it and a machine can
 * still parse it. `JSON.stringify` of the whole array would be one 200KB line;
 * pretty-printing it would be forty lines per sample.
 */
function serialise(samples: readonly Sample[], head: Record<string, unknown>): string {
  const lines = samples.map((s) => JSON.stringify(s));
  return `{"head":${JSON.stringify(head)},\n"samples":[\n${lines.join(",\n")}\n]}`;
}

/**
 * **`?probe=1`, or nothing at all.**
 *
 * The flag is read once with a lazy initialiser rather than through
 * `useQueryState`, so an ordinary reader pays for no address subscription and
 * no re-render; a diagnostic has no reason to react to the URL changing under
 * it. Everything else lives in the child, which is not mounted when the flag is
 * off — so there is nothing in the DOM and no listener anywhere.
 */
export function ViewportProbe({
  laidOutWidth,
}: {
  /** `useWindowWidth`'s answer — the width the reader actually laid out for. */
  laidOutWidth?: number;
}) {
  const [on] = useState(currentProbe);
  if (!on) return null;
  return <ProbePanel laidOutWidth={laidOutWidth ?? null} />;
}

function ProbePanel({ laidOutWidth }: { laidOutWidth: number | null }) {
  const spanA = useRef<HTMLSpanElement>(null);
  const spanB = useRef<HTMLSpanElement>(null);
  /* **The samples live in a ref and only the count is state.** iOS fires
     visual-viewport `scroll` continuously while the keyboard slides, and this
     panel is on screen at the time: re-rendering an array of six hundred
     objects on each of those frames would be the instrument changing what it is
     measuring. The count is one number, and the trace is built only when it is
     asked for. */
  const samples = useRef<Sample[]>([]);
  const since = useRef(0);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [said, setSaid] = useState("");

  const record = useCallback((ev: Sample["ev"]) => {
    if (full(samples.current.length)) return;
    /* One reading of the clock, used both to start it and to stamp the row, so
       the first sample is `t: 0` rather than however long a first `take()`
       happened to run for. A trace is read as an offset from the tap. */
    const now = performance.now();
    if (since.current === 0) since.current = now;
    samples.current.push(
      take(ev, now - since.current, spanA.current, spanB.current, laidOut.current),
    );
    setCount(samples.current.length);
  }, []);

  /* **The reader's width, through a ref**, so `record` can stay stable. A
     window event's row therefore carries the width *before* the reader has
     re-rendered for it, and the `laid-out` row below carries the width after —
     which is the pair a rotation trace needs. */
  const laidOut = useRef(laidOutWidth);

  useEffect(() => {
    /* One sample before anything moves, so every trace has a keyboard-closed
       row to compare the rest against. */
    record("start");
    /* **The window's events, installed whether or not there is a visual
       viewport** — a rotation is the window's news, and an early return for a
       missing `visualViewport` would drop it (Sol F4). */
    const onWindowResize = () => record("window-resize");
    const onOrientation = () => record("orientationchange");
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("orientationchange", onOrientation);
    const vv = window.visualViewport;
    const onResize = () => record("resize");
    const onScroll = () => record("scroll");
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("orientationchange", onOrientation);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onScroll);
    };
  }, [record]);

  /* A `laid-out` row each time the reader's stored width changes, after the
     render that used it. Compared with the last width seen rather than skipped
     on first run, so Strict Mode's second effect pass records nothing. */
  useEffect(() => {
    if (laidOut.current === laidOutWidth) return;
    laidOut.current = laidOutWidth;
    record("laid-out");
  }, [laidOutWidth, record]);

  const trace = useCallback(() => {
    const head = {
      probe: "spideryarn viewport probe",
      when: new Date().toISOString(),
      href: location.href,
      ua: navigator.userAgent,
      dm: displayMode(),
      standalone: (navigator as { standalone?: boolean }).standalone ?? null,
      dpr: window.devicePixelRatio,
      screen: [screen.width, screen.height],
      rootFont: getComputedStyle(document.documentElement).fontSize,
      raw: rawTokens(spanA.current),
      count: samples.current.length,
      cap: CAP,
      legend: {
        win: "innerWidth, innerHeight, scrollX, scrollY",
        vv: "visualViewport width, height, offsetTop, offsetLeft, scale",
        lay: "root clientWidth, reader width from useWindowWidth",
        rect: "x, y, width, height from getBoundingClientRect",
        vis: "gone = not rendered, off = rendered but not covering, on = on screen",
      },
    };
    return serialise(samples.current, head);
  }, []);

  const show = () => {
    setText(trace());
    setSaid("");
  };

  const copy = () => {
    const t = trace();
    setText(t);
    /* A button press is the user gesture iOS requires, so this is allowed to
       work — but a download is not (an installed web app has nowhere to put a
       file you can find again), which is why the textarea below is not a
       fallback so much as the other half of the same answer. */
    void navigator.clipboard
      ?.writeText(t)
      .then(() => setSaid("copied"))
      .catch(() => setSaid("copy refused — select the box"));
  };

  return (
    <div
      /* Inline styles rather than a stylesheet rule on purpose: this is an
         instrument, not part of the design system, and A10 is splitting
         styles.css in another worktree. Nothing here should land in a sheet
         somebody has to move later. */
      style={{
        position: "fixed",
        top: "calc(var(--bar-bottom, 0px) + 4px)",
        left: "calc(var(--safe-left, 0px) + 4px)",
        /* Above the drawer (95) and the tooltip anchor (100), because it must
           be reachable while whatever is being measured is open. */
        zIndex: 200,
        maxWidth: "calc(100vw - 8px)",
        font: "11px/1.35 ui-monospace, Menlo, monospace",
        color: "#fff",
        background: "rgba(0,0,0,0.82)",
        border: "1px solid #7a7",
        borderRadius: 4,
        padding: 3,
      }}
    >
      {/* The two lengths-in-disguise. Inside the panel, which is inside
          `.reader`, so both the `:root` tokens and the two `.reader` ones
          resolve here. */}
      <span ref={spanA} style={SPAN_A} aria-hidden="true" />
      <span ref={spanB} style={SPAN_B} aria-hidden="true" />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ font: "inherit", color: "inherit", background: "none", border: 0, padding: 2 }}
      >
        probe {count}
        {full(count) ? " FULL" : ""}
      </button>

      {open && (
        <div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "2px 0" }}>
            {/* A labelled sample he can take by hand, so a trace can say
                "this row is the keyboard closed" without anybody counting
                frames afterwards. */}
            <ProbeButton onClick={() => record("mark")} label="mark" />
            <ProbeButton onClick={show} label="show" />
            <ProbeButton onClick={copy} label="copy" />
            <ProbeButton
              onClick={() => {
                samples.current = [];
                since.current = 0;
                setCount(0);
                setText("");
                setSaid("");
              }}
              label="clear"
            />
          </div>
          <div>{said}</div>
          <textarea
            readOnly
            value={text}
            /* `onFocus` selecting everything is what makes "tap, then Copy" a
               one-handed gesture on a phone. */
            onFocus={(e) => e.currentTarget.select()}
            style={{
              display: "block",
              width: "min(78vw, 30rem)",
              height: "9rem",
              font: "10px/1.3 ui-monospace, Menlo, monospace",
            }}
          />
        </div>
      )}
    </div>
  );
}

function ProbeButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        font: "inherit",
        color: "#fff",
        background: "#333",
        border: "1px solid #777",
        borderRadius: 3,
        padding: "3px 7px",
      }}
    >
      {label}
    </button>
  );
}
