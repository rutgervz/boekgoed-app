import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taxi Schiermonnikoog · rit boeken",
  description: "Online een taxirit op Schiermonnikoog boeken en betalen.",
};

export const viewport: Viewport = { themeColor: "#123144" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
