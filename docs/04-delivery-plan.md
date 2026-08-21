# Courier Marketplace — Delivery Plan (Phase 5)

## 1. Market Activation Strategy (given "nationwide from day one")

**Platform is nationwide-capable at launch; markets activate sequentially.** A `service_areas` row with `market_status = planned` exists for every target market from day one — pricing plans, zones, and legal/compliance checklists can be prepped in parallel — but a market only accepts live orders once `market_status = active`, which requires: minimum driver supply threshold met, insurance/licensing review cleared for that state, and background-check provider confirmed operational there. This gets you the nationwide *brand and infra* promise without the liquidity/compliance failure mode of truly flipping on 50 states simultaneously. **Recommend:** pick 1 launch market for the 12-week MVP build/validate cycle below (e.g., DFW, given your base), then use the activation checklist to roll out market #2+ on a cadence you control.

## 2. Epics (prioritized)

| # | Epic | Priority |
|---|---|---|
| E1 | Identity, roles, RBAC foundation | P0 |
| E2 | Address/zone/service-area management | P0 |
| E3 | Quote & pricing engine (rule-based, versioned) | P0 |
| E4 | Order creation & state machine | P0 |
| E5 | Driver onboarding & document verification | P0 |
| E6 | Dispatch & atomic offer-accept | P0 |
| E7 | Pickup/delivery chain-of-custody verification | P0 |
| E8 | Live tracking & location events | P0 |
| E9 | Payments (Stripe Connect) & driver earnings | P0 |
| E10 | Notifications (push/SMS/email) | P0 |
| E11 | Admin ops dashboard & live map | P0 |
| E12 | Suggested route grouping (geo-candidate + dispatcher approval) | P1 |
| E13 | Claims & basic refunds | P1 |
| E14 | Reporting/KPI dashboards | P1 |
| E15 | Audit logging (cross-cutting, build alongside every epic) | P0 (cross-cutting) |

## 3. Sample Stories & Acceptance Criteria (E6 — Dispatch, as a model for the rest)

- **Story:** As the system, when an order enters `SearchingForDriver`, I generate a ranked candidate list and send a timed offer to the top candidate.
  - AC: Offer expires in configurable N seconds if not accepted; expired offers automatically re-offer to next candidate; concurrent accept attempts on the same offer never both succeed (verified via concurrency test).
- **Story:** As a driver, I see estimated payout and required vehicle type before accepting.
  - AC: Payout shown matches the amount actually credited after completion (barring later adjustments/tips); vehicle mismatch blocks accept with a clear reason.

(Full backlog with this level of AC detail should be built out epic-by-epic in your tracker once the spec is approved — recommend Linear/Jira, one epic per module above.)

## 4. Dependencies
- E4 (Orders) depends on E3 (Pricing) for quote consumption.
- E6 (Dispatch) depends on E5 (Driver onboarding/approval) and E2 (Zones).
- E7 (Custody) depends on E6 (an assigned driver must exist).
- E9 (Payments) depends on E4 (order milestones) and E7 (delivery completion triggers final capture).
- E12 (Grouping) depends on E4 + E6 and is explicitly P1 — MVP can launch with individual-order dispatch only and layer grouping in without a rearchitecture, since `route_batches` exists in the data model from day one.

## 5. Technical Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Driver liquidity too thin in launch market | Bad ETAs, churn | Sequenced activation gate (§1); don't flip a market live below driver-supply threshold |
| GPS spoofing on pickup/delivery verification | Fraud, disputed deliveries | Radius check + anomaly detection (impossible speed/jump) + manual review queue |
| Two-system (Firebase + Postgres) identity drift | Auth/authz bugs | `auth-sync` function + server-side-only authorization (never trust Firebase claims for role) |
| Mapping/routing API cost at scale | Margin erosion | Cache distance-matrix results, batch calls, revisit provider at 100k/mo tier |
| Regulatory variance across states (target: nationwide) | Legal exposure | Per-market legal/insurance/licensing checklist gates `market_status = active` (§1) |
| Duplicate pickup/delivery completion from offline sync | Data integrity, payment errors | Idempotency keys on every verification submission (already in architecture) |

