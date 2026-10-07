/** Real Reader composition; passive leaves expose the props relevant to reach updates. */
import { type ComponentProps, createElement } from "react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { vi } from "vitest";
import type { Article, BlockId } from "../../src/types.js";
import type { ReaderCapability } from "../../src/web/reader-capability.js";

const readerReadingProbe = vi.hoisted(() => ({
  table: vi.fn(),
  spine: vi.fn(),
  gutter: vi.fn(),
}));
export { readerReadingProbe };

vi.mock("../../src/web/TableView.js", async () => {
  const { memo } = await import("react");
  return {
    TableView: memo((props: ComponentProps<typeof import("../../src/web/TableView.js").TableView>) => {
      readerReadingProbe.table(props);
      return null;
    }),
  };
});
vi.mock("../../src/web/Spine.js", async (original) => {
  const actual = await original<typeof import("../../src/web/Spine.js")>();
  return {
    ...actual,
    Spine: (props: ComponentProps<typeof actual.Spine>) => {
      readerReadingProbe.spine(props);
      return createElement(actual.Spine, props);
    },
  };
});
vi.mock("../../src/web/ReadingTimeStyle.js", async (original) => {
  const actual = await original<typeof import("../../src/web/ReadingTimeStyle.js")>();
  return {
    ...actual,
    ReadingTimeStyle: (props: ComponentProps<typeof actual.ReadingTimeStyle>) => {
      readerReadingProbe.gutter(props);
      return createElement(actual.ReadingTimeStyle, props);
    },
  };
});
vi.mock("../../src/web/useExperimental.js", () => ({ useExperimental: () => ({ on: true }) }));
vi.mock("../../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("../../src/web/Masthead.js", () => ({ Masthead: () => null }));
/* The component only: Reader also calls the Dock's mode activators and
   `visibleModes` for chat's `mode` chips (plan 261007j). */
vi.mock("../../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/Dock.js")>()),
  Dock: () => null,
}));
vi.mock("../../src/web/reader/measure.js", () => ({ useWindowWidth: () => 1600, useRootFontPx: () => 16 }));
vi.mock("../../src/web/marginalia/MarginaliaColumn.js", async (original) => {
  const actual = await original<typeof import("../../src/web/marginalia/MarginaliaColumn.js")>();
  return { ...actual, OwnerMarginFeed: () => null, MarginaliaHead: () => null, useMarginLayout: () => {} };
});

import { Reader } from "../../src/web/reader/Reader.js";

const noop = () => {};
const block = "spya-aaaaaa" as BlockId;
const emptyRead = { status: "none", stale: false };
export const readingHarnessArticle = {
  meta: { slug: "reading-harness", title: "Reading harness", source: "url" },
  blocks: [{ id: block, tag: "p", kind: "paragraph", text: "A paragraph.", words: 2, html: "<p>A paragraph.</p>", gistable: true, isStructural: true }],
  tree: { root: "root", nodes: [{ id: "root", parent: null, children: [], depth: 0, title: "Reading harness", gist: "A paragraph.", range: [block, block] }] },
  assets: undefined,
} as unknown as Article;

export function readingHarnessOwner(): Extract<ReaderCapability, { kind: "owner" }> {
  return {
    kind: "owner",
    comments: { comments: [], loaded: true, loadError: null, error: null, create: noop },
    chatAnchors: { summaries: [], add: noop, drop: noop },
    glossary: { ...emptyRead, glossary: null },
    quotes: { ...emptyRead, quotes: null },
    citations: { ...emptyRead, citations: null },
    quiz: { ...emptyRead, quiz: null },
    crossrefs: null,
    arc: { arc: null },
    structureArrival: null,
    readingTime: { levels: new Map([[block, 1]]), reach: new Map([[block, 4]]), status: "loaded", setCounting: noop, timeFor: () => null },
  } as unknown as Extract<ReaderCapability, { kind: "owner" }>;
}

export function readingHarnessView(capability: ReaderCapability, margin: boolean) {
  return (
    <NuqsTestingAdapter searchParams={margin ? "?margin=1&spine=1" : "?spine=1"} hasMemory>
      <Reader slug="reading-harness" article={readingHarnessArticle} capability={capability} />
    </NuqsTestingAdapter>
  );
}
