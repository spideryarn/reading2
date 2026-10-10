// @vitest-environment jsdom
/**
 * **Every mode's "older version of the article" notice has an × that works** —
 * one row per mode in `STALE_NOTICE_MODES`, each mounting the real panel (or
 * the smallest real component that draws that mode's banner) in a stale
 * owner's state, pressing the ×, and reading what was sent.
 * docs/plans/261010a-dismiss-older-version-notices.md (Greg, 2026-10-09,
 * `spya-mutgym`): *"in each case make sure there is a way for me to dismiss
 * them if I don't want to rerun it."*
 *
 * Each row asserts three things:
 *
 * 1. exactly one `[data-stale-notice="<mode>"]` is on screen, with a
 *    `.notice-close` — so a mode whose banner went back to hand-written markup,
 *    or that draws two, fails;
 * 2. pressing it removes the banner at once;
 * 3. the one POST to `/api/stale-notices/<slug>` is `{ mode, identities: [x] }`
 *    with `x` the identity **written out in the row**, not read back from the
 *    panel — every fixture has its own clock, so a panel that passed another
 *    artefact's clock, the wrong field, or nothing would fail here.
 *
 * The table is typed `Record<StaleNoticeMode, Row>` and its keys are also
 * checked against `STALE_NOTICE_MODES` at run time, so a mode added to the list
 * without a row here fails both the typecheck and the suite.
 *
 * The harness — the session and Supabase mocks, the dynamic imports, the
 * owners — is copied from tests/mode-surface-changes-no-markup.test.tsx and the
 * per-panel tests named at each row, cut to the minimum each banner needs.
 */
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checksOwner, claimListOf, claimListOwner } from "./helpers/sources-claims-owner.js";
import { noticeIdentity, STALE_NOTICE_MODES, type StaleNoticeMode } from "../src/stale-notice.js";

import type { Claim } from "../src/referee-claims.js";
import type { PublicSketch } from "../src/public-types.js";
import type {
  Article,
  Bibliography,
  Block,
  BlockId,
  Reception,
  ReceptionCounts,
  Faq,
  Glossary,
  Ideas,
  Quotes,
  SimpleSummary,
  Skim,
  Timeline,
  TweetThread,
} from "../src/types.js";
import type { ReceptionOwner } from "../src/web/ReceptionAndClaimsPanel.js";
import type { GlossaryOwner } from "../src/web/GlossaryPanel.js";
import type { IdeasOwner } from "../src/web/IdeasPanel.js";
import type { QuotesOwner } from "../src/web/QuotesPanel.js";
import type { TimelineOwner } from "../src/web/TimelinePanel.js";
import type { SkimView } from "../src/web/modes/skim/SkimMode.js";
import type { UseBibliography } from "../src/web/useBibliography.js";
import type { ClaimsApi } from "../src/web/useClaims.js";
import type { UseSourcesClaims } from "../src/web/useSourcesClaims.js";
import type { UseFaq } from "../src/web/useFaq.js";
import type { SavedSearch } from "../src/web/useSearch.js";
import type { UseSimple } from "../src/web/useSimple.js";
import type { UseSkim } from "../src/web/useSkim.js";
import type { UseTweets } from "../src/web/useTweets.js";

/* ------------------------------------------------------------ the mocks --
   As tests/mode-surface-changes-no-markup.test.tsx has them, and for its
   reason: `src/web/lib/api.ts` reaches Supabase at module scope. */

const OWNER = { id: "owner-1", email: "owner@example.com" };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: OWNER, loading: false, known: true }),
}));

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

/* Dynamic, so the mocks above are in place first — see the note in
   tests/mode-surface-changes-no-markup.test.tsx § "Every import of the client
   is dynamic". */
