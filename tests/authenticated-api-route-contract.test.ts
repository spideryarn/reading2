/**
 * The authenticated API's dispatch, written down once and checked against the
 * source.
 *
 * `serveAuthenticatedApi` (src/routes.ts) is 1,600 lines of
 * `if (matcher && req.method === "VERB")`. Nothing anywhere said what that
 * chain accepts, so a guard could be deleted, added, re-matched or re-verbed
 * and no test would notice — the per-route suites each know their own route and
 * none of them knows the set.
 * docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md asks for
 * that inventory **before** the function is cut into per-domain helpers, so the
 * cutting has something to be checked against. It is worth having whether or
 * not the cutting ever happens.
 *
 * ## Why the contract below is hand-written
 *
 * The plan's first draft derived the expected list from the matchers and then
 * compared it with the matchers. GPT Sol rejected it (review § P1-R1): a list
 * *derived from* the subject cannot be the independent oracle for whether the
 * subject changed. So `EXPECTED_AUTH_ROUTES` is a literal — typed out, read
 * back against src/routes.ts by hand, and the thing the parse is compared with.
 * The comparison is **exact set equality in both directions**: a pair in the
 * source and not here fails, and a row here with no guard fails.
 *
 * **The counts are controls, not the oracle.** 67 matchers and 81 guards are
 * asserted because a wrong number is a loud, readable failure — but a count
 * cannot see one guard deleted while another is added, which is the shape a bad
 * refactor actually has. Never weaken the set equality on the grounds that the
 * counts still pass.
 *
 * **Binding names are deliberately not pinned.** Renaming `timeline` to
 * `timelineRoute` is behaviour-neutral, and a test that went red for it would
 * tax tidying rather than defend anything. Names appear below only inside the
 * parser, to join a guard to the matcher it reads.
 *
 * ## Why a parser, and why it refuses rather than skips
 *
 * tests/helpers/ts-ast.ts holds the general argument: character scans of this
 * repo matched inside comments and desynchronised on brackets in string
 * literals, and the second of those made a gate *quiet*. The same failure is
 * available here in a sharper form, so the statement shapes below are a
 * **whitelist** and anything else in the dispatcher's top-level body throws. A
 * guard rewritten into a form this does not understand must stop the suite, not
 * drop out of the universe it checks. tests/cacheable-covers-artefact-routes.test.ts
 * is the local example of getting that wrong — it `filter`s away a binding it
 * failed to find.
 *
 * ## Why the HTTP half asks only about methods that are refused
 *
 * Sol's other correction, and it matters more than it looks. Firing a witness
 * at every *accepted* pair would run the real handlers: several accepted POSTs
 * write to the store, spend money at a provider, open SSE streams and create
 * Stripe objects. The negative matrix — for each witness, every method that no
 * matcher matching that witness accepts — reaches no handler at all, so it needs
 * no database and leaves nothing to clean up. Positive dispatch behaviour stays
 * with the per-route suites that already own it; `GET /api/models` is the one
 * cheap positive control here, and it is here to prove the harness can reach a
 * handler rather than to test the handler.
 *
 * **The contract picks the questions; the source decides whether to send one.**
 * A pair the contract calls refused but the source accepts fails on that fact
 * and the request is never made — so a drifted contract cannot be the thing
 * that fires a live POST at Stripe. See `REFUSALS`.
 *
 * ## Why the order of the 81 guards is not asserted
 *
 * The chain is written in one order and compared here as a **set**, which does
 * not record the order at all. The literal below is typed out in declaration
 * order for whoever reads it next to the source, and that is the whole of what
 * that ordering does: nothing here asserts it, and a later reordering of either
 * would go unnoticed. Sol raised the omission (review § P1-ORDER-CONTRACT), and
 * asserting the order would still be the wrong answer:
 * no two guards accept the same method-and-path pair, so every reordering is an
 * equivalent mutation and a test that reddened for one would be pinning an
 * implementation detail. What is asserted instead is **the property that makes
 * the order irrelevant** — see § `no two guards accept the same method and
 * path`, which is honest about being a corpus check rather than a proof.
 *
 * ## Mutations watched, 2026-09-07
 *
 * Green unmutated: 296 passed at first landing, 304 with the disjointness and
 * decode-order cases below. Each mutation was then applied to
 * `src/routes.ts`, run, and edited back; `src/routes.ts` is byte-identical to
 * the commit this file landed on.
 *
 * 1. **A guard deleted** — the whole `billingUsage && "GET"` arm removed.
 *    **2 failed.** *contract rows with no guard in src/routes.ts:
 *    `["GET literal /api/billing/usage"]`*, and the canary at 80 rather than 81.
 * 2. **A guard added** — a `PUT` arm on `billingUsage`. **3 failed.** *guards in
 *    src/routes.ts that no contract row allows: `["PUT literal
 *    /api/billing/usage"]`*, the canary at 82, and the negative matrix refusing
 *    to send `PUT /api/billing/usage` because the source now answers it.
 * 3. **A matcher changed** — `quotes`' `([\w.%-]+)` made `([\w-]+)`. **2
 *    failed**, in both directions of the matcher set. **The counts stayed
 *    green**, which is the whole reason they are not the oracle.
 * 4. **A method changed** — the `ideas` guard's `"GET"` made `"PUT"`. **2
 *    failed**: the pair set, and the negative matrix refusing to send
 *    `PUT /api/ideas/w1`.
 * 5. **Syntax the parser does not know** — one guard's condition rewritten as
 *    `if (billingUsage !== false && req.method === "GET")`. It **refused**, at
 *    module scope, before a single case ran: *serveAuthenticatedApi: an `if`
 *    whose left conjunct is not a binding at line 8157*. `Tests: no tests`,
 *    `Test Files: 1 failed` — a whole red file, not a quietly shorter list.
 * 6. **The decode order swapped** — `PUT /api/article/:slug/visibility` made to
 *    decode its slug into a `const` before reading its body, which is exactly
 *    the shape stage 3's move of handler bodies into closures could produce by
 *    accident. **2 failed**: *parses the body first … expected 500 to be 400*,
 *    and the pairwise case, *expected 500 not to be 500*. Reverted by editing
 *    the text back; `src/routes.ts` is byte-identical
 *    (`ce53795…`, `git diff HEAD` empty).
 *
 * The two assertions added in stage 1c are mutated in the **contract** rather
 * than the source, because each is about what this file asks rather than about
 * what the dispatcher does. Green unmutated at 305 — the two cases added, the
 * job-family case deleted for earning nothing (§ below).
 *
 * 7. **A contract row under the public namespace** — a row for `literal
 *    /api/public/mutation`, the mistake § `asks only about paths the
 *    authenticated dispatcher is the first to see` exists to catch. **7
 *    failed**: both directions of the matcher/pair comparison, the new case
 *    (*expected `["/api/public/mutation"]` to deeply equal `[]`*) — and, the
 *    point of it, four refusal cases that **sent their requests** and were
 *    answered by the public dispatcher, *expected 'No public API route for POST
 *    …'*, while `sourceAcceptsIt` had said `false` all four times.
 * 8. **A sixth verb, agreed on both sides** — a `HEAD` arm on `billingUsage`,
 *    `HEAD` added to that contract row, and the guard canary moved to 82: a
 *    coordinated change, of the kind pair equality is blind to by design.
 *    **1 failed**, § `uses no verb outside the five this file asks about`
 *    (*expected `["HEAD"]` to deeply equal `[]`*), and nothing else — 304
 *    passed, including every collision and refusal case, none of which had asked
 *    a HEAD question. Then the source half reverted and the contract half left
 *    in place: **2 failed**, the pair comparison and the contract branch of the
 *    same case. `src/routes.ts` is byte-identical again (md5 `182e2de…`,
 *    `git diff HEAD` empty).
 *
 * The disjointness check has a **control rather than a mutation**: a real
 * overlap cannot be introduced into `src/routes.ts` without also failing the
 * pair-set comparison, so `would notice if two guards did overlap` feeds two
 * synthetic same-method guards to the same function instead. Reordering the
 * real guards is deliberately *not* a control — it is an equivalent mutation,
 * which is the whole point of the section above.
 *
 * Not the library-guard swap, and not
 * "reorder two overlapping guards": no two guards accept the same
 * method-and-path pair, so any such swap is an *equivalent* mutation and would
 * have looked like proof while proving nothing. `GET /api/library/search` and
 * `PATCH /api/library/search` pick different guards because the **methods**
 * differ, not because of the order.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isAdmin } from "../src/admin.js";
import type { Verifier, VerifyResult } from "../src/auth.js";
import { WEBHOOK_PATH } from "../src/billing/webhook.js";
import { loadEnvLocal } from "../src/env.js";
import { isPublicNamespace } from "../src/public/routes.js";
import { handleApi } from "../src/routes.js";
import { acceptAny, AUTHED_HEADERS, TEST_SUB } from "./helpers/authed.js";
import { type AstNode, lineOf, parseSource } from "./helpers/ts-ast.js";

loadEnvLocal();

const ROUTES_PATH = fileURLToPath(new URL("../src/routes.ts", import.meta.url));

/* ------------------------------------------------------- the written contract */

