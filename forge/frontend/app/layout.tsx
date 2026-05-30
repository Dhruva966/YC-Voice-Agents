import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Inter, Fira_Code } from "next/font/google";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT", "WONK"]
});

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Forge — Voice Agent Infrastructure",
  description: "Voice-agent build and evaluation dashboard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = `${fraunces.variable} ${inter.variable} ${firaCode.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
