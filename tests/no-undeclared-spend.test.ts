/**
 * **Nothing may spend money without saying so.**
 *
 * `npm run cost` claims to have seen every paid call. That claim was true on the
 * day it was written and had already stopped being true by the next morning:
 * eight sites in `evals/`, on two different accounts, spending real money into
 * no total at all — see docs/plans/ai-spend-outside-the-gateway.md.
 *
 * Repairing those was a one-off. This is the part that keeps them repaired. It
 * walks every tracked JavaScript and TypeScript file and asks a narrow question
 * — *does this file have the capability to spend money?* — then insists that
 * every file which does is either one of the seams, or an entry in
 * [`src/spend-declarations.ts`](../src/spend-declarations.ts), or on the small
 * allow-list below with a reason.
 *
 * ## Capability, parsed
 *
 * The first version matched hostnames in raw text and lit up on three dozen
 * files that only *mention* `api.anthropic.com` in a doc comment. The second
 * stripped comments by hand, to avoid depending on a parser that had arrived as
 * somebody else's transitive dependency — this repo is on TypeScript 7, whose
 * package no longer exposes `createSourceFile`. GPT Sol took that apart: a
 * hand-written stripper desynchronises on a nested template literal
 * (`` `a ${`b`}` ``), and the failure is a **false negative** — a `new
 * Anthropic()` after it lands inside what the stripper thinks is a string. A
 * gate that can go quiet is worse than one that can go red.
 *
 * So `@babel/parser` is now a **direct** dev dependency, which is the whole of
 * the objection answered: the risk was never the parser, it was depending on one
 * nobody had declared. What counts as a capability is deliberately short —
 *
 * - **constructing** a provider client, through whatever name the SDK was bound
 *   to — default, namespace or alias — rather than importing the package:
 *   `src/anthropic-call.ts` imports its error classes and can no more make a
 *   call than a type can;
 * - a provider hostname or a paid endpoint path in a string or a template;
 * - the name of an AI credential, which catches `process.env.OPENROUTER_API_KEY`
 *   and equally the regular expression both dictation benches use to pull the
 *   key out of `.env.local` by hand.
 *
 * ## A declaration is not a licence for a file
 *
 * It used to be: any capability in a declared file passed. GPT Sol pointed out
 * that this exempts every *future* call in that file too, and that another file
 * could import the wrapper and reuse an existing id. So a metered declaration
 * exempts its file only while that file actually uses that id, and an id used
 * anywhere else fails. The `unscoped` and unmetered entries are still whole-file
 * admissions — they are printed by name and by age on every `npm run cost`,
 * which is the point of them.
 *
 * ## What defeats it, said out loud
 *
 * A hostname built by concatenation. A base URL arriving in an env var it does
 * not know. A client made by a factory in another file. A provider nobody has
 * heard of. `curl` in a subprocess. It is a **tripwire, not a boundary** — the
 * same thing `src/ai-call.ts` says about its own unexported base URL. The
 * boundary with teeth is `declaredFetch` in evals/declared-spend.ts, which
 * refuses to run outside a declaration. This catches the ordinary case, which is
 * somebody in a hurry, and the ordinary case is the one that has happened.
 */

import { type ParseResult, parse } from "@babel/parser";
import type { File } from "@babel/types";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DECLARATIONS } from "../src/spend-declarations.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Hosts and paid endpoint paths. A literal containing one is a capability. */
const ENDPOINTS = [
  "openrouter.ai",
  "api.anthropic.com",
  "api.openai.com",
  "api.voyageai.com",
  "/v1/chat/completions",
  "/v1/audio/transcriptions",
  "/v1/embeddings",
];

/** The packages whose exports can make a client. */
const SDKS = ["@anthropic-ai/sdk", "openai"];

/** The names those packages export a client class under, besides the default. */
const CLIENT_EXPORTS = ["Anthropic", "OpenAI", "AnthropicBedrock", "AnthropicVertex"];

/**
 * The three ways a declared bypass is allowed to reach the wire. Calling any of
 * them is as much a capability as `new Anthropic()` — they exist so that a
 * bypass keeps an account, not so that it stops counting as one.
 *
 * The first two are the same SDK pointed at different vendors, which is why they
 * are named for the vendor rather than the SDK: `anthropicDirectForDeclared`
 * goes to `api.anthropic.com` on `ANTHROPIC_API_KEY` and `messagesSkinForDeclared`
 * goes to OpenRouter on `OPENROUTER_API_KEY`. The test below pins how many
 * callers the first is allowed.
 */
const GUARDED_TRANSPORTS = [
  "anthropicDirectForDeclared",
  "messagesSkinForDeclared",
  "declaredFetch",
];

/** The credentials that pay for inference. Not Supabase's, not the database's. */
const CREDENTIALS = ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

