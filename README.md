# meshbay-sample-native-shop

A **no-`meshbay.toml`** Node.js shop fixture for Meshbay: one repository, three services, no Dockerfile,
no shared `packages/` folder. Railpack detects Node in each folder, and everything Meshbay needs to know
lives in the dashboard.

Each service is a **Root directory** (`apps/api`, `apps/worker`, `apps/cron`), the way Railway isolates a
service: the build sees only that folder, so every app ships its own `package.json` and lockfile and never
imports code from a sibling folder.

```
                 GitHub: renakaagusta/meshbay-sample-native-shop
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        │ Root directory             │ Root directory              │ Root directory
        ▼                            ▼                             ▼
    apps/api                    apps/worker                    apps/cron
    npm start                   node index.js                  node index.js (one-shot)
    HTTP on $PORT               BullMQ consumer                daily_sales rollup
    Prisma migrate + seed       marks paid after 2 s           then exit 0
    (Pre-deploy command)        writes an order_audit row
        │                            │                              │
        ├──────────────► Postgres ◄──┴──────────────┬───────────────┘
        └──────────────► Redis    ◄─────────────────┘
```

* `apps/api` owns the Prisma schema, the migrations and the seeders. It is the only service that migrates.
* `apps/worker` and `apps/cron` talk to Postgres with plain `pg` SQL against the same tables and never
  migrate, so a deploy of either one can never change the schema under the api.
* Redis carries exactly one job: `orders`. The api enqueues `order.placed`, the worker consumes it.

## Dashboard setup (replaces meshbay.toml)

Create one project, add a **Postgres** database and a **Redis** database to it, then create the three
services from the same repository, one per folder.

### `apps/api`

| Setting | Value |
|---|---|
| Repository / branch | `renakaagusta/meshbay-sample-native-shop`, `main` |
| **Root directory** | `apps/api` |
| Build command | empty — Railpack detects the Node builder |
| Start command | `npm start` → `node src/server.js` (detected) |
| **Pre-deploy command** | `node prisma/run-migrations.js && node prisma/seed/index.js` |
| Variables | `DATABASE_URL=${{postgres.DATABASE_URL}}`, `REDIS_URL=${{redis.REDIS_URL}}` |
| Public networking | **on** |
| Cron schedule | none |

### `apps/worker`

| Setting | Value |
|---|---|
| Repository / branch | `renakaagusta/meshbay-sample-native-shop`, `main` |
| **Root directory** | `apps/worker` |
| Build command | empty — Railpack detects the Node builder |
| Start command | `node index.js` |
| **Pre-deploy command** | none — the worker never migrates |
| Variables | `DATABASE_URL=${{postgres.DATABASE_URL}}`, `REDIS_URL=${{redis.REDIS_URL}}` |
| Public networking | **off** (no HTTP port; it only consumes the BullMQ queue) |
| Cron schedule | none |

### `apps/cron`

| Setting | Value |
|---|---|
| Repository / branch | `renakaagusta/meshbay-sample-native-shop`, `main` |
| **Root directory** | `apps/cron` |
| Build command | empty — Railpack detects the Node builder |
| Start command | not used for the schedule; Meshbay runs the cron command |
| **Pre-deploy command** | none |
| Variables | `DATABASE_URL=${{postgres.DATABASE_URL}}` only — the cron has no Redis client |
| Public networking | **off** |
| **Cron schedule** | `*/5 * * * *`, command `node index.js` |

The api is the only service with a pre-deploy command, so a deploy of the worker or the cron never
touches the schema, and a broken pre-deploy on the api stops that deploy before the new revision starts
serving.

## Repository layout

