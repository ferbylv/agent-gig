import type { BudgetConfig } from "@agent-gig/shared";
import { budgetKey, getDb, saveDb, todayUtc } from "./store.js";
import { audit } from "./audit.js";

export function getBudget(userId: string, hirerAgentId: string): BudgetConfig | null {
  const db = getDb();
  const b = db.budgets[budgetKey(userId, hirerAgentId)];
  if (!b) return null;
  refreshDaily(b);
  return b;
}

export function putBudget(
  userId: string,
  hirerAgentId: string,
  caps: { totalCap: number; perOrderCap: number; dailyCap: number }
): BudgetConfig {
  const db = getDb();
  const key = budgetKey(userId, hirerAgentId);
  const existing = db.budgets[key];
  const next: BudgetConfig = {
    userId,
    hirerAgentId,
    totalCap: caps.totalCap,
    perOrderCap: caps.perOrderCap,
    dailyCap: caps.dailyCap,
    usedTotal: existing?.usedTotal ?? 0,
    usedDaily: existing?.usedDaily ?? 0,
    dailyResetDate: existing?.dailyResetDate ?? todayUtc(),
    confirmedProviders: existing?.confirmedProviders ?? [],
  };
  refreshDaily(next);
  db.budgets[key] = next;
  saveDb();
  return next;
}

function refreshDaily(b: BudgetConfig): void {
  const today = todayUtc();
  if (b.dailyResetDate !== today) {
    b.usedDaily = 0;
    b.dailyResetDate = today;
  }
}

export type BudgetCheckResult =
  | { ok: true }
  | { ok: false; reason: string; code: "PER_ORDER" | "DAILY" | "TOTAL" };

export function checkBudgetHard(b: BudgetConfig, feeCap: number): BudgetCheckResult {
  refreshDaily(b);
  if (feeCap > b.perOrderCap) {
    return {
      ok: false,
      code: "PER_ORDER",
      reason: `超过单笔上限 perOrderCap=${b.perOrderCap}，请调高额度后再发单（不支持临时破例）`,
    };
  }
  if (b.usedDaily + feeCap > b.dailyCap) {
    return {
      ok: false,
      code: "DAILY",
      reason: `超过日限额 dailyCap=${b.dailyCap}（已用 ${b.usedDaily}），请调额或等待日切`,
    };
  }
  if (b.usedTotal + feeCap > b.totalCap) {
    return {
      ok: false,
      code: "TOTAL",
      reason: `超过总额度 totalCap=${b.totalCap}（已用 ${b.usedTotal}），请调高额度`,
    };
  }
  return { ok: true };
}

export function recordBudgetUsage(b: BudgetConfig, feeCap: number): void {
  refreshDaily(b);
  b.usedDaily += feeCap;
  b.usedTotal += feeCap;
  saveDb();
}

export function releaseBudgetUsage(b: BudgetConfig, feeCap: number): void {
  refreshDaily(b);
  b.usedDaily = Math.max(0, b.usedDaily - feeCap);
  b.usedTotal = Math.max(0, b.usedTotal - feeCap);
  saveDb();
}

export function rejectBudget(actorId: string, feeCap: number, reason: string, orderId?: string): void {
  const db = getDb();
  db.ledger.push({
    id: `led_${Date.now()}`,
    at: new Date().toISOString(),
    kind: "budget_reject",
    amount: feeCap,
    currency: "GigUSD",
    orderId,
    note: reason,
  });
  audit({
    actorRole: "hirer",
    actorId,
    action: "budget.reject",
    orderId,
    amount: feeCap,
    detail: { reason },
  });
  saveDb();
}
