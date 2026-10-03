/**
 * **The bar's rows as a model is shown them** — `pickOption`
 * (src/web/command-match.ts) and the checked-in list built from it,
 * src/command-pick-catalogue.generated.json. Plan 261003k.
 *
 * **That file is every row the bar can draw, in every place it is opened**:
 * one entry per distinct (id, label), since Archive and *Put back* share an id
 * and so do the two faces of the Experimental switch. It is generated because
 * src/web/CommandBar.tsx cannot be imported outside vitest or the browser (it
 * reaches `import.meta.env` through src/web/lib/supabase.ts), and the server
 * and the command-pick eval both need the words.
 *
 * **This file is the generator and the check.** The last test builds the list
 * again and fails when the checked-in file differs. To regenerate:
 *
 *     WRITE_COMMAND_PICK_CATALOGUE=1 npx vitest run tests/command-pick-catalogue.test.ts
 *
 * The eval (evals/command-pick/) reads the `owner-article` slice. Regenerating
 * after a row changes leaves its saved results measured against the old words;
 * evals/command-pick/README.md says what that means.
 *
 * The same command writes evals/command-pick/bar-answers.generated.json: for
 * each of the eval's sentences, what the bar's own matching already gives it.
 * It is made here for the same reason — the eval cannot import the matcher.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { modeGenerates, subModeGenerates } from "../src/web/activation.js";
import { besideTheModes, experimentalRows, subModeRows } from "../src/web/CommandBar.js";
import { type Command, modeCommand, parseArgumentQuery, pickOption, rankCommands } from "../src/web/command-match.js";
import { visibleModes } from "../src/web/Dock.js";
import { PHRASES } from "../evals/command-pick/phrases.js";

const FILE = path.join(import.meta.dirname, "..", "src", "command-pick-catalogue.generated.json");
const BAR_ANSWERS_FILE = path.join(import.meta.dirname, "..", "evals", "command-pick", "bar-answers.generated.json");
const REGENERATE = "WRITE_COMMAND_PICK_CATALOGUE=1 npx vitest run tests/command-pick-catalogue.test.ts";

interface Context {
  readonly name: string;
  readonly experimentalOn: boolean;
  /** Absent: a page with no article, where the bar has no modes either. */
  readonly article?: { readonly view: "article" | "metadata"; readonly owner: boolean; readonly archived: boolean };
  readonly comments: boolean;
}

/**
 * **The places the bar is opened**, the eval's first so the file reads in the
 * bar's own order. The slug is `a-piece` and the address carries nothing, so
 * the Metadata row's id is `page:/read/a-piece/metadata`.
 */
const CONTEXTS: readonly Context[] = [
  { name: "owner-article", experimentalOn: true, article: { view: "article", owner: true, archived: false }, comments: true },
  {
    name: "owner-article-experimental-off",
    experimentalOn: false,
    article: { view: "article", owner: true, archived: false },
    comments: true,
  },
  { name: "owner-article-archived", experimentalOn: true, article: { view: "article", owner: true, archived: true }, comments: true },
  {
    name: "reader-on-someone-elses-article",
    experimentalOn: true,
    article: { view: "article", owner: false, archived: false },
    comments: true,
  },
  { name: "owner-metadata", experimentalOn: true, article: { view: "metadata", owner: true, archived: false }, comments: false },
  { name: "no-article", experimentalOn: true, comments: false },
];

/** The `commands` memo in CommandBar.tsx, called with stub closures. */
function rowsIn(context: Context): readonly Command[] {
  const modes = context.article ? visibleModes(context.experimentalOn, undefined).map((m) => m.mode) : [];
  const experimental = {
    on: context.experimentalOn,
    loaded: true,
    signedIn: true,
    saving: false,
    set: async () => ({ kind: "saved" }) as const,
  };
  const archive = {
    at: context.article?.archived ? "2026-10-01T00:00:00.000Z" : null,
    lost: false,
    busy: false,
    error: null,
    set: async () => ({ kind: "done" }) as const,
  };
  return [
    ...modes.map(modeCommand),
    ...subModeRows(modes, context.experimentalOn, "sketch"),
    ...besideTheModes({
      article: context.article
        ? {
            slug: "a-piece",
            search: "",
            view: context.article.view,
            help: "/help",
            shelfRow: context.article.owner ? { archive, tags: { edit: async () => [] } } : undefined,
          }
        : undefined,
      openComments: context.comments ? () => {} : undefined,
      openFeedback: () => {},
      queue: { run: async () => null, lastFailure: () => null },
    }),
    ...experimentalRows(experimental),
  ];
}

