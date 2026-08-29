/**
 * **The built client `index.html`, compiled into the serverless function** —
 * and the four checks that stop a stale one getting there.
 *
 * Stage 2 of the public-link work serves `/read/<slug>` from a function so the
 * `<head>` can be about the article (src/public/page-head.ts). The function
 * therefore needs the shell — the real one, with hashed `/assets/…js` in it,
 * not the source `index.html` with its `/src/web/boot.tsx` that only Vite's dev
 * server understands. `vite.api.config.ts` calls this and compiles the result
 * in as a constant.
 *
 * ## Why it refuses rather than falling back
 *
 * There is no empty-shell fallback, no source-shell fallback, no
 * warn-and-continue. Every one of those produces a deployment that boots, that
 * answers, and that serves the wrong page — the thing docs/reusable/silent-success.md
 * is about.
 *
 * The stale case is not hypothetical: the worktree that produced this design
 * had HEAD at one commit and `dist/build.json` at another, so an API build on
 * its own would have compiled a shell from a different version of the client
 * and said nothing at all. That is what check 2 exists for.
 *
 * ## Why it is here and not inside the vite config
 *
 * A config file only runs during a build, so a check that lives in one can only
 * be shown to fail by doing a build — and a guard nobody has watched fire is
 * not yet a guard. As a module it has tests (tests/client-shell.test.ts) that
 * feed it a mismatched stamp, a duplicated sentinel and the repo's own source
 * `index.html`, in milliseconds and without writing anything.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  MANAGED_HEAD_END,
  MANAGED_HEAD_START,
  requireMarkersInHead,
} from "../src/public/page-head.js";
import { sameCommit } from "./build-stamp.js";

/** The built shell, and the digest of exactly the bytes that were read. */
export interface ClientShell {
  html: string;
  /** Lower-case hex SHA-256 of the file as it sits on disk. */
  sha256: string;
}

/**
 * The sentinels, imported from the composer rather than written out again.
 *
 * The two must be the same string or this check is theatre: a build check
 * looking for a marker `composeShell()` no longer uses passes happily, and the
 * function then throws on the first shared link. src/public/page-head.ts is
 * pure — `escapeHtml`, `safePublicCanonical` and nothing else — so a build
 * config can import it without pulling a server graph into itself.
 */
const START = MANAGED_HEAD_START;
const END = MANAGED_HEAD_END;

/** A built script reference: `<script … src="/assets/index-CIBahh0D.js">`. */
const BUILT_ASSET = /src="\/assets\/[^"]+\.js"/;

/**
 * The source entry point. Present in `index.html`, absent from `dist/index.html`
 * — Vite replaces the tag with the hashed bundle above.
 *
 * Matched **with its `src="` attribute**, not as a bare path. `index.html` also
 * mentions `src/web/boot.tsx` in a comment, and that comment survives into the
 * built file; a looser needle would reject every real shell.
 */
const SOURCE_ENTRY = 'src="/src/web/boot.tsx"';

/**
 * **Every structural thing we need to be true of a shell**, as assertions with
 * their own messages.
 *
 * Separated from the reading and the stamp comparison so a test can hand it a
 * string — including the repo's own source `index.html`, which must be
 * rejected, and which is the positive control for the whole check.
 */
export function assertShellShape(html: string): void {
  once(html, START);
  once(html, END);
  if (html.indexOf(START) > html.indexOf(END)) {
    throw new Error("Client shell: the managed-head end sentinel comes before the start.");
  }
  /* **And both of them above `<body`**, which uniqueness and order do not give
     you: an end marker that had drifted below the body tag passes both checks
     above, and the replacement then deletes the opening of the body. The rule
     is imported from the composer rather than restated here, for the reason
     `START` gives about the markers themselves — a build check enforcing a
     slightly different rule from the one production runs is not a check. */
  requireMarkersInHead(html, html.indexOf(START), html.indexOf(END));
  /* The source-entry check comes first because it names the mistake somebody
     actually made — "you read index.html instead of dist/index.html" — where
     the asset check below would only say what was missing. The source file
     fails both, and the more specific diagnosis is the one worth printing. */
  if (html.includes(SOURCE_ENTRY)) {
    throw new Error(
      `Client shell: contains ${SOURCE_ENTRY}, so this is the *source* index.html rather than ` +
        "dist/index.html. Only Vite's dev server can serve that entry point; in production it 404s " +
        "and the page is blank.",
    );
  }
  if (!BUILT_ASSET.test(html)) {
    throw new Error(
      'Client shell: no built script reference (expected a src="/assets/….js"). ' +
        "This is what a shell taken from somewhere other than a finished `vite build` looks like.",
    );
  }
}

