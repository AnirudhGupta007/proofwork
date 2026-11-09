"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, CreditCard, FileText, Gauge, Library, MailPlus, Users } from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: Gauge, exact: true },
  { href: "/admin/invitations", label: "Invitations", icon: MailPlus },
  { href: "/admin/assessments", label: "Assessments", icon: Library },
  { href: "/admin/interviewers", label: "Interview panel", icon: Users },
  { href: "/admin/reports", label: "Reports", icon: FileText },
  { href: "/admin/billing", label: "Billing", icon: CreditCard }
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ClipboardCheck size={18} />
          </span>
          <span>Proofwork</span>
        </div>
        <nav className="nav" aria-label="Admin navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              "exact" in item && item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link aria-current={active ? "page" : undefined} className={active ? "active" : undefined} href={item.href} key={item.href}>
                <Icon size={16} /> {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
