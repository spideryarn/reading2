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
 * It does not check which key the array belongs to, either: the first `[` it
 * meets one level inside the outer object is treated as the hits array,
 * because the prompt only ever puts one array there. Prose before the object
 * ("Here you go:") and a ```` ```json ```` fence are ignored the same way
 * `parseHits` ignores them — nothing before the outer `{` is looked at, and
 * once the outer object's matching `}` closes, nothing after it is either.
 *
 * WHAT THIS DOES NOT DO: validate anything about a hit's shape. `validateHits`
 * in search.ts still owns that, and still needs the block list to check a
 * `blockId` and a `quote` against — this module is never given it, and
 * returns whatever `JSON.parse` produces.
 *
 * THE SAFETY PROPERTY THIS DEPENDS ON: `push` is allowed to miss a hit, split
 * one wrongly, or emit nothing at all — the worst that costs is a late hit,
 * never a wrong one. `text()` returns every character fed to it, unmodified
 * and in order, so the caller can still run the whole response through
 * `parseHits` + `validateHits` once the stream ends, exactly as it does
 * today; that final pass is the actual source of truth, and this module is
 * only ever showing the reader its answer sooner. That guarantee holds only
 * because `push` never mutates or drops anything from what it appends to the
 * buffer `text()` reads back — it only ever reads from that buffer, never
 * changes it.
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

  // stack.length at which we are directly inside the hits array, once found.
  // -1 means "not found yet".
  let hitsArrayDepth = -1;
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
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }

        if (ch === "{" || ch === "[") {
          // The first array one level inside the outer object is the hits
          // array — see the module docstring on why the key isn't checked.
          if (ch === "[" && hitsArrayDepth === -1 && stack.length === 1 && stack[0] === "{") {
            hitsArrayDepth = stack.length + 1;
          }
          // A '{' directly inside the hits array starts a new hit, unless
          // we're already inside one — then it's a nested object within a
          // hit, which counts for depth but is not itself a hit.
          if (ch === "{" && hitStart === -1 && stack.length === hitsArrayDepth) {
            hitStart = i;
          }
          stack.push(ch);
          continue;
        }

        if (ch === "}" || ch === "]") {
          stack.pop();
          if (ch === "}" && hitStart !== -1 && stack.length === hitsArrayDepth) {
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
          if (stack.length === 0) {
            done = true;
          }
          continue;
        }
      }

      return out;
    },
    text(): string {
      return buf;
    },
  };
}
