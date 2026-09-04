import type { ActorRole, AuditEvent, PermissionNeed } from "@agent-gig/shared";
import { getDb, nowIso, saveDb, uid } from "./store.js";

export function audit(input: {
  actorRole: ActorRole;
  actorId: string;
  action: string;
  orderId?: string;
  amount?: number;
  counterpart?: string;
  permissions?: PermissionNeed[];
  detail?: Record<string, unknown>;
}): AuditEvent {
  const db = getDb();
  const ev: AuditEvent = {
    id: uid("aud"),
    at: nowIso(),
    ...input,
  };
  db.audit.push(ev);
  saveDb();
  return ev;
}
