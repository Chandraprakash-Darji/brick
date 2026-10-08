import { useMemo, type ReactNode } from "react";

import { CornerFrame } from "./CornerFrame";
import { DecorIcon } from "./DecorIcon";

const COLS = 20;
const ROWS = 12;

export function AuthLayout({
  children,
  gridArea = "5/9/9/13",
}: {
  children: ReactNode;
  gridArea?: string;
}) {
  const cells = useMemo(
    () =>
      Array.from({ length: ROWS * COLS }, (_, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const v = (row * 7 + col * 3 + row * col) % 17;
        return v === 0 || v === 5 || v === 11;
      }),
    [],
  );

  return (
    <div className="flex h-screen w-full items-center justify-center overflow-hidden">
      <div className="grid grid-cols-[repeat(20,6rem)] grid-rows-[repeat(12,7rem)] bg-muted/80 *:border-[0.5px] md:grid-cols-[repeat(20,7.5rem)] md:grid-rows-[repeat(12,7.5rem)] dark:bg-muted/25">
        {cells.map((transparent, i) => (
          <div
            key={i}
            className={transparent ? "bg-transparent" : "bg-background"}
          />
        ))}
        <div
          className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center bg-background"
          style={{ gridArea }}
        >
          <DecorIcon position="top-left" />
          <DecorIcon position="top-right" />
          <DecorIcon position="bottom-left" />
          <DecorIcon position="bottom-right" />
          <CornerFrame className="w-full">
            <div className="mx-auto flex h-max w-full max-w-md flex-col gap-2 px-8 py-10">
              {children}
            </div>
          </CornerFrame>
        </div>
      </div>
    </div>
  );
}
