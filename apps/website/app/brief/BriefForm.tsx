"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Locale } from "../page";

type FormData = {
  clientName: string;
  company: string;
  phone: string;
  telegram: string;
  projectTitle: string;
  projectType: string;
  rolesNeeded: string;
  shootingDate: string;
  location: string;
  budget: string;
  usageRights: string;
  referenceLinks: string;
  notes: string;
};

const emptyForm: FormData = {
  clientName: "", company: "", phone: "", telegram: "", projectTitle: "",
  projectType: "", rolesNeeded: "", shootingDate: "", location: "", budget: "",
  usageRights: "", referenceLinks: "", notes: "",
};

const copy = {
  ru: {
    back: "НА ГЛАВНУЮ", menu: "ЯЗЫК", eyebrow: "ЗАЯВКА НА КАСТИНГ", title: ["РАССКАЖИТЕ", "О ПРОЕКТЕ"],
    intro: "Три коротких шага. Мы ответим в течение одного рабочего дня.",
    steps: ["О ВАС", "ПРОЕКТ", "ДЕТАЛИ"], next: "ДАЛЕЕ", previous: "НАЗАД", submit: "ОТПРАВИТЬ ЗАЯВКУ",
    sending: "ОТПРАВЛЯЕМ...", required: "Заполните обязательные поля.", error: "Не удалось отправить заявку. Попробуйте ещё раз или напишите нам в Telegram.",
    labels: {
      clientName: "Ваше имя *", company: "Компания", phone: "Номер телефона *", telegram: "Telegram (необязательно)",
      projectTitle: "Название проекта", projectType: "Тип проекта *", rolesNeeded: "Какие актёры / роли нужны? *",
      shootingDate: "Дата съёмки", location: "Место съёмки", budget: "Бюджет / диапазон",
      usageRights: "Где и как будет использоваться материал?", referenceLinks: "Ссылки на референсы",
      files: "Референсы или документы", notes: "Дополнительная информация",
    },
    hints: { files: "До 3 файлов, каждый не больше 5 МБ", roles: "Количество, возраст, типаж и особенности ролей" },
    types: ["Реклама", "Кино / сериал", "Музыкальное видео", "Контент / соцсети", "Мероприятие", "Другое"],
    success: "ЗАЯВКА ПОЛУЧЕНА", successText: "Мы сохранили её в рабочей системе. Менеджер свяжется с вами в течение одного рабочего дня.",
    reference: "НОМЕР ЗАЯВКИ", telegram: "НАПИСАТЬ В TELEGRAM", home: "ВЕРНУТЬСЯ НА ГЛАВНУЮ",
  },
  en: {
    back: "BACK HOME", menu: "LANGUAGE", eyebrow: "CASTING REQUEST", title: ["TELL US ABOUT", "THE PROJECT"],
    intro: "Three short steps. We will respond within one business day.",
    steps: ["ABOUT YOU", "PROJECT", "DETAILS"], next: "CONTINUE", previous: "BACK", submit: "SEND A BRIEF",
    sending: "SENDING...", required: "Please complete the required fields.", error: "We could not send the request. Please try again or message us on Telegram.",
    labels: {
      clientName: "Your name *", company: "Company", phone: "Phone number *", telegram: "Telegram (optional)",
      projectTitle: "Project name", projectType: "Production type *", rolesNeeded: "Roles / talent needed *",
      shootingDate: "Shooting date", location: "Shooting location", budget: "Budget / range",
      usageRights: "Usage rights", referenceLinks: "Reference links", files: "References or documents", notes: "Additional notes",
    },
    hints: { files: "Up to 3 files, 5 MB each", roles: "Quantity, age, look and role details" },
    types: ["Commercial", "Film / series", "Music video", "Content / social", "Event", "Other"],
    success: "BRIEF RECEIVED", successText: "It is saved in our work system. A manager will contact you within one business day.",
    reference: "REQUEST NUMBER", telegram: "MESSAGE ON TELEGRAM", home: "BACK TO HOME",
  },
  uz: {
    back: "BOSH SAHIFA", menu: "TIL", eyebrow: "KASTING SO‘ROVI", title: ["LOYIHANGIZ", "HAQIDA YOZING"],
    intro: "Uchta qisqa bosqich. Bir ish kuni ichida siz bilan bog‘lanamiz.",
    steps: ["SIZ HAQINGIZDA", "LOYIHA", "TAFSILOTLAR"], next: "DAVOM ETISH", previous: "ORQAGA", submit: "SO‘ROVNI YUBORISH",
    sending: "YUBORILMOQDA...", required: "Majburiy joylarni to‘ldiring.", error: "So‘rov yuborilmadi. Qayta urinib ko‘ring yoki Telegram orqali yozing.",
    labels: {
      clientName: "Ismingiz *", company: "Kompaniya nomi", phone: "Telefon raqamingiz *", telegram: "Telegram (ixtiyoriy)",
      projectTitle: "Loyiha nomi", projectType: "Loyiha turi *", rolesNeeded: "Qanday aktyorlar yoki rollar kerak? *",
      shootingDate: "Suratga olish sanasi", location: "Suratga olish joyi", budget: "Byudjet yoki byudjet oralig‘i",
      usageRights: "Material qayerda va qancha muddat ishlatiladi?", referenceLinks: "Namuna havolalari",
      files: "Namuna yoki hujjatlar", notes: "Qo‘shimcha ma’lumot",
    },
    hints: { files: "Ko‘pi bilan 3 ta fayl, har biri 5 MB gacha", roles: "Soni, yoshi, tashqi ko‘rinishi va rol tafsilotlari" },
    types: ["Reklama", "Film / serial", "Musiqiy video", "Ijtimoiy tarmoq kontenti", "Tadbir", "Boshqa"],
    success: "SO‘ROV QABUL QILINDI", successText: "So‘rovingiz ish tizimimizga saqlandi. Menejer bir ish kuni ichida siz bilan bog‘lanadi.",
    reference: "SO‘ROV RAQAMI", telegram: "TELEGRAM ORQALI YOZISH", home: "BOSH SAHIFAGA QAYTISH",
  },
} satisfies Record<Locale, unknown>;

