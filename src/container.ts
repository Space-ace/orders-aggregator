import type { OrdersApi } from "./clients/orders-api.js";
import type { Db } from "./db.js";
import { CustomersRepository } from "./repositories/customers.js";
import { OrdersRepository } from "./repositories/orders.js";
import { SyncRunsRepository } from "./repositories/sync-runs.js";
import { CustomersService } from "./services/customers.js";
import { OrdersService } from "./services/orders.js";
import { SyncService } from "./services/sync.js";
import { TotalsService } from "./services/totals.js";

export interface Container {
  db: Db;
  orders: OrdersService;
  sync: SyncService;
  customers: CustomersService;
  totals: TotalsService;
}

export function createContainer(db: Db, api: OrdersApi): Container {
  const ordersRepo = new OrdersRepository(db);
  const orders = new OrdersService(ordersRepo);
  const customers = new CustomersService(api, new CustomersRepository(db));
  return {
    db,
    orders,
    sync: new SyncService(api, orders, new SyncRunsRepository(db)),
    customers,
    totals: new TotalsService(ordersRepo, customers),
  };
}
