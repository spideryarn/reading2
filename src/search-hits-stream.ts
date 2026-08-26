/**
 * Incremental extractor for the search JSON stream.
 *
 * src/search.ts asks the model for exactly one JSON object,
 * `{"hits": [ {...}, {...} ]}`, hits ordered best-first, and today waits for
 * the whole reply before `parseHits` and `validateHits` run on it. Waiting is
 * the wrong trade for a reader watching a spinner — see AGENTS.md "stream any
 * model call a person is waiting on" — so this module watches the same text
 * arrive a chunk at a time and hands back each hit object the instant its
 * closing brace shows up, without changing what the model is asked for.
 *
 * WHAT THIS IS: a brace counter with a one-character lookahead for strings
 * and escapes, not a JSON parser. It walks the text once, tracking which
 * brackets are open and whether it is inside a quoted string, well enough to
 * find where one element of the `hits` array starts and ends, and hands that
 * slice to `JSON.parse`. It does not understand JSON grammar beyond that — a
 * value that is not a string, object or array needs no balancing, so nothing
 * here looks at numbers, `true`, `false` or `null` at all.
 *
 * **It DOES check which key the array belongs to.** An earlier version keyed
 * off "the first `[` one level inside the outer object", on the theory that
 * the prompt only ever puts one array there — which is true of a compliant
 * model and was never the threat. A model that adds a stray sibling array
 * (`{"notes":[...],"hits":[...]}`) is not rare enough to assume away, and
 * treating `notes`'s contents as hits is not a late hit, it is a WRONG one —
 * the reader sees a highlight the authoritative result never contained. So
 * this tracks the most recently closed string literal seen directly inside
 * the outer object (`stack.length === 1`), and only an array whose value that
 * was — i.e. the array immediately follows a depth-1 key spelled `hits` — is
 * ever treated as the hits array. In valid JSON a key string always closes
 * immediately before its own value (only `:` and whitespace between), so a
 * stray depth-1 string that happens to *contain* the word "hits" as a VALUE
 * (`{"notes":"hits","hits":[...]}`) cannot fool this: the real `"hits"` key
 * closes again, immediately before the real array, overwriting whatever the
 * unrelated value left behind. See tests/search-hits-stream.test.ts for both
 * of those cases, plus the key itself arriving split across a chunk boundary
 * (`depth1StringStart` is an absolute index into `buf`, which is never
 * truncated, so this needs no special handling — it falls out for free).
 *
 * Prose before the object ("Here you go:") and a ```` ```json ```` fence are
 * ignored the same way `parseHits` ignores them — nothing before the outer
 * `{` is looked at, and once the outer object's matching `}` closes, nothing
 * after it is either.
 *
 * WHAT THIS DOES NOT DO: validate anything about a hit's shape. `validateHits`
 * in search.ts still owns that, and still needs the block list to check a
 * `blockId` and a `quote` against — this module is never given it, and
 * returns whatever `JSON.parse` produces.
 *
 * THE SAFETY PROPERTY THIS DEPENDS ON: `push` is allowed to miss a hit, or
 * emit nothing at all — the worst that costs is a late hit, never a wrong
 * one. **Two separate things have to hold for that, and the second is the one
 * that nearly got away.**
 *
 * *One:* the array a completed object is attributed to is pinned to the
 * literal `hits` key rather than to position (above). The version that keyed
 * off "the first `[` one level inside the outer object" got this wrong — a
 * sibling array arriving *first*, `{"notes":[...],"hits":[...]}`, made `push`
 * emit an object that was never inside `hits` at all.
 *
 * *Two:* `hitsArrayOpen` tracks whether we are still inside that array, and
 * not merely at the same depth as it. Pinning the key alone is **necessary
 * and not sufficient**, which is what the first attempt at the fix assumed:
 * `hitsArrayDepth` is a depth *number*, so a sibling array arriving *after*
 * `hits` closes — `{"hits":[...],"notes":[...]}` — reaches the same number,
 * and its objects were still emitted. Caught by the new test written for the
 * first half of the fix, which is the only reason it did not ship.
 *
 * Either failure produces a **wrong** hit rather than a late one, and ruling
 * that shape out is the whole of what makes a brace counter an acceptable
 * stand-in for a real JSON parser here. A comment claiming this property is
 * not the property: if you change how an array is identified, the claim above
 * is what you are changing. `text()` returns every character fed to it,
 * unmodified and in order, so the caller can still run the whole response
 * through `parseHits` + `validateHits` once the stream ends, exactly as it
 * does today; that final pass is the actual source of truth, and this module
 * is only ever showing the reader its answer sooner. That guarantee holds
 * only because `push` never mutates or drops anything from what it appends
 * to the buffer `text()` reads back — it only ever reads from that buffer,
 * never changes it.
 */
