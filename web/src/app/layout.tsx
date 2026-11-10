import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Space Cadet",
  description:
    "Space Cadet: predicting when space debris reenters, and a game about it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
