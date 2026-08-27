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
  TASK_PROVIDER,
  TASK_TIER,
  type Task,
  displayName,
  modelFor,
  providerFor,
  resolveModel,
} from "../src/models.js";

const ALL_TASKS = Object.keys(TASK_TIER) as Task[];

afterEach(() => {
  delete process.env.SPIDERYARN_CHAT_MODEL;
});

describe("which wire each task is on", () => {
  it("puts every task in exactly one of the two lists", () => {
    /* Belt and braces. The real guarantee is the type: `TASK_PROVIDER` is a
       `Record<Task, Provider>`, so an unassigned task will not compile, and
       both lists are derived from it. It used to be two hand-written lists with
       `providerFor` defaulting to "anthropic" — under which a task nobody
       listed did not fail, it just got the pipeline answer and was reported
       with the Anthropic spelling however it really ran. GPT-5.6-sol asked for
       the compile-time version, 2026-08-27. */
    expect(Object.keys(TASK_PROVIDER).sort()).toEqual([...ALL_TASKS].sort());
    const listed = [...PIPELINE_TASKS, ...REQUEST_PATH_TASKS];
    expect([...listed].sort()).toEqual([...ALL_TASKS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("agrees with providerFor", () => {
    for (const task of PIPELINE_TASKS) expect(providerFor(task)).toBe("anthropic");
    for (const task of REQUEST_PATH_TASKS) expect(providerFor(task)).toBe("openrouter");
  });
});

describe("the model id a task sends", () => {
  it("gives a pipeline stage the Anthropic SDK's spelling", () => {
    expect(modelFor("labels")).toBe(CAPABLE_MODEL);
    expect(modelFor("labels")).not.toContain("/");
  });

  it("gives a request-path call OpenRouter's", () => {
    expect(modelFor("explain")).toBe(CAPABLE_MODEL_OPENROUTER);
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
