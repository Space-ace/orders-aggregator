import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../container.js";
import { ValidationError } from "../errors.js";
import { isCalendarDate } from "../utils/time.js";

const Query = z.object({ from: z.string(), to: z.string() });

export function customerRoutes(app: FastifyInstance, c: Container) {
  app.get<{ Params: { id: string } }>("/customers/:id/daily-totals", async (req) => {
    const q = Query.safeParse(req.query);
    if (!q.success || !isCalendarDate(q.data.from) || !isCalendarDate(q.data.to)) {
      throw new ValidationError("from and to must be dates in YYYY-MM-DD format");
    }
    if (q.data.from > q.data.to) throw new ValidationError("from must be <= to");
    return c.totals.daily(req.params.id, q.data.from, q.data.to);
  });
}
