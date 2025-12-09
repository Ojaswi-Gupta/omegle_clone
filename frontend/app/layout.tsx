import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Mini Omegle",
  description: "Omegle-style video chat website",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
