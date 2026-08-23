import { notFound } from "next/navigation";
import { BriefForm } from "../../brief/BriefForm";
import type { Locale } from "../../page";

const supportedLocales: Locale[] = ["ru", "en", "uz"];

export function generateStaticParams() {
  return supportedLocales.map((locale) => ({ locale }));
}

export default async function LocalizedBriefPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!supportedLocales.includes(locale as Locale)) notFound();
  return <BriefForm locale={locale as Locale} />;
}