```
meshbay-sample-native-shop
├── apps
│   ├── api                       Root directory for the HTTP service
│   │   ├── prisma
│   │   │   ├── schema.prisma     Plan, User, Product, Order, OrderAudit, DailySale
│   │   │   ├── migrations        001 init, 002 expand price_cents, 003 contract, 004 status check
│   │   │   ├── run-migrations.js pre-deploy entry: migrates, or fails on purpose with FAIL_MIGRATION=4
│   │   │   └── seed             index.js runs 01_plans, 02_users, 03_products, 04_orders
│   │   ├── src
│   │   │   ├── server.js         node:http router: /health, /products, /orders
│   │   │   ├── products.js       product payload validation and the price contract
│   │   │   ├── orders.js         order payload validation and references
│   │   │   ├── pricing.js        cents <-> decimal price helpers
│   │   │   ├── queue.js          BullMQ "orders" producer
│   │   │   ├── database.js       PrismaClient
│   │   │   ├── http.js           JSON responses, body parsing, path helpers
│   │   │   └── log.js            JSON log lines
│   │   └── test                  node:test unit tests
│   ├── worker                    Root directory for the BullMQ consumer
│   │   ├── index.js              starts the Worker on queue "orders"
│   │   ├── src
│   │   │   ├── consumer.js       marks the order paid after 2 s and writes order_audit
│   │   │   ├── payment.js        job parsing, audit detail, the 2 s delay
│   │   │   ├── database.js       pg Pool
│   │   │   └── log.js
│   │   └── test
│   └── cron                      Root directory for the scheduled job
│       ├── index.js              one-shot daily_sales rollup, exit 0
│       ├── src
│       │   ├── rollup.js         the upsert statement
│       │   ├── database.js       pg Pool
│       │   └── log.js
│       └── test
└── scripts
    ├── smoke.sh                  health, product CRUD, order -> paid, audit row
    └── local-proof.sh            the full local proof on throwaway containers
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `200` `{"status":"ok","database":"ok","redis":"ok"}`; `503` when Postgres or Redis is unreachable |
| GET | `/products` | JSON array of products, each with `priceCents` and the decimal `price` |
| POST | `/products` | `{"sku":"...","name":"...","priceCents":12500}` → `201`; `price` (a decimal like `"12.50"`) is accepted too |
| GET | `/products/{id}` | `200`, `404` when missing |
| PUT | `/products/{id}` | `{"name":"...","priceCents":...}` → `200`, `404` when missing |
| DELETE | `/products/{id}` | `204`, `404` when missing, `409` when the product still has orders |
| GET | `/orders` | JSON array of orders |
| POST | `/orders` | `{"productId":1,"quantity":2}` or `{"productSku":"kopi-gayo-1kg"}` → `201` `status: "pending"`, enqueues `order.placed` |
| GET | `/orders/{id}` | `200` with the order and its `audit` rows, `404` when missing |
| PATCH | `/orders/{id}` | `{"status":"cancelled"}` → `200`; a paid order cannot move to another status (`409`) |

`/api/products`, `/api/orders` and the other `/api/*` prefixes are accepted as aliases, so a client that
was written against an `/api` base path keeps working.

The worker does not expose an endpoint: after the api stores a pending order it waits 2 seconds, flips
the row to `paid`, sets `paid_at` and inserts an `order_audit` row with the reference and the total.

## Variables

| Variable | Used by | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | api, worker, cron, pre-deploy | yes | Postgres URL; in Meshbay `${{postgres.DATABASE_URL}}` |
| `REDIS_URL` | api, worker | yes | Redis URL; in Meshbay `${{redis.REDIS_URL}}` |
| `PORT` | api | no | Injected by Meshbay when public networking is on; defaults to `8080` |
| `SEED_PROFILE` | api pre-deploy | no | `production` (default: plans and products) or `staging` (also demo users and 50 orders) |
| `FAIL_MIGRATION` | api pre-deploy | no | `4` makes the pre-deploy fail on purpose before `prisma migrate deploy` |

The cron takes only `DATABASE_URL`: it has no Redis client at all, so a missing or rotated `REDIS_URL`
cannot break the schedule.

## Migrations and seeders

`prisma migrate deploy` applies the migrations in `apps/api/prisma/migrations` in name order and records
each one in `_prisma_migrations`:

| Migration | What it does |
|---|---|
| `001_init` | `plans`, `users`, `products` (with `price NUMERIC(12,2)`), `orders`, `order_audit`, `daily_sales` |
| `002_expand_price_cents` | adds a nullable `products.price_cents` and backfills `round(price * 100)` |
| `003_contract_price` | backfills any remaining `price_cents`, makes it `NOT NULL` and drops `products.price` |
| `004_add_order_status_check` | adds the `orders_status_check` CHECK constraint (`pending`, `paid`, `cancelled`) |

The price change is an expand / backfill / contract sequence spread over three commits, so it can be
deployed one commit at a time without a maintenance window:

```
001_init      products.price NUMERIC        app writes price
    │                                       (price_cents is absent)
    ▼
002_expand    + price_cents INTEGER NULL    app writes price AND price_cents
              backfill round(price*100)     app reads price_cents, falls back to price
    ▼
003_contract  price_cents NOT NULL          app writes and reads price_cents only
              DROP COLUMN price
```

`apps/api/prisma/run-migrations.js` is the pre-deploy entry. It runs `prisma migrate deploy` and returns
its exit code; with `FAIL_MIGRATION=4` it first runs a `SELECT` that always raises, so the deploy fails
before any migration is applied.

The seeders are ordered and idempotent. `prisma/seed/index.js` invokes, in order:

1. `01_plans.js` — upsert by `code`: `starter`, `growth`, `scale`;
2. `02_users.js` — upsert demo users by `email` (staging only);
3. `03_products.js` — upsert by `sku`: three products with their price in cents;
4. `04_orders.js` — upsert 50 demo orders by `reference` (staging only; 10 of them paid).

Every step compares the desired rows against the table first, so a redeploy with an unchanged database
writes nothing. Each step logs one line:

```
seed: plans upserted=3 unchanged=0
seed: plans upserted=0 unchanged=3
```

`SEED_PROFILE=production` (the default) seeds reference data only (plans and products), and the users and
orders steps log that they are staging only. `SEED_PROFILE=staging` also seeds the two demo users and 50
demo orders, which is what stage 2's fourth scenario needs.

Because migrations and seeds both run in the pre-deploy step, a redeploy on Meshbay shows no applied
migration and a seeder log where every step reports `upserted=0`.

## Scenarios

### 1. Expand, backfill, contract: `price` → `price_cents`

Deploy the three commits in order, each one as its own Meshbay deploy of the api service:

| Step | Commit | Migration applied | What the api does |
|---|---|---|---|
| 1 | __SHA_001__ | `001_init` | writes `products.price`, reads it back, reports both `price` and `priceCents` |
| 2 | __SHA_002__ | `002_expand_price_cents` | writes both columns, reads `price_cents` and falls back to `price` |
| 3 | __SHA_003__ | `003_contract_price` | writes and reads `price_cents` only; `price` is gone |

Each step is a deploy that also runs the seeder, so the products are re-upserted against the new column
right after the migration. Between step 1 and step 3 the same endpoint contract keeps working:
`GET /products` always answers `priceCents` and the decimal `price`, and the api never reads a column the
current migration has not created yet.

Expected result per step:

1. Deploy 1: `001_init` applied, three products seeded, `GET /products` returns `price: "125.00"` and
   `priceCents: 12500`, an order can be placed and the worker marks it paid.
2. Deploy 2: `002_expand_price_cents` applied, the backfill fills `price_cents` for the existing rows, the
   seeder reports `upserted=0 unchanged=3`, and `/products` answers the same JSON as before.
3. Deploy 3: `003_contract_price` applied, `price` is dropped from the table, and `/products` still
   answers `price` (derived from `price_cents`), so clients see no change.

### 2. A failing migration

`004_add_order_status_check` adds a CHECK constraint on `orders.status`. To prove that Meshbay stops a
deploy when the pre-deploy fails, set the api service variable `FAIL_MIGRATION=4` and deploy:

1. The pre-deploy command runs `node prisma/run-migrations.js`, which sees `FAIL_MIGRATION=4`, runs a
   `SELECT` that raises `division by zero` and exits non-zero before `prisma migrate deploy` starts.
2. The deploy is marked **failed**; the migration is not recorded in `_prisma_migrations` and the schema
   is untouched.
3. The **previous revision keeps serving**: `GET /health` stays `200`, and `/products` and `/orders`
   answer as before.
4. Remove the `FAIL_MIGRATION` variable and deploy again: `004_add_order_status_check` applies, the
   seeder reports every step unchanged, and the new revision starts serving.

The migration itself stays valid: it only runs when the variable is absent.

### 3. Ordered, idempotent seeders

1. Deploy with `SEED_PROFILE` unset (production) and watch the pre-deploy log: `plans` and `products`
   report `upserted=3 unchanged=0` on the first deploy that has an empty database.
2. Deploy again without a new commit: every step reports `upserted=0`, for example
   `seed: products upserted=0 unchanged=3`, and no row changes.
3. Set `SEED_PROFILE=staging` and deploy: the users step reports `upserted=2` and the orders step
   `upserted=50` the first time, then everything reports unchanged.

### 4. Pre-deploy only on the api, cron on its own schedule

1. Deploy the worker: its log has no migration and no seed output, only `worker started`.
2. Deploy the cron: nothing runs until the schedule fires.
3. Wait for `*/5 * * * *` (or trigger the cron job from the dashboard) and read the log:
   `daily_sales rollup written` with the day, the number of paid orders and the revenue in cents, then
   exit code 0. The `daily_sales` row is upserted, so running it twice on the same day keeps one row.

## Local proof

The proof runs the whole fixture on throwaway containers and removes them afterwards:

```sh
bash scripts/local-proof.sh
```

It does what the ticket asks, in order:

1. `postgres:17-alpine` on `127.0.0.1:55432` and `redis:7-alpine` on `127.0.0.1:56379`;
2. `npm ci` in every app folder (each one has its own lockfile);
3. `node prisma/run-migrations.js` then `node prisma/seed/index.js` **twice** — the second run prints only
   `unchanged`;
4. `node src/server.js` and `node index.js` (worker), then `scripts/smoke.sh`: it creates an order and
   polls until the worker has marked it paid and written the audit row;
5. `node index.js` in `apps/cron` once and a `daily_sales` dump;
6. `FAIL_MIGRATION=4 node prisma/run-migrations.js`, whose exit code must be non-zero;
7. `curl /health` on the running api.

Manual equivalent, if you prefer to run the steps yourself:

```sh
docker run -d --name shop-pg -e POSTGRES_PASSWORD=fixturepw -e POSTGRES_USER=app -e POSTGRES_DB=shop \
  -p 55432:5432 postgres:17-alpine
