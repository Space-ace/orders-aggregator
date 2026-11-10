import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it("принимает форматы внешнего API: сумма строкой, дата без зоны, скидка строкой", async () => {
    const res = await postWebhook(ctx.app, apiOrder({ amount: "1851.00", createdAt: "2026-03-29T22:15:37", discountPercent: "38", amountPaid: 1147.62 }));
    expect(res.json()).toEqual({ result: "created" });
    const { rows } = await ctx.db.query(`SELECT amount_kop, amount_paid_kop, created_at FROM orders`);
    expect(Number(rows[0].amount_kop)).toBe(185100);
    expect(Number(rows[0].amount_paid_kop)).toBe(114762);
    expect(rows[0].created_at.toISOString()).toBe("2026-03-29T22:15:37.000Z");
  });

  it("новая версия обновляет оплаченную сумму (коррекция скидки)", async () => {
    const o = apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, discountPercent: 33, amountPaid: 670, updatedAt: "2026-02-10T14:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(67000);
  });
});
