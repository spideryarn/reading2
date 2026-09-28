import { describe, expect, it } from "vitest";

import { personNames } from "../evals/plain-words/glossary-people.js";

describe("the plain-words evaluation helpers", () => {
  it("counts people by the glossary's kind, not by whether only background was written", () => {
    expect(
      personNames([
        { name: "A named researcher", kind: "person", background: "A person." },
        { name: "Müller-Lyer illusion", kind: "concept", background: "A visual illusion." },
        { name: "Another person", kind: "person", senseHere: "Named in an example." },
      ]),
    ).toEqual(["A named researcher", "Another person"]);
  });
});
