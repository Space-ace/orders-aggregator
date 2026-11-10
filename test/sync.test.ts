import { describe, expect, it } from "vitest";
import { apiOrder, appWithDbIntercept, setupTestApp } from "./helpers.js";

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

  it("строковые суммы и даты без зоны", async () => {
    const o = apiOrder({ amount: "2500.00", createdAt: "2026-02-10T21:30:00" });
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });
    const { rows } = await ctx.db.query(`SELECT amount_kop, created_at FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_kop)).toBe(250000);
    expect(rows[0].created_at.toISOString()).toBe("2026-02-10T21:30:00.000Z");
  });
});
