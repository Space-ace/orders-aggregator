import { config } from "./config.js";
import { createDb, migrate } from "./db.js";

const db = createDb(config.databaseUrl);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "nothing to apply");
await db.end();
