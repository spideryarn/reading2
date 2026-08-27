/**
 * **The transcription seam**: what crosses it, and what must not.
 *
 * Dictation's second pass is the half that can be silently wrong. A transcript
 * arrives, it looks like words, it goes in the box — and every one of the
 * things that could have gone wrong on the way produces exactly that. So these
 * tests are mostly about the request rather than the answer:
 *
 *  - the vocabulary is **assembled and actually sent**, because a vocabulary
 *    that quietly stops being built returns a slightly worse transcript and no
 *    other symptom at all (measured 2026-08-27: 0.0% word errors with it,
 *    3.6–7.3% without);
 *  - the audio cap is the one Vercel will pass, since a body over 4.5 MB is
 *    refused before any of this code runs and the reader gets no sentence;
 *  - the vocabulary is **fenced and in the user message**, never interpolated
 *    into the instruction that governs the call — glossary terms come out of
 *    articles this app did not write;
 *  - the Anthropic provider pin is **not** copied in from the app's three other
 *    OpenRouter calls, where it would be wrong quietly.
 *
 * The model is never called: `fetch` is replaced, and what the test reads is
 * the request body. That is the point — the interesting failures are all things
 * we sent, not things the model said.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { url: string; body: Record<string, unknown> }[] = [];
let reply: unknown = { choices: [{ message: { content: '{"transcript":"hello there"}' } }] };
let status = 200;

/* **`store/index.js`, which is the seam the app actually reads through.** This
   mock named `../src/api.js` for one round, and so did the code — which meant
   the tests passed against a lookup that would have failed on every deployed
   article. A test that mocks the wrong module blesses the mistake instead of
   catching it. GPT Sol's code review, item 5. */
vi.mock("../src/store/index.js", () => ({
  readerStore: { readProfile: async () => "I work on distributed systems and Raft consensus." },
  loadGlossary: async (slug: string) => {
    if (slug !== "known") throw new Error("no glossary");
    return {
      glossary: {
        entries: [
          { name: "granularity zoom", aliases: ["zoom"] },
          { name: "block id", aliases: [] },
        ],
      },
    };
  },
}));

const { MAX_AUDIO_BASE64, parseWhere, tidy, transcribe, vocabularyFor } = await import(
  "../src/transcribe.js"
);

