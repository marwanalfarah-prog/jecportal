const ARABIC_BASE_NAME_KEYS = ['ar_first_name', 'ar_second_name', 'ar_third_name', 'ar_last_name']
const ENGLISH_BASE_NAME_KEYS = ['en_first_name', 'en_second_name', 'en_third_name', 'en_last_name']

export function cleanPersonNamePart(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function joinPersonNameParts(values) {
  return values.map(cleanPersonNamePart).filter(Boolean).join(' ')
}

export function getArabicPersonNameParts(person, { includeTitle = true, normalizer = null } = {}) {
  const keys = includeTitle ? ['title', ...ARABIC_BASE_NAME_KEYS] : ARABIC_BASE_NAME_KEYS
  const parts = keys.map((key) => cleanPersonNamePart(person?.[key])).filter(Boolean)
  return typeof normalizer === 'function' ? parts.map(normalizer).filter(Boolean) : parts
}

export function formatArabicPersonName(person, { fallback = '' } = {}) {
  return joinPersonNameParts(getArabicPersonNameParts(person, { includeTitle: true })) || fallback
}

export function formatArabicBasePersonName(person, { fallback = '' } = {}) {
  return joinPersonNameParts(getArabicPersonNameParts(person, { includeTitle: false })) || fallback
}

export function formatEnglishPersonName(person, { title = '', fallback = '' } = {}) {
  const values = [title, ...ENGLISH_BASE_NAME_KEYS.map((key) => person?.[key])]
  return joinPersonNameParts(values) || fallback
}
