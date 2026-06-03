import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-xl bg-ios-gray5/60", className)}
      {...props}
    />
  );
}

export { Skeleton };
