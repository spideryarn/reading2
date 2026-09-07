/**
 * **`push-env` for a repo with no typed allowlist** — names out of a
 * `.env.local`, a model's opinion of them, the checklist that follows, and the
 * file that remembers what was ticked.
 *
 * The test this file exists for is the first one: **one `.env.local` whose
 * every value is a distinct sentinel, and every sink asserted at once.** Eight
 * separate leak tests would each be true and the eighth sink would still be the
 * one nobody wrote — GPT Sol's review of the plan, finding 6. It was watched
 * going red by putting the offending line into a problem string
 * (`line ${i + 1}: ${line}` in `scanEnv`), which failed on the `problems` sink
 * and on nothing else, which is exactly why the other sinks are in the same
 * `it`.
 *
 * The rest is the fail-closed half: a model that invents a key name, duplicates
 * one, or answers with prose gives **no** proposal rather than most of one, and
 * the hard guards are re-applied to the reader's ticks rather than trusted to
 * have been shown greyed out.
 *
 * See scripts/gjd-remote-envpolicy.ts and
 * docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The ledger's STORE is replaced, and nothing above it is.**
 *
 * `withLedger` runs for real in the last describe of this file — the collector,
 * the attribution, the row-building and its own printed total — because those
 * are the parts that were never exercised. Only the last inch is swapped: a real
 * `costStore` would write into Postgres, and a test
 * that spends money into the actual ledger is a test that corrupts the thing it
 * is checking. `importOriginal` keeps every other export of that module real.
 */
const LEDGER_ROWS: { job: string; model: string; outcome: string }[] = [];
vi.mock("../src/store/ai-calls.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/ai-calls.js")>();
  return {
    ...real,
    costStore: {
      describe: () => "an in-memory ledger, for tests",
      /* `requestedModel`, which is what the row calls it — the field is not
         `model`, and a mock that read `row.model` would record "undefined" for
         every call and the assertion would be about nothing.

         `async`, and that is not decoration: the contract says
         `record(row): Promise<void>`, the collector chains onto what comes back,
         and a version of this returning `undefined` threw inside the meter's
         own `finally`. The call then reported "the model could not be reached"
         — a stubbed transport that never failed, reported as a provider
         failure, with the row written. A double that is the wrong SHAPE breaks
         the thing it is standing in for. */
      record: async (row: { job?: unknown; requestedModel?: unknown; outcome?: unknown }) => {
        LEDGER_ROWS.push({
          job: String(row.job),
          model: String(row.requestedModel),
          outcome: String(row.outcome),
        });
      },
      read: async () => [],
      forJob: async () => [],
      size: async () => LEDGER_ROWS.length,
    },
  };
});

/** The rows written since the last reset. Read through a function so the
 *  hoisted mock above and the tests below cannot hold different arrays. */
function recordedRows(): { job: string; model: string; outcome: string }[] {
  return [...LEDGER_ROWS];
}

beforeEach(() => {
  LEDGER_ROWS.length = 0;
  /* The gateway refuses without a key, and the owner is required before a row
     can be attributed. Both are fixtures: the transport is stubbed, so nothing
     here can reach a provider even if the key were real. */
  process.env.OPENROUTER_API_KEY = "sk-or-fixture-never-sent-anywhere";
  process.env.SPIDERYARN_OWNER_ID ??= "6b1d9f3a-2c4e-4d7b-8a5f-9e0c1b2d3f4a";
});

import { withLedger } from "../src/cli-ledger.js";
import { AI_JOB_ROUTE } from "../src/ai-call.js";
import type { AiRequestBody, ChatJob, JsonCall } from "../src/ai-call.js";
import { CAPABLE_MODEL_OPENROUTER } from "../src/models.js";
import { ALLOWLIST, FORBIDDEN_NAMES } from "../scripts/gjd-remote-env.js";
import {
  applyGuards,
  buildProposalRequest,
  type ChecklistInput,
  type ChecklistItem,
  type Guards,
  defaultConfigHome,
  defaultProposalCall,
  type EnvPlan,
  type EnvPlanDeps,
  EnvPolicyError,
  extractEnvKeyNames,
  pushEnvPlan,
  type SavedPolicy,
  KEY_CLASSES,
  makeProposalCall,
  MAX_NAMES,
  MAX_REASON_CHARS,
  parseProposal,
  planChecklist,
  policyPath,
  type Proposal,
  type ProposedKey,
  PROPOSAL_MODEL,
  proposeEnvKeys,
  PROPOSAL_JOB,
  readPolicy,
  readProposalContent,
  selectableNames,
  serialisePolicy,
  writePolicy,
} from "../scripts/gjd-remote-envpolicy.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "gjd-envpolicy-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A reply envelope shaped the way OpenRouter's is, carrying `content`. */
function envelope(content: string): JsonCall {
  return {
    json: { choices: [{ message: { content } }] },
    answeredBy: null,
    generationId: null,
  };
}

/** The one thing the CLI supplies that this module refuses to compute itself. */
const allLocal = (): "ok" => "ok";

function checklistInput(over: Partial<ChecklistInput> = {}): ChecklistInput {
  const base: ChecklistInput = {
    names: [],
    proposal: undefined,
    approved: undefined,
    reviewed: undefined,
    savedAt: undefined,
    preTick: "proposal",
    forbiddenNames: new Set(FORBIDDEN_NAMES),
    valueGuard: allLocal,
  };
  return { ...base, ...over };
}

/** The guards out of a checklist input, so a test hands `applyGuards` the SAME
 *  pair `planChecklist` was given. Passing a different pair is a legitimate
 *  thing to do — see the test that does it on purpose — but it must be done on
 *  purpose. */
function guardsFrom(input: ChecklistInput): Guards {
  return { forbiddenNames: input.forbiddenNames, valueGuard: input.valueGuard };
}

// --------------------------------------------------------- the one that matters

