import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import { cn } from "@/lib/utils"
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SafeAlert",
  description: "Your Home, Secured With Smart Boundaries.`",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn("bg-[#F0F0F0]", inter.className )}>

        <div>
        {children}
        </div>
      </body>
    </html>
  );
}