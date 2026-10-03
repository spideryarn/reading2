/**
 * **What a request to the topics route does with a model-named topic set**,
 * with a fake store and a fake model. src/shelf-topic-sets.ts; plan 261003f
 * § How it runs.
 */
import { describe, expect, it } from "vitest";

import { keyOf, type NamedTopic, type TopicCalls, TOPIC_SET_PROMPT_VERSION } from "../src/shelf-terms/model-topics.js";
import {
  MAX_WORKS,
  profileHashOf,
  type ShelfTopicSetDeps,
  shelfTopicSet,
  termsFromSet,
  whatIsDue,
  worksOf,
} from "../src/shelf-topic-sets.js";
import type { AllowanceTaken, ShelfTermsStore, StoredTopicSet, TopicSetResult, TopicShelfArticle } from "../src/store/contracts.js";
import type { LibraryTermsResponse } from "../src/types.js";

const MODEL = "test/model";

const article = (n: number, over: Partial<TopicShelfArticle> = {}): TopicShelfArticle => ({
  articleId: `a${n}`,
  slug: `slug-${n}`,
  archived: false,
  title: `Title ${n}`,
  gist: `Gist ${n}`,
  textHash: `hash-${n}`,
  ...over,
});
const shelfOf = (n: number): TopicShelfArticle[] => Array.from({ length: n }, (_, i) => article(i + 1));

const fallbackAnswer = (): LibraryTermsResponse => ({
  terms: [{ key: "principle", label: "principles", articles: [{ slug: "slug-1", count: 3 }] }],
  scope: { articles: 0, works: 0, skipped: 0 },
  pending: 2,
  chosenBy: "program",
  refreshing: false,
});

const result = (over: Partial<TopicSetResult> = {}): TopicSetResult => ({
  model: MODEL,
  promptVersion: TOPIC_SET_PROMPT_VERSION,
  profileHash: "",
  topics: [
    { id: "t1", key: "neuroscience", label: "Neuroscience", parent: null, depth: 0 },
    { id: "t2", key: "buddhism", label: "Buddhism", parent: null, depth: 0 },
    { id: "t3", key: "vision", label: "Vision", parent: "t1", depth: 1 },
  ],
  members: {},
  works: 0,
  unplaced: 0,
  ...over,
});

/** A store that holds one row in memory and records what was asked of it. */
function fakeStore(shelf: TopicShelfArticle[], initial: TopicSetResult | null = null) {
  const state: { row: StoredTopicSet | null; claim: string | null; log: string[]; shelf: TopicShelfArticle[]; onClaim: (() => void) | null } = {
    shelf,
    onClaim: null,
    row: initial ? { result: { ...initial, rethoughtAt: new Date(), filedAt: null }, claim: null, failures: 0, retryAfter: null } : null,
    claim: null,
    log: [],
  };
  const store = {
    topicShelf: async () => state.shelf,
    readTopicSet: async () => state.row,
    claimTopicSet: async () => {
      if (state.claim) return null;
      state.onClaim?.();
      state.claim = `claim-${state.log.length + 1}`;
      state.row = { result: state.row?.result ?? null, claim: { until: new Date(Date.now() + 60_000) }, failures: state.row?.failures ?? 0, retryAfter: null };
      state.log.push("claim");
      return state.claim;
    },
    writeTopicSet: async (claimId: string, r: TopicSetResult) => {
      if (claimId !== state.claim) return false;
      state.row = { result: { ...r, rethoughtAt: new Date(), filedAt: null }, claim: null, failures: 0, retryAfter: null };
      state.claim = null;
      state.log.push("write");
      return true;
    },
    fileIntoTopicSet: async (claimId: string, members: Record<string, string[]>) => {
      if (claimId !== state.claim || !state.row?.result) return false;
      state.row = { ...state.row, claim: null, result: { ...state.row.result, members: { ...state.row.result.members, ...members }, filedAt: new Date() } };
      state.claim = null;
      state.log.push("file");
      return true;
    },
    failTopicSet: async () => {
      state.claim = null;
      if (state.row) state.row = { ...state.row, claim: null, failures: state.row.failures + 1 };
      state.log.push("fail");
    },
    releaseTopicSet: async () => {
      state.claim = null;
      if (state.row) state.row = { ...state.row, claim: null };
      state.log.push("release");
    },
  } as unknown as ShelfTermsStore;
  return { store, state };
}

