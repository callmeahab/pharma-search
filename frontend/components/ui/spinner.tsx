import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const spinnerVariants = cva(
  "animate-spin rounded-full border-solid border-current border-r-transparent text-health-primary dark:text-green-300",
  {
    variants: {
      size: {
        sm: "h-4 w-4 border-2",
        md: "h-6 w-6 border-2",
        lg: "h-8 w-8 border-[3px]",
        xl: "h-12 w-12 border-[4px]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

export interface SpinnerProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof spinnerVariants> {
  text?: string
}

const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size, text, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex items-center justify-center gap-2", className)}
        {...props}
      >
        <div className={cn(spinnerVariants({ size }))} role="status" aria-label={text || "Učitavanje"} />
        {text && (
          <span className="text-sm text-muted-foreground">{text}</span>
        )}
      </div>
    )
  }
)
Spinner.displayName = "Spinner"

const SpinnerInline = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size = "sm", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center", className)}
        {...props}
      >
        <div className={cn(spinnerVariants({ size }))} role="status" aria-label="Učitavanje" />
      </div>
    )
  }
)
SpinnerInline.displayName = "SpinnerInline"

export { Spinner, SpinnerInline, spinnerVariants }