function once(html: string, marker: string): void {
  const first = html.indexOf(marker);
  if (first === -1) throw new Error(`Client shell: no ${marker} sentinel.`);
  const again = html.indexOf(marker, first + marker.length);
  if (again !== -1) {
    throw new Error(
      `Client shell: the ${marker} sentinel appears ${count(html, marker)} times; it must appear once. ` +
        "src/public/page-head.ts replaces the region between the two sentinels, and there is no " +
        "right answer about which pair to use.",
    );
  }
}

function count(html: string, marker: string): number {
  return html.split(marker).length - 1;
}

/**
 * Read `dist/index.html`, prove it belongs to this build, and hash it.
 *
 * @param distDir the client build output, normally `<repo>/dist`.
 * @param apiCommit the commit this API build is stamping itself with —
 *   `resolveBuildStamp().commit`.
 *
 * Throws on every problem, and every message names which check failed and what
 * the two values were. A build that fails without saying why costs an hour of
 * somebody's day, and this one fails on a machine that is not yours.
 */
export function readClientShell(distDir: string, apiCommit: string): ClientShell {
  const shellPath = path.join(distDir, "index.html");
  const stampPath = path.join(distDir, "build.json");

  /* Read as bytes, then decode. The digest must be of the file as served —
     `X-Spideryarn-Shell-SHA256` is compared against the SHA-256 of
     `GET /index.html` by the deployed check — and hashing a re-encoded string
     would be a different number the day the file is not clean UTF-8. */
  const bytes = read(shellPath, "the built client shell");
  const html = bytes.toString("utf8");
  const clientCommit = commitFrom(read(stampPath, "the client build stamp").toString("utf8"), stampPath);

  /* `sameCommit` rather than `===`, and it is not just tidiness: it is where
     the rule that **`"unknown"` never matches, not even itself** lives. Two
     builds that both failed to work out what they were would otherwise compare
     equal, and this check would pass over a pair of artefacts with no idea
     between them. scripts/build-stamp.ts § sameCommit. */
  if (!sameCommit(clientCommit, apiCommit)) {
    throw new Error(
      `Client shell is not from this build: ${stampPath} says commit "${clientCommit || "(missing)"}" ` +
        `and this API build says "${apiCommit}". Run \`npm run build\` first — the API build compiles ` +
        "dist/index.html into the function, so a stale one ships a stale page with no other symptom. " +
        '(Note that "unknown" never matches, including itself.)',
    );
  }

  assertShellShape(html);

  return { html, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * The commit out of `dist/build.json`, or `""`.
 *
 * `""` rather than a throw for a stamp with no `commit` string in it, because
 * the comparison below already has the right message for that case and names
 * both values. A `JSON.parse` failure *is* a throw, though: an unparseable
 * stamp is a different problem from a mismatched one and deserves to say so.
 */
function commitFrom(json: string, file: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Cannot parse the client build stamp at ${file}: ${(err as Error).message}`);
  }
  const commit = (parsed as { commit?: unknown })?.commit;
  return typeof commit === "string" ? commit : "";
}

/** Read a file, or say which one and what it was for. */
function read(file: string, what: string): Buffer {
  try {
    return readFileSync(file);
  } catch (err) {
    throw new Error(
      `Cannot read ${what} at ${file}: ${(err as Error).message}. Run \`npm run build\` before the API build.`,
    );
  }
}