/**
 * Files allowed to have the capability without being a declared bypass.
 *
 * Every line is a reason, and a file that is here for no reason is the failure
 * this test exists to make visible.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "src/ai-call.ts":
    "The chat/embeddings seam. One of the two places allowed to name OpenRouter.",
  "src/messages-stream.ts":
    "The Messages seam. The other one.",
  "src/env.ts":
    "Loads .env.local. It names the credentials; it never sends one anywhere.",
  "src/models.ts":
    "Names models and routing policy. No transport.",
  "src/auth.ts":
    "Reads Supabase credentials, and is caught only because the matcher is name-based.",
  "src/urls.ts": "URL handling for articles the reader pastes.",
  "src/log-redaction.ts":
    "Knows the credential names precisely so it can keep them out of logs.",
  "src/vercel-health.ts": "Reports which credentials are configured, never their values.",
  "scripts/ai-cost.ts":
    "Reads GET /api/v1/key to reconcile. Costs nothing and buys no inference.",
  "evals/toc-structure/verify-costs.ts":
    "Reads GET /api/v1/generation to reconcile a finished eval run's stored ids against the provider's own cost figures. Costs nothing and buys no inference — and it cannot live in the declared file, because a metered declaration covers only what declaredFetch guards.",
  "evals/declared-spend.ts":
    "The bypass wrapper itself, and the guarded fetch that makes one safe.",
  "src/spend-declarations.ts": "The register. Data, not transport.",
  "tests/public-visibility-pg.test.ts":
    "A positive control for its own fetch spy — `globalThis.fetch` is mocked for the length of the assertion, so no request leaves. Listed by name because a test that really did reach a provider is a thing worth being told about.",
  "tests/declared-spend.test.ts":
    "Exercises the guarded transport against a stubbed global fetch. Listed by name rather than by a blanket tests/ exemption, because a test that really did reach a provider is a thing worth being told about.",

  /* **Six that only ask whether the key is configured.** Each reads
     `OPENROUTER_API_KEY` to fail with a sentence a person can act on, and then
     makes its request through the seam; none of them names an endpoint. Listed
     one by one rather than exempted by a rule, because a *seventh* place
     learning to resolve credentials for itself is how the dictation benches
     came to parse `.env.local` with a regular expression, and that is worth
     one line of friction to find out about. */
  "src/converse.ts": "Presence check only; the call goes through openRouterStream.",
  "src/explain.ts": "Presence check only; the call goes through openRouterStream.",
  "src/search.ts": "Presence check only; the call goes through openRouterStream.",
  "src/transcribe.ts": "Presence check only; the call goes through openRouterJson.",
  "src/pdf-read.ts": "Presence check only; the call goes through openRouterJson.",
  "src/embeddings.ts":
    "Presence check, plus a settings URL in a help message. The call goes through openRouterJson.",

  /* **Three for live conversation mode, and they are the first real exception
     to "everything goes through OpenRouter" since that rule was written.**

     Not a preference. OpenRouter has no realtime API — checked 2026-08-31, its
     two audio endpoints are batch speech and batch transcription, and there is
     no duplex speech-to-speech to route to. The choice was OpenAI directly or
     no live mode.

     They are listed here rather than in DECLARATIONS because a `Declaration`
     cannot currently be written for this call: `ProviderAccount` is
     `"openrouter" | "anthropic"` and `Wire` is `"messages" | "chat" |
     "embeddings"`, so there is nowhere to say "OpenAI, over realtime". Widening
     both is part of metering this properly, and metering it is not built —
     src/live.ts § What this does not do says so out loud, and this spike must
     not be shipped to readers before it is. docs/plans/live-conversation.md. */
  "src/live.ts":
    "Live conversation mode's session builder — the one file allowed to name OpenAI, because OpenRouter has no realtime API to route to. It mints a short-lived browser token and carries no audio; the spend happens on a wire this server never sees, which is also why it is not yet metered.",
  "scripts/live-spike.ts":
    "The spike's local-only server. Names the credential to warn when it is missing; the call itself goes through src/live.ts.",
  "src/web/live/useLiveConversation.ts":
    "The browser half. It posts an SDP offer to api.openai.com with an EPHEMERAL token our server minted — the API key is not in this bundle and cannot be. Caught because the matcher is hostname-based, which is right: this is the file to look at if that ever stops being true.",
};

interface Finding {
  readonly file: string;
  readonly what: string;
}

interface Scan {
  readonly findings: Finding[];
  /** Declaration ids this file passes to `withDeclaredExternalCall`. */
  readonly declarationIds: Set<string>;
  readonly parseErrors: number;
}

/**
 * Every JS/TS file git can see — **tracked *and* not-yet-added**.
 *
 * `--others --exclude-standard` is the load-bearing half. Listing only tracked
 * files would mean a brand-new bypass passed this test on the machine that
 * wrote it and failed for the first time on somebody else's, after the commit —
 * which is exactly the wrong way round. Ignored paths stay out, so `data/` and
 * the scratch files the `.gitignore` already covers are not scanned.
 */
