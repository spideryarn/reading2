// @vitest-environment jsdom
/**
 * **The three always-mounted reads ask for `200 null`, and read it as "none
 * yet"** — `useQuizRead`, `useBibliographyRead`, `useCrossrefs`.
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md § Stage 1.
 *
 * 1. Each sends the opt-in header on its GET.
 * 2. A `200` with a `null` body is the same state a 404 was: Quiz and
 *    Citations offer their button (`status: "none"`), the prose draws no
 *    underlines.
 * 3. **A 404 still is**, for the minutes of a deploy when the new client meets
 *    the old server.
 *
 * **And the other seven since** — Simple, Ideas, FAQ, Timeline, Debate,
 * Glossary, Quotes: the same three, and two more that the first three's review
 * found (docs/postmortems/261006k-a-null-sentinel-is-widened-by-a-truthiness-check.md):
 *
 * 4. **Only `null` is "none yet".** `false`, `0` and `""` are a broken reply.
 * 5. **A reply without its artefact does not replace one already on screen.**
 *
 * docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md.
 *
 * **And the last six** — Tweets, Relations, Skim, Sketch, Illustrated, Arc —
 * with the two side reads of `/api/sketch/`: Illustrated's readiness check and
 * the Sketch chip's caption. Three of these report no failure to the reader and
 * keep their own handling: Relations draws nothing, readiness says `unknown`
 * (never `ready`), and the caption stays silent.
 * docs/plans/261007n-the-last-six-artefact-reads-answer-none-yet-as-200-null.md.
 *
 * The route's half is tests/none-yet-is-not-a-404-route.test.ts. Harness after
 * tests/always-mounted-reads-refresh.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NONE_YET_AS_NULL_HEADER } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "none-yet";

interface Asked {
  url: string;
  header: string | null;
}
const asked: Asked[] = [];
/** Every `POST /api/jobs`: the job an arrival rule starts on "none yet". */
const posted: string[] = [];
let answer: (url: string) => Response;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = async (url: string, init?: RequestInit) => {
    if (url === "/api/jobs" && init?.method === "POST") posted.push(String(init.body));
    if (url === "/api/jobs") return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    asked.push({ url, header: new Headers(init?.headers).get(NONE_YET_AS_NULL_HEADER) });
    return answer(url);
  };
  return { ...real, apiFetch, fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init) };
});

const { useQuizRead } = await import("../src/web/useQuiz.js");
const { useBibliographyRead } = await import("../src/web/useBibliography.js");
const { useCrossrefs } = await import("../src/web/useCrossrefs.js");
const { useSimple } = await import("../src/web/useSimple.js");
const { useIdeasRead } = await import("../src/web/useIdeas.js");
const { useFaqRead } = await import("../src/web/useFaq.js");
const { useTimelineRead } = await import("../src/web/useTimeline.js");
const { useReceptionRead } = await import("../src/web/useReception.js");
const { useGlossaryRead } = await import("../src/web/useGlossary.js");
const { useQuotesRead } = await import("../src/web/useQuotes.js");
const { useTweets } = await import("../src/web/useTweets.js");
const { useSkim } = await import("../src/web/useSkim.js");
const { useRelations } = await import("../src/web/useRelations.js");
const { useArc } = await import("../src/web/useArc.js");
const { useSketch, useSketchCaption } = await import("../src/web/useSketch.js");
const { useIllustrated } = await import("../src/web/useIllustrated.js");

const nullBody = () =>
  new Response("null", { status: 200, headers: { "content-type": "application/json" } });
const notFound = () => new Response(JSON.stringify({ error: "none" }), { status: 404 });

let host: HTMLDivElement;
let root: Root;
let seen: unknown;

