// @vitest-environment jsdom
/**
 * **A second refusal, for a different reason, asks the Sketch's state again.**
 *
 * `useIllustrated` reads the Sketch's route once to say why painting would be
 * refused (`useSketchReadiness`), and re-asks when a string its caller builds
 * changes — "whenever an Illustrated job ends". The string was
 * `${queue.failed ?? ""}\0${job id}`, and `queue.failed` has been a
 * `StepFailure` object since 2026-09-03, so its half read `[object Object]`
 * for every failure there has ever been. A refused start makes no job, so two
 * refusals in a row left the key unchanged and the panel went on describing
 * the Sketch as it was before the first.
 *
 * The key carries the failure's message now. It is still not an identity for
 * "a failure happened": two refusals in the same words do not re-ask, and the
 * last case pins that as it is rather than leaving it to be assumed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-piece";
const gets: string[] = [];
let refusal = "";

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    /* Neither picture exists: Illustrated is `none`, which is when the Sketch
       is asked about at all, and the Sketch is `absent`. */
    apiFetch: async (url: string) => {
      gets.push(url);
      return new Response(null, { status: 404 });
    },
  };
});

vi.mock("../src/web/useJobs.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  const jobs: never[] = [];
  return {
    ...real,
    useJobs: () => ({
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => refusal,
      /* Every start is refused: no job is made, so no job id ever changes. */
      run: async () => null,
      cancel: async () => {},
      add: async () => null,
      addUpload: async () => null,
      retry: async () => null,
      forget: async () => {},
    }),
  };
});

const { useIllustrated } = await import("../src/web/useIllustrated.js");

let view: ReturnType<typeof useIllustrated>;
const NO_BLOCKS: never[] = [];
function Probe() {
  view = useIllustrated(SLUG, NO_BLOCKS);
  return null;
}

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const sketchAsks = () => gets.filter((url) => url.startsWith("/api/sketch/")).length;

async function refusedWith(words: string): Promise<void> {
  refusal = words;
  await act(async () => {
    await view.ensure();
  });
  await settle();
  expect(view.failed?.message, "the refusal reached the hook").toBe(words);
}

beforeEach(async () => {
  gets.length = 0;
  refusal = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
  await settle();
  expect(view.status).toBe("none");
  expect(sketchAsks(), "asked once on arrival").toBe(1);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("asks again after a first refusal, and again after a second in different words", async () => {
  await refusedWith("The sketch is out of date. Redraw it first.");
  expect(sketchAsks()).toBe(2);

  await refusedWith("Your profile changed since the sketch was drawn.");
  expect(sketchAsks(), "a different refusal is new evidence about the Sketch").toBe(3);
});

it("does not ask again for a refusal in the same words (as it is, not as it should be)", async () => {
  await refusedWith("The sketch is out of date. Redraw it first.");
  await refusedWith("The sketch is out of date. Redraw it first.");
  expect(sketchAsks()).toBe(2);
});
