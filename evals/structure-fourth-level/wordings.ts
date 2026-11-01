/**
 * **The two toc/14 wordings that were measured and not shipped**, kept so the
 * next attempt starts from them rather than from memory. Plan 261029a § Stage 2,
 * docs/investigations/261101b-structure-fourth-level-two-wordings-measured.md.
 *
 * Each replaced exactly these two bullets of the live prompt's STRUCTURE block
 * (src/structure.ts § STRUCTURE_BASE_SYSTEM):
 *
 *   - Go 3 levels deep: root (depth 0), chapters (depth 1), sections (depth 2).
 *   - Do NOT emit leaf nodes for individual blocks. Stop at the section level.
 *
 * and both went with a schema whose depth-2 node had an optional, non-empty
 * `children` array of depth-3 nodes (title, gist, start, sourceHeading). The
 * second also replaced the OUTPUT example. Commits df05311ea and e2482c1fc hold
 * them in place; results in evals/results/structure-fourth-level/ (after-*,
 * after2-*).
 */

/** First wording (df05311ea). Lost the section level on 2607-22753 in both runs; 43 of 340 sub-headings made. */
export const WORDING_1_DEPTH = `- Go 3 levels deep: root (depth 0), chapters (depth 1), sections (depth 2).
  A section may have ONE more level, sub-sections (depth 3), in two cases only:
    - the author divides it with headings one level down. Each of those
      headings starts a sub-section.
    - it has at least 10 blocks and holds several clearly separate topics.
      Then propose sub-sections where each one begins. Length alone is not
      enough: the ~9-block rule above is for chapters and sections, not for
      sub-sections.
  A divided section has at least 2 sub-sections. Most sections have none.
- Work out the author's levels from the headings' numbering and neighbours
  as well as their <hN> tags, which are sometimes wrong. A heading at the
  level of the headings that start the neighbouring sections starts a
  section of its own, never a sub-section, and is never left inside another
  section. A heading one level below starts a sub-section. Headings deeper
  still stay inside their sub-section: the tree stops at depth 3, so this is
  the one place a heading does not begin a node. The 5-9 target does not
  apply to sub-sections: make as many as the headings or topics give.
- Sub-sections cover their whole section, from its first block. Where a
  section has prose of its own before its first sub-heading, that prose is
  its own first sub-section: give it a new title for what it says and no
  "sourceHeading". Do not repeat the section's heading.
- Do NOT emit leaf nodes for individual blocks. Stop at the section level,
  or at the sub-section level where there is one.`;

/** Second wording (e2482c1fc), Opus's. Passed the paper; lost the section level on arxiv-2602-11988 in both runs. */
export const WORDING_2_DEPTH = `- Go up to 4 levels deep: root (depth 0), chapters (depth 1), sections
  (depth 2), sub-sections (depth 3).
- Map the author's heading levels onto depths in order: the highest level
  used below the title starts chapters, the next level down starts sections,
  and the level below that starts sub-sections. Judge a heading's level by
  its numbering first and its <hN> tag second, since tags are sometimes
  wrong: "2.5" is a section beside "2.4" whatever its tag, and "2.4.5(a)"
  stays inside the node that holds 2.4.5. Headings below the sub-section
  level stay inside their sub-section.
- Where the author gives a chapter no sections, divide it into sections
  yourself by the ~9-block rule above, exactly as before.
- Where the author divides a section with sub-headings, give it one
  sub-section per sub-heading, as many as there are. If the section has
  prose before its first sub-heading, that prose is its first sub-section,
  with a title you write and no "sourceHeading".
- A section with no sub-headings stays undivided, unless it runs to 10 or
  more blocks and covers clearly separate topics; then give it 2 or more
  sub-sections at those topic shifts.
- Do NOT emit leaf nodes for individual blocks. The deepest node is a
  sub-section where a section has them, and the section where it does not.`;

/** The second wording's OUTPUT example, replacing toc/11's. */
export const WORDING_2_OUTPUT = `{"root": {"title": "...", "gist": "...", "question": "...",
          "sourceHeading": "...", "children": [
            {"title": "...", "gist": "...", "question": "...",
             "start": <firstBlockNumber>, "sourceHeading": "...", "children": [
               {"title": "...", "gist": "...", "start": <firstBlockNumber>,
                "sourceHeading": "..."},
               {"title": "...", "gist": "...", "start": <firstBlockNumber>,
                "sourceHeading": "...", "children": [
                  {"title": "...", "gist": "...", "start": <firstBlockNumber>},
                  {"title": "...", "gist": "...", "start": <firstBlockNumber>,
                   "sourceHeading": "..."}
                ]}
             ]}
          ]}}`;
