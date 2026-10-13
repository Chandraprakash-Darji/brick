import { z } from "zod";
import { markdownTable } from "fumadocs-core/mdx-plugins/stringifier";

export const databaseFieldsSchema = z.array(
  z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    isPrimaryKey: z.boolean().optional(),
    isUnique: z.boolean().optional(),
    isOptional: z.boolean().optional(),
    isForeignKey: z.boolean().optional(),
    references: z.object({ table: z.string(), field: z.string() }).optional(),
    defaultValue: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional(),
  }),
);

export type DatabaseField = z.infer<typeof databaseFieldsSchema>[number];
export interface DatabaseTableProps {
  name: string;
  fields: readonly DatabaseField[];
}

export function tableAnchor(name: string) {
  return `database-table-${encodeURIComponent(name)}`;
}

function markdownAnchor(name: string) {
  return `table-name-${name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-")}`;
}

export function databaseTableMarkdown({ name, fields }: DatabaseTableProps) {
  return `#### Table Name: \`${name}\`\n\n${markdownTable([
    ["Field", "Type", "Description"],
    ...fields.map((field) => {
      const constraints: string[] = [];
      if (field.isPrimaryKey) constraints.push("PK");
      if (field.isUnique) constraints.push("Unique");
      if (field.references) {
        constraints.push(
          `[FK: ${field.references.table}.${field.references.field}](#${markdownAnchor(field.references.table)})`,
        );
      } else if (field.isForeignKey) constraints.push("FK");
      if (field.isOptional) constraints.push("Optional");
      if (field.defaultValue !== undefined)
        constraints.push(`Default: ${String(field.defaultValue)}`);
      return [
        `\`${field.name}\``,
        `\`${field.type}\``,
        [field.description, ...constraints].join(" "),
      ];
    }),
  ])}\n`;
}
