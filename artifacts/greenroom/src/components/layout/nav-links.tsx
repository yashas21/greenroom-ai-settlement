import { Link, useLocation } from "wouter";
import { Calendar, Users, BarChart3, PieChart, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/shows", label: "Shows", icon: Calendar },
  { href: "/artists", label: "Artists", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/deal-analysis", label: "Deal Analysis", icon: PieChart },
  { href: "/needs-attention", label: "Needs Attention", icon: AlertTriangle },
];

export function NavLinks() {
  const [pathname] = useLocation();

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150",
              active
                ? "bg-white text-ink-900 font-medium shadow-[0_1px_3px_rgba(26,24,20,0.06)] ring-1 ring-ink-200/40"
                : "text-ink-500 hover:bg-white/70 hover:text-ink-900",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 transition-colors",
                active ? "text-brand-700" : "text-ink-400",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
