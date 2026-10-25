// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useFitTextarea } from "../src/web/useFitTextarea.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("refits a filled textarea after a font load and stops watching on unmount", () => {
  const fonts = new EventTarget();
  const unwatch = vi.spyOn(fonts, "removeEventListener");
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  let height = 44;
  const measure = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockImplementation(() => height);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Box() {
    const box = useRef<HTMLTextAreaElement>(null);
    useFitTextarea(box, "A kept answer");
    return <textarea ref={box} defaultValue="A kept answer" />;
  }
  try {
    act(() => root.render(<Box />));
    const box = host.querySelector("textarea")!;
    expect(box.style.height).toBe("44px");
    height = 88;
    act(() => fonts.dispatchEvent(new Event("loadingdone")));
    expect(box.style.height).toBe("88px");
    act(() => root.unmount());
    expect(unwatch).toHaveBeenCalledWith("loadingdone", expect.any(Function));
    height = 120;
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(box.style.height).toBe("88px");
  } finally {
    act(() => root.unmount());
    host.remove();
    measure.mockRestore();
    Reflect.deleteProperty(document, "fonts");
  }
});