describe("no value reaches any sink", () => {
  it("keeps every sentinel out of names, problems, the request, the rows, the file and every error", () => {
    /* One sentinel per line, all distinct, so a leak names the line it came
       from. Deliberately awkward input: a duplicate, a line that is not a
       KEY=value at all, an unclosed quote that swallows what follows, and a
       multi-line quoted value with something key-shaped inside it — every one
       of those is a path through `scanEnv` that could put file content into a
       message. */
    const sentinels = Array.from({ length: 9 }, (_, i) => `SENTINEL_VALUE_7f3a${i}${"z".repeat(4)}`);
    const text = [
      `# ${sentinels[0]}`,
      `LOCAL_PORT=${sentinels[1]}`,
      `export SHARED_KEY=${sentinels[2]}`,
      `SIGNING_SECRET="${sentinels[3]}"`,
      `${sentinels[4]}`,
      `LOCAL_PORT=${sentinels[5]}`,
      `PEM_BLOCK="-----BEGIN KEY-----`,
      `${sentinels[6]}`,
      `-----END KEY-----"`,
      `DANGLING='${sentinels[7]}`,
      `TRAILING=${sentinels[8]}`,
    ].join("\n");

    const forbidden = (haystack: string, where: string) => {
      for (const s of sentinels) expect(haystack, `${where} leaked ${s}`).not.toContain(s);
    };

    // Sink 1 and 2: the extracted names, and what the parse had to overlook.
    const { names, problems } = extractEnvKeyNames(text);
    expect(names).toEqual([
      "LOCAL_PORT",
      "SHARED_KEY",
      "SIGNING_SECRET",
      "PEM_BLOCK",
      "DANGLING",
    ]);
    forbidden(JSON.stringify(names), "names");
    forbidden(JSON.stringify(problems), "problems");
    // The problems are real, so this is not a vacuous pass.
    expect(problems.length).toBeGreaterThanOrEqual(3);

    // Sink 3: the bytes that would go to the provider.
    forbidden(JSON.stringify(buildProposalRequest(names)), "the request body");

    // Sink 4: the rows a reader would see, proposal and all.
    const proposal = new Map<string, ProposedKey>(
      names.map((n) => [n, { class: "unknown", reason: "cannot tell from the name" }] as const),
    );
    const rowsInput = checklistInput({
      names,
      proposal,
      approved: new Set(["LOCAL_PORT"]),
      valueGuard: (n) => (n === "SIGNING_SECRET" ? "not-local" : "ok"),
    });
    const items = planChecklist(rowsInput);
    forbidden(JSON.stringify(items), "the checklist");
    forbidden(JSON.stringify(applyGuards(names, items, guardsFrom(rowsInput))), "the guard outcome");

    // Sink 5: the file that gets written, through the real writer.
    const home = tempDir();
    const file = policyPath("gregdetre/hellozenno", home);
    writePolicy(file, { repo: "gregdetre/hellozenno", approved: names, reviewed: names }, new Date(0));
    forbidden(readFileSync(file, "utf8"), "the saved policy");
    forbidden(JSON.stringify(readPolicy(file, "gregdetre/hellozenno")), "the policy read back");

    // Sink 6: every error any of this can throw, on malformed input at both ends.
    const thrown: string[] = [];
    const capture = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        thrown.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      }
    };
    capture(() => extractEnvKeyNames(`${text}\n${"=".repeat(3)}${sentinels[0]}`));
    capture(() => buildProposalRequest([]));
    capture(() => buildProposalRequest(Array.from({ length: MAX_NAMES + 1 }, (_, i) => `K${i}`)));
    capture(() => serialisePolicy({ repo: "gregdetre/hellozenno", approved: ["not a name"], reviewed: ["not a name"] }, new Date(0)));
    capture(() => policyPath("unknown", home));
    // The model's reply is malformed in the two ways a reply can be.
    expect(readProposalContent({ choices: [{ message: { content: "not json {" } }] }).ok).toBe(false);
    forbidden(JSON.stringify(readProposalContent({ choices: [] })), "the envelope reader");
    forbidden(
      JSON.stringify(parseProposal({ keys: [{ name: "NOPE", class: "unknown", reason: "x" }] }, names)),
      "the proposal validator",
    );
    // Four of the five throw; `extractEnvKeyNames` reports rather than throwing,
    // and that arm is here so a future version of it that DOES throw is covered.
    expect(thrown.length).toBe(4);
    forbidden(thrown.join("\n"), "the thrown errors");
  });
});

// ------------------------------------------------------------- part 1: names

describe("extractEnvKeyNames", () => {
  it("gives the names in file order", () => {
    const { names } = extractEnvKeyNames("B=1\nA=2\nC=3\n");
    expect(names).toEqual(["B", "A", "C"]);
  });

  it("de-duplicates a repeated key and says it was repeated, by line number", () => {
    const { names, problems } = extractEnvKeyNames("A=1\nB=2\nA=3\n");
    expect(names).toEqual(["A", "B"]);
    expect(problems).toEqual(["line 3: A is set more than once — only the last value would be sent"]);
  });

  it("names a malformed line by its number and nothing else", () => {
    const { problems } = extractEnvKeyNames("A=1\nthis is not a setting\n");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("line 2");
    expect(problems[0]).not.toContain("this is not a setting");
  });
});

// ------------------------------------------------------------ part 2: the model

describe("buildProposalRequest", () => {
  it("sends the names and the measured model, and nothing that could carry a value", () => {
    const body = buildProposalRequest(["ALPHA", "BETA"]);
    expect(body.model).toBe(PROPOSAL_MODEL);
    expect(PROPOSAL_MODEL).toBe(CAPABLE_MODEL_OPENROUTER);
    const wire = JSON.stringify(body);
    expect(wire).toContain("ALPHA");
    expect(wire).toContain("BETA");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sends exactly these three parameters and no others", () => {
    /* **The guard for a bug that cost two ledger rows and produced nothing.**
       `AI_JOB_ROUTE["env-proposal"]` sets `require_parameters: true`, so a
       parameter no upstream of the chosen model accepts does not get quietly
       dropped the way it does everywhere else in this app — OpenRouter filters
       every endpoint away and answers 404. A `temperature: 0` here did exactly
       that, and `proposeEnvKeys` reported it as "the model could not be
       reached", which is indistinguishable from a provider having a bad
       afternoon. docs/research/260902b-env-key-proposal-spike.md.

       Pinned as an exact set rather than as "no temperature", because the next
       one will not be called temperature. Adding a key here means checking
       first that the model's upstreams accept it. */
    expect(Object.keys(buildProposalRequest(["ALPHA"])).sort()).toEqual([
      "messages",
      "model",
      "response_format",
    ]);
  });

  it("refuses an empty list rather than asking a model about nothing", () => {
    expect(() => buildProposalRequest([])).toThrow(EnvPolicyError);
  });

  it("refuses a .env.local that is too big to be one", () => {
    const many = Array.from({ length: MAX_NAMES + 1 }, (_, i) => `K${i}`);
    expect(() => buildProposalRequest(many)).toThrow(/limit is 200/);
  });
});

describe("readProposalContent", () => {
  it("takes the model's own words out of the envelope", () => {
    const got = readProposalContent({ choices: [{ message: { content: '{"keys":[]}' } }] });
    expect(got).toEqual({ ok: true, value: { keys: [] } });
  });

  it("refuses a reply that is not JSON, without repeating it", () => {
    const bad = "<!doctype html><title>gateway timeout</title>";
    const got = readProposalContent({ choices: [{ message: { content: bad } }] });
    expect(got.ok).toBe(false);
    expect(JSON.stringify(got)).not.toContain("doctype");
  });

  it.each([
    ["not an object", 42],
    ["no choices", {}],
    ["empty choices", { choices: [] }],
    ["no content", { choices: [{ message: {} }] }],
  ])("refuses %s", (_label, json) => {
    expect(readProposalContent(json).ok).toBe(false);
  });
});

