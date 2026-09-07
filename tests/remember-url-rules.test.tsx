// @vitest-environment jsdom
/**
 * **The URL after Review became Remember, and the two rules that are
 * navigations rather than parsing.**
 *
 * The mode key moved from `review` to `remember` on 2026-09-01, and so did its
 * sub-mode parameter — `?review=recall|quiz` became `?remember=recall|quiz`.
 * Greg's licence for the rename was explicit that no alias is kept:
 *
 * > We have no real users yet, so it's fine to break things (e.g. urls) without
 * > aliases etc.
 *
 * So the first half of this file pins what the parsers now accept and, just as
 * importantly, what they now refuse: a `?mode=review` link lands on the article
 * rather than on Remember, and a stale `?review=quiz` is an unread key.
 *
 * The second half is the part a parser test cannot reach. `?remember=` and
 * `?thread=` collide — a Remember conversation cannot be shown while the Quiz
 * half is open — and the rules that resolve it are **navigations**, written in
 * `RememberBand` and `ConversationBand`
 * (src/web/modes/conversation/ConversationModes.tsx) rather than in the
 * parser. The cross-family review of
 * docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md asked
 * for both, because the rename touches **two** URL registrations — the paired
 * `useQueryStates` in `RememberBand` and the write-only `useQueryState` in
 * `ConversationBand` — and missing the second one is silent: opening a
 * conversation would go on writing the dead `review` key, and nothing on
 * screen would say so.
 *
 * docs/project/remember-mode.md · docs/project/url-state.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";
import { MODES, modeParam, REMEMBER_VIEWS, rememberParam } from "../src/web/params.js";

/* -------------------------------------------------------------- parsing -- */

describe("the mode key is `remember`, and `review` is not a mode any more", () => {
  it("recognises the new name", () => {
    expect(MODES).toContain("remember");
    expect(modeParam.parse("remember")).toBe("remember");
  });

  it("treats the old name as a mode this version has never had", () => {
    /* `null` is what `withDefault` turns into the default, so a bookmarked
       `?mode=review` shows the article rather than an error page — the same
       rule `?mode=toc` fell under when Hierarchy was renamed. There is
       deliberately no alias: it would squat on a name that now sits beside the
       unrelated Referee mode. */
    expect(MODES).not.toContain("review");
    expect(modeParam.parse("review")).toBeNull();
  });
});

describe("the sub-mode parameter is `?remember=`", () => {
  it("accepts both halves and nothing else", () => {
    expect(REMEMBER_VIEWS).toEqual(["recall", "quiz"]);
    for (const view of REMEMBER_VIEWS) expect(rememberParam.parse(view)).toBe(view);
    expect(rememberParam.parse("review")).toBeNull();
    expect(rememberParam.parse("")).toBeNull();
  });

  it("opens Recall when the value is unknown or absent", () => {
    expect(rememberParam.defaultValue).toBe("recall");
  });

  it("round-trips each half through the query string", () => {
    for (const view of REMEMBER_VIEWS) {
      expect(rememberParam.parse(rememberParam.serialize(view))).toBe(view);
    }
  });
});

/* ---------------------------------------------------------- navigation -- */

/** The props the panel was last handed. Stubbed: this file is about the URL. */
let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

/** The Quiz half, stubbed for the same reason — it fetches an artefact. */
vi.mock("../src/web/QuizPanel.js", () => ({
  QuizPanel: () => null,
  RememberSubModeToggle: () => null,
}));

const STORED: ChatThread = {
  id: "spya-k3m9qt",
  /* The **persisted** thread kind — src/types.ts § ThreadKind. Spelled `review`
     until 2026-09-01; the column moved with it in
     drizzle/0048_rename_review_thread_kind.sql. */
  kind: "remember",
  title: "What I took from it",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
  messages: [],
};

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: () =>
      Promise.resolve(
        new Response(JSON.stringify({ threads: [STORED] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
  };
});

const { ConversationBand, RememberBand } = await import(
  "../src/web/modes/conversation/ConversationModes.js"
);

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  panel = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * Wait for the query string to say something, rather than for a fixed number of
 * microtask turns.
 *
 * nuqs throttles its writes to `history`, so a URL assertion made a few ticks
 * after the setter fires is a race — and it is the kind that passes on an idle
 * laptop and fails when the suite is running sixteen files at once. Polling
 * makes the test say what it is waiting for.
 */
async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
}

/** What the query string says now. */
function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

async function mount(search: string, band: "remember" | "conversation"): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        band === "remember"
          ? createElement(RememberBand, {
              slug: "a-piece",
              blocks: new Map<string, string>(),
              onJump: () => {},
              onMode: () => {},
            })
          : createElement(ConversationBand, {
              slug: "a-piece",
              blocks: new Map<string, string>(),
              onJump: () => {},
              kind: "remember" as const,
              onMode: () => {},
            }),
      ),
    );
  });
  await settle();
}

describe("`?remember=` and `?thread=` cannot both be honoured", () => {
  it("drops the thread when a pasted URL asks for Quiz as well", async () => {
    /* Rule 2. Quiz wins, and `thread` goes with a *replace* rather than a push
       — a push would leave the broken combination one Back press away from the
       reader we have just rescued from it. */
    await mount("?mode=remember&remember=quiz&thread=spya-k3m9qt", "remember");
    await until(() => param("thread") === null);
    expect(param("remember")).toBe("quiz");
    expect(param("thread")).toBeNull();
  });

  it("leaves a thread alone when Recall is the half that is open", async () => {
    await mount("?mode=remember&thread=spya-k3m9qt", "remember");
    expect(param("thread")).toBe("spya-k3m9qt");
  });
});

describe("opening a conversation lands on Recall", () => {
  it("clears a stale `remember=quiz` left on the URL", async () => {
    /* Rule 3, and the registration the review warned about: this setter lives
       in `ConversationBand`, not in `RememberBand`, and it is write-only. A
       rename that moved only the paired registration would leave this one
       writing `review=recall` — a dead key — and the stale `remember=quiz`
       would survive a thread being opened, which is a conversation selected
       and invisible. */
    await mount("?mode=remember&remember=quiz", "conversation");
    const onThread = panel?.onThread as (id: string) => void;
    expect(typeof onThread).toBe("function");

    await act(async () => onThread(STORED.id));
    await until(() => param("thread") === STORED.id);

    expect(param("thread")).toBe(STORED.id);
    /* `recall` is the parameter's default, so writing it removes the key
       rather than spelling it out. Either way the Quiz half is shut. */
    expect(param("remember")).not.toBe("quiz");
  });

  it("never writes the retired `review` key", async () => {
    await mount("?mode=remember", "conversation");
    const onThread = panel?.onThread as (id: string) => void;
    await act(async () => onThread(STORED.id));
    await until(() => param("thread") === STORED.id);
    expect(param("review")).toBeNull();
  });
});

describe("a stale `?review=` is an unread key", () => {
  it("opens Recall despite it, and does not adopt its value", async () => {
    /* No alias, on Greg's licence. The old key is now an ordinary unknown
       parameter: it is neither read nor rewritten, and the band opens on the
       default half. */
    await mount("?mode=remember&review=quiz&thread=spya-k3m9qt", "remember");
    expect(param("remember")).toBeNull();
    expect(param("thread")).toBe("spya-k3m9qt");
    expect(param("review")).toBe("quiz");
  });
});
