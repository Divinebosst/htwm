import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Lora, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-barlow",
  display: "swap",
});
const body = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-source",
  display: "swap",
});
const scripture = Lora({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["italic"],
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: {
    default: "Heal The World Ministries International | Omega Family Church",
    template: "%s | Heal The World Ministries International",
  },
  description:
    "Heal The World Ministries International, Omega Family Church, led by Apostle Chrispen and Prophetess Yvonne Mahovo. Healings, miracles and deliverances. Changing lives, reviving nations.",
  openGraph: {
    title: "Heal The World Ministries International",
    description: "Omega Family Church. Healings, miracles and deliverances. Changing lives, reviving nations.",
    images: ["/images/flier.webp"],
  },
};

export const viewport: Viewport = {
  themeColor: "#022b8d",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${scripture.variable}`}>
      <body>{children}</body>
    </html>
  );
}