describe("parseProposal fails closed", () => {
  const names = ["ALPHA", "BETA"];
  const good = { keys: [{ name: "ALPHA", class: "local-dev-only", reason: "a port" }] };

  it("accepts an answer about a subset of what was asked", () => {
    const got = parseProposal(good, names);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.proposal.get("ALPHA")).toEqual({ class: "local-dev-only", reason: "a port" });
    expect(got.proposal.has("BETA")).toBe(false);
  });

  it("refuses a name it was never asked about, naming it", () => {
    const got = parseProposal({ keys: [...good.keys, { name: "GAMMA", class: "unknown", reason: "" }] }, names);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.why).toContain("GAMMA");
  });

  it("refuses a duplicate rather than taking the last one", () => {
    const got = parseProposal({ keys: [...good.keys, ...good.keys] }, names);
    expect(got).toEqual({ ok: false, why: "the model answered about 'ALPHA' twice" });
  });

  it("refuses a class outside the five", () => {
    const got = parseProposal({ keys: [{ name: "ALPHA", class: "probably-fine", reason: "" }] }, names);
    expect(got.ok).toBe(false);
  });

  it.each([
    ["a number", 7],
    ["an array", []],
    ["null", null],
    ["no keys array", { key: [] }],
    ["keys that is not an array", { keys: {} }],
    ["an entry that is not an object", { keys: ["ALPHA"] }],
    ["an entry with no name", { keys: [{ class: "unknown", reason: "" }] }],
    ["an entry with no reason", { keys: [{ name: "ALPHA", class: "unknown" }] }],
  ])("refuses %s", (_label, json) => {
    expect(parseProposal(json, names).ok).toBe(false);
  });

  it("strips control characters out of a reason and caps its length", () => {
    const nasty = `\u001b[2Jwiped\u0007  the\n screen${"!".repeat(400)}`;
    const got = parseProposal({ keys: [{ name: "ALPHA", class: "unknown", reason: nasty }] }, names);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const reason = got.proposal.get("ALPHA")?.reason ?? "";
    // biome-ignore lint/suspicious/noControlCharactersInRegex: proving they are gone needs naming them.
    expect(reason).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });

  it("keeps every class it advertises usable", () => {
    for (const cls of KEY_CLASSES) {
      expect(parseProposal({ keys: [{ name: "ALPHA", class: cls, reason: "" }] }, names).ok).toBe(true);
    }
  });
});

describe("the call itself", () => {
  it("passes the env-proposal job name to the gateway", async () => {
    const seen: { job: ChatJob; body: AiRequestBody }[] = [];
    const call = makeProposalCall(async (job, body) => {
      seen.push({ job, body });
      return envelope('{"keys":[]}');
    });
    await call(buildProposalRequest(["ALPHA"]));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.job).toBe("env-proposal");
    expect(PROPOSAL_JOB).toBe("env-proposal");
    expect(seen[0]?.body.model).toBe(PROPOSAL_MODEL);
  });

  it("names a job the routing table actually knows, and pins no upstream", () => {
    /* The job name is what decides the route, the wire and what the spend row
       is called, so a name the table has never heard of would route by
       accident. Checked against the table rather than against a second copy of
       the string. */
    const route = AI_JOB_ROUTE[PROPOSAL_JOB];
    expect(route.path).toBe("/v1/chat/completions");
    /* `provider` went nullable on 2026-09-03 so the images route could send no
       `provider` key at all. Assert it is there before reaching through `?.`,
       or the two `toBeUndefined`s below would pass on a `null` by agreeing that
       nothing is nothing. */
    expect(route.provider).not.toBeNull();
    expect(route.provider?.order).toBeUndefined();
    expect(route.provider?.only).toBeUndefined();
    expect(route.provider?.require_parameters).toBe(true);
    // The real call is this and nothing else; the test above proves the binding.
    expect(typeof defaultProposalCall).toBe("function");
  });

  it("comes back with a proposal when the model behaves", async () => {
    const got = await proposeEnvKeys(["ALPHA"], {
      call: async () => envelope('{"keys":[{"name":"ALPHA","class":"local-dev-only","reason":"a port"}]}'),
    });
    expect(got.ok).toBe(true);
  });

  it("turns a provider failure into no proposal, not an exception, and repeats none of it", async () => {
    const got = await proposeEnvKeys(["ALPHA"], {
      call: async () => {
        throw new Error("402 upstream said: BALANCE 0 for key sk-or-secret");
      },
    });
    expect(got).toEqual({ ok: false, why: "the model could not be reached" });
  });

  it("lets its own refusal through rather than dressing it as a provider failure", async () => {
    await expect(proposeEnvKeys([], { call: async () => envelope("{}") })).rejects.toThrow(EnvPolicyError);
  });
});

/**
 * **The whole call, for real, from `defaultProposalCall` down to the bytes on
 * the wire and the row in the ledger** — GPT Sol's Stage 3 finding 6.
 *
 * Everything above this stubs `ProposalCall`, so the only thing proved about the
 * real one was `typeof defaultProposalCall === "function"`. That leaves the
 * whole of `openRouterJson` untested here: the route it picks, the `provider`
 * block it attaches, the body it actually serialises, and — the expensive one —
 * whether one attempt writes exactly one spend row. `npm run labels` and `npm
 * run pdf` each spent for weeks with no ledger open — both commands have since
 * gone, the first retired and the second renamed `npm run eval:pdf-read`
 * (2026-09-05) — and a test that stops at the seam cannot see that.
 *
 * So: the real `withLedger("cli", …)`, the real gateway, and only `fetch` and
 * the ledger's STORE replaced. The store is mocked rather than the collector,
 * so `collectSpend`, the attribution and the row-building all run.
 *
 * **`temperature` has its own assertion**, and it is the reason this test exists
 * at the wire rather than at the seam: `require_parameters: true` turns an
 * unsupported parameter into a 404 with every upstream filtered out, and the
 * feature reported that as "the model could not be reached". A stub of
 * `ProposalCall` cannot notice, because the parameter is legal all the way to
 * OpenRouter's router — docs/research/260902b-env-key-proposal-spike.md.
 */
