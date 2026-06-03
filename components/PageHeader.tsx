import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  right?: React.ReactNode;
};

export function PageHeader({ title, subtitle, backHref = "/", backLabel = "Back", right }: Props) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <Link
          href={backHref}
          className="inline-flex items-center gap-0.5 text-ios-blue text-[15px] mb-1 hover:underline"
        >
          <ChevronLeft className="w-4 h-4" />
          {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-sm text-ios-gray1 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
