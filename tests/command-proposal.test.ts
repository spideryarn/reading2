/**
 * **The command descriptor, its stored token, and its one dispatcher** — Stage
 * 1, part 0 of docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md
 * (GPT Sol's F8).
 *
 * The bar's free-text parse and chat's stored tokens (Stage 2) must arrive at
 * the same typed proposal, and chat must never re-parse a sentence. So:
 *
 *  - **A token is an exact id and an encoded argument**, and anything else —
 *    a sentence, an unknown id, a bad block id, an invalid tag — is `null`.
 *  - **Each argument is validated by its command's own rule** — `normaliseTag`,
 *    the block-id pattern, `parseAskedTerm` — so a token cannot carry what the
 *    bar would refuse.
 *  - **The glossary is matched against the list it is handed**: exact name
 *    first, then aliases, one row per entry sharing an alias (F2), and the ask
 *    only once the read has settled to ready (F1).
 *  - **`runProposal` presses exactly one runner**, and says when there is none.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type CommandProposal,
  PROPOSAL_IDS,
  RISK,
  formatProposalToken,
  parseProposalToken,
  proposalWords,
  resolveArgument,
  runProposal,
} from "../src/web/command-proposal.js";
import type { GlossaryEntry } from "../src/types.js";

const BLOCK = "spya-adq4zt";
const TERM_A = "spya-adq5wr";
const TERM_B = "spya-adq6xm";

function entry(id: string, name: string, aliases: string[] = []): GlossaryEntry {
  return { id, name, aliases, kind: "concept", blocks: [BLOCK] } as unknown as GlossaryEntry;
}

describe("RISK", () => {
  it("says which ids navigate, which write and which spend", () => {
    expect(RISK).toEqual({
      "jump-first": "navigate",
      find: "navigate",
      "glossary-open": "navigate",
      "glossary-ask": "spends",
      "tag-add": "writes",
      "tag-remove": "writes",
      bookmark: "writes",
    });
    expect([...PROPOSAL_IDS].sort()).toEqual(Object.keys(RISK).sort());
  });
});

describe("the stored token", () => {
  const every: CommandProposal[] = [
    { id: "jump-first", words: "free energy" },
    { id: "find", words: 'rock & roll # "λ"' },
    { id: "glossary-open", termId: TERM_A },
    { id: "glossary-ask", term: "active inference" },
    { id: "tag-add", tag: "reading group" },
    { id: "tag-remove", tag: "to read" },
    { id: "bookmark", blockId: BLOCK },
  ];

  it("round-trips every id", () => {
    for (const proposal of every) {
      const token = formatProposalToken(proposal);
      expect(parseProposalToken(token), token).toEqual(proposal);
    }
  });

  it("carries no space, bracket or Markdown character inside the token", () => {
    for (const proposal of every) {
      const inner = formatProposalToken(proposal).slice(1, -1);
      expect(inner, inner).toMatch(/^[a-z0-9:%-]+$/i);
    }
  });

  it("refuses anything that is not exactly a token", () => {
    for (const text of [
      "",
      "please tag this as reading group",
      "[cmd:tag-add]",
      "[cmd:teleport:x]",
      "[cmd:tag-add:reading%20group] ",
      " [cmd:tag-add:reading%20group]",
      "cmd:tag-add:reading%20group",
      "[cmd:tag-add:reading%20group:extra]",
      "[cmd:tag-add:%E0%A4%A]",
    ]) {
      expect(parseProposalToken(text), text).toBeNull();
    }
  });

  it("refuses an argument its own command would refuse", () => {
    /* A comma is never a tag (src/tags.ts). */
    expect(parseProposalToken("[cmd:tag-add:a%2Cb]")).toBeNull();
    expect(parseProposalToken("[cmd:tag-add:]")).toBeNull();
    /* Not an id this app could have minted. */
    expect(parseProposalToken("[cmd:bookmark:spya-111111]")).toBeNull();
    expect(parseProposalToken("[cmd:glossary-open:not-an-id]")).toBeNull();
    /* Longer than a term (src/asked-term.ts). */
    expect(parseProposalToken(`[cmd:glossary-ask:${"x".repeat(81)}]`)).toBeNull();
    expect(parseProposalToken("[cmd:jump-first:%20%20]")).toBeNull();
  });

  it("stores a tag as `normaliseTag` would, so `Reading  Group` and `reading group` are one", () => {
    expect(parseProposalToken("[cmd:tag-add:Reading%20%20Group]")).toEqual({
      id: "tag-add",
      tag: "reading group",
    });
  });
});