describe("the real call, on a stubbed transport and a real ledger", () => {
  const NAMES = ["LOCAL_PORT", "PROVIDER_KEY"];
  const GOOD = JSON.stringify({
    keys: [
      { name: "LOCAL_PORT", class: "local-dev-only", reason: "a port" },
      { name: "PROVIDER_KEY", class: "shared-provider-key", reason: "a paid key" },
    ],
  });

  /** One canned chat/completions reply, with usage so the meter has something
   *  to price and the row is not empty by accident. */
  function reply(content: string, status = 200): Response {
    const body = JSON.stringify({
      id: "gen-fixture",
      model: PROPOSAL_MODEL,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }

  type Sent = { url: string; body: Record<string, unknown> };

  /** Run one proposal with the ledger open, and hand back everything it
   *  touched: the requests, the rows, the answer, and anything printed. */
  async function runOne(response: () => Response): Promise<{
    sent: Sent[];
    rows: { job: string; model: string; outcome: string }[];
    result: Proposal | undefined;
    printed: string;
  }> {
    const sent: Sent[] = [];
    const printed: string[] = [];
    const fetchStub = vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string } | undefined)?.body ?? "{}";
      sent.push({ url: String(url), body: JSON.parse(body) as Record<string, unknown> });
      return response();
    });
    const realFetch = globalThis.fetch;
    // Both streams: `withLedger` prints its total on stdout, and a leak into a
    // warning on stderr would be just as bad as one into the answer.
    const outSpy = vi.spyOn(console, "log").mockImplementation((...a) => void printed.push(a.join(" ")));
    const errSpy = vi.spyOn(console, "warn").mockImplementation((...a) => void printed.push(a.join(" ")));
    const errSpy2 = vi.spyOn(console, "error").mockImplementation((...a) => void printed.push(a.join(" ")));
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    let result: Proposal | undefined;
    try {
      await withLedger("cli", async () => {
        result = await proposeEnvKeys(NAMES, { call: defaultProposalCall });
      });
    } finally {
      globalThis.fetch = realFetch;
      outSpy.mockRestore();
      errSpy.mockRestore();
      errSpy2.mockRestore();
    }
    return { sent, rows: recordedRows(), result, printed: printed.join("\n") };
  }

  it("sends the job's route, the capable model, and no temperature", async () => {
    const { sent, result } = await runOne(() => reply(GOOD));
    expect(sent).toHaveLength(1);
    const one = sent[0];
    expect(one?.url).toContain("/v1/chat/completions");
    expect(one?.body.model).toBe(PROPOSAL_MODEL);
    expect(one?.body.response_format).toEqual({ type: "json_object" });
    expect(one?.body.provider).toMatchObject({ require_parameters: true });
    // THE ONE THAT COST AN AFTERNOON. `toBeUndefined` would pass on a body that
    // carries `temperature: undefined` through JSON, so the KEY is what is
    // asserted — the same reason `buildProposalRequest`'s own test pins the key
    // set rather than the values.
    expect(Object.keys(one?.body ?? {})).not.toContain("temperature");
    expect(result).toMatchObject({ ok: true });
  });

  it("writes exactly one ledger row for one attempt", async () => {
    const { rows } = await runOne(() => reply(GOOD));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.job).toBe(PROPOSAL_JOB);
    expect(rows[0]?.model).toBe(PROPOSAL_MODEL);
  });

  /* The two failures that must still cost a row. A call that failed is a call
     that was paid for — or at least attempted — and a ledger that only counts
     successes is a ledger that reads low exactly when something is wrong. */
  it("still writes one row when the model's answer is not the JSON it was asked for", async () => {
    const { rows, result } = await runOne(() => reply("I am afraid I cannot do that."));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.job).toBe(PROPOSAL_JOB);
    expect(result?.ok).toBe(false);
  });

  it("still writes one row when the provider refuses outright", async () => {
    const { rows, result } = await runOne(() => reply("{}", 402));
    expect(rows).toHaveLength(1);
    expect(result).toEqual({ ok: false, why: "the model could not be reached" });
  });

  /**
   * The sentinel test above covers the pure sinks. This is the one sink it
   * cannot reach: a value would have to travel through the real request, the
   * real meter and the real ledger row to get here, and `withLedger` prints to
   * stdout on its way out.
   */
  it("puts no value into the wire, the ledger row or anything printed", async () => {
    const { sent, rows, printed } = await runOne(() => reply(GOOD));
    const haystack = [JSON.stringify(sent), JSON.stringify(rows), printed].join("\n");
    // Names travel; nothing else from a .env.local does. The sentinel never
    // enters this test's inputs, so its absence is checked the same way the
    // big test checks it: against a string that would be there if it leaked.
    for (const sentinel of ["sk-or-", "postgres://", "hunter2"]) {
      expect(haystack).not.toContain(sentinel);
    }
    expect(haystack).toContain("LOCAL_PORT");
  });
});

// -------------------------------------------------------- part 3: the checklist

describe("planChecklist", () => {
  const names = ["LOCAL_PORT", "PROVIDER_KEY", "SESSION_SECRET", "MYSTERY", FORBIDDEN_NAMES[0] ?? ""];
  const proposal = new Map<string, ProposedKey>([
    ["LOCAL_PORT", { class: "local-dev-only", reason: "a port" }],
    ["PROVIDER_KEY", { class: "shared-provider-key", reason: "a paid api key" }],
    ["SESSION_SECRET", { class: "production-or-signing-secret", reason: "signs sessions" }],
    ["MYSTERY", { class: "unknown", reason: "cannot tell" }],
  ]);

  it("pre-ticks the two safe classes and nothing else under 'proposal'", () => {
    const items = planChecklist(checklistInput({ names, proposal }));
    const ticked = items.filter((i) => i.checked).map((i) => i.name);
    expect(ticked).toEqual(["LOCAL_PORT", "PROVIDER_KEY"]);
  });

  it("pre-ticks only what a person approved before under 'approved-only'", () => {
    const items = planChecklist(
      checklistInput({ names, proposal, preTick: "approved-only", approved: new Set(["SESSION_SECRET"]) }),
    );
    expect(items.filter((i) => i.checked).map((i) => i.name)).toEqual(["SESSION_SECRET"]);
  });

  it("pre-ticks nothing at all when the model's reply was unusable", () => {
    const items = planChecklist(checklistInput({ names, proposal: undefined }));
    expect(items.some((i) => i.checked)).toBe(false);
    expect(items[0]?.description).toContain("no proposal");
  });

  it("marks a key the saved policy has never approved as new", () => {
    const items = planChecklist(checklistInput({ names, proposal, approved: new Set(["LOCAL_PORT"]) }));
    expect(items.find((i) => i.name === "LOCAL_PORT")?.new).toBe(false);
    expect(items.find((i) => i.name === "MYSTERY")?.new).toBe(true);
  });

  it("disables a forbidden name and says why, whatever the model called it", () => {
    const kind = new Map(proposal);
    kind.set(FORBIDDEN_NAMES[0] ?? "", { class: "local-dev-only", reason: "looks harmless to me" });
    const items = planChecklist(checklistInput({ names, proposal: kind }));
    const row = items.find((i) => i.name === FORBIDDEN_NAMES[0]);
    expect(row?.disabled).toBe(true);
    expect(row?.checked).toBe(false);
    expect(row?.description).toContain("never sent");
  });

  it("disables a key whose value the guard says is not local, even if it was approved before", () => {
    const items = planChecklist(
      checklistInput({
        names,
        proposal,
        approved: new Set(names),
        preTick: "approved-only",
        valueGuard: (n) => (n === "LOCAL_PORT" ? "not-local" : "ok"),
      }),
    );
    const row = items.find((i) => i.name === "LOCAL_PORT");
    expect(row?.disabled).toBe(true);
    expect(row?.checked).toBe(false);
  });

  it("offers only eligible rows to a select-all", () => {
    const items = planChecklist(
      checklistInput({ names, proposal, valueGuard: (n) => (n === "MYSTERY" ? "not-local" : "ok") }),
    );
    expect(selectableNames(items)).toEqual(["LOCAL_PORT", "PROVIDER_KEY", "SESSION_SECRET"]);
  });
});

