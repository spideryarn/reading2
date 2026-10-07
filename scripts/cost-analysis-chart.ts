/**
 * **The report's per-day chart: the page's own component, rendered to a
 * string.** One chart implementation, not two — plan 261005a § Charts and
 * tables. `src/web/cost-charts.tsx` is styled with attributes and CSS custom
 * properties only, so its static markup stands alone in a file that has no
 * stylesheet but the report's own (scripts/cost-analysis-html.ts defines every
 * name in `CHART_TOKENS`).
 *
 * ## Why the import is by path, at run time
 *
 * The chart is a `.tsx` in the browser project. This file is in the node
 * project, which has no `jsx` setting and refuses to follow an import into
 * one (tsconfig.json § exclude). So the module is loaded by a computed path
 * the compiler does not follow, and typed by `ChartModule` below — which
 * tests/cost-analysis-html.test.ts assigns the real module to, in the tests
 * project where both compile, so a changed prop is a type error there.
 *
 * The component names the automatic React JSX runtime in its own pragma, so
 * loading it here does not need to mutate `globalThis`.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CostAnalysis } from "../src/cost-analysis.js";
import { COST_CATEGORIES } from "../src/cost-categories.js";
import type { DaySeries } from "../src/web/admin-costs-view.js";

/** What this file uses of src/web/cost-charts.tsx. */
export interface ChartModule {
  CHART_TOKENS: readonly string[];
  StackedDayChart: (props: {
    data: DaySeries;
    colourKeys: readonly string[];
    label: string;
  }) => React.ReactNode;
}

/** The analysis's per-day figures in the shape the chart draws. */
export function daySeriesOf(analysis: CostAnalysis): DaySeries {
  const { days, categories, nanos } = analysis.overTime;
  return {
    days: [...days],
    series: categories.map((category) => ({ key: category, label: category })),
    values: new Map(days.map((day) => [day, new Map(Object.entries(nanos[day] ?? {}))])),
  };
}

/**
 * Every category, alphabetically: the order hues are handed out in, so a
 * category is the same colour in every report whatever else is in it.
 */
export const CATEGORY_COLOUR_ORDER: readonly string[] = [...COST_CATEGORIES].sort();

async function loadCharts(): Promise<ChartModule> {
  /* From the directory, not `import.meta.url`: under a jsdom test that is an
     `http:` address. */
  const file = pathToFileURL(path.join(import.meta.dirname, "../src/web/cost-charts.tsx")).href;
  return (await import(file)) as ChartModule;
}

/** The stacked per-day chart as markup, and the token names it reads. */
export async function dayChartMarkup(
  analysis: CostAnalysis,
): Promise<{ markup: string; tokens: readonly string[] }> {
  const charts = await loadCharts();
  const markup = renderToStaticMarkup(
    React.createElement(charts.StackedDayChart as React.FunctionComponent<Parameters<ChartModule["StackedDayChart"]>[0]>, {
      data: daySeriesOf(analysis),
      colourKeys: CATEGORY_COLOUR_ORDER,
      label: `Recorded amount per UTC day by category, ${analysis.window.label}`,
    }),
  );
  return { markup, tokens: charts.CHART_TOKENS };
}
