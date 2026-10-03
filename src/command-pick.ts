/**
 * **A sentence in the command bar, turned into one of the bar's rows** — the
 * shapes, the caps, the words the models are asked with and the reading of
 * their answers. Plan 261003k, Stage 2.
 *
 * Pure: no React, no browser API, no gateway. The browser imports it for the
 * request and for reading the reply (src/web/command-pick-client.ts), the
 * server for everything (src/command-pick-call.ts), and the eval that chose
 * the models for the wording (evals/command-pick/run.ts) — so what was
 * measured and what is sent are one copy.
 *
 * **Three rules a caller can lean on**, each a line here rather than a habit:
 *
 *  1. The answer is a key the request sent, or words that are in the sentence
 *     the request sent, or `none`. Nothing new comes back (decision 2).
 *  2. The model never reads a word about a row that the caller wrote. The
 *     browser sends keys; the words come from the server's own list
 *     (src/command-pick-catalogue.generated.json) — GPT Sol's F1.
 *  3. Confidence gates nothing that writes or spends. It is carried for one
 *     decision, in the bar: whether a row that only moves the reader runs at
 *     once (`RUN_AT_ONCE`).
 */

/** One of the bar's rows, as the browser names it: Archive and *Put back* share an id, so the label is half the key. */
export interface PickKey {
  readonly id: string;
  readonly label: string;
}

/** One row as a model is shown it — the key, and the words the bar itself matches on. */
export interface PickOption extends PickKey {
  readonly description: string;
  readonly aliases: readonly string[];
}

/**
 * The commands that take words from the sentence — `ArgumentQuery["kind"]` in
 * src/web/command-match.ts, which is held to this list by a type there.
 */
export const ARGUMENT_KINDS = ["find", "jump-first", "glossary", "tag-add", "tag-remove"] as const;
export type ArgumentKind = (typeof ARGUMENT_KINDS)[number];

export interface PickRequest {
  readonly sentence: string;
  readonly rows: readonly PickKey[];
  readonly argumentKinds: readonly ArgumentKind[];
}

export type PickAnswer =
  /** `others`: the model's next choices, likeliest first, each above `SUGGEST_FLOOR`. */
  | { readonly kind: "row"; readonly key: PickKey; readonly confidence: number; readonly others: readonly PickKey[] }
  | { readonly kind: "argument"; readonly argument: ArgumentKind; readonly words: string }
  | { readonly kind: "none" };

export const NONE_ANSWER: Extract<PickAnswer, { kind: "none" }> = { kind: "none" };

/* ------------------------------------------------------------------ caps -- */

/** A sentence, not an essay: the longest request the eval held was under 120. */
export const MAX_SENTENCE = 300;
/** The bar draws about 65 rows at its fullest. */
export const MAX_KEYS = 200;
/** One id or label. The longest of either today is under 60. */
export const MAX_KEY_TEXT = 200;

/**
 * **What stands where the article's slug was** in a key's id. A page row's id
 * is its address, and one list on the server has to serve every article — so
 * `page:/read/<slug>/metadata` is sent, and held, as `page:/read/:slug/metadata`
 * (src/web/command-match.ts § `pickKey`).
 */
export const PICK_SLUG = ":slug";

/**
 * **At or above this, a row that only moves the reader runs without a second
 * Enter.** Measured on `typesafe/jev-1.13`
 * (docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md):
 * of the picks that would have run at once, 4 of 42 were wrong at 0.8, 1 of 37
 * at 0.9 and none of 35 at 0.95. Five errors in all, so a starting point, and
 * it means nothing on another model.
 */
export const RUN_AT_ONCE = 0.95;
/** How many rows are drawn when the pick does not run: the model's first three held the right row 11 times of 11. */
export const SUGGESTIONS = 3;
/** Below this a second or third choice is noise, not a suggestion. */
export const SUGGEST_FLOOR = 0.05;

/* ------------------------------------------------------------- the body -- */

export type PickRequestParse =
  | { readonly ok: true; readonly request: PickRequest }
  /** Fixed prose, never a string the caller sent — it reaches a log. */
  | { readonly ok: false; readonly reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));
