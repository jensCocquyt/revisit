import { fileURLToPath } from "node:url";
import pg from "pg";
import Postgrator from "postgrator";

export async function migrate(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const postgrator = new Postgrator({
      migrationPattern: `${migrationsDirectory.replaceAll("\\", "/")}/*.sql`,
      driver: "pg",
      database: client.database ?? "",
      execQuery: (query) => client.query(query),
    });
    await postgrator.migrate();
  } finally {
    await client.end();
  }
}

const migrationsDirectory = fileURLToPath(new URL("../../migrations", import.meta.url));
