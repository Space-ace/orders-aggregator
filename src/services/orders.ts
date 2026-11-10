import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository } from "../repositories/orders.js";
import { parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/**
 * Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем).
 * discountPercent не читаем: net берём из amountPaid, а discount = gross − net.
 */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  /** Появилось в API недавно; у заказов в старом формате поля нет. */
  amountPaid: z.union([z.number(), z.string()]).nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = "created" | "updated" | "stale";

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        // Старый формат, без скидок: оплачена вся сумма
        amountPaidKop: o.amountPaid == null ? amountKop : toKop(parseRub(o.amountPaid)),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt).
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    const incoming = this.normalize(raw);
    const current = await this.orders.get(incoming.id);
    if (current && current.updatedAt.getTime() >= incoming.updatedAt.getTime()) return "stale";
    await this.orders.save(incoming);
    return current ? "updated" : "created";
  }
}