const named = (label: string, ids: string[]): NamedTopic => ({ label, key: keyOf(label), works: ids });

function depsFor(
  store: ShelfTermsStore,
  over: Partial<ShelfTopicSetDeps> = {},
): ShelfTopicSetDeps & { asked: { name: number; file: number; allowance: string[] } } {
  const asked = { name: 0, file: 0, allowance: [] as string[] };
  const calls: TopicCalls = {
    name: async (w, name) => {
      asked.name += 1;
      return name.within === null ? [named("Neuroscience", w.slice(0, 6).map((x) => x.id)), named("Buddhism", w.slice(6, 9).map((x) => x.id))] : [];
    },
    file: async (tree, w) => {
      asked.file += 1;
      /* Into the deepest topic shown. */
      const deepest = [...tree].sort((p, q) => q.depth - p.depth)[0]!;
      return new Map(w.map((x) => [x.id, [deepest.ref]]));
    },
  };
  return {
    store,
    allowance: {
      take: async (): Promise<AllowanceTaken> => {
        asked.allowance.push("take");
        return { kind: "allowed", id: "token" };
      },
      finish: async () => {
        asked.allowance.push("finish");
      },
    },
    fallback: async () => fallbackAnswer(),
    fillHashes: async () => 0,
    readProfile: async () => null,
    hasKey: () => true,
    calls,
    model: MODEL,
    asked,
    ...over,
  };
}

describe("worksOf", () => {
  it("counts exact copies as one work, newest first, and an unhashed article as its own", () => {
    const shelf = [article(1), article(2, { textHash: "hash-1" }), article(3, { textHash: null }), article(4, { textHash: null })];
    const got = worksOf(shelf);
    expect(got.map((w) => [w.id, w.articles.map((a) => a.articleId)])).toEqual([
      ["a1", ["a1", "a2"]],
      ["a3", ["a3"]],
      ["a4", ["a4"]],
    ]);
  });
});

describe("termsFromSet", () => {
  const shelf = [article(1), article(2), article(3, { archived: true }), article(4, { textHash: "hash-1" })];
  const set = result({ members: { a1: ["t1", "t3"], a2: ["t1"], a3: ["t2"] } });

  it("is broad first, cuts to the articles in view, and gives a copy its work's topics", () => {
    const terms = termsFromSet(set, worksOf(shelf), (a) => !a.archived);
    expect(terms.map((t) => `${t.label}:${t.granularity}:${t.within ?? "-"}:${t.articles.map((a) => a.slug).join("+")}`)).toEqual([
      "Neuroscience:0:-:slug-1+slug-4+slug-2",
      "Vision:0.5:neuroscience:slug-1+slug-4",
    ]);
    /* No phrase count on a model-named topic, rather than a made-up one. */
    expect(terms[0]!.articles[0]).toEqual({ slug: "slug-1" });
  });

  it("brings an archived article's topic back when archived articles are in view", () => {
    const terms = termsFromSet(set, worksOf(shelf), () => true);
    expect(terms.map((t) => t.label)).toEqual(["Neuroscience", "Buddhism", "Vision"]);
  });
});

