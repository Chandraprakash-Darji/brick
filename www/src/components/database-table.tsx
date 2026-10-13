import { asMarkdown } from "fumadocs-core/server";

import {
  databaseTableMarkdown,
  tableAnchor,
  type DatabaseTableProps,
} from "../lib/database-schema";

export type { DatabaseField, DatabaseTableProps } from "../lib/database-schema";

const badgeClass =
  "inline-block rounded border border-fd-border bg-fd-muted px-1.5 py-0.5 text-xs font-medium text-fd-muted-foreground";

export function DatabaseTable({ name, fields }: DatabaseTableProps) {
  if (asMarkdown()) return databaseTableMarkdown({ name, fields });

  return (
    <div id={tableAnchor(name)} className="my-6 scroll-mt-24">
      <p className="mb-2 text-sm font-medium">
        Table Name: <code>{name}</code>
      </p>
      <div
        role="region"
        aria-label={`${name} database schema`}
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-fd-border"
      >
        <table className="my-0! w-full min-w-[32rem] text-sm">
          <thead className="bg-fd-muted">
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.name}>
                <th scope="row" className="text-left font-normal">
                  <code>{field.name}</code>
                </th>
                <td>
                  <code>{field.type}</code>
                </td>
                <td>
                  {field.description}
                  {field.isPrimaryKey && (
                    <>
                      {" "}
                      <span className={badgeClass}>PK</span>
                    </>
                  )}
                  {field.isUnique && (
                    <>
                      {" "}
                      <span className={badgeClass}>Unique</span>
                    </>
                  )}
                  {(field.isForeignKey || field.references) && (
                    <>
                      {" "}
                      {field.references ? (
                        <a
                          className={badgeClass}
                          href={`#${tableAnchor(field.references.table)}`}
                        >
                          FK: {field.references.table}.{field.references.field}
                        </a>
                      ) : (
                        <span className={badgeClass}>FK</span>
                      )}
                    </>
                  )}
                  {field.isOptional && (
                    <>
                      {" "}
                      <span className={badgeClass}>Optional</span>
                    </>
                  )}
                  {field.defaultValue !== undefined && (
                    <>
                      {" "}
                      <span className={badgeClass}>
                        Default: {String(field.defaultValue)}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