describe("applyGuards re-applies after the reader has chosen", () => {
  const names = ["LOCAL_PORT", "DATABASE_URL", FORBIDDEN_NAMES[0] ?? ""];
  const input = checklistInput({ names, valueGuard: (n) => (n === "DATABASE_URL" ? "not-local" : "ok") });
  const guards = guardsFrom(input);
  const items = planChecklist(input);

  it("refuses a forbidden name the reader ticked anyway", () => {
    const got = applyGuards(names, items, guards);
    expect(got.send).toEqual(["LOCAL_PORT"]);
    expect(got.refused.map((r) => r.name)).toEqual([FORBIDDEN_NAMES[0], "DATABASE_URL"].sort());
  });

  it("refuses a name that is not on the checklist at all", () => {
    const got = applyGuards(["LOCAL_PORT", "SNEAKED_IN"], items, guards);
    expect(got.send).toEqual(["LOCAL_PORT"]);
    expect(got.refused).toEqual([{ name: "SNEAKED_IN", why: "not on the checklist for this repo" }]);
  });

  it("a select-all can never produce a disabled name", () => {
    expect(applyGuards(selectableNames(items), items, guards).refused).toEqual([]);
  });

  it("sends in checklist order however the ticks arrived, and once each", () => {
    expect(applyGuards(["LOCAL_PORT", "LOCAL_PORT"], items, guards).send).toEqual(["LOCAL_PORT"]);
  });

  /**
   * **The guards are run here, not read off the row** — GPT Sol's Stage 3
   * finding 5.
   *
   * `item.disabled` is `planChecklist`'s answer, so a check that reads it is
   * checking the first application's homework: a bug that produced a wrong
   * `disabled` would be honoured by the very function meant to catch it. The
   * rows below are handed in with `disabled: false` and an innocent description
   * — as if the drawing step had got it wrong, or had never run — and the
   * predicates must still refuse them.
   */
  it("refuses a row the checklist wrongly marked as fine", () => {
    const lying: ChecklistItem[] = names.map((name) => ({
      name,
      checked: true,
      disabled: false,
      description: "nothing to see here",
      new: true,
    }));
    const got = applyGuards(names, lying, guards);
    expect(got.send).toEqual(["LOCAL_PORT"]);
    expect(got.refused.map((r) => r.name)).toEqual([FORBIDDEN_NAMES[0], "DATABASE_URL"].sort());
    // And the reason given is the guard's own, not the row's fiction.
    expect(got.refused.map((r) => r.why).join(" ")).not.toContain("nothing to see here");
  });

  /**
   * **Two rows for one name is a stop, not a resolution.**
   *
   * Before this, the disabled row decided the refusal and the enabled row
   * decided the send, so `DATABASE_URL` came back in `refused` AND in `send` —
   * the CLI printed a red cross for a key it was in the middle of sending. There
   * is no correct choice between the two rows; the checklist that has both is
   * the thing that is broken.
   */
  it("throws on a duplicated name rather than both refusing and sending it", () => {
    const doubled = [...items, ...items.filter((i) => i.name === "DATABASE_URL")];
    expect(() => applyGuards(["DATABASE_URL"], doubled, guards)).toThrow(EnvPolicyError);
    expect(() => applyGuards(["DATABASE_URL"], doubled, guards)).toThrow("two rows for 'DATABASE_URL'");
  });

  it("throws even when the duplicate is harmless and nothing was selected", () => {
    // The bug is the checklist, not the tick. Refusing only when the duplicate
    // happens to have been selected would leave it there for the next run.
    const doubled = [...items, ...items.filter((i) => i.name === "LOCAL_PORT")];
    expect(() => applyGuards([], doubled, guards)).toThrow(EnvPolicyError);
  });
});

describe("the forbidden list and the Spideryarn allowlist agree", () => {
  it("never allows a name it also forbids", () => {
    for (const name of FORBIDDEN_NAMES) expect(ALLOWLIST).not.toContain(name);
  });
});

// ------------------------------------------------------ part 4: the saved policy

