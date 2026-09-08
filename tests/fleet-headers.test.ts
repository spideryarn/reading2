/**
 * The security headers, and the two directives that are load-bearing.
 *
 * These are asserted as *content*, not merely as presence. A CSP header that
 * exists and permits everything is worse than none, because it looks like a
 * control in every audit that greps for the header name.
 */
import { describe, expect, it } from "vitest";

import { CSP, SECURITY_HEADERS, applySecurityHeaders } from "../tools/fleet/headers.js";

/** The parts of `ServerResponse` this touches, and nothing else. */
function fakeRes(): { headers: Record<string, string>; setHeader(n: string, v: string): void } {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (n, v) => void (headers[n] = v) };
}

/** `"script-src 'self'"` → the directive's value, or null if it is absent. */
function directive(name: string): string | null {
  const found = CSP.split("; ").find((d) => d === name || d.startsWith(`${name} `));
  if (found === undefined) return null;
  return found.slice(name.length).trim();
}

describe("the content security policy", () => {
  it("denies by default, so a directive nobody wrote is a refusal", () => {
    expect(directive("default-src")).toBe("'none'");
  });

  it("refuses to be framed — the hole an Origin check cannot close", () => {
    // A malicious page embeds the real dashboard and gets somebody to click
    // through it. Every request that results is same-origin and correctly
    // signed, because it genuinely is the dashboard making it. This is the one
    // directive that stops it, and `X-Frame-Options` says it again for anything
    // that predates CSP.
    expect(directive("frame-ancestors")).toBe("'none'");
    expect(SECURITY_HEADERS["x-frame-options"]).toBe("DENY");
  });

  it("permits no inline script and no eval, which is the point of having it", () => {
    // The layer that assumes the escaping failed. Script running in this origin
    // defeats every CSRF protection in the tool by construction, because it IS
    // the origin — so `script-src` is where an XSS stops being fatal.
    const script = directive("script-src");
    expect(script).toBe("'self'");
    expect(CSP).not.toContain("unsafe-eval");
  });

  it("allows inline style ATTRIBUTES but not inline style BLOCKS", () => {
    // React writes `style="..."` for measured layout, so the attribute form has
    // to be permitted. The block form does not, and it is the one an injection
    // reaches for. Splitting the directives is the whole reason both are here —
    // a single `style-src 'unsafe-inline'` would permit both and look identical
    // in a header dump.
    expect(directive("style-src")).toBe("'self'");
    expect(directive("style-src-attr")).toBe("'unsafe-inline'");
  });

  it("pins the base URI and the form action, which retarget everything else", () => {
    // An injected `<base>` retargets every relative URL on the page, including
    // the ones the write routes are posted to. `form-action` is the same idea
    // for a submit.
    expect(directive("base-uri")).toBe("'none'");
    expect(directive("form-action")).toBe("'none'");
  });

  it("does not upgrade to https, which would break the page rather than secure it", () => {
    // Served over plain HTTP on a tailnet address. The transport is Tailscale's.
    expect(directive("upgrade-insecure-requests")).toBeNull();
    // And the positive half, so this cannot pass by the whole policy vanishing.
    expect(directive("connect-src")).toBe("'self'");
  });
});

describe("applySecurityHeaders", () => {
  it("sets every header on the response, before anything routes", () => {
    const res = fakeRes();
    applySecurityHeaders(res as never);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[name]).toBe(value);
    }
    // Positively: it set something, so the loop above cannot pass vacuously on
    // an empty SECURITY_HEADERS.
    expect(Object.keys(res.headers).length).toBeGreaterThanOrEqual(5);
  });

  it("stops a browser sniffing an unrecognised file as HTML", () => {
    // `serveStatic` serves by extension and falls back to
    // application/octet-stream for anything TYPES does not know. Without
    // nosniff a browser may decide for itself that such a file is HTML — in an
    // origin that can type into agent sessions.
    expect(SECURITY_HEADERS["x-content-type-options"]).toBe("nosniff");
  });

  it("has no microphone permission yet, and that is deliberate", () => {
    // Voice dictation is a planned stage (Greg, 2026-09-08). When it lands,
    // `microphone=(self)` goes in on purpose rather than being discovered by
    // the feature silently not working.
    expect(SECURITY_HEADERS["permissions-policy"]).toContain("microphone=()");
  });
});
