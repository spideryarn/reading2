/**
 * **What `/read/:slug` answers, case by case** — src/public/page.ts.
 *
 * Two halves, deliberately. `decidePublicPage` is pure, so the whole status
 * table is checked with no database, no response object and no shell anywhere
 * near it. `servePublicReadPage` is the four lines of I/O around it, and the
 * cases below drive it with a fake reader — including the failure row, which is
 * the one that cannot be produced on demand by any database you would want to
 * have.
 *
 * The row worth reading twice is the last one: **an unexpected reader failure
 * serves the whole page and a 503.** Both halves, and they are not in tension —
 * we write the shell body ourselves, so the status has no say in whether the
 * application arrives. This was a 200 for a day, on the argument that a 5xx
 * would replace the page with Vercel's error page; that premise was false and
 * GPT Sol's review of the built code caught it. The 200 was the worse answer,
 * because an unfurler caches the generic card in a cache we cannot reach and
 * every status-based monitor reports success. src/public/page.ts's header.
 *
 * ## What this file does not prove
 *
 * It does not prove Vercel routes `/read/:slug` here at all — that is
 * tests/public-read-rewrite.test.ts for the config and a deployed check for the
 * platform. It does not prove the *contents* of an enhanced head are safe;
 * escaping, clamping and the body-unchanged guarantee belong to
 * `composeShell` and are tested beside it.
 */

import type { ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

/**
 * **Monitoring, stubbed so the degradation is provably visible.**
 *
 * Serving 200 on an unexpected failure is only the right call if we find out
 * about it, so "it was captured" is part of the behaviour rather than a detail
 * — a version that swallowed the error would pass every other case in this file.
 */
const monitoring = vi.hoisted(() => ({ captured: [] as unknown[] }));
vi.mock("../src/monitoring.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/monitoring.js")>();
  return {
    ...actual,
    captureFailure: (err: unknown) => {
      monitoring.captured.push(err);
    },
  };
});

const { builtShell, decidePublicPage, servePublicReadPage } = await import("../src/public/page.js");
const { composeShell } = await import("../src/public/page-head.js");
type PublicHead = import("../src/store/public-reader.js").PublicHead;

/**
 * A stand-in for the built client — the managed-head block between its
 * sentinels, a hashed script reference, and a body with something in it.
 *
 * Hand-built rather than read from `dist/`, because `dist/` is a build artefact
 * that may not exist and would make this file's result depend on when somebody
 * last ran `npm run build`. What it has to be is *shaped* like the real one:
 * one sentinel pair, so `composeShell` has somewhere to put a head.
 */
const SHELL = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8" />',
  "<!-- spideryarn:managed-head:start -->",
  "<title>Spideryarn</title>",
  '<meta name="robots" content="noindex, nofollow" />',
  "<!-- spideryarn:managed-head:end -->",
  '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
  "</head>",
  '<body><div id="root"></div></body>',
  "</html>",
].join("\n");

const SHA256 = "e".repeat(64);
const shell = { html: SHELL, sha256: SHA256 };

/**
 * A title with characters outside ASCII, which is not decoration.
 *
 * `Content-Length` is a count of **bytes**, and `"…é…"`.length is a count of
 * UTF-16 units. A fixture whose every character was ASCII would let
 * `.length` and `Buffer.byteLength` agree, and the assertion below would be
 * green over the bug it exists to catch.
 */
const HEAD: PublicHead = {
  slug: "a-public-article",
  title: "Café Society — naïveté, dénouement, 日本語",
  gist: "A short description with an em dash — and a curly quote's apostrophe.",
  canonical: "https://example.com/a-public-article",
};

/** The title of an article that is **not** shared. It must appear nowhere. */
const PRIVATE_TITLE = "Zylquarn Redacted Draft, Do Not Share";

/** A reader that answers for exactly one slug and 404s everything else. */
function reader(head: PublicHead): (slug: string) => Promise<PublicHead> {
  return async (slug: string) => {
    if (slug === head.slug) return head;
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  };
}

