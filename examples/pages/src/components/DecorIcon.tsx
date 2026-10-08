import { cn } from "@/lib/utils";

export type DecorIconPosition =
  | "bottom-left"
  | "bottom-right"
  | "top-left"
  | "top-right";

const positionMap: Record<DecorIconPosition, string> = {
  "bottom-left": "bottom-0 left-0",
  "bottom-right": "bottom-0 right-0",
  "top-left": "left-0 top-0",
  "top-right": "right-0 top-0",
};

const translateMap: Record<DecorIconPosition, string> = {
  "bottom-left": "-translate-x-[calc(50%+0.5px)] translate-y-[calc(50%+0.5px)]",
  "bottom-right": "translate-x-[calc(50%+0.5px)] translate-y-[calc(50%+0.5px)]",
  "top-left": "-translate-x-[calc(50%+0.5px)] -translate-y-[calc(50%+0.5px)]",
  "top-right": "translate-x-[calc(50%+0.5px)] -translate-y-[calc(50%+0.5px)]",
};

export function DecorIcon({ position }: { position: DecorIconPosition }) {
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-1 size-4 shrink-0 stroke-muted-foreground stroke-[0.5px]",
        positionMap[position],
        translateMap[position],
      )}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}
