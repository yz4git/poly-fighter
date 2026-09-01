import type { Metadata, Viewport } from "next";
import TouchInputSafety from "./TouchInputSafety";
import "./globals.css";
import "./playtest-polish.css";

export const metadata: Metadata = {
  title: "POLY FIGHTER",
  description: "HIGH-POLY FLAT SHADING 3D fighting game for iPhone Safari.",
  manifest: "/manifest.webmanifest",
  other: {
    "codex-preview": "development",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#061121",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><TouchInputSafety />{children}</body>
    </html>
  );
}
