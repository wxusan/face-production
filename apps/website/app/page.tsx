"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type Locale = "ru" | "en" | "uz";

type SiteCopy = {
  nav: { work: string; talent: string; contact: string; menu: string; close: string };
  headline: [string, string];
  subtitle: [string, string];
  sendBrief: string;
  applyAsTalent: string;
  steps: [string, string, string];
  welcome: [string, string];
  contact: {
    eyebrow: string;
    title: [string, string];
    note: string;
    channels: [
      { code: string; name: string; purpose: string; action: string },
      { code: string; name: string; purpose: string; action: string },
      { code: string; name: string; purpose: string; action: string },
    ];
  };
};

const localeOptions: Array<{ code: Locale; short: string; name: string }> = [
  { code: "ru", short: "RU", name: "Русский" },
  { code: "en", short: "EN", name: "English" },
  { code: "uz", short: "UZ", name: "O‘zbekcha" },
];

const siteCopy: Record<Locale, SiteCopy> = {
  ru: {
    nav: { work: "Работы", talent: "Артисты", contact: "Контакты", menu: "Меню", close: "Закрыть" },
    headline: ["ОТ БРИФА", "ДО БУКИНГА"],
    subtitle: ["Кастинг для кино,", "рекламы и культуры."],
    sendBrief: "ОТПРАВИТЬ ЗАЯВКУ",
    applyAsTalent: "СТАТЬ АРТИСТОМ",
    steps: ["БРИФ", "ШОРТ-ЛИСТ", "БУКИНГ"],
    welcome: ["МЫ ИЩЕМ", "НОВЫЕ ТАЛАНТЫ."],
    contact: {
      eyebrow: "КОНТАКТЫ / СВЯЗЬ",
      title: ["ОДИН ВОПРОС —", "ОДИН КАНАЛ."],
      note: "ЛОКАЛЬНЫЙ ПРЕДПРОСМОТР · ССЫЛКИ ПОКА НЕ АКТИВНЫ",
      channels: [
        { code: "01 / BOT", name: "TELEGRAM-БОТ", purpose: "Анкета артиста", action: "НАЧАТЬ" },
        { code: "02 / SOCIAL", name: "INSTAGRAM", purpose: "Работы и бэкстейдж", action: "СМОТРЕТЬ" },
        { code: "03 / DIRECT", name: "TELEGRAM", purpose: "Бриф и связь с менеджером", action: "НАПИСАТЬ" },
      ],
    },
  },
  en: {
    nav: { work: "Work", talent: "Talent", contact: "Contact", menu: "Menu", close: "Close" },
    headline: ["FROM BRIEF", "TO BOOKED"],
    subtitle: ["Focused casting for film,", "advertising and culture."],
    sendBrief: "SEND A BRIEF",
    applyAsTalent: "APPLY AS TALENT",
    steps: ["BRIEF", "SHORTLIST", "BOOK"],
    welcome: ["WE WELCOME", "NEW TALENT."],
    contact: {
      eyebrow: "CONTACT / CHANNELS",
      title: ["ONE QUESTION —", "ONE CHANNEL."],
      note: "LOCAL PREVIEW · LINKS ARE NOT ACTIVE YET",
      channels: [
        { code: "01 / BOT", name: "TELEGRAM BOT", purpose: "Talent application", action: "START" },
        { code: "02 / SOCIAL", name: "INSTAGRAM", purpose: "Work and backstage", action: "VIEW" },
        { code: "03 / DIRECT", name: "TELEGRAM", purpose: "Briefs and a real manager", action: "MESSAGE" },
      ],
    },
  },
  uz: {
    nav: { work: "Ishlar", talent: "Aktyorlar", contact: "Aloqa", menu: "Menyu", close: "Yopish" },
    headline: ["SO‘ROVDAN", "TASDIQQACHA"],
    subtitle: ["Kino, reklama va madaniy loyihalar", "uchun aktyorlar kastingi."],
    sendBrief: "KASTING SO‘ROVI",
    applyAsTalent: "AKTYOR BO‘LISH",
    steps: ["SO‘ROV", "SARALASH", "TASDIQ"],
    welcome: ["YANGI ISTE’DODLARNI", "QABUL QILAMIZ."],
    contact: {
      eyebrow: "ALOQA / KANALLAR",
      title: ["BITTA SAVOL —", "BITTA KANAL."],
      note: "LOKAL KO‘RINISH · HAVOLALAR HOZIRCHA FAOL EMAS",
      channels: [
        { code: "01 / BOT", name: "TELEGRAM-BOT", purpose: "Aktyor anketasi", action: "BOSHLASH" },
        { code: "02 / SOCIAL", name: "INSTAGRAM", purpose: "Ishlar va beksteyj", action: "KO‘RISH" },
        { code: "03 / DIRECT", name: "TELEGRAM", purpose: "Kasting so‘rovi va menejer bilan aloqa", action: "YOZISH" },
      ],
    },
  },
};

