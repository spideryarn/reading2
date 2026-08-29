/**
 * **The four checks that stop a stale client shell being compiled into the
 * serverless function**, exercised without running a build.
 *
 * `vite.api.config.ts` compiles `dist/index.html` into the function so that
 * `/read/<slug>` can be served with a head about the article
 * (src/public/page-head.ts). Nothing about that is visible at runtime if the
 * shell is wrong: the function boots, answers 200, and serves a page from a
 * different version of the client, or one whose only script tag points at
 * `/src/web/boot.tsx` and 404s. docs/reusable/silent-success.md.
 *
 * The stale case is on the record rather than imagined — the worktree this
 * design came out of had HEAD at one commit and `dist/build.json` at another.
 *
 * **The point of this file is that the guard can be watched failing.** A check
 * that lives inside a vite config can only be shown to fire by doing a build,
 * which is why the logic is in scripts/client-shell.ts instead. Every case here
 * is a refusal, and the positive controls are the two that must *not* refuse.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { assertShellShape, readClientShell } from "../scripts/client-shell.js";
import { composeShell, MANAGED_HEAD_END, MANAGED_HEAD_START } from "../src/public/page-head.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** The repo's own `index.html`. The thing that must be refused. */
const SOURCE = readFileSync(path.join(ROOT, "index.html"), "utf8");

/**
 * What `vite build` makes of it: the source entry point replaced by the hashed
 * bundle, and everything else — comments included — carried through.
 *
 * Derived from the real file rather than hand-written, so this fixture cannot
 * quietly stop resembling what the build emits.
 */
const BUILT = SOURCE.replace(
  '<script type="module" src="/src/web/boot.tsx"></script>',
  '<script type="module" crossorigin src="/assets/index-CIBahh0D.js"></script>',
);

const COMMIT = "7e3d98ef12e5647bce1e2002eb2ce2873b48869f";
const OTHER = "0f52886a1b2c3d4e5f60718293a4b5c6d7e8f901";

const dirs: string[] = [];

