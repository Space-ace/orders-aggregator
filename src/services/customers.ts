import type { OrdersApi } from "../clients/orders-api.js";
import { NotFoundError, UpstreamError } from "../errors.js";
import type { CustomersRepository } from "../repositories/customers.js";

export class CustomersService {
  constructor(
    private readonly api: OrdersApi,
    private readonly customers: CustomersRepository,
  ) {}

  /** IANA-таймзона клиента. Берётся из внешнего API при первом обращении и хранится в БД. */
  async timezone(customerId: string): Promise<string> {
    const cached = await this.customers.getTimezone(customerId);
    if (cached) return cached;
    const customer = await this.api.getCustomer(customerId);
    if (!customer) throw new NotFoundError(`customer ${customerId} not found`);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: customer.timezone });
    } catch {
      throw new UpstreamError(`invalid timezone for ${customerId}: ${customer.timezone}`);
    }
    await this.customers.saveTimezone(customerId, customer.timezone);
    return customer.timezone;
  }
}
