import SiteHeader from "@/components/SiteHeader";
import { SiteFooter, TopBar } from "@/components/SiteChrome";

/* Header and footer for the public website (the /admin area has its own layout). */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <TopBar />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
