/**
 * The page label the Earlier tab shows — src/feedback-page.ts.
 * docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.
 */
import { describe, expect, it } from "vitest";
import { feedbackPageLabel } from "../src/feedback-page.js";
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
  help: ["/help"],
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
    "/help/extra",
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