/**
 * **A reader that puts the private title into the subject's hands on the
 * refusal path**, which the previous version of this fixture did not.
 *
 * The old one threw before the canary title existed anywhere the code could see
 * it, so the `not.toContain` assertions below were asserting about a string the
 * subject had never been given — green under every mutation, including a real
 * leak. GPT Sol's review of slice 1 found it, and this is the repair: the
 * refusal it throws carries `PRIVATE_TITLE` in its message, so a version that
 * echoed a reader's error into the response would be caught here, and the
 * public slug it *does* answer for carries the same title, so the control above
 * can show the same string reaching the body when it is allowed to.
 *
 * What this cannot prove is that the *store* never hands a private head over in
 * the first place; that is a query, and tests/public-visibility-pg.test.ts
 * proves it against a real Postgres. This file proves the transport.
 */
function privateReader(): (slug: string) => Promise<PublicHead> {
  const head: PublicHead = { ...HEAD, slug: "a-public-article", title: PRIVATE_TITLE };
  return async (slug: string) => {
    if (slug === head.slug) return head;
    throw Object.assign(new Error(`No article artefacts for "${PRIVATE_TITLE}".`), { status: 404 });
  };
}

/** A reader that fails the way a database does: unexpectedly, and not with a 404. */
const brokenReader = async (): Promise<PublicHead> => {
  throw Object.assign(new Error("Storage is unavailable"), { status: 500 });
};

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Whether `end` was called with anything at all — a HEAD must not be. */
  wroteBody: boolean;
}

async function serve(
  method: string,
  slug: string,
  read: (slug: string) => Promise<PublicHead>,
): Promise<Answer> {
  const headers: Record<string, string> = {};
  let status = 0;
  let body = "";
  let wroteBody = false;
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: string) {
      if (chunk !== undefined) {
        wroteBody = true;
        body = chunk;
      }
    },
  } as unknown as ServerResponse;

  await servePublicReadPage({ res, method, slug, shell, read });
  return { status, headers, body, wroteBody };
}

describe("builtShell, where there is no compiled shell", () => {
  /**
   * **`typeof`, not a bare read.**
   *
   * `vite.api.config.ts` is the only thing that defines
   * `__SPIDERYARN_BUILT_SHELL__`, and `npm run dev` and vitest never load it. An
   * undeclared identifier is not `undefined` — touching it throws a
   * `ReferenceError`, which here would take the whole request down rather than
   * declining it. So this case is not "does it return null": it is "does it
   * return at all", and it would go red on `!== "string"` becoming
   * `!== undefined`. src/vercel-health.ts guards the build stamp the same way,
   * and this is the same trap.
   */
  it("returns null rather than throwing, which is what the fallthrough depends on", () => {
    expect(builtShell()).toBeNull();
  });
});

