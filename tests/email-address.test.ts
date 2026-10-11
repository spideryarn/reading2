/**
 * `splitNameAndAddress` — src/email-address.ts. Greg, 2026-10-11
 * (spya-cfbp0q): pasting `Firstname Lastname <firstname@example.com>` into the
 * address box keeps just the address and fills the name. Plan 261011k.
 */
import { describe, expect, it } from "vitest";

import { addressBoxChange, splitNameAndAddress } from "../src/email-address.js";

describe("addressBoxChange", () => {
  it("fills a name box that is empty or only spaces, and keeps one with a name in it", () => {
    expect(addressBoxChange("Ada <ada@example.com>", "")).toEqual({ email: "ada@example.com", name: "Ada" });
    expect(addressBoxChange("Ada <ada@example.com>", "   ")).toEqual({ email: "ada@example.com", name: "Ada" });
    expect(addressBoxChange("Ada <ada@example.com>", "Countess")).toEqual({ email: "ada@example.com", name: "Countess" });
    expect(addressBoxChange("<ada@example.com>", "  ")).toEqual({ email: "ada@example.com", name: "  " });
    expect(addressBoxChange("ada@exa", "x")).toEqual({ email: "ada@exa", name: "x" });
  });
});

describe("splitNameAndAddress", () => {
  it("splits a name and an address in angle brackets", () => {
    expect(splitNameAndAddress("Firstname Lastname <firstname@example.com>")).toEqual({
      email: "firstname@example.com",
      name: "Firstname Lastname",
    });
  });

  it("takes off the quotes a mail client puts round a name, and the padding", () => {
    expect(splitNameAndAddress('  "Lovelace, Ada"   < ada@example.com >  ')).toEqual({
      email: "ada@example.com",
      name: "Lovelace, Ada",
    });
    expect(splitNameAndAddress("'Ada'<ada@example.com>")).toEqual({ email: "ada@example.com", name: "Ada" });
  });

  it("keeps a name in any script", () => {
    expect(splitNameAndAddress("Zoë Ångström 李 <zoe@example.com>")).toEqual({
      email: "zoe@example.com",
      name: "Zoë Ångström 李",
    });
  });

  it("gives no name for a bare bracketed address", () => {
    expect(splitNameAndAddress("<ada@example.com>")).toEqual({ email: "ada@example.com", name: null });
    expect(splitNameAndAddress('"" <ada@example.com>')).toEqual({ email: "ada@example.com", name: null });
  });

  it("leaves alone what is not that shape, so typing is not interrupted", () => {
    for (const raw of [
      "ada@example.com",
      "Ada <ada@example.com",
      "Ada <not an address>",
      "Ada <ada>",
      "Ada <a@b> trailing",
      "Ada <a@b>, Bob <b@c>",
      '"Ada <ada@example.com>',
      "Ada' <ada@example.com>",
      "",
    ]) {
      expect(splitNameAndAddress(raw)).toBeNull();
    }
  });
});
