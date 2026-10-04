// First-pass census of glued footnote/citation digits in stored block text.
// Reads fd-snapshot.json; writes fd-candidates.json; prints a per-article table.
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL(`file://${process.env.FD_DATA}/`);
const snap = JSON.parse(readFileSync(new URL("fd-snapshot.json", dir), "utf8"));

const stepBy = new Map();
for (const s of snap.step_runs) stepBy.set(`${s.revision_id}:${s.step_name}`, s);
const blocksBy = new Map();
for (const b of snap.blocks) {
  if (!blocksBy.has(b.article_id)) blocksBy.set(b.article_id, []);
  blocksBy.get(b.article_id).push(b);
}

/* A candidate: 1-3 plain digits glued to a lower-case letter, a closing
   bracket/quote, or sentence punctuation that itself follows a letter; not
   followed by a digit or letter. Superscript digits anywhere after a letter or
   punctuation. Deliberately loose: precision is measured by reading. */
const PLAIN = /(?<![\d.,])([a-zß-ÿ)\]”’"'])([.,;:!?]?)(\d{1,3})(?![\d\w%°])(?!\.\d)/g;
const SUPER = /([\p{L})\]”’"'.,;:!?])([⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3})/gu;

const strip = (html) => html.replace(/<[^>]+>/g, "");
/** Is the digit run at this text offset inside a note-ref link / any anchor / a sup in the html? */
function markupAt(html, text, at, len) {
  // Walk html, tracking text offset and open tags.
  let ti = 0;
  const stack = [];
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|&[a-z#0-9]+;|[^<&]+|[<&]/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      if (m[1]) {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === m[2].toLowerCase()) { stack.splice(i, 1); break; }
      } else if (!/\/$/.test(m[3]) && !/^(br|img|hr|wbr)$/i.test(m[2])) {
        stack.push({ tag: m[2].toLowerCase(), attrs: m[3] });
      }
      continue;
    }
    const n = m[0].startsWith("&") && m[0].length > 1 ? 1 : m[0].length;
    if (at >= ti && at < ti + n) {
      const a = stack.find((s) => s.tag === "a");
      return {
        noteRef: stack.some((s) => /data-spya-note-ref/.test(s.attrs)),
        anchor: !!a,
        sup: stack.some((s) => s.tag === "sup"),
        cite: stack.some((s) => s.tag === "mark" || /data-cite/.test(s.attrs)),
      };
    }
    ti += n;
  }
  return { noteRef: false, anchor: false, sup: false, unknown: true };
}

const candidates = [];
const rows = [];
for (const a of snap.articles) {
  const blocks = blocksBy.get(a.id) ?? [];
  const ext = stepBy.get(`${a.revision_id}:extract`);
  let n = 0, linked = 0, supOnly = 0, bare = 0, stray = 0, noteRefsTotal = 0;
  const noteBlocks = blocks.filter((b) => b.role === "footnote").length;
  const refBlocks = blocks.filter((b) => b.role === "reference").length;
  for (const b of blocks) {
    noteRefsTotal += (b.html.match(/data-spya-note-ref/g) ?? []).length;
    if (b.role === "footnote" || b.role === "reference") continue;
    if (b.kind !== "text" && b.kind !== "heading" && b.kind !== "list-item" && b.kind !== undefined) {
      /* keep going: kinds vary; filter by tag instead */
    }
    if (/^(pre|table|figure|img|hr)$/i.test(b.tag)) continue;
    const text = b.text;
    for (const [re, kind] of [[PLAIN, "plain"], [SUPER, "super"]]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const digits = kind === "plain" ? m[3] : m[2];
        const at = m.index + m[0].length - digits.length;
        const mk = markupAt(b.html, text, at, digits.length);
        const after = text.slice(at + digits.length, at + digits.length + 3);
        const strayPunct = /^ [,.;:]/.test(after);
        const c = {
          article: a.slug, articleId: a.id, block: b.block_id, ordinal: b.ordinal, tag: b.tag, kind,
          digits, at, ctx: text.slice(Math.max(0, m.index - 40), at + digits.length + 25),
          wide: `${text.slice(Math.max(0, at - 110), at)}⟦${digits}⟧${text.slice(at + digits.length, at + digits.length + 50)}`,
          ...mk, strayPunct,
        };
        candidates.push(c);
        n++;
        if (mk.noteRef) linked++;
        else if (mk.anchor) linked++;
        else if (mk.sup) supOnly++;
        else bare++;
        if (strayPunct) stray++;
      }
    }
  }
  rows.push({
    slug: a.slug.slice(0, 44), owner: a.owner_id.slice(0, 4), created: a.created_at.slice(0, 10),
    arch: a.archived_at ? "A" : "", method: a.extract_method ?? a.source ?? "?", ct: (a.raw_content_type ?? "").slice(0, 16),
    extV: ext ? `${ext.implementation_version ?? ""}/${ext.prompt_version ?? ""}` : "", extAt: ext?.finished_at?.slice(0, 10) ?? "",
    blocks: blocks.length, cand: n, linked, supOnly, bare, stray, noteRefs: noteRefsTotal, noteBlocks, refBlocks,
    cites: a.has_citations ? "y" : "",
  });
}
writeFileSync(new URL("fd-candidates.json", dir), JSON.stringify(candidates));
console.table(rows.filter((r) => r.blocks > 0));
console.log("articles with no current blocks:", rows.filter((r) => r.blocks === 0).length);
console.log("total candidates", candidates.length, "bare", candidates.filter((c) => !c.anchor && !c.sup).length);