function generates(command: Command): boolean {
  if (command.kind === "mode") return modeGenerates(command.mode);
  if (command.kind === "submode") return subModeGenerates(command.sub);
  return command.generates === true;
}

describe("pickOption", () => {
  it("gives a mode row its id and the catalog's own words", () => {
    expect(pickOption(modeCommand("glossary"))).toEqual({
      id: "mode:glossary",
      label: MODE_LABEL.glossary,
      description: MODE_CATALOG.glossary.description,
      aliases: [...MODE_CATALOG.glossary.aliases],
    });
  });

  it("gives a page or action row only the four fields, never its closure or href", () => {
    const row: Command = {
      kind: "action",
      id: "feedback",
      label: "Feedback",
      description: "Tell us.",
      aliases: ["bug"],
      generates: false,
      run: () => ({ kind: "close" }),
    };
    expect(pickOption(row)).toEqual({ id: "action:feedback", label: "Feedback", description: "Tell us.", aliases: ["bug"] });
    expect(JSON.parse(JSON.stringify(pickOption(row)))).toEqual(pickOption(row));
  });
});

describe("src/command-pick-catalogue.generated.json", () => {
  const entries = new Map<string, Record<string, unknown> & { id: string; label: string; contexts: string[] }>();
  for (const context of CONTEXTS) {
    for (const command of rowsIn(context)) {
      const option = pickOption(command);
      const key = `${option.id}\n${option.label}`;
      const entry = entries.get(key) ?? { ...option, kind: command.kind, generates: generates(command), contexts: [] };
      entry.contexts.push(context.name);
      entries.set(key, entry);
    }
  }
  const built = [...entries.values()];
  const text = `${JSON.stringify(built, null, 1)}\n`;

  it("holds every mode, the sub-modes, the article's rows, the app's pages, and both faces of a row whose label follows state", () => {
    const ids = built.map((o) => o.id);
    for (const mode of MODES) {
      if (!MODE_CATALOG[mode].experimental) expect(ids).toContain(`mode:${mode}`);
    }
    expect(ids).toContain("action:feedback");
    expect(ids).toContain("page:/changelog");
    expect(ids.some((id) => id.startsWith("submode:"))).toBe(true);
    expect(ids.some((id) => id.startsWith("action:rerun"))).toBe(true);
    expect(built.filter((o) => o.id === "action:archive").map((o) => o.label)).toEqual([
      "Archive this article",
      "Put this article back",
    ]);
    expect(built.filter((o) => o.id === "action:experimental")).toHaveLength(2);
  });

  it("gives each id once inside any one context", () => {
    for (const context of CONTEXTS) {
      const ids = built.filter((o) => o.contexts.includes(context.name)).map((o) => o.id);
      expect(new Set(ids).size, context.name).toBe(ids.length);
    }
  });

  it.runIf(process.env.WRITE_COMMAND_PICK_CATALOGUE === "1")("is written", () => {
    writeFileSync(FILE, text);
  });

  it("is what the bar's own functions give today", () => {
    let onDisk = "";
    try {
      onDisk = readFileSync(FILE, "utf8");
    } catch {
      /* Reported below, with the command. */
    }
    expect(
      onDisk === text,
      `src/command-pick-catalogue.generated.json is not what the bar's rows give now. Regenerate it:\n  ${REGENERATE}`,
    ).toBe(true);
  });
});

describe("evals/command-pick/bar-answers.generated.json", () => {
  const [evalContext] = CONTEXTS;
  if (!evalContext) throw new Error("no contexts");
  const commands = rowsIn(evalContext);
  const text = `${JSON.stringify(
    Object.fromEntries(
      PHRASES.map((p) => [p.text, { rows: rankCommands(p.text, commands).length, argument: parseArgumentQuery(p.text) }]),
    ),
    null,
    1,
  )}\n`;

  it.runIf(process.env.WRITE_COMMAND_PICK_CATALOGUE === "1")("is written", () => {
    writeFileSync(BAR_ANSWERS_FILE, text);
  });

  it("is what the bar's own matching gives each of the eval's sentences today", () => {
    expect(
      readFileSync(BAR_ANSWERS_FILE, "utf8") === text,
      `evals/command-pick/bar-answers.generated.json is out of date. Regenerate it:\n  ${REGENERATE}`,
    ).toBe(true);
  });
});
