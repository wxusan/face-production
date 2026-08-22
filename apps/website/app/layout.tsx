import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: "Face Production — Casting & Talent",
    description: "Кастинг для кино, рекламы и культуры.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Face Production — Casting & Talent",
      description: "Кастинг для кино, рекламы и культуры.",
      images: [{ url: socialImage, width: 1672, height: 941 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Face Production — Casting & Talent",
      description: "Кастинг для кино, рекламы и культуры.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