function trackedSources(): string[] {
  const ls = (args: string[]): string[] =>
    execFileSync("git", ["ls-files", "-z", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f))
      .filter((f) => !f.startsWith("node_modules/"));

  const tracked = ls(["--cached"]);
  /* **`scratch-*` at the root is exempt only while it is untracked**, which the
     first version claimed and did not do — it filtered the name unconditionally,
     so a *committed* `scratch-anything.ts` was invisible. GPT Sol.

     The exemption exists because these are one-afternoon spikes that nobody
     intends to keep, and making every agent's suite red for a colleague's
     throwaway file is how a gate gets muted. The moment one is `git add`ed it is
     scanned, which is before it can be committed. */
  const untracked = ls(["--others", "--exclude-standard"]).filter(
    (f) => !/^scratch-[^/]*$/.test(f),
  );
  return [...tracked, ...untracked];
}

/** Babel's own options, in one place — TS and TSX both. */
function parseFile(source: string): ParseResult<File> {
  return parse(source, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    /* Recovery rather than a throw: a file this cannot parse must not make the
       gate *pass*. Errors are collected and reported separately below. */
    errorRecovery: true,
    plugins: ["typescript", "jsx", "decorators-legacy", "explicitResourceManagement"],
  });
}

/** Every node, once. Comments live on `leadingComments` and friends, and are skipped. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.type !== "string") return;
  visit(n);
  for (const [key, value] of Object.entries(n)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(value, visit);
  }
}

const SKIP_KEYS = new Set([
  "loc",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "extra",
]);

/**
 * What a single file can do, and which declaration ids it uses.
 *
 * Exported so the matcher tests below can hand it source text directly rather
 * than writing files into the repo.
 */
