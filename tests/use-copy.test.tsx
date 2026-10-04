// @vitest-environment jsdom
/**
 * `useCopy` — src/web/useCopy.ts, the one copy of what every copy button needs.
 *
 * The hook exists because eight hand-written copies of this lifecycle drifted,
 * and each drift was invisible on screen: a button that reports the *older* of
 * two presses, a tick that lasts a tenth of its time, a button that does
 * nothing at all where there is no clipboard. So each test below is written
 * against a particular wrong hook, named beside it, and was seen red against
 * that hook before it was believed
 * (docs/plans/261004e-fifth-sweep-cluster-20-one-copy-hook-for-the-nine-clipboard-writers.md
 * § Stages, stage 1).
 *
 * The last block is a source scan: nothing else under `src/web` may reach for
 * the clipboard by hand. It is what stops a ninth writer being copied from a
 * neighbour.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import { type Node, VISITOR_KEYS } from "@babel/types";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CopyOutcome, useCopy } from "../src/web/useCopy.js";

type Revert = Parameters<typeof useCopy>[0];
type Api = ReturnType<typeof useCopy>;

let host: HTMLDivElement;
let root: Root;
let mountedRoot = false;
/** What the hook last returned to the component below. */
let api: Api;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  /* Every test, not only the timing ones: `vi.getTimerCount()` is how a timer
     left running is seen, and it only counts fake ones. */
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mountedRoot = true;
});

afterEach(() => {
  unmount();
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
  vi.useRealTimers();
});

/** The smallest component that can hold the hook: the state as text, the rest handed out. */
function Probe({ revert }: { revert: Revert }) {
  const copy = useCopy(revert);
  api = copy;
  return <output>{copy.state}</output>;
}

function mount(revert: Revert, strict = false): void {
  act(() => {
    root.render(strict ? <StrictMode><Probe revert={revert} /></StrictMode> : <Probe revert={revert} />);
  });
}

function unmount(): void {
  if (!mountedRoot) return;
  mountedRoot = false;
  act(() => root.unmount());
}

const shown = () => host.querySelector("output")?.textContent ?? "(nothing rendered)";

/** One call of `writeText`, and the two ways the test can end it. */
type Write = { text: string; promise: Promise<void>; ok(): void; no(error: unknown): void };

/** A clipboard whose every write stays out until the test settles it. */
function clipboard(): Write[] {
  const writes: Write[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        let ok!: () => void;
        let no!: (error: unknown) => void;
        const promise = new Promise<void>((resolve, reject) => {
          ok = resolve;
          no = reject;
        });
        writes.push({ text, promise, ok, no });
        return promise;
      },
    },
  });
  return writes;
}

/** The write at `index`, or a failure that says the press never reached the clipboard. */
function nth(writes: Write[], index: number): Write {
  const write = writes[index];
  if (!write) throw new Error(`no write number ${index}: writeText was called ${writes.length} times`);
  return write;
}

/** Press: start a copy, as a click handler would. */
function press(text: string, said?: (outcome: CopyOutcome) => void): void {
  act(() => api.copy(text, said));
}

