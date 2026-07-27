import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Vibe Connect",
  description: "Anonymous video chat — connect with strangers instantly",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
