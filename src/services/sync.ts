import type { OrdersApi } from "../clients/orders-api.js";
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
        // Страница — один запрос к базе: запрос на каждый заказ делал синк в десятки раз медленнее
        const r = await this.orders.applyMany(page.items);
        stats.applied += r.applied;
        stats.stale += r.stale;
        stats.invalid += r.invalid;
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
