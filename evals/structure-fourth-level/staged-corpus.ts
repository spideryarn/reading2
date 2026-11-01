/**
 * The documents staged-run.ts measures — plan 261101d § The measurement.
 *
 * Read from the **local** database (staged-dump.ts), not production: the
 * previous run's copies of production blocks went with their worktree, and
 * local Supabase holds real copies of the same kinds of piece, the report's
 * paper included. Five are from 261101b's set, for comparison; fourteen are
 * fresh, used to tune nothing.
 */
export const PAPER = "arxiv-2308-08708-spya-w598t3";
export const BOOK = "s3-gdl-45mb-spya-cc9kr8";

export type Group = "paper" | "earlier" | "subheaded" | "flat" | "book";

export const STAGED_DOCS: readonly { slug: string; group: Group; why: string }[] = [
  { slug: PAPER, group: "paper", why: "the report's paper: 2.4's six h4s" },
  { slug: "arxiv-2602-11988-spya-fupe7p", group: "earlier", why: "261101b: wording 2 emptied it (unnumbered run-in h4s)" },
  { slug: "towards-a-theory-of-bugs-the-ruliology-of-the-unexpected", group: "earlier", why: "261101b: h2 only, 244 blocks" },
  { slug: "noema-mythology-of-conscious-ai", group: "earlier", why: "261101b: no sub-headings, long sections" },
  { slug: "what-if-we-had-bigger-brains-imagining-minds-beyond-ours", group: "earlier", why: "261101b: h2 only" },
  { slug: "arxiv-2307-09288v2-spya-smdqsk", group: "subheaded", why: "749 blocks, 21 h3, 32 h4" },
  { slug: "replication-crisis-spya-hrjamq", group: "subheaded", why: "551 blocks, 13 h3, 23 h4" },
  { slug: "race-human-categorization-spya-rpwc59", group: "subheaded", why: "663 blocks, 12 h3, 9 h4" },
  { slug: "synesthesia-spya-xkeccf", group: "subheaded", why: "320 blocks, 20 h3, 6 h4" },
  { slug: "spider-silk-spya-ge30uz", group: "subheaded", why: "263 blocks, 10 h3, 16 h4" },
  { slug: "arxiv-1810-spya-e24vmj", group: "subheaded", why: "229 blocks, 20 h3, 15 h4" },
  { slug: "gestalt-psychology-spya-wgsm0y", group: "subheaded", why: "182 blocks, 6 h3, 11 h4" },
  { slug: "arxiv-1706-03762v7-spya-wv4w9s", group: "subheaded", why: "159 blocks, 12 h3, 3 h4" },
  { slug: "haslemere-spya-a8he7z", group: "flat", why: "580 blocks, 52 h3, no h4" },
  { slug: "dodo-spya-nyc4ud", group: "flat", why: "427 blocks, 15 h3, no h4" },
  { slug: "simulators-spya-q2xbny", group: "flat", why: "333 blocks, 8 h3" },
  { slug: "nber-w31161-spya-dkgc83", group: "flat", why: "237 blocks, 4 h3" },
  { slug: "paul-graham-spya-wnuyuz", group: "flat", why: "135 blocks, no h3/h4" },
  { slug: BOOK, group: "book", why: "1,025 blocks on the whole-document path" },
];