/** Do something to a pending write, and let its continuations run. */
async function settle(what: () => void): Promise<void> {
  await act(async () => {
    what();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const BOTH = { copiedMs: 1600, failedMs: 1600 } as const;

describe("how one write went", () => {
  it("is copied once the promise resolves, and not before", async () => {
    const writes = clipboard();
    const outcomes: CopyOutcome[] = [];
    mount(BOTH);
    press("the words", (o) => outcomes.push(o));
    expect(writes.map((w) => w.text)).toEqual(["the words"]);
    // Mid-flight the button must not be claiming anything.
    expect(shown()).toBe("idle");
    expect(outcomes).toEqual([]);
    await settle(() => nth(writes, 0).ok());
    expect(shown()).toBe("copied");
    expect(outcomes).toEqual([{ result: "copied" }]);
  });

  it("has called writeText by the time copy() returns", () => {
    /* Inside the reader's gesture, which is when a browser allows it.
       Wrong hook: one that awaits anything before the write. */
    const writes = clipboard();
    mount(BOTH);
    let during = -1;
    act(() => {
      api.copy("x");
      during = writes.length;
    });
    expect(during).toBe(1);
  });

  it("says unavailable before copy() returns where there is no clipboard object, and throws nothing", () => {
    /* Undefined in every insecure context. Wrong hook: the optional chain,
       `navigator.clipboard?.writeText(t).then(…)`, which does nothing at all;
       and one that makes the guard wait a microtask. */
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const outcomes: CopyOutcome[] = [];
    mount(BOTH);
    let during: CopyOutcome[] = [];
    expect(() =>
      act(() => {
        api.copy("x", (o) => outcomes.push(o));
        during = [...outcomes];
      }),
    ).not.toThrow();
    expect(during).toEqual([{ result: "unavailable" }]);
    expect(shown()).toBe("failed");
  });

  it("is refused, with the error, when the promise rejects", async () => {
    const writes = clipboard();
    const outcomes: CopyOutcome[] = [];
    const denied = new Error("denied");
    mount(BOTH);
    press("x", (o) => outcomes.push(o));
    await settle(() => nth(writes, 0).no(denied));
    expect(shown()).toBe("failed");
    expect(outcomes).toEqual([{ result: "refused", error: denied }]);
    expect((outcomes[0] as { error?: unknown }).error).toBe(denied);
  });

  it("is refused, inside the click, when writeText throws instead of rejecting", () => {
    const boom = new Error("boom");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          throw boom;
        },
      },
    });
    const outcomes: CopyOutcome[] = [];
    mount(BOTH);
    expect(() => press("x", (o) => outcomes.push(o))).not.toThrow();
    expect(outcomes).toEqual([{ result: "refused", error: boom }]);
    expect(shown()).toBe("failed");
  });
});

