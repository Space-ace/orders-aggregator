import { STATUS_CODES } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import type { Container } from "./container.js";
import { AppError } from "./errors.js";
import { customerRoutes } from "./routes/customers.js";
import { syncRoutes } from "./routes/sync.js";
import { webhookRoutes } from "./routes/webhooks.js";

export function buildApp(c: Container, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    // Ошибки самого запроса, которые Fastify находит до обработчика: битый JSON, чужой Content-Type,
    // слишком большое тело. Отдаём их код 4xx, а не 500: на 5xx отправитель вебхуков повторяет запрос.
    // Код ошибки — в стиле AppError: «Unsupported Media Type» → unsupported_media_type
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      const code = (STATUS_CODES[err.statusCode] ?? "client error").toLowerCase().replace(/\W+/g, "_");
      return reply.code(err.statusCode).send({ error: code, message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Internal error" });
  });

  app.get("/health", async () => ({ status: "ok" }));
  syncRoutes(app, c);
  webhookRoutes(app, c);
  customerRoutes(app, c);
  return app;
}