export function capabilitiesOf(file: string, source: string): Scan {
  const ast = parseFile(source);
  const found: Finding[] = [];
  const declarationIds = new Set<string>();
  let rawFetches = 0;
  /** Local names bound to a provider SDK — default, namespace, or renamed. */
  const sdkNames = new Set<string>();
  /**
   * **Local name → the guarded transport it actually is.**
   *
   * The same treatment `sdkNames` gets, and for the same reason. Matching the
   * bare identifier at the call site was all this did until 2026-08-31, and GPT
   * Sol pointed out that `import { anthropicDirectForDeclared as direct }` then
   * walks past — which matters more now that one of the transports is pinned to
   * a single caller, because the evasion is a rename anybody might do innocently.
   */
  const transportLocals = new Map<string, string>();
  /** Locals bound to the whole wrapper module, for `spend.declaredFetch(…)`. */
  const transportNamespaces = new Set<string>();

  /* Two passes: an import can be anywhere in the file, and a `new` above it
     would otherwise be missed. Cheap — these are single files. */
  walk(ast.program, (n) => {
    if (n.type === "VariableDeclarator") {
      /* `const { Anthropic } = require("@anthropic-ai/sdk")`, and the whole-module
         form. CommonJS is rare here and was a straight hole. */
      const init = n.init as Record<string, unknown> | undefined;
      const callee = init?.callee as { type?: string; name?: string } | undefined;
      const arg = (init?.arguments as Record<string, unknown>[] | undefined)?.[0];
      if (
        callee?.type === "Identifier" &&
        callee.name === "require" &&
        arg?.type === "StringLiteral" &&
        SDKS.includes(arg.value as string)
      ) {
        const id = n.id as Record<string, unknown>;
        if (id.type === "Identifier") sdkNames.add(id.name as string);
        for (const pr of (id.properties ?? []) as Record<string, unknown>[]) {
          const key = pr.key as { name?: string } | undefined;
          if (key?.name && CLIENT_EXPORTS.includes(key.name)) {
            sdkNames.add((pr.value as { name?: string }).name ?? key.name);
          }
        }
      }
      return;
    }
    if (n.type !== "ImportDeclaration") return;
    const spec = (n.source as { value?: string } | undefined)?.value;
    if (!spec) return;
    if (n.importKind === "type") return;

    /* The wrapper module, by whatever relative path reached it. A specifier
       rather than a resolved path: this scan never touches the filesystem, and
       the basename is unambiguous in this repo. */
    if (/(^|\/)declared-spend\.(js|ts)$/.test(spec)) {
      for (const sp of (n.specifiers ?? []) as Record<string, unknown>[]) {
        if (sp.type === "ImportNamespaceSpecifier") {
          transportNamespaces.add((sp.local as { name: string }).name);
        }
        if (sp.type === "ImportSpecifier" && sp.importKind !== "type") {
          const imported = (sp.imported as { name?: string } | undefined)?.name ?? "";
          if (GUARDED_TRANSPORTS.includes(imported)) {
            transportLocals.set((sp.local as { name: string }).name, imported);
          }
        }
      }
    }

    if (!SDKS.includes(spec)) return;
    for (const sp of (n.specifiers ?? []) as Record<string, unknown>[]) {
      /* The default and the namespace both yield a client. So does a **named**
         import — `import { Anthropic } from "@anthropic-ai/sdk"` works, because
         the SDK exports the class by name as well, and missing it was a
         regression against the text matcher this replaced. GPT Sol.
         `src/anthropic-call.ts` imports `APIError` by name and is still clean,
         because only the client classes count. */
      if (sp.type === "ImportDefaultSpecifier" || sp.type === "ImportNamespaceSpecifier") {
        sdkNames.add((sp.local as { name: string }).name);
      }
      if (
        sp.type === "ImportSpecifier" &&
        sp.importKind !== "type" &&
        CLIENT_EXPORTS.includes((sp.imported as { name?: string } | undefined)?.name ?? "")
      ) {
        sdkNames.add((sp.local as { name: string }).name);
      }
    }
  });

  walk(ast.program, (n) => {
    if (n.type === "NewExpression") {
      const callee = n.callee as Record<string, unknown> | undefined;
      /* `new Anthropic()` and `new SDK.Anthropic()` alike: the root of the
         member chain is what the import bound. */
      const root =
        callee?.type === "Identifier"
          ? (callee.name as string)
          : callee?.type === "MemberExpression"
            ? ((callee.object as { name?: string } | undefined)?.name ?? "")
            : "";
      if (sdkNames.has(root)) found.push({ file, what: `constructs ${root}` });
    }

    if (n.type === "StringLiteral" || n.type === "TemplateElement") {
      const text =
        n.type === "StringLiteral"
          ? (n.value as string)
          : (((n.value as { cooked?: string; raw?: string }).cooked ??
              (n.value as { raw?: string }).raw) ??
            "");
      for (const e of ENDPOINTS) if (text.includes(e)) found.push({ file, what: `names ${e}` });
      for (const c of CREDENTIALS) if (text.includes(c)) found.push({ file, what: `names ${c}` });
    }

    /* `process.env.OPENROUTER_API_KEY` and `const { ANTHROPIC_API_KEY } = …` —
       an identifier, not a string, so the literal branch above misses both. */
    if (n.type === "Identifier" && CREDENTIALS.includes(n.name as string)) {
      found.push({ file, what: `names ${n.name as string}` });
    }
    if (n.type === "RegExpLiteral") {
      const pattern = n.pattern as string;
      for (const c of CREDENTIALS) if (pattern.includes(c)) found.push({ file, what: `matches ${c}` });
    }

    /* Which declaration ids this file claims — the first argument to the
       wrapper, which is the only way to use one. */
    if (n.type === "CallExpression") {
      const callee = n.callee as
        | {
            type?: string;
            name?: string;
            property?: { name?: string };
            object?: { name?: string };
          }
        | undefined;
      if (callee?.type === "Identifier" && callee.name === "withDeclaredExternalCall") {
        const first = (n.arguments as Record<string, unknown>[])[0];
        if (first?.type === "StringLiteral") declarationIds.add(first.value as string);
      }
      /* **The guarded transports count as transport.** They are the whole point
         of the wrapper — `evals/embedding-retrieval.ts` builds its client with
         `messagesSkinForDeclared()` and names no host at all, and under a matcher
         that only knows about `new Anthropic()` its own declaration read as
         stale. Which is the correct behaviour of that check and the wrong answer
         from this one. */
      /* **Resolved to the canonical export name**, so the finding reads the same
         however the caller spelt it — `uses anthropicDirectForDeclared` whether
         it was imported plainly, renamed, or reached through a namespace. The
         bare-identifier fallback stays: a file that gets one of these names from
         somewhere this scan does not model still counts, which is the tripwire
         behaviour and is the direction to fail in. */
      const transport =
        callee?.type === "Identifier"
          ? (transportLocals.get(callee.name as string) ??
            (GUARDED_TRANSPORTS.includes(callee.name as string) ? (callee.name as string) : null))
          : callee?.type === "MemberExpression" &&
              transportNamespaces.has(callee.object?.name ?? "") &&
              GUARDED_TRANSPORTS.includes(callee.property?.name ?? "")
            ? (callee.property?.name as string)
            : null;
      if (transport) found.push({ file, what: `uses ${transport}` });
      /* **A bare `fetch` at a provider — the one capability a declaration never
         covers.** GPT Sol found both holes it closes: a declared file could grow
         an unrelated raw request beside its declared call and stay exempt, and a
         test could make a real request while every endpoint finding in `tests/`
         was being discarded as "probably an assertion". A string in an
         assertion is not passed to `fetch`; this is. */
      /* `fetch(…)`, `globalThis.fetch(…)`, `window.fetch(…)` — a bare
         identifier was all the first version matched, and GPT Sol pointed out
         that the qualified form walked straight past it, inside a metered
         declared file and inside a test. */
      const fetchName =
        callee?.type === "Identifier"
          ? (callee.name as string)
          : callee?.type === "MemberExpression"
            ? (callee.property?.name ?? "")
            : "";
      if (fetchName === "fetch") {
        /* **Recorded unconditionally, and paired with the file's endpoints
           afterwards.** Looking for the hostname inside the call's own
           arguments only catches an inline URL — GPT Sol pointed out that
           `const u = "https://openrouter.ai/…"; fetch(u)` walks past it, and
           does so precisely inside a metered declared file, where the endpoint
           string on its own is exempt. Following the variable would need
           dataflow; pairing "this file names a provider" with "this file calls
           `fetch`" does not, and there is no honest reason for one file to have
           both without being a seam. */
        rawFetches += 1;
      }
    }
  });

  if (rawFetches > 0 && found.some((f) => f.what.startsWith("names /") || ENDPOINTS.some((e) => f.what === `names ${e}`))) {
    found.push({ file, what: "raw fetch at a provider" });
  }
  return { findings: found, declarationIds, parseErrors: ast.errors?.length ?? 0 };
}

