/**
 * **A DOI in a doi.org address names that DOI and no other** —
 * docs/plans/261004j-encode-dois-in-link-addresses.md (qi-thwhkxxh).
 *
 * The check is a round trip through `identityOf`, the one parser of an
 * identifier out of an address, and through the browser's own URL parser.
 */
import { describe, expect, it } from "vitest";

import { identityOf } from "../src/cited-in-spideryarn.js";
import { doiOfUrl, doiPath, doiUrl } from "../src/doi-url.js";

describe("doiUrl", () => {
  it("leaves an ordinary DOI exactly as it is written, so a stored link does not change", () => {
    for (const doi of [
      "10.1038/nn.4450",
      "10.1140/epje/i2004-10074-4",
      /* Colon, parentheses, plus and semicolon are preserved. Square brackets are encoded. */
      "10.1023/A:1010933404324",
      "10.1016/S0140-6736(20)30183-5",
      "10.1002/1097-0142(197901)43:1+;2-2",
    ]) {
      expect(doiUrl(doi)).toBe(`https://doi.org/${doi}`);
    }
  });

  it("encodes what would change which work the address names", () => {
    expect(doiUrl("10.1234/a%2Fb")).toBe("https://doi.org/10.1234/a%252Fb");
    expect(doiUrl("10.1234/a\\b")).toBe("https://doi.org/10.1234/a%5Cb");
    expect(doiUrl("10.1234/a?b=c#d")).toBe("https://doi.org/10.1234/a%3Fb=c%23d");
    expect(doiUrl("10.1234/a[1]")).toBe("https://doi.org/10.1234/a%5B1%5D");
  });

  it("respells the square brackets in a real BioScience DOI while keeping its identity", () => {
    /* The Rise of the Concept of Scale in Ecology, BioScience 51(7), 2001. */
    const doi = "10.1641/0006-3568(2001)051[0545:TROTCO]2.0.CO;2";
    expect(doiUrl(doi)).toBe("https://doi.org/10.1641/0006-3568(2001)051%5B0545:TROTCO%5D2.0.CO;2");
    expect(identityOf(doiUrl(doi)).doi).toBe(doi.toLowerCase());
    expect(doiOfUrl(doiUrl(doi))).toBe(doi);
  });

  it("round-trips through identityOf, dot segments included", () => {
    for (const doi of [
      "10.1234/a%2fb",
      "10.1234/a%b",
      "10.1234/a\\b",
      "10.1234/a/../x",
      "10.1234/../x",
      "10.1234/a/.",
      "10.1234/a/..",
      "10.1234/a/./b",
      "10.1234/a[1]{2}|^`",
      "10.1234/a/",
      "10.1234/a//b/",
      "10.1234/.././../x",
      "10.1234/a/%2e%2e/x",
      "10.1234/Éİ日本語😀",
      ...Array.from({ length: 160 }, (_, code) => `10.1234/a${String.fromCharCode(code)}b`)
        .filter((doi) => /^10\.\d{4,9}\/[^\s"'<>?#]+$/.test(doi)),
    ]) {
      const url = doiUrl(doi);
      expect(new URL(url).hostname).toBe("doi.org");
      expect(identityOf(url).doi).toBe(doi.toLowerCase());
      expect(identityOf(new URL(url).href).doi).toBe(doi.toLowerCase());
      expect(doiOfUrl(url)).toBe(doi);
    }
  });

  it("refuses malformed Unicode instead of silently naming a different DOI", () => {
    for (const doi of ["10.1234/a\uD800b", "10.1234/a\uDC00b"]) {
      expect(() => doiUrl(doi)).toThrow(URIError);
    }
  });
});

describe("doiOfUrl", () => {
  it("reads a link stored before DOIs were encoded as it was written", () => {
    expect(doiOfUrl("https://doi.org/10.1023/A:1010933404324")).toBe("10.1023/A:1010933404324");
    expect(doiOfUrl("https://doi.org/10.1234/a%b")).toBe("10.1234/a%b");
  });

  it("decodes legacy valid escapes once, while malformed escapes keep the whole path literal", () => {
    expect(doiOfUrl("https://doi.org/10.1234/a%2Fb")).toBe("10.1234/a/b");
    expect(doiOfUrl("https://doi.org/10.1234/a%41b")).toBe("10.1234/aAb");
    expect(doiOfUrl("https://doi.org/10.1234/a%25b")).toBe("10.1234/a%b");
    expect(doiOfUrl("https://doi.org/10.1234/a%2Fb%zz")).toBe("10.1234/a%2Fb%zz");
  });

  it("is null for an address that is not a doi.org one", () => {
    expect(doiOfUrl("https://example.org/10.1234/a")).toBeNull();
  });
});

describe("doiPath", () => {
  it("encodes each segment for a registry's API and keeps the slashes", () => {
    expect(doiPath("10.1234/a%2Fb/c:d")).toBe("10.1234/a%252Fb/c%3Ad");
  });

  it("keeps dot segments opaque after a registry address is parsed", () => {
    for (const doi of ["10.1234/../x", "10.1234/a/../x", "10.1234/a/.", "10.1234/a/.."]) {
      const url = new URL(`https://api.crossref.org/works/${doiPath(doi)}`);
      expect(decodeURIComponent(url.pathname.slice("/works/".length))).toBe(doi);
    }
  });
});
