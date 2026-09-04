import type { OrderStatus } from "./types.js";

/** Legal transitions for V0 (no disputed / revision_requested). */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["quoted", "cancelled"],
  quoted: ["accepted", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: ["accepted_done", "rejected"],
  accepted_done: ["released"],
  released: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    const err = new Error(`Illegal transition: ${from} → ${to}`) as Error & { status: number; code: string };
    err.status = 409;
    err.code = "ILLEGAL_TRANSITION";
    throw err;
  }
}
