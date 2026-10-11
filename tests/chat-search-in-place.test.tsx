// @vitest-environment jsdom
/**
 * **A search button in a chat answer runs where it is** — plan
 * docs/plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md,
 * on Greg's report spya-ma72mx: *"It shouldn't take me to the search mode
 * because that's really disorienting, and I might want to search for multiple
 * things."*
 *
 * Inside a chat surface (`ChatSearchHere`), the reader's press on a
 * `quick-search` chip posts the quick search and draws what it found in the
 * button's place, as block links; it never calls the executor's runner, which
 * is the one that switches the band to Search. A `find` chip matches the exact
 * words in place. Nothing runs on the draw.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, SearchRun } from "../src/types.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;
const asked: { url: string; init: RequestInit; reader: string | null | undefined }[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const apiFetch = (url: string, init: RequestInit = {}, reader?: string | null) => {
    asked.push({ url, init, reader });
    return answer(url, init);
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}, reader?: string | null) => {
      const r = await apiFetch(url, init, reader);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const went: string[] = [];
vi.mock("../src/web/router.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/router.js")>();
  return { ...real, navigate: (href: string) => went.push(href) };
});

const { CitedMarkdown } = await import("../src/web/Cited.js");
const { ChatSearchHere } = await import("../src/web/ChatSearchCard.js");
const { resetChatSearches } = await import("../src/web/chat-searches.js");
const { SignedInReader } = await import("../src/web/lib/made-for.js");

const SLUG = "a-piece";
const block = (id: string, text: string): Block =>
  ({ id: id as BlockId, tag: "p", kind: "text", text, words: text.split(" ").length, html: `<p>${text}</p>`, gistable: true }) as Block;
const ARTICLE: Block[] = [
  block("spya-aaaaaa", "A rhizome has multiple entryways and no centre."),
  block("spya-bbbbbb", "The tree is a centred system with a hierarchy."),
  block("spya-cccccc", "Make a map, not a tracing; a map has multiple entryways."),
];
const BLOCKS = new Map(ARTICLE.map((b) => [b.id as string, b.text]));
const CLOSE: ActionOutcome = { kind: "close" };

let host: HTMLDivElement;
let root: Root;
let jumped: string[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  asked.length = 0;
  went.length = 0;
  jumped = [];
  resetChatSearches();
  answer = (url) => Promise.resolve(json(url.endsWith(SLUG) ? { runs: [] } : {}));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const run = (over: Partial<SearchRun> = {}): SearchRun => ({
  id: "spya-run001",
  criterion: "centred systems",
  kind: "quick",
  createdAt: "2026-10-11T09:23:00.000Z",
  status: "done",
  hits: [
    { blockId: "spya-bbbbbb" as BlockId, quote: "", confidence: 90, reasoning: "" },
    { blockId: "spya-aaaaaa" as BlockId, quote: "", confidence: 70, reasoning: "" },
  ],
  ...over,
});

function stream(done: SearchRun): Response {
  const frames =
    `event: begin\ndata: ${JSON.stringify({ ...done, status: "pending", hits: [] })}\n\n` +
    done.hits.map((hit) => `event: hit\ndata: ${JSON.stringify({ hit })}\n\n`).join("") +
    `event: done\ndata: ${JSON.stringify(done)}\n\n`;
  return new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function executor(runners: Partial<CommandExecutor["runners"]>): CommandExecutor {
  return { runners: runners as CommandExecutor["runners"], sources: {} };
}

function paint(text: string, commands: CommandExecutor, inChat = true, reader?: string): void {
  const cited = createElement(CitedMarkdown, { text, blocks: BLOCKS, onJump: () => {}, links: true, commands });
  const content = inChat
    ? <ChatSearchHere place={{ slug: SLUG, blocks: ARTICLE, jump: (id: BlockId) => jumped.push(id) }}>
        {cited}
      </ChatSearchHere>
    : cited;
  act(() => {
    root.render(reader === undefined ? content : <SignedInReader.Provider value={reader}>{content}</SignedInReader.Provider>);
  });
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const chips = () => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];
const links = () => [...host.querySelectorAll<HTMLAnchorElement>(".chat-search-hits a")].map((a) => a.dataset.blockLink);
const posts = () => asked.filter((a) => a.init.method === "POST");

describe("a quick-search button in a chat answer", () => {
  it("runs the quick search in place and lists what it found, without switching to Search", async () => {
    const quick = vi.fn((_p: { words: string }) => CLOSE);
    answer = (_url, init) =>
      Promise.resolve(init.method === "POST" ? stream(run()) : json({ runs: [] }));
    paint("Here is one.\n\n[cmd:quick-search:centred%20systems]", executor({ "quick-search": quick }));
    await flush();
    expect(posts()).toHaveLength(0);

    await act(async () => chips()[0]?.click());
    await flush();

    expect(quick).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.url).toBe(`/api/search/${SLUG}`);
    expect(JSON.parse(String(posts()[0]?.init.body))).toMatchObject({ criterion: "centred systems", kind: "quick" });
    // In the article's order, not the model's.
    expect(links()).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
    expect(host.textContent).toContain("2 passages.");
    const open = host.querySelector<HTMLAnchorElement>("a.chat-search-open");
    expect(open?.getAttribute("href")).toContain("mode=search");
    expect(open?.getAttribute("href")).toContain("runs=spya-run001");
    expect(went).toEqual([]);
  });

  it("shows one search for two buttons with the same words, and asks once", async () => {
    answer = (_url, init) => Promise.resolve(init.method === "POST" ? stream(run()) : json({ runs: [] }));
    paint(
      "One.\n\n[cmd:quick-search:centred%20systems]\n\nTwo.\n\n[cmd:quick-search:Centred%20%20systems]",
      executor({ "quick-search": () => CLOSE }),
    );
    await flush();
    const both = chips();
    await act(async () => {
      both[0]?.click();
      both[1]?.click();
    });
    await flush();
    expect(posts()).toHaveLength(1);
    expect(host.querySelectorAll(".chat-search-ran")).toHaveLength(2);
  });

  it("draws a finished saved search with the same words without a press", async () => {
    answer = (url) => Promise.resolve(json(url.endsWith(SLUG) ? { runs: [run({ criterion: "Centred systems" })] } : {}));
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    expect(posts()).toHaveLength(0);
    expect(links()).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
  });

  it("puts the button back with the reason when the search fails, and a press asks again", async () => {
    answer = (_url, init) =>
      Promise.resolve(init.method === "POST" ? json({ error: "No." }, 500) : json({ runs: [] }));
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    await act(async () => chips()[0]?.click());
    await flush();
    expect(chips()).toHaveLength(1);
    expect(host.querySelector(".cmd-chip-said")).not.toBeNull();
    await act(async () => chips()[0]?.click());
    await flush();
    expect(posts()).toHaveLength(2);
  });

  it("retries a streamed error under the server's actual id", async () => {
    let attempt = 0;
    answer = (_url, init) => {
      if (init.method !== "POST") return Promise.resolve(json({ runs: [] }));
      attempt += 1;
      return Promise.resolve(
        stream(
          attempt === 1
            ? run({ id: "spya-retry1", status: "error", hits: [], error: "That search failed." })
            : run({ id: "spya-retry1" }),
        ),
      );
    };
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    await act(async () => chips()[0]?.click());
    await flush();
    expect(host.textContent).toContain("That search failed.");

    await act(async () => chips()[0]?.click());
    await flush();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(String(posts()[1]?.init.body))).toMatchObject({ id: "spya-retry1" });
    expect(host.textContent).toContain("2 passages.");
  });

  it("turns a stream that ends without done into a retry of the begun run", async () => {
    let attempt = 0;
    answer = (_url, init) => {
      if (init.method !== "POST") return Promise.resolve(json({ runs: [] }));
      attempt += 1;
      if (attempt === 2) return Promise.resolve(stream(run({ id: "spya-ended1" })));
      const begun = run({ id: "spya-ended1", status: "pending", hits: [] });
      return Promise.resolve(
        new Response(`event: begin\ndata: ${JSON.stringify(begun)}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    };
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    await act(async () => chips()[0]?.click());
    await flush();
    expect(host.textContent).toContain("stopped arriving");

    await act(async () => chips()[0]?.click());
    await flush();
    expect(JSON.parse(String(posts()[1]?.init.body))).toMatchObject({ id: "spya-ended1" });
  });

  it("follows the id the server answered under, and lets the final answer replace what streamed", async () => {
    const done = run({ id: "spya-run777", hits: [{ blockId: "spya-cccccc" as BlockId, quote: "", confidence: 80, reasoning: "" }] });
    answer = (_url, init) => {
      if (init.method !== "POST") return Promise.resolve(json({ runs: [] }));
      const frames =
        `event: begin\ndata: ${JSON.stringify({ ...done, status: "pending", hits: [] })}\n\n` +
        `event: hit\ndata: ${JSON.stringify({ hit: { blockId: "spya-aaaaaa", quote: "", confidence: 50, reasoning: "" } })}\n\n` +
        `event: done\ndata: ${JSON.stringify(done)}\n\n`;
      return Promise.resolve(new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } }));
    };
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    await act(async () => chips()[0]?.click());
    await flush();
    expect(links()).toEqual(["spya-cccccc"]);
    expect(host.querySelector("a.chat-search-open")?.getAttribute("href")).toContain("runs=spya-run777");
    expect(host.querySelector("a.chat-search-open")?.getAttribute("href")).toContain("match=quick");
  });

  it("asks once for two presses in a row", async () => {
    answer = (_url, init) => Promise.resolve(init.method === "POST" ? stream(run()) : json({ runs: [] }));
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    const button = chips()[0];
    await act(async () => {
      button?.click();
      button?.click();
    });
    await flush();
    expect(posts()).toHaveLength(1);
  });

  it("binds the list read and a late press to the reader the card was mounted for", async () => {
    const commands = executor({ "quick-search": () => CLOSE });
    const token = "[cmd:quick-search:centred%20systems]";
    answer = (_url, init) => Promise.resolve(init.method === "POST" ? stream(run()) : json({ runs: [] }));
    paint(token, commands, true, "reader-a");
    await flush();
    expect(asked.find((request) => request.init.method !== "POST")?.reader).toBe("reader-a");

    /* A provider update alone must not retarget a component that was already
       mounted for A; App normally unmounts it immediately afterwards. */
    paint(token, commands, true, "reader-b");
    await act(async () => chips()[0]?.click());
    await flush();
    expect(posts()[0]?.reader).toBe("reader-a");
  });

  it("does not reuse a saved meaning search, a failed one, or one naming a passage the article no longer has", async () => {
    answer = (url) =>
      Promise.resolve(
        json(
          url.endsWith(SLUG)
            ? {
                runs: [
                  run({ id: "spya-mean01", kind: "meaning" }),
                  run({ id: "spya-fail01", status: "error", hits: [] }),
                  run({ id: "spya-gone01", hits: [{ blockId: "spya-zzzzzz" as BlockId, quote: "", confidence: 90, reasoning: "" }] }),
                ],
              }
            : {},
        ),
      );
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    expect(chips()).toHaveLength(1);
    expect(host.querySelector(".chat-search-ran")).toBeNull();

    answer = (_url, init) => Promise.resolve(init.method === "POST" ? stream(run({ id: "spya-fresh1" })) : json({ runs: [] }));
    await act(async () => chips()[0]?.click());
    await flush();
    expect(posts()).toHaveLength(1);
    expect(host.querySelector("a.chat-search-open")?.getAttribute("href")).toContain("runs=spya-fresh1");
  });

  it("shows the refusal and does not post when the proposal is no longer available at the press", async () => {
    const commands = executor({ "quick-search": () => CLOSE });
    paint("[cmd:quick-search:centred%20systems]", commands);
    await flush();
    delete (commands.runners as unknown as Record<string, unknown>)["quick-search"];

    await act(async () => chips()[0]?.click());
    expect(posts()).toHaveLength(0);
    expect(host.querySelector(".cmd-chip-said")?.textContent).toBe("That can't be done from here any more.");
  });

  it("says a saved answer was found earlier", async () => {
    answer = (url) => Promise.resolve(json(url.endsWith(SLUG) ? { runs: [run({ finishedAt: "2026-10-09T10:00:00.000Z" })] } : {}));
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": () => CLOSE }));
    await flush();
    expect(host.querySelector(".chat-search-status")?.textContent).toContain("(searched ");
  });

  it("presses through the executor as before outside a chat surface", async () => {
    const quick = vi.fn((_p: { words: string }) => CLOSE);
    paint("[cmd:quick-search:centred%20systems]", executor({ "quick-search": quick }), false);
    await act(async () => chips()[0]?.click());
    expect(quick).toHaveBeenCalledWith(expect.objectContaining({ words: "centred systems" }));
    expect(posts()).toHaveLength(0);
  });
});

