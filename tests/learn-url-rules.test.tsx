// @vitest-environment jsdom
/**
 * **The URL after Review became Remember and then Learn, and the two rules
 * that are navigations rather than parsing.**
 *
 * The mode key moved from `review` to `remember` on 2026-09-01, and so did its
 * sub-mode parameter — `?review=recall|quiz` became `?remember=recall|quiz`.
 * Both moved again on 2026-10-06, to `learn` and `?learn=`; what is left of
 * `remember` is pinned in tests/learn-name.test.ts.
 * Greg's licence for the first rename was explicit that no alias is kept:
 *
 * > We have no real users yet, so it's fine to break things (e.g. urls) without
 * > aliases etc.
 *
 * So the first half of this file pins what the parsers now accept and, just as
 * importantly, what they now refuse: a `?mode=review` link lands on the article
 * rather than on Learn, and a stale `?review=quiz` is an unread key.
 *
 * The second half is the part a parser test cannot reach. `?learn=` and
 * `?thread=` collide — a Learn conversation cannot be shown while the Quiz
 * half is open — and the rules that resolve it are **navigations**, written in
 * `LearnBand` and `ConversationBand`
 * (src/web/modes/conversation/ConversationModes.tsx) rather than in the
 * parser. The cross-family review of
 * docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md asked
 * for both, because the rename touches **two** URL registrations — the paired
 * `useQueryStates` in `LearnBand` and the write-only `useQueryState` in
 * `ConversationBand` — and missing the second one is silent: opening a
 * conversation would go on writing the dead `review` key, and nothing on
 * screen would say so.
 *
 * docs/project/learn-mode.md · docs/project/url-state.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";
import type { QuizRead } from "../src/web/useQuiz.js";
import { MODES, modeParam, LEARN_VIEWS, learnParam } from "../src/web/params.js";
import type { QuizSections } from "../src/web/QuizPanel.js";

const NO_QUIZ_SECTIONS: QuizSections = { sections: [], rowOf: new Map() };

/* -------------------------------------------------------------- parsing -- */

describe("the mode key is `learn`, and `review` is not a mode any more", () => {
  it("recognises the new name", () => {
    expect(MODES).toContain("learn");
    expect(modeParam.parse("learn")).toBe("learn");
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

describe("the sub-mode parameter is `?learn=`", () => {
  it("accepts its four views, in the order the chips are drawn, and nothing else", () => {
    expect(LEARN_VIEWS).toEqual(["recall", "tutorial", "explore", "quiz"]);
    for (const view of LEARN_VIEWS) expect(learnParam.parse(view)).toBe(view);
    expect(learnParam.parse("review")).toBeNull();
    expect(learnParam.parse("")).toBeNull();
  });

  it("opens Recall when the value is unknown or absent", () => {
    expect(learnParam.defaultValue).toBe("recall");
  });

  it("round-trips each half through the query string", () => {
    for (const view of LEARN_VIEWS) {
      expect(learnParam.parse(learnParam.serialize(view))).toBe(view);
    }
  });
});

/* ---------------------------------------------------------- navigation -- */

/** The props the panel was last handed. Stubbed: this file is about the URL. */
let panel: Record<string, unknown> | undefined;
/** The Quiz panel separately, for the Learn → Quiz prop seam. */
let quizPanel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

/** The Quiz half, stubbed for the same reason — it fetches an artefact. */
vi.mock("../src/web/QuizPanel.js", () => ({
  QuizPanel: (props: Record<string, unknown>) => {
    quizPanel = props;
    return null;
  },
  LearnSubModeToggle: () => null,
}));

const STORED: ChatThread = {
  id: "spya-k3m9qt",
  /* The **persisted** thread kind — src/types.ts § ThreadKind. Spelled `review`
     until 2026-09-01; the column moved with it in
     drizzle/0048_rename_review_thread_kind.sql. */
  kind: "learn",
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

const { ConversationBand, LearnBand } = await import(
  "../src/web/modes/conversation/ConversationModes.js"
);

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  panel = undefined;
  quizPanel = undefined;
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

/** `OwnedReader`'s quiz read, posed: nothing written yet. src/web/useQuiz.ts § QuizRead. */
const QUIZ_READ: QuizRead = {
  status: "none",
  quiz: null,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  kept: new Map(),
  keptUnread: false,
  noteMark: () => {},
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};

async function mount(
  search: string,
  band: "learn" | "conversation",
  sections: QuizSections = NO_QUIZ_SECTIONS,
): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        band === "learn"
          ? createElement(LearnBand, {
              slug: "a-piece",
              quizRead: QUIZ_READ,
              blocks: new Map<string, string>(),
              sections,
              onJump: () => {},
            })
          : createElement(ConversationBand, {
              slug: "a-piece",
              blocks: new Map<string, string>(),
              onJump: () => {},
              kind: "learn" as const,
            }),
      ),
    );
  });
  await settle();
}

describe("`?learn=` and `?thread=` cannot both be honoured", () => {
  it("drops the thread when a pasted URL asks for Quiz as well", async () => {
    /* Rule 2. Quiz wins, and `thread` goes with a *replace* rather than a push
       — a push would leave the broken combination one Back press away from the
       reader we have just rescued from it. */
    await mount("?mode=learn&learn=quiz&thread=spya-k3m9qt", "learn");
    await until(() => param("thread") === null);
    expect(param("learn")).toBe("quiz");
    expect(param("thread")).toBeNull();
  });

  it("leaves a thread alone when Recall is the half that is open", async () => {
    await mount("?mode=learn&thread=spya-k3m9qt", "learn");
    expect(param("thread")).toBe("spya-k3m9qt");
  });
});

describe("the Quiz prop seam", () => {
  it("carries the Reader's section projection through LearnBand and QuizSubBand", async () => {
    const sections = { sections: [], rowOf: new Map() };
    await mount("?mode=learn&learn=quiz", "learn", sections);
    expect(quizPanel?.sections).toBe(sections);
  });
});

/*
 * Rule 3 — opening a Learn conversation from chat's shared list set
 * `learn=recall` in the same navigation — was tested here until 2026-10-01.
 * It went with the shared list (plan 261001m): chat no longer lists Learn
 * conversations, so `ConversationBand` no longer registers `?learn=` at all,
 * and Recall writes `?thread=` itself. What is left to pin is that it writes the
 * live key and only that.
 */
describe("Recall writes its one conversation into `?thread=`", () => {
  it("names the Learn conversation, and never writes the retired `review` key", async () => {
    await mount("?mode=learn", "conversation");
    await until(() => param("thread") === STORED.id);
    expect(param("thread")).toBe(STORED.id);
    expect(panel?.threadId).toBe(STORED.id);
    expect(param("review")).toBeNull();
  });
});

describe("a stale `?review=` is an unread key", () => {
  it("opens Recall despite it, and does not adopt its value", async () => {
    /* No alias, on Greg's licence. The old key is now an ordinary unknown
       parameter: it is neither read nor rewritten, and the band opens on the
       default half. */
    await mount("?mode=learn&review=quiz&thread=spya-k3m9qt", "learn");
    expect(param("learn")).toBeNull();
    expect(param("thread")).toBe("spya-k3m9qt");
    expect(param("review")).toBe("quiz");
  });
});