describe("two presses out at once", () => {
  it("reports the second's success when the first is refused afterwards", async () => {
    /* The worst case: "failed" over a clipboard holding what was asked for.
       Wrong hook: no token; a token checked only on success. */
    const writes = clipboard();
    const first = vi.fn();
    const second = vi.fn();
    mount(BOTH);
    press("one", first);
    press("two", second);
    expect(writes).toHaveLength(2);
    await settle(() => nth(writes, 1).ok());
    await settle(() => nth(writes, 0).no(new Error("denied")));
    expect(shown()).toBe("copied");
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ result: "copied" });
    expect(first).not.toHaveBeenCalled();
  });

  it("reports the second's failure when the first succeeds afterwards", async () => {
    /* Wrong hook: a token checked only on failure. */
    const writes = clipboard();
    const first = vi.fn();
    const second = vi.fn();
    mount(BOTH);
    press("one", first);
    press("two", second);
    await settle(() => nth(writes, 1).no(new Error("denied")));
    await settle(() => nth(writes, 0).ok());
    expect(shown()).toBe("failed");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("how long the feedback shows", () => {
  it("gives a second success its own full time", async () => {
    /* Wrong hook: a timer hung off an effect keyed on the state, where
       "copied" over "copied" re-runs nothing; and a timer that never fires. */
    const writes = clipboard();
    mount(BOTH);
    press("x");
    await settle(() => nth(writes, 0).ok());
    expect(shown()).toBe("copied");
    wait(1000);
    press("x");
    await settle(() => nth(writes, 1).ok());
    wait(1000);
    expect(shown()).toBe("copied");
    wait(700);
    expect(shown()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reverts a success after copiedMs and keeps a failure, with { 1500, null }", async () => {
    /* Wrong hook: one hard-coded duration. */
    const writes = clipboard();
    mount({ copiedMs: 1500, failedMs: null });
    press("x");
    await settle(() => nth(writes, 0).ok());
    wait(1499);
    expect(shown()).toBe("copied");
    wait(2);
    expect(shown()).toBe("idle");

    press("x");
    await settle(() => nth(writes, 1).no(new Error("denied")));
    expect(shown()).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
    wait(60_000);
    expect(shown()).toBe("failed");
  });

  it("keeps a success and reverts a failure after failedMs, with { null, 1600 }", async () => {
    const writes = clipboard();
    mount({ copiedMs: null, failedMs: 1600 });
    press("x");
    await settle(() => nth(writes, 0).no(new Error("denied")));
    wait(1599);
    expect(shown()).toBe("failed");
    wait(2);
    expect(shown()).toBe("idle");

    press("x");
    await settle(() => nth(writes, 1).ok());
    expect(shown()).toBe("copied");
    expect(vi.getTimerCount()).toBe(0);
    wait(60_000);
    expect(shown()).toBe("copied");
  });

  it("drops a failure's leftover timer when a success with no timer follows it", async () => {
    /* The timer is restarted by every outcome, and "restarted" has to include
       "stopped": otherwise the failure's 1600 ms would take away a tick that was
       asked to stay. */
    const writes = clipboard();
    mount({ copiedMs: null, failedMs: 1600 });
    press("x");
    await settle(() => nth(writes, 0).no(new Error("denied")));
    wait(1000);
    press("x");
    await settle(() => nth(writes, 1).ok());
    wait(5000);
    expect(shown()).toBe("copied");
  });

  it("reads the timings when a press settles, not when it starts", async () => {
    /* Which is what lets a caller pass a fresh object every render. */
    const writes = clipboard();
    mount(BOTH);
    press("x");
    mount({ copiedMs: null, failedMs: null });
    await settle(() => nth(writes, 0).ok());
    wait(60_000);
    expect(shown()).toBe("copied");
  });
});

describe("while a press is out", () => {
  it("leaves the feedback showing, and its timer running", async () => {
    /* Wrong hook: one that goes back to idle on the press, or stops the timer
       on the press. */
    const writes = clipboard();
    mount(BOTH);
    press("x");
    await settle(() => nth(writes, 0).ok());
    wait(1000);
    press("x");
    expect(shown()).toBe("copied");
    expect(vi.getTimerCount()).toBe(1);
    wait(599);
    expect(shown()).toBe("copied");
    // The first tick's own time runs out with the second press still out.
    wait(2);
    expect(shown()).toBe("idle");
    await settle(() => nth(writes, 1).ok());
    expect(shown()).toBe("copied");
  });
});

describe("reset()", () => {
  it("goes back to idle at once, and stops the timer", async () => {
    const writes = clipboard();
    mount(BOTH);
    press("x");
    await settle(() => nth(writes, 0).ok());
    expect(vi.getTimerCount()).toBe(1);
    act(() => api.reset());
    expect(shown()).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears feedback that had no timer", async () => {
    const writes = clipboard();
    mount({ copiedMs: null, failedMs: null });
    press("x");
    await settle(() => nth(writes, 0).no(new Error("denied")));
    expect(shown()).toBe("failed");
    act(() => api.reset());
    expect(shown()).toBe("idle");
  });

  it("overtakes a press still out, which then says nothing", async () => {
    /* FeedbackDialog's case: a press settles after the form was reset, and must
       not tick the fresh one. Wrong hook: a reset that does not bump the token. */
    const writes = clipboard();
    const said = vi.fn();
    mount(BOTH);
    press("x", said);
    act(() => api.reset());
    await settle(() => nth(writes, 0).ok());
    expect(shown()).toBe("idle");
    expect(said).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let the old timer cut a later press's tick short", async () => {
    const writes = clipboard();
    mount(BOTH);
    press("x");
    await settle(() => nth(writes, 0).ok());
    wait(1500);
    act(() => api.reset());
    press("x");
    await settle(() => nth(writes, 1).ok());
    wait(1000);
    expect(shown()).toBe("copied");
    wait(601);
    expect(shown()).toBe("idle");
  });
});

describe("after the component has gone", () => {
  it("says nothing, and starts no timer, for a press that was still out", async () => {
    /* Wrong hook: no mounted flag. */
    const writes = clipboard();
    const said = vi.fn();
    mount(BOTH);
    press("x", said);
    unmount();
    await settle(() => nth(writes, 0).ok());
    expect(said).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("says nothing for a refusal that arrives afterwards either", async () => {
    const writes = clipboard();
    const said = vi.fn();
    mount(BOTH);
    press("x", said);
    unmount();
    await settle(() => nth(writes, 0).no(new Error("denied")));
    expect(said).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer running when it goes while a tick is showing", async () => {
    /* Wrong hook: a cleanup that does not stop the timer. */
    const writes = clipboard();
    mount(BOTH);
    press("x");
    await settle(() => nth(writes, 0).ok());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("under StrictMode", () => {
  it("still ticks", async () => {
    /* The app mounts under StrictMode, which runs each effect's setup, cleanup,
       setup. Wrong hook: a mounted flag that starts true and is only ever
       cleared, which is false for the life of the component. */
    const writes = clipboard();
    const said = vi.fn();
    mount(BOTH, true);
    press("x", said);
    await settle(() => nth(writes, 0).ok());
    expect(shown()).toBe("copied");
    expect(said).toHaveBeenCalledTimes(1);
    wait(1601);
    expect(shown()).toBe("idle");
  });
});

describe("what a caller can rely on", () => {
  it("hands back the same copy and reset after a re-render with a new, equal options object", () => {
    /* Wrong hook: callbacks rebuilt when the options object changes. */
    clipboard();
    mount({ copiedMs: 1600, failedMs: 1600 });
    const before = api;
    mount({ copiedMs: 1600, failedMs: 1600 });
    expect(api).not.toBe(before);
    expect(api.copy).toBe(before.copy);
    expect(api.reset).toBe(before.reset);
  });

  it("calls said in the step that sets state, so nothing can come between them", async () => {
    /* A continuation registered on the same promise *after* the hook's own
       runs straight after it. If `said` were put off to a later step, this
       reset would land first and `said` would then speak for an overtaken
       press. Wrong hook: `queueMicrotask(() => said(outcome))`. */
    const writes = clipboard();
    const events: string[] = [];
    mount(BOTH);
    press("x", (o) => events.push(`said ${o.result}`));
    const write = nth(writes, 0);
    void write.promise.then(() => {
      events.push("reset");
      api.reset();
    });
    await settle(() => write.ok());
    expect(events).toEqual(["said copied", "reset"]);
    expect(shown()).toBe("idle");
  });

  it("does not call said for a write that resolved just before a reset", async () => {
    /* The write has settled; the hook has not heard yet. */
    const writes = clipboard();
    const said = vi.fn();
    mount(BOTH);
    press("x", said);
    await settle(() => {
      nth(writes, 0).ok();
      api.reset();
    });
    expect(said).not.toHaveBeenCalled();
    expect(shown()).toBe("idle");
  });

  it("does not call said for a write that resolved just before the unmount", async () => {
    const writes = clipboard();
    const said = vi.fn();
    mount(BOTH);
    press("x", said);
    nth(writes, 0).ok();
    unmount();
    await settle(() => {});
    expect(said).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * **Nothing else under `src/web` reaches for the clipboard by hand.**
 *
 * Read from the syntax tree, with `@babel/parser` as tests/stop-details.test.ts
 * does (this checkout's `typescript` has no `createSourceFile`,
 * docs/project/linting.md), so that the many comments explaining the guard are
 * not hits and a string is not a hit.
 *
 * A hit is any member access named `clipboard` (dotted, optional, or computed
 * with a string literal), `clipboard` taken out of an object by destructuring,
 * or any call of a member named `writeText`. It is a guard against a ninth
 * hand-written writer copied from a neighbour, not proof against a determined
 * alias: `const n = navigator; n[key]` walks straight past it.
 */
function clipboardHits(code: string): string[] {
  const tree = parse(code, { sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy"] });
  const named = (node: Node, computed: boolean, name: string): boolean =>
    (!computed && node.type === "Identifier" && node.name === name) ||
    (computed && node.type === "StringLiteral" && node.value === name);
  const member = (node: Node): node is Extract<Node, { type: "MemberExpression" | "OptionalMemberExpression" }> =>
    node.type === "MemberExpression" || node.type === "OptionalMemberExpression";
  /** What this one node is, if it is a reach for the clipboard. */
  const hitsAt = (node: Node): string[] => {
    if (member(node)) return named(node.property, node.computed, "clipboard") ? ["clipboard"] : [];
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      const callee = node.callee;
      return member(callee) && named(callee.property, callee.computed, "writeText") ? ["writeText()"] : [];
    }
    if (node.type === "ObjectPattern") {
      return node.properties
        .filter((p) => p.type === "ObjectProperty" && named(p.key, p.computed, "clipboard"))
        .map(() => "{ clipboard }");
    }
    return [];
  };
  const hits: string[] = [];
  const visit = (node: Node): void => {
    hits.push(...hitsAt(node));
    const fields = node as unknown as Record<string, unknown>;
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = fields[key];
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item != null) visit(item as Node);
      }
    }
  };
  visit(tree.program);
  return hits;
}

/* Not `new URL(…, import.meta.url)`: under jsdom `URL` is jsdom's, and node's
   `fileURLToPath` refuses it. */
const WEB = path.join(import.meta.dirname, "..", "src", "web");

describe("the source itself", () => {
  it.each([
    ["navigator.clipboard?.writeText(t);", ["writeText()", "clipboard"]],
    ["navigator.clipboard.writeText(t).then(done);", ["writeText()", "clipboard"]],
    ['const c = navigator["clipboard"];', ["clipboard"]],
    ["const c = navigator.clipboard;", ["clipboard"]],
    ["const c = navigator?.clipboard;", ["clipboard"]],
    ["if (!navigator.clipboard) fail();", ["clipboard"]],
    ["const { clipboard } = navigator;", ["{ clipboard }"]],
    ["const { clipboard: c } = navigator;", ["{ clipboard }"]],
    ["c.writeText(t);", ["writeText()"]],
    ["c?.writeText(t);", ["writeText()"]],
    ['c["writeText"](t);', ["writeText()"]],
    ["const el = <button onClick={() => void navigator.clipboard.writeText(t)} />;", ["writeText()", "clipboard"]],
  ])("sees a clipboard reach in: %s", (code, expected) => {
    expect(clipboardHits(code).sort()).toEqual([...expected].sort());
  });

  it("does not count a comment, a string, or a different name", () => {
    expect(
      clipboardHits(
        [
          "// navigator.clipboard?.writeText(text) is the careless way",
          "/* navigator.clipboard.writeText(text) */",
          "/** `navigator.clipboard` is undefined in every insecure context. */",
          'const note = "navigator.clipboard.writeText(text)";',
          "const tpl = `navigator.clipboard`;",
          // A paste event's data, a different member: src/web/feedback-screenshot.ts.
          "const image = firstImage(event.clipboardData);",
          // A variable or a key called clipboard is not an access to one.
          "const clipboard = 1; const o = { clipboard, writeText: 2 };",
          "const writeText = () => {}; writeText();",
          "const icon = <ClipboardCheck size={12} />;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("finds the hook, and in this stage the eight callers still to move", async () => {
    const entries = await readdir(WEB, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .map((e) => path.join(e.parentPath ?? WEB, e.name));
    /* Non-vacuity: a `readdir` that came back empty reads as a clean tree. */
    expect(files.length).toBeGreaterThan(100);

    const found: string[] = [];
    for (const file of files) {
      if (clipboardHits(await readFile(file, "utf8")).length > 0) {
        found.push(path.relative(WEB, file).split(path.sep).join("/"));
      }
    }
    /* Stages 2 and 3 of plan 261004e shrink this to `useCopy.ts` alone. A new
       name here is a ninth hand-written writer: use the hook instead. */
    expect(found.sort()).toEqual([
      "AccessSharing.tsx",
      "AnnotateDialog.tsx",
      "BlockGutter.tsx",
      "ChatPanel.tsx",
      "FeedbackDialog.tsx",
      "ShelfEntry.tsx",
      "Tweets.tsx",
      "ViewportProbe.tsx",
      "useCopy.ts",
    ]);
  });
});
