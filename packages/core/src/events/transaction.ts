const sqliteQueues = new WeakMap<object, Promise<unknown>>();

export function isSqliteDatabase(db: any): boolean {
  return (
    typeof db?.$client?.prepare === "function" &&
    typeof db?.$client?.run === "function"
  );
}

function rollbackQuietly(db: any): void {
  try {
    db.$client.run("ROLLBACK");
  } catch {
    return;
  }
}

/**
 * Run `fn` in a database transaction: everything it writes through the `tx` it is
 * given is committed together when it returns, or undone if it throws.
 *
 * Postgres uses a real transaction on one connection. SQLite has one connection
 * and a synchronous driver, which Drizzle's own `transaction` cannot use with an
 * async callback (it would commit before the callback finished). So transactions
 * on one SQLite database take turns, each between `BEGIN IMMEDIATE` and `COMMIT`.
 * A write made elsewhere in the process during that time, outside this helper,
 * would join the transaction; use Postgres where that matters.
 *
 * @param db - A Drizzle database, from `service.getDb()`.
 * @param fn - Receives the transaction handle to run queries on.
 * @returns What `fn` returned.
 * @throws What `fn` threw, after rolling back.
 */
export async function runInTransaction<T>(
  db: any,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  if (!isSqliteDatabase(db)) {
    return db.transaction((tx: any) => fn(tx));
  }

  const previous = sqliteQueues.get(db) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  sqliteQueues.set(
    db,
    previous.then(() => turn),
  );
  await previous;
  try {
    db.$client.run("BEGIN IMMEDIATE");
    try {
      const result = await fn(db);
      db.$client.run("COMMIT");
      return result;
    } catch (error) {
      rollbackQuietly(db);
      throw error;
    }
  } finally {
    release();
  }
}
