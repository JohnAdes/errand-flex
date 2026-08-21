# Courier Marketplace — Starter Implementation

This is a working MVP implementation of the courier marketplace spec (see `01-product-specification.md` through `04-delivery-plan.md` if included alongside this code). It is **not** a finished product — it's a real, running foundation covering the highest-risk pieces (pricing, order state machine, atomic dispatch, chain-of-custody) with everything else scaffolded and clearly labeled.

## What's actually verified working

Everything below was run for real against a live PostgreSQL database during development — not just written and assumed correct:

- **Backend API** (`apps/api`): install → migrate → seed → serve, all confirmed working
- **Pricing engine**: 15 unit tests passing
- **Full order lifecycle**: quote → order → dispatch offer → accept → pickup verification → delivery verification → `DELIVERED`, confirmed end-to-end via real HTTP requests with a real audit trail
- **Concurrency safety**: the critical guarantee that exactly one driver can accept a given offer was verified two ways — 10 simultaneous real HTTP requests (9 got `409 Conflict`, 1 got `200`), and a codified integration test (`tests/dispatch.concurrency.test.ts`) that does the same with 15 concurrent attempts
- **Admin portal** (`apps/admin`): clean `next build`, and every API call its pages make was independently verified against the live backend (orders list, KPIs, driver approval queue, approve/suspend actions, plus business accounts/claims/payments/dispatch — see below)
- **Security**: a real bug was found and fixed where the driver-approval endpoint leaked `passwordHash` — verified the fix by inspecting the actual API response, not just the code
- **Admin-configurable pricing engine**: `pricing.service.ts` now evaluates a data-driven rule set (`pricing_rules` rows, published into immutable `pricing_rule_versions` snapshots) instead of hard-coded constants — verified live: created a quote, edited a rule via the new `/v1/admin/pricing/*` CRUD + publish endpoints, and confirmed the next quote reflected the new price and referenced the new version id. 15 unit tests passing (`tests/pricing.test.ts`).
- **Route-grouping / batching**: a real (if geo-simplified — see `batching.service.ts` for the exact scope) grouping algorithm now clusters un-batched orders by pickup/dropoff proximity, weight capacity, and service-level compatibility, scores clusters by detour ratio, and persists accepted groupings as `route_batches`. Verified end-to-end against a live DB: two nearby orders were suggested as a batch, approved, offered to a driver as one multi-order offer, and accepted — confirming both orders transitioned to `DRIVER_ASSIGNED`, the batch to `ASSIGNED`, and the driver's `active_order_count` incremented atomically by 2. The dispatch offer/accept endpoints now handle both single-order and batch offers.
- **Mobile apps**: `npm install`, `expo-doctor`, `tsc --noEmit`, and `expo export` (iOS + Android bundle) all verified clean for both `customer-app` and `driver-app` — see the Mobile apps section below for what wasn't (and can't be, headlessly) checked.
- **Payments lifecycle** (`payments.service.ts`): a real authorize → capture → refund state machine against a pluggable `PaymentProvider` (a default `MockPaymentProvider` — see the architecture note below — with the seam clearly marked for a real Stripe implementation). Verified live end-to-end: `POST /v1/orders/:id/pay` authorizes and advances the order into dispatch; delivering the order captures the *net* amount (original minus any pre-capture discounts); resolving a claim can issue a real partial refund against the same payment.
- **Driver earnings & payouts**: delivering an order now actually credits the driver's earnings ledger (`driver_earnings`, `PENDING`) with the accepted offer's payout amount — previously nothing ever wrote to that table. `POST /v1/admin/payouts/run` batches a driver's pending earnings into one `PAID` payout. Verified live: delivered an order, confirmed the earning appeared via `GET /v1/drivers/me/earnings`, ran a payout, confirmed it flipped to `PAID`.
- **Business accounts & volume pricing**: a new `business_accounts` entity groups customer profiles so admins can see live monthly order volume and set *per-business* negotiated discount tiers, evaluated by a new `BUSINESS_VOLUME_DISCOUNT` pricing rule. Verified live, including a real bug caught and fixed along the way: the evaluator was initially only reading the platform-default tier list from the published pricing-rule set and silently ignoring each business account's own `discountTiers` — fixed so a business's own negotiated tiers take priority.
- **Grouped-route discount**: a quote is priced and locked before dispatch ever runs, so there's no way to discount a customer's price *at quote time* for a grouping that hasn't happened yet. Instead, `batching.service.ts` now issues a real discount (via the payments module's refund machinery) sized as a share of the detour savings whenever it successfully groups orders — verified live: two nearby orders were grouped, and both received a discount refund row reducing their net payable amount, without violating the "a quote's charged price never retroactively changes" guarantee.
- **Live location tracking**: `location_events` previously had zero write path anywhere in the codebase. `POST /v1/drivers/me/location` (what a real driver app's background task would call) plus `GET /v1/orders/:id/tracking` (object-level-authorized, only exposed while an order is actually in transit) are now real and verified live.
- **Claims / disputes ("exceptions")**: `claims_disputes` previously had a schema and nothing else. A full module now exists — customers/drivers file claims, dispatch staff resolve them (`RESOLVED`/`REJECTED`), and a resolution can issue a real refund in the same action. Required a small migration adding `description`/`reported_by_user_id` columns the original schema was missing.
- **Scheduled background jobs** (`apps/api/src/jobs/`): the four jobs from 02-architecture.md §7 — offer-expiry sweep, route-batch-suggestion run, driver-document-expiration sweep, payout run — are now real BullMQ/Redis repeatable jobs, not just manually-triggered endpoints (those still exist too, for one-off/ad-hoc runs). Verified live three different ways: the offer-expiry sweep actually fired on its own 30s schedule and correctly resolved a backdated-expired offer before a manual test even ran; the doc-expiration sweep and payout run were verified via `scripts/run_job.ts <job-name>`, a small utility for running any job once without waiting for its interval. The scheduler is tolerant of Redis being unreachable — it logs a warning and leaves the API fully functional without scheduled jobs rather than crashing boot.
- **Mobile app UI wiring**: `customer-app`'s `OrderTrackingScreen` now has a real "Pay now" step (calls `/pay`), a live-tracking card (polls `/tracking`), a star-rating widget (`/ratings`), and a claim-filing form (`/claims`) — previously an order created via the app would sit in `AWAITING_PAYMENT` forever, since nothing ever called the payment endpoint. `driver-app`'s `ActiveRouteScreen` now posts a location ping every 15s while a delivery is active (foreground-only, via `setInterval` — see the code comment on why this isn't a true native background task). Both apps still pass `tsc --noEmit` and `expo export` after these changes.
- **Gateway rate limiting**: `@fastify/rate-limit`, global default 300 req/min per IP plus stricter per-route overrides on auth (10/min — brute-force protection), offer-accept (50/min), and location-ping (30/min), per 02-architecture.md §11. Verified with a real `autocannon` load test, not just a smoke check: 10 concurrent connections hammering an auth-protected endpoint got exactly 300 `200`s and 22,742 `429`s — the configured limit enforced precisely under real concurrent HTTP load. Caught and fixed a real bug along the way: the global error handler discarded every non-`AppError`'s real status code (rate-limit's `429`, a body-parser `400`) and always returned `500` — now it passes through any error's own `statusCode` when present.
- **Ratings & reviews**: `ratings` had a schema and a static `drivers.rating_avg` default (`5.0`) that never moved. A customer can now rate the driver who carried their order (1–5 stars) once it's `DELIVERED`; the driver's `rating_avg` is recomputed live from every rating they've ever received — verified live across two separate orders: submitting a 3-star then a 5-star rating produced the correct average (4), and a duplicate-rating attempt on the same order correctly got `409 Conflict`.
- **Admin portal UI for previously backend-only modules**: business accounts (create, manage per-business discount tiers, add/remove members, see live monthly order volume), claims/disputes (review queue, resolve with an optional real refund), payments & payouts (payment/refund ledger, KPIs, trigger an ad-hoc payout run), route batches (review suggested groupings, approve/reject, offer to a driver, or trigger a suggestion run on demand), and a **pricing rule editor** (per-rule-type forms, not raw JSON — add/edit/delete draft rules, publish a new version, see version history) — all five existed as tested APIs with zero UI before this. Clean `next build` across all 5 new pages plus the existing ones (10 routes total). Along the way, fixed the same "empty POST body + `Content-Type: application/json`" 400 error (see the rate-limit bugfix above) in the admin API client's parameter-less POSTs, including the pre-existing `approveDriver` call, which had the identical latent issue.
- **Six critical bugs found by a code-review pass, fixed and live-verified**: (1) a driver could verify pickup/delivery for *any* order, not just their own — falsified custody records and corrupted the wrong driver's capacity counter; (2) a customer could cancel *any* customer's order (IDOR); (3) `GET /v1/orders/:id` leaked any order's full PII to any driver, not just the assigned one; (4) accepting a route-batch offer crashed the driver app (`order.stops` on `null` — the app never handled batch-shaped offers); (5) a route batch could be offered twice, throwing mid-loop and orphaning a duplicate offer, because its status never advanced off `APPROVED` (fixed with the same atomic conditional-UPDATE pattern `acceptOffer` already used, plus teaching `declineOffer` and the expiry sweep to release a batch back to `APPROVED` instead of leaving it stuck); (6) `drivers.active_order_count` was only released on a *successful* delivery — a failed one leaked a capacity slot forever, silently locking a driver out after 3 failed deliveries. Every fix was verified against the live DB with a positive and negative case (e.g. an unrelated driver gets `403`, the assigned driver gets `200`), not just read for plausibility.
- **Automated test coverage for every module built this session**: previously only `pricing.test.ts` and `dispatch.concurrency.test.ts` existed — payments, claims, ratings, business accounts, and batching were verified live via curl/scripts but had zero regression protection. Five new real integration-test files (26 new tests, bringing the suite to 42 tests across 7 files, all against a live Postgres DB, same reasoning as the concurrency test) now cover authorize/capture/refund arithmetic, claim authorization + refund-on-resolve, live rating-average recomputation, real monthly-volume aggregation for business accounts, and the batching/grouped-discount pipeline. A shared `tests/helpers/fixtures.ts` factors out the customer/driver/order/payment fixture boilerplate the review flagged as a duplication risk elsewhere.
- **Mobile flows that were the actual blocker to anyone besides the two seeded accounts using the app**: both apps previously only supported signing into a pre-seeded demo account — `registerCustomer`/`registerDriverApplicant` existed in the API clients with no UI ever calling them. Both apps now have a real sign-up flow. The driver app also gates on a new `GET /v1/drivers/me` profile endpoint: a driver who isn't `APPROVED` sees a real onboarding screen (vehicle info + a captured license photo, submitted via the existing `POST /v1/drivers/me/vehicles`/`/documents` endpoints) instead of landing on the home screen with no way to ever get approved. The customer app gained an order-history screen (`GET /v1/orders` existed, nothing called it) — closing an in-progress order previously meant losing track of it entirely.

## What's scaffolded but NOT run in this environment

- **Mobile apps** (`apps/customer-app`, `apps/driver-app`): complete Expo/React Native source — API clients, screens, camera/location integration, and now real pay/tracking/claims/rating/location-ping/onboarding wiring (see above). `npm install`, `expo-doctor` (+ its fixes), `tsc --noEmit`, and `expo export` for both iOS and Android all pass, so the JS bundles are known-good. An actual on-device/emulator boot was attempted, not just assumed impossible: there's no iOS Simulator here, but a full Android SDK (emulator binary + system images) was already present, so an AVD was created and booted for real. It genuinely ran (`qemu-system-x86_64` consuming real CPU) but never completed boot after ~40 minutes and stalled at 0% CPU — this sandbox's Intel hardware reports `Hypervisor.Framework` as available via `emulator -accel-check`, but the actual boot behavior (extremely slow, then stalled) is consistent with nested virtualization not actually being passed through to this environment. Stopped cleanly (`adb emu kill`) rather than left hanging. Camera/location permission prompts, native module behavior (`expo-camera`, `expo-location`, `expo-secure-store`), and real calls to a running API still haven't been exercised on an actually-running instance — run `npx expo start` yourself on real hardware or an unrestricted machine and expect it to work; the codebase isn't the blocker here, this sandbox's virtualization access is.
- True native background location publishing — the driver app pings location every 15s, but only while the app is open and the screen mounted (`setInterval`, not `expo-task-manager`/`expo-location`'s background task API). Real background tracking while the app is backgrounded needs the native background-location entitlement flow, which needs a real device to verify.
- **Real Stripe, Firebase Auth, cloud storage, and Twilio SMS integrations are now implemented** (previously just documented seams) — each behind an env-var toggle that defaults to the mock/local behavior CI and the test suite run against, so nothing here changes default behavior:
  - `PAYMENT_PROVIDER=stripe` activates `StripePaymentProvider` (`payment.provider.ts`) — creates a real PaymentIntent on `authorize()`. **Scope note:** it does not confirm the PaymentIntent, since Stripe requires a payment method collected client-side (Stripe's SDK/Elements), which no mobile app here integrates yet — that's a separate mobile feature, not covered by this class. The `clientSecret` a real client-side confirmation would need is returned from `authorizePayment`/`POST /v1/orders/:id/pay` but nothing consumes it yet.
  - `AUTH_PROVIDER=firebase` activates real Firebase ID token verification (`middleware/auth.ts`). `users.firebaseUid` (new, nullable, unique) links a local user row to a Firebase identity; `POST /v1/auth/link-firebase-account` provisions that link after the client signs up/in with Firebase's own SDK. `users.passwordHash` is now nullable to allow this.
  - `STORAGE_PROVIDER=firebase` activates real Firebase Cloud Storage v4 signed upload URLs via a new `POST /v1/uploads/signed-url` endpoint — the `ref` it returns is exactly the opaque string `driverSelfieRef`/`packagePhotoRefs`/`podPhotoRef`/document `fileRef` already expected everywhere.
  - `SMS_PROVIDER=twilio` activates real Twilio SMS. Also newly implemented: the `/v1/auth/verify-phone/send` + `/confirm` OTP flow the API spec documented but nothing built — a 6-digit code, bcrypt-hashed server-side (same pattern as a password), 10-minute expiry.
  - None of the four "real" paths have been run against live credentials in this environment (no live Stripe/Firebase/Twilio accounts here) — verified so far: clean typecheck/build, the full existing test suite still passing against the mock/local defaults, and a live smoke test of the mock-mode phone-verification and signed-upload-URL flows against a running instance of this API. Flipping any provider to its real mode and confirming it end-to-end against a live account is the next step, not done here.
- Route-grouping uses straight-line distance (same placeholder as pricing's `estimateDistanceKm`) instead of a real mapping-provider distance matrix, and persists only the pickup-side stop sequence per order — `route_assignments.order_id`/`.stop_id` are both `UNIQUE` in the existing schema, so a full pickup+dropoff stop sequence per order would need a schema change; see the comment at the top of `batching.service.ts`.

## Architecture note: why Drizzle, not Prisma

The original architecture spec called for Prisma. Partway through building this, Prisma's CLI failed to download its native query-engine binaries (`binaries.prisma.sh` returned 403 in this environment) — a real, reproducible failure, not a hypothetical concern. The codebase was rewritten on Drizzle ORM instead, which is pure JS/TS with no native-binary download step: `npm install` is the only thing that needs network access. Migrations are pre-generated and committed (`apps/api/drizzle/`), so `npm run db:migrate` works fully offline against any Postgres you point it at.

If your local network doesn't have this problem and you'd prefer Prisma, the schema in `apps/api/src/db/schema.ts` is a straightforward reference for porting back.

**Update:** in this environment, the `drizzle-kit` CLI itself (not just `db:migrate` — `generate` too) fails at startup with `Please install latest version of drizzle-orm`, independent of any database connection, for both installed package versions available here. Migrations `0001_business_accounts.sql` and `0002_claims_columns.sql` were therefore hand-written (matching `drizzle-kit`'s own SQL conventions) and applied directly via `psql` rather than generated — same workaround `0000` already relied on for `migrate`. If your environment doesn't have this problem, `drizzle-kit generate` should work normally from here on; the `meta/_journal.json` entries were updated by hand to match.

## Architecture note: why local JWT, not Firebase Auth

Same reasoning — Firebase Auth needs a real Firebase project and service account credentials, which don't exist for this starter kit. `apps/api/src/middleware/auth.ts` has a clearly marked seam for swapping in `firebase-admin`'s `verifyIdToken` when you're ready to wire up a real project.

## Architecture note: why a mock payment provider, not real Stripe

Same pattern again — real Stripe needs a live account and API keys (`.env` only ships `STRIPE_SECRET_KEY="sk_test_placeholder"`). Rather than leave payments entirely unimplemented (the previous state — `payments` table existed, nothing ever wrote to it), `payments/payment.provider.ts` defines a `PaymentProvider` interface and ships a `MockPaymentProvider` default that makes the *rest* of the payment lifecycle — authorize, capture, refund, driver-earnings ledger, payouts — real and independently testable offline. Every caller goes through the interface, never the concrete class, so wiring up real Stripe later is a one-file swap: implement `PaymentProvider` with `stripe.paymentIntents.*`, set a real `STRIPE_SECRET_KEY`, swap the export at the bottom of `payment.provider.ts`.

## Setup

**Prerequisites:** Node 20+, Docker (for Postgres — or a local Postgres 16 install), npm.

```bash
# 1. Install all workspace dependencies
npm install

# 2. Start Postgres and Redis (Redis now runs the scheduled background jobs — see jobs/queue.ts;
#    the API still boots fine without it, just without scheduled jobs)
docker compose up -d

# 3. Configure environment
# IMPORTANT: the API loads .env from its own directory (apps/api), not the
# repo root — dotenv resolves relative to the process's working directory,
# and `npm run dev:api` runs with cwd set to apps/api.
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env if your DATABASE_URL differs from the default

# 4. Run migrations and seed data
npm run db:migrate
npm run db:seed

# 5. Start the API
npm run dev:api
# → http://localhost:4000, health check at /health

# 6. In another terminal, start the admin portal
npm run dev:admin
# → http://localhost:3000
```

**Seeded accounts** (all password `password123`):
| Role | Email | Notes |
|---|---|---|
| Customer | casey@example.com | |
| Driver | marcus@example.com | Pre-approved, online, has a vehicle |
| Admin | owen@example.com | SUPER_ADMIN — can access the admin portal |

## Mobile apps

```bash
cd apps/customer-app   # or apps/driver-app
npm install
npx expo start
```

Both apps default to `http://localhost:4000` for the API. **If testing on a physical phone via Expo Go**, `localhost` refers to the phone itself, not your computer — set `EXPO_PUBLIC_API_URL` to your computer's LAN IP (e.g. `http://192.168.1.50:4000`) in an `.env` file or via `EXPO_PUBLIC_API_URL=http://192.168.1.50:4000 npx expo start`.

## Running tests

```bash
npm run test:api
```

The concurrency test (`tests/dispatch.concurrency.test.ts`) needs a reachable `DATABASE_URL` — it skips gracefully (with a warning) if the DB isn't reachable, but you should run it for real (`docker compose up -d` first) before trusting any change to `dispatch.service.ts`. That test covers the single most important correctness property in the system.

The five newer integration test files (`payments.test.ts`, `claims.test.ts`, `ratings.test.ts`, `business.test.ts`, `batching.test.ts`) follow the same pattern — real DB, real service calls, `tests/helpers/fixtures.ts` for shared setup/teardown — and skip the same way if the DB isn't reachable. `batching.test.ts` scans every `SEARCHING_FOR_DRIVER` order in the DB (that's what `suggestRouteBatches` actually does), so it checks for its expected batch as a subset rather than requiring exact isolation from other data in your dev DB.

**CI**: `.github/workflows/ci.yml` runs the same typecheck/build/test steps against a Postgres service container on every push/PR. It hasn't run for real yet in this environment (no git remote here to push to and trigger it), so treat it as written-but-unverified until its first real run — the steps themselves are the same commands verified manually throughout this README.

## Background jobs

```bash
# Run any scheduled job once immediately, without waiting for its interval:
cd apps/api
npx tsx scripts/run_job.ts offer-expiry-sweep
npx tsx scripts/run_job.ts batch-suggestion-run
npx tsx scripts/run_job.ts driver-document-expiration-sweep
npx tsx scripts/run_job.ts payout-run
```

With `REDIS_URL` reachable, the API also registers all four as real repeating jobs on boot (`src/jobs/queue.ts`) — offer-expiry sweep every 30s, batch-suggestion every 5 minutes, driver-document-expiration daily, payout run weekly. Without Redis, the API still boots and runs fine; you just lose the automatic scheduling and fall back to the manual triggers above / the admin endpoints (`POST /v1/internal/dispatch/batches/suggest`, `POST /v1/admin/payouts/run`).

## Project structure

```
docs/                Phases 2-5 specification docs (product, architecture, UX, delivery plan)
apps/
  api/              Fastify + TypeScript + Drizzle ORM + PostgreSQL backend
  admin/             Next.js admin/dispatcher portal
  customer-app/      Expo/React Native customer app (scaffold — see status above)
  driver-app/        Expo/React Native driver app (scaffold — see status above)
packages/
  shared-types/      TypeScript types/enums shared across API and admin
docker-compose.yml   Local Postgres (postgis/postgis image) + Redis
```

## Known gaps to close before this is production-ready

Beyond what's listed above as unimplemented, straight from the delivery plan's testing/review requirements:

- Rate limiting is per-IP only (see above) — per-user limiting needs the JWT decoded before the rate-limit plugin's hook runs, which is ahead of each route's own auth check; a reasonable next increment, not implemented
- CI is configured (`.github/workflows/ci.yml`) but unverified — this environment has no git remote to actually trigger a run against; confirm it goes green on first real push
- No real payment gateway credentials — the payment *lifecycle* is real (see the mock-provider architecture note above), but nothing has moved real money; needs a live Stripe account before launch
- Legal/compliance review (licensing, insurance, worker classification, biometric-data law relevant to the live-selfie requirement) has not happened — do not launch without it, regardless of code readiness
