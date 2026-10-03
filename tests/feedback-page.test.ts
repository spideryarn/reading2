/**
 * The page label the Earlier tab shows — src/feedback-page.ts.
 * docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.
 */
import { describe, expect, it } from "vitest";
import { feedbackPageLabel } from "../src/feedback-page.js";

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

  it("is null when there is no address, or it is not a web address", () => {
    expect(feedbackPageLabel(null)).toBeNull();
    expect(feedbackPageLabel("")).toBeNull();
    expect(feedbackPageLabel("not a url")).toBeNull();
    expect(feedbackPageLabel("javascript:alert(1)")).toBeNull();
    expect(feedbackPageLabel("file:///etc/passwd")).toBeNull();
  });
});
