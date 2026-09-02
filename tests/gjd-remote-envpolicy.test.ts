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
import { afterEach, describe, expect, it } from "vitest";
import { AI_JOB_ROUTE } from "../src/ai-call.js";
import type { AiRequestBody, ChatJob, JsonCall } from "../src/ai-call.js";
import { QUICK_MODEL_OPENROUTER } from "../src/models.js";
import { ALLOWLIST, FORBIDDEN_NAMES } from "../scripts/gjd-remote-env.js";
import {
  applyGuards,
  buildProposalRequest,
  type ChecklistInput,
  defaultConfigHome,
  defaultProposalCall,
  EnvPolicyError,
  extractEnvKeyNames,
  KEY_CLASSES,
  makeProposalCall,
  MAX_NAMES,
  MAX_REASON_CHARS,
  parseProposal,
  planChecklist,
  policyPath,
  type ProposedKey,
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
    preTick: "proposal",
    forbiddenNames: new Set(FORBIDDEN_NAMES),
    valueGuard: allLocal,
  };
  return { ...base, ...over };
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
    const items = planChecklist(
      checklistInput({
        names,
        proposal,
        approved: new Set(["LOCAL_PORT"]),
        valueGuard: (n) => (n === "SIGNING_SECRET" ? "not-local" : "ok"),
      }),
    );
    forbidden(JSON.stringify(items), "the checklist");
    forbidden(JSON.stringify(applyGuards(names, items)), "the guard outcome");

    // Sink 5: the file that gets written, through the real writer.
    const home = tempDir();
    const file = policyPath("gregdetre/hellozenno", home);
    writePolicy(file, { repo: "gregdetre/hellozenno", approved: names }, new Date(0));
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
    capture(() => serialisePolicy({ repo: "gregdetre/hellozenno", approved: ["not a name"] }, new Date(0)));
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
  it("sends the names and the quick model, and nothing that could carry a value", () => {
    const body = buildProposalRequest(["ALPHA", "BETA"]);
    expect(body.model).toBe(QUICK_MODEL_OPENROUTER);
    const wire = JSON.stringify(body);
    expect(wire).toContain("ALPHA");
    expect(wire).toContain("BETA");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
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
    expect(seen[0]?.body.model).toBe(QUICK_MODEL_OPENROUTER);
  });

  it("names a job the routing table actually knows, and pins no upstream", () => {
    /* The job name is what decides the route, the wire and what the spend row
       is called, so a name the table has never heard of would route by
       accident. Checked against the table rather than against a second copy of
       the string. */
    const route = AI_JOB_ROUTE[PROPOSAL_JOB];
    expect(route.path).toBe("/v1/chat/completions");
    expect(route.provider.order).toBeUndefined();
    expect(route.provider.only).toBeUndefined();
    expect(route.provider.require_parameters).toBe(true);
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
  const items = planChecklist(
    checklistInput({ names, valueGuard: (n) => (n === "DATABASE_URL" ? "not-local" : "ok") }),
  );

  it("refuses a forbidden name the reader ticked anyway", () => {
    const got = applyGuards(names, items);
    expect(got.send).toEqual(["LOCAL_PORT"]);
    expect(got.refused.map((r) => r.name)).toEqual([FORBIDDEN_NAMES[0], "DATABASE_URL"].sort());
  });

  it("refuses a name that is not on the checklist at all", () => {
    const got = applyGuards(["LOCAL_PORT", "SNEAKED_IN"], items);
    expect(got.send).toEqual(["LOCAL_PORT"]);
    expect(got.refused).toEqual([{ name: "SNEAKED_IN", why: "not on the checklist for this repo" }]);
  });

  it("a select-all can never produce a disabled name", () => {
    expect(applyGuards(selectableNames(items), items).refused).toEqual([]);
  });

  it("sends in checklist order however the ticks arrived, and once each", () => {
    expect(applyGuards(["LOCAL_PORT", "LOCAL_PORT"], items).send).toEqual(["LOCAL_PORT"]);
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
    writePolicy(file, { repo, approved: ["BETA", "ALPHA"] }, when);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    const got = readPolicy(file, repo);
    expect(got).toEqual({
      kind: "policy",
      repo,
      approved: ["ALPHA", "BETA"],
      savedAt: "2026-09-02T11:22:33.000Z",
    });
  });

  it("tightens an existing 0644 file rather than inheriting its permissions", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "repo = \"x\"\n");
    chmodSync(file, 0o644);
    writePolicy(file, { repo, approved: ["ALPHA"] }, when);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refuses a symbolic link at the path", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    mkdirSync(path.dirname(file), { recursive: true });
    const elsewhere = path.join(home, "elsewhere.toml");
    writeFileSync(elsewhere, "");
    symlinkSync(elsewhere, file);
    expect(() => writePolicy(file, { repo, approved: ["ALPHA"] }, when)).toThrow(/symbolic link/);
    expect(readFileSync(elsewhere, "utf8")).toBe("");
  });

  it("says so when what landed is not what was written", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    expect(() =>
      writePolicy(file, { repo, approved: ["ALPHA"] }, when, {
        write: (tempFile) => writeFileSync(tempFile, "repo = \"someone/else\"\n", { mode: 0o600 }),
      }),
    ).toThrow(/does not contain what was just written/);
  });

  it("leaves no temp file behind when the write throws", () => {
    const home = tempDir();
    const file = policyPath(repo, home);
    expect(() =>
      writePolicy(file, { repo, approved: ["ALPHA"] }, when, {
        write: (tempFile) => {
          writeFileSync(tempFile, "half", { mode: 0o600 });
          throw new Error("disk went away");
        },
      }),
    ).toThrow(/disk went away/);
    expect(readdirSync(path.dirname(file))).toEqual([]);
  });

  it("refuses a name that is not a variable name", () => {
    expect(() => serialisePolicy({ repo, approved: ["not a name"] }, when)).toThrow(EnvPolicyError);
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
});