const UNKNOWN_FIELD = "That request has a field this endpoint does not take";

/**
 * **The body of `POST /api/command-pick`, exactly** — `POST /api/transcribe`'s
 * rule: a key we do not know is refused rather than ignored, at every level.
 */
export function parsePickRequest(body: unknown): PickRequestParse {
  if (!isRecord(body)) return { ok: false, reason: "Expected a JSON object" };
  if (!onlyKeys(body, ["sentence", "rows", "argumentKinds"])) return { ok: false, reason: UNKNOWN_FIELD };
  const { sentence, rows, argumentKinds } = body;
  if (typeof sentence !== "string" || sentence.trim() === "") return { ok: false, reason: "sentence must be some words" };
  if (sentence.length > MAX_SENTENCE) return { ok: false, reason: "sentence is too long" };
  if (!Array.isArray(rows) || rows.length > MAX_KEYS) return { ok: false, reason: "rows must be a list of keys" };
  const keys: PickKey[] = [];
  for (const row of rows as unknown[]) {
    if (!isRecord(row)) return { ok: false, reason: "rows must be a list of keys" };
    if (!onlyKeys(row, ["id", "label"])) return { ok: false, reason: UNKNOWN_FIELD };
    const { id, label } = row;
    if (!isKeyText(id) || !isKeyText(label)) return { ok: false, reason: "a key is an id and a label" };
    keys.push({ id, label });
  }
  if (!Array.isArray(argumentKinds) || argumentKinds.length > ARGUMENT_KINDS.length) {
    return { ok: false, reason: "argumentKinds must be a list of kinds" };
  }
  const kinds: ArgumentKind[] = [];
  for (const kind of argumentKinds as unknown[]) {
    if (!isArgumentKind(kind) || kinds.includes(kind)) return { ok: false, reason: "argumentKinds must be a list of kinds" };
    kinds.push(kind);
  }
  return { ok: true, request: { sentence, rows: keys, argumentKinds: kinds } };
}

const isKeyText = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= MAX_KEY_TEXT;

export function isArgumentKind(v: unknown): v is ArgumentKind {
  return typeof v === "string" && (ARGUMENT_KINDS as readonly string[]).includes(v);
}

export const sameKey = (a: PickKey, b: PickKey): boolean => a.id === b.id && a.label === b.label;

/* ------------------------------------------- what the models are asked -- */

/** The answer that is no command, as the pick model returns it. */
export const NONE = "none";
const ARGUMENT_PREFIX = "arg:";
/** An argument command's id among the options: `arg:find`. */
export const argumentOptionId = (kind: ArgumentKind): string => `${ARGUMENT_PREFIX}${kind}`;

/** What every request opens with. The model is never shown the article. */
export const APP =
  "Spideryarn is a reading app. The reader has one article open and has typed or spoken a request into the app's command bar. Each command below is something the app can do right now.";
/** What `none` means, as the model reads it. */
export const NONE_TEXT =
  "None of these commands does what the reader asked — the app cannot do it, or it is not a request to the app at all. Choose this rather than a command that only sounds related.";

/**
 * **The five argument commands, as the model is shown them.** Ours, and
 * trusted: the bar has no row for these until there are words, so there is
 * nothing in the generated list to read them from.
 */
export const ARGUMENT_OPTIONS: Readonly<Record<ArgumentKind, Omit<PickOption, "id">>> = {
  find: {
    label: "Find words in this article",
    description:
      "Look for a word, a name or a phrase in the article and show every place it comes up. Choose this when the reader names something to look for.",
    aliases: ["search for", "does it mention", "is it mentioned"],
  },
  "jump-first": {
    label: "Jump to the first mention",
    description:
      "Go to the first place the article says a word, a name or a phrase. Choose this when the reader asks where something first comes up.",
    aliases: ["first mention of", "where does it first say"],
  },
  glossary: {
    label: "Look up a term",
    description:
      "Say what one term means in this article. Choose this when the reader names a term and asks what it is or what it means.",
    aliases: ["define", "what does it mean", "look up"],
  },
  "tag-add": {
    label: "Add a tag",
    description:
      "Put a tag, a short label of the reader's own, on this article. Choose this when the reader names a tag to add.",
    aliases: ["tag this as", "label", "file under"],
  },
  "tag-remove": {
    label: "Remove a tag",
    description: "Take a tag off this article. Choose this when the reader names a tag to take off.",
    aliases: ["untag", "remove the tag"],
  },
};

