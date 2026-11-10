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
    req.log.error(err);
    return reply.code(500).send({ error: "internal", message: "Internal error" });
  });

  app.get("/health", async () => ({ status: "ok" }));
  syncRoutes(app, c);
  webhookRoutes(app, c);
  customerRoutes(app, c);
  return app;
}
