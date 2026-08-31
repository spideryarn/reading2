/**
 * A throwaway page for looking at the Timeline panel in a browser.
 *
 * It mounts the **real** `TimelinePanel` with the real stylesheet and the real
 * `useTimeline`, outside the auth gate, because `/api/timeline/:slug` needs a
 * session and a browser agent has none. `fetch` is stubbed to serve one of five
 * fixtures per slug, so the hook, the panel and `resolveTimelineEvent` are all
 * the shipping code.
 *
 * ## The five states, and why they cannot all come from one fixture
 *
 * The fixture is the real artefact off `data/openai-huggingface/`, with every
 * quoted passage cut to about 170 characters — the panel only ever renders a
 * snippet, `data/` is gitignored on purpose because it holds real people's
 * articles, and a preview page does not need a blog post committed into `src/`
 * to prove a column wraps. The four other states are derived from it below.
 *
 * It covers three of the four `dating` kinds and neither of the two empty
 * states:
 *
 *  - **real** — 18 dated, 7 `words`, 1 `untimed`, and the prediction/hypothetical
 *    groups at the bottom.
 *  - **frameless** — the same article as it would come out with **no
 *    publication date**, which is every article ingested before 2026-08-31.
 *    Every year-less date becomes `rejected: noYearFrame`; the one expression
 *    that carries its own year (`2026-07-19`) still parses. Plus one
 *    `phraseNotInOccurrence`, one `unparseablePhrase`, and one `noYearFrame`
 *    whose phrase could not be located at all, so the `phrase: null` branch is
 *    on screen rather than only in the type. **`rejected` cannot occur on an
 *    article that has a publication date**, so without this fixture the state
 *    the review insisted on would never have been looked at.
 *  - **thin** — two events, under `A_CHRONOLOGY`, so the panel withdraws the
 *    claim to be a timeline while still showing the rows.
 *  - **empty** — nobody ran it. The 404 path and the button.
 *  - **none** — zero events after a run. The commonest real outcome of the
 *    whole mode, and the least likely to be looked at.
 *
 * ## Two traps this page is shaped by, both already paid for
 *
 * 1. The wrapper is `.reader.spine-on` **and** carries the custom properties
 *    `App.tsx` normally sets on it. `.mode-band` is `position: fixed` with
 *    `width: var(--mode-w)`, so without the tokens it resolves against nothing
 *    and the band renders about three times too wide. The band is also forced
 *    `position: static` here so five of them can sit side by side.
 * 2. `height` is set explicitly and deliberately short — a fixed band gets its
 *    height from the viewport, and the bug worth catching is the scroller
 *    missing, which only shows when the content is taller than the band.
 *
 * Delete this file, preview-timeline.html and preview-timeline-fixture.json
 * when the check is done; nothing links to any of them.
 */
import { createRoot } from "react-dom/client";
import { useMemo, useState, type CSSProperties } from "react";
import { TimelinePanel } from "./TimelinePanel.js";
import { useTimeline } from "./useTimeline.js";
import { orderFound, resolveTimelineEvent } from "./search-hits.js";
import { MODE_IDEAL, MODE_MIN } from "./layout.js";
import type { Block, BlockId, Dating, Timeline } from "../types.js";
import fixture from "./preview-timeline-fixture.json";
import "./styles.css";
import "./tailwind.css";

const FIXTURE = fixture as unknown as {
  blocks: { id: string; html: string }[];
  timeline: Timeline;
};

/** Only `id` and `html` are read — `page()` in search-hits.ts renders the html. */
const BLOCKS = FIXTURE.blocks as unknown as Block[];

/**
 * **The frameless variant, derived rather than stored** — the same article as it
 * would come out with no publication date, which is every article ingested
 * before 2026-08-31.
 *
 * Derived here rather than committed as a second fixture for two reasons. It
 * keeps one copy of the article's words in the repo instead of three; and the
 * derivation *is* the claim being demonstrated — with no frame to take a year
 * from, every year-less date refuses with `noYearFrame`, and the one expression
 * on this article that carries its own year (`2026-07-19`) still parses. Three
 * rows are then overwritten by hand, because the other two refusals and the
 * `phrase: null` case cannot arise from that rule and would otherwise never be
 * looked at.
 */
