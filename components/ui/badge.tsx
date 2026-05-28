import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-ios-blue/15 text-ios-blue",
        secondary: "bg-ios-gray5 text-ios-gray1",
        success: "bg-ios-green/15 text-ios-green",
        warning: "bg-ios-orange/15 text-ios-orange",
        destructive: "bg-ios-red/15 text-ios-red",
        outline: "border border-ios-gray4 text-ios-gray1",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
