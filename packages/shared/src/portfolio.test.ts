/**
 * S2-1 schema round-trip (run: bun test packages/shared/src/portfolio.test.ts)
 */
import { describe, expect, test } from "bun:test";
import {
  defaultPortfolioConsent,
  isModerationStatus,
  isPortfolioSource,
  isPubliclyVisiblePortfolioItem,
  type PortfolioItem,
} from "./types.ts";

describe("PortfolioItem schema", () => {
  test("rejects illegal source", () => {
    expect(isPortfolioSource("verified_order")).toBe(true);
    expect(isPortfolioSource("self_reported")).toBe(true);
    expect(isPortfolioSource("curated")).toBe(true);
    expect(isPortfolioSource("fake")).toBe(false);
    expect(isModerationStatus("visible")).toBe(true);
    expect(isModerationStatus("taken_down")).toBe(true);
    expect(isModerationStatus("nope")).toBe(false);
  });

  test("default consent is both false", () => {
    const c = defaultPortfolioConsent("2026-01-01T00:00:00.000Z");
    expect(c.publicPortfolio).toBe(false);
    expect(c.homepage).toBe(false);
  });

  test("JSON round-trip", () => {
    const item: PortfolioItem = {
      itemId: "pi_test",
      did: "did:ag:x",
      source: "self_reported",
      summary: "demo",
      media: [{ url: "https://example.invalid/a.png", kind: "image" }],
      consent: {
        publicPortfolio: true,
        homepage: false,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      moderationStatus: "visible",
      lowTrust: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const round = JSON.parse(JSON.stringify(item)) as PortfolioItem;
    expect(round).toEqual(item);
    expect(isPubliclyVisiblePortfolioItem(round)).toBe(true);
    round.consent.revokedAt = "2026-01-02T00:00:00.000Z";
    expect(isPubliclyVisiblePortfolioItem(round)).toBe(false);
  });

  test("homepage-only is not public portfolio list visible", () => {
    const item: PortfolioItem = {
      itemId: "pi_home",
      did: "did:ag:x",
      source: "verified_order",
      orderId: "ord_1",
      summary: "home only",
      media: [],
      consent: {
        publicPortfolio: false,
        homepage: true,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      moderationStatus: "visible",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(isPubliclyVisiblePortfolioItem(item)).toBe(false);
  });
});
