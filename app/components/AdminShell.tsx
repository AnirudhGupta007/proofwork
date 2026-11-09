import Link from "next/link";
import { ClipboardCheck, CreditCard, FileText, Gauge, Library, MailPlus, Users } from "lucide-react";

export function AdminShell({ children }: { children: React.ReactNode }) {
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
          <Link href="/admin">
            <Gauge size={16} /> Dashboard
          </Link>
          <Link href="/admin/invitations">
            <MailPlus size={16} /> Invitations
          </Link>
          <Link href="/admin/assessments">
            <Library size={16} /> Assessments
          </Link>
          <Link href="/admin/interviewers">
            <Users size={16} /> Interview panel
          </Link>
          <Link href="/admin/reports">
            <FileText size={16} /> Reports
          </Link>
          <Link href="/admin/billing">
            <CreditCard size={16} /> Billing
          </Link>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
