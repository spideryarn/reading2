/* What a re-render / re-import would do to one production article, offline.
   usage: npx tsx fd-measure.ts cached            (today's renderer over production's cached transcription)
          npx tsx fd-measure.ts fresh             (fresh local imports: fd-imp-*.json)
   No model call, no write anywhere but the scratchpad. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { renderHtml } from "../../src/pdf-read.js";
import { splitIntoBlocks } from "../../src/blocks.js";

/* FD_DATA: a directory OUTSIDE the repo holding the snapshot; it is real articles and is never committed. */
const S = `${process.env.FD_DATA}/`;
const j = (n: string) => JSON.parse(readFileSync(S + n, "utf8"));
const snap = j("fd-snapshot.json");
const lab: any[] = j("fd-labelled.json");

const by = <T,>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
  return m;
};
const prodBlocks = by<any>(snap.blocks, (b) => b.article_id);
const comments = by<any>(snap.comments, (c) => c.article_id);
const threads = by<any>(snap.chat_threads, (c) => c.article_id);
const reading = by<any>(snap.reading_time, (c) => c.article_id);
const idsIn = (rows: any[]) => by<any>(rows.filter((r) => r.ids?.length), (r) => r.article_id);
const derived = { search: idsIn(snap.search_runs), criteria: idsIn(snap.referee_criteria), claims: idsIn(snap.referee_claims), chatMsgs: idsIn(snap.chat_messages) };
const linkSums = by<any>(snap.link_summaries, (c) => c.article_id);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function measure(a: any, html: string) {
  const prev = prodBlocks.get(a.id) ?? [];
  const previous = prev.map((b) => ({ id: b.block_id, tag: b.tag, kind: b.kind, text: b.text, html: b.html, words: 0, gistable: true, role: b.role ?? undefined, noteId: b.note_id ?? undefined }));
  const split = splitIntoBlocks(html, previous as any);
  const now = new Map(split.blocks.map((b) => [b.id, b]));
  const lost = new Set(prev.filter((b) => !now.has(b.block_id)).map((b) => b.block_id));
  const textChanged = prev.filter((b) => now.has(b.block_id) && norm(now.get(b.block_id)!.text) !== norm(b.text)).length;

  /* Reader's own things. A comment or passage chat needs its block AND its quote. */
  const anchors = [
    ...(comments.get(a.id) ?? []).map((c) => ({ kind: "comment", block: c.block_id, quote: c.quote })),
    ...(threads.get(a.id) ?? []).filter((t) => t.anchor_block_id).map((t) => ({ kind: "chat", block: t.anchor_block_id, quote: t.anchor_quote })),
  ];
  let blockGone = 0, quoteGone = 0;
  for (const an of anchors) {
    if (lost.has(an.block) || !now.has(an.block)) blockGone++;
    else if (an.quote && !norm(now.get(an.block)!.text).includes(norm(an.quote))) quoteGone++;
  }
  const rt = reading.get(a.id) ?? [];
  const rtLost = rt.filter((r) => lost.has(r.block_id));
  const idsLost = (rows: any[] | undefined) => {
    const all = new Set<string>((rows ?? []).flatMap((r) => r.ids));
    const known = [...all].filter((id) => prev.some((b) => b.block_id === id));
    return `${known.filter((id) => lost.has(id)).length}/${known.length}`;
  };

  /* Markers. Footnote-labelled production places, by block: is that block's
     html now carrying a note-ref for those digits? */
  const refs = (html.match(/data-spya-note-ref/g) ?? []).length;
  const notes = (html.match(/data-spya-note="/g) ?? []).length;
  const body = split.blocks.filter((b: any) => b.role !== "footnote" && b.role !== "reference");
  const bodyText = body.map((b) => b.text).join("\n");
  const strayAfter = (html.match(/<\/a><\/sup> [.,;:?!]/g) ?? []).length;
  const stillGlued = (bodyText.match(/(?<![\d.,])[a-z)\]”’"'][.,;:!?]?\d{1,3}(?![\d\w%°])(?!\.\d)/g) ?? []).length;
  const prodFoot = lab.filter((x) => x.articleId === a.id && x.label === "footnote").length;
  const prodCite = lab.filter((x) => x.articleId === a.id && x.label === "citation").length;

  return {
    slug: a.slug.slice(0, 30), was: (a.extract_method ?? "").split("/").pop(),
    prodBlocks: prev.length, newBlocks: split.blocks.length, kept: prev.length - lost.size, lost: lost.size, textChanged,
    notes, linked: refs, prodFoot, prodCite, gluedLeft: stillGlued, stray: strayAfter,
    anchors: anchors.length, anchorBlockGone: blockGone, anchorQuoteGone: quoteGone,
    readLost: `${rtLost.length}/${rt.length}`, readSecLost: Math.round(rtLost.reduce((s, r) => s + r.seconds, 0)),
    chatMsgIds: idsLost(derived.chatMsgs.get(a.id)), searchIds: idsLost(derived.search.get(a.id)),
    refereeIds: idsLost([...(derived.criteria.get(a.id) ?? []), ...(derived.claims.get(a.id) ?? [])]),
    linkSum: `${(linkSums.get(a.id) ?? []).filter((l) => lost.has(l.block_id)).length}/${(linkSums.get(a.id) ?? []).length}`,
    _lost: prev.filter((b) => lost.has(b.block_id)).map((b) => ({ id: b.block_id, tag: b.tag, role: b.role, text: b.text.slice(0, 80) })),
  };
}

const mode = process.argv[2];
const rows: any[] = [];
const detail: Record<string, any> = {};
if (mode === "cached") {
  const chunks = by<any>(j("fd-chunks.json").chunks, (c) => c.article_id);
  for (const a of snap.articles) {
    const cs = chunks.get(a.id);
    if (!cs || !prodBlocks.get(a.id)) continue;
    const firstPage = (c: any) => Math.min(...c.value.records.map((r: any) => r.page));
    const sorted = cs.filter((c) => c.value?.records?.length).sort((p, q) => firstPage(p) - firstPage(q) || (p.created_at < q.created_at ? 1 : -1));
    const seen = new Set<number>();
    const records: any[] = [];
    for (const c of sorted) {
      const pages = new Set<number>(c.value.records.map((r: any) => r.page));
      for (const r of c.value.records) if (!seen.has(r.page)) records.push(r);
      for (const p of pages) seen.add(p);
    }
    records.sort((p, q) => p.page - q.page);
    const html = renderHtml(records, a.title ?? "t", a.raw_sha256 ?? "0".repeat(64));
    const m = measure(a, html);
    /* A cache that holds only part of the article says nothing about ids. */
    (m as any).pagesCached = `${seen.size}/${a.pages ?? "?"}`;
    rows.push(m);
    detail[a.slug] = { lost: m._lost, html };
  }
} else if (mode === "freshfixed") {
  /* The fresh imports' own records, rendered again by the code as it is now. */
  const local = j("fd-local-records.json");
  for (const [slug, records] of Object.entries<any[]>(local)) {
    const key = ["nagel-bat", "entropy-26-00481", "s41598-023", "nihms-536461", "jco-2005"].find((k) => slug.includes(k.slice(0, 10)))!;
    const a = snap.articles.find((x: any) => x.slug.includes(key));
    const seen = new Set<string>();
    const uniq = records.filter((r) => { const k = `${r.page}:${r.type}:${r.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const m = measure(a, renderHtml(uniq, a.title ?? "t", a.raw_sha256 ?? "0".repeat(64)));
    rows.push(m);
    detail[a.slug] = { lost: m._lost };
  }
} else {
  for (const short of ["nagel", "entropy", "entropy2", "s41598", "nihms", "jco"]) {
    if (!existsSync(`${S}fd-imp-${short}.json`)) continue;
    const imp = j(`fd-imp-${short}.json`);
    const key = { nagel: "nagel-bat", entropy: "entropy-26-00481", entropy2: "entropy-26-00481", s41598: "s41598-023", nihms: "nihms-536461", jco: "jco-2005" }[short]!;
    const a = snap.articles.find((x: any) => x.slug.includes(key));
    const m = measure(a, imp.extractedHtml);
    (m as any).now = (imp.extractMethod ?? "").split("/").pop();
    rows.push(m);
    detail[a.slug] = { lost: m._lost };
  }
}
console.table(rows.map(({ _lost, ...r }) => r));
writeFileSync(`${S}fd-measure-${mode}.json`, JSON.stringify({ rows, detail }));
