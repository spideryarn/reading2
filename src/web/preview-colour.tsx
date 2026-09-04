/**
 * A throwaway page for checking the search row's colour picker in a browser.
 *
 * It mounts the real `SearchPanel` with fixture runs, so the picker, the row
 * hues and `assignSlots` are the ones that ship — and it does it outside the
 * auth gate and without an article, a session or a model call. Delete when
 * the check is done; it is not in the router and nothing links to it.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchPanel } from "./SearchPanel.js";
import { assignSlots } from "./hit-colours.js";
import { MODE_MIN, SPINE_W } from "./layout.js";
import type { SavedSearch } from "./useSearch.js";
import "./tailwind.css";

const FIXTURE: SavedSearch[] = [
  "arguments against substrate independence",
  "anywhere he gives numbers",
  "places the author hedges",
].map((criterion, i) => ({
  id: `spya-aaaa${"bcd"[i]}${i}`,
  criterion,
  createdAt: `2026-08-2${i}T00:00:00.000Z`,
  status: "done" as const,
  hits: [],
  stale: false,
}));

function Preview() {
  const [runs, setRuns] = useState<SavedSearch[]>(FIXTURE);
  const [active, setActive] = useState<string[]>([FIXTURE[0]!.id]);
  const slots = assignSlots(runs);
  return (
    /* **`.reader`, and the two custom properties App sets at runtime.** Not
       decoration: `SearchPanel` renders `.mode-band`, which is
       `position: fixed; left: var(--spine-w); width: var(--mode-w)`, and both
       of those are declared on `.reader` alone (styles.css § .reader). A plain
       `<div style={{width: 288}}>` therefore leaves them unset, `width`
       resolves to `auto`, and the band shrink-wraps to its content — measured
       at 824–930px in a browser pass, which is three times the real band and
       makes every placement check meaningless. Found the hard way, 2026-08-27.

       `MODE_MIN` rather than a literal 288, so this stays the narrowest real
       band on the day that number moves. */
    <div
      className="reader spine-on"
      style={
        {
          height: "100vh",
          background: "var(--page)",
          "--mode-w": `${MODE_MIN}px`,
          /* The band is `top: var(--bar-bottom); bottom: max(var(--dock-bottom),
             …)`, and none of it exists here — there is no controls bar and no
             dock on this page. An unset length is not zero, it is invalid, so
             the band would have no top or bottom at all.

             All four, because the two derived tokens are computed at `:root`
             from the values there and would go on carrying the real bar's
             height however many times the base ones are overridden here. */
          "--bar-h": "0px",
          "--bar-bottom": "0px",
          "--dock-h": "0px",
          "--dock-space": "0px",
          "--dock-bottom": "0px",
        } as React.CSSProperties
      }
    >
      <div>
        <SearchPanel
          matcher="meaning"
          onMatcher={() => {}}
          find={null}
          onFind={() => {}}
          runs={runs}
          loaded
          loadFailed={false}
          active={active}
          slots={slots}
          onToggle={(id, on) => setActive((a) => (on ? [...a, id] : a.filter((x) => x !== id)))}
          onSolo={(id) => setActive([id])}
          onToggleAll={(on) => setActive(on ? runs.map((r) => r.id) : [])}
          onAsk={() => {}}
          onRetry={() => {}}
          onRecolour={(id, colour) => {
            // eslint-disable-next-line no-console
            console.log("[preview] recolour", id, colour);
            setRuns((prev) =>
              prev.map((r) => {
                if (r.id !== id) return r;
                const { colour: _was, ...rest } = r;
                return colour === null ? rest : { ...rest, colour };
              }),
            );
          }}
          onDelete={() => {}}
          found={[]}
          all={[]}
          order="document"
          onOrder={() => {}}
          gate={0}
          gateMoved={false}
          onGate={() => {}}
          openKey={null}
          onOpen={() => {}}
          error={null}
        />
      </div>
      {/* Clear of the fixed band, so the state dump is readable beside it
          rather than underneath it. */}
      <pre
        id="state"
        style={{
          /* `SPINE_W` rather than the literal 24 it was, for the same reason
             the line above uses `MODE_MIN`: this page is meant to show the real
             geometry, and halving the rail on 2026-08-28 would otherwise have
             left the dump 12px out of position with nothing saying why. */
          marginLeft: `${MODE_MIN + SPINE_W}px`,
          color: "#bbb",
          padding: "1rem",
          fontSize: 12,
        }}
      >
        {JSON.stringify(
          runs.map((r) => ({ id: r.id, colour: r.colour ?? null, slot: slots.get(r.id) })),
          null,
          2,
        )}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Preview />);
