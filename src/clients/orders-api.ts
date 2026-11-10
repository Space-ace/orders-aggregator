import { UpstreamError } from "../errors.js";

export interface OrdersPage {
  items: unknown[];
  nextCursor: string | null;
}

export interface Customer {
  id: string;
  timezone: string;
}

/** То, что сервису нужно от внешнего API. В тестах подменяется фейком. */
export interface OrdersApi {
  getOrdersPage(cursor: string | null, limit: number): Promise<OrdersPage>;
  getCustomer(id: string): Promise<Customer | null>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * HTTP-клиент внешнего API заказов.
 *
 * Особенности API (поддерживается другой командой, документация отстаёт):
 * - лимит 5 rps; при превышении — 429, иногда без Retry-After;
 * - иногда превышение приходит как 200 с телом { "error": "rate_limited" }.
 * Все запросы идут последовательно через общий интервал, ретраи — с экспоненциальной паузой.
 */
export class HttpOrdersApi implements OrdersApi {
  private nextSlot = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly opts: { rps?: number; maxAttempts?: number } = {},
  ) {}

  async getOrdersPage(cursor: string | null, limit: number): Promise<OrdersPage> {
    const url = new URL("/orders", this.baseUrl);
    url.searchParams.set("limit", String(limit));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const body = (await this.request(url)) as Partial<OrdersPage> | null;
    if (!body || !Array.isArray(body.items)) {
      throw new UpstreamError(`unexpected /orders response: ${JSON.stringify(body).slice(0, 200)}`);
    }
    return { items: body.items, nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null };
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const body = (await this.request(new URL(`/customers/${encodeURIComponent(id)}`, this.baseUrl))) as Partial<Customer> | null;
    if (body === null) return null;
    if (typeof body.timezone !== "string") throw new UpstreamError(`unexpected /customers response: ${JSON.stringify(body)}`);
    return { id, timezone: body.timezone };
  }

  private async throttle(): Promise<void> {
    const interval = 1000 / (this.opts.rps ?? 4);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + interval;
    if (slot > now) await sleep(slot - now);
  }

  /** null — 404. */
  private async request(url: URL): Promise<unknown> {
    const maxAttempts = this.opts.maxAttempts ?? 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.throttle();
      const backoff = Math.min(500 * 2 ** (attempt - 1), 8000);
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      } catch {
        await sleep(backoff);
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        this.nextSlot = Date.now() + (retryAfter > 0 ? retryAfter * 1000 : 1000);
        continue;
      }
      if (res.status >= 500) {
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new UpstreamError(`${url.pathname}: HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      if (body && typeof body === "object" && "error" in body) {
        // 200 с ошибкой в теле — на практике это тот же rate limit
        this.nextSlot = Date.now() + 1000;
        continue;
      }
      return body;
    }
    throw new UpstreamError(`${url.pathname}: no successful response after ${maxAttempts} attempts`);
  }
}