docker run -d --name shop-redis -p 56379:6379 redis:7-alpine

export DATABASE_URL=postgres://app:fixturepw@127.0.0.1:55432/shop
export REDIS_URL=redis://127.0.0.1:56379

cd apps/api && npm ci && node prisma/run-migrations.js && node prisma/seed/index.js && node prisma/seed/index.js
node src/server.js &
cd ../worker && npm ci && node index.js &
bash ../../scripts/smoke.sh http://127.0.0.1:8080
cd ../cron && npm ci && node index.js
FAIL_MIGRATION=4 node ../api/prisma/run-migrations.js; echo "exit=$?"

docker rm -f shop-pg shop-redis
```

Every app also has unit tests that need no database:

```sh
cd apps/api && npm test
cd apps/worker && npm test
cd apps/cron && npm test
```

## Notes and known Meshbay gaps

* `prisma` is a **production** dependency: the pre-deploy command runs inside the runtime image, after
  Railpack has pruned dev dependencies, so both the CLI and `prisma generate` must survive the prune.
* Pre-deploy semantics (once per deploy or once per replica) are still undocumented. This fixture is safe
  either way: migrations are ordered and locked by Prisma, and every seeder write is an upsert.
* A seeder is not transactional across tables. A crash between steps leaves some rows written; the next
  deploy's upsert converges them, which is the point of the fixture.
* The `orders_status_check` constraint lives only in SQL: Prisma does not model CHECK constraints, so
  `schema.prisma` and the database differ by that one constraint, exactly like a hand-written index.
* The worker is at-least-once: the `UPDATE ... WHERE status = 'pending'` guard means a retried job never
  pays an order twice and never writes a second audit row for the same payment.
