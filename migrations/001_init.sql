CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  timezone    TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT        NOT NULL,
  amount_kop   BIGINT      NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('pending', 'paid', 'refunded')),
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX orders_customer_status_created ON orders (customer_id, status, created_at);

CREATE TABLE sync_runs (
  id           SERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  pages        INTEGER NOT NULL DEFAULT 0,
  received     INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
