import type { OrdersApi } from "../clients/orders-api.js";
import { ValidationError } from "../errors.js";
import type { SyncRunsRepository } from "../repositories/sync-runs.js";
import type { OrdersService } from "./orders.js";

export interface SyncStats {
  pages: number;
  received: number;
  applied: number;
  stale: number;
  invalid: number;
}

const PAGE_SIZE = 100;

export class SyncService {
  private running: Promise<SyncStats> | null = null;

  constructor(
    private readonly api: OrdersApi,
    private readonly orders: OrdersService,
    private readonly runs: SyncRunsRepository,
  ) {}

  /** Полный проход по всем страницам. Параллельный запуск получает тот же промис. */
  run(): Promise<SyncStats> {
    this.running ??= this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(): Promise<SyncStats> {
    const runId = await this.runs.start();
    const stats: SyncStats = { pages: 0, received: 0, applied: 0, stale: 0, invalid: 0 };
    try {
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (;;) {
        const page = await this.api.getOrdersPage(cursor, PAGE_SIZE);
        stats.pages++;
        stats.received += page.items.length;
        for (const raw of page.items) {
          try {
            const r = await this.orders.apply(raw);
            if (r === "stale") stats.stale++;
            else stats.applied++;
          } catch (e) {
            if (!(e instanceof ValidationError)) throw e;
            stats.invalid++;
          }
        }
        // API в конце отдаёт не nextCursor: null, а пустую страницу с тем же курсором
        if (!page.nextCursor || page.items.length === 0 || seen.has(page.nextCursor)) break;
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      await this.runs.finish(runId, stats);
      return stats;
    } catch (e) {
      await this.runs.finish(runId, { ...stats, error: (e as Error).message });
      throw e;
    }
  }
}