/** One option's line: its name, what it is, and its nicknames. */
export function describeOption(option: Omit<PickOption, "id">): string {
  return `${option.label} — ${option.description}${option.aliases.length ? ` (also called: ${option.aliases.join(", ")})` : ""}`;
}

/** The pick model's one question, on the Decisions wire. */
export interface ChoiceAsk {
  readonly state: { readonly app: string; readonly reader_request: string };
  readonly questions: {
    readonly command: {
      readonly type: "choice";
      readonly instructions: string;
      readonly criteria: Record<string, string>;
    };
  };
}

/**
 * **Which one command?** — the rows, then the argument commands, then `none`,
 * each id against its line. The wording and the order are the eval's
 * `jev-pick` arm; changing either is a new measurement.
 *
 * `rows` are options whose words are the server's own. An id is asked about
 * once: the first row with it stands, so a request naming both faces of
 * Archive cannot ask about two things under one name.
 */
export function choiceAsk(
  sentence: string,
  rows: readonly PickOption[],
  argumentKinds: readonly ArgumentKind[],
): ChoiceAsk {
  const criteria: Record<string, string> = {};
  for (const row of rows) criteria[row.id] ??= describeOption(row);
  /* In the list's order, not the caller's: the order is part of what was measured. */
  for (const kind of ARGUMENT_KINDS) {
    if (argumentKinds.includes(kind)) criteria[argumentOptionId(kind)] = describeOption(ARGUMENT_OPTIONS[kind]);
  }
  criteria[NONE] = NONE_TEXT;
  return {
    state: { app: APP, reader_request: sentence },
    questions: {
      command: {
        type: "choice",
        instructions: `Which one command should run for the reader's request: "${sentence}"?`,
        criteria,
      },
    },
  };
}

const KIND_ASKS: Readonly<Record<ArgumentKind, { readonly wants: string; readonly thing: string }>> = {
  find: { wants: "find a word, a name or a phrase in the article", thing: "the words to look for" },
  "jump-first": { wants: "go to the first place the article says a word, a name or a phrase", thing: "the words to look for" },
  glossary: { wants: "know what one term means", thing: "the term" },
  "tag-add": { wants: "put a tag on the article", thing: "the tag" },
  "tag-remove": { wants: "take a tag off the article", thing: "the tag" },
};

/**
 * **Copy the words out** — the second call, made only when the pick is an
 * argument command. The eval's `hyb-*` arms, word for word: the small model is
 * told the kind and asked for nothing else.
 */
export function wordsMessages(sentence: string, kind: ArgumentKind): { role: "system" | "user"; content: string }[] {
  const ask = KIND_ASKS[kind];
  return [
    {
      role: "system",
      content: [
        `A reader has an article open in a reading app and typed or said a request. The reader wants to ${ask.wants}.`,
        `Copy ${ask.thing} out of the request, as the reader wrote them. Leave out the words that ask for it and any filler such as "um".`,
        'Answer with JSON only: {"argument": "<the words>"}',
      ].join("\n"),
    },
    { role: "user", content: sentence },
  ];
}

/** The ceiling on that answer, as measured. */
export const WORDS_MAX_TOKENS = 100;

/* ------------------------------------------------- reading the answers -- */