## 6. 12-Week MVP Roadmap (single launch market)

| Weeks | Focus |
|---|---|
| 1–2 | Foundation: monorepo, CI/CD, environments, Identity/RBAC (E1), data model migrations, zones/service-areas (E2) |
| 3–4 | Pricing engine + quote API (E3), audit logging wired in from the start (E15) |
| 5–6 | Order creation + state machine (E4), driver onboarding + document upload/approval (E5) |
| 7–8 | Dispatch + atomic offer-accept (E6), live location (E8) |
| 9 | Chain-of-custody: pickup/delivery verification flows, mobile camera/GPS integration (E7) |
| 10 | Payments: Stripe Connect integration, capture milestones, driver earnings (E9) |
| 11 | Notifications (E10), Admin ops dashboard + live map (E11), claims/refunds basic flow (E13) |
| 12 | End-to-end testing, load/concurrency testing, bug bash, launch-market activation checklist, soft launch |

*Suggested-grouping (E12) and full reporting (E14) are explicitly scheduled as fast-follow (weeks 13–16), not blocking initial launch.*

## 7. Suggested Team Composition
- 1 Product/Delivery lead (you, or a PM)
- 2 Backend engineers (Node/TS, Postgres/PostGIS, domain services)
- 1–2 Mobile engineers (React Native, shared between customer + driver apps)
- 1 Frontend engineer (Next.js admin portal) — can be shared with mobile if full-stack
- 1 Design/UX (can be part-time/contract given the wireframes above as a starting point)
- Fractional: DevOps/infra (CI/CD, Terraform setup), QA (test plan execution, weeks 9–12 heavy)

## 8. Testing & Release Strategy

- **Unit:** pricing rule evaluation (all surcharge/discount combinations), state-machine transition validation.
- **Property/scenario tests:** pricing engine against generated combinations of zone/vehicle/service-level/surcharge inputs.
- **Integration:** order creation → quote consumption → dispatch → offer flow.
- **Concurrency:** simulate N drivers accepting the same offer simultaneously — exactly one must win.
- **Route-batching constraint tests:** capacity, time-window, detour-threshold violations correctly rejected.
- **Payment webhook tests:** Stripe event replay, signature-failure rejection, idempotent processing.
- **Permission/access-control tests:** every endpoint tested against every role, including negative cases (customer cannot fetch another customer's order).
- **Media-access tests:** signed URL expiration enforced, no public bucket access.
- **Offline sync tests:** duplicate-submission-after-reconnect produces exactly one state transition.
- **E2E:** full customer/driver/admin happy paths + at least one failure path each (failed delivery, declined offer chain, payment capture failure).
- **Load tests:** location-ping ingestion and dispatch offer generation under simulated peak concurrency.
- **Security tests:** object-level authorization (IDOR-style checks) across all resource-fetching endpoints.
- **Audit verification:** every state-changing test asserts a corresponding audit_log row was written.

**Definition of Done (every feature):** code merged with tests passing in CI; server-authoritative (no client-trusted state); audit-logged if state-changing; error/empty/loading/offline states implemented per UX spec; reviewed against the permissions matrix; no mocked functionality in the production path without an explicit `// MOCK:` label and tracked follow-up ticket; manually verified end-to-end in staging before marked done.

**Release strategy:** feature-flagged rollout per market (`market_status`), staged (dev → staging → production), soft launch to a small driver/customer cohort in the launch market before public marketing push, rollback plan for any P0 service via CI/CD revert + database migration reversibility checked before every release.

---

## Items requiring qualified professional review before launch (restated, do not skip)
Courier licensing, worker classification, insurance requirements, background-check compliance, biometric/privacy law (esp. relevant to the live-selfie requirement — several states regulate biometric data even for non-recognition uses), tax obligations, accessibility compliance, and local/state transportation regulation — all vary by state and must be reviewed market-by-market before `market_status` is set to `active` anywhere.
