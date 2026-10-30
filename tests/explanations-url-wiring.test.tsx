// @vitest-environment jsdom
/**
 * ExplanationsMode is the seam between the two URL parsers and the real panel.
 * Parser-only and panel-only tests both stay green if that seam is deleted, so
 * this probe presses the callbacks the panel receives and watches the address.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/web/useExplanations.js", () => ({ useExplanations: () => ({}) }));
vi.mock("../src/web/perf.js", () => ({ useRenderCount: () => undefined }));
vi.mock("../src/web/ExplanationsPanel.js", () => ({
  ExplanationsPanel: (props: {
    order: string;
    bar: number | null;
    onOrder(value: "centrality"): void;
    onBar(value: number): void;
  }) =>
    createElement(
      "div",
      null,
      createElement("output", { id: "expl-url-values" }, `${props.order}:${props.bar}`),
      createElement("button", { type: "button", onClick: () => props.onOrder("centrality") }, "order"),
      createElement("button", { type: "button", onClick: () => props.onBar(0.3) }, "bar"),
    ),
}));

const { ExplanationsBand } = await import(
  "../src/web/modes/explanations/ExplanationsMode.js"
);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("reads explby/explbar into the panel and writes both panel changes back", async () => {
  const updates: Parameters<OnUrlUpdateFunction>[0][] = [];
  const band = createElement(ExplanationsBand, {
    slug: "a-piece",
    onJump: () => undefined,
    onAsk: () => undefined,
  });
  const adapterProps: Parameters<typeof NuqsTestingAdapter>[0] = {
    searchParams: "?explby=document&explbar=0.20",
    hasMemory: true,
    onUrlUpdate: (event) => {
      updates.push(event);
    },
    children: band,
  };
  await act(async () =>
    root.render(
      createElement(NuqsTestingAdapter, adapterProps),
    ),
  );
  expect(host.querySelector("#expl-url-values")?.textContent).toBe("document:0.2");

  const press = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
    if (!button) throw new Error(`no ${label} button`);
    await act(async () => button.click());
  };
  await press("order");
  expect(updates.at(-1)?.searchParams.get("explby")).toBe("centrality");
  expect(updates.at(-1)?.options.history).toBe("push");

  await press("bar");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
  expect(updates.at(-1)?.searchParams.get("explbar")).toBe("0.30");
  expect(updates.at(-1)?.options.history).toBe("replace");
});
