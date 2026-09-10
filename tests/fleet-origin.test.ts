/**
 * The origin policy, and the fact that BOTH write routes apply it.
 *
 * This file exists because they did not. `routes-steer.ts` and `routes-new.ts`
 * were built in parallel by two agents; each wrote its own origin check; they
 * agreed on the easy half and disagreed on the half that matters. The route
 * that can type into a live session refused a rebound hostname and the route
 * that can start a new agent accepted it — the wrong way round of a distinction
 * that should not have existed at all.
 *
 * So the assertions below are deliberately made against **both routes' public
 * entry points**, not against the shared predicate alone. A test of
 * `addressableHost` would have passed on the day the bug existed, because the
 * function was there and one caller simply did not call it. The unit is not the
 * thing that was broken; the wiring was.
 */
import { describe, expect, it } from "vitest";

import { addressableHost } from "../tools/fleet/origin.js";
import { checkRequest } from "../tools/fleet/routes-new.js";
import { checkOrigin } from "../tools/fleet/routes-steer.js";

/** Headers a browser really sends on a same-origin JSON POST. */
function headers(over: Record<string, string> = {}): Record<string, string> {
  return {
    host: "100.92.255.119:8787",
    origin: "http://100.92.255.119:8787",
    "content-type": "application/json",
    ...over,
  };
}

/**
 * The rebinding attack, as headers.
 *
 * A page at `evil.example` whose DNS re-resolves to this box. Note that `Host`
 * and `Origin` AGREE — that is the whole trick, and it is why a same-origin
 * comparison is not enough on its own.
 */
const REBOUND = headers({ host: "evil.example", origin: "http://evil.example" });

describe("addressableHost", () => {
  it("accepts the names this dashboard is actually reached by", () => {
    expect(addressableHost("127.0.0.1")).toBe(true);
    expect(addressableHost("100.92.255.119")).toBe(true);
    expect(addressableHost("localhost")).toBe(true);
    expect(addressableHost("my-box.tail1234.ts.net")).toBe(true);
    expect(addressableHost("::1")).toBe(true);
  });

  it("refuses a hostname, however plausible", () => {
    for (const h of ["evil.example", "spideryarn.com", "ts.net.evil.example", "localhost.evil.example"]) {
      expect(addressableHost(h)).toBe(false);
    }
  });

  it("accepts the MagicDNS short name, and only a real single label", () => {
    // What a phone on the tailnet may have bookmarked. A rebinding attacker
    // needs a name they control in public DNS, and every one has a dot.
    expect(addressableHost("spideryarn-box")).toBe(true);
    expect(addressableHost("SPIDERYARN-BOX")).toBe(true);
    // The rule is "one DNS label", not "no dot": each of these is refused.
    for (const h of ["", "evil.", ".", "-box", "box-", "spideryarn_box", "box!", "b ox", "evil.example", "localhost.evil.example"]) {
      expect(addressableHost(h), JSON.stringify(h)).toBe(false);
    }
  });

  it("is not fooled by case or by IPv6 brackets", () => {
    expect(addressableHost("LOCALHOST")).toBe(true);
    expect(addressableHost("[::1]")).toBe(true);
    expect(addressableHost("EVIL.EXAMPLE")).toBe(false);
  });
});

describe("both write routes apply it — the wiring, not the predicate", () => {
  it("the steering route refuses a rebound origin", () => {
    const v = checkOrigin(REBOUND);
    expect(v.ok).toBe(false);
    // Asserted positively as well as negatively: `not.toBe(true)` would also be
    // satisfied by the function returning undefined, or by the check being
    // removed and the verdict never being produced.
    if (!v.ok) expect(v.why).toMatch(/not reached by the name/);
  });

  it("the new-session route refuses a rebound origin — THIS was the gap", () => {
    // It passed the same-origin comparison here for the whole of 2026-09-08,
    // and `sec-fetch-site` did not help: the browser genuinely believes a
    // rebound request is same-origin, because by its own lights it is.
    const v = checkRequest(REBOUND);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(403);
      expect(v.why).toMatch(/not reached by the name/);
    }
  });

  it("both still accept a real same-origin request", () => {
    // The other half of every refusal test, and the one that stops this file
    // passing by refusing everything.
    expect(checkOrigin(headers()).ok).toBe(true);
    expect(checkRequest(headers()).ok).toBe(true);
  });

  it("both refuse a missing Origin, and a literal 'null' one", () => {
    for (const origin of ["", "null"]) {
      const h = headers({ origin });
      expect(checkOrigin(h).ok).toBe(false);
      expect(checkRequest(h).ok).toBe(false);
    }
  });
});