const requiredByStep: Array<Array<keyof FormData>> = [
  ["clientName", "phone"],
  ["projectType", "rolesNeeded"],
  [],
];

async function fileToPayload(file: File) {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, data };
}

export function BriefForm({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [briefId, setBriefId] = useState("");
  const apiUrl = process.env.NEXT_PUBLIC_DASHBOARD_API_URL ?? "http://127.0.0.1:8787";
  const telegramUrl = process.env.NEXT_PUBLIC_MANAGER_TELEGRAM_URL ?? "https://t.me/faceproductionuz";

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem("face-production-language", locale);
  }, [locale]);

  const stepValid = useMemo(
    () => requiredByStep[step].every((field) => form[field].trim()),
    [form, step],
  );

  const update = (field: keyof FormData, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const next = () => {
    if (!stepValid) {
      setError(t.required);
      return;
    }
    setError("");
    setStep((current) => Math.min(2, current + 1));
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).slice(0, 3);
    if (selected.some((file) => file.size > 5 * 1024 * 1024)) {
      setError(t.hints.files);
      event.target.value = "";
      return;
    }
    setFiles(selected);
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step < 2) {
      next();
      return;
    }
    if (!requiredByStep.flat().every((field) => form[field].trim())) {
      setError(t.required);
      return;
    }
    setSending(true);
    setError("");
    try {
      const attachments = await Promise.all(files.map(fileToPayload));
      const response = await fetch(`${apiUrl}/api/public/briefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, attachments, locale }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Request failed");
      setBriefId(result.id);
    } catch (submissionError) {
      console.error(submissionError);
      setError(t.error);
    } finally {
      setSending(false);
    }
  };

  if (briefId) {
    return (
      <div className="brief-site-frame">
        <BriefHeader locale={locale} label={t.back} />
        <main className="brief-success">
          <span className="brief-stamp">{t.reference}<strong>{briefId}</strong></span>
          <p className="brief-eyebrow">FACE PRODUCTION / {t.eyebrow}</p>
          <h1>{t.success}<span>.</span></h1>
          <p className="brief-success-copy">{t.successText}</p>
          <div className="brief-success-actions">
            <a className="brief-primary" href={telegramUrl} rel="noreferrer" target="_blank">{t.telegram}<span>→</span></a>
            <a className="brief-secondary" href={`/${locale}`}>{t.home}<span>→</span></a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="brief-site-frame">
      <BriefHeader locale={locale} label={t.back} />
      <main className="brief-layout">
        <section className="brief-intro">
          <p className="brief-eyebrow">FACE PRODUCTION / {t.eyebrow}</p>
          <h1>{t.title[0]}<br />{t.title[1]}<span>.</span></h1>
          <p>{t.intro}</p>
          <div className="brief-dossier-note" aria-hidden="true">PROJECT<br />CASTING<br />{new Date().getFullYear()}</div>
        </section>

        <form className="brief-form" noValidate onSubmit={submit}>
          <ol className="brief-progress" aria-label="Progress">
            {t.steps.map((label, index) => (
              <li className={index === step ? "is-active" : index < step ? "is-complete" : ""} key={label}>
                <button type="button" onClick={() => index < step && setStep(index)}>
                  <span>0{index + 1}</span>{label}
                </button>
              </li>
            ))}
          </ol>

          <div className="brief-fields">
            {step === 0 && <>
              <Field label={t.labels.clientName}><input autoComplete="name" required value={form.clientName} onChange={(e) => update("clientName", e.target.value)} /></Field>
              <Field label={t.labels.company}><input autoComplete="organization" value={form.company} onChange={(e) => update("company", e.target.value)} /></Field>
              <Field label={t.labels.phone}><input autoComplete="tel" inputMode="tel" placeholder="+998" required type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} /></Field>
              <Field label={t.labels.telegram}><input autoComplete="off" placeholder="@username" value={form.telegram} onChange={(e) => update("telegram", e.target.value)} /></Field>
            </>}
            {step === 1 && <>
              <Field label={t.labels.projectTitle}><input value={form.projectTitle} onChange={(e) => update("projectTitle", e.target.value)} /></Field>
              <Field label={t.labels.projectType}>
                <select required value={form.projectType} onChange={(e) => update("projectType", e.target.value)}>
                  <option value="">—</option>{t.types.map((type) => <option key={type}>{type}</option>)}
                </select>
              </Field>
              <Field className="brief-field-wide" hint={t.hints.roles} label={t.labels.rolesNeeded}><textarea required rows={3} value={form.rolesNeeded} onChange={(e) => update("rolesNeeded", e.target.value)} /></Field>
              <Field label={t.labels.shootingDate}><input type="date" value={form.shootingDate} onChange={(e) => update("shootingDate", e.target.value)} /></Field>
              <Field label={t.labels.location}><input value={form.location} onChange={(e) => update("location", e.target.value)} /></Field>
            </>}
            {step === 2 && <>
              <Field label={t.labels.budget}><input value={form.budget} onChange={(e) => update("budget", e.target.value)} /></Field>
              <Field label={t.labels.usageRights}><input value={form.usageRights} onChange={(e) => update("usageRights", e.target.value)} /></Field>
              <Field className="brief-field-wide" label={t.labels.referenceLinks}><textarea rows={2} value={form.referenceLinks} onChange={(e) => update("referenceLinks", e.target.value)} /></Field>
              <Field className="brief-field-wide" hint={t.hints.files} label={t.labels.files}>
                <input accept="image/*,.pdf,.doc,.docx" multiple onChange={selectFiles} type="file" />
                {files.length > 0 && <span className="brief-file-list">{files.map((file) => file.name).join(" · ")}</span>}
              </Field>
              <Field className="brief-field-wide" label={t.labels.notes}><textarea rows={4} value={form.notes} onChange={(e) => update("notes", e.target.value)} /></Field>
            </>}
          </div>

          {error && <p className="brief-error" role="alert">{error}</p>}
          <div className="brief-controls">
            {step > 0 && <button className="brief-secondary" type="button" onClick={() => { setError(""); setStep((current) => current - 1); }}>{t.previous}<span>←</span></button>}
            {step < 2
              ? <button className="brief-primary" type="button" onClick={next}>{t.next}<span>→</span></button>
              : <button className="brief-primary" disabled={sending} type="submit">{sending ? t.sending : t.submit}<span>→</span></button>}
          </div>
        </form>
      </main>
    </div>
  );
}

function BriefHeader({ locale, label }: { locale: Locale; label: string }) {
  return <header className="brief-header">
    <a className="brand" href={`/${locale}`}>FACE PRODUCTION</a>
    <nav><a href={`/${locale}`}>{label}</a><div className="brief-languages">
      {(["ru", "en", "uz"] as Locale[]).map((item) => <a className={item === locale ? "is-active" : ""} href={`/${item}/brief`} key={item}>{item.toUpperCase()}</a>)}
    </div></nav>
  </header>;
}

function Field({ children, className = "", hint, label }: { children: React.ReactNode; className?: string; hint?: string; label: string }) {
  return <label className={`brief-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
