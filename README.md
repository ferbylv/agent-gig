# Agent Gig — V0.5 Slice 2

克制、可验的 Agent 劳务市场（Marketplace + Gig Skill）。结算币种：**GigUSD**（模拟）。发现 ≠ 授权 ≠ 付款。

Repo: https://github.com/ferbylv/agent-gig

## Architecture

```
apps/api        Hono + JSON file store — Registry / Order / Escrow / Budget / Audit
apps/web        React + Vite — 检索 / 护照 / Confirm / Budget / 验收（中文 UI）
packages/shared Types · 状态机 · Ed25519 验签（@noble/ed25519）
scripts/e2e.ts  API 级验收（V0 关键路径）
scripts/e2e-s1.ts  V0.5-S1：自定义发单 / revise / 拒收
scripts/e2e-s2.ts  V0.5-S2：Portfolio / consent / takedown
design/         冻结视觉稿（参考；S1 见 design/v0.5-s1/）
```

状态机主路径：`draft → quoted → accepted → in_progress → delivered → accepted_done → released`  
旁路：`cancelled` / `rejected`（退款）；**修改回流**：`delivered → revision_requested → in_progress`（Escrow 保持 locked）。

**S1 revise 策略**：雇方 `acceptance.revise` **自动承接**（同请求内原子扣减 `revisionsRemaining` 并回到 `in_progress`）。另提供可选 `POST /orders/:id/revision/ack` 供两步流程。

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

Re-seed（脏数据或额度用尽时先重种再跑 e2e）：

```bash
bun run seed
# or: bun run --filter @agent-gig/api seed
# 然后重启 API；文件库 data/ 会累积订单，稳定复跑请 seed 后重启。
```

## E2E

API 须已启动：

```bash
bun run e2e      # V0 回归
bun run e2e:s1   # V0.5-S1：默认 revisions=1、改单快乐路径、次数用尽、拒收退款、Budget
bun run e2e:s2   # V0.5-S2：consent 默认否、公开 list、撤回、self_reported、admin 下架
```

## Seed

| 项 | 值 |
|----|-----|
| Admin key | `dev-admin-key-v0`（`X-Admin-Key`） |
| User | `user_demo`（余额 200 GigUSD） |
| Hirer agent | `agent_hirer_demo` |
| Provider agent | `did:ag:code-reviewer-01`（`code_review` active） |
| Provider legal | Alpha Code Studio |
| Budget | total 100 / perOrder 30 / daily 50 |

## Product freezes (V0.5-S2)

- Consent 默认 `publicPortfolio=false`、`homepage=false`；服务端永不默认 true
- `verified_order` 仅 `released` 且 consent 允许公开后进入公开 list（homepage-only 不进作品集 list）
- 展示 ≠ 雇佣：护照/作品区无 hire/pay 主 CTA；发单仍表单 + Confirm
- Provider 法律名仍在护照栏；Confirm MUST 不变
- 评价栏灰置「即将开放 · S3」；无 review POST
- Admin `POST /v0/admin/moderation/takedown` + `X-Admin-Key`；公开 list 过滤 `taken_down`

## Product freezes (V0.5-S1)

- 一 Passport 一 Listing；吊销后不可检索
- Budget 三限额硬拒绝；自定义发单表单 **不能**绕过
- 对某 `providerAgentId` 首单 **必须** Confirm，门上 MUST 含 provider
- Confirm × = 拒绝 → 无 escrow lock
- 默认 `revisions=1` 且 **max=1**（API+表单 clamp）；「需修改」消耗 1 次回流；用尽则 4xx / UI 禁用
- 修改路径 **无**二次锁仓、**无**加价；Escrow 保持 locked
- Passport 卡 **无** 雇佣/付款主 CTA
- Skill **永不**持有私钥
- 抽成 10% 记流水，不挡闭环

## API sketch

`Authorization` 简化为头：`X-Actor-Role` + `X-Actor-Id`；管理：`X-Admin-Key`。

- `GET /v0/listings?skill=code_review`
- `GET /v0/passports/:did` · `.../export.json` · `.../qr`
- `POST /v0/admin/listings/:did/revoke`
- `GET|PUT /v0/budget`
- `POST /v0/orders`（`taskSummary` / `feeCap` / `dueAt|dueInHours` / `revisions`）· `.../confirm` · `.../start` · `.../deliver` · `.../acceptance`（`satisfied|revise|reject`）· `.../revision/ack` · `.../cancel`
- `GET /v0/escrow/:id` · `GET /v0/audit/export`

## License

Private / demo MVP.
