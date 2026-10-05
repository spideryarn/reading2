// @vitest-environment jsdom
/**
 * **A stage this copy of the app has never heard of is a row, not a crash.**
 *
 * The Metadata page draws one row per stage the server reports, with a glyph
 * looked up by the stage's name. The table is `Record<StepName, …>`, which the
 * compiler reads as "every name is there" — true of the names this bundle was
 * built with, and false of a name a newer server sends to an older copy. The
 * lookup came back `undefined`, React refused it as an element type, and the
 * whole app went to the `[render]` screen: `SPIDERYARN-READING2-BJ` and `-CB`,
 * on copies built before the `relations` stage existed, after the deploy that
 * added it. docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md.
 *
 * **Rendered inside a catching boundary**, because the failure is a throw
 * during render and the assertion is that there was none, with the row's label
 * on the page as the proof the row was reached. The known stage is the
 * control: without it, a harness that never drew a row at all would pass.
 */
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../src/types.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));
/* The same two stubs as tests/metadata-step-timing.test.tsx, for its reasons. */
vi.mock("nuqs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("nuqs")>()),
  useQueryState: () => [null, () => {}],
}));
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));

const { Metadata } = await import("../src/web/Metadata.js");

const SLUG = "temporal-context-reinstatement-spya-dhqkf9";

function article(): Article {
  return {
    meta: { slug: SLUG, title: "Temporal context reinstatement" },
    blocks: [
      {
        id: "spya-aaaaaa",
        tag: "p",
        kind: "text",
        text: "A paragraph.",
        words: 2,
        html: "<p>A paragraph.</p>",
        gistable: true,
      },
    ],
    assets: undefined,
    navLabelStatus: "ready",
    highPowerSince: null,
    titleOverridden: false,
    sourceGuess: undefined,
    tree: {
      version: "t",
      generator: "t",
      slug: SLUG,
      rootId: "n0",
      nodes: {
        n0: {
          id: "n0",
          depth: 0,
          parent: null,
          children: [],
          range: ["spya-aaaaaa", "spya-aaaaaa"],
          title: "Temporal context reinstatement",
        },
      },
    },
  } as Article;
}

class Catch extends Component<{ children: ReactNode }, { caught: string | null }> {
  override state = { caught: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { caught: err instanceof Error ? err.message : String(err) };
  }
  override render() {
    return this.state.caught === null
      ? this.props.children
      : createElement("p", { id: "caught" }, this.state.caught);
  }
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* React logs the caught error; the assertion below is what reports it. */
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pageWithStage(step: string): Promise<{ caught: string | null; text: string }> {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          slug: SLUG,
          dir: `spideryarn.article_revisions/${SLUG}`,
          stages: [
            {
              step,
              label: "Some stage",
              outputs: ["x/y.json"],
              done: true,
              ranAt: "2026-09-03T12:20:51.800Z",
              startedAt: null,
              bytes: null,
            },
          ],
          comments: 0,
          profile: null,
          purpose: null,
          archivedAt: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
  await act(async () => {
    root.render(
      createElement(
        Catch,
        null,
        createElement(Metadata, {
          slug: SLUG,
          article: article(),
          onRenamed: () => {},
          onVisibility: () => {},
        }),
      ),
    );
  });
  return {
    caught: host.querySelector("#caught")?.textContent ?? null,
    text: host.textContent ?? "",
  };
}

describe("a stage row on the Metadata page", () => {
  it("draws a stage this copy knows (the control)", async () => {
    const page = await pageWithStage("fetch");
    expect(page.caught).toBeNull();
    expect(page.text).toContain("Some stage");
  });

  it("draws a stage this copy has never heard of, rather than crashing the app", async () => {
    const page = await pageWithStage("a-stage-from-a-newer-server");
    expect(page.caught).toBeNull();
    expect(page.text).toContain("Some stage");
    expect(page.text).toContain("a-stage-from-a-newer-server");
  });
});
