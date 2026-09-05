/**
 * S3-1 Review schema + rank helpers (run: bun test packages/shared/src/review.test.ts)
 * orderId uniqueness is enforced at API/store layer (one review per orderId).
 */
import { describe, expect, test } from "bun:test";
import {
  avgMultiDimScore,
  computeRankNumeric,
  isValidReviewScore,
  parseReviewScores,
  preferredBadgeFor,
  RANK_WEIGHTS_DEFAULT,
  resolveRankTier,
  summarizeReviews,
  type Review,
} from "./types.ts";

describe("Review schema", () => {
  test("rejects illegal scores", () => {
    expect(isValidReviewScore(1)).toBe(true);
    expect(isValidReviewScore(5)).toBe(true);
    expect(isValidReviewScore(0)).toBe(false);
    expect(isValidReviewScore(6)).toBe(false);
    expect(isValidReviewScore(3.5)).toBe(false);
    expect(parseReviewScores({ quality: 5, communication: 4, punctuality: 3, permissionHonesty: 2 })).not.toBeNull();
    expect(parseReviewScores({ quality: 5, communication: 4, punctuality: 3 })).toBeNull();
    expect(parseReviewScores({ quality: 0, communication: 4, punctuality: 3, permissionHonesty: 2 })).toBeNull();
    expect(parseReviewScores({ quality: 5, communication: 4, punctuality: 3, permissionHonesty: 6 })).toBeNull();
  });

  test("JSON round-trip; orderId unique semantic documented", () => {
    const review: Review = {
      reviewId: "rev_test",
      orderId: "ord_1", // UNIQUE per store/API — duplicate POST → 4xx
      hirerUserId: "user_demo",
      hirerAgentId: "agent_hirer_demo",
      providerDid: "did:ag:x",
      scores: { quality: 5, communication: 4, punctuality: 5, permissionHonesty: 4 },
      comment: "solid",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const round = JSON.parse(JSON.stringify(review)) as Review;
    expect(round).toEqual(review);
    expect(avgMultiDimScore(round.scores)).toBe(4.5);
  });

  test("summarize empty and nonempty", () => {
    expect(summarizeReviews([]).count).toBe(0);
    expect(summarizeReviews([]).avgOverall).toBe(0);
    const s = summarizeReviews([
      {
        reviewId: "a",
        orderId: "o1",
        hirerUserId: "u",
        hirerAgentId: "h",
        providerDid: "d",
        scores: { quality: 5, communication: 5, punctuality: 5, permissionHonesty: 5 },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        reviewId: "b",
        orderId: "o2",
        hirerUserId: "u",
        hirerAgentId: "h",
        providerDid: "d",
        scores: { quality: 1, communication: 1, punctuality: 1, permissionHonesty: 1 },
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(s.count).toBe(2);
    expect(s.avgOverall).toBe(3);
  });
});

describe("Rank helpers", () => {
  test("frozen weights and formula; disputeRate 0; new account not top", () => {
    expect(RANK_WEIGHTS_DEFAULT).toEqual({ w1: 0.25, w2: 0.35, w3: 0.15, w4: 0.1, w5: 0.15 });
    const high = computeRankNumeric({
      completionRate: 1,
      avgMultiDimScore: 5,
      repurchaseRate: 0.5,
      responseSpeedNorm: 1,
      disputeRate: 0,
      sybilPenalty: 0,
    });
    const low = computeRankNumeric({
      completionRate: 1,
      avgMultiDimScore: 1,
      repurchaseRate: 0.5,
      responseSpeedNorm: 1,
      disputeRate: 0,
      sybilPenalty: 0,
    });
    expect(high).toBeGreaterThan(low);
    expect(resolveRankTier(0, high)).toBe("explore");
    expect(resolveRankTier(9, high)).toBe("explore");
    expect(resolveRankTier(10, high)).toBe("top");
    expect(preferredBadgeFor(9)).toBe(false);
    expect(preferredBadgeFor(10)).toBe(true);
  });
});
