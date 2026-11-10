import { describe, expect, it } from "vitest";
import { migrate } from "../src/db.js";
import { apiOrder, appWithDbIntercept, dailyTotals, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /sync", () => {
  it("проходит все страницы и останавливается на пустой странице с тем же курсором", async () => {
    const [a, b, c] = [apiOrder(), apiOrder(), apiOrder()];
    ctx.api.pages.set(null, { items: [a, b], nextCursor: "p2" });
    ctx.api.pages.set("p2", { items: [c], nextCursor: "p3" });
    ctx.api.pages.set("p3", { items: [], nextCursor: "p3" });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pages: 3, received: 3, applied: 3, invalid: 0 });
    const { rows } = await ctx.db.query(`SELECT count(*)::int AS n FROM orders`);
    expect(rows[0].n).toBe(3);
  });

  it("невалидные заказы пропускает, а не падает", async () => {
    ctx.api.pages.set(null, { items: [apiOrder(), { id: "broken" }, apiOrder({ amount: "abc" })], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ received: 3, applied: 1, invalid: 2 });
  });

  it("не откатывает более свежую версию заказа", async () => {
    const fresh = apiOrder({ status: "refunded", updatedAt: "2026-02-12T00:00:00Z" });
    await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: fresh });
    ctx.api.pages.set(null, { items: [{ ...fresh, status: "paid", updatedAt: "2026-02-10T12:00:00Z" }], nextCursor: null });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ stale: 1 });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [fresh.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("сохраняет страницу одним запросом к базе, а не запросом на каждый заказ", async () => {
    ctx.api.pages.set(null, { items: [apiOrder(), apiOrder(), apiOrder()], nextCursor: "p2" });
    ctx.api.pages.set("p2", { items: [apiOrder(), apiOrder()], nextCursor: "p3" });
    ctx.api.pages.set("p3", { items: [], nextCursor: "p3" });
    let inserts = 0;
    const app = appWithDbIntercept(ctx, (text, values, next) => {
      if (text.trimStart().startsWith("INSERT INTO orders")) inserts++;
      return next(text, values);
    });
    const res = await app.inject({ method: "POST", url: "/sync" });
    await app.close();
    expect(res.json()).toMatchObject({ pages: 3, received: 5, applied: 5 });
    expect(inserts).toBe(2); // по запросу на непустую страницу
  });

  it("повторы заказа на одной странице: сохраняется самая свежая версия, синк не падает", async () => {
    const o = apiOrder({ status: "pending", updatedAt: "2026-02-10T12:00:00Z" });
    const items = [o, { ...o, status: "paid", updatedAt: "2026-02-10T13:00:00Z" }, { ...o, status: "refunded", updatedAt: "2026-02-10T11:00:00Z" }];
    ctx.api.pages.set(null, { items, nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: 3, applied: 1, stale: 2, invalid: 0 });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("paid");
  });

  it("после обновления базы синк загружает оплаченную сумму у заказов, сохранённых до миграции 002", async () => {
    // Воспроизводим базу прежней версии сервиса: колонки amount_paid_kop нет, заказ со скидкой сохранён без неё.
    // Затем применяем миграцию 002, как при обновлении. Версия заказа в API не изменилась, но синк должен
    // дозаписать оплаченную сумму — иначе скидка у такого заказа не появится никогда
    const o = apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900, createdAt: "2026-03-20T12:00:00Z", updatedAt: "2026-03-20T12:00:00Z" });
    await ctx.db.query(`ALTER TABLE orders DROP COLUMN amount_paid_kop`);
    await ctx.db.query(`DELETE FROM schema_migrations WHERE name = '002_amount_paid.sql'`);
    try {
      await ctx.db.query(
        `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at) VALUES ($1, $2, 100000, 'paid', $3, $4)`,
        [o.id, o.customerId, o.createdAt, o.updatedAt],
      );
    } finally {
      await migrate(ctx.db);
    }
    const before = await dailyTotals(ctx.app, "c_1", "2026-03-20", "2026-03-20");
    expect(before.json()).toEqual([{ date: "2026-03-20", total: 1000, gross: 1000, discount: 0, net: 1000 }]);

    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ applied: 1, stale: 0 });
    const after = await dailyTotals(ctx.app, "c_1", "2026-03-20", "2026-03-20");
    expect(after.json()).toEqual([{ date: "2026-03-20", total: 1000, gross: 1000, discount: 100, net: 900 }]);
  });

  it("строковые суммы и даты без зоны", async () => {
    const o = apiOrder({ amount: "2500.00", createdAt: "2026-02-10T21:30:00" });
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });
    const { rows } = await ctx.db.query(`SELECT amount_kop, created_at FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_kop)).toBe(250000);
    expect(rows[0].created_at.toISOString()).toBe("2026-02-10T21:30:00.000Z");
  });
});
