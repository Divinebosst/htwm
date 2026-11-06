import type { Metadata } from "next";
import { AuthProvider } from "@/admin/auth";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "Church admin", template: "%s · Church admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
