import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full rounded-xl border border-ios-gray4 bg-white px-3.5 py-2 text-[15px] placeholder:text-ios-gray2 focus-visible:outline-none focus-visible:border-ios-blue focus-visible:ring-2 focus-visible:ring-ios-blue/20 disabled:opacity-50 disabled:bg-ios-gray6",
        className
      )}
      {...props}
    />
  )
}

export { Input }
