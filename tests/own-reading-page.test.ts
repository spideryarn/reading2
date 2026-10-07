/**
 * **A Spideryarn reading-page address pasted into Add is refused, with a
 * sentence, before anything is reserved.**
 *
 * Reader B is sent A's public link and pastes it into Add, hoping for a copy of
 * their own. Importing our own reading page can never be what they meant: the
 * address names A's article, not the piece it was made from. So the route says
 * so and takes nothing (plan 261007f, E8).
 *
 * Two halves. The rule itself is a pure function and is asked directly. The
 * route half drives `POST /api/jobs` through `handleApi` with the admission
 * door replaced by a recorder, because "refused" is not the whole claim: the
 * refusal has to come **before** a slot is reserved, and a 400 raised inside
 * the slot would look the same from the status alone.
 *
 * ## Watched red, 2026-10-07
 *
 * With the predicate answering `false` for everything:
 *
 * ```
 *   × refuses our reading page: https://www.spideryarn.com/read/why-trees-spya-k3m9qt
 *     → expected false to be true
 * ```
 *
 * And with the route not asking it:
 *
 * ```
 *   × answers 400 with the sentence, and reserves nothing
 *     → expected 599 to be 400
 * ```
 *
 * (599 is the recorder's own status: the request had reached the slot.)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { OWN_READING_PAGE } from "../src/messages.js";
import { isOwnReadingPage } from "../src/own-reading-page.js";
import { handleApi } from "../src/routes.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

/**
 * The admission door, as a recorder that lets nothing through. A request that
 * reaches it is answered 599, a status no route here uses, so "got as far as
 * the slot" cannot be mistaken for any real answer.
 */
const slot = vi.hoisted(() => ({ asked: 0 }));
vi.mock("../src/billing/admission.js", async (original) => {
  const actual = await original<typeof import("../src/billing/admission.js")>();
  return {
    ...actual,
    withIngestSlot: async () => {
      slot.asked += 1;
      throw Object.assign(new Error("the test's slot recorder"), { status: 599 });
    },
  };
});

describe("which addresses are our own reading pages", () => {
  const OURS = [
    "https://www.spideryarn.com/read/why-trees-spya-k3m9qt",
    "http://www.spideryarn.com/read/why-trees-spya-k3m9qt",
    "https://www.spideryarn.com:443/read/why-trees-spya-k3m9qt",
    "http://www.spideryarn.com:80/read/why-trees-spya-k3m9qt",
    "https://spideryarn.com/read/why-trees-spya-k3m9qt",
    "http://spideryarn.com/read/why-trees-spya-k3m9qt",
    "https://WWW.Spideryarn.com/read/why-trees-spya-k3m9qt",
    "https://www.spideryarn.com./read/why-trees-spya-k3m9qt",
    "https://www.spideryarn.com/read/why-trees-spya-k3m9qt?key=abcdefghijklmnopqrstuv",
    "https://www.spideryarn.com/read/why-trees-spya-k3m9qt?mode=glossary#spya-aaaaaa",
    "https://www.spideryarn.com/read/why-trees-spya-k3m9qt/",
    "https://www.spideryarn.com/read/public",
    /* URL preserves escapes in `pathname`; an unreserved character may be
       escaped without changing which HTTP path this names. */
    "https://www.spideryarn.com/%72ead/why-trees-spya-k3m9qt",
  ];
  for (const address of OURS) {
    it(`refuses our reading page: ${address}`, () => {
      expect(isOwnReadingPage(address)).toBe(true);
    });
  }

  /* The control, without which a predicate that said yes to everything on our
     host, or to everything, would pass the list above. */
  const NOT_OURS = [
    "https://www.spideryarn.com/help",
    "https://www.spideryarn.com/changelog",
    "https://www.spideryarn.com/",
    "https://www.spideryarn.com/read",
    "https://www.spideryarn.com/read/",
    "https://www.spideryarn.com/reading/why-trees",
    "https://example.com/read/why-trees-spya-k3m9qt",
    "https://notspideryarn.com/read/why-trees",
    "https://spideryarn.com.example.org/read/why-trees",
    "https://blog.spideryarn.com/read/why-trees",
    /* A non-default port is a different origin, even on the same hostname. */
    "https://www.spideryarn.com:8443/read/why-trees-spya-k3m9qt",
    /* Reserved slashes and path case are significant to the app router. */
    "https://www.spideryarn.com/read%2Fwhy-trees-spya-k3m9qt",
    "https://www.spideryarn.com/READ/why-trees-spya-k3m9qt",
    "",
    "not an address",
  ];
  for (const address of NOT_OURS) {
    it(`lets through: ${JSON.stringify(address)}`, () => {
      expect(isOwnReadingPage(address)).toBe(false);
    });
  }
});

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign(
    (async function* () {
      yield Buffer.from(JSON.stringify(body));
    })(),
    { method: "POST", url: "/api/jobs", headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let written = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    writeHead(code: number) {
      (this as { statusCode: number }).statusCode = code;
    },
    flushHeaders() {},
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status: res.statusCode, body: JSON.parse(written) as Record<string, unknown> };
}

describe("POST /api/jobs with one of our own reading pages", () => {
  it("answers 400 with the sentence, and reserves nothing", async () => {
    slot.asked = 0;
    /* Without a scheme, the way a reader pastes it: the rule is asked of the
       normalised address, not of the typed one. */
    const got = await post({ url: "www.spideryarn.com/read/why-trees-spya-k3m9qt?key=abc" });
    expect(got.status).toBe(400);
    expect(got.body.error).toBe(OWN_READING_PAGE.message);
    expect(got.body.error).toBe(
      "That link opens an article already in Spideryarn, rather than the original article, so " +
        "adding the same link will not help. Open the link to read it, or paste the article's " +
        "original address to add your own copy. [jb-own-page]",
    );
    /* The code is what the Add page reads to leave *Try again* off. */
    expect(got.body.error).toMatch(/\[jb-own-page\]$/);
    expect(slot.asked).toBe(0);
  });

  /* The control for the recorder: an ordinary address does reach the slot, so
     `asked === 0` above is the refusal and not a recorder nobody calls. */
  it("while another page on our host goes on to the slot as before", async () => {
    slot.asked = 0;
    const got = await post({ url: "https://www.spideryarn.com/help" });
    expect(got.status).toBe(599);
    expect(slot.asked).toBe(1);
  });
});
