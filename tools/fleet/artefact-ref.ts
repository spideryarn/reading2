/**
 * **WHAT A REPORT OR A DECISION POINTS AT, AND THE ONE PLACE A LINK TO IT IS
 * BUILT** — as a leaf, so the browser can have it.
 *
 * A work report (`tools/overseer/reports.ts`) and a schema-2 decision
 * (`tools/overseer/decisions.ts`) both carry artefact references, and the
 * dashboard turns some of them into links. Three consumers and one rule, so the
 * rule lives here with no imports at all, for the reason `execution-token.ts`
 * gives: a policy that lives where its main consumer cannot reach it gets
 * copied instead of imported. docs/plans/260910e.
 *
 * ## Everything here arrives from an agent, so nothing here is trusted
 *
 * The SHAPE is refused — a path with `..`, a sha that is not hex, a control or
 * bidi-override character anywhere. The EXISTENCE is not: a reference to a
 * commit that is not there is a discrepancy worth showing, so a report keeps it
 * and the check says `not-found`. That split is GPT Sol's WR-P6.
 *
 * ## A link is built from validated fields, and only for what is on `dev`
 *
 * `found-locally` means a commit object or a file exists in the daemon's
 * checkout; it does not mean GitHub has it. So only `on-dev` gets a GitHub
 * link, every path segment is percent-encoded, and no URL is ever built from a
 * summary or any other free text.
 */

export type ArtefactRef =
  | { readonly kind: "commit"; readonly sha: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "decision"; readonly id: string }
  | { readonly kind: "queue-item"; readonly id: string };

export type ArtefactKind = ArtefactRef["kind"];

/**
 * What the daemon found when it looked, at receipt.
 *
 * `on-dev` and `found-locally` apply to commits and paths; `found` to decisions
 * and queue items, which live in a record rather than in git. **Failing to look
 * is `unchecked`, never `not-found`** — the same line the decision record draws
 * between `unavailable` and `not-found`.
 */
export type ArtefactCheck =
  | { readonly state: "on-dev" }
  | { readonly state: "found-locally" }
  | { readonly state: "found" }
  | { readonly state: "not-found" }
  | { readonly state: "unchecked"; readonly why: string };

export type CheckedArtefact = { readonly ref: ArtefactRef; readonly check: ArtefactCheck };

export const MAX_ARTEFACTS = 20;
export const MAX_PATH_CHARS = 300;
export const MAX_CHECK_WHY_CHARS = 300;

export const REPO_WEB_URL = "https://github.com/spideryarn/reading2";

/* The two id rules are restated rather than imported, because importing either
   record would stop this being a leaf. `tests/fleet-artefact-ref.test.ts` pins
   both against their owners, so a change there reds here. */
const ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
export const DECISION_ID_RULE = new RegExp(`^dec-[${ID_ALPHABET}]{8}$`);
export const QUEUE_ID_RULE = new RegExp(`^qi-[${ID_ALPHABET}]{8}$`);

const SHA_RULE = /^[0-9a-f]{7,40}$/;
/** One path segment: no spaces, no shell or URL punctuation, and not `.` or `..`. */
const SEGMENT_RULE = /^[A-Za-z0-9._@+-]+$/;

/**
 * Why this text may not be stored, or null when it may.
 *
 * Control characters would reach a terminal through `overseer reports`, and a
 * bidi override makes a line read differently from what it holds. Neither has a
 * use in a report, so both are refused rather than stripped — stripping would
 * store something the author did not write.
 */
export function untrustedTextProblem(text: string, maxChars: number): string | null {
  if ([...text].length > maxChars) return `is longer than ${maxChars} characters`;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // Tab is refused too: a report is one line of prose per field.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return "contains a control character";
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      return "contains a bidirectional override character";
    }
  }
  return null;
}

/** Why this is not a repo-relative path we will store, or null. */
export function pathProblem(path: string): string | null {
  const text = untrustedTextProblem(path, MAX_PATH_CHARS);
  if (text !== null) return `the path ${text}`;
  if (path === "") return "the path is empty";
  if (path.startsWith("/")) return "the path must be relative to the repository, not absolute";
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "") return "the path has an empty segment";
    if (segment === "." || segment === "..") return "the path may not contain '.' or '..' segments";
    if (!SEGMENT_RULE.test(segment)) {
      return "the path may contain only letters, digits and . _ @ + - in each segment";
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stored or submitted reference, strictly: nothing defaulted, nothing extra tolerated in meaning. */
export function parseArtefactRef(value: unknown): ArtefactRef | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "commit": {
      const sha = value["sha"];
      return typeof sha === "string" && SHA_RULE.test(sha) ? { kind: "commit", sha } : null;
    }
    case "path": {
      const path = value["path"];
      return typeof path === "string" && pathProblem(path) === null ? { kind: "path", path } : null;
    }
    case "decision": {
      const id = value["id"];
      return typeof id === "string" && DECISION_ID_RULE.test(id) ? { kind: "decision", id } : null;
    }
    case "queue-item": {
      const id = value["id"];
      return typeof id === "string" && QUEUE_ID_RULE.test(id) ? { kind: "queue-item", id } : null;
    }
    default:
      return null;
  }
}

