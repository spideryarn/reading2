// @vitest-environment jsdom
/**
 * The charts of `/admin/costs` — [src/web/cost-charts.tsx](../src/web/cost-charts.tsx)
 * — rendered the way the analysis report will render them: to static markup,
 * with no stylesheet. docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * jsdom only to read the markup back as elements; nothing here mounts React.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DaySeries } from "../src/web/admin-costs-view.js";
import { OTHER_KEY } from "../src/web/admin-costs-view.js";
import {
  CHART_TOKENS,
  ChartLegend,
  MAX_BAR_WIDTH,
  RankBar,
  StackedDayChart,
} from "../src/web/cost-charts.js";

function parse(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

const DAYS = ["2033-05-01", "2033-05-02", "2033-05-03", "2033-05-04"];

/** Three series on the first day, one on the third, nothing on the other two. */
function data(series: string[]): DaySeries {
  const first = new Map(
    [
      ["alpha", 300],
      ["beta", 100],
      ["gamma", 50],
    ].filter(([key]) => series.includes(key as string)) as [string, number][],
  );
  return {
    days: DAYS,
    series: series.map((key) => ({ key, label: key.toUpperCase() })),
    values: new Map([
      ["2033-05-01", first],
      ["2033-05-03", new Map(series.includes("alpha") ? [["alpha", 150]] : [])],
    ]),
  };
}

const ALL = ["alpha", "beta", "gamma"];

function chart(series: string[], colourKeys = ALL): HTMLElement {
  return parse(
    renderToStaticMarkup(
      <StackedDayChart data={data(series)} colourKeys={colourKeys} label="Recorded amount per UTC day" />,
    ),
  );
}

const segment = (el: HTMLElement, day: string, key: string) =>
  el.querySelector<SVGElement>(`g[data-day="${day}"] [data-series="${key}"]`);

describe("the stacked chart per UTC day", () => {
  it("is one svg that scales to its box, with a bar group for every day — empty days too", () => {
    const el = chart(ALL);
    const svg = el.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(svg?.getAttribute("width")).toBe("100%");
    expect([...el.querySelectorAll("g[data-day]")].map((g) => g.getAttribute("data-day"))).toEqual(DAYS);
    expect(el.querySelectorAll('g[data-day="2033-05-02"] [data-series]')).toHaveLength(0);
    expect(el.querySelectorAll('g[data-day="2033-05-01"] [data-series]')).toHaveLength(3);
  });

  it("draws each segment as tall as its share of the money", () => {
    const el = chart(ALL);
    const h = (day: string, key: string) => Number(segment(el, day, key)?.getAttribute("data-height"));
    expect(h("2033-05-01", "alpha") / h("2033-05-01", "beta")).toBeCloseTo(3, 6);
    expect(h("2033-05-01", "alpha") / h("2033-05-01", "gamma")).toBeCloseTo(6, 6);
    expect(h("2033-05-01", "alpha") / h("2033-05-03", "alpha")).toBeCloseTo(2, 6);
    /* And the attribute is the geometry, not a number beside it: the two lower
       segments are plain rects. */
    const rect = (key: string) => Number(segment(el, "2033-05-01", key)?.getAttribute("height"));
    expect(rect("alpha") / rect("beta")).toBeCloseTo(3, 6);
    expect(rect("alpha")).toBeCloseTo(h("2033-05-01", "alpha"), 6);
  });

  it("keeps a bar no thicker than the limit, and says series, day and amount on hover", () => {
    const el = chart(ALL);
    const width = Number(segment(el, "2033-05-01", "alpha")?.getAttribute("width"));
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(MAX_BAR_WIDTH);
    const title = segment(el, "2033-05-01", "beta")?.querySelector("title")?.textContent ?? "";
    expect(title).toContain("BETA");
    expect(title).toContain("2033-05-01");
    expect(title).toMatch(/\d/);
  });

  it("has one y axis of three or four ticks", () => {
    const ticks = chart(ALL).querySelectorAll("[data-y-tick]");
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it("draws a legend for two series and none for one", () => {
    expect(chart(["alpha", "beta"]).querySelectorAll("[data-chart-legend] [data-series]")).toHaveLength(2);
    expect(chart(["alpha"]).querySelector("[data-chart-legend]")).toBeNull();
  });

  it("keeps a series' colour when another is filtered out", () => {
    const fill = (el: HTMLElement, key: string) => segment(el, "2033-05-01", key)?.getAttribute("fill");
    const whole = chart(ALL);
    const without = chart(["alpha", "gamma"]);
    expect(fill(whole, "gamma")).toBe("var(--cat-2)");
    expect(fill(without, "gamma")).toBe(fill(whole, "gamma"));
    expect(fill(without, "alpha")).toBe(fill(whole, "alpha"));
    /* The order is the keys' own, not the order the series arrive in. */
    expect(fill(chart(["gamma", "alpha"]), "alpha")).toBe("var(--cat-0)");
  });

  it("gives text no series colour", () => {
    for (const text of chart(ALL).querySelectorAll("text")) {
      expect(text.getAttribute("fill") ?? "").not.toContain("--cat-");
    }
  });
});

describe("CHART_TOKENS", () => {
  it("is exactly the custom properties the charts' markup reads", () => {
    /* Nine keys plus the fold, so every categorical slot and "Other" are drawn. */
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const series = [...keys, OTHER_KEY].map((key) => ({ key, label: key }));
    const wide: DaySeries = {
      days: ["2033-05-01"],
      series,
      values: new Map([["2033-05-01", new Map(series.map((s, i) => [s.key, 10 + i]))]]),
    };
    const markup =
      renderToStaticMarkup(<StackedDayChart data={wide} colourKeys={keys} label="x" />) +
      renderToStaticMarkup(<ChartLegend series={series} colourKeys={keys} />) +
      renderToStaticMarkup(<RankBar share={0.4} />);
    const read = new Set([...markup.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual([...CHART_TOKENS].sort());
    /* No Tailwind in here: the report has no stylesheet to give a class meaning. */
    expect(markup).not.toContain("tw:");
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
