import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SpinnerProps extends React.HTMLAttributes<HTMLOrSVGElement> {
  size?: number;
}

function Spinner({ className, size = 16, ...props }: SpinnerProps) {
  return (
    <Loader2
      aria-label="Loading"
      role="status"
      size={size}
      className={cn("animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
