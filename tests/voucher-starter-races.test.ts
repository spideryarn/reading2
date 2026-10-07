/** Controlled interleavings of the real voucher writes; no database or email provider. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  reads: [] as Record<string, unknown>[][],
  updates: [] as Record<string, unknown>[],
  queueGift: vi.fn<typeof import("../src/store/pg-voucher-emails.js").queueGiftEmail>(async () => "delivery"),
  skipGifts: vi.fn(async () => {}),
}));

vi.mock("../src/db/client.js", () => {
  const db = {
    select: (columns: Record<string, unknown>) => {
      const query = {
        from: () => query,
        where: () => query,
        for: () => query,
        limit: async () => {
          const rows = fixture.reads.shift();
          if (rows === undefined) throw new Error("unexpected voucher read");
          return rows.map((row) => Object.fromEntries(Object.keys(columns).map((key) => [key, row[key]])));
        },
      };
      return query;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        fixture.updates.push(values);
        return { where: async () => {} };
      },
    }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  return { getDb: () => db };
});

vi.mock("../src/store/pg-voucher-emails.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/store/pg-voucher-emails.js")>()),
  queueGiftEmail: fixture.queueGift,
  skipQueuedGifts: fixture.skipGifts,
}));

import { createVoucher, updateVoucher, type NewVoucher } from "../src/store/pg-vouchers.js";
import type { StarterResolution } from "../src/store/voucher-starter.js";

const creator = "26100700-7a5e-4000-8000-000000000001";
const articleId = "26100700-7a5e-4000-8000-000000000002";
const input: NewVoucher = {
  id: "26100700-7a5e-4000-8000-000000000003",
  email: "first@example.invalid",
  articles: 5,
  note: null,
  recipientNote: null,
  recipientName: null,
  starterSlug: "starter",
};
const existing = { ...input, createdBy: creator };
const seen = {
  claimedBy: null,
  revokedAt: null,
  email: input.email,
  articles: input.articles,
  recipientName: null,
  recipientNote: null,
  starterSlug: input.starterSlug,
  starterArticleId: articleId,
};
const ready: Extract<StarterResolution, { kind: "ready" }> = {
  kind: "ready",
  starter: { articleId, slug: "starter", title: "Original", url: "https://www.spideryarn.com/read/starter?key=original" },
};
const audience = async () => ({ kind: "invite" as const });

beforeEach(() => {
  fixture.reads = [];
  fixture.updates = [];
  fixture.queueGift.mockClear();
  fixture.skipGifts.mockClear();
});

describe("a concurrent create commits while starter resolution is in flight", () => {
  for (const kind of ["absent", "unpublished", "link-off"] as const) {
    it(`acknowledges the committed identical create even when resolution answers ${kind}`, async () => {
      fixture.reads = [[], [existing]];
      const resolveStarter = async (): Promise<StarterResolution> => ({ kind });
      expect(await createVoucher(input, creator, { audience, resolveStarter })).toEqual({ kind: "replayed", id: input.id });
      expect(fixture.queueGift).not.toHaveBeenCalled();
    });
  }

  it("conflicts with a different committed create rather than reporting the live starter state", async () => {
    fixture.reads = [[], [{ ...existing, starterSlug: "different" }]];
    expect(await createVoucher(input, creator, { audience, resolveStarter: async () => ({ kind: "link-off" }) }))
      .toEqual({ kind: "conflict" });
    expect(fixture.queueGift).not.toHaveBeenCalled();
  });

  it("still refuses a new create when no concurrent voucher exists", async () => {
    fixture.reads = [[], []];
    expect(await createVoucher(input, creator, { audience, resolveStarter: async () => ({ kind: "link-off" }) }))
      .toEqual({ kind: "starter-refused", reason: "link-off" });
    expect(fixture.queueGift).not.toHaveBeenCalled();
  });
});

describe("readdress keeps the article's identity when its slug is reused", () => {
  it("drops a deleted starter even if another article now has that slug", async () => {
    fixture.reads = [[{ ...seen, starterArticleId: null }], [{ ...seen, starterArticleId: null }]];
    const resolveStarter = vi.fn(async (): Promise<StarterResolution> => ({
      kind: "ready",
      starter: { ...ready.starter, articleId: "26100700-7a5e-4000-8000-000000000004", title: "Replacement" },
    }));
    expect(await updateVoucher(input.id, { email: "second@example.invalid" }, { audience, resolveStarter }))
      .toMatchObject({ kind: "updated", giftDelivery: "delivery", starter: "dropped" });
    expect(fixture.queueGift.mock.calls[0]?.[5]).toMatchObject({ starter: null });
    expect(resolveStarter).not.toHaveBeenCalled();
  });

  it("drops a replacement found after the original disappears during resolution", async () => {
    fixture.reads = [[seen], [{ ...seen, starterArticleId: null }]];
    const resolveStarter = async (): Promise<StarterResolution> => ({
      kind: "ready",
      starter: { ...ready.starter, articleId: "26100700-7a5e-4000-8000-000000000004", title: "Replacement" },
    });
    expect(await updateVoucher(input.id, { email: "second@example.invalid" }, { audience, resolveStarter }))
      .toMatchObject({ kind: "updated", starter: "dropped" });
    expect(fixture.queueGift.mock.calls[0]?.[5]).toMatchObject({ starter: null });
  });

  it("keeps the original while it still exists", async () => {
    fixture.reads = [[seen], [seen]];
    expect(await updateVoucher(input.id, { email: "second@example.invalid" }, { audience, resolveStarter: async () => ready }))
      .toMatchObject({ kind: "updated", starter: "kept" });
    expect(fixture.queueGift.mock.calls[0]?.[5]).toMatchObject({ starter: { title: "Original", url: ready.starter.url } });
  });
});

describe("the unlocked readdress pre-read can disagree with the locked read", () => {
  it("retries and resolves when a concurrent readdress makes an email due", async () => {
    fixture.reads = [
      [seen], [{ ...seen, email: "other@example.invalid" }],
      [{ ...seen, email: "other@example.invalid" }], [{ ...seen, email: "other@example.invalid" }],
    ];
    const resolveStarter = vi.fn(async () => ready);
    expect(await updateVoucher(input.id, { email: input.email }, { audience, resolveStarter }))
      .toMatchObject({ kind: "updated", starter: "kept" });
    expect(resolveStarter).toHaveBeenCalledTimes(1);
    expect(fixture.queueGift).toHaveBeenCalledTimes(1);
    expect(fixture.updates).toHaveLength(1);
  });

  it("retries and resolves when a concurrent restore makes an email due", async () => {
    fixture.reads = [[{ ...seen, revokedAt: new Date() }], [seen], [seen], [seen]];
    const resolveStarter = vi.fn(async () => ready);
    expect(await updateVoucher(input.id, { email: "second@example.invalid" }, { audience, resolveStarter }))
      .toMatchObject({ kind: "updated", starter: "kept" });
    expect(resolveStarter).toHaveBeenCalledTimes(1);
    expect(fixture.queueGift).toHaveBeenCalledTimes(1);
    expect(fixture.updates).toHaveLength(1);
  });

  it("sends nothing when the locked read already has the requested address", async () => {
    fixture.reads = [[seen], [{ ...seen, email: "second@example.invalid" }]];
    expect(await updateVoucher(input.id, { email: "second@example.invalid" }, { audience, resolveStarter: async () => ready }))
      .toEqual({ kind: "updated" });
    expect(fixture.queueGift).not.toHaveBeenCalled();
  });

  it("bounds repeated contention and makes no write or email", async () => {
    fixture.reads = Array.from({ length: 3 }, () => [[seen], [{ ...seen, email: "other@example.invalid" }]]).flat();
    const resolveStarter = vi.fn(async () => ready);
    await expect(updateVoucher(input.id, { email: input.email }, { audience, resolveStarter })).rejects.toThrow("kept racing");
    expect(fixture.reads).toHaveLength(0);
    expect(resolveStarter).not.toHaveBeenCalled();
    expect(fixture.updates).toHaveLength(0);
    expect(fixture.queueGift).not.toHaveBeenCalled();
  });
});
