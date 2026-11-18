import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "@fontsource/pinyon-script/400.css";
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/600.css";
import "@fontsource/mukta/700.css";
import "@fontsource/kalam/400.css";
import "./globals.css";

const baseUrl = process.env.APP_BASE_URL;

export const metadata: Metadata = {
  metadataBase: baseUrl ? new URL(baseUrl) : undefined,
  title: "Pigeon Post 2027: send a New Year pigeon",
  description:
    "A little bird. A special message. Send a pigeon carrying your personal New Year message. It lands in their inbox on 1 January 2027, at the time you choose.",
  openGraph: {
    title: "Pigeon Post 2027",
    description: "Send a pigeon. Make someone's New Year memorable.",
    type: "website",
    locale: "en_IN",
  },
};

export const viewport: Viewport = {
  themeColor: "#17123F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