const LANGUAGE_PREFERENCE_KEY = "face-production-language";

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg className={`arrow ${className}`} viewBox="0 0 52 24" aria-hidden="true">
      <path d="M1 12h43M34 3l10 9-10 9" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 92 104" aria-hidden="true">
      <path d="M27 13H14a5 5 0 0 0-5 5v77h69V18a5 5 0 0 0-5-5H60" />
      <path d="M32 8h5c1-5 5-7 9-7s8 2 9 7h6v14H32zM23 41h42M23 55h42M23 69h35M23 83h29" />
    </svg>
  );
}

function ShortlistIcon() {
  return (
    <svg viewBox="0 0 108 98" aria-hidden="true">
      <path d="M8 26l49-14 20 71-49 14z" />
      <path d="M25 17L76 8l13 74-51 9z" />
      <path className="front-card" d="M39 4h58v78H39z" />
      <circle cx="68" cy="29" r="10" />
      <path d="M49 65c1-13 9-20 19-20s18 7 20 20z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x="8" y="15" width="84" height="77" rx="3" />
      <path d="M8 34h84M29 7v17M71 7v17M23 50h12M44 50h12M65 50h12M23 66h12M44 66h12" />
      <path className="icon-check" d="M62 73l7 7 14-17" />
    </svg>
  );
}

const stepIcons = [<ClipboardIcon key="brief" />, <ShortlistIcon key="shortlist" />, <CalendarIcon key="book" />];

function MenuButton({ open, onClick, copy }: { open: boolean; onClick: () => void; copy: SiteCopy }) {
  return (
    <button
      className={`menu-button ${open ? "is-open" : ""}`}
      type="button"
      aria-label={open ? copy.nav.close : copy.nav.menu}
      aria-expanded={open}
      aria-controls="mobile-menu"
      onClick={onClick}
    >
      <span className="menu-label">{open ? copy.nav.close : copy.nav.menu}</span>
      <span className="menu-lines" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </button>
  );
}

