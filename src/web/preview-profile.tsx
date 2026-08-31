/**
 * A throwaway page for checking the profile panel in a real browser.
 *
 * It mounts the **real** `UseProfile` and `WrittenForYou` — and so the real
 * `ProfilePanel`, the real Floating UI wiring and the real stylesheet — in the
 * containers they actually ship in, at both band widths, outside the auth gate
 * and with no session.
 *
 * `fetch` is stubbed for `/api/reader` only, because `apiFetch` would otherwise
 * need a session and the panel would render its "couldn't read this" state on
 * every card. Every other line of the path is the shipping one.
 *
 * **What this page exists to prove**, and what no unit test here can: that the
 * two `Edit →` links inside the panel can actually be clicked. jsdom has no
 * layout and reports any link as reachable, which is exactly how the tooltip
 * version of this shipped with a dead link. The probe is
 * `document.elementFromPoint` at each link's own centre —
 * see docs/plans/260830c-profile-panel.md § Tests.
 *
 * **Kept rather than deleted**, unlike most preview pages here: the gate above
 * is not a one-off, it is the only check that can see the thing this component
 * exists for, and a gate whose fixture has been deleted is a gate nobody can
 * re-run. `?state=` poses the four cases — `full`, `empty`, `failed` (the whole
 * request falls over) and `halfdown` (a 200 whose shelf half did). Nothing in
 * the app links here and it is not in the router.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MODE_IDEAL, MODE_MIN } from "./layout.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import "./styles.css";
import "./tailwind.css";

const SLUG = "preview-article";

/** What the server would say. The long one is deliberately long — a profile at
 *  most of its 1,500-character cap is the case the panel's height has to hold. */
const FIXTURE: Record<string, { profile: string | null; purpose: string | null }> = {
  full: {
    profile:
      "Cognitive scientist, twenty years, mostly memory and learning. Rusty on transformer internals — I can read the maths but not quickly, and I have never trained anything larger than a toy. Not interested in the history of the field or in who said what first; I want the mechanism and the evidence for it. Assume I know what a gradient is.",
    purpose: "I want the evidence, not the history.",
  },
  empty: { profile: null, purpose: null },
  /* A 200 whose shelf half fell over — the state that used to render as
     "you never wrote this". src/routes.ts § resolveProfileParts. */
  halfdown: { profile: "Cognitive scientist, twenty years.", purpose: null },
};

/* Chosen by `?state=`, so the same page serves the written case, the
   never-written case and the read-failure case without a rebuild. */
const STATE = new URLSearchParams(location.search).get("state") ?? "full";

const real = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/api/reader")) return real(input as RequestInfo, init);
  if (STATE === "failed") return Promise.resolve(new Response("nope", { status: 500 }));
  const body = FIXTURE[STATE] ?? FIXTURE.full;
  return Promise.resolve(
    new Response(
      JSON.stringify({
        ...body,
        purposeFailed: STATE === "halfdown",
        hasProfile: body!.profile != null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    ),
  );
}) as typeof window.fetch;

function Band({ width, label }: { width: number; label: string }) {
  const [a, setA] = useState(true);
  const [b, setB] = useState(true);
  const [c, setC] = useState(true);
  return (
    <div className="pv-col" style={{ width, flex: `0 0 ${width}px` }}>
      <h2>
        {label} — {width}px
      </h2>

      <div className="pv-row">
        <p className="pv-title">glossary, empty state (.gloss-run)</p>
        <div className="gloss-empty">
          <p>Nobody has found the terms for this one yet.</p>
          <div className="gloss-run">
            <UseProfile checked={a} onChange={setA} hasProfile slug={SLUG} />
            <button type="button" className="gloss-btn">
              Find the terms
            </button>
          </div>
        </div>
      </div>

      <div className="pv-row">
        <p className="pv-title">glossary foot (.gloss-actions)</p>
        <div className="gloss-actions">
          <UseProfile checked={b} onChange={setB} hasProfile slug={SLUG} />
          <button type="button" className="gloss-btn">
            Find more
          </button>
          <button type="button" className="gloss-btn">
            Start again
          </button>
        </div>
      </div>

      <div className="pv-row">
        {/* The state the panel most has to work in: no profile, so no checkbox
            — and the button is the only way the reader finds out what any of
            this means. */}
        <p className="pv-title">no profile yet — checkbox gone, button stays</p>
        <div className="gloss-run">
          <UseProfile checked={c} onChange={setC} hasProfile={false} slug={SLUG} />
          <button type="button" className="gloss-btn">
            Find the terms
          </button>
        </div>
      </div>

      <div className="pv-row">
        <p className="pv-title">the badge (.prof-badge)</p>
        <WrittenForYou written changed={false} slug={SLUG} />{" "}
        <WrittenForYou written changed slug={SLUG} />
      </div>
    </div>
  );
}

const CSS = `
.pv-page { display: flex; gap: 2rem; padding: 1.5rem; align-items: flex-start; }
.pv-col h2 { font-family: var(--font-ui); font-size: 0.85rem; color: var(--ink); margin: 0 0 1rem; }
.pv-row { margin-bottom: 2.5rem; border: 1px dashed var(--rule); border-radius: 6px; padding: 0.5rem; }
.pv-title { font-family: var(--font-ui); font-size: 0.6rem; color: var(--ink-faint); margin: 0 0 0.5rem; letter-spacing: 0.04em; text-transform: uppercase; }
`;

createRoot(document.getElementById("root")!).render(
  <div className="pv-page">
    <style>{CSS}</style>
    <Band width={MODE_IDEAL} label="the band at its best" />
    <Band width={MODE_MIN} label="and at its narrowest" />
  </div>,
);
