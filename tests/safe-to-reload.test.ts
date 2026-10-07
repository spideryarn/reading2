// @vitest-environment jsdom
/**
 * **Whether the page may be reloaded under the reader without losing anything
 * they have not sent** — src/web/safe-to-reload.ts.
 *
 * One case per refusal, each driven through the thing that really holds the
 * work — the draft store Chat writes to, the live upload engines, the
 * connection fact api.ts reports to — rather than through a stand-in for it.
 * A veto that asked a second copy of a fact would pass here with a stand-in
 * and miss the real one. docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md,
 * GPT Sol's findings F1, F2 and F4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The transport, posed under the real engines and held open by the test:
   nothing here ever finishes on its own, which is what "in flight" means. */
vi.mock("../src/web/upload.js", () => ({
  requestGrant: async () => ({
    uploadId: "up-safe",
    url: "https://storage.test/staging/up-safe?token=x",
    expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    slug: "paper",
  }),
  putFile: () => new Promise<void>(() => {}),
  sha256Hex: () => new Promise<string>(() => {}),
}));

vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return { ...real, apiFetch: async () => new Response("{}", { status: 204 }) };
});

const { safeToReload, reloadVeto, noteFeedbackDraft } = await import("../src/web/safe-to-reload.js");
const { chatDraftsFor, forgetChatDrafts } = await import("../src/web/chat-draft.js");
const { noteNoConnection, noteReachedServer } = await import("../src/web/offline.js");
const { uploadEngine } = await import("../src/web/uploadEngine.js");
const { batchUpload } = await import("../src/web/batchUpload.js");

const aFile = (name = "paper.pdf"): File =>
  ({ name, size: 11_000_000, type: "application/pdf" }) as unknown as File;

beforeEach(() => {
  forgetChatDrafts();
  noteFeedbackDraft(false);
  noteReachedServer();
  uploadEngine.reset();
  batchUpload.reset();
});

afterEach(() => {
  uploadEngine.reset();
  batchUpload.reset();
  vi.restoreAllMocks();
});

describe("safeToReload", () => {
  it("says yes when nothing is held", () => {
    expect(reloadVeto()).toBeNull();
    expect(safeToReload()).toBe(true);
  });

  describe("an unsent Chat or Learn draft, on any article", () => {
    it("a conversation's unsent words", () => {
      chatDraftsFor("an-article").setThread("thread-1", "half a question");
      expect(reloadVeto()).toBe("chat-draft");
      expect(safeToReload()).toBe(false);
    });

    it("the box under Chat's list", () => {
      chatDraftsFor("an-article").setList("a new question");
      expect(safeToReload()).toBe(false);
    });

    it("Learn's unsent words", () => {
      chatDraftsFor("another-article").setLearn("learn","what I took from it");
      expect(safeToReload()).toBe(false);
    });

    it("but not a box that was cleared, or holds only spaces", () => {
      const d = chatDraftsFor("an-article");
      d.setThread("thread-1", "half a question");
      d.setThread("thread-1", "");
      d.setList("   ");
      d.setDestination("thread-1");
      expect(safeToReload()).toBe(true);
    });

    it("nor one whose conversation was dropped", () => {
      const d = chatDraftsFor("an-article");
      d.setThread("thread-1", "half a question");
      d.dropThread("thread-1");
      expect(safeToReload()).toBe(true);
    });
  });

  it("says no while the Feedback dialog holds a draft, and yes once it does not", () => {
    noteFeedbackDraft(true);
    expect(reloadVeto()).toBe("feedback-draft");
    noteFeedbackDraft(false);
    expect(safeToReload()).toBe(true);
  });

  it("says no while an upload is in flight — the same fact that warns on closing the tab", async () => {
    uploadEngine.start("reader-a");
    await uploadEngine.send(aFile());
    expect(uploadEngine.getSnapshot().transfer?.phase.kind).toBe("sending");
    expect(reloadVeto()).toBe("upload");

    uploadEngine.cancel();
    await new Promise((r) => setTimeout(r, 0));
    expect(safeToReload(), "and yes once it has stopped").toBe(true);
  });

  it("says no while a batch has files waiting", () => {
    batchUpload.start("reader-a");
    batchUpload.add([aFile("one.pdf"), aFile("two.pdf")]);
    expect(reloadVeto()).toBe("upload");

    batchUpload.cancel();
    expect(safeToReload()).toBe(true);
  });

  it("one upload finishing does not release a batch's veto", async () => {
    uploadEngine.start("reader-a");
    await uploadEngine.send(aFile());
    batchUpload.start("reader-a");
    batchUpload.add([aFile("one.pdf"), aFile("two.pdf")]);
    uploadEngine.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reloadVeto()).toBe("upload");
    batchUpload.cancel();
    expect(safeToReload()).toBe(true);
  });

  it("says no when requests are not reaching the server, though the browser says it is online", () => {
    /* A captive portal, a dead router: `navigator.onLine` stays true and a
       reload is a browser error page, in an app with no back button. F4. */
    expect(navigator.onLine).toBe(true);
    noteNoConnection();
    expect(reloadVeto()).toBe("offline");
  });

  it("says no when the browser itself says there is no network", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(reloadVeto()).toBe("offline");
  });

  it("takes another veto as one more line", () => {
    expect(reloadVeto([{ why: "something-else", holds: () => true }])).toBe("something-else");
    expect(safeToReload([{ why: "something-else", holds: () => false }])).toBe(true);
  });
});

it("the production watcher records lost and restored connectivity, before listeners consider a reload", async () => {
  vi.resetModules();
  vi.stubEnv("PROD", true);
  vi.stubGlobal("__SPIDERYARN_BUILD_COMMIT__", "a".repeat(40));
  vi.stubGlobal("__SPIDERYARN_BUILD_TIME__", "2026-10-04T00:00:00.000Z");
  let online = true;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (!online) throw new TypeError("Load failed");
    return new Response(JSON.stringify({ commit: "b".repeat(40), builtAt: "2026-10-05T00:00:00.000Z" }));
  }));
  const connection = await import("../src/web/offline.js");
  const safety = await import("../src/web/safe-to-reload.js");
  const shell = await import("../src/web/stale-shell.js");
  connection.noteNoConnection();
  const allowed: boolean[] = [];
  const unsubscribe = shell.onDeployNoticed((build) => {
    if (build) allowed.push(safety.safeToReload());
  });
  const stop = shell.watchForDeploy();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await settle();
    expect(allowed, "a valid build response proves the connection came back").toEqual([true]);
    online = false;
    window.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(safety.reloadVeto(), "a transport failure must veto acting on an old snapshot").toBe("offline");
    online = true;
    window.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(allowed).toEqual([true, true]);
  } finally {
    stop();
    unsubscribe();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
