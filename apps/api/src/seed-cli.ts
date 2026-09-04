import { loadDb, resetDb } from "./store.js";
import { seedAll } from "./seed.js";

loadDb();
resetDb();
await seedAll(true);
console.log("Seed complete.");
