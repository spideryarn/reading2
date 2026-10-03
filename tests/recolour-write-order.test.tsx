// @vitest-environment jsdom
/**
 * **A recolour cannot put an old note back on screen, nor a note an old
 * colour** — plan 261003e, review S3.
 *
 * All three comment PATCHes (`edit`, `place`, `recolour`) answer with the whole
 * comment, and the hook replaces the whole row with it. So two of them in
 * flight at once, whose answers cross on the way back, leave the field the
 * older answer does not own at its old value: nothing is lost on disk, because
 * the SQL writes disjoint columns, but the tab disagrees with Postgres until a
 * reload. `useComments` sends them through one per-comment queue for exactly
 * this; `recolour` has to join it. tests/referee-placement.test.tsx proves the
 * same for `edit` and `place`, and this file borrows its fake server.
 *
 * Driven through the hook rather than a dialog: the order is the hook's to
 * keep, and a dialog would only add ways to click.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Comment, HighlightColour } from "../src/types.js";

/* `apiFetch` and `fetchOk` both, for the reason tests/referee-placement.test.tsx
   gives: `fetchOk` calls `apiFetch` through the module's own binding. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { useComments } = await import("../src/web/useComments.js");
type Api = ReturnType<typeof useComments>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "a-paper";
const ID = "spya-rcw001";

/** The server's row. Writes apply to it; answers are snapshots of it. */
let stored: Comment;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** One write, applied the way its route applies it — to its own columns only. */
function process(url: string, body: Record<string, unknown>): Response {
  const { body: _b, colour: _c, criterionId: _k, valence: _v, ...rest } = stored;
  if (url.endsWith("/colour")) {
    const colour = body["colour"];
    stored = {
      ...rest,
      ...(stored.body !== undefined ? { body: stored.body } : {}),
      ...(typeof colour === "string" ? { colour: colour as HighlightColour } : {}),
      ...(stored.criterionId !== undefined ? { criterionId: stored.criterionId } : {}),
      ...(stored.valence !== undefined ? { valence: stored.valence } : {}),
    };
  } else if (url.endsWith("/mark")) {
    const k = body["criterionId"];
    const v = body["valence"];
    stored = {
      ...rest,
      ...(stored.body !== undefined ? { body: stored.body } : {}),
      ...(stored.colour !== undefined ? { colour: stored.colour } : {}),
      ...(typeof k === "string" ? { criterionId: k } : {}),
      ...(typeof v === "number" ? { valence: v } : {}),
    };
  } else {
    const next = body["body"];
    stored = {
      ...rest,
      ...(typeof next === "string" ? { body: next } : {}),
      ...(stored.colour !== undefined ? { colour: stored.colour } : {}),
      ...(stored.criterionId !== undefined ? { criterionId: stored.criterionId } : {}),
      ...(stored.valence !== undefined ? { valence: stored.valence } : {}),
    };
  }
  return json({ comment: stored });
}

interface InFlight {
  process(): void;
  deliver(): void;
}
let held: InFlight[] = [];

function answer(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  if (method === "GET") return Promise.resolve(json({ comments: [stored] }));
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  let deliverWith!: (r: Response) => void;
  const parked = new Promise<Response>((resolve) => {
    deliverWith = resolve;
  });
  let composed: Response | null = null;
  held.push({
    process: () => {
      composed = process(url, body);
    },
    deliver: () => deliverWith(composed ?? process(url, body)),
  });
  return parked;
}

let api: Api | undefined;
function Harness() {
  const comments = useComments(SLUG);
  useEffect(() => {
    api = comments;
  });
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  stored = {
    id: ID,
    blockId: "spya-k3m9qt",
    quote: "the words",
    start: 0,
    createdAt: "2026-10-03T09:00:00.000Z",
    status: "none",
    body: "the first note",
    colour: "yellow",
  };
  held = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  api = undefined;
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

/**
 * Every write runs on the server in the order it was sent; the answers come
 * back in the opposite order. Rounds, because a queue sends its next write only
 * once the last is answered (tests/referee-placement.test.tsx § landInRounds).
 */
async function landAnswersInReverse(): Promise<void> {
  await settle();
  for (let i = 0; i < 8; i += 1) {
    const batch = held;
    held = [];
    if (batch.length === 0) return;
    await act(async () => {
      for (const w of batch) w.process();
      for (const w of [...batch].reverse()) w.deliver();
    });
    await settle();
  }
  throw new Error("still writing after eight rounds");
}

const shown = (): Comment | undefined => api?.comments.find((c) => c.id === ID);

describe("recolour shares the per-comment queue with edit and place", () => {
  it("a recolour then an edit, answers crossing: both survive", async () => {
    await act(async () => {
      void api?.recolour(ID, "pink");
      void api?.edit(ID, "the second note");
    });
    await landAnswersInReverse();
    expect(shown()?.colour).toBe("pink");
    expect(shown()?.body).toBe("the second note");
  });

  it("an edit then a recolour, answers crossing: both survive", async () => {
    await act(async () => {
      void api?.edit(ID, "the second note");
      void api?.recolour(ID, "blue");
    });
    await landAnswersInReverse();
    expect(shown()?.colour).toBe("blue");
    expect(shown()?.body).toBe("the second note");
  });

  it("a placement then a colour removal, answers crossing: both survive", async () => {
    await act(async () => {
      void api?.place(ID, { criterionId: "spya-crw001", valence: -40 });
      void api?.recolour(ID, null);
    });
    await landAnswersInReverse();
    expect("colour" in (shown() ?? {})).toBe(false);
    expect(shown()?.criterionId).toBe("spya-crw001");
    expect(shown()?.valence).toBe(-40);
  });

  it("is not optimistic: the colour changes when the server has it, not before", async () => {
    await act(async () => {
      void api?.recolour(ID, "green");
    });
    await settle();
    expect(shown()?.colour).toBe("yellow");
    await landAnswersInReverse();
    expect(shown()?.colour).toBe("green");
  });
});
