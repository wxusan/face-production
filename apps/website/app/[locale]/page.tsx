import { notFound } from "next/navigation";
import { FaceProductionPage, type Locale } from "../page";

const supportedLocales: Locale[] = ["ru", "en", "uz"];

export function generateStaticParams() {
  return supportedLocales.map((locale) => ({ locale }));
}

export default async function LocalizedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  if (!supportedLocales.includes(locale as Locale)) notFound();

  return <FaceProductionPage initialLocale={locale as Locale} />;
}
