export const talentTaxonomy = {
  appearance: [
    { code: 'afro', en: 'Afro', ru: 'Афро', uz: 'Afro' },
    { code: 'blonde', en: 'Blonde', ru: 'Блонд', uz: 'Sariq soch' },
    { code: 'mulat', en: 'Mulat/mulatka', ru: 'Мулат / мулатка', uz: 'Mulat / mulatka' },
    { code: 'euro', en: 'Euro', ru: 'Европейская', uz: 'Yevropa' },
    { code: 'asian', en: 'Asian (Chinese / Korean)', ru: 'Азиатская (китайская / корейская)', uz: 'Osiyo (xitoy / koreys)' },
    { code: 'south_asian', en: 'South Asian', ru: 'Южноазиатская', uz: 'Janubiy Osiyo' },
    { code: 'arab', en: 'Arab', ru: 'Арабская', uz: 'Arab' },
  ],
  languages: [
    { code: 'uzbek', en: 'Uzbek', ru: 'Узбекский', uz: 'O‘zbek' },
    { code: 'russian', en: 'Russian', ru: 'Русский', uz: 'Rus' },
    { code: 'english', en: 'English', ru: 'Английский', uz: 'Ingliz' },
  ],
  performance: [
    { code: 'acting', en: 'Acting', ru: 'Актерство', uz: 'Aktyorlik' },
    { code: 'singing', en: 'Singing', ru: 'Вокал', uz: 'Qo‘shiq' },
    { code: 'dancing', en: 'Dancing', ru: 'Танцы', uz: 'Raqs' },
    { code: 'hiphop', en: 'Hip-hop', ru: 'Хип-хоп', uz: 'Hip-hop' },
    { code: 'ballet', en: 'Ballet', ru: 'Балет', uz: 'Balet' },
    { code: 'public_speaking', en: 'Public Speaking', ru: 'Публичные выступления', uz: 'Ommaviy nutq' },
    { code: 'hosting', en: 'Hosting', ru: 'Ведение мероприятий', uz: 'Boshlovchilik' },
    { code: 'comedy', en: 'Comedy', ru: 'Комедия', uz: 'Komediya' },
    { code: 'voice_acting', en: 'Voice Acting', ru: 'Озвучка', uz: 'Ovoz aktyorligi' },
  ],
  physical: [
    { code: 'acrobatics', en: 'Acrobatics', ru: 'Акробатика', uz: 'Akrobatika' },
    { code: 'parkour', en: 'Parkour', ru: 'Паркур', uz: 'Parkur' },
    { code: 'driving', en: 'Driving', ru: 'Вождение', uz: 'Haydash' },
    { code: 'manual_driving', en: 'Manual Driving', ru: 'Механика', uz: 'Mexanik haydash' },
    { code: 'motorcycle', en: 'Motorcycle', ru: 'Мотоцикл', uz: 'Mototsikl' },
  ],
  sports: [
    { code: 'football', en: 'Football', ru: 'Футбол', uz: 'Futbol' },
    { code: 'basketball', en: 'Basketball', ru: 'Баскетбол', uz: 'Basketbol' },
    { code: 'swimming', en: 'Swimming', ru: 'Плавание', uz: 'Suzish' },
    { code: 'boxing', en: 'Boxing', ru: 'Бокс', uz: 'Boks' },
    { code: 'martial_arts', en: 'Martial Arts', ru: 'Боевые искусства', uz: 'Jang san’ati' },
    { code: 'horse_riding', en: 'Horse Riding', ru: 'Верховая езда', uz: 'Ot minish' },
    { code: 'bicycle', en: 'Bicycle', ru: 'Велосипед', uz: 'Velosiped' },
    { code: 'skateboarding', en: 'Skateboarding', ru: 'Скейтборд', uz: 'Skeytbord' },
    { code: 'roller_skating', en: 'Roller Skating', ru: 'Ролики', uz: 'Rolik uchish' },
    { code: 'gymnastics', en: 'Gymnastics', ru: 'Гимнастика', uz: 'Gimnastika' },
  ],
}

const fieldToGroup = {
  appearance: 'appearance',
  languageSkills: 'languages',
  performanceTalents: 'performance',
  physicalSkills: 'physical',
  sportsTalents: 'sports',
}

const aliasToCode = new Map()

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('`', "'")
    .replace(/\s+/g, ' ')
}

for (const options of Object.values(talentTaxonomy)) {
  for (const option of options) {
    aliasToCode.set(normalizeText(option.code), option.code)
    aliasToCode.set(normalizeText(option.en), option.code)
    aliasToCode.set(normalizeText(option.ru), option.code)
    aliasToCode.set(normalizeText(option.uz), option.code)
  }
}

export function canonicalTalentValue(value) {
  return aliasToCode.get(normalizeText(value)) ?? String(value ?? '').trim()
}

export function canonicalTalentList(values) {
  const seen = new Set()
  const normalized = []

  for (const value of Array.isArray(values) ? values : values ? [values] : []) {
    const canonical = canonicalTalentValue(value)

    if (!canonical || seen.has(canonical)) {
      continue
    }

    seen.add(canonical)
    normalized.push(canonical)
  }

  return normalized
}

export function talentLabel(value, lang = 'ru') {
  const canonical = canonicalTalentValue(value)

  for (const options of Object.values(talentTaxonomy)) {
    const option = options.find((item) => item.code === canonical)
    if (option) {
      return option[lang] ?? option.ru ?? option.en
    }
  }

  return canonical
}

export function talentOptionsForField(field, lang = 'ru') {
  const group = fieldToGroup[field]

  if (!group) {
    return []
  }

  return talentTaxonomy[group].map((option) => ({
    label: option[lang] ?? option.ru ?? option.en,
    value: option.code,
  }))
}

export function normalizeCandidateTaxonomy(candidate) {
  return {
    ...candidate,
    appearance: canonicalTalentList(candidate.appearance),
    languageSkills: canonicalTalentList(candidate.languageSkills),
    performanceTalents: canonicalTalentList(candidate.performanceTalents),
    physicalSkills: canonicalTalentList(candidate.physicalSkills),
    sportsTalents: canonicalTalentList(candidate.sportsTalents),
  }
}

export function displayCandidateTaxonomy(candidate, lang = 'ru') {
  return {
    ...candidate,
    appearance: canonicalTalentList(candidate.appearance).map((value) => talentLabel(value, lang)),
    languageSkills: canonicalTalentList(candidate.languageSkills).map((value) => talentLabel(value, lang)),
    performanceTalents: canonicalTalentList(candidate.performanceTalents).map((value) => talentLabel(value, lang)),
    physicalSkills: canonicalTalentList(candidate.physicalSkills).map((value) => talentLabel(value, lang)),
    sportsTalents: canonicalTalentList(candidate.sportsTalents).map((value) => talentLabel(value, lang)),
  }
}
