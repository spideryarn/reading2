import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SOURCES as PAPERWORK_MODES_SOURCES } from "../evals/paperwork/modes.js";
import { SOURCES as PAPERWORK_SOURCES } from "../evals/paperwork/run.js";
import { SOURCES as ANSWERS_SOURCES } from "../evals/plain-words/answers.js";
import { PROMPT_FILES } from "../evals/plain-words/artefacts.js";
import { SOURCES as PLAIN_WORDS_SOURCES } from "../evals/plain-words/run.js";
import { sourceFingerprint } from "../evals/plain-words/source-fingerprint.js";
import { SOURCES as QUIZ_BUILD_UP_SOURCES } from "../evals/quiz-build-up.js";
import { SOURCES as QUIZ_READING_GOAL_SOURCES } from "../evals/quiz-reading-goal.js";

let src: string;

beforeEach(() => {
  src = fs.mkdtempSync(path.join(os.tmpdir(), "source-fingerprint-"));
  fs.writeFileSync(
    path.join(src, "stage.ts"),
    [
      'import { log } from "./log.js";',
      'import { plainWords } from "./plain-words.js";',
      "import {",
      "  paperwork,",
      '} from "./paperwork.js";',
      "export const SYSTEM = `Do the thing.\\n${plainWords()}\\n${paperwork()}`;",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(src, "plain-words.ts"), 'export const plainWords = () => "Use plain words.";\n');
  fs.writeFileSync(path.join(src, "paperwork.ts"), 'export const paperwork = () => "Skip the paperwork.";\n');
  fs.writeFileSync(path.join(src, "log.ts"), "export const log = console;\n");
});

afterEach(() => fs.rmSync(src, { recursive: true, force: true }));

describe("a harness's source fingerprint", () => {
  it("moves when wording that arrives through an import moves", () => {
    const before = sourceFingerprint(["stage.ts"], src);
    fs.writeFileSync(path.join(src, "paperwork.ts"), 'export const paperwork = () => "Skip the paperwork, and the abstract.";\n');
    const after = sourceFingerprint(["stage.ts"], src);
    expect(after).not.toEqual(before);
    expect(after["stage.ts"]).toBe(before["stage.ts"]);
  });

  it("follows a shared import written with single quotes", () => {
    fs.writeFileSync(path.join(src, "stage.ts"), "import { paperwork } from './paperwork.js';\n");
    const before = sourceFingerprint(["stage.ts"], src);
    fs.writeFileSync(path.join(src, "paperwork.ts"), 'export const paperwork = () => "Changed wording.";\n');
    const after = sourceFingerprint(["stage.ts"], src);
    expect(after).not.toEqual(before);
    expect(after["stage.ts"]).toBe(before["stage.ts"]);
  });

  it("keeps following a registered dependency re-exported by the named file", () => {
    fs.writeFileSync(path.join(src, "stage.ts"), 'export { paperwork } from "./paperwork.js";\n');
    expect(Object.keys(sourceFingerprint(["stage.ts"], src))).toEqual(["stage.ts", "paperwork.ts"]);
  });

  it("does not mistake comments or prompt prose for imports", () => {
    fs.writeFileSync(
      path.join(src, "stage.ts"),
      [
        '// Old implementation: import { paperwork } from "./paperwork.js";',
        'export const SYSTEM = `Do not copy words from "./plain-words.js".`;',
      ].join("\n"),
    );
    expect(Object.keys(sourceFingerprint(["stage.ts"], src))).toEqual(["stage.ts"]);
  });

  it("covers the shared prompt modules the named file imports, and not its other imports", () => {
    expect(Object.keys(sourceFingerprint(["stage.ts"], src)).sort()).toEqual(["paperwork.ts", "plain-words.ts", "stage.ts"]);
  });

  it("does not move for a shared module the named file does not import", () => {
    fs.writeFileSync(path.join(src, "other.ts"), "export const SYSTEM = `Nothing shared.`;\n");
    const before = sourceFingerprint(["other.ts"], src);
    fs.writeFileSync(path.join(src, "paperwork.ts"), "export const paperwork = () => 'changed';\n");
    expect(sourceFingerprint(["other.ts"], src)).toEqual(before);
  });

  it("refuses a named file that is not there, where a skipped one would be a silent hole", () => {
    expect(() => sourceFingerprint(["no-such-stage.ts"], src)).toThrow(/no-such-stage\.ts/);
  });
});

/* Against the real src/: each harness's own list, through the same function it
   records with. Every one of these generators builds its prompt from plain-words.ts,
   and all but the answer paths from paperwork.ts as well. */
describe("each harness's recorded fingerprint", () => {
  const cases: [string, readonly string[], string[]][] = [
    ["paperwork/run", PAPERWORK_SOURCES, ["plain-words.ts", "paperwork.ts", "structure-prompt.ts"]],
    ["paperwork/modes", PAPERWORK_MODES_SOURCES, ["plain-words.ts", "paperwork.ts"]],
    ["plain-words/run", PLAIN_WORDS_SOURCES, ["plain-words.ts", "paperwork.ts", "structure-prompt.ts"]],
    ["plain-words/answers", ANSWERS_SOURCES, ["plain-words.ts"]],
    ["plain-words/artefacts (quiz)", PROMPT_FILES.quiz, ["plain-words.ts", "paperwork.ts"]],
    ["plain-words/artefacts (arc)", PROMPT_FILES.arc, ["plain-words.ts", "paperwork.ts"]],
    ["quiz-build-up", QUIZ_BUILD_UP_SOURCES, ["plain-words.ts", "paperwork.ts"]],
    ["quiz-reading-goal", QUIZ_READING_GOAL_SOURCES, ["plain-words.ts", "paperwork.ts"]],
  ];
  it.each(cases)("%s covers the prompt text its generators import", (_name, sources, expected) => {
    const keys = Object.keys(sourceFingerprint(sources));
    for (const f of [...sources, ...expected]) expect(keys).toContain(f);
  });
});
