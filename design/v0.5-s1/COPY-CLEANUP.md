# COPY-CLEANUP — V0.5 Slice1 D-S1-1（发单表单）

Scope: passport-detail custom order form stills under `v0.5-s1/`.
V0 frozen stills in parent `/workspace/agent-gig-design/` were **read only** (not modified).

## Removed (must not appear on this screen)

| V0 string / pattern | Where it lived (V0) | Why removed |
|---|---|---|
| `修改请拒收后重开` | V0 detail / SLA helper copy | Replaced by paid-revision policy (1 free revision) |
| `0 次（V0）` / `revisions=0` | `gig-detail-desktop.html` / `gig-detail-narrow.html` SLA「修改」 | Default revisions stepper is **1**, not 0 |
| `立即付款` | Pay-now CTA language (if present in V0 drafts) | Not a payment CTA screen; labor hire confirm flow |
| `一键成交` | Instant-deal CTA language | Not a marketplace “one-click close” |
| Passport-card solid hire/pay CTA | Forbidden on left passport | Passport stays informational only |
| Static「订单 / 报价」read-only order panel as the only right column | `gig-detail-*.html` | Right column is now **发单表单区** |

## Replaced

| V0 | V0.5 S1 |
|---|---|
| `平台发单` (static title) | `发起雇佣` (form title) + kicker `发单` |
| SLA「修改 · 0 次（V0）」 | Stepper **修改次数 = 1** |
| Helper implying reject-then-reopen only | `含 1 次免费修改；用尽后需拒收或新开单` |
| `走平台 Confirm 流程；未获主人确认前不锁定资金` (close) | `提交后将校验额度，并向主人弹出确认门；未确认不锁仓` |
| Primary `向主人发起确认` (on existing order) | Primary `下一步：确认雇佣` |
| Secondary `返回检索` | Secondary `取消` |
| Status「进行中」on right | Draft badge · **未锁仓** (invalid: 校验未通过 · 未锁仓) |

## Kept (labor marketplace, not crypto)

- Desk `#EDEAE4`, surface `#FFF`, ink `#1C1C1E`, secondary `#6B6B70`, action `#3D5A73`, verified `#3D7A5F`, danger `#B85C5C`
- Radius 14 (shell) / 8 (controls)
- CJK system font stack
- Provider `北湾工作室` → agent `CodeReviewer`, verified, skills, pricing `15 GigUSD · 按次`
- Currency label **GigUSD** (ledger unit for labor gigs; not crypto trading UI)

## Deliverables

- `gig-s1-order-form-desktop.html` / `.png`
- `gig-s1-order-form-narrow.html` / `.png`
- `gig-s1-order-form-invalid.html` / `.png` — empty summary + fee `0`, inline errors, submit disabled, **未锁仓**


## 2026-09-04 product lock
- Revisions **max = 1** (stepper disabled / read-only display `1`).