describe("a find button in a chat answer", () => {
  it("lists every block with the exact words in place, and asks nothing", async () => {
    const find = vi.fn((_p: { words: string }) => CLOSE);
    paint("[cmd:find:multiple%20entryways]", executor({ find }));
    await flush();
    const before = asked.length;
    await act(async () => chips()[0]?.click());
    expect(links()).toEqual(["spya-aaaaaa", "spya-cccccc"]);
    expect(find).not.toHaveBeenCalled();
    expect(asked.length).toBe(before);
    expect(went).toEqual([]);
    expect(host.querySelector("a.chat-search-open")?.getAttribute("href")).toContain("match=words");
  });

  it("lists a passage once however many times it has the words", async () => {
    ARTICLE.push(block("spya-dddddd", "Entryways, entryways: multiple entryways and more multiple entryways."));
    BLOCKS.set("spya-dddddd", ARTICLE[3]?.text ?? "");
    try {
      paint("[cmd:find:multiple%20entryways]", executor({ find: () => CLOSE }));
      await act(async () => chips()[0]?.click());
      expect(links()).toEqual(["spya-aaaaaa", "spya-cccccc", "spya-dddddd"]);
      expect(host.textContent).toContain("3 passages.");
    } finally {
      ARTICLE.pop();
      BLOCKS.delete("spya-dddddd");
    }
  });

  it("jumps the article from a listed passage and stays in the conversation", async () => {
    paint("[cmd:find:multiple%20entryways]", executor({ find: () => CLOSE }));
    await act(async () => chips()[0]?.click());
    const first = host.querySelector<HTMLAnchorElement>(".chat-search-hits a");
    await act(async () => first?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })));
    expect(jumped).toEqual(["spya-aaaaaa"]);
  });
});
