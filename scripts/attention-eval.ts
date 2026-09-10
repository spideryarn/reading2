/**
 * Score the attention classifier over the labelled set — plan 260910f, Stage 3.
 *
 *   npx tsx scripts/attention-eval.ts [--prompt-version N] [--fake] [--out <file.json>]
 *
 * `--fake` answers from the labels by a documented, deterministic perturbation
 * (`fakeClassifierFromLabels` in tools/overseer/attention-eval.ts) and makes no
 * call. It exists to see the report's shape and to run in tests' company.
 *
 * WITHOUT `--fake` IT SPENDS — a few cents over the labelled set — through the
 * one paid seam and nothing else: `paidEvalClassifier` reserves every call
 * against a day budget of its own in a fresh temp directory, so an evaluation
 * can never eat the daemon's day. The key comes from `readGatewayKey` in
 * tools/overseer/attention-cli.ts rather than being read here, so the spend scan
 * in tests/no-undeclared-spend.test.ts still sees one file naming the
 * credential, not two.
 *
 * `--prompt-version` is passed through to the report. Only version 1 exists
 * until Stage 2 adds the proposal-aware prompt, so any other is refused.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { readGatewayKey } from "../tools/overseer/attention-cli.js";
import { ATTENTION_CLASSIFIER_MODEL, CLASSIFIER_PROMPT_VERSION } from "../tools/overseer/attention-classify.js";
import {
  describeEvaluation,
  evaluate,
  fakeClassifierFromLabels,
  loadLabelledSet,
  paidEvalClassifier,
} from "../tools/overseer/attention-eval.js";

async function main(): Promise<number> {
  let values: { "prompt-version"?: string; fake?: boolean; out?: string };
  try {
    ({ values } = parseArgs({
      options: {
        "prompt-version": { type: "string" },
        fake: { type: "boolean" },
        out: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (cause) {
    console.error(`${String(cause instanceof Error ? cause.message : cause)}\n` +
      "usage: npx tsx scripts/attention-eval.ts [--prompt-version N] [--fake] [--out <file.json>]");
    return 2;
  }

  const promptVersion = values["prompt-version"] === undefined ? CLASSIFIER_PROMPT_VERSION : Number(values["prompt-version"]);
  if (promptVersion !== CLASSIFIER_PROMPT_VERSION) {
    console.error(
      `prompt version ${values["prompt-version"]} does not exist: the classifier has only version ${CLASSIFIER_PROMPT_VERSION}. ` +
        "Stage 2 of plan 260910f adds the proposal-aware version.",
    );
    return 2;
  }

  const { labels, captures } = loadLabelledSet();
  let classify: Parameters<typeof evaluate>[2];
  let model: string;
  if (values.fake === true) {
    classify = fakeClassifierFromLabels(labels, captures);
    model = `fake (labels, perturbed) standing in for ${ATTENTION_CLASSIFIER_MODEL}`;
  } else {
    const key = readGatewayKey();
    if (key === null) {
      console.error(
        "The gateway key is not set in this environment, and a real run needs it — readGatewayKey in\n" +
          "tools/overseer/attention-cli.ts says where it is read from and why not .env.local. Use --fake to see\n" +
          "the report without spending anything.",
      );
      return 1;
    }
    const paid = paidEvalClassifier(key);
    classify = paid.classify;
    model = ATTENTION_CLASSIFIER_MODEL;
    // Said up front, so a person can read the ledger this run spent against.
    console.log(`day budget for this run: ${paid.budgetRoot} (its own, not the daemon's)`);
  }

  const report = await evaluate(labels, captures, classify, { promptVersion, model });
  for (const line of describeEvaluation(report)) console.log(line);
  if (values.out !== undefined) {
    writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${values.out}`);
  }
  return 0;
}

process.exitCode = await main();
