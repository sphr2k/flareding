import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations/migrations.js";
import { bookmarks } from "../db/schema.js";
import type { Env } from "../env.js";

/**
 * Native RPC boundary. The Worker does not get raw SQLite access.
 * One DO per logical account; 'default' is the initial single-user account.
 */
export class BookmarkDO extends DurableObject<Env> {
  private readonly db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.db, migrations);
    });
  }

  async health(): Promise<boolean> {
    await this.db.select({ id: bookmarks.id }).from(bookmarks).limit(1);
    return true;
  }
}