const { forgetStaleNotices } = await import("../src/web/useStaleNotices.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { resetActivations } = await import("../src/web/activation.js");
const { sourcesHead } = await import("./helpers/sources-head.js");
const { assignSlots } = await import("../src/web/hit-colours.js");
const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");
const { IdeasPanel } = await import("../src/web/IdeasPanel.js");
const { FaqPanel } = await import("../src/web/FaqPanel.js");
const { TimelinePanel } = await import("../src/web/TimelinePanel.js");
const { SimplePanel } = await import("../src/web/SimplePanel.js");
const { BibliographyPanel } = await import("../src/web/BibliographyPanel.js");
const { TweetsPanel } = await import("../src/web/Tweets.js");
const { ReceptionAndClaimsPanel } = await import("../src/web/ReceptionAndClaimsPanel.js");
const { QuotesPanel } = await import("../src/web/QuotesPanel.js");
const { SkimPanel } = await import("../src/web/SkimPanel.js");
const { SearchPanel } = await import("../src/web/SearchPanel.js");
const { SketchView } = await import("../src/web/SketchView.js");
const { IllustratedView } = await import("../src/web/IllustratedView.js");
const { ClaimsView } = await import("../src/web/ClaimsPanel.js");

/* ----------------------------------------------------------- the article -- */

const SLUG = "a-piece";
const PARAGRAPH =
  "The instrument was built before anybody could say what it would measure, and the theory followed it.";
const QUOTE_LINE = "before anybody could say what it would measure";

const BLOCKS: Block[] = [
  {
    id: "spya-aaaaaa" as BlockId,
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb" as BlockId,
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 17,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
];

const ARTICLE: Article = {
  highPowerSince: null,
  titleOverridden: false,
  blocks: BLOCKS,
  tree: {
    version: "test",
    generator: "test",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa" as BlockId, "spya-bbbbbb" as BlockId],
        title: "A piece",
        gist: "The piece says the instruments came first.",
      },
    },
  },
  assets: undefined,
  navLabelStatus: "ready",
  sourceGuess: undefined,
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

/**
 * **Each artefact's own clock**, all different, so a panel handing the hook
 * another mode's clock — or the right artefact's wrong field — posts a value
 * its row does not expect.
 */
const AT = {
  glossary: "2026-09-01T01:00:00.000Z",
  ideas: "2026-09-01T02:00:00.000Z",
  faq: "2026-09-01T03:00:00.000Z",
  timeline: "2026-09-01T04:00:00.000Z",
  simple: "2026-09-01T05:00:00.000Z",
  bibliography: "2026-09-01T06:00:00.000Z",
  tweets: "2026-09-01T07:00:00.000Z",
  reception: "2026-09-01T08:00:00.000Z",
  sourcesClaims: "2026-09-01T09:00:00.000Z",
  quotes: "2026-09-01T10:00:00.000Z",
  skim: "2026-09-01T11:00:00.000Z",
  searchCreated: "2026-09-01T12:00:00.000Z",
  searchFinished: "2026-09-01T12:30:00.000Z",
  claims: "2026-09-01T13:00:00.000Z",
} as const;

const SEARCH_RUN_ID = "spya-srch23";

/* ------------------------------------------------------------ the network --
   Every request is written down. The stale-notice route answers the way the
   server does: nothing dismissed, and a 204 for a dismissal. The two modes
   that read their own artefact (Sketch, Illustrated) are served a stale one. */

interface Sent {
  method: string;
  url: string;
  body: unknown;
}
const sent: Sent[] = [];

const SKETCH: PublicSketch & { generatedAt: string } = {
  generatedAt: "2026-09-01T14:00:00.000Z",
  title: "One instrument, one claim",
  caption: "The measurement is doing the arguing.",
  scenes: [
    {
      id: "s0",
      title: "Overview",
      height: 200,
      items: [
        {
          kind: "node",
          id: "n1",
          shape: "box",
          x: 10,
          y: 10,
          w: 140,
          h: 40,
          text: "The calibrated rig",
          size: "md",
          block: "spya-bbbbbb" as BlockId,
        },
      ],
    },
  ],
};

/** One painted plate — tests/illustrated-view.test.tsx's, cut to what `readStoredIllustrated` keeps. */
const ILLUSTRATED = {
  version: "illustrated/1",
  generatedAt: "2026-09-01T15:00:00.000Z",
  generator: "a-model",
  illustrator: "openai/gpt-image-2",
  style: "An illuminated manuscript page.",
  profileHash: null,
  plates: [
    {
      sceneId: "overview",
      title: "The whole argument",
      prompt: "A vellum page in gouache and gold leaf.",
      vignettes: [],
      image: { sha256: "a".repeat(64), ext: "jpeg", bytes: 73_000, width: 1024, height: 1536 },
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function serve(url: string, method: string): Response {
  if (url.startsWith("/api/stale-notices/")) {
    return method === "POST" ? new Response(null, { status: 204 }) : json({ dismissed: {} });
  }
  if (method !== "GET") return new Response(null, { status: 204 });
  if (/\/api\/illustrated\/[^/]+\/[0-9a-f]{64}\.jpeg$/.test(url)) {
    return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  }
  if (url.startsWith("/api/illustrated/")) {
    return json({ illustrated: ILLUSTRATED, stale: true, outdated: false, profileChanged: false });
  }
  if (url.startsWith("/api/sketch/")) {
    return json({ sketch: SKETCH, stale: true, outdated: false, profileChanged: false });
  }
  if (url.includes("/advance")) return json({ job: null, ran: null, busy: false, done: true });
  if (url.startsWith("/api/jobs")) return json({ jobs: [] });
  return json({});
}

/* ------------------------------------------------------------- the owners --
   The quiet state — nothing running, nothing failed — with `stale: true`, as
   each per-panel test builds it. */

const noop = () => {};

const COMMON = {
  stale: true,
  outdated: false,
  slug: SLUG,
  error: null,
  retryRead: async () => {},
  job: null,
  failed: null,
  stalled: false,
  starting: false,
  rewriting: false,
  refresh: async () => {},
  cancel: noop,
} as const;

const GLOSSARY: Glossary = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  entries: [
    {
      id: "spya-term23",
      name: "Kolmogorov depth",
      kind: "concept",
      aliases: [],
      senseHere: "How much work it took to build the thing.",
      blocks: ["spya-bbbbbb" as BlockId],
    },
  ],
  passes: 1,
  generatedAt: AT.glossary,
  elapsedMs: 1,
};

function glossaryOwner(): GlossaryOwner {
  return {
    ...COMMON,
    status: "ready",
    glossary: GLOSSARY,
    profiled: false,
    profileChanged: false,
    loaded: true,
    find: async () => {},
    more: async () => {},
    look: async () => false,
    setHidden: async () => {},
    hiding: new Set<string>(),
    looking: null,
    lookFailed: null,
    lookDraft: null,
    lookKept: null,
    ask: async () => {},
    asking: false,
    askDraft: null,
    asked: null,
    askFailed: null,
    askTerm: null,
    clearAsked: noop,
  };
}

const IDEAS: Ideas = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  ideas: [
    {
      id: "spya-kdea34",
      name: "Instruments outrun explanation",
      provenance: "assumed",
      statement: "You cannot theorise about what you have no way to measure.",
      occurrences: [{ blockId: "spya-bbbbbb" as BlockId, quote: "The instrument was built", reasoning: "It rests on it." }],
    },
  ],
  generatedAt: AT.ideas,
  elapsedMs: 1,
};

function ideasOwner(): IdeasOwner {
  return {
    ...COMMON,
    status: "ready",
    ideas: IDEAS,
    profiled: false,
    profileChanged: false,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

const FAQ: Faq = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  questions: [
    {
      id: "faq-built",
      question: "Why was the instrument built first?",
      passages: [{ blockId: "spya-bbbbbb" as BlockId, quote: "The instrument was built", start: 0 }],
    },
  ],
  dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, unanchored: 0, overCap: 0, malformed: 0 },
  generatedAt: AT.faq,
  elapsedMs: 1,
};

function faqOwner(): UseFaq {
  return {
    ...COMMON,
    status: "ready",
    faq: FAQ,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

const TIMELINE: Timeline = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  events: [1, 2, 3].map((n) => ({
    id: `spya-evt23${n}`,
    label: `The Vienna calibration, part ${n}`,
    dating: { kind: "words" as const, phrase: "before the theory" },
    order: n,
    modality: "happened" as const,
    occurrences: [{ blockId: "spya-bbbbbb" as BlockId, quote: "The instrument was built", start: 0 }],
  })),
  orderConflicts: 0,
  generatedAt: AT.timeline,
  elapsedMs: 1,
};

function timelineOwner(): TimelineOwner {
  return {
    ...COMMON,
    status: "ready",
    timeline: TIMELINE,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

const SIMPLE: SimpleSummary = {
  version: "simple/2",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  generatedAt: AT.simple,
  elapsedMs: 1,
  profileHash: null,
  levels: {
    brief: [{ text: "The piece says the instrument came before the theory.", ids: ["spya-bbbbbb" as BlockId] }],
    fuller: [{ text: "The instrument was built first, and the theory followed.", ids: ["spya-bbbbbb" as BlockId] }],
  },
};

function simpleOwner(): UseSimple {
  return {
    ...COMMON,
    status: "ready",
    simple: SIMPLE,
    profiled: false,
    profileChanged: false,
    preview: null,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

const BIBLIOGRAPHY: Bibliography = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  citations: [],
  capped: false,
  generatedAt: AT.bibliography,
  elapsedMs: 1,
};

function bibliographyOwner(): UseBibliography {
  return {
    ...COMMON,
    status: "ready",
    bibliography: BIBLIOGRAPHY,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    findNote: null,
    investigating: null,
    investigateStage: null,
    investigateDraft: null,
    investigateFailed: null,
    investigate: async () => {},
  };
}

const TWEET_THREAD: TweetThread = {
  version: "tweets/5",
  generator: "test-model",
  slug: SLUG,
  sourceHash: "hash",
  limit: 280,
  tweets: [{ text: "First post.", chars: 11, blocks: ["spya-bbbbbb" as BlockId] }],
  generatedAt: AT.tweets,
  elapsedMs: 4000,
};

function tweetsOwner(): UseTweets {
  return {
    status: "ready",
    thread: TWEET_THREAD,
    stale: true,
    profileChanged: false,
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    rewriting: false,
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    refresh: async () => {},
    cancel: noop,
  };
}

const COUNTS: ReceptionCounts = {
  returnedSources: 1,
  reportedRows: 1,
  keptRows: 1,
  omittedOverCap: 0,
  lost: {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
  },
  webSearches: 1,
};

const RECEPTION: Reception = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  searchedAt: AT.reception,
  direct: {
    rows: [
      {
        id: "spya-dbt234",
        url: "https://example.org/leiden",
        title: "The Leiden replication",
        sourceQuote: "We could not reproduce the calibration.",
        relation: "disputes",
        lean: "leans-against",
        applies: "A replication in Leiden reached the opposite reading.",
        articleReferenceQuote: "The instrument was built",
        identifies: [{ kind: "named", by: "title", witness: "The instrument was built" }],
      },
    ],
    counts: COUNTS,
  },
  claims: { rows: [], counts: { ...COUNTS, returnedSources: 0, reportedRows: 0, keptRows: 0 } },
  elapsedMs: 1,
};

function receptionOwner(stale: boolean): ReceptionOwner {
  return {
    ...COMMON,
    stale,
    status: "ready",
    reception: RECEPTION,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

/** Debate's Claims list, stale, with its own clock — `claimListOf` stamps a fixed one. */
function staleClaimList(): UseSourcesClaims {
  return claimListOwner({
    status: "ready",
    stale: true,
    slug: SLUG,
    claimList: { ...claimListOf([]), slug: SLUG, generatedAt: AT.sourcesClaims },
  });
}

const QUOTES: Quotes = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  quotes: [
    {
      id: "spya-qte234",
      blockId: "spya-bbbbbb" as BlockId,
      text: QUOTE_LINE,
      start: PARAGRAPH.indexOf(QUOTE_LINE),
      reason: "It is the sentence the whole chapter turns on.",
      importance: 0.9,
      striking: 0.8,
    },
  ],
  discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
  generatedAt: AT.quotes,
  elapsedMs: 1,
};

function quotesOwner(): QuotesOwner {
  return {
    ...COMMON,
    status: "ready",
    quotes: QUOTES,
    profiled: false,
    profileChanged: false,
    loaded: true,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

const SKIM: Skim = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  profileHash: null,
  stops: [{ quoteId: "spya-qte234", depth: 1, role: null, cue: "Look for the headline comparison." }],
  visible: [1, 1, 1],
  offered: 1,
  dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
  generatedAt: AT.skim,
  elapsedMs: 1,
};

function skimOwner(): UseSkim {
  return {
    ...COMMON,
    status: "ready",
    skim: SKIM,
    profileChanged: false,
    profileNoticeDismissed: false,
    dismissFailed: null,
    dismissProfileNotice: async () => {},
    notOnRoute: 0,
    automatic: false,
    quotesFirst: false,
    ideasFirst: false,
    ensure: async () => {},
    regenerate: async () => {},
  };
}

const SKIM_VIEW: SkimView = {
  depth: 1,
  depths: [{ depth: 1, label: "Gist", count: 1 }],
  rows: [
    {
      quoteId: "spya-qte234",
      n: 1,
      place: [{ title: "Methods", voice: "ai" }],
      cue: "The headline result",
      current: true,
      missing: false,
      position: null,
      words: null,
      where: [],
      passes: null,
      blockId: null,
    },
  ],
  position: 1,
  card: null,
  termActions: null,
  onAskTerm: null,
  onDepth: noop,
  onRow: noop,
  onStep: noop,
  onOpen: noop,
  canOpen: () => true,
};

/** A finished run answered against an older article — `finishedAt` set, so the identity is the answer's. */
const STALE_RUN: SavedSearch = {
  id: SEARCH_RUN_ID,
  criterion: "anywhere he gives numbers",
  kind: "meaning",
  createdAt: AT.searchCreated,
  finishedAt: AT.searchFinished,
  status: "done",
  hits: [],
  stale: true,
};

const CLAIM: Claim = {
  id: "spya-anc234:8",
  blockId: "spya-anc234",
  quote: "the method halves annotation time",
  start: 8,
  claim: "The method halves annotation time",
  passages: [{ blockId: "spya-cmr456", quote: "fell by about half", start: 0, reasoning: "the timing" }],
  discarded: 0,
};

function claimsApi(): ClaimsApi {
  return {
    run: { status: "done", createdAt: AT.claims, claims: [CLAIM] },
    stale: true,
    loaded: true,
    loadFailed: false,
    pull: noop,
    error: null,
  };
}

/* ------------------------------------------------------------- the mounts -- */

function mountReception(view: "reception" | "claims"): ReactNode {
  const claimList = view === "claims" ? staleClaimList() : claimListOwner();
  return createElement(ReceptionAndClaimsPanel, {
    head: sourcesHead({ view, onView: noop, ownerSlug: SLUG, reception: RECEPTION }),
    access: {
      kind: "owner",
      owner: receptionOwner(view === "reception"),
      claimList,
      checks: checksOwner(),
      citers: { result: { kind: "no-doi" }, retry: noop },
      claimChats: { summaries: [], onCheck: noop, onLens: noop, onOpen: noop },
    },
    onJump: noop,
    view,
    onView: noop,
    articleTitle: null,
    order: "prioritised",
    onOrder: noop,
    blockOrder: new Map(),
    relevance: null,
    onRelevance: noop,
    articleYear: null,
    thread: null,
    onThread: noop,
  });
}

/** One row of the table: how to put that mode's stale banner on screen, and what its × must send. */
interface Row {
  mount(): ReactNode;
  /** The identity the POST must carry, written out rather than read off the panel. */
  identity: string;
}

const ROWS: Record<StaleNoticeMode, Row> = {
  glossary: {
    mount: () =>
      createElement(GlossaryPanel, {
        access: { kind: "owner", owner: glossaryOwner(), glossary: GLOSSARY },
        termId: null,
        onTerm: noop,
        sort: "prioritised",
        onSort: noop,
        gate: null,
        onGate: noop,
        onJump: noop,
      }),
    identity: AT.glossary,
  },
  ideas: {
    mount: () =>
      createElement(IdeasPanel, {
        access: { kind: "owner", owner: ideasOwner(), ideas: IDEAS },
        ideaId: null,
        onIdea: noop,
        found: [],
        openKey: null,
        onOpenKey: noop,
        onJump: noop,
      }),
    identity: AT.ideas,
  },
  faq: {
    mount: () =>
      createElement(FaqPanel, {
        access: { kind: "owner", owner: faqOwner() },
        order: "prioritised",
        onOrder: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
      }),
    identity: AT.faq,
  },
  timeline: {
    mount: () =>
      createElement(TimelinePanel, {
        access: { kind: "owner", owner: timelineOwner() },
        eventId: null,
        onEvent: noop,
        found: [],
        openKey: null,
        onOpenKey: noop,
        onJump: noop,
      }),
    identity: AT.timeline,
  },
  simple: {
    mount: () => createElement(SimplePanel, { access: { kind: "owner", owner: simpleOwner() }, level: "brief", onJump: noop }),
    identity: AT.simple,
  },
  bibliography: {
    mount: () =>
      createElement(BibliographyPanel, {
        head: null,
        access: { kind: "owner", owner: bibliographyOwner() },
        order: "prioritised",
        onOrder: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
      }),
    identity: AT.bibliography,
  },
  tweets: {
    mount: () =>
      createElement(TweetsPanel, { access: { kind: "owner", owner: tweetsOwner() }, article: ARTICLE, slug: SLUG, onJump: noop }),
    identity: AT.tweets,
  },
  reception: { mount: () => mountReception("reception"), identity: AT.reception },
  "sources-claims": { mount: () => mountReception("claims"), identity: AT.sourcesClaims },
  quotes: {
    mount: () =>
      createElement(QuotesPanel, {
        access: { kind: "owner", owner: quotesOwner(), quotes: QUOTES },
        quoteId: null,
        onQuote: noop,
        rank: "document",
        onRank: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
        steps: [],
      }),
    identity: AT.quotes,
  },
  skim: {
    mount: () => createElement(SkimPanel, { access: { kind: "owner", owner: skimOwner() }, view: SKIM_VIEW, away: false }),
    identity: AT.skim,
  },
  search: {
    mount: () =>
      createElement(SearchPanel, {
        access: {
          kind: "owner",
          loaded: true,
          loadError: null,
          error: null,
          running: new Set<string>(),
          onAsk: noop,
          onRetry: noop,
          onRecolour: noop,
          onDelete: noop,
        },
        slug: SLUG,
        matcher: "meaning",
        onMatcher: noop,
        find: null,
        onFind: noop,
        runs: [STALE_RUN],
        active: [SEARCH_RUN_ID],
        slots: assignSlots([STALE_RUN]),
        onToggle: noop,
        onSolo: noop,
        onToggleAll: noop,
        found: [],
        all: [],
        order: "document",
        onOrder: noop,
        gate: 0,
        gateMoved: false,
        onGate: noop,
        openKey: null,
        onOpen: noop,
      }),
    /* `searchNoticeIdentity`'s shape, written out: the run, and the answer it holds. */
    identity: `${SEARCH_RUN_ID}@${AT.searchFinished}`,
  },
  sketch: {
    mount: () => createElement(SketchView, { access: { kind: "owner", slug: SLUG }, blocks: BLOCKS, atRow: null, onJump: noop }),
    /* The whole stored value, including its generation clock, as `useSketch`
       keeps it — shortened to the identity the route accepts. */
    identity: noticeIdentity(JSON.stringify(SKETCH)),
  },
  illustrated: {
    mount: () => createElement(IllustratedView, { slug: SLUG, blocks: BLOCKS, onJump: noop }),
    identity: noticeIdentity(JSON.stringify(ILLUSTRATED)),
  },
  claims: {
    mount: () =>
      createElement(ClaimsView, {
        api: claimsApi(),
        claims: [CLAIM],
        slots: new Map([[CLAIM.id, 0]]),
        showing: [],
        onToggle: noop,
        onJump: noop,
        slug: SLUG,
      }),
    identity: AT.claims,
  },
};

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  sent.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    sent.push({ method, url, body });
    return Promise.resolve(serve(url, method));
  });
  /* jsdom has neither; Illustrated makes an object URL of its plate's bytes. */
  URL.createObjectURL = vi.fn(() => "blob:spideryarn/plate-1");
  URL.revokeObjectURL = vi.fn();
  jobEngine.reset();
  resetActivations();
  forgetStaleNotices();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

function banners(mode: StaleNoticeMode): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-stale-notice="${mode}"]`)];
}

describe("every mode's stale notice can be dismissed", () => {
  it("keeps a picture identity stable across reads and changes it on an otherwise identical rerun", () => {
    const first = JSON.stringify({ ...SKETCH, generatedAt: "2026-09-01T14:00:00.000Z" });
    const reread = JSON.stringify({ ...SKETCH, generatedAt: "2026-09-01T14:00:00.000Z" });
    const rerun = JSON.stringify({ ...SKETCH, generatedAt: "2026-09-01T14:01:00.000Z" });
    expect(noticeIdentity(first)).toBe(noticeIdentity(reread));
    expect(noticeIdentity(first)).not.toBe(noticeIdentity(rerun));
  });

  it("has a row for exactly the modes in STALE_NOTICE_MODES", () => {
    expect(Object.keys(ROWS).sort()).toEqual([...STALE_NOTICE_MODES].sort());
  });

  it("keeps a visitor's Search dismissal on the article where it was made", async () => {
    const visitor = (slug: string) => {
      const props = (ROWS.search.mount() as ReactElement<Parameters<typeof SearchPanel>[0]>).props;
      return createElement(SearchPanel, {
        ...props,
        slug,
        access: {
          kind: "visitor" as const,
          copy: { signedIn: false, sessionUnconfirmed: false, sharedBy: "public" as const, copyFrom: null },
        },
      });
    };

    await act(async () => root.render(visitor("first-piece")));
    await settle();
    const close = banners("search")[0]?.querySelector<HTMLButtonElement>(".notice-close");
    expect(close).toBeTruthy();
    await act(async () => close?.click());
    expect(banners("search")).toHaveLength(0);

    await act(async () => root.render(visitor("second-piece")));
    await settle();
    expect(banners("search"), "article one hid article two's visitor notice").toHaveLength(1);
  });

  it.each(STALE_NOTICE_MODES.map((mode) => [mode] as const))(
    "%s: one banner with an ×, which hides it and posts its identity",
    async (mode) => {
      const row = ROWS[mode];
      await act(async () => {
        root.render(row.mount());
      });
      await settle();

      const shown = banners(mode);
      expect(shown, `${mode} draws one stale banner`).toHaveLength(1);
      const close = shown[0]?.querySelector<HTMLButtonElement>(".notice-close");
      expect(close, `${mode}'s banner has no ×`).toBeTruthy();

      await act(async () => {
        close?.click();
      });
      expect(banners(mode), `${mode}'s banner stayed after the ×`).toHaveLength(0);
      await settle();
      expect(banners(mode), `${mode}'s banner came back`).toHaveLength(0);

      const posts = sent.filter((r) => r.method === "POST" && r.url === `/api/stale-notices/${SLUG}`);
      expect(posts.map((r) => r.body)).toEqual([{ mode, identities: [row.identity] }]);
    },
  );
});
