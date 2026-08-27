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
import type { SavedSearch } from "./useSearch.js";
import "./styles.css";
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
    <div style={{ display: "flex", height: "100vh", background: "var(--page)" }}>
      <div style={{ width: 288, display: "flex" }}>
        <SearchPanel
          matcher="meaning"
          onMatcher={() => {}}
          find={null}
          onFind={() => {}}
          runs={runs}
          loaded
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
      <pre id="state" style={{ color: "#bbb", padding: "1rem", fontSize: 12 }}>
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