/** The pick model's answer to the one question, as the gateway hands it over. */
export interface RawChoice {
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

/** The pick, before any words: a row, nothing, or an argument command still waiting for its words. */
export type Picked =
  | Extract<PickAnswer, { kind: "row" | "none" }>
  | { readonly kind: "words-wanted"; readonly argument: ArgumentKind };

/**
 * **The model's choice, held to what was offered.** An id that is not one of
 * `rows` and not one of `argumentKinds` is `none` — a model's slip (Luna once
 * answered `page:/read/metadata`) must not become a row nobody offered.
 */
export function readPick(
  raw: RawChoice | undefined,
  offered: { readonly rows: readonly PickKey[]; readonly argumentKinds: readonly ArgumentKind[] },
): Picked {
  if (raw === undefined || raw.choice === NONE) return NONE_ANSWER;
  if (raw.choice.startsWith(ARGUMENT_PREFIX)) {
    const kind = raw.choice.slice(ARGUMENT_PREFIX.length);
    return isArgumentKind(kind) && offered.argumentKinds.includes(kind)
      ? { kind: "words-wanted", argument: kind }
      : NONE_ANSWER;
  }
  /* The key and nothing else of the row: `rows` may be the server's options,
     words and all, and an answer carries keys. */
  const keyFor = (id: string): PickKey | undefined => {
    const row = offered.rows.find((r) => r.id === id);
    return row === undefined ? undefined : { id: row.id, label: row.label };
  };
  const key = keyFor(raw.choice);
  if (key === undefined) return NONE_ANSWER;
  const others = Object.entries(raw.probabilities)
    .filter(([id, p]) => id !== raw.choice && p >= SUGGEST_FLOOR)
    .sort(([, a], [, b]) => b - a)
    .flatMap(([id]) => {
      const other = keyFor(id);
      return other === undefined ? [] : [other];
    })
    .slice(0, SUGGESTIONS - 1);
  return { kind: "row", key, confidence: raw.confidence, others };
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * **The words, only if the reader said them.** Not empty, and found in the
 * sentence whatever the case: the model extracts, it does not invent, and a
 * dictated *neuro science* stays as said. Anything else is `none`.
 */
export function wordsIn(sentence: string, argument: ArgumentKind, words: unknown): PickAnswer {
  if (typeof words !== "string") return NONE_ANSWER;
  const said = collapse(words);
  if (said === "" || !collapse(sentence).toLowerCase().includes(said.toLowerCase())) return NONE_ANSWER;
  return { kind: "argument", argument, words: said };
}

/** The extractor's reply — `{"argument": "…"}`, possibly wrapped in prose — to an answer. */
export function readWords(sentence: string, argument: ArgumentKind, content: unknown): PickAnswer {
  if (typeof content !== "string") return NONE_ANSWER;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return NONE_ANSWER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return NONE_ANSWER;
  }
  return isRecord(parsed) ? wordsIn(sentence, argument, parsed.argument) : NONE_ANSWER;
}

/**
 * **The server's reply, read by the browser as carefully as the server read
 * the model.** The same two rules, against the request this browser sent: a
 * key it did not send, or words not in its sentence, is `none`.
 */
export function readPickAnswer(json: unknown, sent: PickRequest): PickAnswer {
  if (!isRecord(json)) return NONE_ANSWER;
  const sentKey = (v: unknown): PickKey | undefined =>
    isRecord(v) && typeof v.id === "string" && typeof v.label === "string"
      ? sent.rows.find((row) => sameKey(row, { id: v.id as string, label: v.label as string }))
      : undefined;
  switch (json.kind) {
    case "row": {
      const key = sentKey(json.key);
      const { confidence, others } = json;
      if (key === undefined || typeof confidence !== "number" || !Number.isFinite(confidence)) return NONE_ANSWER;
      return {
        kind: "row",
        key,
        confidence,
        others: (Array.isArray(others) ? (others as unknown[]) : []).flatMap((o) => {
          const other = sentKey(o);
          return other === undefined ? [] : [other];
        }),
      };
    }
    case "argument":
      return isArgumentKind(json.argument) && sent.argumentKinds.includes(json.argument)
        ? wordsIn(sent.sentence, json.argument, json.words)
        : NONE_ANSWER;
    default:
      return NONE_ANSWER;
  }
}

/** Where the bar posts. */
export const COMMAND_PICK_PATH = "/api/command-pick";

/**
 * **What the bar says when the sentence came to nothing** — `none`, a failure,
 * a timeout. One sentence for all three, because the reader's next move is the
 * same: say it another way, or use the list. Not a failure message in
 * docs/project/copy.md's sense for `none` — nothing failed — and for the
 * failures it is deliberately no louder: the bar's own matching still works.
 */
export const COULD_NOT_TELL = "Couldn't tell what you meant.";
