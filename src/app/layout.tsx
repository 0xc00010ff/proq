import type { Metadata } from "next";
import localFont from "next/font/local";
import { Gemunu_Libre } from "next/font/google";

import { ClientShell } from "@/components/ClientShell";
import "./globals.css";

const gemunuLibre = Gemunu_Libre({
  subsets: ["latin"],
  weight: "800",
  variable: "--font-gemunu-libre",
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "proq",
  description: "Project management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var isDark=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.classList.toggle('dark',isDark)}catch(e){document.documentElement.classList.add('dark')}})();window.__PROQ_WS_PORT=${JSON.stringify(process.env.PROQ_WS_PORT || "42069")};`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${gemunuLibre.variable} antialiased`}
      >
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
