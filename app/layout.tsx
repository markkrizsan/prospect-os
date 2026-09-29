import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospect OS — Conversation Engine V10",
  description: "Google Sheets-powered outreach execution command center",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
