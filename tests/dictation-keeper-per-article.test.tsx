// @vitest-environment jsdom
/**
 * **A recording made in one article's "Why you're reading this one" box is
 * never offered back in another article's.**
 *
 * Greg, 2026-10-09 (spya-vzj8fc): on an article he had just opened, the guide's
 * *Why you're reading this one* box showed a dictation failure, and Try again
 * pasted in what he had said on a different article. The box's keeper was
 * `profile:guide-purpose`, the same name on every article, so a tape left
 * behind on one was recovered into the next. The keeper's box name is the
 * partition (dictation-keep.ts § Three partitions), and since 261009a it is
 * also what binds a dictation in memory to the box it was said into — so the
 * name has to carry the article wherever the field is per article.
 *
 * docs/plans/261009e-dictation-stays-with-its-article-and-the-button-says-its-tricks.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every keeper box name a box asked for, in order. */
const asked: string[] = [];

vi.mock("../src/web/dictation-keep.js", () => ({
  keepDictation: (box: string) => {
    asked.push(box);
    return { box, begin: () => null, recover: async () => null };
  },
}));

const { ProfileBox } = await import("../src/web/ProfileBox.js");

let host: HTMLDivElement;
let root: Root;

function render(id: string, article: string | null) {
  act(() => {
    root.render(
      createElement(ProfileBox, {
        id,
        article,
        label: "Why you're reading this one",
        hint: "",
        placeholder: "",
        value: "",
        onChange: () => {},
        onCommit: () => {},
        max: 500,
        save: { kind: "clean" },
      }),
    );
  });
}

beforeEach(() => {
  asked.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a profile box's keeper", () => {
  for (const id of ["guide-purpose", "prompt-purpose", "panel-purpose", "article-purpose"]) {
    it(`${id} on one article does not share a name with the same box on another`, () => {
      render(id, "attention-is-all-you-need");
      const first = asked.at(-1);
      act(() => root.unmount());
      root = createRoot(host);
      render(id, "a-different-piece");
      const second = asked.at(-1);
      expect(first).toBe(`profile:${id}:attention-is-all-you-need`);
      expect(second).toBe(`profile:${id}:a-different-piece`);
    });
  }

  it("names the article when the same mounted box moves to another one", () => {
    render("guide-purpose", "attention-is-all-you-need");
    render("guide-purpose", "a-different-piece");
    expect(asked.at(-1)).toBe("profile:guide-purpose:a-different-piece");
  });

  it("About you is one field for every article, so its name has none", () => {
    render("reader-profile", null);
    expect(asked.at(-1)).toBe("profile:reader-profile");
  });
});