function frameless(timeline: Timeline): Timeline {
  const events = timeline.events.map((e) =>
    e.dating.kind === "dated" && e.dating.when.yearFilled
      ? { ...e, dating: { kind: "rejected", reason: "noYearFrame", phrase: e.dating.when.phrase } as Dating }
      : e,
  );
  const set = (i: number, dating: Dating) => {
    const one = events[i];
    if (one) events[i] = { ...one, dating };
  };
  set(2, { kind: "rejected", reason: "phraseNotInOccurrence", phrase: "on May 26" });
  set(4, { kind: "rejected", reason: "unparseablePhrase", phrase: "by 06/12/19" });
  /* The `phrase: null` branch — we could not even locate the words. Required
     nullable rather than optional precisely so this case cannot be forgotten,
     which makes it worth having on screen. */
  set(8, { kind: "rejected", reason: "noYearFrame", phrase: null });
  return { ...timeline, slug: "frameless", events };
}

const BY_SLUG: Record<string, Timeline | null> = {
  real: FIXTURE.timeline,
  frameless: frameless(FIXTURE.timeline),
  thin: { ...FIXTURE.timeline, slug: "thin", events: FIXTURE.timeline.events.slice(0, 2) },
  none: { ...FIXTURE.timeline, slug: "none", events: [] },
  /* 404 — nobody has run it. `null` rather than an absent key so the stub below
     is a lookup rather than a fall-through. */
  empty: null,
};

const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const match = /\/api\/timeline\/([^?]+)/.exec(url);
  if (match) {
    const found = BY_SLUG[decodeURIComponent(match[1]!)];
    if (!found) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ timeline: found, stale: false, outdated: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  /* `useStepJob` polls this; an empty list keeps every panel out of its "a job
     is running" branch. */
  if (url.includes("/api/jobs")) {
    return new Response(JSON.stringify({ jobs: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return real(input, init);
}) as typeof window.fetch;

/**
 * One band, at one width, with its own selection.
 *
 * `?event=` is deliberately *not* wired to the URL here — five panels on one
 * page would fight over one parameter. Selection is local state and everything
 * downstream of it is the real code: `resolveTimelineEvent` against the
 * synthesised blocks, ordered by `orderFound` exactly as `TimelineBand` does.
 */
function Band({ slug, width, label }: { slug: string; width: number; label: string }) {
  const timeline = useTimeline(slug);
  const [eventId, setEventId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const found = useMemo(() => {
    const selected = timeline.timeline?.events.find((e) => e.id === eventId) ?? null;
    if (!selected) return [];
    return orderFound(
      resolveTimelineEvent(BLOCKS, { id: selected.id, occurrences: selected.occurrences }),
      "document",
    );
  }, [timeline.timeline, eventId]);

  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "0.7rem",
          color: "var(--ink-faint)",
          margin: "0 0 0.3rem",
        }}
      >
        {label} — {width}px
      </p>
      <div
        className="reader spine-on"
        style={
          {
            "--mode-w": `${width}px`,
            "--bar-bottom": "0px",
            "--dock-bottom": "0px",
            "--safe-bottom": "0px",
            "--safe-left": "0px",
            "--hint-h": "0px",
            /* `.reader` reserves the band's width as padding, because the real
               band is fixed and sits over the top of it. Nothing is being
               overlaid here, so the padding is only wasted width. */
            padding: 0,
            minWidth: 0,
            width,
            height: 620,
          } as CSSProperties
        }
      >
        <div style={{ position: "relative", width, height: 620 }}>
          <TimelinePanel
            owner={timeline}
            eventId={eventId}
            onEvent={(next) => {
              setEventId(next);
              setOpenKey(null);
            }}
            found={found}
            openKey={openKey}
            onOpenKey={setOpenKey}
            onJump={(id: BlockId) => console.log("jump", id)}
          />
        </div>
      </div>
    </div>
  );
}

function Page() {
  return (
    <div style={{ display: "flex", gap: "1.4rem", padding: "1.2rem", alignItems: "flex-start" }}>
      <Band slug="real" width={MODE_IDEAL} label="the real artefact" />
      <Band slug="real" width={MODE_MIN} label="the real artefact, narrowest band" />
      <Band slug="frameless" width={MODE_IDEAL} label="no publication date — every date rejects" />
      <Band slug="thin" width={MODE_IDEAL} label="two events" />
      <Band slug="none" width={MODE_IDEAL} label="ran, found no chronology" />
      <Band slug="empty" width={MODE_IDEAL} label="nobody has run it" />
    </div>
  );
}

/* The band is `position: fixed` in the real app. Here it is pinned inside its
   own wrapper instead, so six of them sit side by side and each one's scroller
   is exercised against a short height. */
const style = document.createElement("style");
style.textContent = `.mode-band { position: absolute; top: 0; left: 0; height: 100%; }`;
document.head.append(style);

createRoot(document.getElementById("root")!).render(<Page />);
