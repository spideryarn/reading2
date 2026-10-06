// @vitest-environment jsdom
/**
 * **The three tab-level engines send as the reader they were started for, or
 * not at all** — src/web/jobEngine.ts, src/web/uploadEngine.ts and
 * src/web/batchUpload.ts;
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 2.
 *
 * Each engine is bound to a reader by `start(readerId)` and unbound by
 * `stop()`, from an effect in `useJobSession`. An effect runs after the commit,
 * and a request can already be waiting for its token by then. So there is a
 * window in which the engine still belongs to reader A and the token that
 * comes back is reader B's: an add POST, a Retry, an `/advance`, a grant for
 * A's file. Fencing the *answer* (which each engine already does) does not
 * stop the request going out.
 *
 * **The real singletons, over the real `apiFetch`.** The Supabase client is
 * this file's, so it can say the session is B's while an engine is still A's,
 * and `fetch` records what left. A test over injected `deps` could not see
 * this: the check is in the live deps, where the token goes on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSession {
  access_token: string;
  user: { id: string };
}
let signedIn: FakeSession | null = null;
const as = (id: string): FakeSession => ({ access_token: `TOKEN-${id}`, user: { id } });

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { jobEngine, send } = await import("../src/web/jobEngine.js");
const { uploadEngine } = await import("../src/web/uploadEngine.js");
const { batchUpload } = await import("../src/web/batchUpload.js");
const { NotThisReader } = await import("../src/web/lib/api.js");

/** Every request that left: `<METHOD> <url> as <token>`. */
let sent: string[] = [];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Long enough for a hash, a token lookup and a refusal; nothing here waits on a timer. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

const pdf = (name: string): File => new File(["%PDF-1.4 not really"], name, { type: "application/pdf" });

beforeEach(() => {
  sent = [];
  signedIn = as("A");
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const token = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "") ?? "nobody";
    sent.push(`${(init.method ?? "GET").toUpperCase()} ${input} as ${token}`);
    return Promise.resolve(json(input === "/api/jobs" ? { jobs: [] } : {}));
  });
});

afterEach(() => {
  jobEngine.reset();
  uploadEngine.reset();
  batchUpload.reset();
  vi.unstubAllGlobals();
});

describe("jobEngine", () => {
  it("sends its requests as the reader it was started for", async () => {
    jobEngine.start("A");
    await settle();
    expect(sent).toEqual(["GET /api/jobs as TOKEN-A"]);
    await send("/api/jobs", { method: "POST", body: "{}" });
    expect(sent).toContain("POST /api/jobs as TOKEN-A");
  });

  it("does not send a request made under reader A once the credential is reader B's", async () => {
    jobEngine.start("A");
    await settle();
    sent = [];

    /* The session has changed, and `useJobSession`'s cleanup has not run yet. */
    signedIn = as("B");
    const added = await send("/api/jobs", { method: "POST", body: "{}" }).then(
      () => null,
      (e: unknown) => e,
    );
    const retried = await send("/api/jobs/j1/retry", { method: "POST" }).then(
      () => null,
      (e: unknown) => e,
    );
    /* And the engine's own poll, which is the same helper. */
    jobEngine.poke();
    await settle();

    expect(added).toBeInstanceOf(NotThisReader);
    expect(retried).toBeInstanceOf(NotThisReader);
    expect(sent).toEqual([]);
  });

  it("reads the reader when the call is made, so the next reader's engine sends as them", async () => {
    jobEngine.start("A");
    await settle();
    signedIn = as("B");
    jobEngine.stop();
    jobEngine.start("B");
    await settle();
    sent = [];
    await send("/api/jobs", { method: "POST", body: "{}" });
    expect(sent).toEqual(["POST /api/jobs as TOKEN-B"]);
  });
});

describe("uploadEngine", () => {
  it("asks for a grant as the reader it was started for", async () => {
    uploadEngine.start("A");
    void uploadEngine.send(pdf("a.pdf"));
    await settle();
    expect(sent).toContain("POST /api/uploads as TOKEN-A");
  });

  it("does not send a file taken under reader A once the credential is reader B's", async () => {
    uploadEngine.start("A");
    signedIn = as("B");
    const id = await uploadEngine.send(pdf("a.pdf"));
    await settle();
    expect(id).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("batchUpload", () => {
  it("asks for a grant as the reader it was started for", async () => {
    batchUpload.start("A");
    batchUpload.add([pdf("a.pdf")]);
    await settle();
    expect(sent).toContain("POST /api/uploads as TOKEN-A");
  });

  it("does not send files taken under reader A once the credential is reader B's", async () => {
    batchUpload.start("A");
    signedIn = as("B");
    batchUpload.add([pdf("a.pdf"), pdf("b.pdf")]);
    await settle();
    expect(sent).toEqual([]);
  });
});
