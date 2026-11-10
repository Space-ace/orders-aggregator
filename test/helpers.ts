import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { buildApp } from "../src/app.js";
import type { Customer, OrdersApi, OrdersPage } from "../src/clients/orders-api.js";
import { createContainer, type Container } from "../src/container.js";
import { createDb, migrate, type Db } from "../src/db.js";

/** Внешний API в памяти: страницы по курсору и клиенты. */
export class FakeApi implements OrdersApi {
  pages = new Map<string | null, OrdersPage>();
  customers = new Map<string, string>();
  calls = 0;

  async getOrdersPage(cursor: string | null): Promise<OrdersPage> {
    this.calls++;
    const page = this.pages.get(cursor);
    if (!page) throw new Error(`unexpected cursor ${cursor}`);
    return page;
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const timezone = this.customers.get(id);
    return timezone ? { id, timezone } : null;
  }

  reset() {
    this.pages.clear();
    this.customers.clear();
    this.calls = 0;
  }
}

let seq = 0;

/** Заказ в формате внешнего API. */
export function apiOrder(over: Partial<Record<string, unknown>> = {}) {
  seq++;
  return {
    id: `o_${seq}`,
    customerId: "c_1",
    amount: 1000,
    status: "paid",
    createdAt: "2026-02-10T12:00:00.000Z",
    updatedAt: "2026-02-10T12:00:00.000Z",
    ...over,
  };
}

export interface TestContext {
  db: Db;
  api: FakeApi;
  container: Container;
  app: FastifyInstance;
}

/** Приложение на тестовой БД с фейковым внешним API. Перед каждым тестом таблицы очищаются. */
export function setupTestApp(): TestContext {
  const ctx = { api: new FakeApi() } as TestContext;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orders_test";
    ctx.db = createDb(url);
    await migrate(ctx.db);
    ctx.container = createContainer(ctx.db, ctx.api);
    ctx.app = buildApp(ctx.container);
    await ctx.app.ready();
  });

  beforeEach(async () => {
    await ctx.db.query(`TRUNCATE orders, customers, sync_runs RESTART IDENTITY`);
    ctx.api.reset();
    ctx.api.customers.set("c_1", "Europe/Moscow");
  });

  afterAll(async () => {
    await ctx.app?.close();
    await ctx.db?.end();
  });

  return ctx;
}

export async function postWebhook(app: FastifyInstance, order: unknown) {
  return app.inject({ method: "POST", url: "/webhooks/order", payload: order as object });
}

export async function dailyTotals(app: FastifyInstance, customerId: string, from: string, to: string) {
  return app.inject({ method: "GET", url: `/customers/${customerId}/daily-totals?from=${from}&to=${to}` });
}
