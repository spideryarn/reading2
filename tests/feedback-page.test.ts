/**
 * The page label the Earlier tab shows — src/feedback-page.ts.
 * docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.
 */
import { describe, expect, it } from "vitest";
import { feedbackPageAt, feedbackPageLabel } from "../src/feedback-page.js";
import { parseRoute, type Route } from "../src/web/router.js";

/**
 * **A path for every kind of page the router knows**, and the type is the
 * point: add a `Route` kind and this is a compile error until it has a sample,
 * at which moment the test below asks whether src/feedback-page.ts's own list
 * knows the page too. That file cannot import the router (it is server code,
 * the router imports React), so this is what holds the two lists together.
 */
const SAMPLES: Record<Route["kind"], readonly string[]> = {
  library: ["/", "/index.html", "/add", "/add/"],
  read: ["/read/why-trees-spya-k3m9qt", "/read/why-trees-spya-k3m9qt/", "/read/why-trees-spya-k3m9qt/metadata"],
  "public-library": ["/read/public", "/read/public/"],
  add: ["/add/https://example.com/a", "/add/not a url"],
  "add-upload": ["/add/upload/5c69fb43-2560-4fc9-af88-558702dd35dc"],
  design: ["/design", "/design/"],
  profile: ["/profile"],
  login: ["/login"],
  admin: [
    "/admin",
    "/admin/",
    "/admin/users",
    "/admin/feedback",
    "/admin/vouchers",
    "/admin/vouchers/",
    "/admin/costs",
    "/admin/costs/",
  ],
  privacy: ["/privacy"],
  features: ["/features"],
  "public-sharing": ["/features/public-readable-sharing"],
  pricing: ["/pricing"],
  contact: ["/contact"],
  changelog: ["/changelog"],
  /* A page of Help, and an address under it that names none: the router
     gives Help both, and Help draws its contents at the second. */
  help: ["/help", "/help/", "/help/spine", "/help/spine/", "/help/questions", "/help/nonsense"],
  opensource: ["/opensource"],
  callback: ["/auth/callback"],
  "not-found": [
    "/nope",
    "/admin/secrets",
    "/read",
    "/read/Upper",
    "/read/a-piece/metadata/more",
    "/read//a-piece",
    "/reset/a-secret-token",
    "/features/unknown",
    "/help/a/b",
  ],
};

describe("the page list and the router agree", () => {
  for (const [kind, paths] of Object.entries(SAMPLES)) {
    for (const path of paths) {
      it(`${kind}: ${path}`, () => {
        /* The sample is really of the kind it is filed under — or this table
           would go on passing while describing some other router. */
        expect(parseRoute(new URL(path, "https://www.spideryarn.com").pathname).kind).toBe(kind);
        const label = feedbackPageLabel(`https://www.spideryarn.com${path}`);
        if (kind === "not-found") expect(label).toBeNull();
        else expect(label).not.toBeNull();
      });
    }
  }
});

describe("feedbackPageLabel", () => {
  it("is the path of the page, without the origin", () => {
    expect(feedbackPageLabel("https://www.spideryarn.com/admin/vouchers")).toBe("/admin/vouchers");
    expect(feedbackPageLabel("https://www.spideryarn.com/read/why-trees-spya-k3m9qt/metadata")).toBe(
      "/read/why-trees-spya-k3m9qt/metadata",
    );
    expect(feedbackPageLabel("http://localhost:5273/")).toBe("/");
  });

  it("drops the query string and the fragment, which is where search terms live", () => {
    expect(
      feedbackPageLabel(
        "https://www.spideryarn.com/read/why-trees-spya-k3m9qt?mode=search&q=my+private+search#spya-abc123",
      ),
    ).toBe("/read/why-trees-spya-k3m9qt");
  });

  it("says only /add for an import, whose path is somebody else's address or an upload's id", () => {
    expect(feedbackPageLabel("https://www.spideryarn.com/add/https://user:secret@example.com/a?token=abc")).toBe(
      "/add",
    );
    expect(feedbackPageLabel("https://www.spideryarn.com/add/upload/5c69fb43-2560-4fc9-af88-558702dd35dc")).toBe(
      "/add",
    );
    expect(feedbackPageLabel("https://www.spideryarn.com/add")).toBe("/add");
  });

  /* A report filed from a page of Help says it came from Help, and not which
     page: the segment is whatever was typed after `/help/`, and Help draws
     itself there whether or not it names anything, so it is somebody's
     arbitrary text exactly as an unrecognised path is. GPT Sol, plan review
     of 261007e, R2. */
  it("says only /help for any page of Help, real or not, and never the segment", () => {
    expect(feedbackPageLabel("https://www.spideryarn.com/help")).toBe("/help");
    expect(feedbackPageLabel("https://www.spideryarn.com/help/spine")).toBe("/help");
    expect(feedbackPageLabel("https://www.spideryarn.com/help/questions#faq-older-profile")).toBe("/help");
    expect(feedbackPageLabel("https://www.spideryarn.com/help/nonsense")).toBe("/help");
    expect(feedbackPageLabel("https://www.spideryarn.com/help/a-secret-token/")).toBe("/help");
    expect(feedbackPageLabel("https://www.spideryarn.com/help/a/b")).toBeNull();
    expect(feedbackPageLabel("https://www.spideryarn.com/helpful")).toBeNull();
  });

  /* GPT Sol's plan review, P1: a reader can file from any address, and the
     route takes any http(s) origin, so a path the app does not have is
     somebody's arbitrary text. */
  it("is null for a path the router does not recognise, whatever the origin", () => {
    expect(feedbackPageLabel("https://www.spideryarn.com/reset/a-secret-token")).toBeNull();
    expect(feedbackPageLabel("https://www.spideryarn.com/address")).toBeNull();
    expect(feedbackPageLabel("https://elsewhere.test/token/abc")).toBeNull();
    expect(feedbackPageLabel("https://www.spideryarn.com/read/Not_A_Slug")).toBeNull();
    expect(feedbackPageLabel(`https://www.spideryarn.com/read/${"a".repeat(400)}`)).toBeNull();
  });

  it("rebuilds an article's path from the decoded slug, so an encoded spelling does not survive", () => {
    expect(feedbackPageLabel("https://www.spideryarn.com/read/%61-piece/metadata/")).toBe("/read/a-piece/metadata");
    expect(feedbackPageLabel("https://www.spideryarn.com/read/%zz")).toBeNull();
    expect(feedbackPageLabel("https://www.spideryarn.com/read/a%2Fb")).toBeNull();
  });

  it("is null when there is no address, or it is not a web address", () => {
    expect(feedbackPageLabel(null)).toBeNull();
    expect(feedbackPageLabel("")).toBeNull();
    expect(feedbackPageLabel("not a url")).toBeNull();
    expect(feedbackPageLabel("javascript:alert(1)")).toBeNull();
    expect(feedbackPageLabel("file:///etc/passwd")).toBeNull();
  });
});

