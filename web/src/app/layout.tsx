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
      <body className="antialiased">
        {/* Without JavaScript, show chapters straight away instead of waiting to fade in. */}
        <noscript>
          <style>{`.reveal{opacity:1!important;transform:none!important}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