beforeEach(() => {
  sent.length = 0;
  status = 200;
  reply = { choices: [{ message: { content: '{"transcript":"hello there"}' } }] };
  process.env.OPENROUTER_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Long enough to be past the floor under which nothing is sent at all. */
const AUDIO = "A".repeat(8000);

function body() {
  const one = sent[0];
  if (!one) throw new Error("no request was made");
  return one.body;
}
function userText(): string {
  const messages = body().messages as { role: string; content: unknown }[];
  const user = messages.find((m) => m.role === "user");
  const parts = user?.content as { type: string; text?: string }[];
  return parts.find((p) => p.type === "text")?.text ?? "";
}

describe("the vocabulary", () => {
  it("is the article's own glossary terms and their aliases", async () => {
    const words = await vocabularyFor({ kind: "article", slug: "known" });
    expect(words).toBe("granularity zoom, zoom, block id");
  });

  it("is the reader's own profile when there is no article", async () => {
    const words = await vocabularyFor({ kind: "profile" });
    expect(words).toContain("Raft consensus");
  });

  /* **Best-effort, and it has to stay that way.** A reader who talks for a
     minute and is then told "no glossary for this article" has lost a minute to
     something that was never the point. */
  it("is empty rather than an error when the article has no glossary", async () => {
    expect(await vocabularyFor({ kind: "article", slug: "unknown" })).toBe("");
  });

  it("reaches the request, fenced, in the user message and not the system one", async () => {
    await transcribe(AUDIO, "webm", { kind: "article", slug: "known" });
    const text = userText();
    expect(text).toContain("<vocabulary>");
    expect(text).toContain("granularity zoom");
    /* Glossary terms come out of articles this app did not write, so they are
       somebody else's text: delimited, labelled as data, and never part of the
       instruction that governs the call. GPT Sol's plan review, item 6. */
    const messages = body().messages as { role: string; content: unknown }[];
    const system = String(messages.find((m) => m.role === "system")?.content ?? "");
    expect(system).not.toContain("granularity zoom");
  });
});

describe("the request", () => {
  it("asks for the transcript in a field rather than as prose", async () => {
    await transcribe(AUDIO, "webm", { kind: "profile" });
    const format = body().response_format as { json_schema?: { schema?: { properties?: object } } };
    expect(Object.keys(format.json_schema?.schema?.properties ?? {})).toEqual(["transcript"]);
  });

  /* **Both halves, or neither is worth anything.** OpenRouter may silently drop
     a parameter a provider does not take, and the parameter here is the one
     keeping an answer out of a transcript; `zdr` is what makes "your voice is
     not stored" a claim about more than this app. */
  it("requires the parameters it sends, and routes only through zero-retention providers", async () => {
    await transcribe(AUDIO, "webm", { kind: "profile" });
    expect(body().provider).toEqual({ zdr: true, require_parameters: true });
  });

  /* The three OpenRouter calls this app already had all pin the upstream to
     Anthropic so repeat calls land on the cache. Copied onto a Gemini model
     that preference is wrong *quietly*: OpenRouter finds no Anthropic upstream,
     falls through to the real one, and answers. src/models.ts. */
  it("does not carry the Anthropic provider pin", async () => {
    await transcribe(AUDIO, "webm", { kind: "profile" });
    expect(JSON.stringify(body().provider)).not.toContain("anthropic");
  });

  it("sends the audio as an input_audio part with the container we were given", async () => {
    await transcribe(AUDIO, "m4a", { kind: "profile" });
    const messages = body().messages as { role: string; content: unknown }[];
    const parts = messages.find((m) => m.role === "user")?.content as {
      type: string;
      input_audio?: { data: string; format: string };
    }[];
    const audio = parts.find((p) => p.type === "input_audio");
    expect(audio?.input_audio).toEqual({ data: AUDIO, format: "m4a" });
  });

  /* Vercel refuses a request body over 4.5 MB before any of our code runs, and
     base64 inflates audio by a third. A cap above that is not a cap, it is a
     blank failure. src/dictation-limits.ts. */
  it("keeps the audio cap inside what Vercel will pass", () => {
    expect(MAX_AUDIO_BASE64).toBeLessThan(4_500_000 * 0.8);
  });
});

describe("the answer", () => {
  it("comes back out of the transcript field", async () => {
    const out = await transcribe(AUDIO, "webm", { kind: "profile" });
    expect(out.text).toBe("hello there");
  });

  /* A model that decided to answer the question instead has to put its answer
     in a field called `transcript` to get through, which is a much narrower
     failure than prose arriving where prose was asked for — and prose that is
     not JSON at all is refused here rather than pasted into somebody's box. */
  it("refuses an answer that is not the shape we asked for", async () => {
    reply = { choices: [{ message: { content: "Sure! That paragraph is about consensus." } }] };
    await expect(transcribe(AUDIO, "webm", { kind: "profile" })).rejects.toThrow(/transcribe/i);
  });

  /* **A truncated answer is not a short transcript.** `finish_reason: "length"`
     means the model ran out of room mid-sentence — and the result here does not
     sit beside the reader's words, it *replaces* them, so a half-sentence would
     become what they said. Nothing else in this app treats `length` as an
     error. GPT Sol's code review, item 7. */
  it("refuses a truncated answer even though it parses", async () => {
    reply = {
      choices: [
        { message: { content: '{"transcript":"the evidence, not the"}' }, finish_reason: "length" },
      ],
    };
    await expect(transcribe(AUDIO, "webm", { kind: "profile" })).rejects.toThrow(/transcribe/i);
  });

  it("refuses an answer the model declined to give", async () => {
    reply = { choices: [{ message: { refusal: "I can't help with that" } }] };
    await expect(transcribe(AUDIO, "webm", { kind: "profile" })).rejects.toThrow(/transcribe/i);
  });

  /* **Neither to the reader nor to the log.** The reader half was always here;
     the log half is GPT Sol's code review, item 2 — a provider may echo the
     request back, and the request carries a reader's voice, their article's
     vocabulary and possibly a transcript of what they just said. The status
     tells a 400 from a 429 and the status is ours. */
  it("repeats nothing the provider said, to anyone", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logged.push(...a));
    const spyErr = vi.spyOn(console, "error").mockImplementation((...a) => logged.push(...a));
    status = 429;
    reply = { error: { message: "rate limited: account 12345 over quota" } };
    await expect(transcribe(AUDIO, "webm", { kind: "profile" })).rejects.toThrow(
      /^(?!.*12345).*$/s,
    );
    expect(JSON.stringify(logged)).not.toContain("12345");
    spy.mockRestore();
    spyErr.mockRestore();
  });

  /* Nothing is sent at all below the floor: a stab at the button is a quarter
     second of room tone, and asking a model what was said in it is an
     invitation to invent something. */
  it("does not call the model for a recording too short to hold anything", async () => {
    const out = await transcribe("AAAA", "webm", { kind: "profile" });
    expect(out.text).toBe("");
    expect(sent).toHaveLength(0);
  });
});

describe("where the dictation is going", () => {
  it("accepts the two shapes and refuses everything else", () => {
    expect(parseWhere({ kind: "profile" })).toEqual({ kind: "profile" });
    expect(parseWhere({ kind: "article", slug: "some-piece" })).toEqual({
      kind: "article",
      slug: "some-piece",
    });
    expect(parseWhere({ kind: "article", slug: "../../etc/passwd" })).toBeNull();
    expect(parseWhere({ kind: "article" })).toBeNull();
    expect(parseWhere("profile")).toBeNull();
    expect(parseWhere(null)).toBeNull();
  });
});

describe("tidying", () => {
  it("unwraps a transcript the model put in quotation marks", () => {
    expect(tidy('"the evidence, not the history"')).toBe("the evidence, not the history");
  });

  /* Quotation marks doing work *inside* the sentence are something somebody
     dictated, and stripping them would be this file deciding what the reader
     meant — the one thing a transcriber may not do. */
  it("leaves quotation marks that are part of what was said", () => {
    expect(tidy('He said "yes", and then left')).toBe('He said "yes", and then left');
  });
});