/* docs/plans/261006b-earlier-link-carries-the-paragraph.md. */
describe("feedbackPageAt", () => {
  const READ = "https://www.spideryarn.com/read/why-trees-spya-k3m9qt";

  it("is the block id the reading page was at", () => {
    expect(feedbackPageAt(`${READ}?at=spya-tgnssb`)).toBe("spya-tgnssb");
    expect(feedbackPageAt(`${READ}/?mode=glossary&at=spya-tgnssb`)).toBe("spya-tgnssb");
    expect(feedbackPageAt("http://localhost:5273/read/%61-piece?at=spya-tgnssb")).toBe("spya-tgnssb");
  });

  it("takes at and nothing else from the query or the fragment", () => {
    expect(feedbackPageAt(`${READ}?mode=search&q=my+private+search&at=spya-tgnssb#spya-abc234`)).toBe("spya-tgnssb");
    expect(feedbackPageAt(`${READ}?mode=search&q=spya-tgnssb#spya-abc234`)).toBeNull();
    expect(feedbackPageAt(`${READ}#at=spya-tgnssb`)).toBeNull();
  });

  it("is null when there is no at, or it is empty", () => {
    expect(feedbackPageAt(READ)).toBeNull();
    expect(feedbackPageAt(`${READ}?at=`)).toBeNull();
    expect(feedbackPageAt(`${READ}?at`)).toBeNull();
  });

  /* A block id is one fixed shape (src/ids.ts), and anything else is
     somebody's text. */
  it.each([
    "spya-tgnssb0",
    "spya-tgnss",
    "SPYA-TGNSSB",
    "spya-3gnssb",
    "spya-tgnsso",
    "tgnssb",
    "spya-tgnssb%20private+words",
    "spya-tgnssb%0A",
    "%20spya-tgnssb",
    "/read/elsewhere",
    "%3Cscript%3E",
    "https://elsewhere.example/",
  ])("is null for an at that is not a block id: %s", (bad) => {
    expect(feedbackPageAt(`${READ}?at=${bad}`)).toBeNull();
  });

  it("goes by the first at when it is repeated", () => {
    expect(feedbackPageAt(`${READ}?at=spya-tgnssb&at=spya-k3m9qt`)).toBe("spya-tgnssb");
    expect(feedbackPageAt(`${READ}?at=private+words&at=spya-k3m9qt`)).toBeNull();
  });

  it("is null on every page but an article's reading page", () => {
    expect(feedbackPageAt(`${READ}/metadata?at=spya-tgnssb`)).toBeNull();
    expect(feedbackPageAt("https://www.spideryarn.com/read/public?at=spya-tgnssb")).toBeNull();
    expect(feedbackPageAt("https://www.spideryarn.com/profile?at=spya-tgnssb")).toBeNull();
    expect(feedbackPageAt("https://www.spideryarn.com/?at=spya-tgnssb")).toBeNull();
    expect(feedbackPageAt("https://www.spideryarn.com/add/https://example.com/a?at=spya-tgnssb")).toBeNull();
    expect(feedbackPageAt("https://www.spideryarn.com/reset/a-secret-token?at=spya-tgnssb")).toBeNull();
    expect(feedbackPageAt("https://www.spideryarn.com/read/Not_A_Slug?at=spya-tgnssb")).toBeNull();
  });

  it("is null when there is no address, or it is not a web address", () => {
    expect(feedbackPageAt(null)).toBeNull();
    expect(feedbackPageAt("")).toBeNull();
    expect(feedbackPageAt("not a url?at=spya-tgnssb")).toBeNull();
    expect(feedbackPageAt("javascript:alert(1)?at=spya-tgnssb")).toBeNull();
  });
});
