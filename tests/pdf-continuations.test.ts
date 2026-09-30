/**
 * **Which record a PDF record carries on from** — `continuationTargets` in
 * src/pdf-read.ts, the one join rule `renderHtml` and `mendSeamHyphens` share.
 *
 * The cases are real: record sequences from articles on production, surveyed
 * 2026-09-30 for feedback SPIDERYARN-READING2-69, cut to a sentence either side
 * of the boundary. In every one the model had marked the second half
 * `continues: true`, and the reader still got half a sentence, a figure or
 * nothing, and a paragraph starting in lower case, because the renderer only
 * joined onto the record immediately before. The negatives are real too where
 * the survey had one. docs/plans/260930e-pdf-transcription-glitches.md.
 *
 * Deterministic, so a test and not an eval: this is where "add those papers to
 * our evals" lands for this class of glitch. No PDF is committed — several of
 * these are not openly licensed — and none is needed.
 */
import { describe, expect, it } from "vitest";
import type { PdfRecord } from "../src/pdf.js";
import { continuationTargets, renderHtml } from "../src/pdf-read.js";

const RAW_SHA = "c".repeat(64);

const r = (page: number, type: PdfRecord["type"], text: string, continues = false): PdfRecord => ({
  page,
  type,
  text,
  continues,
  uncertain: false,
});