export function hitExtractor(): {
  /** Feed the next chunk of streamed text. Returns any hit objects that completed within it, in order. */
  push(chunk: string): unknown[];
  /** Everything fed so far, so the caller can still run the strict whole-object parse at the end. */
  text(): string;
} {
  let buf = "";

  // Have we seen the outer object's opening `{` yet? Until then every
  // character — prose, a code fence — is simply skipped, the same way
  // `parseHits`'s `indexOf("{")` skips it.
  let started = false;
  // Has the outer object's matching `}` already closed? Once it has,
  // anything further (a closing code fence, trailing prose) is ignored.
  let done = false;

  const stack: ("{" | "[")[] = [];
  let inString = false;
  let escaped = false;

  // Absolute index into `buf` of the opening `"` of a string literal
  // currently being scanned directly inside the outer object (stack.length
  // === 1), or -1 when not in one. Only tracked at that depth — a string
  // nested inside a hit is irrelevant to which key it belongs to.
  let depth1StringStart = -1;
  // The most recently CLOSED string literal seen at that depth. Because a
  // JSON key always closes immediately before its own `:` and value, this is
  // always the correct key for whatever value comes next — see the module
  // docstring.
  let lastDepth1String: string | null = null;

  // stack.length at which we are directly inside the hits array, once found.
  // -1 means "not found yet". This is a DEPTH NUMBER, and a sibling array at
  // the same depth — one that comes AFTER `hits` closes, e.g.
  // `{"hits":[...],"notes":[...]}` — reaches this exact same number. So depth
  // alone cannot mean "currently inside the confirmed hits array"; that is
  // what `hitsArrayOpen` is for.
  let hitsArrayDepth = -1;
  // True from the moment the confirmed hits array's own `[` is pushed until
  // its own matching `]` is popped. Gates every use of `hitsArrayDepth` below
  // so a later sibling array reusing the same numeric depth is never mistaken
  // for still being inside `hits`.
  let hitsArrayOpen = false;
  // Absolute index into `buf` of the `{` that opened the hit currently being
  // scanned, or -1 when we are not inside a depth-1 hit.
  let hitStart = -1;

  return {
    push(chunk: string): unknown[] {
      const out: unknown[] = [];
      const from = buf.length;
      buf += chunk;

      for (let i = from; i < buf.length; i++) {
        if (done) break;
        const ch = buf[i];

        if (!started) {
          if (ch !== "{") continue;
          started = true;
          // fall through: this same '{' is the outer object's open brace.
        }

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
            if (stack.length === 1 && depth1StringStart !== -1) {
              lastDepth1String = buf.slice(depth1StringStart + 1, i);
              depth1StringStart = -1;
            }
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          if (stack.length === 1) depth1StringStart = i;
          continue;
        }

        if (ch === "{" || ch === "[") {
          // An array whose key, one level inside the outer object, was
          // literally `hits` — see the module docstring. Not "the first
          // array we meet there": a sibling array (or the word "hits"
          // showing up as some OTHER key's value) must not be mistaken for
          // it.
          if (
            ch === "[" &&
            hitsArrayDepth === -1 &&
            stack.length === 1 &&
            stack[0] === "{" &&
            lastDepth1String === "hits"
          ) {
            hitsArrayDepth = stack.length + 1;
            hitsArrayOpen = true;
          }
          // A '{' directly inside the hits array starts a new hit, unless
          // we're already inside one — then it's a nested object within a
          // hit, which counts for depth but is not itself a hit. Gated on
          // `hitsArrayOpen`, not just the depth number — see its declaration.
          if (ch === "{" && hitStart === -1 && hitsArrayOpen && stack.length === hitsArrayDepth) {
            hitStart = i;
          }
          stack.push(ch);
          continue;
        }

        if (ch === "}" || ch === "]") {
          stack.pop();
          if (ch === "}" && hitStart !== -1 && hitsArrayOpen && stack.length === hitsArrayDepth) {
            const raw = buf.slice(hitStart, i + 1);
            hitStart = -1;
            try {
              out.push(JSON.parse(raw));
            } catch {
              // Not actually a complete, well-formed object. `parseHits`'s
              // final pass over the whole text is the safety net — a hit
              // missed here is only ever late, never wrong. See the
              // docstring.
            }
          }
          // The confirmed hits array's OWN closing bracket: stack.length has
          // just dropped from hitsArrayDepth to hitsArrayDepth - 1, which can
          // only happen when the bracket that brought it up to hitsArrayDepth
          // in the first place — the hits array's `[` — is the one closing
          // (every hit's own `{`/`}` pair stays balanced within
          // [hitsArrayDepth, deeper], never dipping below it). Closing this
          // stops `hitsArrayOpen` gating from letting a LATER sibling array
          // at the same numeric depth be mistaken for still being inside
          // `hits` — the bug behind "ignores an array under a later sibling
          // key too" in tests/search-hits-stream.test.ts.
          if (hitsArrayOpen && stack.length === hitsArrayDepth - 1) {
            hitsArrayOpen = false;
          }
          if (stack.length === 0) {
            done = true;
          }
        }
      }

      return out;
    },
    text(): string {
      return buf;
    },
  };
}