function Probe({ use, slug = SLUG }: { use: (slug: string) => unknown; slug?: string }) {
  seen = use(slug);
  return null;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(use: (slug: string) => unknown): Promise<void> {
  await act(async () => root.render(createElement(Probe, { use })));
  await settle();
}

beforeEach(() => {
  asked.length = 0;
  posted.length = 0;
  seen = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const ANSWERS = [
  ["a 200 null", nullBody],
  ["a 404, from a server that has not heard of the header", notFound],
] as const;

describe.each(ANSWERS)("%s is none yet", (_name, reply) => {
  beforeEach(() => {
    answer = reply;
  });

  it("quiz: the panel's button, not an error", async () => {
    await mount(useQuizRead);
    expect(asked).toEqual([{ url: `/api/quiz/${SLUG}`, header: "1" }]);
    const read = seen as { status: string; quiz: unknown; error: unknown };
    expect({ status: read.status, quiz: read.quiz, error: read.error }).toEqual({
      status: "none",
      quiz: null,
      error: null,
    });
  });

  it("bibliography: the panel's button, not an error", async () => {
    await mount(useBibliographyRead);
    expect(asked).toEqual([{ url: `/api/bibliography/${SLUG}`, header: "1" }]);
    const read = seen as { status: string; bibliography: unknown; error: unknown };
    expect({ status: read.status, bibliography: read.bibliography, error: read.error }).toEqual({
      status: "none",
      bibliography: null,
      error: null,
    });
  });

  it("crossrefs: no underlines", async () => {
    await mount(useCrossrefs);
    expect(asked).toEqual([{ url: `/api/crossrefs/${SLUG}`, header: "1" }]);
    expect(seen).toBeNull();
  });
});

const READERS = [
  ["quiz", useQuizRead, { quiz: { batchId: "batch", slug: SLUG, questions: [] }, stale: false, outdated: false, profileChanged: false, attempts: [] }],
  ["bibliography", useBibliographyRead, { bibliography: { slug: SLUG, citations: [] }, stale: false, outdated: false }],
] as const;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe.each(READERS)("%s reads distinguish absence from a broken reply", (kind, use, body) => {
  const artefact = (body as Record<string, unknown>)[kind];
  it("accepts a real response", async () => {
    answer = () => json(body);
    await mount(use);
    expect(seen).toMatchObject({ status: "ready", error: null, [kind]: artefact });
  });

  for (const malformed of [false, 0, "", {}, { [kind]: null }]) {
    it(`reports ${JSON.stringify(malformed)} as a failed opening read`, async () => {
      answer = () => json(malformed);
      await mount(use);
      expect(seen).toMatchObject({ status: "error", [kind]: null });
      expect((seen as { error: unknown }).error).toBeTruthy();
    });

    it(`keeps a real response when revalidation returns ${JSON.stringify(malformed)}`, async () => {
      answer = () => json(body);
      await mount(use);
      answer = () => json(malformed);
      await act(async () => (seen as { refresh(): Promise<void> }).refresh());
      await settle();
      expect(seen).toMatchObject({ status: "ready", [kind]: artefact });
      expect((seen as { error: unknown }).error).toBeTruthy();
    });
  }
});

it("crossrefs draws the real response's fresh links", async () => {
  const links = [{ from: "spya-k3m9qt", to: "spya-p7w2dn", phrase: "see below" }];
  answer = () => json({ crossrefs: { slug: SLUG, links }, stale: false, outdated: false });
  await mount(useCrossrefs);
  expect(seen).toEqual(links);
});

it.each([false, 0, "", {}, { crossrefs: null }])("crossrefs draws nothing for a malformed body %j", async (body) => {
  answer = () => json(body);
  await mount(useCrossrefs);
  expect(seen).toBeNull();
});

/* ------------------------------------------------------ the other seven --
   One row each: the URL's name, the hook, the field the hook publishes the
   artefact under, and a reply the route could really send. */
const AT = "2026-10-06T00:00:00.000Z";
const FLAGS = { stale: false, outdated: false, profileChanged: false };
const SEVEN = [
  ["simple", useSimple, "simple", { simpleSummary: { slug: SLUG, generatedAt: AT, profileHash: null, levels: {} }, ...FLAGS }, "simpleSummary"],
  ["ideas", useIdeasRead, "ideas", { ideas: { slug: SLUG, generatedAt: AT, profileHash: null, ideas: [] }, ...FLAGS }, "ideas"],
  ["faq", useFaqRead, "faq", { faq: { slug: SLUG, generatedAt: AT, questions: [] }, ...FLAGS }, "faq"],
  ["timeline", useTimelineRead, "timeline", { timeline: { slug: SLUG, generatedAt: AT, events: [] }, ...FLAGS }, "timeline"],
  ["reception", useReceptionRead, "reception", { reception: { slug: SLUG, generatedAt: AT, direct: { rows: [] }, claims: { rows: [] } }, ...FLAGS }, "reception"],
  ["glossary", useGlossaryRead, "glossary", { glossary: { slug: SLUG, generatedAt: AT, profileHash: null, entries: [] }, ...FLAGS }, "glossary"],
  ["quotes", useQuotesRead, "quotes", { quotes: { slug: SLUG, generatedAt: AT, profileHash: null, quotes: [] }, ...FLAGS }, "quotes"],
] as const;

interface SevenRead {
  status: string;
  error: unknown;
  retryRead(): Promise<void>;
}

describe.each(SEVEN)("%s", (name, use, held, body, sent) => {
  const url = `/api/${name}/${SLUG}`;
  const artefact = (body as Record<string, unknown>)[sent];
  const read = () => seen as SevenRead & Record<string, unknown>;

  for (const [what, reply] of ANSWERS) {
    it(`${what} is none yet: the panel's button, not an error`, async () => {
      answer = reply;
      await mount(use);
      expect(asked.filter((ask) => ask.url === url)).toEqual([{ url, header: "1" }]);
      expect({ status: read().status, artefact: read()[held], error: read().error }).toEqual({
        status: "none",
        artefact: null,
        error: null,
      });
    });
  }

  it("accepts a real response", async () => {
    answer = () => json(body);
    await mount(use);
    expect(read()).toMatchObject({ status: "ready", error: null, [held]: artefact });
  });

  for (const late of [null, body]) {
    it(`ignores ${late === null ? "absence" : "an artefact"} parsed after moving to another article`, async () => {
      let release!: (text: string) => void;
      const pending = new Promise<string>((resolve) => { release = resolve; });
      answer = () => {
        const response = json(body);
        response.text = () => pending;
        return response;
      };
      await mount(use);
      expect(read().status).toBe("loading");
      expect(asked.some((ask) => ask.url === url)).toBe(true);

      const nextArtefact = { ...artefact as object, slug: "next-article" };
      const next = { ...body, [sent]: nextArtefact };
      answer = () => json(next);
      await act(async () => root.render(createElement(Probe, { use, slug: "next-article" })));
      await settle();
      expect(read()).toMatchObject({ status: "ready", [held]: nextArtefact });
      expect(asked.some((ask) => ask.url === `/api/${name}/next-article`)).toBe(true);

      await act(async () => release(JSON.stringify(late)));
      await settle();
      expect(read()).toMatchObject({ status: "ready", error: null, [held]: nextArtefact });
    });
  }

  for (const [what, reply] of ANSWERS) {
    it(`${what} clears an earlier artefact and its flags`, async () => {
      answer = () => json({ ...body, [sent]: { ...artefact as object, profileHash: "earlier-profile" },
        stale: true, outdated: true, profileChanged: true, panelRun: "rewrite" });
      await mount(use);
      expect(read()).toMatchObject({ status: "ready", stale: true, outdated: true });
      if ("profileChanged" in read()) expect(read().profileChanged).toBe(true);
      if ("profiled" in read()) expect(read().profiled).toBe(true);
      if (name === "glossary") expect(read().panelRun).toBe("rewrite");
      answer = reply;
      await act(async () => read().retryRead());
      await settle();
      expect(read()).toMatchObject({ status: "none", error: null, [held]: null, stale: false, outdated: false });
      if ("profileChanged" in read()) expect(read().profileChanged).toBe(false);
      if ("profiled" in read()) expect(read().profiled).toBe(false);
      if (name === "glossary") expect(read().panelRun).toBeUndefined();
    });
  }

  it("accepts a saved real copy served offline", async () => {
    answer = () => new Response(JSON.stringify(body), { status: 200, headers: {
      "content-type": "application/json", "x-spideryarn-offline": "copy", "x-spideryarn-saved-at": "123",
    } });
    await mount(use);
    expect(read()).toMatchObject({ status: "ready", error: null, [held]: artefact });
  });

  for (const malformed of [false, 0, "", {}, { [sent]: null }]) {
    it(`reports ${JSON.stringify(malformed)} as a failed opening read, not as none yet`, async () => {
      answer = () => json(malformed);
      await mount(use);
      expect(read()).toMatchObject({ status: "error", [held]: null });
      expect(read().error).toBeTruthy();
    });

    it(`keeps a real response when the next read returns ${JSON.stringify(malformed)}`, async () => {
      answer = () => json(body);
      await mount(use);
      answer = () => json(malformed);
      await act(async () => read().retryRead());
      await settle();
      expect(read()).toMatchObject({ status: "ready", [held]: artefact });
      expect(read().error).toBeTruthy();
    });
  }
});

/* --------------------------------------------------------- the last six --
   Tweets, Skim, Sketch, Illustrated and Arc publish a status and the artefact;
   Relations publishes only the words (below). One row each: the URL's name,
   the hook, the field it publishes the artefact under, what it calls "none",
   the field the route sends the artefact in, and a reply the route could
   really send. */
const PARAGRAPH = "The instrument was built before anybody could say what it would measure.";
const QUOTE_LINE = "before anybody could say what it would measure";
const BLOCKS = [
  { id: "spya-aaaaaa", tag: "h1", kind: "heading", level: 1, text: "A piece", words: 2, html: "<h1>A piece</h1>", gistable: false },
  { id: "spya-bbbbbb", tag: "p", kind: "text", text: PARAGRAPH, words: 12, html: `<p>${PARAGRAPH}</p>`, gistable: true },
] as never[];
const BLOCK_IDS = ["spya-aaaaaa", "spya-bbbbbb"] as never[];
const STAMP = { version: "test", generator: "test", slug: SLUG, sourceHash: "hash", generatedAt: AT, elapsedMs: 1 };
const SKETCH = {
  title: "One instrument, one claim",
  caption: "The measurement is doing the arguing.",
  scenes: [
    {
      id: "s0",
      title: "Overview",
      height: 200,
      items: [{ kind: "node", id: "n1", shape: "box", x: 10, y: 10, w: 140, h: 40, text: "The rig", size: "md", block: "spya-bbbbbb" }],
    },
  ],
};
const ILLUSTRATED = {
  version: "illustrated/1",
  generator: "a-model",
  illustrator: "openai/gpt-image-2",
  style: "A plain register.",
  profileHash: null,
  plates: [
    {
      sceneId: "overview",
      title: "The rig, painted",
      prompt: "A workbench, in gouache.",
      vignettes: [{ block: "spya-bbbbbb", quote: QUOTE_LINE, depicts: "A rig on a workbench" }],
      image: { sha256: "a".repeat(64), ext: "jpeg", bytes: 73_000, width: 1024, height: 1536 },
    },
  ],
};

interface LastRead {
  status: string;
  error: unknown;
  retryRead?: () => Promise<void>;
}

const LAST_SIX = [
  {
    name: "tweets",
    use: useTweets as (slug: string) => unknown,
    held: "thread",
    none: "none",
    sent: "thread",
    body: {
      thread: { ...STAMP, version: "tweets/5", limit: 280, tweets: [{ text: "A post.", chars: 7, blocks: ["spya-bbbbbb"] }] },
      stale: false,
      profileChanged: false,
    },
  },
  {
    name: "skim",
    use: (slug: string) => useSkim(slug, useQuotesRead(slug), useIdeasRead(slug)),
    held: "skim",
    none: "none",
    sent: "skim",
    body: {
      skim: {
        ...STAMP,
        profileHash: null,
        stops: [{ quoteId: "spya-qte234", depth: 1, role: "Where it turns" }],
        visible: [1, 1, 1],
        offered: 1,
        dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
      },
      ...FLAGS,
      notOnRoute: 0,
    },
  },
  {
    name: "sketch",
    use: (slug: string) => useSketch(slug, BLOCK_IDS),
    held: "sketch",
    none: "none",
    sent: "sketch",
    body: { sketch: SKETCH, ...FLAGS },
  },
  {
    name: "illustrated",
    use: (slug: string) => useIllustrated(slug, BLOCKS),
    held: "illustrated",
    none: "none",
    sent: "illustrated",
    body: { illustrated: ILLUSTRATED, ...FLAGS },
  },
  {
    name: "arc",
    use: (slug: string) => useArc(slug, undefined),
    held: "arc",
    none: "absent",
    sent: "arc",
    body: { arc: { ...STAMP, entries: [] }, stale: false, outdated: false },
  },
];

/** Answer the read under test; every other read (Skim's Quotes and Ideas, the Sketch Illustrated asks about) is none yet. */
function only(name: string, reply: () => Response): (url: string) => Response {
  return (url) => (url.startsWith(`/api/${name}/`) ? reply() : nullBody());
}

/** Hold JSON decoding open after the HTTP response has arrived. */
function delayedBody(body: unknown) {
  let release!: (body: unknown) => void;
  const pending = new Promise<string>((resolve) => {
    release = (value) => resolve(JSON.stringify(value));
  });
  const response = json(body);
  const decoding = vi.fn(() => pending);
  response.text = decoding;
  return { response, release, decoding };
}

describe.each(LAST_SIX)("$name", ({ name, use, held, none, body, sent }) => {
  const url = `/api/${name}/${SLUG}`;
  const read = () => seen as LastRead & Record<string, unknown>;

  for (const [what, reply] of ANSWERS) {
    it(`${what} is none yet, and the read asked for 200 null`, async () => {
      answer = only(name, reply);
      await mount(use);
      expect(asked.filter((ask) => ask.url === url)).toEqual([{ url, header: "1" }]);
      expect({ status: read().status, artefact: read()[held], error: read().error }).toEqual({
        status: none,
        artefact: null,
        error: null,
      });
    });
  }

  it("accepts a real response", async () => {
    answer = only(name, () => json(body));
    await mount(use);
    expect(read()).toMatchObject({ status: "ready", error: null });
    expect(read()[held]).toBeTruthy();
  });

  for (const late of [null, { ...body, stale: true, outdated: true, profileChanged: true }]) {
    it(`ignores ${late === null ? "absence" : "an older artefact"} parsed after moving to another article`, async () => {
      const delayed = delayedBody(body);
      answer = only(name, () => delayed.response);
      await mount(use);
      expect(delayed.decoding).toHaveBeenCalledOnce();
      expect(read().status).toBe("loading");
      expect(asked.some((ask) => ask.url === url)).toBe(true);

      answer = only(name, () => json(body));
      await act(async () => root.render(createElement(Probe, { use, slug: "next-article" })));
      await settle();
      expect(read()).toMatchObject({ status: "ready", error: null, stale: false });
      const before = read()[held];
      expect(before).toBeTruthy();
      expect(asked.some((ask) => ask.url === `/api/${name}/next-article`)).toBe(true);

      await act(async () => delayed.release(late));
      await settle();
      expect(read()).toMatchObject({ status: "ready", error: null, stale: false, [held]: before });
    });
  }

  for (const malformed of [false, 0, "", {}, { [sent]: null }]) {
    it(`reports ${JSON.stringify(malformed)} as a failed opening read, not as none yet`, async () => {
      answer = only(name, () => json(malformed));
      await mount(use);
      expect(read()).toMatchObject({ status: "error", [held]: null });
      expect(read().error).toBeTruthy();
    });

    /* Arc has no re-read to call: it reads again only when its job ends. */
    if (name === "arc") continue;
    it(`keeps a real response when the next read returns ${JSON.stringify(malformed)}`, async () => {
      answer = only(name, () => json(body));
      await mount(use);
      const before = read()[held];
      expect(before).toBeTruthy();
      answer = only(name, () => json(malformed));
      await act(async () => read().retryRead?.());
      await settle();
      expect(read()).toMatchObject({ status: "ready" });
      expect(read()[held]).toEqual(before);
      expect(read().error).toBeTruthy();
    });
  }
});

describe("relations", () => {
  const RELATIONS = {
    relations: { ...STAMP, relations: { "spya-bbbbbb": "so" }, dropped: {} },
    stale: false,
    outdated: false,
  };
  /* A fresh article per case: the arrival rule tries once per article per page. */
  let n = 0;
  let slug = "";
  beforeEach(() => {
    n += 1;
    slug = `relations-${n}`;
  });
  const shown = (at: string) => useRelations(at, true);
  async function mountRelations(): Promise<void> {
    await act(async () => root.render(createElement(Probe, { use: shown, slug })));
    await settle();
  }

  for (const [what, reply] of ANSWERS) {
    it(`${what} is none yet: no words, the read asked for 200 null, and the column's one job starts`, async () => {
      answer = reply;
      await mountRelations();
      const url = `/api/relations/${slug}`;
      expect(asked.filter((ask) => ask.url === url)).toEqual([{ url, header: "1" }]);
      expect(seen).toBeNull();
      expect(posted.filter((sent) => sent.includes('"relations"'))).toHaveLength(1);
    });
  }

  it("draws a real response's words", async () => {
    answer = () => json(RELATIONS);
    await mountRelations();
    expect(seen).toEqual({ "spya-bbbbbb": "so" });
  });

  for (const late of [null, {
    ...RELATIONS,
    relations: { ...RELATIONS.relations, relations: { "spya-bbbbbb": "but" } },
  }]) {
    it(`ignores ${late === null ? "absence" : "older words"} parsed after moving to another article`, async () => {
      const delayed = delayedBody(RELATIONS);
      answer = () => delayed.response;
      await mountRelations();
      expect(delayed.decoding).toHaveBeenCalledOnce();
      expect(seen).toBeNull();
      expect(asked.some((ask) => ask.url === `/api/relations/${slug}`)).toBe(true);
      answer = () => json(RELATIONS);
      await act(async () => root.render(createElement(Probe, { use: shown, slug: `${slug}-next` })));
      await settle();
      expect(seen).toEqual({ "spya-bbbbbb": "so" });
      await act(async () => delayed.release(late));
      await settle();
      expect(seen).toEqual({ "spya-bbbbbb": "so" });
      expect(posted).toEqual([]);
    });
  }

  for (const malformed of [false, 0, "", {}, { relations: null }]) {
    it(`reads ${JSON.stringify(malformed)} as a failed read, not as none yet: nothing drawn, no job, one re-read`, async () => {
      answer = () => json(malformed);
      await mountRelations();
      expect(seen).toBeNull();
      expect(posted).toEqual([]);
      /* The arrival rule's answer to a failed read is to read once more
         (useAutoRun.ts § `useAutoRunOnArrival`) — the evidence that this was
         taken as a failure, and not as words or as none. */
      expect(asked.filter((ask) => ask.url === `/api/relations/${slug}`)).toHaveLength(2);
    });
  }
});

describe("Illustrated's readiness check on the Sketch", () => {
  /* Illustrated is none yet, which is when it asks the Sketch's own route. */
  const sketchSays = (reply: () => Response) => (url: string) =>
    url.startsWith("/api/sketch/") ? reply() : nullBody();
  const kind = () => (seen as { sketch: { kind: string } }).sketch.kind;
  const use = (slug: string) => useIllustrated(slug, BLOCKS);

  for (const [what, reply] of ANSWERS) {
    it(`${what} from the Sketch is absent, and the check asked for 200 null`, async () => {
      answer = sketchSays(reply);
      await mount(use);
      const url = `/api/sketch/${SLUG}`;
      expect(asked.filter((ask) => ask.url === url)).toEqual([{ url, header: "1" }]);
      expect(kind()).toBe("absent");
    });
  }

  it("a real, current Sketch is ready", async () => {
    answer = sketchSays(() => json({ sketch: SKETCH, ...FLAGS }));
    await mount(use);
    expect(kind()).toBe("ready");
  });

  for (const late of [null, { sketch: SKETCH, ...FLAGS, stale: true }]) {
    it(`ignores ${late === null ? "absence" : "a stale Sketch"} parsed after moving to another article`, async () => {
      const delayed = delayedBody({ sketch: SKETCH, ...FLAGS });
      answer = sketchSays(() => delayed.response);
      await mount(use);
      expect(delayed.decoding).toHaveBeenCalledOnce();
      expect(kind()).toBe("checking");
      expect(asked.some((ask) => ask.url === `/api/sketch/${SLUG}`)).toBe(true);
      answer = sketchSays(() => json({ sketch: SKETCH, ...FLAGS }));
      await act(async () => root.render(createElement(Probe, { use, slug: "next-article" })));
      await settle();
      expect(kind()).toBe("ready");
      expect(asked.some((ask) => ask.url === "/api/sketch/next-article")).toBe(true);
      await act(async () => delayed.release(late));
      await settle();
      expect(kind()).toBe("ready");
    });
  }

  for (const malformed of [false, 0, "", {}, { sketch: null }, { stale: false, profileChanged: false }]) {
    it(`${JSON.stringify(malformed)} is unknown, never ready`, async () => {
      answer = sketchSays(() => json(malformed));
      await mount(use);
      expect(kind()).toBe("unknown");
    });
  }
});

describe("the Sketch chip's caption", () => {
  for (const [what, reply] of ANSWERS) {
    it(`${what} is silent, and the read asked for 200 null`, async () => {
      answer = reply;
      await mount(useSketchCaption);
      const url = `/api/sketch/${SLUG}`;
      expect(asked.filter((ask) => ask.url === url)).toEqual([{ url, header: "1" }]);
      expect(seen).toBeNull();
    });
  }

  it("a real Sketch gives its caption", async () => {
    answer = () => json({ sketch: SKETCH, ...FLAGS });
    await mount(useSketchCaption);
    expect(seen).toBe(SKETCH.caption);
  });

  it("ignores a caption parsed after moving to another article", async () => {
    const delayed = delayedBody({ sketch: { ...SKETCH, caption: "The older caption." }, ...FLAGS });
    answer = () => delayed.response;
    await mount(useSketchCaption);
    expect(delayed.decoding).toHaveBeenCalledOnce();
    expect(seen).toBeNull();
    expect(asked.some((ask) => ask.url === `/api/sketch/${SLUG}`)).toBe(true);
    answer = () => json({ sketch: SKETCH, ...FLAGS });
    await act(async () => root.render(createElement(Probe, { use: useSketchCaption, slug: "next-article" })));
    await settle();
    expect(seen).toBe(SKETCH.caption);
    await act(async () => delayed.release({ sketch: { ...SKETCH, caption: "The older caption." }, ...FLAGS }));
    await settle();
    expect(seen).toBe(SKETCH.caption);
  });

  it.each([false, 0, "", {}, { sketch: null }])("%j is silent", async (body) => {
    answer = () => json(body);
    await mount(useSketchCaption);
    expect(seen).toBeNull();
  });
});