function LanguageToggle({ locale, mobile = false, onSelect }: { locale: Locale; mobile?: boolean; onSelect: (locale: Locale) => void }) {
  return (
    <div className={`language-toggle ${mobile ? "language-toggle-mobile" : ""}`} role="group" aria-label="Language">
      {localeOptions.map((option) => (
        <button
          key={option.code}
          type="button"
          className={option.code === locale ? "is-active" : ""}
          aria-label={option.name}
          aria-pressed={option.code === locale}
          onClick={() => onSelect(option.code)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}

function Header({ copy, locale, onLanguageSelect }: { copy: SiteCopy; locale: Locale; onLanguageSelect: (locale: Locale) => void }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.classList.add("menu-open");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("menu-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Face Production home">
          FACE PRODUCTION
        </a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#work">{copy.nav.work}</a>
          <a href="#talent">{copy.nav.talent}</a>
          <a href="#contact">{copy.nav.contact}</a>
          <LanguageToggle locale={locale} onSelect={onLanguageSelect} />
        </nav>
        <MenuButton open={open} copy={copy} onClick={() => setOpen((value) => !value)} />
      </header>
      <nav id="mobile-menu" className={`mobile-menu ${open ? "is-open" : ""}`} aria-label="Mobile navigation" aria-hidden={!open}>
        <a ref={closeRef} href="#work" onClick={() => setOpen(false)}>{copy.nav.work}</a>
        <a href="#talent" onClick={() => setOpen(false)}>{copy.nav.talent}</a>
        <a href="#contact" onClick={() => setOpen(false)}>{copy.nav.contact}</a>
        <LanguageToggle mobile locale={locale} onSelect={onLanguageSelect} />
      </nav>
    </>
  );
}

function CastingBoard() {
  return (
    <figure className="casting-board" aria-label="Casting contact sheet with shortlisted performers, scene-test photographs, production notes, and red pencil annotations">
      <picture>
        <source media="(max-width: 1050px)" srcSet="/assets/casting-board-mobile-v2.png" />
        <Image
          src="/assets/casting-board-desktop-v2.png"
          alt=""
          width={1576}
          height={998}
          priority
          sizes="(max-width: 1050px) 100vw, 61vw"
        />
      </picture>
    </figure>
  );
}

function ActionLink({ children, variant, href }: { children: React.ReactNode; variant: "solid" | "outline"; href: string }) {
  return (
    <a className={`action action-${variant}`} href={href}>
      <span>{children}</span>
      <Arrow />
    </a>
  );
}

function Hero({ copy, locale }: { copy: SiteCopy; locale: Locale }) {
  return (
    <main className="hero" id="top">
      <div className="hero-copy">
        <h1 className="hero-title">
          <span>{copy.headline[0]}</span>
          <span>{copy.headline[1]}<span className="title-period">.</span></span>
        </h1>
        <p className="hero-subtitle">
          {copy.subtitle[0]}<br />{copy.subtitle[1]}
        </p>
        <div className="hero-actions">
          <ActionLink variant="solid" href={`/${locale}/brief`}>{copy.sendBrief}</ActionLink>
          <div className="mobile-talent-action">
            <ActionLink variant="outline" href="#bot-contact">{copy.applyAsTalent}</ActionLink>
          </div>
        </div>
      </div>
      <CastingBoard />
    </main>
  );
}

function ProcessStep({ number, label, icon }: { number: string; label: string; icon: React.ReactNode }) {
  return (
    <article className="process-step">
      <div className="step-copy">
        <span className="step-number">{number}</span>
        <h2>{label}</h2>
      </div>
      <div className="step-icon">
        {icon}
        <span className="red-scribble" aria-hidden="true" />
      </div>
      <Arrow className="step-arrow" />
    </article>
  );
}

function TalentInvitation({ copy }: { copy: SiteCopy }) {
  return (
    <aside className="talent-invitation" id="talent">
      <div className="talent-polaroid" aria-hidden="true">
        <span className="pin" />
        <Image src="/assets/talent-portrait.png" alt="" width={145} height={168} />
      </div>
      <div className="talent-copy">
        <h2>{copy.welcome[0]}<br />{copy.welcome[1]}</h2>
        <ActionLink variant="outline" href="#bot-contact">{copy.applyAsTalent}</ActionLink>
      </div>
    </aside>
  );
}

function ProcessSection({ copy }: { copy: SiteCopy }) {
  return (
    <section className="process-section" id="work" aria-label="Casting process">
      {copy.steps.map((label, index) => (
        <ProcessStep key={label} number={`0${index + 1}`} label={label} icon={stepIcons[index]} />
      ))}
      <TalentInvitation copy={copy} />
    </section>
  );
}

function ContactSection({ copy }: { copy: SiteCopy }) {
  return (
    <section className="contact-section" id="contact" aria-labelledby="contact-title">
      <div className="contact-heading">
        <span className="contact-eyebrow">{copy.contact.eyebrow}</span>
        <h2 id="contact-title">
          {copy.contact.title[0]}<br />{copy.contact.title[1]}
        </h2>
        <p>{copy.contact.note}</p>
      </div>
      <div className="contact-channels">
        {copy.contact.channels.map((channel, index) => (
          <article
            className="contact-card"
            id={index === 0 ? "bot-contact" : index === 2 ? "manager-contact" : undefined}
            key={channel.code}
          >
            <span className="contact-code">{channel.code}</span>
            <span className="contact-monogram" aria-hidden="true">{index === 1 ? "IG" : "TG"}</span>
            <h3>{channel.name}</h3>
            <p>{channel.purpose}</p>
            <span className="contact-action">
              {channel.action}
              <Arrow />
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function FaceProductionPage({ initialLocale = "ru" }: { initialLocale?: Locale }) {
  const locale = initialLocale;
  const copy = siteCopy[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    const savedLocale = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY) as Locale | null;

    if (window.location.pathname === "/" && savedLocale && savedLocale !== "ru" && siteCopy[savedLocale]) {
      window.location.replace(`/${savedLocale}`);
      return;
    }

    window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, locale);
  }, [locale]);

  const selectLanguage = (nextLocale: Locale) => {
    window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, nextLocale);
    if (nextLocale === locale && window.location.pathname === `/${nextLocale}`) return;
    window.location.assign(`/${nextLocale}`);
  };

  return (
    <div className="site-frame" data-locale={locale}>
      <Header copy={copy} locale={locale} onLanguageSelect={selectLanguage} />
      <Hero copy={copy} locale={locale} />
      <ProcessSection copy={copy} />
      <ContactSection copy={copy} />
    </div>
  );
}

export default function RussianHomePage() {
  return <FaceProductionPage initialLocale="ru" />;
}
