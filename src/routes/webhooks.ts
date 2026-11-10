import type { FastifyInstance } from "fastify";
import type { Container } from "../container.js";

export function webhookRoutes(app: FastifyInstance, c: Container) {
  // Повтор или устаревшая версия — 200 без изменений, иначе отправитель будет ретраить
  app.post("/webhooks/order", async (req) => ({ result: await c.orders.apply(req.body) }));
}
