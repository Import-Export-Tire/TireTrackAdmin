import { cn } from "@/lib/utils";

type GroupedListProps = {
  children: React.ReactNode;
  className?: string;
};

export function GroupedList({ children, className }: GroupedListProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-2xl shadow-ios divide-y divide-ios-gray5 overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

type GroupedListItemProps = {
  label: React.ReactNode;
  value?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
};

export function GroupedListItem({ label, value, href, onClick, trailing }: GroupedListItemProps) {
  const inner = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 min-h-[44px]">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] text-black truncate">{label}</div>
        {value && <div className="text-[13px] text-ios-gray1 mt-0.5 truncate">{value}</div>}
      </div>
      {trailing && <div className="shrink-0 text-ios-gray1">{trailing}</div>}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block hover:bg-ios-gray6 transition-colors">
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button onClick={onClick} className="block w-full text-left hover:bg-ios-gray6 transition-colors">
        {inner}
      </button>
    );
  }
  return inner;
}
