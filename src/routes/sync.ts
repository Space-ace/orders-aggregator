import type { FastifyInstance } from "fastify";
import type { Container } from "../container.js";

export function syncRoutes(app: FastifyInstance, c: Container) {
  // Синхронный: отвечает, когда забраны все страницы
  app.post("/sync", async () => c.sync.run());
}
