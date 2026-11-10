import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository, SaveResult } from "../repositories/orders.js";
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

export type ApplyResult = SaveResult;

export interface ApplyStats {
  applied: number;
  stale: number;
  invalid: number;
}

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
   * Применяет версию заказа из вебхука.
   * Вебхуки приходят с повторами, не по порядку и параллельно, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt), — атомарно, одним запросом.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    const [result] = await this.orders.saveIfNewer([this.normalize(raw)]);
    return result;
  }

  /**
   * Применяет пачку версий (страницу синка) одним запросом к базе — с той же проверкой «только если новее».
   * Невалидные заказы пропускает и считает.
   */
  async applyMany(raws: unknown[]): Promise<ApplyStats> {
    const valid: Order[] = [];
    let invalid = 0;
    for (const raw of raws) {
      try {
        valid.push(this.normalize(raw));
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        invalid++;
      }
    }
    const stale = (await this.orders.saveIfNewer(valid)).filter((r) => r === "stale").length;
    return { applied: valid.length - stale, stale, invalid };
  }
}