/** A throwaway `dist/`, with whatever shell and stamp the case needs. */
function dist(html: string, stamp: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "spya-shell-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "index.html"), html);
  writeFileSync(path.join(dir, "build.json"), typeof stamp === "string" ? stamp : JSON.stringify(stamp));
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("what a shell has to look like", () => {
  it("accepts the built shell", () => {
    /* The positive control, and it is not a formality: it is what proves the
       three refusals below are refusing something specific rather than
       everything. */
    expect(() => assertShellShape(BUILT)).not.toThrow();
  });

  it("refuses the source index.html, which is the mistake somebody will make", () => {
    /* Reading `index.html` instead of `dist/index.html` produces a function
       that serves a page whose only script is `/src/web/boot.tsx` — a path only
       Vite's dev server can answer. In production it 404s and the page is
       blank, with nothing in any log. */
    expect(() => assertShellShape(SOURCE)).toThrow(/[*]source[*] index\.html/);
  });

  it("is not fooled by the word boot.tsx in a comment", () => {
    /* **The needle is `src="/src/web/boot.tsx"`, not the bare path**, because
       `index.html` explains in a comment why the entry point is `boot.tsx`
       rather than `main.tsx` — and that comment survives into the built file. A
       looser check would reject every real shell there is, which is the kind of
       guard that gets deleted rather than fixed. */
    expect(BUILT).toContain("boot.tsx");
    expect(() => assertShellShape(BUILT)).not.toThrow();
  });

  it("refuses a shell with no built script in it", () => {
    const stripped = BUILT.replace(/<script[^>]*><\/script>/g, "");
    expect(() => assertShellShape(stripped)).toThrow(/no built script reference/);
  });

  it("refuses a duplicated sentinel, and a missing one", () => {
    /* There is no right answer about which pair of markers `composeShell()`
       should replace between, so the build refuses rather than picking one. */
    const twice = BUILT.replace(MANAGED_HEAD_START, `${MANAGED_HEAD_START}${MANAGED_HEAD_START}`);
    expect(() => assertShellShape(twice)).toThrow(/appears 2 times/);
    expect(() => assertShellShape(BUILT.replace(MANAGED_HEAD_START, ""))).toThrow(/sentinel/);
  });

  /**
   * **And a sentinel that has drifted below the `<body>`**, which the build
   * check missed for exactly as long as the composer did.
   *
   * `composeShell` replaces from the first byte of the start marker to the last
   * byte of the end marker, so an end marker under the body tag means the
   * replacement deletes the opening of the body — `<div id="root">` with it. The
   * shape check is the half that would catch it at build time, before anything
   * is deployed, and it did not. GPT Sol's review of slice 1, finding 2.
   *
   * The rule is `requireMarkersInHead`, imported from the composer rather than
   * written out again here, for the reason `START` above gives about the markers
   * themselves.
   *
   * **Mutation: delete the `requireMarkersInHead` call from `assertShellShape`.**
   * Both cases go green, and the second one is a build that ships a blank page.
   */
  it("refuses a sentinel that has drifted below the body tag", () => {
    const late = BUILT.replace(MANAGED_HEAD_END, "").replace(
      "  <body>",
      `  <body>\n    ${MANAGED_HEAD_END}`,
    );
    /* The fixture really is the dangerous one: the span the composer would
       replace contains the body tag. */
    expect(late.slice(late.indexOf(MANAGED_HEAD_START), late.indexOf(MANAGED_HEAD_END))).toContain(
      "<body",
    );
    expect(() => assertShellShape(late)).toThrow(/end sentinel is at \d+, below the <body/);
    expect(() => assertShellShape(BUILT.slice(0, BUILT.indexOf("<body")))).toThrow(/no <body tag/);
  });
});

describe("proving the shell came from this build", () => {
  it("accepts a dist that names the same commit", () => {
    const shell = readClientShell(dist(BUILT, { commit: COMMIT, artefact: "client" }), COMMIT);
    expect(shell.html).toBe(BUILT);
  });

  it("refuses a dist from a different commit", () => {
    /* The failure that has actually happened: an API build run on its own, with
       a `dist/` left over from an earlier one. Everything succeeds and the
       deployed page is from the wrong version of the client. */
    expect(() => readClientShell(dist(BUILT, { commit: OTHER }), COMMIT)).toThrow(
      /not from this build/,
    );
  });

  it('refuses two builds that both say "unknown"', () => {
    /* **`"unknown"` never matches, not even itself** — the rule lives in
       `sameCommit` (scripts/build-stamp.ts) and this is the case it exists for.
       A plain `===` would pass here, over a pair of artefacts with no idea what
       they are, and the check that exists to prove they came from one commit
       would be reporting success on the commonest way of not knowing. */
    expect(() => readClientShell(dist(BUILT, { commit: "unknown" }), "unknown")).toThrow(
      /not from this build/,
    );
  });

  it("names both values when it refuses", () => {
    /* A build that fails without saying why costs an hour of somebody's day,
       and it fails on a machine that is not theirs. */
    let message = "";
    try {
      readClientShell(dist(BUILT, { commit: OTHER }), COMMIT);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(OTHER);
    expect(message).toContain(COMMIT);
    expect(message).toContain("npm run build");
  });

  it("refuses a missing dist, and an unparseable stamp", () => {
    expect(() => readClientShell(path.join(ROOT, "no-such-dist"), COMMIT)).toThrow(
      /Cannot read the built client shell/,
    );
    expect(() => readClientShell(dist(BUILT, "{ not json"), COMMIT)).toThrow(/Cannot parse/);
  });

  it("still applies the shape checks to a shell whose commit matches", () => {
    /* A stamp is about *which* build, and the shape checks are about *what was
       built*. A fresh commit with the source shell beside it is a real
       combination — it is what a `cp index.html dist/` would leave — and the
       commit check has nothing to say about it. */
    expect(() => readClientShell(dist(SOURCE, { commit: COMMIT }), COMMIT)).toThrow(
      /[*]source[*] index\.html/,
    );
  });
});

describe("the digest that is served to the deployed check", () => {
  it("is of the untouched shell, not of anything composed from it", () => {
    /* `X-Spideryarn-Shell-SHA256` is compared against the SHA-256 of
       `GET /index.html`, so it has to be the base shell's digest. **Mutation:
       hash `composeShell(html, head)` instead.** Red — the two differ, which is
       the whole point of asserting they do. */
    const shell = readClientShell(dist(BUILT, { commit: COMMIT }), COMMIT);
    expect(shell.sha256).toMatch(/^[0-9a-f]{64}$/);
    /* Computed by a different route than the one under test: read the bytes,
       hash them. */
    expect(shell.sha256).toBe(createHash("sha256").update(Buffer.from(BUILT, "utf8")).digest("hex"));

    const composed = composeShell(BUILT, {
      slug: "s",
      title: "T",
      gist: null,
      canonical: null,
    });
    expect(composed).not.toBe(BUILT);
    expect(createHash("sha256").update(Buffer.from(composed, "utf8")).digest("hex")).not.toBe(
      shell.sha256,
    );
  });
});
