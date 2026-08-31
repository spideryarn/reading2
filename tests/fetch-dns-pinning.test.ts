/**
 * **The connection goes to the address we checked, and to no other.**
 *
 * `guardAddress` resolves a hostname and refuses private answers, and then —
 * until this landed — handed the URL to `fetch`, which resolved it *again* to
 * open the socket. Two lookups, and nothing said they had to agree. A name that
 * answers `93.184.216.34` to the first and `127.0.0.1` to the second walks
 * straight through a guard that reports success.
 *
 * That gap was written down as knowingly open (src/fetch.ts, `isBlockedAddress`)
 * and the justification was that an attacker needs to control both a domain's
 * DNS *and* Greg's clipboard. Fetching an article's own images ends that
 * argument: the URLs come from the page, so the publisher chooses them, and
 * there may be hundreds. GPT Sol, 2026-08-29 —
 * docs/plans/260829b-hosting-the-articles-images.md.
 *
 * The three layers below are deliberately not one test. Layer 1 proves the
 * mechanism really redirects a connection, against a real socket, because a
 * dispatcher that silently did nothing would leave every other assertion here
 * passing. Layer 2 proves the mechanism is actually wired into the fetch. Layer
 * 3 proves it pins the *checked* answer rather than asking again.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fetchDocument, pinnedAgent } from "../src/fetch.js";

/** A public address, used as the answer a guard would approve. */
const PUBLIC_IP = "93.184.216.34";

/* ------------------------------------------------------------------ *
 * Layer 1 — the mechanism, against a real socket
 * ------------------------------------------------------------------ */

describe("pinnedAgent", () => {
  let server: Server;
  let port = 0;
  let hits: { host: string | undefined; url: string | undefined }[] = [];

  beforeEach(async () => {
    hits = [];
    server = createServer((req, res) => {
      hits.push({ host: req.headers.host, url: req.url });
      res.end("ok");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((done) => {
      server.close(() => done());
    });
  });

  it("sends the connection to the pinned address, not to DNS", async () => {
    const agent = pinnedAgent(new Map([["example.com", ["127.0.0.1"]]]));
    try {
      const res = await fetch(`http://example.com:${port}/pinned`, {
        dispatcher: agent,
      } as RequestInit);
      expect(await res.text()).toBe("ok");
    } finally {
      await agent.close();
    }

    expect(hits).toHaveLength(1);
    /* The whole point: the socket went to 127.0.0.1, and the request still
       claims to be for example.com. If the Host header were rewritten to the
       address, every virtual host on the internet would answer the wrong site,
       and TLS would fail its certificate check for the same reason. */
    expect(hits[0]?.host).toBe(`example.com:${port}`);
    expect(hits[0]?.url).toBe("/pinned");
  });

  it("is the dispatcher doing it — the same request without one does not arrive", async () => {
    /* The control. Without this, the assertion above is equally consistent with
       "example.com happens to resolve to 127.0.0.1 in this environment", and
       the test would pass with `pinnedAgent` returning a plain Agent.
       docs/reusable/silent-success.md. */
    await expect(
      fetch(`http://example.com:${port}/unpinned`, { signal: AbortSignal.timeout(3000) }),
    ).rejects.toThrow();
    expect(hits).toHaveLength(0);
  });

  it("refuses a hostname nobody checked", async () => {
    /* Defence in depth. A redirect that reached the socket without passing
       `guardAddress` is a bug somewhere above; it must not become a request. */
    const agent = pinnedAgent(new Map([["example.com", ["127.0.0.1"]]]));
    try {
      await expect(
        fetch(`http://other.example:${port}/`, { dispatcher: agent } as RequestInit),
      ).rejects.toThrow();
    } finally {
      await agent.close();
    }
    expect(hits).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Layers 2 and 3 — the wiring, and the rebind it exists to stop
 * ------------------------------------------------------------------ */

describe("fetchDocument pins what it checked", () => {
  /** Capture the dispatcher handed to fetch, per hop. */
  function capturing(): {
    calls: { url: string; agent: unknown }[];
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  } {
    const calls: { url: string; agent: unknown }[] = [];
    return {
      calls,
      fetchImpl: async (url, init) => {
        calls.push({ url, agent: (init as { dispatcher?: unknown }).dispatcher });
        return new Response("<html><body><p>hello</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    };
  }

  it("passes a dispatcher on every hop", async () => {
    const { calls, fetchImpl } = capturing();
    await fetchDocument("https://example.com/a", {
      fetchImpl,
      resolve: async () => [PUBLIC_IP],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.agent).toBeDefined();
  });

  it("pins the address the guard approved, not one asked for later", async () => {
    /* The rebind, in the only form a test can stage: the resolver's answer
       changes after the guard has accepted it. `guardAddress` sees a public
       address and allows the fetch; anything that resolves again gets loopback.
       The pinned map must still hold the approved answer.

       Breaking the implementation so the lookup calls `opts.resolve` at connect
       time — the obvious "simplification" — turns this red. */
    let answered = 0;
    const { calls, fetchImpl } = capturing();
    await fetchDocument("https://example.com/a", {
      fetchImpl,
      resolve: async () => {
        answered += 1;
        return answered === 1 ? [PUBLIC_IP] : ["127.0.0.1"];
      },
    });

    expect(answered).toBe(1);
    const agent = calls[0]?.agent as { pinned?: Map<string, readonly string[]> };
    expect(agent?.pinned?.get("example.com")).toEqual([PUBLIC_IP]);
  });

  it("re-guards and re-pins across a redirect to another host", async () => {
    const seen: string[] = [];
    const calls: { url: string; agent: unknown }[] = [];
    let hop = 0;
    await fetchDocument("https://example.com/a", {
      resolve: async (hostname) => {
        seen.push(hostname);
        return [PUBLIC_IP];
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, agent: (init as { dispatcher?: unknown }).dispatcher });
        hop += 1;
        if (hop === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://elsewhere.example/b" },
          });
        }
        return new Response("<html><body><p>hi</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    });

    expect(seen).toEqual(["example.com", "elsewhere.example"]);
    const second = calls[1]?.agent as { pinned?: Map<string, readonly string[]> };
    /* Both hosts in one attempt's map, because one agent serves the whole
       redirect chain — but the second host is there because it was *guarded*,
       not because it was followed. */
    expect(second?.pinned?.get("elsewhere.example")).toEqual([PUBLIC_IP]);
  });

  it("still refuses a private answer, and never builds a dispatcher for it", async () => {
    const { calls, fetchImpl } = capturing();
    await expect(
      fetchDocument("https://example.com/a", {
        fetchImpl,
        resolve: async () => ["127.0.0.1"],
      }),
    ).rejects.toMatchObject({ code: "blocked-address" });
    expect(calls).toHaveLength(0);
  });

  it("needs no dispatcher when the host is already a literal address", async () => {
    const { calls, fetchImpl } = capturing();
    await fetchDocument("https://93.184.216.34/a", {
      fetchImpl,
      resolve: async () => {
        throw new Error("resolve must not be called for a literal IP");
      },
    });
    expect(calls).toHaveLength(1);
  });
});