describe("resolveArgument — the glossary", () => {
  const terms = [entry(TERM_A, "Free energy", ["fe", "surprise"]), entry(TERM_B, "Surprise", ["fe"])];

  it("opens a term named exactly, before one that only shares an alias", () => {
    const rows = resolveArgument({ kind: "glossary", words: "surprise" }, { glossary: { ready: true, terms } });
    expect(rows).toEqual([
      { kind: "ready", proposal: { id: "glossary-open", termId: TERM_B }, shown: "Surprise" },
      { kind: "ready", proposal: { id: "glossary-open", termId: TERM_A }, shown: "Free energy" },
    ]);
  });

  it("gives one row to each entry that shares an alias", () => {
    const rows = resolveArgument({ kind: "glossary", words: "FE" }, { glossary: { ready: true, terms } });
    expect(rows.map((r) => (r.kind === "ready" ? r.proposal : null))).toEqual([
      { id: "glossary-open", termId: TERM_A },
      { id: "glossary-open", termId: TERM_B },
    ]);
  });

  it("offers the ask when nothing matches and the read is ready", () => {
    expect(
      resolveArgument({ kind: "glossary", words: "attention  head" }, { glossary: { ready: true, terms } }),
    ).toEqual([{ kind: "ready", proposal: { id: "glossary-ask", term: "attention head" } }]);
  });

  it("offers no ask while the read is not ready, and nothing at all without a glossary", () => {
    expect(resolveArgument({ kind: "glossary", words: "attention" }, { glossary: { ready: false, terms } })).toEqual(
      [],
    );
    expect(resolveArgument({ kind: "glossary", words: "surprise" }, {})).toEqual([]);
  });

  it("refuses an ask the server would refuse, with the server's sentence", () => {
    const [row] = resolveArgument(
      { kind: "glossary", words: "x".repeat(81) },
      { glossary: { ready: true, terms: [] } },
    );
    expect(row?.kind).toBe("refused");
    if (row?.kind === "refused") expect(row.reason).toContain("80 characters");
  });
});

describe("resolveArgument — tags, find and jump", () => {
  it("normalises a tag as it will be stored", () => {
    expect(resolveArgument({ kind: "tag-add", words: "Reading  Group" }, {})).toEqual([
      { kind: "ready", proposal: { id: "tag-add", tag: "reading group" } },
    ]);
    expect(resolveArgument({ kind: "tag-remove", words: "To Read" }, {})).toEqual([
      { kind: "ready", proposal: { id: "tag-remove", tag: "to read" } },
    ]);
  });

  it("keeps an invalid tag as a row whose reason is the tag rule's", () => {
    expect(resolveArgument({ kind: "tag-add", words: "a, b" }, {})).toEqual([
      { kind: "refused", id: "tag-add", shown: "a, b", reason: "A tag cannot contain a comma." },
    ]);
  });

  it("passes find and jump words straight through", () => {
    expect(resolveArgument({ kind: "find", words: "priors" }, {})).toEqual([
      { kind: "ready", proposal: { id: "find", words: "priors" } },
    ]);
    expect(resolveArgument({ kind: "jump-first", words: "priors" }, {})).toEqual([
      { kind: "ready", proposal: { id: "jump-first", words: "priors" } },
    ]);
  });
});

describe("proposalWords", () => {
  it("labels each row with what it does, and marks only the spending one", () => {
    const words = (proposal: CommandProposal, shown?: string) => proposalWords(proposal, shown);
    expect(words({ id: "jump-first", words: "priors" }).label).toBe("Jump to the first “priors”");
    expect(words({ id: "find", words: "priors" }).label).toBe("Find “priors” in this article");
    expect(words({ id: "glossary-open", termId: TERM_A }, "Free energy").label).toBe("Glossary: “Free energy”");
    expect(words({ id: "glossary-ask", term: "attention head" }).label).toBe(
      "Look up “attention head” in this article",
    );
    expect(words({ id: "tag-add", tag: "to read" }).label).toBe("Add the tag “to read”");
    expect(words({ id: "tag-remove", tag: "to read" }).label).toBe("Remove the tag “to read”");
    for (const proposal of [
      { id: "jump-first", words: "x" },
      { id: "find", words: "x" },
      { id: "glossary-open", termId: TERM_A },
      { id: "glossary-ask", term: "x" },
      { id: "tag-add", tag: "x" },
      { id: "tag-remove", tag: "x" },
      { id: "bookmark", blockId: BLOCK },
    ] as const) {
      expect(words(proposal).generates, proposal.id).toBe(RISK[proposal.id] === "spends");
    }
  });
});

describe("runProposal", () => {
  it("presses exactly the runner for the proposal's id, with the proposal", () => {
    const tagAdd = vi.fn(() => ({ kind: "close" }) as const);
    const jump = vi.fn(() => ({ kind: "close" }) as const);
    const outcome = runProposal({ "tag-add": tagAdd, "jump-first": jump }, { id: "tag-add", tag: "x" });
    expect(outcome).toEqual({ kind: "close" });
    expect(tagAdd).toHaveBeenCalledTimes(1);
    expect(tagAdd).toHaveBeenCalledWith({ id: "tag-add", tag: "x" });
    expect(jump).not.toHaveBeenCalled();
  });

  it("answers null where the reader is standing has no such runner", () => {
    expect(runProposal({}, { id: "bookmark", blockId: BLOCK })).toBeNull();
  });
});
