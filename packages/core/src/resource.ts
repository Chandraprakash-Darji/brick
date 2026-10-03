import type { TSchema } from "@sinclair/typebox";
import { getTableColumns, eq, and } from "drizzle-orm";
import { t } from "./typebox";
import { defineAction } from "./action";
import type {
  Action,
  Resource,
  ResourceConfig,
  Service,
  ActionContext,
} from "./types";

function getColumn(table: any, fieldName: string) {
  if (table[fieldName]) return table[fieldName];
  const cols = getTableColumns(table);
  if (cols[fieldName]) return cols[fieldName];
  for (const [k, col] of Object.entries(cols)) {
    if ((col as any).name === fieldName) return col;
  }
  return undefined;
}

function columnToTypeBox(col: any, customSchema?: TSchema): TSchema {
  if (customSchema) return customSchema;

  const dataType = col.dataType;
  const columnType = col.columnType;

  if (dataType === "boolean" || columnType === "SQLiteBoolean") {
    return t.Boolean();
  }

  if (
    dataType === "number" ||
    columnType === "SQLiteInteger" ||
    columnType === "SQLiteReal"
  ) {
    return t.Number();
  }

  if (dataType === "string" || columnType === "SQLiteText") {
    if (col.enumValues && col.enumValues.length > 0) {
      return t.Union(col.enumValues.map((val: string) => t.Literal(val)));
    }
    if (col.name === "slug") {
      return t.String({
        minLength: 2,
        maxLength: 100,
        pattern: "^[a-z0-9-]+$",
        description: "URL-friendly unique slug (lowercase letters, numbers, dashes)",
      });
    }
    return t.String();
  }

  return t.Any();
}

export function defineResource<
  TTable = any,
  TCtx extends ActionContext = ActionContext
