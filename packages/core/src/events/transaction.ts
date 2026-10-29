import { AsyncLocalStorage } from "node:async_hooks";

const sqliteQueues = new WeakMap<object, Promise<unknown>>();

interface OpenTransaction {
  /** The handles a nested call can pass to join this transaction. */
  handles: Set<unknown>;
  commits: (() => unknown)[];
  open: boolean;
  savepoints: number;
}
const active = new AsyncLocalStorage<OpenTransaction>();

function joined(db: unknown): OpenTransaction | undefined {
  const open = active.getStore();
  return open?.open && open.handles.has(db) ? open : undefined;
}

export function isSqliteDatabase(db: any): boolean {
  return (
    typeof db?.$client?.prepare === "function" &&
    typeof db?.$client?.run === "function"
  );
}

function rollbackQuietly(db: any, statement = "ROLLBACK"): void {
  try {
    db.$client.run(statement);
  } catch {
    return;
  }
}

async function nested<T>(
  db: any,
  open: OpenTransaction,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  const commits = open.commits.length;
  try {
    if (!isSqliteDatabase(db))
      // Drizzle runs a nested transaction as a savepoint.
      return await db.transaction((tx: any) => {
        open.handles.add(tx);
        return fn(tx);
      });
    const name = `brick_${++open.savepoints}`;
    db.$client.run(`SAVEPOINT ${name}`);
    try {
      const result = await fn(db);
      db.$client.run(`RELEASE ${name}`);
      return result;
    } catch (error) {
      rollbackQuietly(db, `ROLLBACK TO ${name}`);
      rollbackQuietly(db, `RELEASE ${name}`);
      throw error;
    }
  } catch (error) {
    // Work that was rolled back must not run its commit callbacks.
    open.commits.length = commits;
    throw error;
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
 * A call made inside `fn` with the `tx` it was given (on SQLite, the database
 * itself) joins the open transaction as a savepoint instead of waiting for it: a
 * nested failure undoes only the nested work, and the outer transaction decides
 * the commit. Nested calls must run one at a time.
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
  const outer = joined(db);
  if (outer) return nested(db, outer, fn);
  const open: OpenTransaction = {
    handles: new Set(),
    commits: [],
    open: true,
    savepoints: 0,
  };
  let result: T;
  try {
    result = await active.run(open, () => begin(db, open, fn));
  } finally {
    open.open = false;
  }
  for (const commit of open.commits) await commit();
  return result;
}

async function begin<T>(
  db: any,
  open: OpenTransaction,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  if (!isSqliteDatabase(db)) {
    return db.transaction((tx: any) => {
      open.handles.add(tx);
      return fn(tx);
    });
  }

  open.handles.add(db);
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

/** Whether `db` belongs to a transaction opened by `runInTransaction` that is still open. */
export function inTransaction(db: unknown): boolean {
  return joined(db) !== undefined;
}

/**
 * Run `fn` once the transaction that `db` belongs to has committed, or now when
 * `db` is not in one opened by `runInTransaction`. It never runs when that
 * transaction, or the savepoint it was queued in, rolls back. An error it throws
 * reaches the caller of the outermost `runInTransaction`, after the commit.
 *
 * @param db - The handle the work ran on: a `tx`, or a database.
 * @param fn - The side effect, such as clearing a cache.
 */
export async function onTransactionCommit(
  db: unknown,
  fn: () => unknown,
): Promise<void> {
  const open = joined(db);
  if (open) open.commits.push(fn);
  else await fn();
}
