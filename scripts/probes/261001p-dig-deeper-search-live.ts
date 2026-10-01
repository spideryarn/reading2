/**
 * **One live *Dig deeper* search**, through the production `searchFirst` and
 * `openRouterJson` — plan 261001p stage 1. It answers the question the unit
 * tests cannot: does the quick tier's model accept `tool_choice: "required"`
 * and the Exa tool through the `dig-deeper-search` route, `require_parameters`
 * and all, and does the usage witness see the search?
 *
 * About a cent. No library search (that needs a reader), no answer call.
 *
 *     npx tsx scripts/probes/261001p-dig-deeper-search-live.ts
 */
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { searchFirst } from "../../src/dig-deeper.js";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const started = Date.now();
const { result, report } = await collectSpend(() =>
  searchFirst({
    slug: "probe",
    subject: "predictive processing",
    article: { title: "Surfing Uncertainty", author: "Andy Clark", date: "2016" },
    context: "Clark calls this view of the brain predictive processing.",
  }),
);
console.log(
  JSON.stringify(
    {
      ms: Date.now() - started,
      searches: result.searches,
      sources: result.sources.map((s) => ({ url: s.url, title: s.title, excerptChars: s.excerpt.length })),
      libraryQuery: result.libraryQuery,
      calls: report.calls.map((c) => ({ job: c.job, model: c.model, outcome: c.outcome })),
      totalUsd: totalSpend(report.calls).nanos / 1e9,
    },
    null,
    2,
  ),
);
