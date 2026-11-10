import type { Db } from "../db.js";

export class CustomersRepository {
  constructor(private readonly db: Db) {}

  async getTimezone(id: string): Promise<string | null> {
    const { rows } = await this.db.query<{ timezone: string }>(`SELECT timezone FROM customers WHERE id = $1`, [id]);
    return rows[0]?.timezone ?? null;
  }

  async saveTimezone(id: string, timezone: string): Promise<void> {
    await this.db.query(
      `INSERT INTO customers (id, timezone) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET timezone = excluded.timezone, fetched_at = now()`,
      [id, timezone],
    );
  }
}
