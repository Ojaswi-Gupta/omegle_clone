import "./globals.css";
import "./extra.css";
import { ReactNode } from "react";

export const metadata = {
  title: "VibeChat",
  description: "Anonymous video chat — connect with strangers instantly",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Euphoria+Script&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
