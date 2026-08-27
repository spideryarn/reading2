/**
 * **How models are named, and the four ways that used to be inconsistent.**
 *
 * The bug, 2026-08-27: `/profile` printed ten jobs with their raw wire ids, so
 * seven rows read `claude-sonnet-5` and three read `anthropic/claude-sonnet-5`.
 * Every one of those strings was the right thing to send. The page was still
 * wrong, because the reader's question is *which model writes what* and the
 * answer came back in two spellings depending on a transport detail they cannot
 * see.
 *
 * The fix separates the jobs a model string was doing — what we send
 * (`resolveModel` / `modelFor`), how we reach it (`providerFor`), what we call
 * it (`displayName`) — and these tests hold that separation in place. Two
 * things they are chiefly for:
 *
 * **One resolver, not two.** The `SPIDERYARN_*_MODEL` overrides used to be read
 * at the three call sites and nowhere else, so with one set the page named a
 * model the server was not using while promising it showed what the server was
 * configured with.
 *
 * **The inventory is checked rather than asserted.** `DISPLAY_NAME` claimed in
 * prose to hold every model this app can send, while omitting the two that are
 * on no tier.
 *
 * See src/models.ts and docs/project/setup-dev.md § Which model everything uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EMBEDDING_MODEL } from "../src/embeddings.js";
import {
  CAPABLE_MODEL,
  CAPABLE_MODEL_OPENROUTER,
  DISPLAY_NAME,
  MODEL_ENV_VAR,
  NON_TASK_MODELS,
  PDF_READER_MODEL,
  PIPELINE_TASKS,
  QUICK_MODEL_OPENROUTER,
  REQUEST_PATH_TASKS,
  TASK_WIRE,
  TASK_TIER,
  type Task,
  displayName,
  modelFor,
  wireFor,
  resolveModel,
} from "../src/models.js";

const ALL_TASKS = Object.keys(TASK_TIER) as Task[];

afterEach(() => {
  delete process.env.SPIDERYARN_CHAT_MODEL;
});

describe("which wire each task is on", () => {
  it("puts every task in exactly one of the two lists", () => {
    /* Belt and braces. The real guarantee is the type: `TASK_PROVIDER` is a
       `Record<Task, Wire>`, so an unassigned task will not compile, and
       both lists are derived from it. It used to be two hand-written lists with
       a provider function defaulting to "anthropic" — under which a task nobody
       listed did not fail, it just got the pipeline answer and was reported
       with the Anthropic spelling however it really ran. GPT-5.6-sol asked for
       the compile-time version, 2026-08-27; the same day the axis itself
       changed from *which vendor* to *which protocol*, everything having moved
       behind OpenRouter. */
    expect(Object.keys(TASK_WIRE).sort()).toEqual([...ALL_TASKS].sort());
    const listed = [...PIPELINE_TASKS, ...REQUEST_PATH_TASKS];
    expect([...listed].sort()).toEqual([...ALL_TASKS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("agrees with wireFor", () => {
    for (const task of PIPELINE_TASKS) expect(wireFor(task)).toBe("messages");
    for (const task of REQUEST_PATH_TASKS) expect(wireFor(task)).toBe("chat");
  });

  it("sends every task to OpenRouter, which is now the only gateway", () => {
    /* The decision of 2026-08-27, pinned so that reversing it has to be
       deliberate. Before it, the seven pipeline stages went straight to
       Anthropic's own API and this loop would have failed on all seven. */
    for (const task of ALL_TASKS) expect(resolveModel(task).provider).toBe("openrouter");
  });
});

describe("the model id a task sends", () => {
  it("gives every task OpenRouter's spelling, pipeline stages included", () => {
    /* Both wires now address the model the same way: the Anthropic-compatible
       endpoint wants `anthropic/claude-sonnet-5` exactly as chat/completions
       does. Until 2026-08-27 `labels` sent the bare `claude-sonnet-5`. */
    expect(modelFor("labels")).toBe(CAPABLE_MODEL_OPENROUTER);
    expect(modelFor("explain")).toBe(CAPABLE_MODEL_OPENROUTER);
    expect(modelFor("labels")).toContain("/");
  });

  it("keeps the unprefixed spelling out of every request", () => {
    /* `CAPABLE_MODEL` still exists and is still load-bearing — it is the name
       stamped into stored artefacts, and every staleness check compares against
       it. What it must never again be is the id on a request: sending it to
       OpenRouter is a 404, and *changing the stamps to match the wire* would
       mark the whole corpus stale and regenerate it at full price. Two
       spellings, two jobs. See src/models.ts. */
    for (const task of ALL_TASKS) expect(modelFor(task)).not.toBe(CAPABLE_MODEL);
  });

  it("lets the environment override it, and says that it did", () => {
    /* The half that used to live at the three call sites and nowhere else, so
       `/api/models` reported the default while the call sent this. A page that
       promises "what the server is configured with" has to see the override
       the caller sees, which means one resolver rather than two. */
    process.env.SPIDERYARN_CHAT_MODEL = "someone/else-9";
    expect(resolveModel("chat")).toEqual({
      id: "someone/else-9",
      provider: "openrouter",
      wire: "chat",
      source: "override",
    });
  });

  it("reads the environment per call rather than at module load", () => {
    /* `loadEnvLocal()` runs inside functions in several modules, so an id
       captured at import time can be captured before `.env.local` has been
       read. This is what makes the default parameter at each call site still
       behave as it did. */
    expect(resolveModel("chat").source).toBe("default");
    process.env.SPIDERYARN_CHAT_MODEL = "someone/else-9";
    expect(resolveModel("chat").source).toBe("override");
  });

  it("has an override variable decided for every task, even if the answer is none", () => {
    for (const task of ALL_TASKS) expect(task in MODEL_ENV_VAR).toBe(true);
    for (const task of PIPELINE_TASKS) expect(MODEL_ENV_VAR[task]).toBeNull();
    for (const task of REQUEST_PATH_TASKS) expect(MODEL_ENV_VAR[task]).toBeTruthy();
  });
});

describe("what a person is shown", () => {
  it("gives the two spellings of one model one name", () => {
    /* The whole point. These are different strings on the wire and must stay
       different strings on the wire; they are one model and must read as one. */
    expect(displayName(CAPABLE_MODEL)).toBe(displayName(CAPABLE_MODEL_OPENROUTER));
  });

  it("names every model this app can send", () => {
    /* Including the two that are on no tier. The docblock claimed this before
       either of them was in the table, which is the kind of inventory that is
       worse than none — GPT-5.6-sol, 2026-08-27. */
    const sendable = [
      CAPABLE_MODEL,
      CAPABLE_MODEL_OPENROUTER,
      QUICK_MODEL_OPENROUTER,
      PDF_READER_MODEL,
      EMBEDDING_MODEL,
      ...ALL_TASKS.map(modelFor),
      ...NON_TASK_MODELS.map((m) => m.id),
    ];
    for (const id of sendable) expect(DISPLAY_NAME[id], `no display name for ${id}`).toBeTruthy();
  });

  it("carries no provider prefix into the name", () => {
    /* A display name is what the model is called, never how it is addressed.
       Left unchecked, extending DISPLAY_NAME by copy-paste is one keystroke
       away from putting `openai/` back on the page. */
    for (const name of Object.values(DISPLAY_NAME)) expect(name).not.toContain("/");
  });

  it("falls back to the raw id rather than hiding an unlisted model", () => {
    expect(displayName("someone/else-9")).toBe("someone/else-9");
  });
});
