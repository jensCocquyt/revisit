import type pg from "pg";
import { withTransaction } from "./connection.js";

export type Account = { issuer: string; subject: string; email: string };

// The user's first sign-in also claims the items saved before sign-in existed.
export async function signInUser(pool: pg.Pool, account: Account): Promise<string> {
  return withTransaction(pool, async (client) => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (issuer, subject, email) VALUES ($1, $2, $3)
       ON CONFLICT (issuer, subject) DO NOTHING
       RETURNING id`,
      [account.issuer, account.subject, account.email],
    );
    const newId = created.rows[0]?.id;
    if (newId) {
      await client.query("UPDATE items SET user_id = $1 WHERE user_id IS NULL", [newId]);
      return newId;
    }
    const existing = await client.query<{ id: string }>(
      `UPDATE users SET email = $3 WHERE issuer = $1 AND subject = $2 RETURNING id`,
      [account.issuer, account.subject, account.email],
    );
    const id = existing.rows[0]?.id;
    if (!id) throw new Error("a user vanished while signing in");
    return id;
  });
}