describe("policyPath", () => {
  it("puts one file per repo under the tool's own config directory", () => {
    expect(policyPath("gregdetre/hellozenno", "/tmp/cfg")).toBe(
      "/tmp/cfg/gjd-remote/repos/gregdetre--hellozenno.toml",
    );
  });

  it("refuses a slug that is not a repo, so nothing can climb out of the directory", () => {
    for (const bad of ["unknown", "../../etc", "nope", "a/b/c", ".."]) {
      expect(() => policyPath(bad, "/tmp/cfg"), bad).toThrow(EnvPolicyError);
    }
  });

  it("follows XDG_CONFIG_HOME when it is set", () => {
    const before = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/tmp/xdg";
    try {
      expect(defaultConfigHome()).toBe("/tmp/xdg");
    } finally {
      if (before === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = before;
    }
  });
});

describe("writePolicy", () => {
  const repo = "gregdetre/hellozenno";
  const when = new Date("2026-09-02T11:22:33.000Z");

  it("writes 0600 into a 0700 directory and reads back what it wrote", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    writePolicy(file, { repo, approved: ["BETA", "ALPHA"], reviewed: ["BETA", "ALPHA", "GAMMA"] }, when);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    const got = readPolicy(file, repo);
    expect(got).toEqual({
      kind: "policy",
      repo,
      approved: ["ALPHA", "BETA"],
      reviewed: ["ALPHA", "BETA", "GAMMA"],
      savedAt: "2026-09-02T11:22:33.000Z",
    });
  });

  it("tightens an existing 0644 file rather than inheriting its permissions", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "repo = \"x\"\n");
    chmodSync(file, 0o644);
    writePolicy(file, { repo, approved: ["ALPHA"], reviewed: ["ALPHA"] }, when);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refuses a symbolic link at the path", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    mkdirSync(path.dirname(file), { recursive: true });
    const elsewhere = path.join(home, "elsewhere.toml");
    writeFileSync(elsewhere, "");
    symlinkSync(elsewhere, file);
    expect(() => writePolicy(file, { repo, approved: ["ALPHA"], reviewed: ["ALPHA"] }, when)).toThrow(/symbolic link/);
    expect(readFileSync(elsewhere, "utf8")).toBe("");
  });

  it("says so when what landed is not what was written", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    expect(() =>
      writePolicy(file, { repo, approved: ["ALPHA"], reviewed: ["ALPHA"] }, when, {
        write: (tempFile) => writeFileSync(tempFile, "repo = \"someone/else\"\n", { mode: 0o600 }),
      }),
    ).toThrow(/does not contain what was just written/);
  });

  it("leaves no temp file behind when the write throws", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    expect(() =>
      writePolicy(file, { repo, approved: ["ALPHA"], reviewed: ["ALPHA"] }, when, {
        write: (tempFile) => {
          writeFileSync(tempFile, "half", { mode: 0o600 });
          throw new Error("disk went away");
        },
      }),
    ).toThrow(/disk went away/);
    expect(readdirSync(path.dirname(file))).toEqual([]);
  });

  it("refuses a name that is not a variable name", () => {
    expect(() => serialisePolicy({ repo, approved: ["not a name"], reviewed: ["not a name"] }, when)).toThrow(EnvPolicyError);
  });
});

describe("readPolicy is strict", () => {
  const repo = "gregdetre/hellozenno";
  function write(text: string): string {
    const home = tempDir();
    const file = policyPath(repo, home);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }

  it("says absent when there is no file, which is not the same as approving nothing", () => {
    expect(readPolicy(policyPath(repo, tempDir()), repo)).toEqual({ kind: "absent" });
  });

  it.each([
    ["an unknown key", 'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\napproved = []\nsetpu = 1\n'],
    ["no repo", "saved_at = 2026-09-02T00:00:00Z\napproved = []\n"],
    ["no approved list", 'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\n'],
    ["no timestamp", 'repo = "gregdetre/hellozenno"\napproved = []\n'],
    ["a non-name entry", 'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\napproved = ["not a name"]\n'],
    ["a duplicate entry", 'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\napproved = ["A", "A"]\n'],
    ["broken TOML", "approved = [\n"],
  ])("refuses %s", (_label, text) => {
    expect(readPolicy(write(text), repo).kind).toBe("error");
  });

  it("refuses a file that belongs to another repo", () => {
    const file = write('repo = "gregdetre/other"\nsaved_at = 2026-09-02T00:00:00Z\napproved = []\n');
    const got = readPolicy(file, repo);
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.why).toContain("gregdetre/other");
  });

  /**
   * **A file with no `reviewed` list is one written before that list existed.**
   *
   * The migration is `reviewed = approved`, which is the only reading that
   * cannot change an answer: everything in the old file was a yes.
   */
  it("reads a policy written before 'reviewed' existed as having decided its approvals", () => {
    const file = write(
      'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\napproved = ["ALPHA", "BETA"]\n',
    );
    expect(readPolicy(file, repo)).toEqual({
      kind: "policy",
      repo,
      approved: ["ALPHA", "BETA"],
      reviewed: ["ALPHA", "BETA"],
      savedAt: "2026-09-02T00:00:00.000Z",
    });
  });

  it("refuses a file that approves a name it does not record as decided", () => {
    const file = write(
      'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\napproved = ["ALPHA"]\nreviewed = ["BETA"]\n',
    );
    const got = readPolicy(file, repo);
    expect(got.kind).toBe("error");
    if (got.kind !== "error") return;
    expect(got.why).toContain("ALPHA");
  });

  it("refuses a 'reviewed' list that is not a list of names", () => {
    const file = write(
      'repo = "gregdetre/hellozenno"\nsaved_at = 2026-09-02T00:00:00Z\napproved = []\nreviewed = ["not a name"]\n',
    );
    expect(readPolicy(file, repo).kind).toBe("error");
  });
});

/**
 * **What the policy remembers, and the half of it that used to be forgotten.**
 *
 * GPT Sol's Stage 4 finding 1: the file held approvals only, so "I looked at
 * this key and said no" and "I have never seen this key" were the same state.
 * Every run re-proposed every unticked key — a paid call for an answer already
 * given — and a model that changed its mind could pre-tick a key somebody had
 * deliberately refused.
 *
 * These four are the whole of the fix, one test each: the decision survives, it
 * outranks a later model, the invariant is enforced at both ends, and an old
 * file still reads (above).
 */
describe("a decision the reader has already made", () => {
  const savedAt = "2026-09-02T11:22:33.000Z";
  const names = ["LOCAL_PORT", "SESSION_SECRET"];
  /* The model calls the rejected key safe. Under the bug, `preTick: "proposal"`
     ticked it back on. */
  const proposal = new Map<string, ProposedKey>([
    ["LOCAL_PORT", { class: "local-dev-only", reason: "a port" }],
    ["SESSION_SECRET", { class: "local-dev-only", reason: "looks harmless to me" }],
  ]);

  function rows(over: Partial<ChecklistInput> = {}): Map<string, ChecklistItem> {
    const items = planChecklist(
      checklistInput({
        names,
        proposal,
        approved: new Set(["LOCAL_PORT"]),
        reviewed: new Set(names),
        savedAt,
        ...over,
      }),
    );
    return new Map(items.map((i) => [i.name, i]));
  }

  it("stays unticked next time, whatever today's model calls it", () => {
    const row = rows().get("SESSION_SECRET");
    expect(row?.checked).toBe(false);
    expect(row?.description).toContain("you unticked this on 2026-09-02");
    // And the model's flattering reason is not repeated next to it, because a
    // "this is harmless" beside a decision to refuse reads as an invitation.
    expect(row?.description).not.toContain("looks harmless");
  });

  it("stays ticked next time, even when today's model calls it a secret", () => {
    const row = rows({
      proposal: new Map([["LOCAL_PORT", { class: "production-or-signing-secret", reason: "signs things" }]]),
    }).get("LOCAL_PORT");
    expect(row?.checked).toBe(true);
  });

  it("leaves a key nobody has decided about to the proposal", () => {
    const row = rows({ names: [...names, "NEW_KEY"], proposal: new Map([...proposal, ["NEW_KEY", { class: "local-dev-only", reason: "new" }]]) }).get("NEW_KEY");
    expect(row?.checked).toBe(true);
    expect(row?.description).toContain("not sent before");
  });

  it("is still refused by the hard guards, decision or no decision", () => {
    const forbidden = FORBIDDEN_NAMES[0] ?? "";
    const row = rows({
      names: [...names, forbidden],
      approved: new Set(["LOCAL_PORT", forbidden]),
      reviewed: new Set([...names, forbidden]),
    }).get(forbidden);
    expect(row?.disabled).toBe(true);
    expect(row?.checked).toBe(false);
  });

  it("will not be written down as approved without being written down as decided", () => {
    expect(() =>
      serialisePolicy({ repo: "gregdetre/hellozenno", approved: ["ALPHA"], reviewed: ["BETA"] }, new Date(0)),
    ).toThrow(/ALPHA/);
  });
});