export function parseArtefactCheck(value: unknown): ArtefactCheck | null {
  if (!isRecord(value)) return null;
  switch (value["state"]) {
    case "on-dev":
    case "found-locally":
    case "found":
    case "not-found":
      return { state: value["state"] };
    case "unchecked": {
      const why = value["why"];
      if (typeof why !== "string" || why.trim() === "") return null;
      return untrustedTextProblem(why, MAX_CHECK_WHY_CHARS) === null ? { state: "unchecked", why } : null;
    }
    default:
      return null;
  }
}

/**
 * Whether a check result is one this kind of reference can have.
 *
 * `found` for a commit, or `on-dev` for a decision, would be a checker bug
 * dressed as a fact, so the parser refuses the pair rather than trusting it.
 */
function checkFitsKind(kind: ArtefactKind, check: ArtefactCheck): boolean {
  if (check.state === "not-found" || check.state === "unchecked") return true;
  if (kind === "commit" || kind === "path") return check.state === "on-dev" || check.state === "found-locally";
  return check.state === "found";
}

/** A list of checked references, or null if any one is malformed or there are too many. */
export function parseCheckedArtefacts(value: unknown): CheckedArtefact[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARTEFACTS) return null;
  const out: CheckedArtefact[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const ref = parseArtefactRef(candidate["ref"]);
    const check = parseArtefactCheck(candidate["check"]);
    if (ref === null || check === null || !checkFitsKind(ref.kind, check)) return null;
    out.push({ ref, check });
  }
  return out;
}

/** A list of unchecked references, as a submission carries them. */
export function parseArtefactRefs(value: unknown): ArtefactRef[] | null {
  if (!Array.isArray(value) || value.length > MAX_ARTEFACTS) return null;
  const out: ArtefactRef[] = [];
  for (const candidate of value) {
    const ref = parseArtefactRef(candidate);
    if (ref === null) return null;
    out.push(ref);
  }
  return out;
}

/**
 * The CLI's spelling: `commit:<sha>`, `path:<repo-relative path>`,
 * `decision:<dec-id>`, `queue:<qi-id>`. A result rather than a null so the
 * command can say which part was wrong.
 */
export function parseArtefactSpec(text: string): { ok: true; ref: ArtefactRef } | { ok: false; why: string } {
  const colon = text.indexOf(":");
  if (colon === -1) return { ok: false, why: `'${text}' needs a kind: commit:, path:, decision: or queue:` };
  const kind = text.slice(0, colon);
  const rest = text.slice(colon + 1);
  switch (kind) {
    case "commit":
      return SHA_RULE.test(rest)
        ? { ok: true, ref: { kind: "commit", sha: rest } }
        : { ok: false, why: "a commit is 7 to 40 lower-case hex characters" };
    case "path": {
      const why = pathProblem(rest);
      return why === null ? { ok: true, ref: { kind: "path", path: rest } } : { ok: false, why };
    }
    case "decision":
      return DECISION_ID_RULE.test(rest)
        ? { ok: true, ref: { kind: "decision", id: rest } }
        : { ok: false, why: "a decision id looks like dec-a3k9mq2p" };
    case "queue":
      return QUEUE_ID_RULE.test(rest)
        ? { ok: true, ref: { kind: "queue-item", id: rest } }
        : { ok: false, why: "a queue item id looks like qi-a3k9mq2p" };
    default:
      return { ok: false, why: `'${kind}' is not an artefact kind: commit, path, decision or queue` };
  }
}

/** The inverse of `parseArtefactSpec`, for printing. */
export function spellArtefactRef(ref: ArtefactRef): string {
  switch (ref.kind) {
    case "commit":
      return `commit:${ref.sha}`;
    case "path":
      return `path:${ref.path}`;
    case "decision":
      return `decision:${ref.id}`;
    case "queue-item":
      return `queue:${ref.id}`;
  }
}

/**
 * The link for a checked reference, or null when there must not be one.
 *
 * Re-validates the reference before building anything: a caller holding a
 * value that never went through `parseArtefactRef` must not get a URL out of it.
 */
export function artefactHref(item: CheckedArtefact): string | null {
  if (parseArtefactRef(item.ref) === null) return null;
  switch (item.ref.kind) {
    case "commit":
      return item.check.state === "on-dev" ? `${REPO_WEB_URL}/commit/${item.ref.sha}` : null;
    case "path":
      return item.check.state === "on-dev"
        ? `${REPO_WEB_URL}/blob/dev/${item.ref.path.split("/").map(encodeURIComponent).join("/")}`
        : null;
    case "decision":
      return item.check.state === "found" ? `#decision-${item.ref.id}` : null;
    case "queue-item":
      // The queue has no page of its own; `overseer-queue.ts show <id>` is where it is read.
      return null;
  }
}

/** How a check reads to a person, beside the reference. */
export function describeArtefactCheck(check: ArtefactCheck): string {
  switch (check.state) {
    case "on-dev":
      return "on dev";
    case "found-locally":
      return "found on the box, not on dev";
    case "found":
      return "found";
    case "not-found":
      return "not found at receipt";
    case "unchecked":
      return `not checked: ${check.why}`;
  }
}
