import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  amountKop: number;
  /** Фактически оплачено, со скидкой. */
  amountPaidKop: number;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

/** Итог сохранения версии заказа. */
export type SaveResult = "created" | "updated" | "stale";

interface Row {
  id: string;
  customer_id: string;
  amount_kop: string;
  /** NULL — заказ сохранён до миграции 002, оплаченная сумма ещё не загружена. */
  amount_paid_kop: string | null;
  status: Order["status"];
  created_at: Date;
  updated_at: Date;
}

const fromRow = (r: Row): Order => ({
  id: r.id,
  customerId: r.customer_id,
  amountKop: Number(r.amount_kop),
  // Пока оплаченная сумма не загружена, считаем заказ оплаченным полностью — как до появления скидок
  amountPaidKop: Number(r.amount_paid_kop ?? r.amount_kop),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  /**
   * Сохраняет версии заказов одним запросом, каждую — только если она новее сохранённой (по updated_at).
   * Для каждой строки сравнение и запись атомарны: параллельные доставки разных версий одного заказа
   * не перезаписывают новую версию старой. Итоги — по одному на каждую версию, в порядке входа.
   * Исключение — заказы, у которых оплаченная сумма ещё не загружена (сохранены до миграции 002): их дозаполняет
   * и та же версия, иначе синк после обновления пропустил бы их как устаревшие. Более старая версия — нет.
   */
  async saveIfNewer(orders: Order[]): Promise<SaveResult[]> {
    if (orders.length === 0) return [];
    // Один INSERT … ON CONFLICT не может обновить строку дважды, поэтому из повторов одного заказа
    // пишем только самую свежую версию (при равном updatedAt — первую), остальные — stale
    const newest = new Map<string, number>();
    orders.forEach((o, i) => {
      const kept = newest.get(o.id);
      if (kept === undefined || orders[kept].updatedAt.getTime() < o.updatedAt.getTime()) newest.set(o.id, i);
    });
    const batch = [...newest.values()].map((i) => orders[i]);
    const { rows } = await this.db.query<{ id: string; inserted: boolean }>(
      `INSERT INTO orders (id, customer_id, amount_kop, amount_paid_kop, status, created_at, updated_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::bigint[], $4::bigint[], $5::text[], $6::timestamptz[], $7::timestamptz[])
       ON CONFLICT (id) DO UPDATE SET
         customer_id     = excluded.customer_id,
         amount_kop      = excluded.amount_kop,
         amount_paid_kop = excluded.amount_paid_kop,
         status          = excluded.status,
         created_at      = excluded.created_at,
         updated_at      = excluded.updated_at
       WHERE orders.updated_at < excluded.updated_at
          OR (orders.updated_at = excluded.updated_at AND orders.amount_paid_kop IS NULL)
       RETURNING id, (xmax = 0) AS inserted`,
      [
        batch.map((o) => o.id),
        batch.map((o) => o.customerId),
        batch.map((o) => o.amountKop),
        batch.map((o) => o.amountPaidKop),
        batch.map((o) => o.status),
        batch.map((o) => o.createdAt),
        batch.map((o) => o.updatedAt),
      ],
    );
    const saved = new Map(rows.map((r): [string, SaveResult] => [r.id, r.inserted ? "created" : "updated"]));
    return orders.map((o, i) => (newest.get(o.id) === i ? (saved.get(o.id) ?? "stale") : "stale"));
  }

  /** Оплаченные заказы клиента, созданные в [from, to). */
  async paidCreatedBetween(customerId: string, from: Date, to: Date): Promise<Order[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [customerId, from, to],
    );
    return rows.map(fromRow);
  }
}
