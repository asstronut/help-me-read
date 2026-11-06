import type { Metadata } from "next";
import { connection } from "next/server";
import { Atkinson_Hyperlegible, Geist, Geist_Mono, Literata } from "next/font/google";
import { currentTheme } from "@/lib/settings/settings.server";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Reading text and serif titles. Variable, with the optical-size axis so large titles get display shapes.
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

// The reader's third typeface, chosen in Aa. Not preloaded: only a reader who picks it downloads it.
const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  preload: false,
});

export const metadata: Metadata = {
  title: "help-me-read",
  description: "A single-user reader with AI actions",
};

// The theme class on <html> comes from the signed-in user's settings, so every page waits for that read.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const theme = await currentTheme(await createClient());
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${literata.variable} ${atkinson.variable} ${theme} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
