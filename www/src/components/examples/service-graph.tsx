import type { ExampleService } from "@/lib/examples";

const ROW = 34;
const NODE_H = 26;
const GAP = 28;
const COLS = { table: 0, service: 270, item: 530 } as const;
const WIDTH = { table: 200, service: 180, item: 230 } as const;
const TOTAL_W = COLS.item + WIDTH.item;

interface Item {
  label: string;
  detail: string;
  kind: "resource" | "action";
}

function itemsOf(service: ExampleService): Item[] {
  const items: Item[] = service.resources.map((name) => ({
    label: name,
    detail: `${service.actions.filter((a) => a.resource === name).length} actions`,
    kind: "resource",
  }));
  for (const action of service.actions) {
    if (!action.resource) {
      items.push({
        label: action.name,
        detail: action.method ?? "",
        kind: "action",
      });
    }
  }
  return items;
}

const edge = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
};

function Node({
  x,
  y,
  width,
  label,
  detail,
  strong,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  detail?: string;
  strong?: boolean;
}) {
  // Monospace 11px is about 6.6px per character; leave room for the detail.
  const maxChars = Math.floor(
    (width - 20 - (detail ? detail.length * 6.2 + 8 : 0)) / 6.6,
  );
  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        width={width}
        height={NODE_H}
        rx={6}
        className={
          strong ? "fill-card stroke-gopher-ink" : "fill-card stroke-border"
        }
      />
      <text
        x={10}
        y={NODE_H / 2}
        dominantBaseline="central"
        className="fill-foreground font-mono text-[11px]"
      >
        {label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label}
      </text>
      {detail && (
        <text
          x={width - 10}
          y={NODE_H / 2}
          dominantBaseline="central"
          textAnchor="end"
          className="fill-muted-foreground font-mono text-[10px]"
        >
          {detail}
        </text>
      )}
    </g>
  );
}

/**
 * Static SVG of an architecture export: each service sits between its
 * database tables and its resources and standalone actions.
 */
export function ServiceGraph({ services }: { services: ExampleService[] }) {
  const layout = services.map((service) => {
    const items = itemsOf(service);
    const rows = Math.max(service.tables.length, items.length, 1);
    return { service, items, height: rows * ROW };
  });
  const blocks = layout.map((block, i) => ({
    ...block,
    y: 24 + layout.slice(0, i).reduce((sum, b) => sum + b.height + GAP, 0),
  }));
  const last = blocks[blocks.length - 1];
  const height = last ? last.y + last.height + 8 : 32;

  return (
    <figure className="overflow-x-auto rounded-lg border bg-card p-4">
      <svg
        viewBox={`0 0 ${TOTAL_W} ${height}`}
        className="mx-auto h-auto w-full min-w-[640px] max-w-[760px]"
        role="img"
        aria-label={`Service graph: ${services.map((s) => s.name).join(", ")}`}
      >
        <g className="fill-muted-foreground font-mono text-[10px] uppercase">
          <text x={COLS.table} y={10}>
            Tables
          </text>
          <text x={COLS.service} y={10}>
            Service
          </text>
          <text x={COLS.item} y={10}>
            Resources and actions
          </text>
        </g>
        {blocks.map(({ service, items, y, height: h }) => {
          const centerY = y + h / 2;
          const column = (count: number, index: number) =>
            y + (h - count * ROW) / 2 + index * ROW + (ROW - NODE_H) / 2;
          return (
            <g key={service.name}>
              {service.tables.map((table, i) => {
                const ty = column(service.tables.length, i);
                return (
                  <g key={table.name}>
                    <path
                      d={edge(
                        COLS.table + WIDTH.table,
                        ty + NODE_H / 2,
                        COLS.service,
                        centerY,
                      )}
                      className="fill-none stroke-border"
                    />
                    <Node
                      x={COLS.table}
                      y={ty}
                      width={WIDTH.table}
                      label={table.name}
                      detail={`${table.columns.length} cols`}
                    />
                  </g>
                );
              })}
              {items.map((item, i) => {
                const iy = column(items.length, i);
                return (
                  <g key={`${item.kind}:${item.label}`}>
                    <path
                      d={edge(
                        COLS.service + WIDTH.service,
                        centerY,
                        COLS.item,
                        iy + NODE_H / 2,
                      )}
                      className="fill-none stroke-border"
                    />
                    <Node
                      x={COLS.item}
                      y={iy}
                      width={WIDTH.item}
                      label={item.label}
                      detail={item.detail}
                      strong={item.kind === "resource"}
                    />
                  </g>
                );
              })}
              <Node
                x={COLS.service}
                y={centerY - NODE_H / 2}
                width={WIDTH.service}
                label={service.name}
                detail={service.engine}
                strong
              />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
