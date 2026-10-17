import { migrate } from "../src/db/migrate.js";
import { testDatabaseUrl } from "./test-database.js";

export default async function migrateTestDatabase(): Promise<void> {
  await migrate(testDatabaseUrl());
}