/**
 * **The whole per-file verdict**, as a function rather than a loop body.
 *
 * Extracted for the reason `isExempt` was: every rule left inline was a rule
 * nothing could prove. A mutation that let a metered declaration cover a raw
 * `fetch` passed the entire suite, because no file in this repo happens to have
 * that shape — so the only way to watch the rule fail is to hand it one.
 */
export function offenceFor(file: string, scan: Scan): string | null {
  /* A test may *name* an endpoint — one that could not write `openrouter.ai`
     could not check that the seam sends there — but it may not construct a
     client, reach a guarded transport, or hand the string to `fetch`. */
  const caps = file.startsWith("tests/")
    ? scan.findings.filter(isTransport).filter((f) => !f.what.startsWith("names "))
    : scan.findings;
  if (caps.length === 0) return null;
  if (ALLOWED[file]) return null;

  const say = () => `${file} — ${[...new Set(caps.map((c) => c.what))].join(", ")}`;

  /* **A *metered* declaration covers what the wrapper guards, and nothing
     else.** A raw request sitting next to a declared call is how a declared file
     would otherwise acquire unlimited new capability — GPT Sol's point, and the
     reason this is separate from `isExempt`.

     An **unmetered** entry is the opposite kind of statement: it claims nothing
     is accounted for, and a raw fetch is precisely what it admits to. Those are
     printed by name and by age on every `npm run cost` until somebody closes
     them. */
  const raw = caps.some((c) => c.what === "raw fetch at a provider");
  const admitted = DECLARATIONS.some((d) => d.file === file && !d.metered);
  if (raw && !admitted) return say();
  if (isExempt(file, scan)) return null;
  return say();
}

/**
 * **Whether a declaration still covers this file.**
 *
 * A function rather than three lines inside the assertion, so it can be given a
 * made-up file and checked. Left inline, the rule that matters most here — a
 * metered declaration covers its file *only while that file uses its id* — was
 * the one thing in this test that nothing could prove, and a mutation loosening
 * it back to "any declaration, any file" passed every case.
 *
 * `unscoped` and unmetered entries are still whole-file admissions. They are
 * printed by name and by age on every `npm run cost`, which is the point of
 * them: not a permission, a debt with a date on it.
 */
export function isExempt(file: string, scan: Scan): boolean {
  const mine = DECLARATIONS.filter((d) => d.file === file);
  if (mine.length === 0) return false;
  return mine.some((d) => (d.metered ? scan.declarationIds.has(d.id) : true));
}

/** A capability that is transport, as against merely knowing a credential's name. */
function isTransport(f: Finding): boolean {
  return (
    f.what.startsWith("constructs ") ||
    f.what.startsWith("uses ") ||
    f.what === "raw fetch at a provider" ||
    ENDPOINTS.some((e) => f.what === `names ${e}`)
  );
}

