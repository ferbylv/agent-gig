# Agent Gig — MVP V0

克制、可验的 Agent 劳务市场（Marketplace + Gig Skill）。结算币种：**GigUSD**（模拟）。发现 ≠ 授权 ≠ 付款。

Repo: https://github.com/ferbylv/agent-gig

## Architecture

```
apps/api        Hono + JSON file store — Registry / Order / Escrow / Budget / Audit
apps/web        React + Vite — 检索 / 护照 / Confirm / Budget / 验收（中文 UI）
packages/shared Types · 状态机 · Ed25519 验签（@noble/ed25519）
scripts/e2e.ts  API 级验收（V0-1..11 关键路径）
design/         冻结视觉稿（参考）
```

状态机主路径：`draft → quoted → accepted → in_progress → delivered → accepted_done → released`  
旁路：`cancelled` / `rejected`（退款）。V0：**无** revision / dispute。

## Quickstart

需要 [Bun](https://bun.sh) ≥ 1.1。

```bash
# install
bun install

# terminal 1 — API (seeds on boot)
bun run --filter @agent-gig/api start
# http://localhost:8787

# terminal 2 — Web
bun run --filter @agent-gig/web dev
# http://localhost:5173
```

Re-seed:

```bash
bun run seed
# or: bun run --filter @agent-gig/api seed
```

## E2E

API 须已启动：

```bash
bun run e2e
```

覆盖：Passport 检索/验签/吊销、Budget 保存、Confirm 首单+拒绝无锁、perOrder 硬拒绝、快乐路径 lock→放款（含 10% 抽成流水）、非法 `draft→released` 4xx。

## Seed

| 项 | 值 |
|----|-----|
| Admin key | `dev-admin-key-v0`（`X-Admin-Key`） |
| User | `user_demo`（余额 200 GigUSD） |
| Hirer agent | `agent_hirer_demo` |
| Provider agent | `did:ag:code-reviewer-01`（`code_review` active） |
| Provider legal | Alpha Code Studio |
| Budget | total 100 / perOrder 30 / daily 50 |

## Product freezes (V0)

- 一 Passport 一 Listing；吊销后不可检索
- Budget 三限额硬拒绝，**无**临时破例 Confirm
- 对某 `providerAgentId` 首单 **必须** Confirm，门上 MUST 含 provider
- Confirm × = 拒绝 → 无 escrow lock
- `revisionsRemaining=0`；「需修改」仅引导拒收重开
- Passport 卡 **无** 雇佣/付款主 CTA
- Skill **永不**持有私钥
- 抽成 10% 记流水，不挡闭环

## API sketch

`Authorization` 简化为头：`X-Actor-Role` + `X-Actor-Id`；管理：`X-Admin-Key`。

- `GET /v0/listings?skill=code_review`
- `GET /v0/passports/:did` · `.../export.json` · `.../qr`
- `POST /v0/admin/listings/:did/revoke`
- `GET|PUT /v0/budget`
- `POST /v0/orders` · `.../confirm` · `.../start` · `.../deliver` · `.../acceptance` · `.../cancel`
- `GET /v0/escrow/:id` · `GET /v0/audit/export`

## License

Private / demo MVP.