describe("whatIsDue", () => {
  const filedAll = (n: number, topics: string[] = ["t1"]) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i + 1}`, topics]));
  const row = (r: TopicSetResult | null): StoredTopicSet => ({
    result: r ? { ...r, rethoughtAt: new Date(), filedAt: null } : null,
    claim: null,
    failures: 0,
    retryAfter: null,
  });
  const due = (stored: StoredTopicSet | null, n: number, profile = "") => whatIsDue(stored, worksOf(shelfOf(n)), MODEL, profile);

  it("asks nothing below eight works", () => {
    expect(due(null, 7).kind).toBe("nothing");
    expect(due(null, 8).kind).toBe("rethink");
  });

  it("re-thinks when the model, the prompt version or the reader's profile changed", () => {
    const filed = { works: 10, members: filedAll(10) };
    expect(due(row(result(filed)), 10).kind).toBe("nothing");
    expect(due(row(result({ ...filed, model: "old/model" })), 10).kind).toBe("rethink");
    expect(due(row(result({ ...filed, promptVersion: 0 })), 10).kind).toBe("rethink");
    expect(due(row(result(filed)), 10, profileHashOf("I read neuroscience")).kind).toBe("rethink");
    expect(due(row(result({ ...filed, profileHash: profileHashOf(" I read neuroscience\r\n") })), 10, profileHashOf("I read neuroscience")).kind).toBe("nothing");
  });

  it("files a few new works, and re-thinks once the shelf has grown by a quarter and at least five", () => {
    const stored = row(result({ works: 20, members: filedAll(20) }));
    const few = due(stored, 24);
    expect(few.kind === "file" && few.works.map((w) => w.id)).toEqual(["a21", "a22", "a23", "a24"]);
    expect(due(stored, 25).kind).toBe("rethink");
    /* On a small shelf a quarter is two works; the floor of five holds it back. */
    const small = row(result({ works: 8, members: filedAll(8) }));
    expect(due(small, 12).kind).toBe("file");
    expect(due(small, 13).kind).toBe("rethink");
  });

  it("re-thinks when the shelf has shrunk by a quarter, so the tree does not describe a shelf that is gone", () => {
    const stored = row(result({ works: 100, members: filedAll(100) }));
    expect(due(stored, 76).kind).toBe("nothing");
    expect(due(stored, 75).kind).toBe("rethink");
  });

  it("re-thinks when works that fit no topic have piled up since the last one, and not before", () => {
    const members = { ...filedAll(40), a36: [], a37: [], a38: [], a39: [], a40: [] };
    /* Five unplaced, none of them new since the re-think: nothing to do, and no loop. */
    expect(due(row(result({ works: 40, members, unplaced: 5 })), 40).kind).toBe("nothing");
    /* The same five when the re-think had placed everything: five more, and a tenth of the shelf. */
    expect(due(row(result({ works: 40, members, unplaced: 0 })), 40).kind).toBe("rethink");
  });

  it("does not file a copy of a work that is already filed", () => {
    const shelf = [...shelfOf(10), article(11, { textHash: "hash-1" })];
    expect(whatIsDue(row(result({ works: 10, members: filedAll(10) })), worksOf(shelf), MODEL, "").kind).toBe("nothing");
  });

  it("above the cap: never a re-think, but new works are still filed into the tree there is", () => {
    expect(due(null, MAX_WORKS).kind).toBe("rethink");
    expect(due(null, MAX_WORKS + 1).kind).toBe("nothing");
    const stored = row(result({ works: 100, members: filedAll(MAX_WORKS), model: "old/model" }));
    const got = due(stored, MAX_WORKS + 3);
    expect(got.kind === "file" && got.works).toHaveLength(3);
    expect(due(row(result({ works: 100, members: filedAll(MAX_WORKS + 3) })), MAX_WORKS + 3).kind).toBe("nothing");
  });
});

describe("shelfTopicSet", () => {
  const filedAll = (n: number, topics: string[] = ["t1"]) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i + 1}`, topics]));

  it("with no tree: answers with the fallback, says refreshing, and the refresh stores a re-think", async () => {
    const { store, state } = fakeStore(shelfOf(10));
    const deps = depsFor(store, { readProfile: async () => "I read neuroscience" });
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(response.chosenBy).toBe("program");
    expect(response.terms[0]!.label).toBe("principles");
    expect(response.refreshing).toBe(true);
    expect(deps.asked.name).toBe(0);
    await refresh?.();
    expect(state.log).toEqual(["claim", "write"]);
    expect(deps.asked.allowance).toEqual(["take", "finish"]);
    expect(state.row?.result?.works).toBe(10);
    expect(state.row?.result?.profileHash).toBe(profileHashOf("I read neuroscience"));
    /* Works 1–6 Neuroscience, 7–9 Buddhism, 10 placed nowhere and still recorded. */
    expect(state.row?.result?.members.a1).toEqual(["t1"]);
    expect(state.row?.result?.members.a10).toEqual([]);
    expect(state.row?.result?.unplaced).toBe(1);

    const again = await shelfTopicSet(false, deps);
    expect(again.response.chosenBy).toBe("model");
    expect(again.response.terms.map((t) => `${t.label} ${t.articles.length}`)).toEqual(["Neuroscience 6", "Buddhism 3"]);
    /* The counts are the model path's own: every article read, none skipped. */
    expect(again.response.scope).toEqual({ articles: 10, works: 10, skipped: 0 });
    /* `pending` is the phrase program's and is left alone, so its reading carries on. */
    expect(again.response.pending).toBe(2);
    expect(again.response.sorting).toBeUndefined();
    expect(again.response.refreshing).toBe(false);
    expect(again.refresh).toBeNull();
  });

  it("a new article is filed by itself, without a re-think, and the answer says it is waiting", async () => {
    const { store, state } = fakeStore(shelfOf(21), result({ works: 20, members: filedAll(20) }));
    const deps = depsFor(store);
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(response.chosenBy).toBe("model");
    expect(response.refreshing).toBe(true);
    expect(response.sorting).toBe(1);
    await refresh?.();
    expect(state.log).toEqual(["claim", "file"]);
    expect(deps.asked).toMatchObject({ name: 0, file: 1 });
    /* The fake files into the deepest topic shown (Vision); its parent comes with it. */
    expect(state.row?.result?.members.a21).toEqual(["t1", "t3"]);
    expect(state.row?.result?.members.a1).toEqual(["t1"]);
    expect((await shelfTopicSet(false, deps)).response.sorting).toBeUndefined();
  });

  it("waits for exact-copy hashes across the whole shelf before doing paid work", async () => {
    const shelf = shelfOf(10);
    shelf[9] = article(10, { textHash: null, archived: true });
    const { store, state } = fakeStore(shelf);
    const deps = depsFor(store, { fillHashes: async () => 1 });
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(response.pending).toBeGreaterThan(0);
    expect(refresh).toBeNull();
    expect(state.log).toEqual([]);
    expect(deps.asked).toMatchObject({ name: 0, file: 0, allowance: [] });
  });

  it("re-reads the shelf after the last exact-copy hash is filled", async () => {
    const shelf = shelfOf(10);
    shelf[9] = article(10, { textHash: null });
    const { store, state } = fakeStore(shelf);
    const deps = depsFor(store, {
      fillHashes: async () => {
        state.shelf[9] = article(10, { textHash: "hash-1" });
        return 0;
      },
    });
    const { refresh } = await shelfTopicSet(false, deps);
    await refresh?.();
    /* Ten articles but nine works after the new hash groups the copy. */
    expect(state.row?.result?.works).toBe(9);
    expect(state.row?.result?.members.a1).toEqual(state.row?.result?.members.a10);
  });

  it("rebuilds the answer when a new hash makes an active article inherit an archived copy's topics", async () => {
    const shelf = shelfOf(10);
    shelf[0] = article(1, { textHash: null });
    shelf[9] = article(10, { archived: true, textHash: "copy" });
    const members = { ...filedAll(10) };
    delete members.a1;
    members.a10 = ["t2"];
    const { store, state } = fakeStore(shelf, result({ works: 9, members }));
    const deps = depsFor(store, {
      fillHashes: async () => {
        state.shelf[0] = article(1, { textHash: "copy" });
        return 0;
      },
    });
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(refresh).toBeNull();
    expect(response.sorting).toBeUndefined();
    expect(response.terms.find((t) => t.key === "buddhism")?.articles).toEqual([{ slug: "slug-1" }]);
  });

  it("restores the fallback when final hashes take the shelf below eight works", async () => {
    const shelf = shelfOf(8);
    shelf[7] = article(8, { textHash: null });
    const { store, state } = fakeStore(shelf, result({ works: 8, members: filedAll(8) }));
    const deps = depsFor(store, {
      fillHashes: async () => {
        state.shelf[7] = article(8, { textHash: "hash-1" });
        return 0;
      },
    });
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(refresh).toBeNull();
    expect(response.chosenBy).toBe("program");
    expect(response.terms[0]?.label).toBe("principles");
  });

  it("decides again under the claim: a request that read an older row does not redo what another just wrote", async () => {
    const { store, state } = fakeStore(shelfOf(21), result({ works: 20, members: filedAll(20) }));
    /* Between this request's first read and its claim, somebody else files a21. */
    state.onClaim = () => {
      state.row = { ...state.row!, result: { ...state.row!.result!, members: { ...state.row!.result!.members, a21: ["t2"] } } };
      state.onClaim = null;
    };
    const deps = depsFor(store);
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(refresh).toBeNull();
    expect(response.refreshing).toBe(true);
    expect(state.log).toEqual(["claim", "release"]);
    expect(deps.asked).toMatchObject({ name: 0, file: 0, allowance: [] });
    expect(state.row?.result?.members.a21).toEqual(["t2"]);
  });

  it("tries the failure path if handing back pre-refresh work throws", async () => {
    const { store, state } = fakeStore(shelfOf(21), result({ works: 20, members: filedAll(20) }));
    state.onClaim = () => {
      state.row = { ...state.row!, result: { ...state.row!.result!, members: { ...state.row!.result!.members, a21: ["t2"] } } };
      state.onClaim = null;
    };
    store.releaseTopicSet = async () => {
      state.log.push("release-throws");
      throw new Error("database unavailable");
    };
    const { refresh } = await shelfTopicSet(false, depsFor(store));
    expect(refresh).toBeNull();
    expect(state.log).toEqual(["claim", "release-throws", "fail"]);
    expect(state.claim).toBeNull();
  });

  it("an article that arrives while a re-think runs is filed in the same handler", async () => {
    const { store, state } = fakeStore(shelfOf(10));
    const deps = depsFor(store);
    const inner = deps.calls.name;
    deps.calls = {
      ...deps.calls,
      name: async (w, name, forbid) => {
        state.shelf = [article(11), ...shelfOf(10)];
        return inner(w, name, forbid);
      },
    };
    const { refresh } = await shelfTopicSet(false, deps);
    await refresh?.();
    expect(state.log).toEqual(["claim", "write", "claim", "file"]);
    expect(state.row?.result?.works).toBe(10);
    expect(state.row?.result?.members.a11).toBeDefined();
    expect(deps.asked.allowance).toEqual(["take", "finish"]);
  });

  it("re-reads under the drain's claim and never files old topic ids into a newer tree", async () => {
    const { store, state } = fakeStore(shelfOf(10));
    const deps = depsFor(store);
    const inner = deps.calls.name;
    deps.calls = {
      ...deps.calls,
      name: async (w, name, forbid) => {
        state.shelf = [article(11), ...shelfOf(10)];
        state.onClaim = () => {
          state.row = {
            ...state.row!,
            result: {
              ...result({
                topics: [{ id: "t9", key: "current", label: "Current", parent: null, depth: 0 }],
                members: filedAll(10, ["t9"]),
                works: 10,
              }),
              rethoughtAt: new Date(),
              filedAt: null,
            },
          };
          state.onClaim = null;
        };
        return inner(w, name, forbid);
      },
    };
    const { refresh } = await shelfTopicSet(false, deps);
    await refresh?.();
    expect(state.log).toEqual(["claim", "write", "claim", "file"]);
    expect(state.row?.result?.topics.map((t) => t.id)).toEqual(["t9"]);
    expect(state.row?.result?.members.a11).toEqual(["t9"]);
  });

  it("does not forget a filing claim when handing it back throws", async () => {
    const { store, state } = fakeStore(shelfOf(21), result({ works: 20, members: filedAll(20) }));
    const deps = depsFor(store);
    store.fileIntoTopicSet = async () => false;
    store.releaseTopicSet = async () => {
      state.log.push("release-throws");
      throw new Error("database unavailable");
    };
    const { refresh } = await shelfTopicSet(false, deps);
    await refresh?.();
    expect(state.log).toEqual(["claim", "release-throws", "fail"]);
    expect(state.claim).toBeNull();
    expect(deps.asked.allowance).toEqual(["take", "finish"]);
  });

  it("a failed call counts, frees the allowance, and leaves the stored tree in use", async () => {
    const { store, state } = fakeStore(shelfOf(21), result({ works: 20, members: filedAll(20) }));
    const deps = depsFor(store);
    deps.calls = { name: async () => [], file: async () => Promise.reject(new Error("provider down")) };
    const { refresh } = await shelfTopicSet(false, deps);
    await refresh?.();
    expect(state.log).toEqual(["claim", "fail"]);
    expect(deps.asked.allowance).toEqual(["take", "finish"]);
    expect((await shelfTopicSet(false, depsFor(store, { hasKey: () => false }))).response.chosenBy).toBe("model");
  });

  it("with no key: nothing is claimed", async () => {
    const { store, state } = fakeStore(shelfOf(10));
    const { response, refresh } = await shelfTopicSet(false, depsFor(store, { hasKey: () => false }));
    expect(response.refreshing).toBe(false);
    expect(refresh).toBeNull();
    expect(state.log).toEqual([]);
  });

  it("while somebody else holds the claim: says refreshing and does nothing", async () => {
    const { store, state } = fakeStore(shelfOf(10));
    state.row = { result: null, claim: { until: new Date(Date.now() + 60_000) }, failures: 0, retryAfter: null };
    const deps = depsFor(store);
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(response.refreshing).toBe(true);
    expect(refresh).toBeNull();
    expect(deps.asked.allowance).toEqual([]);
  });

  it("a refused allowance releases the claim without counting a failure", async () => {
    const { store, state } = fakeStore(shelfOf(10));
    const deps = depsFor(store);
    deps.allowance = { take: async () => ({ kind: "rate" }), finish: async () => {} };
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(refresh).toBeNull();
    expect(response.refreshing).toBe(false);
    expect(state.log).toEqual(["claim", "release"]);
  });

  it("a store that cannot be read leaves the fallback standing", async () => {
    const { store } = fakeStore(shelfOf(10));
    (store as unknown as { topicShelf: () => Promise<never> }).topicShelf = async () => Promise.reject(new Error("no such table"));
    const { response, refresh } = await shelfTopicSet(false, depsFor(store));
    expect(response.terms[0]!.label).toBe("principles");
    expect(refresh).toBeNull();
  });

  it("the active shelf does not show a topic only archived articles are in", async () => {
    const shelf = [...shelfOf(9), article(10, { archived: true })];
    const { store } = fakeStore(shelf, result({ works: 10, members: { ...filedAll(9), a10: ["t2"] } }));
    const active = await shelfTopicSet(false, depsFor(store));
    const all = await shelfTopicSet(true, depsFor(store));
    expect(active.response.terms.map((t) => t.label)).toEqual(["Neuroscience"]);
    expect(active.response.scope).toEqual({ articles: 9, works: 9, skipped: 0 });
    expect(all.response.terms.map((t) => t.label)).toEqual(["Neuroscience", "Buddhism"]);
  });

  it("a shelf that has dropped below eight works shows the phrase row again, tree or no tree", async () => {
    const { store, state } = fakeStore(shelfOf(7), result({ works: 8, members: filedAll(8) }));
    const { response, refresh } = await shelfTopicSet(false, depsFor(store));
    expect(response.chosenBy).toBe("program");
    expect(refresh).toBeNull();
    expect(state.log).toEqual([]);
  });

  it("above the cap with no tree: the phrase row, and no model work", async () => {
    const { store, state } = fakeStore(shelfOf(MAX_WORKS + 1));
    const deps = depsFor(store);
    const { response, refresh } = await shelfTopicSet(false, deps);
    expect(response.chosenBy).toBe("program");
    expect(response.refreshing).toBe(false);
    expect(refresh).toBeNull();
    expect(state.log).toEqual([]);
  });
});
