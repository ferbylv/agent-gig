import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import type {
  AuditEvent,
  BudgetConfig,
  ConnectBinding,
  Escrow,
  LedgerLine,
  Order,
  PassportCard,
  Wallet,
} from "@agent-gig/shared";

export interface Db {
  passports: Record<string, PassportCard>;
  /** did -> secretKey hex (server-side only for seed signing; never exposed via API) */
  passportSecrets: Record<string, string>;
  budgets: Record<string, BudgetConfig>; // key = userId:hirerAgentId
  orders: Record<string, Order>;
  escrows: Record<string, Escrow>;
  wallets: Record<string, Wallet>;
  ledger: LedgerLine[];
  audit: AuditEvent[];
  connects: Record<string, ConnectBinding>; // hirerAgentId
  adminKey: string;
  meta: { seededAt?: string };
}

const DATA_PATH = process.env.AG_DATA ?? join(import.meta.dir, "../../../data/store.json");

function emptyDb(): Db {
  return {
    passports: {},
    passportSecrets: {},
    budgets: {},
    orders: {},
    escrows: {},
    wallets: {},
    ledger: [],
    audit: [],
    connects: {},
    adminKey: process.env.AG_ADMIN_KEY ?? "dev-admin-key-v0",
    meta: {},
  };
}

let db: Db = emptyDb();

export function getDb(): Db {
  return db;
}

export function loadDb(): Db {
  try {
    if (existsSync(DATA_PATH)) {
      db = JSON.parse(readFileSync(DATA_PATH, "utf8")) as Db;
    } else {
      db = emptyDb();
    }
  } catch {
    db = emptyDb();
  }
  return db;
}

export function saveDb(): void {
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

export function resetDb(): void {
  db = emptyDb();
  saveDb();
}

export function budgetKey(userId: string, hirerAgentId: string): string {
  return `${userId}:${hirerAgentId}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
