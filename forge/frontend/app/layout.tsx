import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forge",
  description: "Voice-agent build and evaluation dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
