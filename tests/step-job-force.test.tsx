// @vitest-environment jsdom
/**
 * **What each surface actually posts when a reader presses its button.**
 *
 * `useGlossary` and `useIdeas` share one job hook now
 * (src/web/useStepJob.ts), and the thing most easily lost in a lift-and-shift
 * like that is `force`. It has to be **`force: [step]`, naming the step** —
 * never a bare boolean, never a positional force on something earlier in the
 * pipeline — and both halves of that are silent when they are wrong:
 *
 *  - Both of these steps are in `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts),
 *    which means the force-cascade is explicitly *not* allowed to speak for
 *    them. A force that does not name the step leaves it unforced, the step's
 *    own freshness check says "already done", and the reader watches a job
 *    start, run and change nothing.
 *  - Forcing a step forces every step **after** it (`cascadeForce`,
 *    src/jobs.ts), so naming something earlier would quietly buy extra model
 *    calls on steps whose inputs never moved.
 *
 * Nothing else in the suite asserts the request body of these buttons, so
 * before this file the whole rule was carried by a comment.
 *
 * **The last assertion in each case runs the real `cascadeForce`** over what
 * was posted, rather than only comparing the array. That is the effect rather
 * than the cause: an array that looks right but does not survive the pipeline's
 * own rule is what "unforced, silently" would look like from here.
 *
 * Written against the hooks rather than the reading view, for the reason
 * `tests/glossary-one-fetch.test.tsx` gives: mounting `Reader` drags in nuqs,
 * Supabase and the layout.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepName } from "../src/types.js";
import { cascadeForce } from "../src/jobs.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every artefact GET answers 404 — the ordinary "nobody has asked for one yet"
 * case, which is exactly the state the buttons under test are pressed from.
 * Nothing here reads a body, so `readJson` is never reached.
 */
vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async () => new Response(null, { status: 404 }),
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
}));

/** What each surface asked the queue for, in order. */
interface Posted {
  slug: string;
  steps: StepName[];
  force?: StepName[];
  guidance?: string;
  useProfile?: boolean;
}
const posted: Posted[] = [];

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [],
    loaded: true,
    error: null,
    /* Per-job `/advance` failures. Empty, because nothing here has a driver at
       all — but a whole-module mock that omits a field leaves `undefined` where
       `useStepJob` reads it (src/job-state.ts § `driverStalled`), which is the
       landmine this file's siblings already note about `lastFailure`. */
    driverFailures: {},
    lastFailure: () => null,
    lastBlocker: () => null,
    run: async (request: Posted) => {
      posted.push(request);
      return { id: "job1" };
    },
    cancel: async () => {},
  }),
}));

vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { useIdeas } = await import("../src/web/useIdeas.js");
const { useGlossary } = await import("../src/web/useGlossary.js");

/** What `Reader` hands the band. Posed rather than run — see refused-writes. */
const READ: GlossaryRead = {
  status: "none",
  glossary: null,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  error: null,
  reload: async () => {},
  refresh: async () => {},
  clear: () => {},
  patchEntry: () => {},
};

let ideas: ReturnType<typeof useIdeas> | null = null;
let glossary: ReturnType<typeof useGlossary> | null = null;

function Surfaces(): ReactElement {
  ideas = useIdeas("constitution");
  glossary = useGlossary("constitution", READ);
  return createElement("div");
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  posted.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Surfaces));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The one request the button just made. */
function only(): Posted {
  expect(posted).toHaveLength(1);
  return posted[0] as Posted;
}

/**
 * The pipeline's own answer to "is this step forced?", given what was posted.
 *
 * `cascadeForce` is the function `enqueue` runs (src/jobs.ts § `enqueue`), so
 * this asks the question the server will ask rather than restating the request.
 */
function forcedByPipeline(request: Posted): Set<StepName> {
  return cascadeForce(request.steps, new Set(request.force ?? []));
}

describe("ideas", () => {
  it("names its own step in `force`, every time", async () => {
    await act(async () => {
      await ideas?.find();
    });
    const request = only();
    expect(request.steps).toEqual(["ideas"]);
    /* **Always forced**, unlike the other two: the button is offered beside a
       list that is current, so an unforced run would skip. useIdeas.ts § find. */
    expect(request.force).toEqual(["ideas"]);
    expect(forcedByPipeline(request).has("ideas")).toBe(true);
  });

  it("sends `useProfile` only when it is false", async () => {
    await act(async () => {
      await ideas?.find();
    });
    expect(only()).not.toHaveProperty("useProfile");
    posted.length = 0;
    await act(async () => {
      await ideas?.find(false);
    });
    expect(only().useProfile).toBe(false);
  });
});

describe("the glossary", () => {
  it("does not force `find`, and does force `more`", async () => {
    await act(async () => {
      await glossary?.find();
    });
    const found = only();
    expect(found.steps).toEqual(["glossary"]);
    expect(found).not.toHaveProperty("force");

    posted.length = 0;
    await act(async () => {
      await glossary?.more();
    });
    const asked = only();
    /* The difference between these two verbs is the whole glossary feature:
       forcing this step *appends* rather than replacing (src/glossary.ts), so a
       `find` that forced would silently lengthen the reader's list every time
       they pressed it. useGlossary.ts § the three verbs. */
    expect(asked.force).toEqual(["glossary"]);
    expect(forcedByPipeline(asked).has("glossary")).toBe(true);
  });
});