>(
  service: Service<any, any>,
  config: ResourceConfig<TTable, TCtx>
): Resource<TTable, TCtx> {
  const resourceName = config.name;
  const capitalizedName = resourceName.charAt(0).toUpperCase() + resourceName.slice(1);
  const pluralName = config.pluralName ?? `${resourceName}s`;
  const idField = config.idField ?? "id";
  const ownerField = config.ownerField;
  const table = config.table;
  const columns = getTableColumns(table as any);
  const fieldsOverride = config.fields ?? {};

  // Register table on service
  service.registerTable(table);

  // Derive TypeBox Schemas
  // 1. Row Schema (Full table row)
  const rowProperties: Record<string, TSchema> = {};
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const baseType = columnToTypeBox(col, fieldsOverride[key] ?? fieldsOverride[col.name]);
    if (col.notNull) {
      rowProperties[key] = baseType;
    } else {
      rowProperties[key] = t.Optional(t.Union([baseType, t.Null()]));
    }
  }
  const rowSchema = t.Object(rowProperties);

  // 2. Create Input Schema
  // Excludes auto-generated fields: primary key (id), ownerField, createdAt, updatedAt
  const createProperties: Record<string, TSchema> = {};
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    const isId = col.primary || key === idField || colName === idField;
    const isOwner = ownerField && (key === ownerField || colName === ownerField);
    const isTimestamp =
      key === "createdAt" ||
      key === "updatedAt" ||
      colName === "created_at" ||
      colName === "updated_at";

    if (isId || isOwner || isTimestamp) {
      continue;
    }

    const baseType = columnToTypeBox(col, fieldsOverride[key] ?? fieldsOverride[colName]);
    if (col.hasDefault || !col.notNull) {
      createProperties[key] = t.Optional(baseType);
    } else {
      createProperties[key] = baseType;
    }
  }
  const createSchema = t.Object(createProperties);

  // 3. Update Input Schema
  // Requires ID; all other editable fields optional
  const updateProperties: Record<string, TSchema> = {
    [idField]: t.String(),
  };
  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    const isId = col.primary || key === idField || colName === idField;
    const isOwner = ownerField && (key === ownerField || colName === ownerField);
    const isTimestamp =
      key === "createdAt" ||
      key === "updatedAt" ||
      colName === "created_at" ||
      colName === "updated_at";

    if (isId || isOwner || isTimestamp) {
      continue;
    }

    const baseType = columnToTypeBox(col, fieldsOverride[key] ?? fieldsOverride[colName]);
    updateProperties[key] = t.Optional(baseType);
  }
  const updateSchema = t.Object(updateProperties);

  // 4. Get Input Schema
  const getSchema = t.Object({
    [idField]: t.String(),
  });

  // 5. Delete Input Schema
  const deleteSchema = t.Object({
    [idField]: t.String(),
  });

  // 6. List Query Schema
  const operations = config.operations ?? {};
  const maxLimit =
    typeof operations.list === "object" && operations.list.maxLimit
      ? operations.list.maxLimit
      : 100;
  const listProperties: Record<string, TSchema> = {
    limit: t.Optional(t.Number({ minimum: 1, maximum: maxLimit })),
    offset: t.Optional(t.Number({ minimum: 0 })),
  };

  for (const [key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    const isTimestamp =
      key === "createdAt" ||
      key === "updatedAt" ||
      colName === "created_at" ||
      colName === "updated_at";
    if (isTimestamp) continue;

    const baseType = columnToTypeBox(col, fieldsOverride[key] ?? fieldsOverride[colName]);
    listProperties[key] = t.Optional(baseType);
  }
  const listSchema = t.Object(listProperties);

  // Action Implementations
  // 1. Create Action
  const createAction = defineAction({
    name: `${resourceName}.create`,
    description: `Create a new ${resourceName}`,
    input: createSchema,
    output: rowSchema,
    errors: {
      CONFLICT: { status: 409, message: "Resource already exists" },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const data: Record<string, any> = { ...input };

      // Auto-generate primary key if not provided
      if (!data[idField]) {
        if (config.idGenerator) {
          data[idField] = config.idGenerator();
        } else {
          const prefix =
            config.idPrefix ?? (resourceName.toLowerCase() === "page" ? "pg" : resourceName.slice(0, 3));
          const rand = Math.random().toString(36).substring(2, 10);
          data[idField] = `${prefix}_${rand}`;
        }
      }

      // Populate column defaults if not provided
      for (const [key, col] of Object.entries(columns) as [string, any][]) {
        if (data[key] === undefined && col.hasDefault && col.default !== undefined) {
          data[key] = col.default;
        }
      }

      // Auto-generate timestamps
      const now = new Date().toISOString();
      for (const [key, col] of Object.entries(columns) as [string, any][]) {
        const colName = col.name;
        if (colName === "created_at" || key === "createdAt") {
          if (data[key] === undefined) data[key] = now;
        }
        if (colName === "updated_at" || key === "updatedAt") {
          if (data[key] === undefined) data[key] = now;
        }
      }

      // Ownership injection: inject ctx.user.id
      if (ownerField) {
        if (ctx.user?.id) {
          data[ownerField] = ctx.user.id;
        } else if (data[ownerField] === undefined) {
          data[ownerField] = null;
        }
      }

      // Hook: beforeCreate
      if (config.hooks?.beforeCreate) {
        await config.hooks.beforeCreate({ data, ctx: ctx as TCtx, error: error as any });
      }

      // Insert into database
      await db.insert(table).values(data);

      const idVal = data[idField];
      const idCol = getColumn(table, idField);
      let createdRow: any = data;
      if (idCol) {
        const [row] = await db.select().from(table).where(eq(idCol, idVal));
        if (row) createdRow = row;
      }

      if (ctx.logger?.info) {
        const titleOrName = createdRow.title ?? createdRow.name ?? createdRow.slug ?? idVal;
        ctx.logger.info(`${capitalizedName} created: '${titleOrName}' (slug: /${createdRow.slug ?? idVal})`);
      }

      // Hook: afterCreate
      if (config.hooks?.afterCreate) {
        await config.hooks.afterCreate({ data, result: createdRow, ctx: ctx as TCtx });
      }

      return createdRow;
    },
  });

  // 2. Get Action
  const getAction = defineAction({
    name: `${resourceName}.get`,
    description: `Retrieve a ${resourceName} by ID`,
    input: getSchema,
    output: rowSchema,
    errors: {
      NOT_FOUND: { status: 404, message: `${capitalizedName} not found` },
      FORBIDDEN: { status: 403, message: `Access denied to ${resourceName}` },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const idVal = input[idField] ?? input.id;
      const idCol = getColumn(table, idField);

      if (!idCol) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' does not exist`);
      }

      const [row] = await db.select().from(table).where(eq(idCol, idVal));
      if (!row) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' does not exist`);
      }

      // Ownership verification
      if (ownerField && ctx.user?.id) {
        const ownerColName = getColumn(table, ownerField)?.name ?? ownerField;
        const rowOwner = row[ownerField] ?? row[ownerColName];
        if (rowOwner && rowOwner !== ctx.user.id) {
          error.FORBIDDEN(`Access denied to ${resourceName}`);
        }
      }

      return row;
    },
  });

  // 3. List Action
  const listAction = defineAction({
    name: `${resourceName}.list`,
    description: `List ${pluralName}`,
    input: listSchema,
    output: t.Object({
      [pluralName]: t.Array(rowSchema),
      items: t.Optional(t.Array(rowSchema)),
      total: t.Number(),
      limit: t.Optional(t.Number()),
      offset: t.Optional(t.Number()),
    }),
    errors: config.errors,
    execute: async ({ input = {}, ctx }) => {
      const db = ctx.db ?? service.getDb();
      const defaultLimit =
        typeof operations.list === "object" && operations.list.defaultLimit
          ? operations.list.defaultLimit
          : 50;
      const maxLimitVal =
        typeof operations.list === "object" && operations.list.maxLimit
          ? operations.list.maxLimit
          : 100;

      const rawLimit = (input as any).limit;
      const rawOffset = (input as any).offset;
      const limit = rawLimit !== undefined && rawLimit !== null ? Math.min(Number(rawLimit), maxLimitVal) : defaultLimit;
      const offset = rawOffset !== undefined && rawOffset !== null ? Number(rawOffset) : 0;

      const conditions: any[] = [];

      // Ownership scoping: WHERE ownerField = ctx.user.id
      if (ownerField && ctx.user?.id) {
        const ownerCol = getColumn(table, ownerField);
        if (ownerCol) {
          conditions.push(eq(ownerCol, ctx.user.id));
        }
      }

      // Filter query parameters
      for (const [key, val] of Object.entries(input)) {
        if (key === "limit" || key === "offset") continue;
        if (val !== undefined) {
          const col = getColumn(table, key);
          if (col) {
            conditions.push(eq(col, val));
          }
        }
      }

      let query = db.select().from(table);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const all = await query;
      const sliced = all.slice(offset, offset + limit);

      return {
        [pluralName]: sliced,
        items: sliced,
        total: all.length,
        limit,
        offset,
      };
    },
  });

  // 4. Update Action
  const updateAction = defineAction({
    name: `${resourceName}.update`,
    description: `Update a ${resourceName} by ID`,
    input: updateSchema,
    output: rowSchema,
    errors: {
      NOT_FOUND: { status: 404, message: `${capitalizedName} not found` },
      FORBIDDEN: { status: 403, message: `Access denied to update ${resourceName}` },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const idVal = input[idField] ?? input.id;
      const idCol = getColumn(table, idField);

      if (!idCol) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      const [existing] = await db.select().from(table).where(eq(idCol, idVal));
      if (!existing) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      // Ownership verification
      if (ownerField && ctx.user?.id) {
        const ownerColName = getColumn(table, ownerField)?.name ?? ownerField;
        const rowOwner = existing[ownerField] ?? existing[ownerColName];
        if (rowOwner && rowOwner !== ctx.user.id) {
          error.FORBIDDEN(`Access denied to update ${resourceName}`);
        }
      }

      const { id: _ignoreId, [idField]: _ignoreIdField, ...updateData } = input;

      // Update timestamp
      const now = new Date().toISOString();
      for (const [key, col] of Object.entries(columns) as [string, any][]) {
        const colName = col.name;
        if (colName === "updated_at" || key === "updatedAt") {
          updateData[key] = now;
        }
      }

      // Hook: beforeUpdate
      if (config.hooks?.beforeUpdate) {
        await config.hooks.beforeUpdate({
          id: idVal as string | number,
          data: updateData,
          existing,
          ctx: ctx as TCtx,
          error: error as any,
        });
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(table).set(updateData).where(eq(idCol, idVal));
      }

      const [updated] = await db.select().from(table).where(eq(idCol, idVal));

      // Hook: afterUpdate
      if (config.hooks?.afterUpdate) {
        await config.hooks.afterUpdate({
          id: idVal as string | number,
          data: updateData,
          result: updated ?? existing,
          ctx: ctx as TCtx,
        });
      }

      return updated ?? existing;
    },
  });

  // 5. Delete Action
  const deleteAction = defineAction({
    name: `${resourceName}.delete`,
    description: `Delete a ${resourceName} by ID`,
    input: deleteSchema,
    output: t.Object({
      success: t.Boolean(),
      id: t.Union([t.String(), t.Number()]),
    }),
    errors: {
      NOT_FOUND: { status: 404, message: `${capitalizedName} not found` },
      FORBIDDEN: { status: 403, message: `Access denied to delete ${resourceName}` },
      ...config.errors,
    },
    execute: async ({ input, ctx, error }) => {
      const db = ctx.db ?? service.getDb();
      const idVal = input[idField] ?? input.id;
      const idCol = getColumn(table, idField);

      if (!idCol) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      const [existing] = await db.select().from(table).where(eq(idCol, idVal));
      if (!existing) {
        error.NOT_FOUND(`${capitalizedName} with ID '${idVal}' not found`);
      }

      // Ownership verification
      if (ownerField && ctx.user?.id) {
        const ownerColName = getColumn(table, ownerField)?.name ?? ownerField;
        const rowOwner = existing[ownerField] ?? existing[ownerColName];
        if (rowOwner && rowOwner !== ctx.user.id) {
          error.FORBIDDEN(`Access denied to delete ${resourceName}`);
        }
      }

      // Hook: beforeDelete
      if (config.hooks?.beforeDelete) {
        await config.hooks.beforeDelete({
          id: idVal as string | number,
          existing,
          ctx: ctx as TCtx,
          error: error as any,
        });
      }

      await db.delete(table).where(eq(idCol, idVal));

      // Hook: afterDelete
      if (config.hooks?.afterDelete) {
        await config.hooks.afterDelete({
          id: idVal as string | number,
          existing,
          ctx: ctx as TCtx,
        });
      }

      return { success: true, id: idVal as string | number };
    },
  });

  // Attach actions to service
  if (operations.create !== false) {
    service.action(createAction);
    service.actions.set(`create${capitalizedName}`, createAction);
  }
  if (operations.get !== false) {
    service.action(getAction);
    service.actions.set(`get${capitalizedName}`, getAction);
  }
  if (operations.list !== false) {
    service.action(listAction);
    service.actions.set(`list${pluralName.charAt(0).toUpperCase() + pluralName.slice(1)}`, listAction);
  }
  if (operations.update !== false) {
    service.action(updateAction);
    service.actions.set(`update${capitalizedName}`, updateAction);
  }
  if (operations.delete !== false) {
    service.action(deleteAction);
    service.actions.set(`delete${capitalizedName}`, deleteAction);
  }

  const resource: Resource<TTable, TCtx> = {
    name: resourceName,
    serviceName: service.name,
    table,
    ownerField,
    idField,
    pluralName,
    config,
    actions: {
      list: listAction as Action<any, any, any, TCtx>,
      get: getAction as Action<any, any, any, TCtx>,
      create: createAction as Action<any, any, any, TCtx>,
      update: updateAction as Action<any, any, any, TCtx>,
      delete: deleteAction as Action<any, any, any, TCtx>,
    },
    list: listAction as Action<any, any, any, TCtx>,
    get: getAction as Action<any, any, any, TCtx>,
    create: createAction as Action<any, any, any, TCtx>,
    update: updateAction as Action<any, any, any, TCtx>,
    delete: deleteAction as Action<any, any, any, TCtx>,
  };

  return resource;
}