describe("no undeclared spend", () => {
  /** Scanned once — the whole repo, and every assertion below reads this. */
  const scans = new Map<string, Scan>();
  for (const file of trackedSources()) {
    scans.set(file, capabilitiesOf(file, readFileSync(path.join(ROOT, file), "utf8")));
  }
  const byId = new Map(DECLARATIONS.map((d) => [d.id, d]));

  it("finds every file that can reach a paid provider", () => {
    const offenders: string[] = [];
    for (const [file, scan] of scans) {
      const offence = offenceFor(file, scan);
      if (offence) offenders.push(offence);
    }

    expect(
      offenders,
      "These files can reach a paid provider and are neither a seam nor declared.\n" +
        "Route the call through src/ai-call.ts or src/messages-stream.ts, or — if the\n" +
        "transport is the thing being measured — add it to DECLARATIONS in\n" +
        "src/spend-declarations.ts with the reason the seam is wrong for it.\n",
    ).toEqual([]);
  });

  it("lets no metered declaration cover a raw request beside its declared call", () => {
    /* The hole GPT Sol named: a declared file could grow an unrelated
       `fetch("https://openrouter.ai/…")` and stay exempt, because the exemption
       was per file rather than per capability. No file here happens to have that
       shape, so the rule is handed one. */
    const metered = DECLARATIONS.find((d) => d.metered)!;
    const withRaw: Scan = {
      findings: [
        { file: metered.file, what: `uses declaredFetch` },
        { file: metered.file, what: "raw fetch at a provider" },
      ],
      declarationIds: new Set([metered.id]),
      parseErrors: 0,
    };
    expect(offenceFor(metered.file, withRaw)).not.toBeNull();
    /* The guarded call on its own is still fine. */
    expect(
      offenceFor(metered.file, { ...withRaw, findings: [withRaw.findings[0]!] }),
    ).toBeNull();
  });

  it("lets an unmetered admission own the raw request it is admitting to", () => {
    const open = DECLARATIONS.find((d) => !d.metered)!;
    expect(
      offenceFor(open.file, {
        findings: [{ file: open.file, what: "raw fetch at a provider" }],
        declarationIds: new Set(),
        parseErrors: 0,
      }),
    ).toBeNull();
  });

  it("lets no test make a real request, however freely it may name one", () => {
    const naming: Scan = {
      findings: [{ file: "tests/x.test.ts", what: "names openrouter.ai" }],
      declarationIds: new Set(),
      parseErrors: 0,
    };
    expect(offenceFor("tests/x.test.ts", naming)).toBeNull();
    expect(
      offenceFor("tests/x.test.ts", {
        ...naming,
        findings: [{ file: "tests/x.test.ts", what: "raw fetch at a provider" }],
      }),
    ).not.toBeNull();
  });

  it("stops covering a file that no longer uses its metered declaration", () => {
    /* The exemption GPT Sol took apart: it used to cover every present *and
       future* capability in a declared file, so a metered entry kept its licence
       long after the call behind it was gone — which is how
       `bench-vocabulary-sources.ts` held a bypass declaration after being
       rewritten to use the seam. */
    const metered = DECLARATIONS.find((d) => d.metered)!;
    const empty: Scan = { findings: [], declarationIds: new Set(), parseErrors: 0 };
    expect(isExempt(metered.file, empty)).toBe(false);
    expect(
      isExempt(metered.file, { ...empty, declarationIds: new Set([metered.id]) }),
    ).toBe(true);
    /* And no declaration covers a file it was not written for. */
    expect(isExempt("evals/somewhere-else.ts", { ...empty, declarationIds: new Set([metered.id]) })).toBe(
      false,
    );
  });

  it("lets no file use a declaration id that was not written for it", () => {
    /* The evasion this closes: import the wrapper somewhere else, pass an id
       that already exists, and every matcher is satisfied. GPT Sol. */
    const wrong: string[] = [];
    for (const [file, scan] of scans) {
      for (const id of scan.declarationIds) {
        const d = byId.get(id);
        if (!d) wrong.push(`${file} uses "${id}", which is in no declaration`);
        else if (d.file !== file) wrong.push(`${file} uses "${id}", declared for ${d.file}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("has no metered declaration that nothing uses", () => {
    /* The other direction. A metered entry whose id appears nowhere is a
       permission with no call behind it, and the next reader takes it as
       evidence that the bypass is necessary. */
    const unused = DECLARATIONS.filter(
      (d) => d.metered && ![...scans.values()].some((s) => s.declarationIds.has(d.id)),
    ).map((d) => d.id);
    expect(unused).toEqual([]);
  });

  it("every `bypass` declaration names a file that really does bypass the seam", () => {
    for (const d of DECLARATIONS) {
      if (d.kind !== "bypass") continue;
      const scan = scans.get(d.file) ?? capabilitiesOf(d.file, readFileSync(path.join(ROOT, d.file), "utf8"));
      /* **Transport, not merely a credential's name.** Checking for any
         capability at all is what let a rewritten file keep its bypass
         declaration: it still said `OPENROUTER_API_KEY` for a presence check,
         and that looked like reaching a provider. */
      expect(
        scan.findings.filter(isTransport).length,
        `${d.id} declares ${d.file} as a bypass, and it no longer reaches a provider directly. Delete the declaration, or change its kind to "unscoped".`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * **One caller of `ANTHROPIC_API_KEY`, and it is the transport bake-off.**
   *
   * Every model call the app makes went through OpenRouter on 2026-08-27
   * (docs/project/ai-gateway.md), and on 2026-08-31 the last two eval callers
   * followed it — all but one. The bake-off keeps its `transport: "anthropic"`
   * arms because *which transport wins* is the question it exists to answer, and
   * an arm forced onto OpenRouter would be comparing OpenRouter with itself.
   *
   * Everything else that speaks the Messages shape has no such reason, and this
   * is the difference between that being true and it being merely true today.
   * A second Anthropic-direct caller is a second vendor, a second bill and a
   * second key to rotate, acquired without anyone deciding to — and it would
   * look exactly like the first: a declared bypass with a plausible sentence
   * attached. So the count is pinned, and adding one means editing this test and
   * writing down why the Skin is wrong for it.
   *
   * Both halves are asserted, because the declaration and the code go stale
   * independently: an entry whose file stopped calling the direct client, and a
   * file that calls it with no entry, are different bugs.
   *
   * **What it does not catch, said out loud** (GPT Sol, 2026-08-31): it counts
   * *files*, not call sites, so a second direct call inside the bake-off is
   * still green — which is fine, since that file's whole permission is to make
   * them. And it cannot stop `evals/declared-spend.ts` growing a *second*
   * factory around `new Anthropic()`, because that file is the allow-listed one
   * by construction. `src/live.ts` is a separate, declared exception to
   * "everything through OpenRouter" on a different axis — OpenAI's realtime API,
   * which OpenRouter does not serve — and is nothing to do with this count.
   */
  it("has exactly one Anthropic-direct caller, and it is the transport bake-off", () => {
    const direct = DECLARATIONS.filter((d) => d.account === "anthropic");
    expect(
      direct.map((d) => d.id),
      "Every other Anthropic/Messages caller in this repo goes through OpenRouter's Skin (docs/project/ai-gateway.md). A new `account: \"anthropic\"` declaration is a second vendor — say here why the Skin is wrong for it, or use messagesSkinForDeclared().",
    ).toEqual(["bakeoff-anthropic-transport"]);

    const callers = [...scans.entries()]
      .filter(([file, scan]) =>
        file !== "evals/declared-spend.ts" &&
        scan.findings.some((f) => f.what === "uses anthropicDirectForDeclared"),
      )
      .map(([file]) => file);
    expect(
      callers,
      "anthropicDirectForDeclared() talks to api.anthropic.com on ANTHROPIC_API_KEY, which is not in .env.local. Use messagesSkinForDeclared() unless the point of the call is the transport itself.",
    ).toEqual([direct[0]?.file]);
  });

  it("an `unscoped` declaration is never marked metered", () => {
    /* `unscoped` means "uses the seam, opens no collector". If it were metered
       there would be nothing to declare. */
    for (const d of DECLARATIONS) {
      if (d.kind === "unscoped") expect(d.metered).toBe(false);
    }
  });

  it("no declaration is a duplicate, and every one says why and when", () => {
    const ids = DECLARATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DECLARATIONS) {
      expect(d.why.length).toBeGreaterThan(40);
      expect(d.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("parses every file it scans, rather than passing one it could not read", () => {
    /* A file Babel cannot parse yields no nodes and therefore no findings —
       which reads exactly like a clean file. Recovery keeps the errors instead
       of throwing, and this is what stops them being ignored. */
    const broken = [...scans.entries()]
      .filter(([, s]) => s.parseErrors > 0)
      .map(([f, s]) => `${f} (${s.parseErrors})`);
    expect(broken).toEqual([]);
  });

  /**
   * **The matchers, proved against the broken state.**
   *
   * A scan nobody has watched fail is not evidence — docs/reusable/silent-success.md,
   * and the reason this block exists rather than a comment saying the matchers
   * look right. Each case is a way somebody has actually reached a provider in
   * this repo.
   */
  describe("the matchers catch what they claim to", () => {
    const cases: [string, string][] = [
      ["a constructed client", 'import Anthropic from "@anthropic-ai/sdk";\nconst c = new Anthropic();'],
      ["a hostname", 'await fetch("https://openrouter.ai/api/v1/key");'],
      ["a path on a variable host", "await fetch(`${BASE}/v1/chat/completions`);"],
      ["the audio endpoint", 'await fetch("https://openrouter.ai/api/v1/audio/transcriptions");'],
      ["an env credential", "const k = process.env.OPENROUTER_API_KEY;"],
      ["a hand-parsed .env.local", 'const k = /OPENROUTER_API_KEY\\s*=\\s*(.+)/.exec(env);'],
      [
        /* **The case that killed the hand-written stripper.** A nested template
           desynchronised its quote tracking, so everything after it read as a
           string and the constructor below vanished — a false *negative*, which
           is the direction that matters. GPT Sol. */
        "a constructor after a nested template literal",
        [
          'import Anthropic from "@anthropic-ai/sdk";',
          "const s = `outer ${`inner`} tail`;",
          "const c = new Anthropic();",
        ].join("\n"),
      ],
      [
        /* **The SDK exports its client by name as well as by default**, so this
           works — and the AST version missed it where the text matcher it
           replaced did not. GPT Sol. */
        "a named import of the client class",
        'import { Anthropic } from "@anthropic-ai/sdk";\nconst c = new Anthropic();',
      ],
      [
        "a CommonJS destructured require",
        'const { Anthropic } = require("@anthropic-ai/sdk");\nconst c = new Anthropic();',
      ],
      [
        "a raw fetch at a provider",
        'await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });',
      ],

      [
        "a namespace import of the SDK",
        'import * as SDK from "@anthropic-ai/sdk";\nconst c = new SDK.Anthropic();',
      ],
      [
        "a renamed default import",
        'import Claude from "@anthropic-ai/sdk";\nconst c = new Claude();',
      ],
      ["a destructured credential", "const { OPENROUTER_API_KEY } = process.env;"],
    ];
    /* **Three spellings of the same guarded transport, resolved to one name.**
       The matcher knew only the bare identifier until 2026-08-31; GPT Sol showed
       that a rename or a namespace import walks straight past it, which matters
       because `anthropicDirectForDeclared` is now pinned to a single caller and
       the evasion is something anybody might type without meaning anything by
       it. The finding has to read the *canonical* name, not the local one, or
       the pin is comparing spellings. */
    const spellings: [string, string][] = [
      ["imported plainly", 'import { anthropicDirectForDeclared } from "../declared-spend.js";\nconst c = anthropicDirectForDeclared();'],
      ["renamed on import", 'import { anthropicDirectForDeclared as direct } from "../declared-spend.js";\nconst c = direct();'],
      ["through a namespace import", 'import * as spend from "../declared-spend.js";\nconst c = spend.anthropicDirectForDeclared();'],
    ];
    for (const [name, source] of spellings) {
      it(`resolves a guarded transport ${name}`, () => {
        expect(capabilitiesOf("scratch.ts", source).findings.map((f) => f.what)).toContain(
          "uses anthropicDirectForDeclared",
        );
      });
    }
    for (const [name, source] of cases) {
      it(name, () => {
        expect(capabilitiesOf("scratch.ts", source).findings.length).toBeGreaterThan(0);
      });
    }

    it("catches a fetch whose URL arrives in a variable", () => {
      /* **The last hole GPT Sol found**, and the one that mattered because it
         lands inside a *metered declared* file, where naming an endpoint is
         already exempt. Following the variable needs dataflow; pairing "this
         file names a provider" with "this file calls `fetch`" does not. */
      const found = capabilitiesOf(
        "scratch.ts",
        [
          'const u = "https://openrouter.ai/api/v1/chat/completions";',
          "await globalThis.fetch(u, { method: 'POST' });",
        ].join("\n"),
      ).findings;
      expect(found.map((f) => f.what)).toContain("raw fetch at a provider");
    });

    it("does not call an ordinary fetch a provider fetch", () => {
      /* The pairing has to stay narrow: a file that fetches something unrelated
         and never names a provider is not a finding, or the rule becomes noise
         and the allow-list grows entries that mean nothing. */
      expect(
        capabilitiesOf("scratch.ts", 'await fetch("https://example.com/feed.xml");').findings,
      ).toEqual([]);
    });

    it("calls a qualified fetch a raw fetch, not merely a mention", () => {
      /* **The mutation that found this test missing.** `globalThis.fetch(url)`
         still contains the hostname, so a matcher that only asked "did anything
         fire" was satisfied by the endpoint match — and the endpoint match is
         exactly the one a test is allowed to have. GPT Sol found the hole; the
         mutation found that asserting `length > 0` could not see it. */
      const found = capabilitiesOf(
        "scratch.ts",
        'await globalThis.fetch("https://openrouter.ai/api/v1/chat/completions");',
      ).findings;
      expect(found.map((f) => f.what)).toContain("raw fetch at a provider");
    });

    it("does not fire on a named import of something that is not a client", () => {
      /* `src/anthropic-call.ts` imports the SDK's error classes and can no more
         make a call than a type can. It must stay clean, or the allow-list
         grows an entry that means nothing. */
      const source = [
        'import { APIError, AnthropicError } from "@anthropic-ai/sdk";',
        "export const is = (e: unknown) => e instanceof APIError || e instanceof AnthropicError;",
      ].join("\n");
      expect(capabilitiesOf("scratch.ts", source).findings).toEqual([]);
    });

    it("does not fire on a comment, or on a type-only import", () => {
      const source = [
        "/* We used to post to https://openrouter.ai/api/v1/chat/completions with",
        "   process.env.OPENROUTER_API_KEY, and no longer do. */",
        '// api.anthropic.com is not reachable from here.',
        'import type Anthropic from "@anthropic-ai/sdk";',
        "export type T = Anthropic.Message;",
      ].join("\n");
      expect(capabilitiesOf("scratch.ts", source).findings).toEqual([]);
    });
  });
});
