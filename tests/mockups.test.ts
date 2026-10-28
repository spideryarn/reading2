/**
 * **A mockup file, and the directory of them** — src/mockups.ts's rules, and
 * src/mockups-dir.ts's reading of `docs/mockups/` against them, including the
 * real directory, so a mockup that would be left off `/admin/mockups` fails
 * here before it is deployed. Plan 261028b, Stage 3. No database.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isMockupId,
  MAX_MOCKUP_BODY_CHARS,
  MAX_MOCKUP_IMAGE_BYTES,
  MAX_MOCKUP_IMAGES_TOTAL_BYTES,
  mintMockupId,
  mockupImageType,
  newMockup,
  parseMockupFile,
} from "../src/mockups.js";
import { readMockupDirectory, readMockupImage, readOneMockup } from "../src/mockups-dir.js";

const ID = "m-k3m9qt";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function file(over: Partial<Record<"id" | "title" | "made" | "question" | "report", string>> = {}, body = "Some words.") {
  const h = { id: ID, title: "A title", made: "2026-10-28", question: "none", report: "none", ...over };
  return `---\nid: ${h.id}\ntitle: ${h.title}\nmade: ${h.made}\nquestion: ${h.question}\nreport: ${h.report}\n---\n${body}\n`;
}

describe("a mockup id", () => {
  it("is m- and the six characters of a report id", () => {
    expect(isMockupId("m-k3m9qt")).toBe(true);
    expect(isMockupId("q-k3m9qt")).toBe(false);
    expect(isMockupId("m-k3m9q")).toBe(false);
    expect(isMockupId("m-K3M9QT")).toBe(false);
    expect(isMockupId("m-3m9qtk")).toBe(false); // the first is a letter, as a report id's is
    expect(isMockupId("m-k3m9qt/../x")).toBe(false);
    expect(isMockupId(42)).toBe(false);
    for (let i = 0; i < 50; i++) expect(isMockupId(mintMockupId())).toBe(true);
  });
});

describe("parseMockupFile", () => {
  it("reads the header, and none as null", () => {
    const parsed = parseMockupFile(`${ID}.md`, file({ question: "q-cgpett", report: "spya-zytb0g" }));
    expect(parsed).toEqual({
      id: ID,
      title: "A title",
      made: "2026-10-28",
      question: "q-cgpett",
      report: "spya-zytb0g",
      body: [{ kind: "text", text: "Some words." }],
      images: [],
    });
    const none = parseMockupFile(`${ID}.md`, file());
    expect(typeof none === "string" ? none : [none.question, none.report]).toEqual([null, null]);
  });

  it("splits the body at image lines outside a fence, and leaves one inside a fence as text", () => {
    const body = [
      "Before.",
      `image: ${ID}-one.png`,
      "Between.",
      "```",
      `image: ${ID}-not-an-image.png`,
      "  +--+",
      "```",
      `image: ${ID}-two.webp`,
    ].join("\n");
    const parsed = parseMockupFile(`${ID}.md`, file({}, body));
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.images).toEqual([`${ID}-one.png`, `${ID}-two.webp`]);
    expect(parsed.body).toEqual([
      { kind: "text", text: "Before." },
      { kind: "image", index: 0 },
      { kind: "text", text: `Between.\n\`\`\`\nimage: ${ID}-not-an-image.png\n  +--+\n\`\`\`` },
      { kind: "image", index: 1 },
    ]);
  });

  it("normalises CRLF", () => {
    const parsed = parseMockupFile(`${ID}.md`, file().replace(/\n/g, "\r\n"));
    expect(typeof parsed).not.toBe("string");
  });

  const refusals: [string, string, RegExp][] = [
    ["no header", "Just words.\n", /header/],
    ["an unclosed header", "---\nid: m-k3m9qt\n", /never closed/],
    ["an unknown field", file().replace("title:", "extra: x\ntitle:"), /unknown header field/],
    ["a duplicate field", file().replace("title:", "title: again\ntitle:"), /duplicate/],
    ["a missing field", file().replace(/^made: .*\n/m, ""), /missing header field\(s\): made/],
    ["a bad id", file({ id: "m-nope" }), /id must be/],
    ["a name that is not the id", file({ id: "m-k3m9qa" }), /named for its id/],
    ["a long title", file({ title: "x".repeat(121) }), /title/],
    ["a bad date", file({ made: "28/10/2026" }), /made must be/],
    ["an impossible date", file({ made: "2026-02-30" }), /made must be/],
    ["a bad question", file({ question: "spya-k3m9qt" }), /question must be/],
    ["a bad report", file({ report: "q-cgpett" }), /report must be/],
    ["an empty body", file({}, "   "), /says nothing/],
    ["a long body", file({}, "x".repeat(MAX_MOCKUP_BODY_CHARS + 1)), /at most/],
    ["an unclosed fence", file({}, "```\n+--+\n"), /fence/],
    ["an image line with a path", file({}, `image: ../${ID}-x.png`), /image/],
    ["another mockup's image", file({}, "image: m-aaaaaa-x.png"), /must start with m-k3m9qt-/],
    ["an image of another type", file({}, `image: ${ID}-x.svg`), /png/],
    ["a near-miss image line", file({}, `image:${ID}-x.png`), /image: <file>/],
  ];
  for (const [what, text, says] of refusals) {
    it(`refuses ${what}`, () => {
      const parsed = parseMockupFile(`${ID}.md`, text);
      expect(typeof parsed, what).toBe("string");
      expect(parsed).toMatch(says);
    });
  }
});

describe("mockupImageType", () => {
  it("is an allowlist by extension", () => {
    expect(mockupImageType("a.png")).toBe("image/png");
    expect(mockupImageType("a.JPG")).toBe(null);
    expect(mockupImageType("a.jpg")).toBe("image/jpeg");
    expect(mockupImageType("a.jpeg")).toBe("image/jpeg");
    expect(mockupImageType("a.webp")).toBe("image/webp");
    expect(mockupImageType("a.svg")).toBe(null);
    expect(mockupImageType("a.html")).toBe(null);
  });
});

describe("newMockup", () => {
  it("prints a header that parses, and creates nothing", () => {
    const made = newMockup("Example", new Set(), new Date("2026-10-28T12:00:00Z"));
    const name = path.basename(made.path);
    expect(made.path).toMatch(/^docs\/mockups\/m-[a-z0-9]{6}\.md$/);
    const parsed = parseMockupFile(name, made.text);
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.made).toBe("2026-10-28");
    expect(parsed.title).toBe("Example");
  });
  it("refuses a title that is blank or too long", () => {
    expect(() => newMockup(" ", new Set())).toThrow();
    expect(() => newMockup("x".repeat(121), new Set())).toThrow();
  });
});

describe("the directory", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mockups-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is an empty list when it does not exist", async () => {
    const read = await readMockupDirectory(path.join(dir, "absent"), { checkContent: true });
    expect(read).toEqual({ mockups: [], problems: [] });
    expect(await readOneMockup(path.join(dir, "absent"), ID)).toBe(null);
  });

  it("reads a good mockup and its image, and leaves a bad one out with a problem", async () => {
    writeFileSync(path.join(dir, `${ID}.md`), file({}, `Words.\nimage: ${ID}-a.png`));
    writeFileSync(path.join(dir, `${ID}-a.png`), PNG);
    writeFileSync(path.join(dir, "m-aaaaaa.md"), file({ id: "m-aaaaaa", made: "nope" }));
    const read = await readMockupDirectory(dir, { checkContent: true });
    expect(read.mockups.map((m) => m.id)).toEqual([ID]);
    expect(read.problems).toEqual([{ file: "m-aaaaaa.md", problem: expect.stringMatching(/made must be/) }]);
    const one = await readOneMockup(dir, ID);
    if (one === null || typeof one === "string") throw new Error(String(one));
    const image = await readMockupImage(dir, one, 0);
    expect(image).toEqual({ bytes: new Uint8Array(PNG), contentType: "image/png" });
    expect(await readMockupImage(dir, one, 1)).toBe(null);
  });

  it("sorts newest first, then by id", async () => {
    writeFileSync(path.join(dir, "m-aaaaaa.md"), file({ id: "m-aaaaaa", made: "2026-10-01" }));
    writeFileSync(path.join(dir, "m-bbbbbb.md"), file({ id: "m-bbbbbb", made: "2026-10-20" }));
    writeFileSync(path.join(dir, "m-cccccc.md"), file({ id: "m-cccccc", made: "2026-10-20" }));
    const read = await readMockupDirectory(dir, { checkContent: true });
    expect(read.mockups.map((m) => m.id)).toEqual(["m-bbbbbb", "m-cccccc", "m-aaaaaa"]);
  });

  it("refuses a missing image, an oversized one and one whose bytes are not its type", async () => {
    writeFileSync(path.join(dir, `${ID}.md`), file({}, `image: ${ID}-missing.png`));
    writeFileSync(path.join(dir, "m-aaaaaa.md"), file({ id: "m-aaaaaa" }, "image: m-aaaaaa-big.png"));
    writeFileSync(path.join(dir, "m-aaaaaa-big.png"), Buffer.concat([PNG, Buffer.alloc(MAX_MOCKUP_IMAGE_BYTES)]));
    writeFileSync(path.join(dir, "m-bbbbbb.md"), file({ id: "m-bbbbbb" }, "image: m-bbbbbb-lie.png"));
    writeFileSync(path.join(dir, "m-bbbbbb-lie.png"), "<html>not a png</html>");
    const read = await readMockupDirectory(dir, { checkContent: true });
    expect(read.mockups).toEqual([]);
    const said = Object.fromEntries(read.problems.map((p) => [p.file, p.problem]));
    expect(said[`${ID}.md`]).toMatch(/missing\.png.*(not there|not a file)/);
    expect(said["m-aaaaaa.md"]).toMatch(/larger than/);
    expect(said["m-bbbbbb.md"]).toMatch(/not a image\/png|is not image\/png/);
  });

  it("does not follow a symlink, for the page or for an image", async () => {
    const outside = path.join(dir, "..", `${path.basename(dir)}-secret.png`);
    writeFileSync(outside, PNG);
    try {
      writeFileSync(path.join(dir, `${ID}.md`), file({}, `image: ${ID}-link.png`));
      symlinkSync(outside, path.join(dir, `${ID}-link.png`));
      const real = path.join(dir, "elsewhere.md");
      writeFileSync(real, file({ id: "m-aaaaaa" }));
      symlinkSync(real, path.join(dir, "m-aaaaaa.md"));
      const read = await readMockupDirectory(dir, { checkContent: true });
      expect(read.mockups).toEqual([]);
      expect(read.problems.map((p) => p.file).sort()).toEqual(
        expect.arrayContaining([`${ID}.md`, "m-aaaaaa.md"]),
      );
      expect(await readOneMockup(dir, "m-aaaaaa")).toMatch(/not a file/);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("names a file that is neither a mockup nor one of its images, and an image nobody shows", async () => {
    writeFileSync(path.join(dir, `${ID}.md`), file());
    writeFileSync(path.join(dir, "notes.txt"), "x");
    writeFileSync(path.join(dir, `${ID}-orphan.png`), PNG);
    mkdirSync(path.join(dir, "sub"));
    const read = await readMockupDirectory(dir, { checkContent: true });
    expect(read.mockups.map((m) => m.id)).toEqual([ID]);
    expect(read.problems.map((p) => p.file).sort()).toEqual([`${ID}-orphan.png`, "notes.txt", "sub"]);
  });

  it("refuses the lot when every file together is over the total cap", async () => {
    expect(MAX_MOCKUP_IMAGES_TOTAL_BYTES).toBeGreaterThan(MAX_MOCKUP_IMAGE_BYTES);
    const read = await readMockupDirectory(dir, { checkContent: true, totalCap: 10 });
    expect(read.problems).toEqual([]);
    writeFileSync(path.join(dir, `${ID}.md`), file({}, `image: ${ID}-a.png`));
    writeFileSync(path.join(dir, `${ID}-a.png`), PNG);
    const over = await readMockupDirectory(dir, { checkContent: true, totalCap: 10 });
    expect(over.problems).toEqual([{ file: "(all files)", problem: expect.stringMatching(/together/) }]);
  });
});

describe("docs/mockups/, the real one", () => {
  it("has no file that would be left off the page", async () => {
    const read = await readMockupDirectory(path.join(process.cwd(), "docs", "mockups"), { checkContent: true });
    expect(read.problems).toEqual([]);
    expect(read.mockups.length).toBeGreaterThan(0);
  });
});
