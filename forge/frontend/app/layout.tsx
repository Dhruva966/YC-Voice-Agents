import "./globals.css";
import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT", "WONK"]
});

export const metadata: Metadata = {
  title: "Forge — Voice Agent Infrastructure",
  description: "Voice-agent build and evaluation dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = `${fraunces.variable} ${GeistSans.variable} ${GeistMono.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