/** The article's body, as the reader gets it: one entry per rendered block. */
const blocks = (records: PdfRecord[]) =>
  [...renderHtml(records, "T", RAW_SHA).matchAll(/<(p|figure|h[1-3]|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/g)].map(
    (m) => `${m[1]}: ${m[2]!.replace(/<[^>]+>/g, "")}`,
  );

describe("across the running footer at a page turn", () => {
  it("joins the NIH manuscript paragraph its page footer cut in two (Chrysikou et al., pp. 2–3)", () => {
    const records = [
      r(2, "paragraph", "For example, infants can discriminate phonetic contrasts not used in their native language; in contrast, adults have trouble perceiving"),
      r(2, "publisher", "Chrysikou et al. Page 2"),
      r(2, "publisher", "Neuropsychologia. Author manuscript; available in PMC 2014 September 18."),
      r(2, "publisher", "NIH-PA Author Manuscript NIH-PA Author Manuscript NIH-PA Author Manuscript"),
      r(3, "paragraph", "such distinctions (Best, McRoberts, & Goodell, 2001).", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null, null, 0]);
    expect(blocks(records)).toEqual([
      "p: For example, infants can discriminate phonetic contrasts not used in their native language; in contrast, adults have trouble perceiving such distinctions (Best, McRoberts, &amp; Goodell, 2001).",
    ]);
  });

  it("joins across a footnote at the foot of the page (Chrysikou et al., pp. 16–17)", () => {
    const records = [
      r(16, "paragraph", "have also been observed in neuro-typical subjects: temporarily"),
      r(16, "footnote", "3It is important to note that a matched filter is not the same as an attentional filter."),
      r(17, "paragraph", "disrupting left prefrontal cortex activity using rapid transcranial magnetic stimulation.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, 0]);
  });

  it("will not join across furniture on the same page, which is the Kuhn front-matter case", () => {
    /* tests/pdf-frontmatter-wiring.test.ts: `Available online 26 January 2024`
       is hidden (retyped `publisher`) precisely so the sentence after it stops
       joining onto it. Bridging it on the same page would glue that sentence
       onto the author's name instead. */
    const records = [
      r(1, "paragraph", "Robert Lawrence Kuhn"),
      r(1, "publisher", "Available online 26 January 2024"),
      r(1, "paragraph", "and array them in some kind of meaningful structure.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null]);
  });

  it("will not join across a reference-list entry, which is not furniture", () => {
    const records = [
      r(9, "paragraph", "as we argue in the next section, the"),
      r(9, "reference", "Bartlett, F. C. (1932). Remembering. Cambridge University Press."),
      r(10, "paragraph", "effect was not replicated.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null]);
  });
});

describe("back past a figure or table printed mid-paragraph", () => {
  it("joins the sentence a figure interrupted, and leaves the figure after it (Webb et al., p. 2)", () => {
    const records = [
      r(2, "paragraph", "Human reasoners are capable of extracting abstract"),
      r(2, "figure", "Figure 1: Matrix reasoning problems. Results reflect average performance across multiple problems."),
      r(2, "paragraph", "rules (though not the ability to do so directly from pixels).", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, 0]);
    expect(blocks(records)).toEqual([
      "p: Human reasoners are capable of extracting abstract rules (though not the ability to do so directly from pixels).",
      "figure: Figure 1: Matrix reasoning problems. Results reflect average performance across multiple problems.",
    ]);
  });

  it("joins past a table, its cells and its note (Ross & Holland, p. 5)", () => {
    const records = [
      r(4, "paragraph", "There were no reliable differences between Group C and"),
      r(5, "table", "Table 2\nPretest Responding in Experiment 2"),
      r(5, "tabledata", "Rear | 0 | 28 | 6 | 28"),
      r(5, "footnote", "Note—Entries for startle responding indicate the percentage of trials."),
      r(5, "paragraph", "Group D in the frequency of any of the behaviors.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null, null, 0]);
  });

  it("does not cross a page that is wholly a figure — not yet (Krichmar, pp. 1–3)", () => {
    /* A real cut: page 2 is Figure 1, and the sentence resumes on page 3. But
       "the records between fill page 2" cannot tell a figure page from a page
       whose prose the model dropped, so this is left for when there is page
       evidence to decide it (GPT Sol, plan review F4). It stays as it was. */
    const records = [
      r(1, "paragraph", "Every week we would discuss the progress on our brain-based devices and"),
      r(1, "publisher", "arXiv:2105.10461v2 [q-bio.NC] 25 May 2021"),
      r(2, "figure", "Figure 1: Copy of the roadmap for a Conscious Artifact from my lab notebook in 2006."),
      r(3, "table", "Table 1: Conscious Artifact"),
      r(3, "tabledata", "1) Reentrant Architecture"),
      r(3, "paragraph", "how we could test theories of neuroscience using those simulations.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null, null, null, null]);
  });

  it("will not cross a page with nothing on it either", () => {
    const records = [
      r(1, "paragraph", "Every week we would discuss the progress on our brain-based devices and"),
      r(3, "figure", "Figure 1: Copy of the roadmap."),
      r(3, "paragraph", "how we could test theories of neuroscience using those simulations.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null]);
  });

  it("will not reach past a boxed statement onto a paragraph that had ended (Baldassano et al., pp. 1–2)", () => {
    /* The real predecessor ends `(van Kesteren et al., 2010,` on page 1; the
       Significance Statement box, the page's footnotes and Figure 1 all come
       between. Joining onto the box's last paragraph — which ends in a full
       stop — would rewrite a paragraph that was whole. Declining leaves the
       continuation as its own paragraph, as before. */
    const records = [
      r(1, "paragraph", "Schematic knowledge has been linked to several brain regions, including the hippocampus (van Kesteren et al., 2010,"),
      r(1, "footnote", "The authors declare no competing financial interests."),
      r(1, "heading2", "Significance Statement"),
      r(1, "paragraph", "We find that these regions maintain a representation of the general type of situation being perceived."),
      r(2, "figure", "Figure 1. Experimental stimuli. All stories were approximately 3 min long."),
      r(2, "paragraph", "2012; Robin and Moscovitch, 2017) and cortical regions, such as posterior cingulate.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null, null, null, null]);
  });

  it("does not join a heading onto its run-in paragraph (Ross & Holland, p. 4)", () => {
    /* `Pretest.` is printed at the start of the paragraph's first line, so the
       model calls the paragraph `continues`. A heading is not prose a figure
       could have interrupted, and the types differ, so each stays itself. */
    const records = [
      r(4, "heading3", "Pretest."),
      r(4, "paragraph", "Table 2 shows behaviors in response to the tone and light.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null]);
    expect(blocks(records)).toEqual([
      "h3: Pretest.",
      "p: Table 2 shows behaviors in response to the tone and light.",
    ]);
  });

  it("will not reach back past a heading", () => {
    const records = [
      r(3, "paragraph", "the results of the first experiment, which"),
      r(3, "heading2", "3.2 Thalamo-Cortical System"),
      r(3, "figure", "Figure 2: The thalamus."),
      r(3, "paragraph", "were replicated in the second.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null, null]);
  });

  it("joins a caption that runs onto the next page inside its figcaption, and mints its ref from the whole", () => {
    /* GPT Sol, plan review F3: appending to finished HTML put the second half
       after </figcaption>, where asset collection never reads it, and the ref
       was minted from half a caption. And the continuation is not a figure of
       page 5, so the next figure there is still page 5's first. */
    const whole = "Figure 3. Pattern similarity in mPFC for the intact and scrambled groups.";
    const next = "Figure 4. Classification accuracy.";
    const records = [
      r(4, "figure", "Figure 3. Pattern similarity in mPFC for the"),
      r(4, "publisher", "J. Neurosci., October 31, 2018"),
      r(5, "figure", "intact and scrambled groups.", true),
      r(5, "figure", next),
    ];
    expect(continuationTargets(records)).toEqual([null, null, 0, null]);
    const html = renderHtml(records, "T", RAW_SHA);
    const figure = (page: number, caption: string) =>
      /<figure[^>]*>/.exec(renderHtml([r(page, "figure", caption)], "T", RAW_SHA))![0];
    expect(html).toContain(`${figure(4, whole)}<figcaption>${whole}</figcaption></figure>`);
    expect(html).toContain(`${figure(5, next)}<figcaption>${next}</figcaption></figure>`);
  });

  it("will not reach past a line the front-matter pass set aside, even at a page turn", () => {
    /* GPT Sol, plan review F1: the model's `continues` was about the hidden
       record. Its `publisher` type is ours, so it is a barrier, not furniture —
       or the paragraph joins onto the author's name. */
    const records = [
      r(1, "paragraph", "Jane Doe"),
      r(1, "publisher", "Available online 26 January 2024"),
      r(2, "paragraph", "and describes the experiment.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, 0]);
    expect(continuationTargets(records, new Set([1]))).toEqual([null, null, null]);
  });

  it("does not reach a list item back past a figure — only paragraphs, which is the evidence", () => {
    /* Joining it would repair the item's prose and still leave one authored
       list as two <ul>s either side of the figure (GPT Sol, plan review F5). */
    const records = [
      r(6, "listitem", "The first item, which is long enough that"),
      r(6, "figure", "Figure 4: A diagram."),
      r(6, "listitem", "it runs on after the figure.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null]);
  });

  it("will not join a finished paragraph back past a continued caption", () => {
    /* GPT Sol's sequence (plan review F2): the caption continuation joins its
       figure, and the paragraph after it says `continues` too — but the
       paragraph before the figure is finished, and a lower-case start is no
       evidence it was this paragraph that was cut. */
    const records = [
      r(7, "paragraph", "The control analysis was complete."),
      r(7, "figure", "Figure 2. Pattern similarity for the"),
      r(7, "figure", "caption continued.", true),
      r(7, "paragraph", "the replication used a larger sample.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, 1, null]);
  });

  it("will not join a finished paragraph back past a table and its cells", () => {
    const records = [
      r(7, "paragraph", "The control analysis was complete."),
      r(7, "table", "Table 3. Responses"),
      r(7, "tabledata", "Rear | 0 | 28"),
      r(7, "paragraph", "The replication used a larger sample.", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null, null]);
  });

  it("recognises Unicode sentence endings and closing brackets as finished", () => {
    /* `continues` can be internally inconsistent around a float, so the
       predecessor's punctuation is the safety check. Japanese full stop and
       corner bracket are the same visible evidence as `.\u201d`; treating them as
       unfinished glues two complete paragraphs together. */
    const records = [
      r(7, "paragraph", "対照分析は完了した。】"),
      r(7, "figure", "図2. パターン類似性。"),
      r(7, "paragraph", "次の分析では、より大きな標本を用いた。", true),
    ];
    expect(continuationTargets(records)).toEqual([null, null, null]);
  });
});
