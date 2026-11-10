import { buildApp } from "./app.js";
import { HttpOrdersApi } from "./clients/orders-api.js";
import { config } from "./config.js";
import { createContainer } from "./container.js";
import { createDb, migrate } from "./db.js";

const db = createDb(config.databaseUrl);
await migrate(db);
const app = buildApp(createContainer(db, new HttpOrdersApi(config.ordersApiUrl)), { logger: true });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