describe("decidePublicPage — the table, with no I/O in it", () => {
  it("200 and the head, for a public readable article", () => {
    const d = decidePublicPage("GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256);
    expect(d.status).toBe(200);
    expect(d.head).toEqual(HEAD);
  });

  it("404 and no head, for private, absent, and an unreadable revision alike", () => {
    const d = decidePublicPage("GET", "not-shared", { kind: "not-shared" }, SHA256);
    expect(d.status).toBe(404);
    expect(d.head).toBeNull();
  });

  it("400 and no head, for a slug the server could never answer", () => {
    for (const bad of ["Upper", "has space", "-leading", "a_b", "a%2Fb", ""]) {
      const d = decidePublicPage("GET", bad, null, SHA256);
      expect(d.status, bad).toBe(400);
      expect(d.head, bad).toBeNull();
    }
  });

  it("405 with Allow, for anything that is not a read", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get"]) {
      const d = decidePublicPage(method, HEAD.slug, null, SHA256);
      expect(d.status, method).toBe(405);
      expect(d.headers.Allow, method).toBe("GET, HEAD");
    }
  });

  /**
   * **503, and the default head, when the head read failed.**
   *
   * Not 200 — a 200 puts a generic card into an unfurler's cache we cannot
   * reach, and tells every status monitor the page is fine. Not 500 either: the
   * condition is transient by nature, and `Retry-After` says how long we think
   * it is worth waiting. The body is still the whole application, because this
   * module writes the shell itself and the status does not change that.
   */
  it("503 with Retry-After and no head, when the reader failed unexpectedly", () => {
    const d = decidePublicPage("GET", HEAD.slug, { kind: "failed" }, SHA256);
    expect(d.status).toBe(503);
    expect(d.headers["Retry-After"]).toBe("30");
    expect(d.head).toBeNull();
  });

  /**
   * **And `Retry-After` is on that answer only.**
   *
   * A `Retry-After` on the 404 would be telling a reader that an article which
   * is not shared might be shared in thirty seconds, which is not what we mean
   * and not something we know. It is a header about the transient row.
   */
  it("puts Retry-After on the failure and on nothing else", () => {
    const others: Parameters<typeof decidePublicPage>[] = [
      ["GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256],
      ["GET", "nope", { kind: "not-shared" }, SHA256],
      ["GET", "Upper", null, SHA256],
      ["POST", HEAD.slug, null, SHA256],
    ];
    for (const args of others) {
      const d = decidePublicPage(...args);
      const label = `${args[0]} ${args[1]}`;
      /* `d.headers`, not `d` — the first draft of this line read
         `Object.keys(decidePublicPage(...args))`, whose keys are `status`,
         `headers` and `head`, so it could not have contained a header name
         under any mutation. The mutation that found it (put `Retry-After` in
         the shared `headers` object) left it green. */
      expect(Object.keys(d.headers), label).not.toContain("Retry-After");
      expect(d.headers["Retry-After"], label).toBeUndefined();
    }
    /* And the control, so "absent everywhere" is not vacuously true of a
       `decidePublicPage` that had stopped setting it at all. */
    expect(
      decidePublicPage("GET", HEAD.slug, { kind: "failed" }, SHA256).headers["Retry-After"],
    ).toBe("30");
  });

  /**
   * **Method before slug before store.** A POST to a malformed slug is a 405,
   * not a 400 — and more to the point, neither of them reads the database.
   */
  it("checks the method first, so a write to a bad slug never reaches a store", () => {
    expect(decidePublicPage("POST", "Upper", null, SHA256).status).toBe(405);
  });

  it("puts the same three headers on every answer, refusals included", () => {
    const cases: Parameters<typeof decidePublicPage>[] = [
      ["GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256],
      ["GET", "nope", { kind: "not-shared" }, SHA256],
      ["GET", "Upper", null, SHA256],
      ["POST", HEAD.slug, null, SHA256],
      ["GET", HEAD.slug, { kind: "failed" }, SHA256],
    ];
    for (const args of cases) {
      const d = decidePublicPage(...args);
      expect(d.headers["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(d.headers["Cache-Control"]).toBe("no-store");
      expect(d.headers["X-Spideryarn-Shell-SHA256"]).toBe(SHA256);
    }
  });

  /**
   * **No `X-Robots-Tag`, from here, at all.**
   *
   * The site-wide rule in vercel.json still owns it in slice 1, and a second
   * source for one header is a duplicate on the wire. Matched case-insensitively
   * because HTTP header names are, and a `x-robots-tag` set in lower case would
   * collide exactly as loudly.
   */
  it("sets no robots header of its own", () => {
    const every = [
      decidePublicPage("GET", HEAD.slug, { kind: "found", head: HEAD }, SHA256),
      decidePublicPage("GET", "nope", { kind: "not-shared" }, SHA256),
      decidePublicPage("POST", HEAD.slug, null, SHA256),
    ];
    for (const d of every) {
      expect(Object.keys(d.headers).map((k) => k.toLowerCase())).not.toContain("x-robots-tag");
    }
  });
});

describe("servePublicReadPage — what actually goes on the wire", () => {
  it("serves the enhanced shell for a public article", async () => {
    const answer = await serve("GET", HEAD.slug, reader(HEAD));
    expect(answer.status).toBe(200);
    expect(answer.body).not.toBe(SHELL);
    expect(answer.body).toContain("Café Society");
  });

  /**
   * **The control under the canary below**, and it is the half that was missing.
   *
   * A `not.toContain(X)` is only an assertion if X could have got there. Here
   * the same reader, the same fixture and the same title go out on the shared
   * slug and land in the body — so when the refusal case says the string is
   * absent, absent is a fact about the code rather than about the fixture.
   */
  it("puts that same title into the body when the article really is shared", async () => {
    const answer = await serve("GET", "a-public-article", privateReader());
    expect(answer.status).toBe(200);
    expect(answer.body).toContain(PRIVATE_TITLE);
  });

  /**
   * **A private slug gets the shell back byte-for-byte**, and the title appears
   * nowhere in the response — not in the body and not in a header.
   *
   * Three assertions rather than one, because they die to different mutations.
   * A `toBe(SHELL)` catches "returned the enhanced head instead" even when the
   * head happens to be empty; the `not.toContain` catches a head that leaked one
   * field while looking unmodified, and catches the refusal's own message being
   * echoed into the page. The 404-not-403 rule that makes a private article
   * indistinguishable from an absent one is worth exactly nothing if the
   * `<title>` of the 404 gives the game away.
   *
   * **Mutation: make `loadHead`'s 404 branch return
   * `{ kind: "found", head: { …, title: (err as Error).message } }`.** Red on
   * the status and red on both `not.toContain`s. Under the fixture this replaced
   * — where the reader threw a message built from the *slug* — the same mutation
   * left both `not.toContain`s green.
   */
  it("serves the untouched shell, with no trace of the title, for a slug that is not shared", async () => {
    const answer = await serve("GET", "someone-elses-article", privateReader());
    /* **Every canary first — before the status, and before `toBe(SHELL)`.**
       Not housekeeping: a failing assertion ends the case, so anything above
       these is a lid on them. A `toBe(SHELL)` placed first hides them from any
       leak that changes the body, and `toBe(404)` placed first hides them from
       any leak that changes the status — which is most of them, and which was
       still true after the first repair of this test. Measured both ways on
       2026-08-29: with the status check above, a `loadHead` that renders the
       reader's error message into the head reddens this case on *the status*
       and never runs a single `not.toContain`.

       The general form, which is why this comment is long: **an assertion is
       only exercised if every assertion above it passes**, so ordering decides
       what a mutation actually proves. Put the assertion the test is *named
       for* at the top. */
    expect(answer.body).not.toContain(PRIVATE_TITLE);
    expect(answer.body).not.toContain("Zylquarn");
    expect(JSON.stringify(answer.headers)).not.toContain("Zylquarn");
    expect(answer.status).toBe(404);
    expect(answer.body).toBe(SHELL);
  });

  it("400s a malformed slug without asking the reader anything", async () => {
    let asked = 0;
    const answer = await serve("GET", "Upper", async (slug) => {
      asked += 1;
      return { ...HEAD, slug };
    });
    expect(answer.status).toBe(400);
    expect(answer.body).toBe(SHELL);
    expect(asked).toBe(0);
  });

  it("405s a write, with Allow, without asking the reader anything", async () => {
    let asked = 0;
    const answer = await serve("POST", HEAD.slug, async (slug) => {
      asked += 1;
      return { ...HEAD, slug };
    });
    expect(answer.status).toBe(405);
    expect(answer.headers.Allow).toBe("GET, HEAD");
    expect(answer.body).toBe(SHELL);
    expect(asked).toBe(0);
  });

  /**
   * **HEAD is a GET without a body**, and everything else about it is identical
   * — status, headers, and a `Content-Length` that tells the truth about the
   * GET's body.
   */
  it("answers HEAD with the same status and headers, and no body", async () => {
    const get = await serve("GET", HEAD.slug, reader(HEAD));
    const head = await serve("HEAD", HEAD.slug, reader(HEAD));
    expect(head.status).toBe(get.status);
    expect(head.headers).toEqual(get.headers);
    expect(head.wroteBody).toBe(false);
    expect(head.body).toBe("");
  });

  /**
   * **`Content-Length` counts bytes, and the fixture makes that visible.**
   *
   * The first assertion is the check. The second is the check on the check: if
   * the enhanced body were pure ASCII, `.length` and `Buffer.byteLength` would
   * agree and the first assertion would pass over a `.length` bug. `HEAD.title`
   * carries é, ï and 日本語 precisely so they cannot.
   */
  it("reports a truthful Content-Length in UTF-8 bytes, on both methods", async () => {
    const get = await serve("GET", HEAD.slug, reader(HEAD));
    const bytes = Buffer.byteLength(get.body, "utf8");
    expect(bytes).toBeGreaterThan(get.body.length);
    expect(get.headers["Content-Length"]).toBe(String(bytes));

    const head = await serve("HEAD", HEAD.slug, reader(HEAD));
    expect(head.headers["Content-Length"]).toBe(String(bytes));
  });

  /**
   * **Both halves of the failure row, on the wire.**
   *
   * The reader throws something that is not a 404. The visitor still gets the
   * entire application — `answer.body` is the shell, and the client goes and
   * fetches its own data through `/api/public/article/:slug` — *and* the status
   * is a 503, so an unfurler does not cache a generic card and a monitor does
   * not report success. This function composes and writes the body itself, so
   * the two are not in tension; believing they were is what put a 200 here.
   *
   * And it is captured, because a degradation nobody hears about would be a
   * silent downgrade whatever status it wore.
   */
  it("serves the whole page and a 503 when the reader fails unexpectedly, and tells us it did", async () => {
    monitoring.captured.length = 0;
    const answer = await serve("GET", HEAD.slug, brokenReader);
    expect(answer.status).toBe(503);
    expect(answer.headers["Retry-After"]).toBe("30");
    /* The point that the argument for the 200 got wrong: the body is ours, and
       it is all of it. `toBe(SHELL)` is byte-for-byte the built client. */
    expect(answer.body).toBe(SHELL);
    expect(answer.wroteBody).toBe(true);
    expect(monitoring.captured).toHaveLength(1);
    expect((monitoring.captured[0] as Error).message).toBe("Storage is unavailable");
  });

  /** And a `not-shared` is an answer rather than a failure, so nothing is captured. */
  it("captures nothing for an ordinary 404", async () => {
    monitoring.captured.length = 0;
    const answer = await serve("GET", "not-shared-at-all", reader(HEAD));
    expect(answer.status).toBe(404);
    expect(monitoring.captured).toEqual([]);
  });

  it("carries the compiled shell digest on every answer", async () => {
    const answers = await Promise.all([
      serve("GET", HEAD.slug, reader(HEAD)),
      serve("GET", "not-shared-at-all", reader(HEAD)),
      serve("GET", "Upper", reader(HEAD)),
      serve("POST", HEAD.slug, reader(HEAD)),
      serve("GET", HEAD.slug, brokenReader),
    ]);
    for (const answer of answers) {
      expect(answer.headers["X-Spideryarn-Shell-SHA256"]).toBe(SHA256);
      expect(answer.headers["Cache-Control"]).toBe("no-store");
      expect(answer.headers["Content-Type"]).toBe("text/html; charset=utf-8");
      expect(Object.keys(answer.headers).map((k) => k.toLowerCase())).not.toContain("x-robots-tag");
    }
  });

  /**
   * **The default answer really is the shell**, which is the control under every
   * `toBe(SHELL)` above. If `composeShell(shell, null)` ever stopped being the
   * identity, those assertions would start being about something else.
   */
  it("and composeShell with no head is the identity, which is what those assertions assume", () => {
    expect(composeShell(SHELL, null)).toBe(SHELL);
  });
});