/** How a matcher decides, normalised so source and contract can be compared. */
type MatchSpec =
  | { kind: "literal"; path: string }
  | { kind: "regex"; source: string; flags: string };

interface ExpectedRoute {
  match: MatchSpec;
  /** Every method this matcher's guards accept. */
  methods: string[];
  /**
   * Concrete paths this matcher matches, for the negative matrix. `w1`/`w2`
   * stand in for a slug and an id; a second witness appears where the shape is
   * worth exercising — a slug with a dot in it, or a path two matchers both
   * take.
   */
  witnesses: string[];
}

/** A 64-hex digest, the shape the two image routes' second capture insists on. */
const DIGEST = "a".repeat(64);

/**
 * Every matcher in `serveAuthenticatedApi`, in declaration order, with the
 * methods its guards accept.
 *
 * Typed out from src/routes.ts and read back against it. **This is the
 * oracle** — when a real route change makes it red, the fix is to edit this
 * list deliberately, which is the point: adding an endpoint should cost one
 * considered line here.
 */
const EXPECTED_AUTH_ROUTES: ExpectedRoute[] = [
  // ---------------------------------------------------------------- admin
  {
    match: { kind: "literal", path: "/api/admin/users" },
    methods: ["GET"],
    witnesses: ["/api/admin/users"],
  },
  {
    match: { kind: "literal", path: "/api/admin/feedback" },
    methods: ["GET"],
    witnesses: ["/api/admin/feedback"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/admin\\/feedback\\/([\\w-]+)\\/([\\w-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/admin/feedback/w1/w2"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/admin\\/feedback\\/([\\w-]+)\\/([\\w-]+)\\/screenshot$",
      flags: "",
    },
    methods: ["GET"],
    witnesses: ["/api/admin/feedback/w1/w2/screenshot"],
  },
  // -------------------------------------------------------- library / shelf
  {
    match: { kind: "literal", path: "/api/library" },
    methods: ["GET"],
    witnesses: ["/api/library"],
  },
  {
    /* Declared before `shelfEntry` and it has to be — but what actually
       separates the two is the method, not the order. Both witnesses below are
       the same path; the union of their accepted methods is what the negative
       matrix subtracts. */
    match: { kind: "literal", path: "/api/library/search" },
    methods: ["GET"],
    witnesses: ["/api/library/search"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/library\\/([\\w.%-]+)$", flags: "" },
    methods: ["PATCH"],
    witnesses: ["/api/library/w1", "/api/library/w.1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/library\\/([\\w.%-]+)\\/open$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/library/w1/open"],
  },
  // ----------------------------------------------------- reader and the misc
  {
    match: { kind: "literal", path: "/api/reader" },
    methods: ["GET", "PATCH"],
    witnesses: ["/api/reader"],
  },
  {
    match: { kind: "literal", path: "/api/models" },
    methods: ["GET"],
    witnesses: ["/api/models"],
  },
  {
    match: { kind: "literal", path: "/api/transcribe" },
    methods: ["POST"],
    witnesses: ["/api/transcribe"],
  },
  {
    match: { kind: "literal", path: "/api/feedback" },
    methods: ["POST"],
    witnesses: ["/api/feedback"],
  },
  {
    match: { kind: "literal", path: "/api/link-preview" },
    methods: ["GET"],
    witnesses: ["/api/link-preview"],
  },
  {
    match: { kind: "literal", path: "/api/link-summary" },
    methods: ["GET"],
    witnesses: ["/api/link-summary"],
  },
  // --------------------------------------------------------------- article
  {
    match: { kind: "regex", source: "^\\/api\\/article\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/article/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/article\\/([\\w.%-]+)\\/visibility$", flags: "" },
    methods: ["PUT"],
    witnesses: ["/api/article/w1/visibility"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/metadata\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/metadata/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/tweets\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/tweets/w1"],
  },
  // -------------------------------------------------------------- glossary
  {
    match: { kind: "regex", source: "^\\/api\\/glossary\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "DELETE"],
    witnesses: ["/api/glossary/w1"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/glossary\\/([\\w.%-]+)\\/([\\w.%-]+)\\/lookup$",
      flags: "",
    },
    methods: ["POST"],
    witnesses: ["/api/glossary/w1/w2/lookup"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/glossary\\/([\\w.%-]+)\\/ask$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/glossary/w1/ask"],
  },
  // ------------------------------------------------ the reading-view modes
  {
    match: { kind: "regex", source: "^\\/api\\/ideas\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/ideas/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/quotes\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/quotes/w1", "/api/quotes/w.1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/timeline\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/timeline/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/quiz\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/quiz/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/quiz\\/([\\w.%-]+)\\/mark$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/quiz/w1/mark"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/debate\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/debate/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/sketch\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/sketch/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/illustrated\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/illustrated/w1"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/illustrated\\/([\\w.%-]+)\\/([0-9a-f]{64})\\.(jpeg|png)$",
      flags: "",
    },
    methods: ["GET"],
    witnesses: [`/api/illustrated/w1/${DIGEST}.png`, `/api/illustrated/w1/${DIGEST}.jpeg`],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/arc\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/arc/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/similar\\/([\\w.%-]+)$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/similar/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/projection\\/([\\w.%-]+)$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/projection/w1"],
  },
  // ------------------------------------------------- the article's own files
  {
    match: { kind: "regex", source: "^\\/api\\/source\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/source/w1"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/asset\\/([\\w.%-]+)\\/([0-9a-f]{64})\\.(png|jpeg|gif)$",
      flags: "",
    },
    methods: ["GET"],
    witnesses: [`/api/asset/w1/${DIGEST}.png`, `/api/asset/w1/${DIGEST}.gif`],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/export\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/export/w1"],
  },
  // -------------------------------------------------------------- comments
  {
    match: { kind: "regex", source: "^\\/api\\/comments\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "POST"],
    witnesses: ["/api/comments/w1"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/comments\\/([\\w.%-]+)\\/([\\w.%-]+)$",
      flags: "",
    },
    methods: ["PATCH", "DELETE"],
    witnesses: ["/api/comments/w1/w2"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/comments\\/([\\w.%-]+)\\/([\\w.%-]+)\\/answer$",
      flags: "",
    },
    methods: ["POST"],
    witnesses: ["/api/comments/w1/w2/answer"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/comments\\/([\\w.%-]+)\\/([\\w.%-]+)\\/mark$",
      flags: "",
    },
    methods: ["PATCH"],
    witnesses: ["/api/comments/w1/w2/mark"],
  },
  // ------------------------------------------------------- chat, and live
  {
    match: { kind: "regex", source: "^\\/api\\/chat\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "POST"],
    witnesses: ["/api/chat/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/chat\\/([\\w.%-]+)\\/([\\w.%-]+)$", flags: "" },
    methods: ["PATCH", "DELETE"],
    witnesses: ["/api/chat/w1/w2"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/chat\\/([\\w.%-]+)\\/([\\w.%-]+)\\/stop$",
      flags: "",
    },
    methods: ["POST"],
    witnesses: ["/api/chat/w1/w2/stop"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/chat\\/([\\w.%-]+)\\/([\\w.%-]+)\\/cancel$",
      flags: "",
    },
    methods: ["POST"],
    witnesses: ["/api/chat/w1/w2/cancel"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/chat\\/([\\w.%-]+)\\/([\\w.%-]+)\\/live$",
      flags: "",
    },
    methods: ["POST"],
    witnesses: ["/api/chat/w1/w2/live"],
  },
  {
    /* The second documented overlap: `/api/chat/<slug>/live-tool` is also two
       segments, so the thread matcher above takes it for `PATCH` and `DELETE`.
       Both selections are right and neither depends on the order. */
    match: { kind: "regex", source: "^\\/api\\/chat\\/([\\w.%-]+)\\/live-tool$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/chat/w1/live-tool"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/chat\\/([\\w.%-]+)\\/([\\w.%-]+)\\/spoken$",
      flags: "",
    },
    methods: ["POST"],
    witnesses: ["/api/chat/w1/w2/spoken"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/live\\/([\\w-]+)\\/connected$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/live/w1/connected"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/live\\/([\\w-]+)\\/usage$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/live/w1/usage"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/live\\/([\\w-]+)\\/close$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/live/w1/close"],
  },
  // ---------------------------------------------------------------- search
  {
    match: { kind: "regex", source: "^\\/api\\/search\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "POST"],
    witnesses: ["/api/search/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/search\\/([\\w.%-]+)\\/([\\w.%-]+)$", flags: "" },
    methods: ["PATCH", "DELETE"],
    witnesses: ["/api/search/w1/w2"],
  },
  // --------------------------------------------------------------- referee
  {
    match: { kind: "regex", source: "^\\/api\\/referee\\/criteria\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "POST"],
    witnesses: ["/api/referee/criteria/w1"],
  },
  {
    match: {
      kind: "regex",
      source: "^\\/api\\/referee\\/criteria\\/([\\w.%-]+)\\/([\\w.%-]+)$",
      flags: "",
    },
    methods: ["PATCH", "DELETE"],
    witnesses: ["/api/referee/criteria/w1/w2"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/referee\\/claims\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "POST"],
    witnesses: ["/api/referee/claims/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/referee\\/mirror\\/([\\w.%-]+)$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/referee/mirror/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/referee\\/scan\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET"],
    witnesses: ["/api/referee/scan/w1"],
  },
  // ---------------------------------------------------- jobs and uploads
  {
    match: { kind: "literal", path: "/api/jobs" },
    methods: ["GET", "POST"],
    witnesses: ["/api/jobs"],
  },
  {
    match: { kind: "literal", path: "/api/uploads" },
    methods: ["POST"],
    witnesses: ["/api/uploads"],
  },
  {
    /* `[\w-]+` rather than the usual `[\w.%-]+`: an upload id is minted here. */
    match: { kind: "regex", source: "^\\/api\\/uploads\\/([\\w-]+)$", flags: "" },
    methods: ["DELETE", "GET"],
    witnesses: ["/api/uploads/w1"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/jobs\\/([\\w.%-]+)$", flags: "" },
    methods: ["GET", "DELETE"],
    witnesses: ["/api/jobs/w1"],
  },
  {
    /* The one matcher whose second capture is an enumeration rather than a
       shape, so both alternatives are witnessed. */
    match: { kind: "regex", source: "^\\/api\\/jobs\\/([\\w.%-]+)\\/(cancel|retry)$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/jobs/w1/cancel", "/api/jobs/w1/retry"],
  },
  {
    match: { kind: "regex", source: "^\\/api\\/jobs\\/([\\w.%-]+)\\/advance$", flags: "" },
    methods: ["POST"],
    witnesses: ["/api/jobs/w1/advance"],
  },
  // --------------------------------------------------------------- billing
  {
    match: { kind: "literal", path: "/api/billing/checkout" },
    methods: ["POST"],
    witnesses: ["/api/billing/checkout"],
  },
  {
    match: { kind: "literal", path: "/api/billing/portal" },
    methods: ["POST"],
    witnesses: ["/api/billing/portal"],
  },
  {
    match: { kind: "literal", path: "/api/billing/confirm" },
    methods: ["POST"],
    witnesses: ["/api/billing/confirm"],
  },
  {
    match: { kind: "literal", path: "/api/billing/usage" },
    methods: ["GET"],
    witnesses: ["/api/billing/usage"],
  },
];

/** Loud failure controls. Never the oracle — see the header. */
const EXPECTED_MATCHER_COUNT = 67;
const EXPECTED_GUARD_COUNT = 81;

/* ------------------------------------------------------------- the source read */

interface ParsedMatcher {
  /** Only for joining a guard to its matcher; never asserted on. */
  name: string;
  line: number;
  match: MatchSpec;
}

interface ParsedGuard {
  matcher: string;
  method: string;
  line: number;
  /** Whether the arm's block ends in a `return` or a `throw`. */
  terminates: boolean;
}

interface ParsedDispatch {
  matchers: ParsedMatcher[];
  guards: ParsedGuard[];
  /** The line of `if (<namespace> && !isAdmin(...))`, or 0 if it is not there. */
  adminGateLine: number;
  /** The line of the terminal `send(res, 404, …)`, or 0. */
  terminal404Line: number;
}

/** Everything this refuses to understand comes out as one of these. */
class UnsupportedDispatchSyntax extends Error {}

const isNode = (v: unknown): v is AstNode =>
  typeof v === "object" && v !== null && typeof (v as AstNode).type === "string";

const nodeType = (n: AstNode): string => n.type as string;

/** An identifier's name, or undefined for anything else. */
function identName(n: unknown): string | undefined {
  if (!isNode(n) || nodeType(n) !== "Identifier") return undefined;
  return n.name as string;
}

/** A string literal's value, or undefined. */
function stringValue(n: unknown): string | undefined {
  if (!isNode(n) || nodeType(n) !== "StringLiteral") return undefined;
  return n.value as string;
}

/** `<object>.<property>` as a dotted name, for the two shapes accepted below. */
function memberName(n: unknown): string | undefined {
  if (!isNode(n) || nodeType(n) !== "MemberExpression" || n.computed === true) return undefined;
  const object = identName(n.object);
  const property = identName(n.property);
  if (object === undefined || property === undefined) return undefined;
  return `${object}.${property}`;
}

/** `path === "…"` — the 16 exact matchers. */
function literalMatch(init: AstNode): MatchSpec | undefined {
  if (nodeType(init) !== "BinaryExpression" || init.operator !== "===") return undefined;
  if (identName(init.left) !== "path") return undefined;
  const value = stringValue(init.right);
  return value === undefined ? undefined : { kind: "literal", path: value };
}

/** `/…/.exec(path)` — the 51 regex matchers. */
function regexMatch(init: AstNode): MatchSpec | undefined {
  if (nodeType(init) !== "CallExpression") return undefined;
  const callee = init.callee;
  if (!isNode(callee) || nodeType(callee) !== "MemberExpression" || callee.computed === true) {
    return undefined;
  }
  if (identName(callee.property) !== "exec") return undefined;
  const pattern = callee.object;
  if (!isNode(pattern) || nodeType(pattern) !== "RegExpLiteral") return undefined;
  /* **`path`, never `rawUrl` or `req.url`** — the argument is part of what is
     checked, not incidental. Thirty-two matchers once ran against a string
     carrying the query string and simply stopped matching:
     docs/postmortems/260901a-the-route-the-query-string-hid.md. A matcher fed
     anything else is refused by the caller rather than quietly recorded. */
  const args = init.arguments as unknown[];
  if (args.length !== 1 || identName(args[0]) !== "path") return undefined;
  return {
    kind: "regex",
    source: pattern.pattern as string,
    flags: (pattern.flags as string) ?? "",
  };
}

/**
 * `path === "/api/admin" || path.startsWith("/api/admin/")` — the namespace
 * binding the admin gate reads. Not a route matcher, and recognised separately
 * so it cannot be mistaken for one.
 */
function isNamespacePredicate(init: AstNode): boolean {
  if (nodeType(init) !== "LogicalExpression" || init.operator !== "||") return false;
  const left = init.left;
  const right = init.right;
  if (!isNode(left) || !isNode(right)) return false;
  if (literalMatch(left) === undefined) return false;
  if (nodeType(right) !== "CallExpression") return false;
  return memberName(right.callee) === "path.startsWith";
}

/** `req.method === "VERB"`, giving the verb. */
function methodTest(n: unknown): string | undefined {
  if (!isNode(n) || nodeType(n) !== "BinaryExpression" || n.operator !== "===") return undefined;
  if (memberName(n.left) !== "req.method") return undefined;
  return stringValue(n.right);
}

/** `!isAdmin(...)`. */
function isAdminRefusal(n: unknown): boolean {
  if (!isNode(n) || nodeType(n) !== "UnaryExpression" || n.operator !== "!") return false;
  const arg = n.argument;
  return isNode(arg) && nodeType(arg) === "CallExpression" && identName(arg.callee) === "isAdmin";
}

/**
 * Whether an arm ends the request.
 *
 * A trailing bare block is descended into, because `similar` and `projection`
 * end in `{ … return withSpendAttribution(…); }` rather than in a `return;` of
 * their own — the plan's § [RETURN]. A transcription that looked only for a
 * trailing `return;` would call both of them non-terminating, and then either
 * report a false problem or, worse, be relaxed until it reported nothing.
 */
function armTerminates(consequent: unknown): boolean {
  let block = consequent;
  for (;;) {
    if (!isNode(block) || nodeType(block) !== "BlockStatement") return false;
    const body = block.body as unknown[];
    const last = body[body.length - 1];
    if (!isNode(last)) return false;
    const type = nodeType(last);
    if (type === "ReturnStatement" || type === "ThrowStatement") return true;
    if (type === "BlockStatement") {
      block = last;
      continue;
    }
    return false;
  }
}

/** The calls the dispatcher is allowed to make at statement level. */
const ALLOWED_TOP_LEVEL_CALLS = new Set([
  "assertVerifiedUser",
  "setRequestOwner",
  "setMonitoringUser",
  "send",
]);

/** What the walk builds up, so each statement shape can be read on its own. */
interface Accumulator {
  matchers: ParsedMatcher[];
  byName: Map<string, MatchSpec>;
  guards: ParsedGuard[];
  /** Bindings holding `path === "/api/admin" || path.startsWith(…)`. */
  namespaces: Set<string>;
  adminGateLine: number;
  terminal404Line: number;
}

/** Every refusal goes through here, so every one of them names a line. */
function refuse(n: AstNode, why: string): never {
  throw new UnsupportedDispatchSyntax(
    `serveAuthenticatedApi: ${why} at line ${lineOf(n)} (${nodeType(n)})`,
  );
}

/** `const <name> = <matcher>;`, or the one destructure, or a refusal. */
function readDeclaration(statement: AstNode, acc: Accumulator): void {
  const declarations = statement.declarations as unknown[];
  if (declarations.length !== 1) refuse(statement, "a multi-declarator const");
  const declarator = declarations[0];
  if (!isNode(declarator)) refuse(statement, "an unreadable declarator");
  const init = declarator.init;
  if (!isNode(init)) refuse(statement, "a const with no initialiser");

  /* `const { req, res, rawUrl, path, query } = request;` — the only
     destructure, and the source of every name the matchers read. */
  const id = declarator.id;
  if (isNode(id) && nodeType(id) === "ObjectPattern") {
    if (identName(init) !== "request") refuse(statement, "an unexpected destructure");
    return;
  }
  const name = identName(id);
  if (name === undefined) refuse(statement, "a binding that is not a plain name");

  if (isNamespacePredicate(init)) {
    acc.namespaces.add(name);
    return;
  }
  const match = literalMatch(init) ?? regexMatch(init);
  if (match === undefined) refuse(statement, "a matcher this does not understand");
  acc.matchers.push({ name, line: lineOf(statement), match });
  acc.byName.set(name, match);
}

/** A dispatch guard, or the admin gate, or a refusal. */
function readIf(statement: AstNode, acc: Accumulator): void {
  const test = statement.test;
  if (!isNode(test) || nodeType(test) !== "LogicalExpression" || test.operator !== "&&") {
    refuse(statement, "an `if` whose condition is not `<matcher> && <method>`");
  }
  const binding = identName(test.left);
  if (binding === undefined) refuse(statement, "an `if` whose left conjunct is not a binding");
  if (statement.alternate !== null && statement.alternate !== undefined) {
    refuse(statement, "a dispatch `if` with an `else`");
  }

  if (acc.namespaces.has(binding)) {
    if (!isAdminRefusal(test.right)) {
      refuse(statement, "an admin-namespace `if` that is not the gate");
    }
    if (acc.adminGateLine !== 0) refuse(statement, "a second admin gate");
    acc.adminGateLine = lineOf(statement);
    return;
  }

  if (!acc.byName.has(binding)) refuse(statement, `a guard on the unknown binding \`${binding}\``);
  const method = methodTest(test.right);
  if (method === undefined) {
    refuse(statement, 'a guard whose right conjunct is not `req.method === "VERB"`');
  }
  acc.guards.push({
    matcher: binding,
    method,
    line: lineOf(statement),
    terminates: armTerminates(statement.consequent),
  });
}

/** One of the four calls the dispatcher may make at statement level. */
function readCall(statement: AstNode, acc: Accumulator): void {
  const expression = statement.expression;
  if (!isNode(expression) || nodeType(expression) !== "CallExpression") {
    refuse(statement, "a statement that is not a call");
  }
  const callee = identName(expression.callee);
  if (callee === undefined || !ALLOWED_TOP_LEVEL_CALLS.has(callee)) {
    refuse(statement, "a top-level call this does not expect");
  }
  if (callee === "send") acc.terminal404Line = lineOf(statement);
}

/** `serveAuthenticatedApi`'s own declaration, or a refusal. */
function findDispatcher(source: string): AstNode {
  const ast = parseSource(source);
  /* `parseSource` recovers rather than throwing, which is right for the fixture
     fragments its other callers hand it and wrong here: a `src/routes.ts` that
     did not parse would yield a partial statement list and a cheerfully short
     inventory. */
  const errors = ast.errors ?? [];
  if (errors.length > 0) {
    const first = errors[0] as { loc?: { line?: number } } | undefined;
    throw new UnsupportedDispatchSyntax(
      `src/routes.ts did not parse cleanly: ${errors.length} error(s), first at line ${first?.loc?.line ?? "?"}`,
    );
  }

  let fn: AstNode | undefined;
  for (const statement of ast.program.body as unknown[]) {
    if (!isNode(statement)) continue;
    const declaration =
      nodeType(statement) === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (!isNode(declaration) || nodeType(declaration) !== "FunctionDeclaration") continue;
    if (identName(declaration.id) === "serveAuthenticatedApi") fn = declaration;
  }
  if (fn === undefined) {
    throw new UnsupportedDispatchSyntax(
      "serveAuthenticatedApi is not a top-level function declaration",
    );
  }
  return fn;
}

/**
 * Walk `serveAuthenticatedApi`'s own statement list and read the dispatch off
 * it. Every statement must be one of the four recognised shapes; anything else
 * throws, so an unreadable dispatcher is a red suite rather than a short list.
 */
function extractAuthDispatch(source: string): ParsedDispatch {
  const body = findDispatcher(source).body;
  if (!isNode(body) || nodeType(body) !== "BlockStatement") {
    throw new UnsupportedDispatchSyntax("serveAuthenticatedApi has no block body");
  }

  const acc: Accumulator = {
    matchers: [],
    byName: new Map(),
    guards: [],
    namespaces: new Set(),
    adminGateLine: 0,
    terminal404Line: 0,
  };

  for (const raw of body.body as unknown[]) {
    if (!isNode(raw)) refuse(body, "a statement that is not a node");
    switch (nodeType(raw)) {
      case "VariableDeclaration":
        readDeclaration(raw, acc);
        break;
      case "IfStatement":
        readIf(raw, acc);
        break;
      case "ExpressionStatement":
        readCall(raw, acc);
        break;
      case "ReturnStatement":
        /* The one bare `return;` under the terminal 404. A `return <value>` at
           this level would mean the dispatcher answers somewhere this walk has
           not looked. */
        if (raw.argument !== null && raw.argument !== undefined) {
          refuse(raw, "a top-level `return` with a value");
        }
        break;
      default:
        refuse(raw, "unsupported statement");
    }
  }

  const { matchers, guards, adminGateLine, terminal404Line } = acc;
  return { matchers, guards, adminGateLine, terminal404Line };
}

/**
 * Read at module scope on purpose: if the parser refuses, the whole file is red
 * before a single case runs, which is the only way a refusal is louder than a
 * skip.
 */
const parsed = extractAuthDispatch(readFileSync(ROUTES_PATH, "utf8"));

/* ------------------------------------------------------------- the comparison */

const describeMatch = (m: MatchSpec): string =>
  m.kind === "literal" ? `literal ${m.path}` : `regex /${m.source}/${m.flags}`;

/** One accepted pair, as a line a failure message can be read off. */
const pairKey = (method: string, match: MatchSpec): string => `${method} ${describeMatch(match)}`;

const sorted = (xs: string[]): string[] => [...xs].sort();

const CONTRACT_MATCHES = EXPECTED_AUTH_ROUTES.map((r) => describeMatch(r.match));
const SOURCE_MATCHES = parsed.matchers.map((m) => describeMatch(m.match));

const CONTRACT_PAIRS = EXPECTED_AUTH_ROUTES.flatMap((r) =>
  r.methods.map((method) => pairKey(method, r.match)),
);
const SOURCE_MATCH_BY_NAME = new Map(parsed.matchers.map((m) => [m.name, m.match]));
const SOURCE_PAIRS = parsed.guards.map((g) => {
  const match = SOURCE_MATCH_BY_NAME.get(g.matcher);
  /* Cannot happen — the extractor refuses a guard on an unknown binding — but
     an `undefined` silently stringified into a pair key is precisely how a set
     comparison stops comparing anything. */
  if (match === undefined) throw new Error(`guard at line ${g.line} names no matcher`);
  return pairKey(g.method, match);
});

const missingFrom = (a: string[], b: string[]): string[] => {
  const have = new Set(b);
  return sorted([...new Set(a.filter((x) => !have.has(x)))]);
};

/* --------------------------------------------------------------- the requests */

const METHOD_UNIVERSE = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface Reply {
  handled: boolean;
  status: number;
  headers: Record<string, string>;
  body: { error?: string; [key: string]: unknown };
}

/**
 * Drive `handleApi` with a fake request/response pair — the shape half a dozen
 * suites already build, tests/routes.test.ts § `call` being the fullest, with
 * the response **headers kept** rather than dropped. That is the only
 * difference and it is why this is here rather than imported: every existing
 * copy has `setHeader() {}`, so *no `Allow` header* is not a thing any of them
 * can observe.
 */
async function call(
  method: string | undefined,
  url: string,
  verify: Verifier = acceptAny,
  body?: string,
): Promise<Reply> {
  /* `readBody` (src/routes.ts) reads the request by iterating it, so a body is
     a generator that yields one chunk. Omitting it yields nothing, which is
     what every case above wants and is byte-for-byte the empty generator this
     used to build. */
  async function* chunks(): AsyncGenerator<Buffer> {
    if (body !== undefined) yield Buffer.from(body, "utf8");
  }
  const req = Object.assign(chunks(), {
    method,
    url,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const headers: Record<string, string> = {};
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  const handled = await handleApi(req, res, verify);
  return { handled, status, headers, body: text ? JSON.parse(text) : {} };
}

/** Somebody signed in who is not the administrator. */
const acceptStranger: Verifier = async (): Promise<VerifyResult> => ({
  ok: true,
  claims: {
    sub: "00000000-0000-4000-8000-0000000c0ffe",
    email: "stranger@example.com",
    role: "authenticated",
    is_anonymous: false,
  },
});

/** Does this witness reach this row? */
function matches(match: MatchSpec, witness: string): boolean {
  return match.kind === "literal"
    ? match.path === witness
    : new RegExp(match.source, match.flags).test(witness);
}

/**
 * Every method the **written contract** accepts for a path — the union across
 * every row that matches it, because two pairs of distinct matchers do both
 * reach one path (library-search/shelf-entry and chat-thread/live-tool), and a
 * method one of the pair refuses the other may take.
 *
 * Not to be confused with the other count: fourteen matchers accept more than
 * one method each, which is a fact about rows rather than about paths and is not
 * why this unions.
 */
function contractAccepts(witness: string): Set<string> {
  const accepted = new Set<string>();
  for (const route of EXPECTED_AUTH_ROUTES) {
    if (!matches(route.match, witness)) continue;
    for (const method of route.methods) accepted.add(method);
  }
  return accepted;
}

/** The same question asked of the source, which is how a request stays safe. */
function sourceAccepts(witness: string): Set<string> {
  const accepted = new Set<string>();
  for (const guard of parsed.guards) {
    const match = SOURCE_MATCH_BY_NAME.get(guard.matcher);
    if (match === undefined || !matches(match, witness)) continue;
    accepted.add(guard.method);
  }
  return accepted;
}

/**
 * Every (witness, method) the contract says is refused — and, separately,
 * whether the source agrees.
 *
 * **The two are kept apart on purpose.** The contract decides *what to ask
 * about*, which is what makes this an independent check rather than the source
 * marking its own homework. The source decides *whether the request is sent*:
 * if a guard really is there, the case fails on that fact alone and no request
 * is made. Several accepted POSTs write data, spend money, contact providers,
 * open SSE streams and create Stripe objects, and a drifted contract must not
 * be the thing that fires one.
 */
const REFUSALS: { witness: string; method: string; sourceAcceptsIt: boolean }[] = [];
for (const route of EXPECTED_AUTH_ROUTES) {
  for (const witness of route.witnesses) {
    const byContract = contractAccepts(witness);
    const bySource = sourceAccepts(witness);
    for (const method of METHOD_UNIVERSE) {
      if (byContract.has(method)) continue;
      REFUSALS.push({ witness, method, sourceAcceptsIt: bySource.has(method) });
    }
  }
}

/* ------------------------------------------------------------ disjointness */

/**
 * A guard reduced to the only two things that decide whether it takes a
 * request, plus somewhere to point when two of them both do.
 */
interface SimpleGuard {
  method: string;
  match: MatchSpec;
  where: string;
}

const SOURCE_GUARDS: SimpleGuard[] = parsed.guards.map((g) => {
  const match = SOURCE_MATCH_BY_NAME.get(g.matcher);
  if (match === undefined) throw new Error(`guard at line ${g.line} names no matcher`);
  return { method: g.method, match, where: `${describeMatch(match)} at line ${g.line}` };
});

/**
 * Paths the disjointness question is asked about, over and above every witness
 * the contract already carries.
 *
 * The two documented intersections, and the one pair near enough to colliding
 * that the corpus is made to ask about it rather than assume it. All five happen
 * to be witnesses already; they are named again here so that deleting a witness
 * cannot quietly stop the question being asked about the cases we know are
 * interesting.
 */
const OVERLAP_PROBES = [
  /* GET is the library search; PATCH is the shelf entry for a slug that happens
     to read `search`. */
  "/api/library/search",
  /* POST is the live tool; PATCH and DELETE are the thread whose id happens to
     read `live-tool`. */
  "/api/chat/w1/live-tool",
  /* `jobAction`'s `(cancel|retry)` against `jobAdvance`'s `advance` — same
     method, same prefix, and disjoint only because the alternation cannot spell
     `advance`. */
  "/api/jobs/w1/cancel",
  "/api/jobs/w1/retry",
  "/api/jobs/w1/advance",
];

const DISJOINTNESS_CORPUS = sorted([
  ...new Set([...EXPECTED_AUTH_ROUTES.flatMap((r) => r.witnesses), ...OVERLAP_PROBES]),
]);

/** Which guards would take this method and path — in dispatch order. */
const acceptorsIn = (guards: SimpleGuard[], method: string, candidate: string): SimpleGuard[] =>
  guards.filter((g) => g.method === method && matches(g.match, candidate));

/** Every (method, path) in the corpus that more than one guard would take. */
function collisionsIn(guards: SimpleGuard[], corpus: string[]): string[] {
  const found: string[] = [];
  for (const candidate of corpus) {
    for (const method of METHOD_UNIVERSE) {
      const hits = acceptorsIn(guards, method, candidate);
      if (hits.length > 1) {
        found.push(`${method} ${candidate} → ${hits.map((h) => h.where).join(" then ")}`);
      }
    }
  }
  return sorted(found);
}

const acceptors = (method: string, candidate: string): SimpleGuard[] =>
  acceptorsIn(SOURCE_GUARDS, method, candidate);

describe("the authenticated API's route contract", () => {
  describe("the source says what the contract says", () => {
    it("declares the matchers the contract names, and no others", () => {
      expect(
        missingFrom(SOURCE_MATCHES, CONTRACT_MATCHES),
        "in src/routes.ts but not in EXPECTED_AUTH_ROUTES — a route was added; add a row",
      ).toEqual([]);
      expect(
        missingFrom(CONTRACT_MATCHES, SOURCE_MATCHES),
        "in EXPECTED_AUTH_ROUTES but not in src/routes.ts — a matcher was deleted or changed",
      ).toEqual([]);
      expect(sorted(SOURCE_MATCHES)).toEqual(sorted(CONTRACT_MATCHES));
    });

    it("accepts exactly the method-and-matcher pairs the contract names", () => {
      expect(
        missingFrom(SOURCE_PAIRS, CONTRACT_PAIRS),
        "guards in src/routes.ts that no contract row allows",
      ).toEqual([]);
      expect(
        missingFrom(CONTRACT_PAIRS, SOURCE_PAIRS),
        "contract rows with no guard in src/routes.ts",
      ).toEqual([]);
      expect(sorted(SOURCE_PAIRS)).toEqual(sorted(CONTRACT_PAIRS));
    });

    it("names each matcher once, so the comparison above is lossless", () => {
      expect(new Set(CONTRACT_MATCHES).size).toBe(CONTRACT_MATCHES.length);
      expect(new Set(SOURCE_MATCHES).size).toBe(SOURCE_MATCHES.length);
      expect(new Set(SOURCE_PAIRS).size).toBe(SOURCE_PAIRS.length);
    });

    /* A canary, and it says so. It cannot see one guard deleted while another
       is added — the two cases above are what can. */
    it("has the number of matchers and guards it had (a canary, not the oracle)", () => {
      expect(parsed.matchers.length).toBe(EXPECTED_MATCHER_COUNT);
      expect(parsed.guards.length).toBe(EXPECTED_GUARD_COUNT);
    });
  });

  describe("the properties the dispatcher's shape rests on", () => {
    it("ends every handled arm", () => {
      /* Not decoration: a guard that falls out of its arm reaches the terminal
         404 below **after** its handler has already answered, which is a second
         `end()` on a finished response. `similar` and `projection` reach their
         `return` from inside a nested block, which is why `armTerminates`
         descends rather than looking at the last line. */
      expect(parsed.guards.filter((g) => !g.terminates).map((g) => `line ${g.line}`)).toEqual([]);
    });

    it("uses no `g` or `y` flag, so a matcher cannot remember the last request", () => {
      /* `lastIndex` on a shared `/g` regex makes matching depend on the request
         before it. Harmless today because all 51 are freshly constructed per
         request — and the plan's stage 3 wants to hoist them to module scope,
         which is where it would stop being harmless. */
      const flagged = parsed.matchers
        .filter((m) => m.match.kind === "regex" && /[gy]/.test(m.match.flags))
        .map((m) => describeMatch(m.match));
      expect(flagged).toEqual([]);
    });

    it("puts the admin gate above every route guard and the 404 below them all", () => {
      /* docs/project/admin.md § the gate guards the namespace rather than the
         route: it sits above the table so an admin endpoint added later is
         behind it whether or not whoever adds it remembers. */
      expect(parsed.adminGateLine).toBeGreaterThan(0);
      const lines = parsed.guards.map((g) => g.line);
      expect(parsed.adminGateLine).toBeLessThan(Math.min(...lines));
      expect(parsed.terminal404Line).toBeGreaterThan(Math.max(...lines));
    });

    it("uses no verb outside the five this file asks about", () => {
      /* `METHOD_UNIVERSE` is the universe every question here is asked over —
         the negative matrix and the collision check both iterate it — and it is
         five verbs. HEAD and OPTIONS are deliberately not among them: this
         dispatcher has no handling for either, and that stays a matter for the
         refusal policy in § `a method no matcher accepts is the terminal 404`
         rather than a pair to fire at every witness.

         Pair equality already catches a verb that appears on one side only. What
         it cannot catch is a verb added to the source *and* the contract
         together — deliberate, agreed, and then silently skipped by everything
         that walks the universe (Sol, review § P2-METHOD-UNIVERSE). So closing
         the universe here makes adding a sixth verb a deliberate edit to this
         line rather than an omission nobody sees. */
      const universe = new Set<string>(METHOD_UNIVERSE);
      const outside = (methods: string[]): string[] =>
        sorted([...new Set(methods.filter((m) => !universe.has(m)))]);
      expect(
        outside(parsed.guards.map((g) => g.method)),
        "a guard in src/routes.ts uses a verb METHOD_UNIVERSE does not list, so no refusal or collision case asks about it — add it there deliberately",
      ).toEqual([]);
      expect(
        outside(EXPECTED_AUTH_ROUTES.flatMap((r) => r.methods)),
        "a contract row names a verb METHOD_UNIVERSE does not list — add it there deliberately",
      ).toEqual([]);
    });

    it("gives every contract row at least one method and one honest witness", () => {
      /* A witness that does not match its own row would test some other row, or
         nothing, and would look exactly the same from here. */
      for (const route of EXPECTED_AUTH_ROUTES) {
        expect(route.methods.length, describeMatch(route.match)).toBeGreaterThan(0);
        expect(route.witnesses.length, describeMatch(route.match)).toBeGreaterThan(0);
        for (const witness of route.witnesses) {
          expect(matches(route.match, witness), `${witness} does not match ${describeMatch(route.match)}`).toBe(true);
        }
      }
    });
  });

  /**
   * The property that makes the order of the 81 guards irrelevant — asserted
   * instead of the order itself.
   *
   * The chain is *written* in one order and compared above as a *set*, which
   * does not record the order — the contract literal is laid out in declaration
   * order for a human reader and nothing asserts it. Pinning it would be wrong:
   * no two guards accept the same method-and-path pair, so every reordering is
   * an equivalent mutation, and a test that reddened for one would be
   * defending an implementation detail — the same reason the plan refuses the
   * library-guard swap as a control. So this asserts the reason instead. **If
   * this ever fails, order has become load-bearing**: the earlier guard wins,
   * and moving guards into per-domain helpers (stage 3) stops being a
   * rearrangement and starts being a behaviour change.
   *
   * **What it does not cover, and it is a lot.** Regex intersection is
   * undecidable in general and this does not attempt it. The question is asked
   * over a finite corpus: every witness in `EXPECTED_AUTH_ROUTES`, plus
   * `OVERLAP_PROBES`. Two matchers whose languages meet only at some path no
   * witness spells would pass here unnoticed. What stops that from making this
   * empty is that every contract row must carry at least one witness (asserted
   * above), so a *new* matcher arrives with at least one path of its own — a
   * new guard that shadows an existing one at its own witness is caught; one
   * that shadows it only somewhere else is not. This is a corpus check wearing
   * the word "property", and it should be read that way.
   *
   * **So an intentional matcher change needs a fresh intersection review, by
   * hand.** Today's disjointness is not only this corpus's word for it: Sol read
   * the pinned patterns independently on 2026-09-07 and found exactly two
   * intersecting pairs of distinct matchers — library-search/shelf-entry and
   * chat-thread/live-tool, both separated by method — with job action and job
   * advance disjoint (review § P2-DISJOINTNESS-CLAIM). That audit is what makes
   * the current order non-behavioural. It does not carry over to a pattern
   * somebody widens later: this test asks only where we thought to look, so its
   * staying green is not evidence that such a change kept the guards disjoint,
   * and it cannot on its own justify a reordering made afterwards.
   */
  describe("no two guards accept the same method and path", () => {
    it("has nothing to resolve by order", () => {
      expect(
        collisionsIn(SOURCE_GUARDS, DISJOINTNESS_CORPUS),
        "two guards accept the same method and path, so the earlier one wins and the order of the chain is now behaviour — say so in this test and in the plan before reordering anything",
      ).toEqual([]);
    });

    it("would notice if two guards did overlap", () => {
      /* The control. Without it a green result above is equally consistent with
         `collisionsIn` never finding anything — the corpus and the guard list
         are both real, but the comparison between them is not exercised by a
         passing case. Two synthetic same-method entries over the same path. */
      const synthetic: SimpleGuard[] = [
        { method: "GET", match: { kind: "literal", path: "/api/x" }, where: "first" },
        { method: "GET", match: { kind: "regex", source: "^\\/api\\/x$", flags: "" }, where: "second" },
      ];
      expect(collisionsIn(synthetic, ["/api/x"])).toEqual(["GET /api/x → first then second"]);
      /* And it is the *method* that separates them, not the path. */
      expect(collisionsIn([synthetic[0]!, { ...synthetic[1]!, method: "PUT" }], ["/api/x"])).toEqual(
        [],
      );
    });

    it("allows /api/library/search twice, because the methods differ", () => {
      /* Both halves asserted, and asserted to be *different* guards: if the
         shelf-entry matcher stopped reaching this path the pair would be
         trivially disjoint and this corner would stop being tested at all,
         which would look exactly like passing. */
      const get = acceptors("GET", "/api/library/search");
      const patch = acceptors("PATCH", "/api/library/search");
      expect(get).toHaveLength(1);
      expect(patch).toHaveLength(1);
      expect(get[0]?.match).not.toEqual(patch[0]?.match);
    });

    it("allows /api/chat/:slug/live-tool three times, because the methods differ", () => {
      const post = acceptors("POST", "/api/chat/w1/live-tool");
      const patch = acceptors("PATCH", "/api/chat/w1/live-tool");
      const del = acceptors("DELETE", "/api/chat/w1/live-tool");
      expect(post).toHaveLength(1);
      expect(patch).toHaveLength(1);
      expect(del).toHaveLength(1);
      /* The live tool is one matcher; the thread is another, and it is the
         thread that answers both PATCH and DELETE — two guards, one matcher,
         which is why these compare matchers rather than guards. */
      expect(post[0]?.match).not.toEqual(patch[0]?.match);
      expect(patch[0]?.match).toEqual(del[0]?.match);
    });

    /* There is deliberately no job-family case here. `jobAction` and
       `jobAdvance` are the pair most likely to collide — same method, same
       prefix — and their three paths are in `OVERLAP_PROBES`, so `has nothing to
       resolve by order` above already asks the question about them. A case that
       ran the same three paths through `acceptors` would have demonstrated three
       samples, not proved two regex languages disjoint, and would have earned
       nothing the corpus check does not (Sol, review § P2-DISJOINTNESS-CLAIM).
       The two cases above are different: they assert intersections are *kept*,
       which a collision check cannot see, because a narrowing leaves it green. */
  });

  describe("a method no matcher accepts is the terminal 404", () => {
    /* The safe half of the black box. Every pair here reaches no handler at
       all — which is why there is no database in this file, and why the
       *accepted* pairs are left to the suites that own each route. */
    it("has refusals to make", () => {
      expect(REFUSALS.length).toBeGreaterThan(200);
    });

    /**
     * Every path this file asks about has to be one `serveAuthenticatedApi`
     * sees first — otherwise the model that decides whether sending is safe is
     * not a model of the code that would run.
     *
     * `sourceAccepts()` reads the authenticated dispatcher's guards and nothing
     * else, but `call()` enters through `handleApi`, which dispatches the public
     * namespace (src/routes.ts:6347) and the Stripe webhook (:6371) *above* the
     * authenticated chain. A witness under either would be answered up there
     * while `sourceAcceptsIt` said `false` — request sent, outer handler run,
     * and nothing here had modelled it.
     *
     * Safe today only because no witness lies in either namespace, which was a
     * fact nobody had written down (Sol, review § P2-SAFETY-SCOPE). Asserted
     * rather than relied on, so a contract row mistakenly placed under one of
     * those paths fails here instead of executing an outer handler. Asked with
     * the two predicates the dispatcher itself uses, so a namespace that widens
     * later widens this with it.
     */
    it("asks only about paths the authenticated dispatcher is the first to see", () => {
      const outside = DISJOINTNESS_CORPUS.filter(
        (witness) => isPublicNamespace(witness) || witness === WEBHOOK_PATH,
      );
      expect(
        outside,
        "handleApi answers these above serveAuthenticatedApi, so sourceAccepts() does not model what a request would reach",
      ).toEqual([]);
    });

    it.each(REFUSALS.map((r) => [r.method, r.witness, r.sourceAcceptsIt] as const))(
      "%s %s",
      async (method, witness, sourceAcceptsIt) => {
        /* Assert, then leave. Sending this would run a guard the contract does
           not know about, which is the one thing this file may not do. */
        expect(
          sourceAcceptsIt,
          `src/routes.ts has a guard accepting ${method} ${witness} that EXPECTED_AUTH_ROUTES does not — not sending the request`,
        ).toBe(false);
        const reply = await call(method, witness);
        expect(reply.handled).toBe(true);
        expect(reply.status).toBe(404);
        expect(reply.body.error).toBe(`No API route for ${method} ${witness}`);
        /* No `Allow`, and no 405. Within this dispatcher, after its admin gate,
           a method mismatch is indistinguishable from a path nobody has — the
           plan's § [HTTP]. Copying src/public/routes.ts' 405 policy would be a
           behaviour change. */
        expect(reply.headers.allow).toBeUndefined();
      },
    );

    it("says `undefined` rather than inventing a method when there is none", () => {
      /* `req.method` is optional on the type, and the message interpolates it
         raw. Preserved deliberately: a request with no method is a client bug
         and the log should say so rather than smooth it over. */
      return call(undefined, "/api/models").then((reply) => {
        expect(reply.status).toBe(404);
        expect(reply.body.error).toBe("No API route for undefined /api/models");
      });
    });

    it("404s a path nobody has at all", async () => {
      const reply = await call("GET", "/api/no-such-route-at-all");
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe("No API route for GET /api/no-such-route-at-all");
    });
  });

  describe("a query string does not decide the route", () => {
    /* docs/postmortems/260901a-the-route-the-query-string-hid.md: 32 matchers
       ran against a string carrying the query string, so a real route matched
       nothing for four days. Both directions are cheap here. */
    it("finds a route that is there", async () => {
      const reply = await call("GET", "/api/models?fresh=1&x=2");
      expect(reply.status).toBe(200);
    });

    it("still refuses a method that is not, and quotes the raw URL back", async () => {
      const reply = await call("PUT", "/api/models?fresh=1");
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe("No API route for PUT /api/models?fresh=1");
    });
  });

  /**
   * Which happens first — reading the body or decoding the slug — differs per
   * route, and the difference is visible from outside as two different status
   * codes for the same two malformed inputs.
   *
   * The plan's § [DECODE], and GPT Sol reproduced both without Postgres. It is
   * not a policy anybody chose; it is what argument evaluation order does with
   * two lines written in the order they were written. It is recorded rather
   * than tidied because **stage 3 moves these handler bodies into closures**,
   * and that is exactly the edit that could swap them without anybody noticing.
   * Nothing else in the tree watches this.
   *
   * Neither case reaches a store: the throw happens before the handler's first
   * call, which is why they belong in this database-free file.
   *
   * If a later change makes these agree with each other, that is a decision to
   * take deliberately — edit these two cases and say so — not a green suite.
   */
  describe("body-read and slug-decode order is per route, and observable", () => {
    /* One malformed body, one undecodable slug, sent to both routes. `%` alone
       is not a valid escape, so `decodeURIComponent` throws `URI malformed`;
       the body is not JSON. Whichever the route does first is the error the
       client gets. */
    const MALFORMED_BODY = "{not json";

    it("parses the body first on PUT /api/article/:slug/visibility, so it is a 400", async () => {
      const reply = await call("PUT", "/api/article/%/visibility", acceptAny, MALFORMED_BODY);
      expect(reply.status).toBe(400);
      expect(reply.body.error).toBe("Request body is not valid JSON");
    });

    it("decodes the slug first on PATCH /api/library/:slug, so it is a 500", async () => {
      /* A 500 for a malformed request, and it stays one on purpose: the plan's
         § [DECODE] again — authenticated `part` lets `decodeURIComponent`
         throw, while the public dispatcher's `slugFrom` turns the same throw
         into a 400 (src/public/routes.ts). Copying the public helper here would
         be a behaviour change, so this asserts what is, not what is tidy. */
      const reply = await call("PATCH", "/api/library/%", acceptAny, MALFORMED_BODY);
      expect(reply.status).toBe(500);
      expect(reply.body.error).toBe("URI malformed");
    });

    it("sends the two different answers to the same two malformed inputs", async () => {
      /* The pair, asserted as a pair. Either case alone could go green because
         both routes started answering the same way — which is precisely the
         regression this is here for. */
      const visibility = await call("PUT", "/api/article/%/visibility", acceptAny, MALFORMED_BODY);
      const shelf = await call("PATCH", "/api/library/%", acceptAny, MALFORMED_BODY);
      expect(visibility.status).not.toBe(shelf.status);
    });
  });

  describe("the admin namespace is refused before any method is looked at", () => {
    /* docs/project/admin.md: the namespace is a **path segment**, so
       `/api/administer` is somebody else's route and stays a 404. */
    it("has an administrator and a stranger to tell apart", () => {
      expect(isAdmin(TEST_SUB)).toBe(true);
    });

    it.each([
      ["GET", "/api/admin"],
      ["POST", "/api/admin"],
      ["GET", "/api/admin/anything-at-all"],
      ["DELETE", "/api/admin/anything-at-all"],
      ["GET", "/api/admin/users"],
      ["PUT", "/api/admin/users"],
    ])("refuses %s %s to a stranger with 403, wrong method or not", async (method, url) => {
      const reply = await call(method, url, acceptStranger);
      expect(reply.status).toBe(403);
      expect(reply.body.error).toContain("[admin-only]");
    });

    it.each([
      ["GET", "/api/administer"],
      ["GET", "/api/adminx"],
      ["POST", "/api/administer"],
    ])("leaves %s %s outside the namespace, so it is an ordinary 404", async (method, url) => {
      const reply = await call(method, url, acceptStranger);
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe(`No API route for ${method} ${url}`);
    });

    it("gives the administrator the ordinary 404 on the same paths", async () => {
      /* The control for the six above: without it they would still pass if
         everything 403'd, which is the failure a permission test has. */
      const reply = await call("POST", "/api/admin/anything-at-all");
      expect(reply.status).toBe(404);
    });
  });

  describe("the positive control", () => {
    /* One accepted pair, and only one. It proves the harness reaches a handler
       — so that a green negative matrix cannot be green because nothing here
       reaches anything. `/api/models` reads its answer out of config and
       touches no store, no provider and no money. */
    it("answers GET /api/models", async () => {
      const reply = await call("GET", "/api/models");
      expect(reply.handled).toBe(true);
      expect(reply.status).toBe(200);
      expect(reply.headers["content-type"]).toBe("application/json");
      expect(Object.keys(reply.body).length).toBeGreaterThan(0);
    });
  });
});
