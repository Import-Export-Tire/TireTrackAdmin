import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-[44px] px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue/40",
  {
    variants: {
      variant: {
        default: "bg-ios-blue text-white hover:bg-ios-blue/90 active:bg-ios-blue/80",
        secondary: "bg-white text-black border border-ios-gray5 hover:bg-ios-gray6",
        destructive: "bg-ios-red text-white hover:bg-ios-red/90 active:bg-ios-red/80",
        ghost: "text-ios-blue hover:bg-ios-gray6",
        outline: "bg-transparent text-ios-blue border border-ios-blue hover:bg-ios-blue/5",
      },
      size: {
        default: "",
        sm: "min-h-[36px] text-[13px] px-4",
        lg: "min-h-[50px] text-[17px] px-6",
        icon: "min-h-[44px] w-[44px] px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
