"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-xs uppercase tracking-wider font-semibold text-ios-gray1",
        className
      )}
      {...props}
    />
  )
}

export { Label }
