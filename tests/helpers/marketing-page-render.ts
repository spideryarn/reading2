/**
 * Mounting a marketing page in jsdom, shared by the tests that read what `/`
 * and `/features` claim (features-page-modes, landing-page-tiles,
 * marketing-public-sharing). The same recipe as tests/site-nav-sign-in.test.tsx
 * and tests/landing-sign-in-links.test.tsx: a stubbed `fetch` (PublicShowcase
 * asks for the public listing on mount), and React flushed a few turns.
 *
 * The caller still has to `vi.mock` the Supabase client before importing a
 * page, because a mock is hoisted per test file.
 */
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MODE_CATALOG } from "../../src/mode-catalog.js";
import { MODES, type Mode } from "../../src/modes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

export async function mount(page: ReactElement, address = "/"): Promise<HTMLElement> {
  history.replaceState(null, "", address);
  const div = document.createElement("div");
  document.body.append(div);
  const r = createRoot(div);
  host = div;
  root = r;
  await act(async () => {
    r.render(page);
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
  return div;
}

export function unmount(): void {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
  host = null;
  root = null;
}

/** One element a page drew for a mode: the title it shows, and its tag. */
export interface ModeMention {
  mode: string;
  title: string;
  tagged: boolean;
}

/**
 * The elements carrying `data-mode`, each read for its visible title (the
 * heading of a Tile or Showcase, the bold lead of a Portrait) and for whether
 * the Experimental tag is inside it.
 */
export function modeMentions(page: HTMLElement): ModeMention[] {
  return [...page.querySelectorAll<HTMLElement>("[data-mode]")].map((el) => {
    const heading = el.querySelector("h2, h3, figcaption > strong");
    return {
      mode: el.dataset.mode ?? "",
      title: heading?.textContent?.trim() ?? "",
      tagged: el.querySelector(".site-experimental") !== null,
    };
  });
}

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

export function experimental(mode: Mode): boolean {
  return MODE_CATALOG[mode].experimental;
}
