import { describe, expect, it } from "vitest";

import { cleanRecipientName } from "../src/admin-vouchers.js";
import { giftMessage } from "../src/store/pg-voucher-emails.js";

describe("a gift voucher recipient's name at the email boundary", () => {
  it("neutralises invisible separators and bidi controls before text or HTML is rendered", () => {
    const dangerous = `Ada\u200bLovelace\u202eX\u2066Y\u2069`;
    expect(cleanRecipientName(dangerous)).toBe("Ada Lovelace X Y");

    const mail = giftMessage(1, { kind: "invite" }, { recipientName: dangerous, recipientNote: null });
    expect(mail.text).toContain("Dear Ada Lovelace X Y,");
    expect(mail.html).toContain("Dear Ada Lovelace X Y,");
    for (const control of ["\u200b", "\u202e", "\u2066", "\u2069"]) {
      expect(mail.text).not.toContain(control);
      expect(mail.html).not.toContain(control);
    }
  });

  it("treats a name made only of invisible formatting as no name", () => {
    const invisible = "\u00ad\u200b\u200c\u200d\u202e\u2060\ufe0f\ufeff";
    expect(cleanRecipientName(invisible)).toBeNull();
    expect(giftMessage(1, { kind: "invite" }, { recipientName: invisible, recipientNote: null })).toEqual(
      giftMessage(1),
    );
  });

  it("keeps joiners that are meaningful in names and emoji", () => {
    expect(cleanRecipientName("A\u200cB 👩\u200d💻")).toBe("A\u200cB 👩\u200d💻");
  });
});