// ------------------------------------------------------ part 5: the whole plan

/**
 * **`pushEnvPlan` is `push-env` minus the ssh**, and this is where the value-leak
 * property is finally checked end to end.
 *
 * The old transport test asserted that `sk-or-`, `postgres://` and `hunter2` were
 * absent from the wire — and none of the three was ever in its inputs, so it was
 * three assertions about nothing (GPT Sol's Stage 4 finding 2). The test below
 * puts a distinct sentinel in every VALUE of a real `.env.local`, runs the whole
 * decision through a real `withLedger` and a stubbed transport, and asserts that
 * the only place any of them comes out is the payload for the box.
 *
 * Watched going red by appending the value to the row description in
 * `planChecklist`: it failed on the rows sink, the `say` sink and the prompt
 * sink at once, and on nothing else — which is why they are all in one `it`.
 */
describe("pushEnvPlan", () => {
  const slug = "gregdetre/hellozenno";
  const FORBIDDEN = FORBIDDEN_NAMES[0] ?? "HETZNER_CLOUD_API_TOKEN";
  /** Selectable: the first three. Blocked: the hosted database URL by its value,
   *  and the infrastructure token by its name. */
  const ELIGIBLE = ["LOCAL_PORT", "OPENAI_API_KEY", "DATABASE_URL"];
  const ALL_NAMES = [...ELIGIBLE, "DATABASE_URL_PROD", FORBIDDEN];
  const S = {
    port: "SENTINEL_VALUE_alpha11",
    key: "SENTINEL_VALUE_bravo22",
    localDb: "SENTINEL_VALUE_charlie33",
    prodDb: "SENTINEL_VALUE_delta44",
    token: "SENTINEL_VALUE_echo55",
  };
  const ENV = [
    `LOCAL_PORT=${S.port}`,
    `OPENAI_API_KEY=${S.key}`,
    `DATABASE_URL=postgres://u:${S.localDb}@127.0.0.1:5432/x`,
    `DATABASE_URL_PROD=postgres://u:${S.prodDb}@db.example.com:5432/x`,
    `${FORBIDDEN}=${S.token}`,
    "",
  ].join("\n");

  type Run = {
    plan: EnvPlan;
    /** What each injected callback was handed, and everything printed. */
    asked: string[][];
    offered: ChecklistItem[][];
    confirmed: string[][];
    said: string[];
    sent: { url: string; body: string }[];
    printed: string;
    rows: { job: string; model: string; outcome: string }[];
  };

  /**
   * One whole plan, with the paid call wired the way the CLI wires it: the real
   * `proposeEnvKeys` over the real gateway and a real `withLedger`, with only
   * `fetch` stubbed. The model answers about every name it could have been sent,
   * so `parseProposal`'s subset rule is satisfied whatever the plan asked for.
   */
  async function runPlan(over: {
    text?: string;
    saved?: SavedPolicy;
    flags?: Partial<EnvPlanDeps["flags"]>;
    choose?: (items: readonly ChecklistItem[]) => Promise<readonly string[]>;
    confirm?: boolean;
  } = {}): Promise<Run> {
    const asked: string[][] = [];
    const offered: ChecklistItem[][] = [];
    const confirmed: string[][] = [];
    const said: string[] = [];
    const sent: { url: string; body: string }[] = [];
    const printed: string[] = [];
    const fetchStub = vi.fn(async (url: unknown, init: unknown) => {
      const body = typeof init === "object" && init !== null && "body" in init ? String(init.body) : "";
      sent.push({ url: String(url), body });
      // The model answers about the names it was asked about and no others —
      // an answer naming a key outside the question is refused (fail-closed),
      // which is right, and which a stub that always named all five tripped
      // once the question stopped naming the decided ones.
      const keys = asked[asked.length - 1] ?? ALL_NAMES;
      const content = JSON.stringify({
        keys: keys.map((name) => ({ name, class: "local-dev-only", reason: "a fixture said so" })),
      });
      return new Response(
        JSON.stringify({
          id: "gen-fixture",
          model: PROPOSAL_MODEL,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const realFetch = globalThis.fetch;
    /* The rows THIS run wrote. A test that runs the plan twice must not see the
       first run's row in the second run's answer, which is how "the second run
       asked no model" passed while it asked one. */
    const rowsBefore = recordedRows().length;
    const spies = (["log", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void printed.push(a.join(" "))),
    );
    globalThis.fetch = fetchStub as unknown as typeof fetch;
    try {
      const plan = await pushEnvPlan({
        text: over.text ?? ENV,
        local: "/tmp/fixture/.env.local",
        slug,
        saved: over.saved ?? { kind: "absent" },
        flags: { propose: false, all: false, none: false, save: false, yes: false, ...over.flags },
        propose: async (names) => {
          asked.push([...names]);
          let outcome: Proposal | undefined;
          await withLedger("cli", async () => {
            outcome = await proposeEnvKeys(names, { call: defaultProposalCall });
          });
          return outcome?.ok === true ? outcome.proposal : undefined;
        },
        choose: async (items) => {
          offered.push([...items]);
          return over.choose === undefined
            ? items.filter((i) => i.checked).map((i) => i.name)
            : over.choose(items);
        },
        confirm: async (names) => {
          confirmed.push([...names]);
          return over.confirm ?? true;
        },
        say: (line) => void said.push(line),
      });
      return {
        plan,
        asked,
        offered,
        confirmed,
        said,
        sent,
        printed: printed.join("\n"),
        rows: recordedRows().slice(rowsBefore),
      };
    } finally {
      globalThis.fetch = realFetch;
      for (const s of spies) s.mockRestore();
    }
  }

  it("lets a value out into the payload for the box and into nothing else", async () => {
    const run = await runPlan();
    const policyFile = policyPath(slug, tempDir());
    expect(run.plan.policyToSave).toBeDefined();
    if (run.plan.policyToSave !== undefined) writePolicy(policyFile, run.plan.policyToSave, new Date(0));

    /* Every sink a value would have to come out of to have escaped: the names
       the paid call was given, the bytes that reached the provider, the ledger
       row, the rows the prompt drew, the names the confirmation named, every
       line printed on either stream, and the file left on disk. */
    const sinks: [string, string][] = [
      ["the names the model was asked about", JSON.stringify(run.asked)],
      ["the request that reached the provider", JSON.stringify(run.sent)],
      ["the ledger row", JSON.stringify(run.rows)],
      ["the checklist rows", JSON.stringify(run.offered)],
      ["the confirmation", JSON.stringify(run.confirmed)],
      ["what the plan printed", run.said.join("\n")],
      ["what anything else printed", run.printed],
      ["the saved policy", readFileSync(policyFile, "utf8")],
      ["the plan's own answer", JSON.stringify({ ...run.plan, payload: undefined })],
    ];
    for (const [where, haystack] of sinks) {
      for (const sentinel of Object.values(S)) {
        expect(haystack, `${where} leaked ${sentinel}`).not.toContain(sentinel);
      }
    }

    /* And the anti-vacuous half: the three eligible values ARE in the payload,
       so the sentinels above are strings this test really did put in. */
    const payload = run.plan.payload?.text ?? "";
    expect(payload).toContain(S.port);
    expect(payload).toContain(S.key);
    expect(payload).toContain(S.localDb);
    /* The two blocked ones are nowhere, the payload included. */
    expect(payload).not.toContain(S.prodDb);
    expect(payload).not.toContain(S.token);
    expect(run.plan.send).toEqual(ELIGIBLE);
    expect(run.rows).toHaveLength(1);
  });

  it("asks the model about every selectable name, once, and only names", async () => {
    const run = await runPlan();
    // Not ALL_NAMES: the two hard-guarded keys are greyed out whatever the model
    // says, so a paid opinion on them is a paid opinion on nothing.
    expect(run.asked).toEqual([ELIGIBLE]);
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]?.body).toContain("LOCAL_PORT");
  });

  it("greys out the two hard guards rather than offering them", async () => {
    const run = await runPlan();
    const rows = run.offered[0] ?? [];
    expect(rows.filter((r) => r.disabled).map((r) => r.name)).toEqual([FORBIDDEN, "DATABASE_URL_PROD"].sort((a, b) => ALL_NAMES.indexOf(a) - ALL_NAMES.indexOf(b)));
    expect(selectableNames(rows)).toEqual(ELIGIBLE);
  });

  it("sends nothing and saves nothing when the confirmation is declined", async () => {
    const run = await runPlan({ confirm: false });
    expect(run.plan.send).toEqual([]);
    expect(run.plan.payload).toBeUndefined();
    expect(run.plan.policyToSave).toBeUndefined();
  });

  /**
   * **`--none --save` is a real answer, and the next run must believe it.**
   *
   * This is GPT Sol's finding 1 end to end: the first run records "no" for every
   * eligible key, and the second must neither ask the model nor pre-tick
   * anything. Under the bug the policy read `approved = []`, which is
   * indistinguishable from a repo nobody has ever answered for.
   */
  it("remembers a --none --save, and then asks no model at all", async () => {
    const first = await runPlan({ flags: { none: true, save: true } });
    expect(first.plan.send).toEqual([]);
    expect(first.plan.payload).toBeUndefined();
    expect(first.plan.policyToSave).toEqual({ repo: slug, approved: [], reviewed: ELIGIBLE });

    // Round-tripped through the file rather than passed in memory, because the
    // file is what the next run actually reads.
    const file = policyPath(slug, tempDir());
    if (first.plan.policyToSave !== undefined) writePolicy(file, first.plan.policyToSave, new Date(0));
    const saved = readPolicy(file, slug);
    expect(saved.kind).toBe("policy");
    if (saved.kind !== "policy") return;

    const second = await runPlan({ saved });
    expect(second.asked).toEqual([]);
    expect(second.sent).toEqual([]);
    expect(second.rows).toEqual([]);
    expect(second.said.join("\n")).toContain("skipping the model");
    const rows = second.offered[0] ?? [];
    expect(rows.filter((r) => r.checked)).toEqual([]);
    expect(rows.find((r) => r.name === "LOCAL_PORT")?.description).toContain("you unticked this on 1970-01-01");
  });

  it("asks the model only about the names nobody has decided on", async () => {
    // GPT Sol, post-landing review, finding 1: the reason for asking counted the
    // undecided keys, then the question named every key. A decided name could
    // not be re-ticked by the answer, but "no model is asked about a decided
    // key" was still false.
    const file = policyPath(slug, tempDir());
    writePolicy(file, { repo: slug, approved: ["LOCAL_PORT"], reviewed: ["LOCAL_PORT", "OPENAI_API_KEY"] }, new Date(0));
    const saved = readPolicy(file, slug);
    if (saved.kind !== "policy") throw new Error("the fixture policy did not read back");
    const run = await runPlan({ saved });
    expect(run.asked).toEqual([["DATABASE_URL"]]);
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]?.body).not.toContain("LOCAL_PORT");
    expect(run.sent[0]?.body).not.toContain("OPENAI_API_KEY");
  });

  it("asks anyway under --propose, saved policy or not", async () => {
    const file = policyPath(slug, tempDir());
    writePolicy(file, { repo: slug, approved: [], reviewed: ELIGIBLE }, new Date(0));
    const saved = readPolicy(file, slug);
    if (saved.kind !== "policy") throw new Error("the fixture policy did not read back");
    const run = await runPlan({ saved, flags: { propose: true } });
    expect(run.asked).toEqual([ALL_NAMES]);
  });

  it("keeps the answer for a key that has since left the .env.local", async () => {
    const file = policyPath(slug, tempDir());
    writePolicy(file, { repo: slug, approved: ["GONE"], reviewed: ["GONE", "LOCAL_PORT"] }, new Date(0));
    const saved = readPolicy(file, slug);
    if (saved.kind !== "policy") throw new Error("the fixture policy did not read back");
    const run = await runPlan({ saved, flags: { all: true, yes: true } });
    // GONE was on no checklist, so nobody decided anything about it today.
    expect(run.plan.policyToSave?.approved).toContain("GONE");
    expect(run.plan.policyToSave?.reviewed).toContain("GONE");
    expect(run.plan.send).toEqual(ELIGIBLE);
  });

  it("refuses a file it would silently drop keys out of, before asking any model", async () => {
    await expect(runPlan({ text: "LOCAL_PORT=1\nthis is not a key=value line\n" })).rejects.toThrow(
      EnvPolicyError,
    );
  });

  it("refuses a file with no keys in it at all", async () => {
    await expect(runPlan({ text: "# nothing but a comment\n" })).rejects.toThrow(/nothing to send/);
  });
});
