import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  ArrowRight, Pencil, Trash2, Plus, Check, Camera, UserX, Download,
  GraduationCap, Briefcase, Heart, Users, Shield,
  Phone, PhoneCall, Globe, School, GitBranch, Archive, ArchiveRestore, MapPin, Mail,
  Facebook, Instagram, Linkedin, ExternalLink
} from 'lucide-react'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { api, getApiErrorMessage } from '../api.js'
import { buildGoogleMapsOpenUrl, parseGoogleMapsUrl, sanitizeStoredCoordinate } from '../location.js'
import { downloadProfilePdf } from '../profilePdf.js'

function GenderChipContent({ gender }) {
  const normalized = String(gender || '').trim()
  const text = normalized || '—'
  let symbol = ''
  let toneClass = ''

  if (normalized === 'ذكر') {
    symbol = '♂'
    toneClass = 'male'
  } else if (normalized === 'انثى') {
    symbol = '♀'
    toneClass = 'female'
  }

  return (
    <>
      {symbol ? (
        <span className={`profile-sub-icon profile-sub-gender-icon ${toneClass}`} aria-hidden="true">
          {symbol}
        </span>
      ) : null}
      <span>{text}</span>
    </>
  )
}

// ── Combo dropdown (searchable + free-text "other") ──────────────────────────
// options: [{ value, count }] sorted by count desc
function ComboDropdown({ value, onChange, options, placeholder = '—', dir = 'rtl', customActionLabel = '＋ أخرى / اكتب يدوياً…', customInputPlaceholder = 'اكتب قيمة…' }) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [custom, setCustom] = useState(false)
  const ref = useRef(null)
  const textAlign = dir === 'ltr' ? 'left' : 'right'
  const safeOptions = Array.isArray(options) ? options : []

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getLabel = (o) => (o?.label || o?.value)
  const selectedOption = safeOptions.find(o => o?.value === value)
  const displayValue = selectedOption ? getLabel(selectedOption) : value
  const filtered = safeOptions.filter(o =>
    getLabel(o) && getLabel(o).toString().toLowerCase().includes(query.toLowerCase())
  )

  const pick = (v) => { onChange(v); setOpen(false); setQuery(''); setCustom(false) }

  // If currently in custom mode, render a plain input
  if (custom) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          autoFocus
          className="combo-input"
          placeholder={customInputPlaceholder}
          defaultValue={value || ''}
          dir={dir}
          style={{ direction: dir, textAlign }}
          onBlur={e => { onChange(e.target.value); setCustom(false) }}
          onKeyDown={e => { if (e.key === 'Enter') { onChange(e.target.value); setCustom(false) } if (e.key === 'Escape') setCustom(false) }}
        />
        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '0.75rem' }}
          onClick={() => setCustom(false)}>✕</button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="combo-trigger" onClick={() => { setOpen(o => !o); setQuery('') }}>
        <span style={{ flex: 1, textAlign, direction: dir, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayValue || <span style={{ color: 'var(--gray-400)' }}>{placeholder}</span>}
        </span>
        <span style={{ color: 'var(--gray-400)', fontSize: '0.7rem', flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div className="combo-dropdown">
          <input
            autoFocus
            className="combo-search"
            placeholder="بحث…"
            value={query}
            dir={dir}
            style={{ direction: dir, textAlign }}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
          />
          <div className="combo-list">
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', color: 'var(--gray-400)', fontSize: '0.82rem', textAlign, direction: dir }}>لا توجد نتائج</div>
            )}
            {filtered.map(o => (
              <button type="button" key={o.value} className={`combo-item${value === o.value ? ' selected' : ''}`}
                style={{ textAlign, direction: dir }}
                onClick={() => pick(o.value)}>
                {getLabel(o)}
              </button>
            ))}
            <button type="button" className="combo-item combo-other"
              style={{ textAlign, direction: dir }}
              onClick={() => { setOpen(false); setQuery(''); setCustom(true) }}>
              {customActionLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Select-only dropdown (no free text) ───────────────────────────────────────
function SelectDropdown({ value, onChange, options, placeholder = '—', dir = 'rtl' }) {
  const textAlign = dir === 'ltr' ? 'left' : 'right'
  const safeOptions = Array.isArray(options) ? options : []
  const normalizedValue = value === null || value === undefined ? '' : String(value)
  return (
    <select
      className="combo-trigger"
      value={normalizedValue}
      onChange={e => onChange(e.target.value)}
      dir={dir}
      style={{ cursor: 'pointer', direction: dir, textAlign }}
    >
      <option value="">{placeholder}</option>
      {safeOptions.map(o => (
        <option key={String(o.value ?? o)} value={String(o.value ?? o)}>{o.label || o.value || o}</option>
      ))}
    </select>
  )
}

// ── Year picker (fromYear → current year) ────────────────────────────────────
function YearPicker({ value, onChange, fromYear = 1960 }) {
  const currentYear = new Date().getFullYear()
  const years = []
  for (let y = currentYear; y >= fromYear; y--) years.push(y)
  const normalizedValue = value === null || value === undefined || value === '' ? '' : String(value)
  return (
    <select
      className="combo-trigger"
      value={normalizedValue}
      onChange={e => onChange(e.target.value)}
      style={{ cursor: 'pointer' }}
    >
      <option value="">—</option>
      {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
    </select>
  )
}

// ── Date picker — stores as "Jun 15" ─────────────────────────────────────────
// Month data: EN short code (stored value), Levantine Arabic name, number
const MONTHS = [
  { en: 'Jan', ar: 'كانون الثاني', num: 1  },
  { en: 'Feb', ar: 'شباط',         num: 2  },
  { en: 'Mar', ar: 'آذار',         num: 3  },
  { en: 'Apr', ar: 'نيسان',        num: 4  },
  { en: 'May', ar: 'أيار',         num: 5  },
  { en: 'Jun', ar: 'حزيران',       num: 6  },
  { en: 'Jul', ar: 'تموز',         num: 7  },
  { en: 'Aug', ar: 'آب',           num: 8  },
  { en: 'Sep', ar: 'أيلول',        num: 9  },
  { en: 'Oct', ar: 'تشرين الأول',  num: 10 },
  { en: 'Nov', ar: 'تشرين الثاني', num: 11 },
  { en: 'Dec', ar: 'كانون الأول',  num: 12 },
]

function normalizeCountryValue(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return 'الأردن'

  const englishKey = text.toLowerCase()
  const arabicKey = text.replace(/[أإآ]/g, 'ا')

  if (
    englishKey === 'jordan'
    || englishKey === 'the hashemite kingdom of jordan'
    || arabicKey === 'الاردن'
    || arabicKey === 'المملكة الاردنية الهاشمية'
  ) {
    return 'الأردن'
  }

  return text
}

function normalizePersonTitles(raw) {
  const entries = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const titles = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const arabicTitle = String(entry.arabic_title || entry.arabic || entry.title || entry.name || '').replace(/\s+/g, ' ').trim()
    const englishTitle = String(entry.english_title || entry.english || '').replace(/\s+/g, ' ').trim()
    if (!arabicTitle || seen.has(arabicTitle)) continue
    seen.add(arabicTitle)
    titles.push({ arabic_title: arabicTitle, english_title: englishTitle })
  }
  return titles
}

function normalizeTitleLookupKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
}

function normalizeSchoolLookupKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/[أإآ]/g, 'ا').toLowerCase()
}

function normalizeSchoolBranches(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  const items = Array.isArray(raw)
    ? raw.map((row) => [row?.school, row?.branches])
    : Object.entries(raw)

  for (const [schoolRaw, branchesRaw] of items) {
    const school = normalizeLooseInput(schoolRaw)
    if (!school) continue

    const source = Array.isArray(branchesRaw) ? branchesRaw : (typeof branchesRaw === 'string' ? [branchesRaw] : [])
    const seen = new Set()
    const branches = []
    for (const item of source) {
      const branch = normalizeLooseInput(item)
      if (!branch || seen.has(branch)) continue
      seen.add(branch)
      branches.push(branch)
    }

    out[school] = branches
  }

  return out
}

function schoolBranchesForName(schoolBranches, schoolName) {
  const school = normalizeLooseInput(schoolName)
  if (!school) return []
  const lookupKey = normalizeSchoolLookupKey(school)
  const entry = Object.entries(normalizeSchoolBranches(schoolBranches)).find(([name]) => normalizeSchoolLookupKey(name) === lookupKey)
  return entry ? entry[1] : []
}

function normalizeSchoolGradeValue(value) {
  return normalizeLooseInput(value)
}

function normalizeSchoolGrades(values) {
  const source = Array.isArray(values)
    ? values
    : String(values || '').split('|')

  const seen = new Set()
  const ordered = []
  for (const option of SCHOOL_GRADE_OPTIONS) {
    const exists = source.some((value) => normalizeSchoolGradeValue(value) === option)
    if (exists && !seen.has(option)) {
      seen.add(option)
      ordered.push(option)
    }
  }

  return ordered
}

function serializeSchoolGrades(values) {
  return normalizeSchoolGrades(values).join('|')
}

function findHighestSchoolGrade(rows) {
  const source = Array.isArray(rows) ? rows : []
  let highestIndex = -1

  source.forEach((row) => {
    normalizeSchoolGrades(row?.grades_attended).forEach((grade) => {
      const gradeIndex = SCHOOL_GRADE_OPTIONS.indexOf(grade)
      if (gradeIndex > highestIndex) highestIndex = gradeIndex
    })
  })

  return highestIndex >= 0 ? SCHOOL_GRADE_OPTIONS[highestIndex] : ''
}

function sanitizeDateInput(value) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeSchoolRows(rows, { dropEmpty = false, graduatedFromSchools = false } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const normalized = source
    .map((row) => ({
      school_record_id: normalizeLooseInput(row?.school_record_id),
      school: normalizeLooseInput(row?.school ?? row?.school_name),
      section: normalizeLooseInput(row?.section ?? row?.institution_section),
      start_date: sanitizeDateInput(row?.start_date),
      end_date: sanitizeDateInput(row?.end_date),
      is_current: row?.is_current === undefined || row?.is_current === null || row?.is_current === ''
        ? !sanitizeDateInput(row?.end_date)
        : toBoolDefaultFalse(row?.is_current),
      grades_attended: normalizeSchoolGrades(row?.grades_attended),
    }))
    .map((row) => ({
      ...row,
      end_date: row.is_current ? '' : row.end_date,
      is_current: graduatedFromSchools ? false : row.is_current,
    }))
    .filter((row) => (dropEmpty ? row.school : true))

  const activeIndexes = normalized
    .map((row, index) => (row.is_current ? index : -1))
    .filter((index) => index >= 0)

  if (activeIndexes.length > 1) {
    const keepIndex = activeIndexes[activeIndexes.length - 1]
    normalized.forEach((row, index) => {
      if (index !== keepIndex) row.is_current = false
    })
  }

  return dropEmpty
    ? normalized.map((row) => ({
        ...row,
      school_record_id: row.school_record_id || null,
        grades_attended: serializeSchoolGrades(row.grades_attended),
        section: row.section || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
      }))
    : normalized
}

const HIGHER_EDUCATION_STATE_OPTIONS = [
  { value: 'current', label: 'حاليًّا' },
  { value: 'switched', label: 'حوّل التخصّص أو الجامعة / الكليّة' },
  { value: 'exited', label: 'منسحب' },
  { value: 'graduated', label: 'متخرّج' },
]

function normalizeHigherEducationStateValue(value, { isCurrent = false } = {}) {
  const text = normalizeLooseInput(value)
  if (!text) return isCurrent ? 'current' : ''

  const lookup = text.toLowerCase()
  if (lookup === 'current' || text === 'حاليًّا' || text === 'حاليا' || text === 'حالي') return 'current'
  if (lookup === 'switched' || lookup === 'switched major|university' || lookup === 'switched major/university' || text === 'حوّل التخصّص أو الجامعة / الكليّة' || text === 'حوّل التخصص أو الجامعة / الكلية') return 'switched'
  if (lookup === 'exited' || text === 'منسحب' || text === 'انسحب') return 'exited'
  if (lookup === 'graduated' || text === 'متخرّج' || text === 'متخرج') return 'graduated'

  return text
}

function higherEducationStateLabel(value) {
  const normalized = normalizeHigherEducationStateValue(value)
  const match = HIGHER_EDUCATION_STATE_OPTIONS.find((option) => option.value === normalized)
  return match?.label || normalized
}

function normalizeHigherEducationRows(rows, { dropEmpty = false } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const normalized = source
    .map((row) => {
      const startDate = sanitizeDateInput(row?.start_date)
      const rawCurrent = row?.is_current === undefined || row?.is_current === null || row?.is_current === ''
        ? !sanitizeDateInput(row?.end_date)
        : toBoolDefaultFalse(row?.is_current)
      const state = normalizeHigherEducationStateValue(row?.state ?? row?.education_state, { isCurrent: rawCurrent })
      const isCurrent = state === 'switched'
        ? false
        : state === 'current'
          ? true
          : rawCurrent

      return {
        university_college: normalizeLooseInput(row?.university_college ?? row?.institution_name),
        major: normalizeLooseInput(row?.major),
        degree: normalizeLooseInput(row?.degree),
        start_date: startDate,
        end_date: isCurrent ? '' : sanitizeDateInput(row?.end_date),
        is_current: isCurrent,
        state,
        final_gpa: (state === 'current' || state === 'graduated') ? normalizeFinalGpaValue(row?.final_gpa) : '',
      }
    })
    .filter((row) => (dropEmpty ? (row.university_college || row.major || row.degree || row.start_date || row.end_date || row.state || row.final_gpa) : true))

  return dropEmpty
    ? normalized.map((row) => ({
        university_college: row.university_college || null,
        major: row.major || null,
        degree: row.degree || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        state: row.state || null,
        final_gpa: row.state === 'current' || row.state === 'graduated' ? row.final_gpa || null : null,
      }))
    : normalized
}

const JOB_STATE_OPTIONS = [
  { value: 'current', label: 'حاليًّا' },
  { value: 'previous', label: 'سابق' },
]

function normalizeJobStateValue(value, { isCurrent = false } = {}) {
  const text = normalizeLooseInput(value)
  if (!text) return isCurrent ? 'current' : 'previous'

  const lookup = text.toLowerCase()
  if (lookup === 'current' || text === 'حاليًّا' || text === 'حاليا' || text === 'حالي') return 'current'
  if (lookup === 'previous' || text === 'سابق') return 'previous'

  return text
}

function jobStateLabel(value) {
  const normalized = normalizeJobStateValue(value)
  const match = JOB_STATE_OPTIONS.find((option) => option.value === normalized)
  return match?.label || normalized
}

function normalizeJobRows(rows, { dropEmpty = false } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const normalized = source
    .map((row) => {
      const startDate = sanitizeDateInput(row?.start_date)
      const rawCurrent = row?.is_current === undefined || row?.is_current === null || row?.is_current === ''
        ? !sanitizeDateInput(row?.end_date)
        : toBoolDefaultFalse(row?.is_current)
      const state = normalizeJobStateValue(row?.state ?? row?.employment_state, { isCurrent: rawCurrent })
      const isCurrent = state === 'current'

      return {
        job_id: normalizeLooseInput(row?.job_id) || createLocalId('job'),
        job_title: normalizeLooseInput(row?.job_title),
        company: normalizeLooseInput(row?.company ?? row?.employer_name),
        start_date: startDate,
        end_date: isCurrent ? '' : sanitizeDateInput(row?.end_date),
        is_current: isCurrent,
        state,
      }
    })
    .filter((row) => (dropEmpty ? (row.job_title || row.company || row.start_date || row.end_date || row.state) : true))

  return dropEmpty
    ? normalized.map((row) => ({
        job_id: row.job_id,
        job_title: row.job_title || null,
        company: row.company || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        state: row.state || null,
      }))
    : normalized
}

function normalizeActiveJecYearValue(value) {
  const text = normalizeLooseInput(value)
  return /^\d{4}$/.test(text) ? text : ''
}

function normalizeResponsibilityRows(rows, { dropEmpty = false, activeJecYear = '' } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const normalizedActiveJecYear = normalizeActiveJecYearValue(activeJecYear)
  const normalized = source
    .map((row) => {
      const legacyPeriod = normalizeLooseInput(row?.time ?? row?.responsibility_period)
      const rawYear = normalizeLooseInput(row?.jec_year)
      const jecYear = /^\d{4}$/.test(rawYear)
        ? rawYear
        : (/^\d{4}$/.test(legacyPeriod) ? legacyPeriod : '')
      const rawIsCurrent = row?.is_current ?? row?.is_active
      const baseIsCurrent = rawIsCurrent === true || rawIsCurrent === 'true' || rawIsCurrent === 1 || rawIsCurrent === '1'
        ? true
        : rawIsCurrent === false || rawIsCurrent === 'false' || rawIsCurrent === 0 || rawIsCurrent === '0'
          ? false
          : (legacyPeriod === 'حاليًّا' || legacyPeriod === 'حاليًا' || legacyPeriod === 'حالي')
      const isCurrent = normalizedActiveJecYear && jecYear && jecYear < normalizedActiveJecYear
        ? false
        : baseIsCurrent

      return {
        youth_group_id: normalizeLooseInput(row?.youth_group_id),
        jec_year: jecYear,
        is_current: isCurrent,
        responsibility: normalizeLooseInput(row?.responsibility ?? row?.responsibility_name),
        start_date: sanitizeDateInput(row?.start_date),
        end_date: sanitizeDateInput(row?.end_date),
      }
    })
    .filter((row) => (dropEmpty ? (row.youth_group_id || row.jec_year || row.responsibility || row.start_date || row.end_date || row.is_current) : true))

  return dropEmpty
    ? normalized.map((row) => ({
        youth_group_id: row.youth_group_id || null,
        jec_year: row.jec_year ? parseInt(row.jec_year, 10) : null,
        is_current: row.is_current === 'true' ? true : row.is_current === 'false' ? false : Boolean(row.is_current),
        responsibility: row.responsibility || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
      }))
    : normalized
}

const RESPONSIBILITY_CURRENT_OPTIONS = [
  { value: 'true', label: 'حاليًّا' },
  { value: 'false', label: 'سابقًا' },
]

function responsibilityCurrentLabel(value) {
  return value ? 'حاليًّا' : 'سابقًا'
}

function jobRowLabel(row, index = null) {
  const jobTitle = normalizeLooseInput(row?.job_title)
  const company = normalizeLooseInput(row?.company)
  if (jobTitle && company) return `${company} - ${jobTitle}`
  if (jobTitle) return jobTitle
  if (company) return company
  return index === null ? 'سجل العمل' : `سجل العمل ${index + 1}`
}

function extractJobOptions(rows) {
  const seen = new Set()
  return normalizeJobRows(rows)
    .map((row, index) => ({ value: row.job_id, label: jobRowLabel(row, index) }))
    .filter((option) => {
      if (!option.value || seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
}

function normalizeEmailType(value) {
  const text = normalizeLooseInput(value)
  if (!text) return 'personal'
  const lookup = text.toLowerCase()
  if (lookup === 'personal' || text === 'شخصي') return 'personal'
  if (lookup === 'work' || text === 'عمل') return 'work'
  if (lookup === 'family' || text === 'فرد من العائلة') return 'family'
  if (lookup.startsWith('family:')) return 'family'
  return text
}

function normalizeEmailFamilyRelationValue(value) {
  return normalizeFamilyRelationValue(value)
}

function extractLegacyEmailFamilyRelation(value) {
  const text = String(value ?? '').trim()
  if (!text.toLowerCase().startsWith('family:')) return ''
  return text.slice('family:'.length).replace(/\s+/g, ' ').trim()
}

function parseEmailTypeMeta(typeValue, familyRelationValue = '') {
  const normalizedFamilyRelation = normalizeEmailFamilyRelationValue(familyRelationValue) || extractLegacyEmailFamilyRelation(typeValue)
  const normalized = normalizedFamilyRelation ? 'family' : normalizeEmailType(typeValue)
  if (normalized === 'family') {
    return {
      normalized,
      familyRelation: normalizedFamilyRelation,
    }
  }
  return {
    normalized,
    familyRelation: '',
  }
}

function emailTypeLabel(value, familyRelationValue = '') {
  const { normalized, familyRelation } = parseEmailTypeMeta(value, familyRelationValue)
  if (normalized === 'personal') return 'شخصي'
  if (normalized === 'work') return 'عمل'
  if (normalized === 'family') return familyRelation ? `بريد ${familyRelation}` : 'بريد فرد من العائلة'
  return normalized
}

function normalizeSocialPlatform(value) {
  const text = normalizeLooseInput(value).toLowerCase()
  if (!text) return 'facebook'
  if (text === 'facebook' || text === 'instagram' || text === 'linkedin') return text
  return 'facebook'
}

function socialPlatformLabel(value) {
  const normalized = normalizeSocialPlatform(value)
  if (normalized === 'facebook') return 'Facebook'
  if (normalized === 'instagram') return 'Instagram'
  if (normalized === 'linkedin') return 'LinkedIn'
  return normalized
}

function socialPlatformIcon(value, size = 16) {
  const normalized = normalizeSocialPlatform(value)
  if (normalized === 'facebook') return <Facebook size={size} />
  if (normalized === 'instagram') return <Instagram size={size} />
  return <Linkedin size={size} />
}

function socialPlatformTheme(value) {
  const normalized = normalizeSocialPlatform(value)

  if (normalized === 'facebook') {
    return {
      iconBackground: '#1877F2',
      iconColor: '#ffffff',
      cardBackground: 'rgba(24, 119, 242, 0.08)',
      cardBorder: 'rgba(24, 119, 242, 0.18)',
      cardShadow: 'rgba(24, 119, 242, 0.14)',
      accent: '#1877F2',
      accentSoft: 'rgba(24, 119, 242, 0.12)',
    }
  }

  if (normalized === 'instagram') {
    return {
      iconBackground: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 52%, #8134af 78%, #515bd4 100%)',
      iconColor: '#ffffff',
      cardBackground: 'linear-gradient(135deg, rgba(245, 133, 41, 0.10) 0%, rgba(221, 42, 123, 0.08) 50%, rgba(81, 91, 212, 0.08) 100%)',
      cardBorder: 'rgba(221, 42, 123, 0.16)',
      cardShadow: 'rgba(221, 42, 123, 0.14)',
      accent: '#c13584',
      accentSoft: 'rgba(221, 42, 123, 0.12)',
    }
  }

  return {
    iconBackground: '#0A66C2',
    iconColor: '#ffffff',
    cardBackground: 'rgba(10, 102, 194, 0.08)',
    cardBorder: 'rgba(10, 102, 194, 0.18)',
    cardShadow: 'rgba(10, 102, 194, 0.14)',
    accent: '#0A66C2',
    accentSoft: 'rgba(10, 102, 194, 0.12)',
  }
}

function normalizeSocialUrl(value) {
  return normalizeLooseInput(value)
}

function buildSocialProfileUrl(value) {
  const text = normalizeSocialUrl(value)
  if (!text) return ''
  return /^https?:\/\//i.test(text) ? text : `https://${text}`
}

function socialPlatformCompactText(platform, value) {
  const href = buildSocialProfileUrl(value)
  if (!href) return '—'

  try {
    const parsed = new URL(href)
    const host = parsed.hostname.replace(/^www\./i, '')
    const parts = parsed.pathname.split('/').filter(Boolean)

    if (parts.length) {
      const handle = decodeURIComponent(parts[parts.length - 1]).replace(/^@+/, '').trim()
      if (handle) return `@${handle}`
    }

    return host
  } catch {
    return normalizeSocialUrl(value) || '—'
  }
}

function normalizeSocialMediaRows(rows, { dropEmpty = false } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const normalized = source
    .map((row) => ({
      platform: normalizeSocialPlatform(row?.platform),
      url: normalizeSocialUrl(row?.url),
      is_primary: toBoolDefaultFalse(row?.is_primary),
    }))
    .filter((row) => (dropEmpty ? row.url : true))

  const grouped = new Map()
  normalized.forEach((row, index) => {
    const key = row.platform
    const entries = grouped.get(key) || []
    entries.push({ row, index })
    grouped.set(key, entries)
  })

  const nextRows = [...normalized]
  grouped.forEach((entries) => {
    const primaryIndex = entries.findIndex((entry) => entry.row.is_primary)
    entries.forEach((entry, entryIndex) => {
      nextRows[entry.index] = {
        ...entry.row,
        is_primary: entries.length === 1 ? true : (primaryIndex >= 0 ? entryIndex === primaryIndex : false),
      }
    })
  })

  return nextRows
}

function countPersonalMobileRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.type === 'personal').length
}

function countPersonalEmailRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.type === 'personal').length
}

function countSocialPlatformRows(rows, platform) {
  const normalizedPlatform = normalizeSocialPlatform(platform)
  return (Array.isArray(rows) ? rows : []).filter((row) => normalizeSocialPlatform(row?.platform) === normalizedPlatform).length
}

function serializeSocialMediaRows(rows) {
  return normalizeSocialMediaRows(rows, { dropEmpty: true })
}

function parseLinkedJobIds(value) {
  const raw = Array.isArray(value)
    ? value
    : (() => {
        const text = String(value || '').trim()
        if (!text) return []
        try {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed)) return parsed
          return parsed ? [parsed] : []
        } catch {
          return text.split(/\s*[|,]\s*/)
        }
      })()

  const seen = new Set()
  return raw
    .map((item) => normalizeLooseInput(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function normalizeEmailRows(rows, { dropEmpty = false, validJobIds = null } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const validJobIdSet = validJobIds ? new Set(validJobIds.map((value) => String(value).trim()).filter(Boolean)) : null
  const normalized = source
    .map((row) => {
      const typeMeta = parseEmailTypeMeta(row?.type, row?.family_relation)
      const parsedLinkedJobIds = parseLinkedJobIds(row?.linked_job_ids)
        .filter((jobId) => !validJobIdSet || validJobIdSet.has(jobId))
      const type = typeMeta.normalized === 'family'
        ? 'family'
        : (parsedLinkedJobIds.length > 0 ? 'work' : typeMeta.normalized)
      const linkedJobIds = type === 'work' ? parsedLinkedJobIds : []
      const familyRelation = type === 'family' ? typeMeta.familyRelation : ''

      return {
        email_record_id: normalizeLooseInput(row?.email_record_id) || createLocalId('email'),
        email: normalizeLooseInput(row?.email),
        type,
        family_relation: familyRelation,
        is_primary: type === 'personal' ? toBoolDefaultFalse(row?.is_primary) : false,
        linked_job_ids: linkedJobIds,
      }
    })
    .filter((row) => (dropEmpty ? row.email : true))

  const personalRows = normalized
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.type === 'personal')
  const winner = personalRows.findIndex(({ row }) => row.is_primary)

  return normalized.map((row, index) => {
    if (row.type !== 'personal') return { ...row, is_primary: false }
    const personalIndex = personalRows.findIndex((entry) => entry.index === index)
    return {
      ...row,
      is_primary: personalRows.length === 1 ? true : (winner >= 0 ? personalIndex === winner : false),
    }
  })
}

function serializeEmailRows(rows, { validJobIds = null } = {}) {
  return normalizeEmailRows(rows, { dropEmpty: true, validJobIds }).map((row) => ({
    email_record_id: row.email_record_id,
    email: row.email,
    type: row.type,
    family_relation: row.type === 'family' && row.family_relation ? row.family_relation : null,
    is_primary: row.is_primary,
    linked_job_ids: row.type === 'work' && row.linked_job_ids.length ? JSON.stringify(row.linked_job_ids) : null,
  }))
}

const DEFAULT_ADDRESS_ROW = { country: 'الأردن', governorate: '', city: '', address: '', location_url: '', lat: null, lng: null, is_primary: true }
const DEFAULT_MOBILE_NUMBER_ROW = { mobile_number_record_id: '', mobile_number: '', type: 'personal', family_relation: '', is_primary: false, phone_calls_flag: true, whatsapp_flag: true, linked_job_ids: [] }
const DEFAULT_EMAIL_ROW = { email_record_id: '', email: '', type: 'personal', family_relation: '', is_primary: false, linked_job_ids: [] }
const DEFAULT_SOCIAL_MEDIA_ROW = { platform: 'facebook', url: '', is_primary: false }
const NATIONALITY_JORDANIAN = 'أردنيّة'
const NATIONALITY_CHILDREN_OF_JORDANIAN_MOTHERS = 'أبناء الأردنيّات'
const PHONE_NUMBER_TYPE_OPTIONS = [
  { value: 'personal', label: 'شخصي' },
  { value: 'work', label: 'عمل' },
  { value: 'home', label: 'منزل' },
  { value: 'family', label: 'فرد من العائلة' },
]
const PHONE_NUMBER_FAMILY_RELATION_OPTIONS = [
  { value: 'الأب', label: 'الأب' },
  { value: 'الأم', label: 'الأم' },
  { value: 'الأخ', label: 'الأخ' },
  { value: 'الأخت', label: 'الأخت' },
  { value: 'الجد', label: 'الجد' },
  { value: 'الجدة', label: 'الجدة' },
  { value: 'العم', label: 'العم' },
  { value: 'العمة', label: 'العمة' },
  { value: 'الخال', label: 'الخال' },
  { value: 'الخالة', label: 'الخالة' },
]
const EMAIL_TYPE_OPTIONS = [
  { value: 'personal', label: 'شخصي' },
  { value: 'work', label: 'عمل' },
  { value: 'family', label: 'فرد من العائلة' },
]
const SOCIAL_MEDIA_PLATFORM_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
]
const SCHOOL_GRADE_OPTIONS = [
  'الروضة الصغرى (KG1)',
  'الروضة الكبرى (KG2)',
  'الصف الأول',
  'الصف الثاني',
  'الصف الثالث',
  'الصف الرابع',
  'الصف الخامس',
  'الصف السادس',
  'الصف السابع',
  'الصف الثامن',
  'الصف التاسع',
  'الصف العاشر',
  'الصف الحادي عشر (الأول ثانوي)',
  'الصف الثاني عشر (التوجيهي)',
]
const DEFAULT_SCHOOL_SYSTEM = 'النظام الوطني الأردني'
const SCHOOL_SYSTEM_OPTIONS = [DEFAULT_SCHOOL_SYSTEM, 'IGCSE', 'IB', 'SAT']
const JORDAN_SCHOOL_SYSTEM_SECTOR_TYPE_OPTIONS = ['الفرع', 'الحقل']
const JORDAN_SCHOOL_SYSTEM_BRANCH_OPTIONS = {
  'المسار الأكاديمي': ['العلمي', 'الأدبي', 'الإدارة المعلوماتية', 'الشرعي'],
  'المسار المهني': ['الصناعي', 'الزراعي', 'الفندقي والسياحي', 'الاقتصاد المنزلي'],
}
const JORDAN_SCHOOL_SYSTEM_FIELD_OPTIONS = [
  'الحقل الصحي',
  'الحقل الهندسي',
  'حقل العلوم والتكنولوجيا',
  'حقل اللغات والعلوم الاجتماعية',
  'حقل القانون والعلوم الشرعية',
  'حقل الأعمال',
]

function normalizeSchoolSystemValue(value) {
  const text = normalizeLooseInput(value)
  if (text === 'وطني') return DEFAULT_SCHOOL_SYSTEM
  return text
}

function normalizeFinalGpaValue(value) {
  return normalizeLooseInput(value)
}

function formatSchoolGpaDisplay(value) {
  const normalized = normalizeFinalGpaValue(value)
  if (!normalized) return ''
  return normalized.includes('%') ? normalized : `${normalized}%`
}

function formatUniversityGpaDisplay(value) {
  const normalized = normalizeFinalGpaValue(value)
  if (!normalized) return ''
  return /\/\s*4$/.test(normalized) ? normalized.replace(/\/\s*4$/, '/4') : `${normalized}/4`
}

function storedSchoolSystemValue(value) {
  return normalizeSchoolSystemValue(value) || DEFAULT_SCHOOL_SYSTEM
}

function buildSchoolSystemOptions(values = [], currentValue = '') {
  const seen = new Set()
  const ordered = []

  for (const source of [...SCHOOL_SYSTEM_OPTIONS, ...values, currentValue]) {
    const option = normalizeSchoolSystemValue(source)
    if (!option || seen.has(option)) continue
    seen.add(option)
    ordered.push(option)
  }

  return ordered
}

function inferJordanSchoolSystemSectorPath(value) {
  const finalPick = normalizeLooseInput(value)
  if (!finalPick) return { type: '', branch: '', finalPick: '' }

  for (const [branch, options] of Object.entries(JORDAN_SCHOOL_SYSTEM_BRANCH_OPTIONS)) {
    if (options.includes(finalPick)) {
      return { type: 'الفرع', branch, finalPick }
    }
  }

  if (JORDAN_SCHOOL_SYSTEM_FIELD_OPTIONS.includes(finalPick)) {
    return { type: 'الحقل', branch: '', finalPick }
  }

  return { type: '', branch: '', finalPick }
}

function schoolSystemDisplayLabel(system, sector) {
  const normalizedSystem = normalizeSchoolSystemValue(system) || DEFAULT_SCHOOL_SYSTEM
  const normalizedSector = normalizeLooseInput(sector)
  return normalizedSector ? `${normalizedSystem} - ${normalizedSector}` : normalizedSystem
}

function preserveLooseInput(value) {
  return String(value ?? '')
}

function normalizeLooseInput(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

const PERSON_HEALTH_TYPE_OPTIONS = [
  { value: 'illness', label: 'الحالات الصحية' },
  { value: 'allergy', label: 'حساسية' },
  { value: 'surgery', label: 'العمليات الجراجية' },
]

function normalizePersonHealthConditionType(value) {
  const text = normalizeLooseInput(value)
  if (!text) return ''
  const lookup = text.toLowerCase().replace(/_/g, '-')
  if (lookup === 'illness' || lookup === 'illnesses' || lookup === 'health-condition' || lookup === 'health-conditions' || lookup === 'health condition' || lookup === 'health conditions' || text === 'مرض' || text === 'أمراض' || text === 'امراض' || text === 'الحالة الصحية' || text === 'الحالات الصحية') return 'illness'
  if (lookup === 'allergy' || lookup === 'allergies' || text === 'حساسية' || text === 'حساسيات' || text === 'حساسيه') return 'allergy'
  if (lookup === 'surgery' || lookup === 'surgeries' || lookup === 'operation' || lookup === 'operations' || text === 'عملية' || text === 'عمليات' || text === 'العمليات الجراحية' || text === 'العمليات الجراجية') return 'surgery'
  return ''
}

function personHealthConditionTypeLabel(value) {
  const normalized = normalizePersonHealthConditionType(value)
  if (normalized === 'illness') return 'الحالات الصحية'
  if (normalized === 'allergy') return 'حساسية'
  if (normalized === 'surgery') return 'العمليات الجراجية'
  return ''
}

function normalizePersonHealthConditionRows(rows, { dropEmpty = false } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const normalized = []

  source.forEach((row) => {
    const conditionType = normalizePersonHealthConditionType(row?.type ?? row?.condition_type)
    const nextRow = {
      type: conditionType,
      condition_type: conditionType,
      details: normalizeLooseInput(row?.details),
    }
    if (!nextRow.type || !nextRow.details) {
      if (!dropEmpty) normalized.push(nextRow)
      return
    }

    const dedupeKey = `${nextRow.type}::${nextRow.details}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    normalized.push(nextRow)
  })

  return normalized
}

function normalizePersonSpecialNoteRows(rows) {
  const source = Array.isArray(rows) ? rows : []
  return source.map((row) => ({
    note_title: String(row?.note_title ?? ''),
    note: String(row?.note ?? '').replace(/\r\n/g, '\n'),
  }))
}

function serializePersonSpecialNoteRows(rows, { dropEmpty = false } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const normalized = []

  source.forEach((row) => {
    const nextRow = {
      note_title: String(row?.note_title ?? '').trim(),
      note: String(row?.note ?? '').replace(/\r\n/g, '\n').trim(),
    }
    if (!nextRow.note_title || !nextRow.note) {
      if (!dropEmpty) normalized.push(nextRow)
      return
    }

    const dedupeKey = `${nextRow.note_title}::${nextRow.note}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    normalized.push(nextRow)
  })

  return normalized
}

function SpecialNotesEditor({ rows, onChange }) {
  const normalizedRows = normalizePersonSpecialNoteRows(rows)

  const commit = (nextRows) => onChange(normalizePersonSpecialNoteRows(nextRows))
  const updateRow = (index, key, value) => {
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [key]: value } : row
    )))
  }
  const addRow = () => commit([...normalizedRows, { note_title: '', note: '' }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => (
        <div key={`special-note-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.note_title || 'ملاحظة خاصة'}</div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
              حذف
            </button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>عنوان الملاحظة</span>
              <input
                className="combo-input"
                value={row.note_title || ''}
                onChange={(event) => updateRow(index, 'note_title', event.target.value)}
                placeholder="عنوان مختصر للملاحظة"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>نص الملاحظة</span>
              <textarea
                className="combo-input"
                value={row.note || ''}
                onChange={(event) => updateRow(index, 'note', event.target.value)}
                placeholder="اكتب الملاحظة هنا"
                rows={5}
                style={{ resize: 'vertical', minHeight: 120 }}
              />
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة ملاحظة خاصة</button>
    </div>
  )
}

function normalizeNationalityValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeNationalityLookupKey(value) {
  return normalizeNationalityValue(value).replace(/[أإآ]/g, 'ا').toLowerCase()
}

function normalizeIsoAlpha2(value) {
  const text = String(value || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(text) ? text : ''
}

function normalizeNationalityIsoLookup(entries) {
  const source = Array.isArray(entries) ? entries : []
  const lookup = new Map()

  source.forEach((entry) => {
    const nationality = normalizeNationalityValue(entry?.nationality)
    const isoAlpha2 = normalizeIsoAlpha2(entry?.iso_alpha2)
    if (!nationality || !isoAlpha2) return
    lookup.set(normalizeNationalityLookupKey(nationality), isoAlpha2)
  })

  return lookup
}

function resolveNationalityIsoAlpha2(nationality, isoAlpha2, lookup = null) {
  const normalizedIsoAlpha2 = normalizeIsoAlpha2(isoAlpha2)
  if (normalizedIsoAlpha2) return normalizedIsoAlpha2
  const normalizedNationality = normalizeNationalityValue(nationality)
  if (!normalizedNationality || !(lookup instanceof Map)) return ''
  return normalizeIsoAlpha2(lookup.get(normalizeNationalityLookupKey(normalizedNationality)))
}

function flagEmojiFromIsoAlpha2(value) {
  const isoAlpha2 = normalizeIsoAlpha2(value)
  if (!isoAlpha2) return ''
  return String.fromCodePoint(...Array.from(isoAlpha2).map((char) => 127397 + char.charCodeAt(0)))
}

function renderNationalityLabel(row, { fallbackIcon = '', gap = 6 } = {}) {
  const nationality = normalizeNationalityValue(row?.nationality)
  if (!nationality) return '—'

  const flag = flagEmojiFromIsoAlpha2(row?.iso_alpha2)
  const flagAssetUrl = emojiAssetUrlFromEmoji(flag)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, direction: 'rtl' }}>
      {flagAssetUrl ? (
        <img
          src={flagAssetUrl}
          alt={nationality}
          title={nationality}
          width="20"
          height="20"
          style={{ width: 20, height: 20, flexShrink: 0 }}
        />
      ) : (fallbackIcon ? <span aria-hidden="true">{fallbackIcon}</span> : null)}
      <span>{nationality}</span>
    </span>
  )
}

function isJordanianNationality(value) {
  return normalizeNationalityLookupKey(value) === normalizeNationalityLookupKey(NATIONALITY_JORDANIAN)
}

function isChildrenOfJordanianMothersNationality(value) {
  return normalizeNationalityLookupKey(value) === normalizeNationalityLookupKey(NATIONALITY_CHILDREN_OF_JORDANIAN_MOTHERS)
}

function normalizeNationalityRows(rows, { dropEmpty = false, lookup = null } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const normalized = []

  for (const row of source) {
    const nationality = normalizeNationalityValue(row?.nationality)
    if (!nationality) continue

    const lookupKey = normalizeNationalityLookupKey(nationality)
    if (seen.has(lookupKey)) continue
    seen.add(lookupKey)

    normalized.push({
      nationality,
      iso_alpha2: resolveNationalityIsoAlpha2(nationality, row?.iso_alpha2, lookup),
    })
  }

  return dropEmpty ? normalized.filter((row) => row.nationality) : normalized
}

function serializeNationalityRows(rows, { dropEmpty = false } = {}) {
  return normalizeNationalityRows(rows, { dropEmpty }).map((row) => ({
    nationality: row.nationality,
  }))
}

function getNationalitySelectionError(rows, candidate) {
  const nationality = normalizeNationalityValue(candidate)
  if (!nationality) return 'يرجى إدخال الجنسية أولاً'

  const normalizedRows = normalizeNationalityRows(rows)
  if (normalizedRows.some((row) => normalizeNationalityLookupKey(row.nationality) === normalizeNationalityLookupKey(nationality))) {
    return 'هذه الجنسية مضافة بالفعل'
  }

  const hasJordanian = normalizedRows.some((row) => isJordanianNationality(row.nationality))
  const hasChildren = normalizedRows.some((row) => isChildrenOfJordanianMothersNationality(row.nationality))

  if (isJordanianNationality(nationality) && hasChildren) {
    return 'لا يمكن اختيار الجنسية الأردنيّة مع أبناء الأردنيّات'
  }

  if (isChildrenOfJordanianMothersNationality(nationality) && hasJordanian) {
    return 'لا يمكن اختيار أبناء الأردنيّات مع الجنسية الأردنيّة'
  }

  return ''
}

function normalizeMobileNumberValue(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.endsWith('.0') && /^[-+()\s\d.]+$/.test(text) ? text.slice(0, -2) : text
}

function normalizeMobileNumberType(value) {
  const text = String(value ?? '').trim()
  if (!text) return 'personal'
  if (text.toLowerCase().startsWith('family:')) {
    return 'family'
  }
  const known = PHONE_NUMBER_TYPE_OPTIONS.find(option => option.value.toLowerCase() === text.toLowerCase())
  return known ? known.value : text
}

function extractLegacyFamilyRelation(value) {
  const text = String(value ?? '').trim()
  if (!text.toLowerCase().startsWith('family:')) return ''
  return text.slice('family:'.length).replace(/\s+/g, ' ').trim()
}

function normalizeFamilyRelationValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function parseMobileNumberTypeMeta(typeValue, familyRelationValue = '') {
  const normalizedFamilyRelation = normalizeFamilyRelationValue(familyRelationValue) || extractLegacyFamilyRelation(typeValue)
  const normalized = normalizedFamilyRelation ? 'family' : normalizeMobileNumberType(typeValue)
  if (normalized === 'family') {
    return {
      normalized,
      selectorValue: 'family',
      baseType: 'family',
      familyRelation: normalizedFamilyRelation,
      isCustom: false,
    }
  }

  const known = PHONE_NUMBER_TYPE_OPTIONS.find(option => option.value === normalized)
  if (known) {
    return {
      normalized,
      selectorValue: normalized,
      baseType: normalized,
      familyRelation: '',
      isCustom: false,
    }
  }

  return {
    normalized,
    selectorValue: normalized,
    baseType: normalized,
    familyRelation: '',
    isCustom: true,
  }
}

function phoneNumberTypeLabel(value, familyRelationValue = '') {
  const { normalized, baseType, familyRelation } = parseMobileNumberTypeMeta(value, familyRelationValue)
  const labelMap = {
    personal: 'الهاتف الشخصي',
    work: 'هاتف العمل',
    home: 'هاتف المنزل',
    family: familyRelation ? `رقم هاتف ${familyRelation}` : 'رقم هاتف فرد من العائلة',
    other: 'هاتف آخر',
  }
  if (labelMap[baseType]) return labelMap[baseType]
  return normalized ? `رقم هاتف ${normalized}` : ''
}

const PHONE_COUNTRY_DIAL_CODES = [
  { code: '971', iso: 'AE', name: 'الإمارات' },
  { code: '970', iso: 'PS', name: 'فلسطين' },
  { code: '968', iso: 'OM', name: 'عُمان' },
  { code: '967', iso: 'YE', name: 'اليمن' },
  { code: '966', iso: 'SA', name: 'السعودية' },
  { code: '965', iso: 'KW', name: 'الكويت' },
  { code: '964', iso: 'IQ', name: 'العراق' },
  { code: '963', iso: 'SY', name: 'سوريا' },
  { code: '962', iso: 'JO', name: 'الأردن' },
  { code: '961', iso: 'LB', name: 'لبنان' },
  { code: '974', iso: 'QA', name: 'قطر' },
  { code: '973', iso: 'BH', name: 'البحرين' },
  { code: '972', iso: 'IL', name: 'إسرائيل' },
  { code: '971', iso: 'AE', name: 'الإمارات' },
  { code: '970', iso: 'PS', name: 'فلسطين' },
  { code: '994', iso: 'AZ', name: 'أذربيجان' },
  { code: '995', iso: 'GE', name: 'جورجيا' },
  { code: '996', iso: 'KG', name: 'قيرغيزستان' },
  { code: '998', iso: 'UZ', name: 'أوزبكستان' },
  { code: '995', iso: 'GE', name: 'جورجيا' },
  { code: '90', iso: 'TR', name: 'تركيا' },
  { code: '49', iso: 'DE', name: 'ألمانيا' },
  { code: '44', iso: 'GB', name: 'المملكة المتحدة' },
  { code: '43', iso: 'AT', name: 'النمسا' },
  { code: '41', iso: 'CH', name: 'سويسرا' },
  { code: '39', iso: 'IT', name: 'إيطاليا' },
  { code: '34', iso: 'ES', name: 'إسبانيا' },
  { code: '33', iso: 'FR', name: 'فرنسا' },
  { code: '32', iso: 'BE', name: 'بلجيكا' },
  { code: '31', iso: 'NL', name: 'هولندا' },
  { code: '47', iso: 'NO', name: 'النرويج' },
  { code: '46', iso: 'SE', name: 'السويد' },
  { code: '45', iso: 'DK', name: 'الدنمارك' },
  { code: '30', iso: 'GR', name: 'اليونان' },
  { code: '27', iso: 'ZA', name: 'جنوب أفريقيا' },
  { code: '20', iso: 'EG', name: 'مصر' },
  { code: '1', iso: 'US', name: 'الولايات المتحدة' },
]

function flagEmojiFromIsoCode(isoCode) {
  const code = String(isoCode || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...code.split('').map((char) => 127397 + char.charCodeAt(0)))
}

function emojiAssetUrlFromEmoji(emoji) {
  const text = String(emoji || '').trim()
  if (!text) return ''
  const codePoints = Array.from(text)
    .map((char) => char.codePointAt(0)?.toString(16))
    .filter(Boolean)
    .join('-')
  if (!codePoints) return ''
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints}.svg`
}

function normalizePhoneDigits(value) {
  let text = String(value ?? '').trim()
  if (!text) return ''
  text = text.replace(/[()\-\s]/g, '')
  if (text.startsWith('+')) text = text.slice(1)
  if (text.startsWith('00')) text = text.slice(2)
  return text.replace(/\D/g, '')
}

function detectPhoneCountry(value) {
  const raw = String(value ?? '').trim()
  const digits = normalizePhoneDigits(raw)
  if (!digits) return null

  if (/^07\d{8}$/.test(raw.replace(/\D/g, ''))) {
    return { iso: 'JO', name: 'الأردن', flag: flagEmojiFromIsoCode('JO') }
  }

  if (/^[789]\d{7}$/.test(digits) || /^7\d{8}$/.test(digits) || /^962/.test(digits)) {
    return { iso: 'JO', name: 'الأردن', flag: flagEmojiFromIsoCode('JO') }
  }

  const match = PHONE_COUNTRY_DIAL_CODES
    .slice()
    .sort((a, b) => b.code.length - a.code.length)
    .find((entry) => digits.startsWith(entry.code))

  if (!match) return null

  return {
    iso: match.iso,
    name: match.name,
    flag: flagEmojiFromIsoCode(match.iso),
  }
}

function formatDisplayPhoneNumber(value) {
  const raw = normalizeMobileNumberValue(value)
  if (!raw) return ''

  const trimmed = String(raw).trim()
  const normalized = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed
  const guessedCountry = detectPhoneCountry(trimmed)?.iso || 'JO'

  const parsed = normalized.startsWith('+')
    ? parsePhoneNumberFromString(normalized)
    : parsePhoneNumberFromString(normalized, guessedCountry)

  if (parsed && parsed.isPossible()) {
    return parsed.formatInternational()
  }

  return trimmed
}

function normalizeWhatsAppPhone(value) {
  let digits = String(value ?? '').replace(/[^\d+]/g, '').trim()
  if (!digits) return ''

  if (digits.startsWith('+')) digits = digits.slice(1)
  if (digits.startsWith('00')) digits = digits.slice(2)

  const plainDigits = digits.replace(/\D/g, '')
  if (!plainDigits) return ''

  if (plainDigits.startsWith('962')) return plainDigits
  if (plainDigits.startsWith('0')) return `962${plainDigits.slice(1)}`
  if (plainDigits.startsWith('7') && plainDigits.length === 9) return `962${plainDigits}`

  return plainDigits
}

function shouldUseMobileWhatsAppLink() {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.userAgentData?.mobile === 'boolean') return navigator.userAgentData.mobile

  const userAgent = String(navigator.userAgent || navigator.vendor || '').toLowerCase()
  return /android|iphone|ipad|ipod|iemobile|opera mini|mobile/.test(userAgent)
}

function buildWhatsAppChatUrl(value) {
  const phone = normalizeWhatsAppPhone(value)
  if (!phone) return ''
  if (shouldUseMobileWhatsAppLink()) return `https://wa.me/${phone}`
  return `https://web.whatsapp.com/send?phone=${phone}`
}

function buildPhoneCallHref(value) {
  const raw = normalizeMobileNumberValue(value)
  if (!raw) return ''

  const trimmed = String(raw).trim()
  const normalized = trimmed.startsWith('00') ? `+${trimmed.slice(2)}` : trimmed
  const guessedCountry = detectPhoneCountry(trimmed)?.iso || 'JO'

  const parsed = normalized.startsWith('+')
    ? parsePhoneNumberFromString(normalized)
    : parsePhoneNumberFromString(normalized, guessedCountry)

  if (parsed?.number) return `tel:${parsed.number}`

  const digits = normalizePhoneDigits(trimmed)
  if (!digits) return ''
  if (trimmed.startsWith('+')) return `tel:${trimmed}`
  if (trimmed.startsWith('00')) return `tel:+${digits}`
  if (digits.startsWith('962')) return `tel:+${digits}`
  if (/^0\d+$/.test(digits)) return `tel:+962${digits.slice(1)}`
  if (/^7\d{8}$/.test(digits)) return `tel:+962${digits}`
  return `tel:${digits}`
}

function WhatsAppIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="#25D366" />
      <path
        d="M12 6.3a5.62 5.62 0 0 0-4.78 8.58l-.67 2.32 2.38-.62A5.62 5.62 0 1 0 12 6.3Z"
        fill="white"
      />
      <path
        d="M12.08 8.45a3.86 3.86 0 0 0-3.34 5.8l.18.3-.4 1.36 1.4-.37.29.17a3.86 3.86 0 1 0 1.87-7.26Z"
        fill="#25D366"
      />
      <path
        d="M10.6 10.38c.08-.18.16-.19.27-.19h.24c.08 0 .18.02.26.22l.3.71c.05.11.04.18-.02.27l-.18.28c-.05.08-.04.15.01.22.12.22.35.52.66.79.35.3.64.46.87.57.09.04.15.03.22-.03l.27-.31c.08-.1.16-.11.28-.06l.67.29c.18.08.21.18.21.26v.22c0 .14-.1.33-.25.49-.17.18-.43.3-.71.3-.41 0-.94-.16-1.58-.58a5.13 5.13 0 0 1-1.15-1.11c-.36-.52-.52-.98-.52-1.35 0-.26.1-.49.27-.67Z"
        fill="white"
      />
    </svg>
  )
}

function toBoolDefaultTrue(value) {
  if (value === null || value === undefined || value === '') return true
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (!text || text === 'nan' || text === 'none' || text === 'null') return true
  return !['0', 'false', 'no', 'n'].includes(text)
}

function toBoolDefaultFalse(value) {
  if (value === null || value === undefined || value === '') return false
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (!text || text === 'nan' || text === 'none' || text === 'null') return false
  return ['1', 'true', 'yes', 'y'].includes(text)
}

function createLocalId(prefix = 'row') {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}_${uuid.replace(/-/g, '').slice(0, 12)}`
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeMobileNumberRows(rows, { dropEmpty = false, validJobIds = null } = {}) {
  const source = Array.isArray(rows) ? rows : []
  const validJobIdSet = validJobIds ? new Set(validJobIds.map((value) => String(value).trim()).filter(Boolean)) : null
  const normalized = source.map((row) => {
    const typeMeta = parseMobileNumberTypeMeta(row?.type, row?.family_relation)
    const parsedLinkedJobIds = parseLinkedJobIds(row?.linked_job_ids)
      .filter((jobId) => !validJobIdSet || validJobIdSet.has(jobId))
    const type = typeMeta.baseType === 'family'
      ? 'family'
      : (parsedLinkedJobIds.length > 0 ? 'work' : typeMeta.normalized)
    const familyRelation = typeMeta.baseType === 'family' ? typeMeta.familyRelation : ''
    const linkedJobIds = type === 'work' ? parsedLinkedJobIds : []

    return {
      mobile_number_record_id: normalizeLooseInput(row?.mobile_number_record_id),
      mobile_number: normalizeMobileNumberValue(row?.mobile_number),
      type,
      family_relation: familyRelation,
      is_primary: type === 'personal' ? toBoolDefaultFalse(row?.is_primary) : false,
      phone_calls_flag: toBoolDefaultTrue(row?.phone_calls_flag),
      whatsapp_flag: toBoolDefaultTrue(row?.whatsapp_flag),
      linked_job_ids: linkedJobIds,
    }
  })

  const personalRows = normalized
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.type === 'personal')
  const winner = personalRows.findIndex(({ row }) => row.is_primary)
  const normalizedWithPrimary = normalized.map((row, index) => {
    if (row.type !== 'personal') return { ...row, is_primary: false }
    const personalIndex = personalRows.findIndex((entry) => entry.index === index)
    return {
      ...row,
      is_primary: personalRows.length === 1 ? true : (winner >= 0 ? personalIndex === winner : false),
    }
  })

  return dropEmpty
    ? normalizedWithPrimary.filter((row) => row.mobile_number)
    : normalizedWithPrimary
}

function serializeMobileNumberRows(rows, { validJobIds = null } = {}) {
  return normalizeMobileNumberRows(rows, { dropEmpty: true, validJobIds }).map((row) => ({
    ...row,
    mobile_number_record_id: row.mobile_number_record_id || null,
    family_relation: row.type === 'family' && row.family_relation ? row.family_relation : null,
    is_primary: row.is_primary,
    linked_job_ids: row.type === 'work' && row.linked_job_ids.length ? JSON.stringify(row.linked_job_ids) : null,
  }))
}

function phoneRowTitle(row) {
  return formatDisplayPhoneNumber(row?.mobile_number) || phoneNumberTypeLabel(row?.type, row?.family_relation) || 'رقم هاتف'
}

function mobileNumberBadgeLabel(row) {
  return phoneNumberTypeLabel(row?.type, row?.family_relation)
}

function contactCardSurfaceStyle(active) {
  if (active) {
    return {
      border: '1px solid rgba(201, 150, 60, 0.38)',
      background: 'linear-gradient(135deg, rgba(201, 150, 60, 0.12), rgba(255, 255, 255, 0.98))',
      boxShadow: '0 10px 24px rgba(201, 150, 60, 0.12)',
    }
  }

  return {
    border: '1px solid var(--gray-200)',
    background: 'var(--gray-50)',
    boxShadow: 'none',
  }
}

function parseLegacyBirthDate(str) {
  if (!str) return { month: '', day: '' }
  const s = String(str).trim()

  const isoMatch = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    return { month: String(parseInt(isoMatch[1], 10)), day: String(parseInt(isoMatch[2], 10)) }
  }

  const parts = s.split(/\s+/)
  if (parts.length >= 2) {
    const mIdx = MONTHS.findIndex(m => m.en.toLowerCase() === parts[0].toLowerCase())
    if (mIdx >= 0) {
      const d = parseInt(parts[1], 10)
      if (d > 0) return { month: String(mIdx + 1), day: String(d) }
    }
    const mIdx2 = MONTHS.findIndex(m => m.en.toLowerCase() === parts[1].toLowerCase())
    if (mIdx2 >= 0) {
      const d = parseInt(parts[0], 10)
      if (d > 0) return { month: String(mIdx2 + 1), day: String(d) }
    }
  }

  const hyphenMatch = s.match(/^(\d{1,2})-([A-Za-z]+)$/)
  if (hyphenMatch) {
    const mIdx = MONTHS.findIndex(m => m.en.toLowerCase() === hyphenMatch[2].toLowerCase())
    if (mIdx >= 0) return { month: String(mIdx + 1), day: String(parseInt(hyphenMatch[1], 10)) }
  }

  return { month: '', day: '' }
}

function toDatePart(v, min, max) {
  if (v === null || v === undefined || v === '') return ''
  const n = parseInt(v, 10)
  if (Number.isNaN(n) || n < min || n > max) return ''
  return String(n)
}

function BirthDatePicker({ day, month, legacyValue, onChange }) {
  const [monthState, setMonthState] = useState('')
  const [dayState, setDayState] = useState('')

  useEffect(() => {
    const normalizedDay = toDatePart(day, 1, 31)
    const normalizedMonth = toDatePart(month, 1, 12)
    if (normalizedDay || normalizedMonth) {
      setDayState(normalizedDay)
      setMonthState(normalizedMonth)
      return
    }
    const legacy = parseLegacyBirthDate(legacyValue)
    setDayState(legacy.day)
    setMonthState(legacy.month)
  }, [day, month, legacyValue])

  const emit = (nextDay, nextMonth) => {
    setDayState(nextDay)
    setMonthState(nextMonth)
    onChange(nextDay, nextMonth)
  }

  const daysInMonth = monthState ? new Date(2000, parseInt(monthState, 10), 0).getDate() : 31
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select className="combo-trigger" style={{ flex: '1', cursor: 'pointer' }}
        value={monthState} onChange={e => emit(dayState, e.target.value)}>
        <option value="">الشهر</option>
        {MONTHS.map(m => (
          <option key={m.num} value={String(m.num)}>{m.ar} - {m.num}</option>
        ))}
      </select>
      <select className="combo-trigger" style={{ flex: '0 0 80px', cursor: 'pointer' }}
        value={dayState} onChange={e => emit(e.target.value, monthState)}>
        <option value="">اليوم</option>
        {days.map(d => <option key={d} value={String(d)}>{d}</option>)}
      </select>
    </div>
  )
}

// ── Tag field with combobox input ─────────────────────────────────────────────
function TagField({ items, valueKey, onAdd, onRemove, placeholder, options = [] }) {
  const [val, setVal]     = useState('')
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const add = (v) => { if (v.trim()) { onAdd(v.trim()); setVal(''); setQuery(''); setOpen(false) } }

  const filtered = options.filter(o =>
    o.value && o.value.toString().toLowerCase().includes(query.toLowerCase()) &&
    !items.some(it => it[valueKey] === o.value)
  )

  if (options.length === 0) {
    // Fallback: plain text input (no options loaded)
    return (
      <div>
        <div className="tag-list">
          {items.map((it, i) => (
            <span key={i} className="tag">{it[valueKey]}<span className="tag-remove" onClick={() => onRemove(i)}>×</span></span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="tag-input" placeholder={placeholder} value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(val) }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(val)}><Plus size={14} /></button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="tag-list">
        {items.map((it, i) => (
          <span key={i} className="tag">{it[valueKey]}<span className="tag-remove" onClick={() => onRemove(i)}>×</span></span>
        ))}
      </div>
      <div ref={ref} style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="tag-input" style={{ flex: 1 }} placeholder={placeholder} value={val}
            onChange={e => { setVal(e.target.value); setQuery(e.target.value); setOpen(true) }}
            onFocus={() => { setQuery(val); setOpen(true) }}
            onKeyDown={e => { if (e.key === 'Enter') add(val); if (e.key === 'Escape') setOpen(false) }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(val)}><Plus size={14} /></button>
        </div>
        {open && (filtered.length > 0) && (
          <div className="combo-dropdown" style={{ top: 'calc(100% + 4px)' }}>
            <div className="combo-list">
              {filtered.slice(0, 12).map(o => (
                <button type="button" key={o.value} className="combo-item"
                  onMouseDown={e => { e.preventDefault(); add(o.value) }}>
                  {o.value}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function NationalityRowsEditor({ rows, onChange, options = [], lookup = null, placeholder = 'أضف جنسية…' }) {
  const normalizedRows = normalizeNationalityRows(rows, { lookup })
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const updateRows = (nextRows) => {
    onChange(normalizeNationalityRows(nextRows, { lookup }))
  }

  const updateRow = (index, key, value) => {
    updateRows(normalizedRows.map((row, rowIndex) => (
      rowIndex === index
        ? { ...row, [key]: value }
        : row
    )))
  }

  const removeRow = (index) => {
    setMessage('')
    updateRows(normalizedRows.filter((_, rowIndex) => rowIndex !== index))
  }

  const addNationality = (value) => {
    const nationality = normalizeNationalityValue(value)
    const error = getNationalitySelectionError(normalizedRows, nationality)
    if (error) {
      setMessage(error)
      return
    }

    setMessage('')
    updateRows([
      ...normalizedRows,
      { nationality, iso_alpha2: resolveNationalityIsoAlpha2(nationality, '', lookup) },
    ])
    setOpen(false)
    setCustom(false)
    setQuery('')
    setDraft('')
  }

  const availableOptions = Array.from(new Map(
    options
      .map((option) => {
        const value = normalizeNationalityValue(option?.value || option)
        const label = option?.label || value
        return value ? [normalizeNationalityLookupKey(value), { value, label }] : null
      })
      .filter(Boolean)
  ).values()).filter((option) => !getNationalitySelectionError(normalizedRows, option.value))

  const filteredOptions = availableOptions.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
  const conflictHint = normalizedRows.some((row) => isJordanianNationality(row.nationality))
    ? 'لا يمكن اختيار أبناء الأردنيّات مع الجنسية الأردنيّة.'
    : normalizedRows.some((row) => isChildrenOfJordanianMothersNationality(row.nationality))
      ? 'لا يمكن اختيار الجنسية الأردنيّة مع أبناء الأردنيّات.'
      : ''

  return (
    <div className="profile-nationality-editor">
      {normalizedRows.length > 0 ? (
        <div className="profile-nationality-grid profile-nationality-editor-list">
          {normalizedRows.map((row, index) => (
            <article key={`${row.nationality || 'nationality-row'}-${index}`} className="profile-nationality-card profile-nationality-editor-card">
              <div className="profile-nationality-card-head profile-nationality-editor-card-head">
                <div className="profile-nationality-card-title profile-nationality-editor-card-title">
                  {renderNationalityLabel(row, { fallbackIcon: '🌍', gap: 8 })}
                </div>
                <button type="button" className="btn btn-ghost btn-sm profile-nationality-editor-remove" onClick={() => removeRow(index)}>
                  <Trash2 size={14} />
                  حذف
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="profile-nationality-editor-empty">
          لم تتم إضافة أي جنسية بعد.
        </div>
      )}

      <div className="profile-nationality-editor-add">
        <div className="profile-nationality-editor-add-label">
          <Plus size={14} />
          <span>إضافة جنسية</span>
        </div>
        {!custom ? (
          <div ref={ref} className="profile-nationality-editor-picker">
            <button type="button" className="combo-trigger profile-nationality-editor-trigger" onClick={() => { setOpen((current) => !current); setQuery(''); setMessage('') }}>
              <span className="profile-nationality-editor-trigger-text">{placeholder}</span>
              <span className="profile-nationality-editor-trigger-icon">▾</span>
            </button>
            {open && (
              <div className="combo-dropdown">
                <input
                  autoFocus
                  className="combo-search"
                  placeholder="بحث…"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => event.stopPropagation()}
                />
                <div className="combo-list">
                  {filteredOptions.length === 0 && (
                    <div className="profile-nationality-editor-no-results">لا توجد نتائج</div>
                  )}
                  {filteredOptions.map((option) => (
                    <button type="button" key={option.value} className="combo-item" onClick={() => addNationality(option.value)}>
                      {option.label}
                    </button>
                  ))}
                  <button type="button" className="combo-item combo-other" onClick={() => { setOpen(false); setQuery(''); setCustom(true); setMessage('') }}>
                    ＋ أخرى / اكتب يدوياً…
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="profile-nationality-editor-manual">
            <input
              autoFocus
              className="combo-input profile-nationality-editor-manual-input"
              placeholder="اكتب الجنسية…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addNationality(draft)
                if (event.key === 'Escape') { setCustom(false); setDraft(''); setMessage('') }
              }}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => addNationality(draft)}>إضافة</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCustom(false); setDraft(''); setMessage('') }}>إلغاء</button>
          </div>
        )}
      </div>

      {conflictHint && <div className="profile-nationality-editor-hint">{conflictHint}</div>}
      {message && <div className="profile-nationality-editor-error">{message}</div>}
    </div>
  )
}

function PhoneNumbersEditor({ rows, onChange, jobRows = [] }) {
  const jobOptions = extractJobOptions(jobRows)
  const validJobIds = jobOptions.map((option) => option.value)
  const normalizedRows = normalizeMobileNumberRows(rows, { validJobIds })
  const personalRowCount = countPersonalMobileRows(normalizedRows)
  const typeOptions = Array.from(new Map(
    [...PHONE_NUMBER_TYPE_OPTIONS, ...normalizedRows
      .map((row) => parseMobileNumberTypeMeta(row.type, row.family_relation))
      .filter((meta) => meta.normalized && meta.baseType !== 'family')
      .map((meta) => ({ value: meta.selectorValue, label: PHONE_NUMBER_TYPE_OPTIONS.find((option) => option.value === meta.selectorValue)?.label || meta.selectorValue }))]
      .map((option) => [option.value, option])
  ).values())
  const familyRelationOptions = Array.from(new Map(
    [...PHONE_NUMBER_FAMILY_RELATION_OPTIONS,
      ...normalizedRows
        .map((row) => parseMobileNumberTypeMeta(row.type, row.family_relation).familyRelation)
        .filter(Boolean)
        .map((value) => ({ value, label: value }))]
      .map((option) => [option.value, option])
  ).values())

  const commit = (nextRows) => onChange(normalizeMobileNumberRows(nextRows, { validJobIds }))
  const updateRow = (index, key, value) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row

      const nextRow = { ...row, [key]: value }
      if (key === 'type') {
        const selectedType = normalizeMobileNumberType(value)
        nextRow.type = selectedType
        nextRow.family_relation = selectedType === 'family'
          ? normalizeFamilyRelationValue(row.family_relation)
          : ''
        if (selectedType !== 'personal') nextRow.is_primary = false
        if (parseMobileNumberTypeMeta(nextRow.type).baseType !== 'work') nextRow.linked_job_ids = []
      }
      if (key === 'family_relation') {
        nextRow.family_relation = normalizeFamilyRelationValue(value)
      }
      return nextRow
    }))
  }
  const toggleLinkedJob = (index, jobId) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const current = new Set(parseLinkedJobIds(row.linked_job_ids))
      if (current.has(jobId)) current.delete(jobId)
      else current.add(jobId)
      return { ...row, linked_job_ids: Array.from(current) }
    }))
  }
  const setPrimaryStatus = (index, checked) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (parseMobileNumberTypeMeta(row.type, row.family_relation).baseType !== 'personal') return { ...row, is_primary: false }
      if (rowIndex === index) return { ...row, is_primary: checked }
      return checked ? { ...row, is_primary: false } : row
    }))
  }

  const addRow = () => commit([...normalizedRows, { ...DEFAULT_MOBILE_NUMBER_ROW, is_primary: !normalizedRows.some((row) => row.type === 'personal' && row.is_primary) }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const typeMeta = parseMobileNumberTypeMeta(row.type, row.family_relation)
        const linkedIds = parseLinkedJobIds(row.linked_job_ids)
        const isPrimaryPersonal = typeMeta.baseType === 'personal' && Boolean(row.is_primary)
        const canChoosePrimary = typeMeta.baseType === 'personal' && personalRowCount > 1 && !isPrimaryPersonal
        const highlightPrimary = typeMeta.baseType === 'personal' && personalRowCount > 1 && isPrimaryPersonal
        return (
          <div key={row.mobile_number_record_id || `phone-row-${index}`} style={{ ...contactCardSurfaceStyle(highlightPrimary), borderRadius: 'var(--radius-md)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: canChoosePrimary ? 'pointer' : 'default' }}
                onClick={canChoosePrimary ? () => updateRow(index, 'is_primary', true) : undefined}
                title={canChoosePrimary ? 'اضغط لتحديد هذا الرقم كالعنصر الأساسي' : undefined}
              >
                <div dir="ltr" style={{ fontWeight: 700, color: 'var(--navy)', direction: 'ltr', unicodeBidi: 'plaintext' }}>{row.mobile_number || '—'}</div>
                <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{mobileNumberBadgeLabel(row)}</span>
                {isPrimaryPersonal ? (
                  <span style={{ background: '#fff7d6', border: '1px solid rgba(201, 150, 60, 0.38)', color: '#8a6420', borderRadius: 999, padding: '3px 9px', fontSize: '0.72rem', fontWeight: 800 }}>
                    الرئيسي
                  </span>
                ) : null}
              </div>
              {typeMeta.baseType === 'personal' ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--gray-600)', marginInlineStart: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={isPrimaryPersonal}
                    disabled={personalRowCount <= 1}
                    onChange={(event) => setPrimaryStatus(index, event.target.checked)}
                  />
                  الرئيسي
                </label>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الرقم</span>
                <input
                  className="combo-input"
                  value={row.mobile_number || ''}
                  onChange={(event) => updateRow(index, 'mobile_number', event.target.value)}
                  placeholder="079xxxxxxx"
                  dir="ltr"
                  inputMode="tel"
                  style={{ textAlign: 'left' }}
                />
              </label>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>النوع</span>
                  <ComboDropdown
                    value={typeMeta.selectorValue}
                    onChange={(value) => updateRow(index, 'type', value)}
                    options={typeOptions}
                    placeholder="اختر النوع…"
                    customActionLabel="اكتب النوع يدوياً…"
                    customInputPlaceholder="اكتب نوع الرقم…"
                  />
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الإعدادات</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(row.phone_calls_flag)}
                      onChange={(event) => updateRow(index, 'phone_calls_flag', event.target.checked)}
                    />
                    اتصالات
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(row.whatsapp_flag)}
                      onChange={(event) => updateRow(index, 'whatsapp_flag', event.target.checked)}
                    />
                    واتساب
                  </label>
                </div>
              </div>

              {typeMeta.baseType === 'family' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>صلة القرابة</span>
                  <ComboDropdown
                    value={typeMeta.familyRelation}
                    onChange={(value) => updateRow(index, 'family_relation', value)}
                    options={familyRelationOptions}
                    placeholder="اختر صلة القرابة…"
                    customActionLabel="اكتب صلة القرابة يدوياً…"
                    customInputPlaceholder="اكتب صلة القرابة…"
                  />
                </label>
              ) : null}

              {typeMeta.baseType === 'work' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>سجلات العمل المرتبطة</span>
                  {jobOptions.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>أضف سجل عمل أولاً ثم اربط الرقم به.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {jobOptions.map((option) => {
                        const active = linkedIds.includes(option.value)
                        return (
                          <label key={option.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                            <input
                              type="checkbox"
                              checked={active}
                              onChange={() => toggleLinkedJob(index, option.value)}
                            />
                            {option.label}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة رقم هاتف</button>
    </div>
  )
}

function EmailsEditor({ rows, onChange, jobRows = [] }) {
  const jobOptions = extractJobOptions(jobRows)
  const validJobIds = jobOptions.map((option) => option.value)
  const normalizedRows = normalizeEmailRows(rows, { validJobIds })
  const personalRowCount = countPersonalEmailRows(normalizedRows)
  const familyRelationOptions = Array.from(new Map(
    [...PHONE_NUMBER_FAMILY_RELATION_OPTIONS,
      ...normalizedRows
        .map((row) => parseEmailTypeMeta(row.type, row.family_relation).familyRelation)
        .filter(Boolean)
        .map((value) => ({ value, label: value }))]
      .map((option) => [option.value, option])
  ).values())

  const commit = (nextRows) => onChange(normalizeEmailRows(nextRows, { validJobIds }))
  const updateRow = (index, key, value) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row

      const nextRow = { ...row, [key]: value }
      if (key === 'type') {
        nextRow.type = normalizeEmailType(value)
        nextRow.family_relation = nextRow.type === 'family'
          ? normalizeEmailFamilyRelationValue(row.family_relation)
          : ''
        if (nextRow.type !== 'personal') nextRow.is_primary = false
        if (nextRow.type !== 'work') nextRow.linked_job_ids = []
      }
      if (key === 'family_relation') {
        nextRow.family_relation = normalizeEmailFamilyRelationValue(value)
      }
      return nextRow
    }))
  }
  const toggleLinkedJob = (index, jobId) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const current = new Set(parseLinkedJobIds(row.linked_job_ids))
      if (current.has(jobId)) current.delete(jobId)
      else current.add(jobId)
      return { ...row, linked_job_ids: Array.from(current) }
    }))
  }
  const setPrimaryStatus = (index, checked) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (parseEmailTypeMeta(row.type, row.family_relation).normalized !== 'personal') return { ...row, is_primary: false }
      if (rowIndex === index) return { ...row, is_primary: checked }
      return checked ? { ...row, is_primary: false } : row
    }))
  }
  const addRow = () => commit([...normalizedRows, { ...DEFAULT_EMAIL_ROW, is_primary: !normalizedRows.some((row) => row.type === 'personal' && row.is_primary) }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const typeMeta = parseEmailTypeMeta(row.type, row.family_relation)
        const linkedIds = parseLinkedJobIds(row.linked_job_ids)
        const isPrimaryPersonal = typeMeta.normalized === 'personal' && Boolean(row.is_primary)
        const canChoosePrimary = typeMeta.normalized === 'personal' && personalRowCount > 1 && !isPrimaryPersonal
        const highlightPrimary = typeMeta.normalized === 'personal' && personalRowCount > 1 && isPrimaryPersonal
        return (
          <div key={row.email_record_id || `email-row-${index}`} style={{ ...contactCardSurfaceStyle(highlightPrimary), borderRadius: 'var(--radius-md)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: canChoosePrimary ? 'pointer' : 'default' }}
                onClick={canChoosePrimary ? () => updateRow(index, 'is_primary', true) : undefined}
                title={canChoosePrimary ? 'اضغط لتحديد هذا البريد كالعنصر الأساسي' : undefined}
              >
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.email || '—'}</div>
                <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                  {emailTypeLabel(row.type, row.family_relation)}
                </span>
                {isPrimaryPersonal ? (
                  <span style={{ background: '#fff7d6', border: '1px solid rgba(201, 150, 60, 0.38)', color: '#8a6420', borderRadius: 999, padding: '3px 9px', fontSize: '0.72rem', fontWeight: 800 }}>
                    الرئيسي
                  </span>
                ) : null}
              </div>
              {typeMeta.normalized === 'personal' ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--gray-600)', marginInlineStart: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={isPrimaryPersonal}
                    disabled={personalRowCount <= 1}
                    onChange={(event) => setPrimaryStatus(index, event.target.checked)}
                  />
                  الرئيسي
                </label>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>البريد الإلكتروني</span>
                <input
                  className="combo-input"
                  type="email"
                  value={row.email || ''}
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                  placeholder="name@example.com"
                  onChange={(event) => updateRow(index, 'email', event.target.value)}
                />
              </label>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>النوع</span>
                  <SelectDropdown
                    value={row.type}
                    onChange={(value) => updateRow(index, 'type', value)}
                    options={EMAIL_TYPE_OPTIONS}
                    placeholder="اختر النوع…"
                  />
                </label>

                {typeMeta.normalized === 'personal' ? (
                  <div style={{ display: 'flex', alignItems: 'center' }} />
                ) : typeMeta.normalized === 'family' ? (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>صلة القرابة</span>
                    <ComboDropdown
                      value={typeMeta.familyRelation}
                      onChange={(value) => updateRow(index, 'family_relation', value)}
                      options={familyRelationOptions}
                      placeholder="اختر صلة القرابة…"
                      customActionLabel="اكتب صلة القرابة يدوياً…"
                      customInputPlaceholder="اكتب صلة القرابة…"
                    />
                  </label>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>سجلات العمل المرتبطة</span>
                    {jobOptions.length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>أضف سجل عمل أولاً ثم اربط البريد به.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {jobOptions.map((option) => {
                          const active = linkedIds.includes(option.value)
                          return (
                            <label key={option.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => toggleLinkedJob(index, option.value)}
                              />
                              {option.label}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة بريد إلكتروني</button>
    </div>
  )
}

function SocialMediaEditor({ rows, onChange }) {
  const normalizedRows = normalizeSocialMediaRows(rows)

  const commit = (nextRows) => onChange(normalizeSocialMediaRows(nextRows))
  const updateRow = (index, key, value) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const nextRow = { ...row, [key]: value }
      if (key === 'platform') nextRow.platform = normalizeSocialPlatform(value)
      return nextRow
    }))
  }
  const setPrimaryStatus = (index, checked) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (normalizeSocialPlatform(row.platform) !== normalizeSocialPlatform(normalizedRows[index]?.platform)) return row
      if (rowIndex === index) return { ...row, is_primary: checked }
      return checked ? { ...row, is_primary: false } : row
    }))
  }
  const addRow = () => commit([...normalizedRows, { ...DEFAULT_SOCIAL_MEDIA_ROW }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const platformRowCount = countSocialPlatformRows(normalizedRows, row.platform)
        const canChoosePrimary = platformRowCount > 1 && !row.is_primary
        const highlightPrimary = platformRowCount > 1 && Boolean(row.is_primary)
        return (
          <div key={`social-row-${index}`} style={{ ...contactCardSurfaceStyle(highlightPrimary), borderRadius: 'var(--radius-md)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: canChoosePrimary ? 'pointer' : 'default' }}
                onClick={canChoosePrimary ? () => updateRow(index, 'is_primary', true) : undefined}
                title={canChoosePrimary ? 'اضغط لتحديد هذا الحساب كالعنصر الأساسي' : undefined}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--navy)' }}>
                  {socialPlatformIcon(row.platform, 16)}
                  <span>{socialPlatformLabel(row.platform)}</span>
                </div>
                {row.is_primary ? (
                  <span style={{ background: '#fff7d6', border: '1px solid rgba(201, 150, 60, 0.38)', color: '#8a6420', borderRadius: 999, padding: '3px 9px', fontSize: '0.72rem', fontWeight: 800 }}>
                    الرئيسي
                  </span>
                ) : null}
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--gray-600)', marginInlineStart: 'auto' }}>
                <input
                  type="checkbox"
                  checked={Boolean(row.is_primary)}
                  disabled={platformRowCount <= 1}
                  onChange={(event) => setPrimaryStatus(index, event.target.checked)}
                />
                الرئيسي
              </label>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>المنصة</span>
                  <SelectDropdown
                    value={row.platform}
                    onChange={(value) => updateRow(index, 'platform', value)}
                    options={SOCIAL_MEDIA_PLATFORM_OPTIONS}
                    placeholder="اختر المنصة…"
                    dir="ltr"
                  />
                </label>

                <div style={{ display: 'flex', alignItems: 'center' }} />
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الرابط</span>
                <input
                  className="combo-input"
                  value={row.url || ''}
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                  placeholder="https://..."
                  onChange={(event) => updateRow(index, 'url', event.target.value)}
                />
              </label>
            </div>
          </div>
        )
      })}
      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة حساب تواصل اجتماعي</button>
    </div>
  )
}

function MultiSelectChips({ options, selected, onChange }) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [])
  const toggle = (option) => {
    if (selectedSet.has(option)) {
      onChange((selected || []).filter((value) => value !== option))
      return
    }
    onChange([...(selected || []), option])
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => {
        const active = selectedSet.has(option)
        return (
          <button
            key={option}
            type="button"
            className={'am-option-item' + (active ? ' am-selected' : '')}
            style={{ width: 'auto', paddingInline: 12 }}
            onClick={() => toggle(option)}
          >
            <span className={'am-check-box' + (active ? ' am-selected' : '')}>
              {active && <Plus size={11} style={{ transform: 'rotate(45deg)' }} />}
            </span>
            {option}
          </button>
        )
      })}
    </div>
  )
}

function CompactMultiSelect({ options, selected, onChange, placeholder = 'اختر…' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const normalizedSelected = Array.isArray(selected) ? selected : []
  const selectedSet = new Set(normalizedSelected)

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const toggle = (option) => {
    if (selectedSet.has(option)) {
      onChange(normalizedSelected.filter((value) => value !== option))
      return
    }
    onChange([...normalizedSelected, option])
  }

  const summary = normalizedSelected.length === 0
    ? placeholder
    : normalizedSelected.length <= 2
      ? normalizedSelected.join('، ')
      : `${normalizedSelected.length} صفوف محددة`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="combo-trigger" onClick={() => setOpen((current) => !current)}>
        <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <span style={{ color: 'var(--gray-400)', fontSize: '0.7rem', flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div className="combo-dropdown">
          <div className="combo-list" style={{ maxHeight: 260 }}>
            {options.map((option) => {
              const active = selectedSet.has(option)
              return (
                <button
                  key={option}
                  type="button"
                  className={'combo-item' + (active ? ' selected' : '')}
                  onClick={() => toggle(option)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                >
                  <span>{option}</span>
                  {active && <Check size={13} strokeWidth={3} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SchoolRowsEditor({ rows, onChange, schoolOptions = [], schoolBranches = {}, graduatedFromSchools = false, onGraduatedChange, schoolSystem = '', schoolSystemOptions = [], onSchoolSystemChange, schoolSystemSector = '', onSchoolSystemSectorChange, schoolFinalGpa = '', onSchoolFinalGpaChange }) {
  const normalizedRows = normalizeSchoolRows(rows, { graduatedFromSchools })
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const ref = useRef(null)
  const isJordanSchoolSystem = normalizeSchoolSystemValue(schoolSystem) === DEFAULT_SCHOOL_SYSTEM
  const [sectorPath, setSectorPath] = useState(() => inferJordanSchoolSystemSectorPath(schoolSystemSector))

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  useEffect(() => {
    setSectorPath(inferJordanSchoolSystemSectorPath(schoolSystemSector))
  }, [schoolSystemSector])

  const commit = (nextRows) => onChange(normalizeSchoolRows(nextRows, { graduatedFromSchools }))
  const sectorBranchOptions = Object.keys(JORDAN_SCHOOL_SYSTEM_BRANCH_OPTIONS)
  const sectorFinalOptions = sectorPath.type === 'الحقل'
    ? JORDAN_SCHOOL_SYSTEM_FIELD_OPTIONS
    : sectorPath.type === 'الفرع' && sectorPath.branch
      ? (JORDAN_SCHOOL_SYSTEM_BRANCH_OPTIONS[sectorPath.branch] || [])
      : []

  const handleSchoolSystemChange = (value) => {
    const normalizedValue = normalizeSchoolSystemValue(value)
    onSchoolSystemChange && onSchoolSystemChange(normalizedValue)
    if (normalizedValue !== DEFAULT_SCHOOL_SYSTEM) {
      setSectorPath({ type: '', branch: '', finalPick: '' })
      onSchoolSystemSectorChange && onSchoolSystemSectorChange('')
    }
  }

  const handleSectorTypeChange = (value) => {
    setSectorPath({ type: value, branch: '', finalPick: '' })
    onSchoolSystemSectorChange && onSchoolSystemSectorChange('')
  }

  const handleSectorBranchChange = (value) => {
    setSectorPath({ type: 'الفرع', branch: value, finalPick: '' })
    onSchoolSystemSectorChange && onSchoolSystemSectorChange('')
  }

  const handleSectorFinalPickChange = (value) => {
    const finalPick = normalizeLooseInput(value)
    setSectorPath((current) => ({ ...current, finalPick }))
    onSchoolSystemSectorChange && onSchoolSystemSectorChange(finalPick)
  }

  const commitRowChanges = (index, changes) => {
    const nextRows = normalizedRows.map((entry, rowIndex) => {
      if (rowIndex !== index) {
        return changes.is_current ? { ...entry, is_current: false } : entry
      }
      const nextRow = { ...entry, ...changes }
      if (graduatedFromSchools) nextRow.is_current = false
      if (Object.prototype.hasOwnProperty.call(changes, 'is_current') && changes.is_current) {
        nextRow.end_date = ''
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'is_current') && !changes.is_current && nextRow.end_date) {
        nextRow.end_date = sanitizeDateInput(nextRow.end_date)
      }
      return nextRow
    })
    commit(nextRows)
  }

  const addSchool = (value) => {
    const school = normalizeLooseInput(value)
    if (!school) {
      setMessage('يرجى إدخال المدرسة أولاً')
      return
    }
    setMessage('')
    commit([...normalizedRows, { school_record_id: '', school, section: '', start_date: '', end_date: '', is_current: true, grades_attended: [] }])
    setOpen(false)
    setCustom(false)
    setQuery('')
    setDraft('')
  }

  const updateRow = (index, key, value) => {
    const nextRows = normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const nextRow = { ...row, [key]: normalizeLooseInput(value) }
      if (key === 'school') {
        const sections = schoolBranchesForName(schoolBranches, nextRow.school)
        if (sections.length > 0 && nextRow.section && !sections.includes(nextRow.section)) {
          nextRow.section = ''
        }
        if (sections.length === 0) {
          nextRow.section = ''
        }
      }
      return nextRow
    })
    setMessage('')
    commit(nextRows)
  }

  const removeRow = (index) => {
    setMessage('')
    commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))
  }

  const availableOptions = Array.from(new Map(
    schoolOptions
      .map((option) => {
        const value = normalizeLooseInput(option?.value || option)
        const label = option?.label || value
        return value ? [normalizeSchoolLookupKey(value), { value, label }] : null
      })
      .filter(Boolean)
  ).values())

  const filteredOptions = availableOptions.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.82rem', color: 'var(--gray-500)' }}>يمكن أن تكون مدرسة واحدة فقط نشطة، أو لا توجد مدرسة نشطة إذا كان الطالب متخرّجًا.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <ComboDropdown
              value={normalizeSchoolSystemValue(schoolSystem)}
              onChange={handleSchoolSystemChange}
              options={buildSchoolSystemOptions(schoolSystemOptions, schoolSystem).map((value) => ({ value, label: value }))}
              placeholder="نظام الدراسة"
            />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--navy)' }}>
            <input
              type="checkbox"
              checked={Boolean(graduatedFromSchools)}
              onChange={(event) => onGraduatedChange && onGraduatedChange(event.target.checked)}
            />
            متخرّج من المدارس
          </label>
        </div>
      </div>
      {isJordanSchoolSystem ? (
        <div className="profile-two-column-layout">
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>نوع المسار</span>
            <SelectDropdown
              value={sectorPath.type}
              onChange={handleSectorTypeChange}
              options={JORDAN_SCHOOL_SYSTEM_SECTOR_TYPE_OPTIONS.map((value) => ({ value, label: value }))}
              placeholder="اختر الحقل أو الفرع…"
            />
          </label>
          {sectorPath.type === 'الفرع' ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>المسار</span>
              <SelectDropdown
                value={sectorPath.branch}
                onChange={handleSectorBranchChange}
                options={sectorBranchOptions.map((value) => ({ value, label: value }))}
                placeholder="اختر المسار…"
              />
            </label>
          ) : (
            <div />
          )}
          {sectorPath.type ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الاختيار النهائي</span>
              <SelectDropdown
                value={sectorPath.finalPick}
                onChange={handleSectorFinalPickChange}
                options={sectorFinalOptions.map((value) => ({ value, label: value }))}
                placeholder="اختر الاختصاص النهائي…"
              />
            </label>
          ) : null}
          {!sectorPath.type ? <div /> : null}
        </div>
      ) : null}
      {graduatedFromSchools ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>المعدل النهائي للمدرسة</span>
          <input
            className="combo-input"
            value={schoolFinalGpa}
            placeholder="مثال: 92.4 أو 3.75/4"
            onChange={(event) => onSchoolFinalGpaChange && onSchoolFinalGpaChange(normalizeFinalGpaValue(event.target.value))}
          />
        </label>
      ) : null}
      {normalizedRows.map((row, index) => {
        const configuredSections = schoolBranchesForName(schoolBranches, row.school)
        const sectionOptions = configuredSections.includes(row.section) || !row.section
          ? configuredSections
          : [...configuredSections, row.section]

        return (
          <div key={row.school_record_id || `school-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.school || '—'}</div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--navy)' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.is_current)}
                    disabled={Boolean(graduatedFromSchools)}
                    onChange={(event) => commitRowChanges(index, { is_current: event.target.checked })}
                  />
                  حاليًّا
                </label>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>اسم المدرسة</span>
                <ComboDropdown value={row.school} onChange={(value) => updateRow(index, 'school', value)} options={schoolOptions} placeholder="—" />
              </label>
              {sectionOptions.length > 0 && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>القسم / الفرع</span>
                  <SelectDropdown
                    value={row.section}
                    onChange={(value) => updateRow(index, 'section', value)}
                    options={sectionOptions.map((value) => ({ value, label: value }))}
                    placeholder="—"
                  />
                </label>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ البداية</span>
                  <input
                    className="combo-input"
                    type="date"
                    value={row.start_date || ''}
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    onChange={(event) => commit(normalizedRows.map((entry, rowIndex) => rowIndex === index ? { ...entry, start_date: sanitizeDateInput(event.target.value) } : entry))}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ النهاية</span>
                  {!row.is_current && (
                    <input
                      className="combo-input"
                      type="date"
                      value={row.end_date || ''}
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                      onChange={(event) => commitRowChanges(index, { end_date: sanitizeDateInput(event.target.value) })}
                    />
                  )}
                  {row.is_current && !graduatedFromSchools && <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>العضو ما يزال في هذه المدرسة</div>}
                </label>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الصفوف التي دَرَسها في هذه المدرسة</span>
                <CompactMultiSelect
                  options={SCHOOL_GRADE_OPTIONS}
                  selected={row.grades_attended}
                  onChange={(values) => commit(normalizedRows.map((entry, rowIndex) => rowIndex === index ? {
                    ...entry,
                    grades_attended: normalizeSchoolGrades(values),
                  } : entry))}
                  placeholder="اختر الصفوف…"
                />
              </label>
            </div>
          </div>
        )
      })}

      {!custom ? (
        <div ref={ref} style={{ position: 'relative' }}>
          <button type="button" className="combo-trigger" onClick={() => { setOpen((current) => !current); setQuery(''); setMessage('') }}>
            <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              أضف مدرسة…
            </span>
            <span style={{ color: 'var(--gray-400)', fontSize: '0.7rem', flexShrink: 0 }}>▾</span>
          </button>
          {open && (
            <div className="combo-dropdown">
              <input
                autoFocus
                className="combo-search"
                placeholder="بحث…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
              />
              <div className="combo-list">
                {filteredOptions.length === 0 && (
                  <div style={{ padding: '8px 12px', color: 'var(--gray-400)', fontSize: '0.82rem' }}>لا توجد نتائج</div>
                )}
                {filteredOptions.map((option) => (
                  <button type="button" key={option.value} className="combo-item" onClick={() => addSchool(option.value)}>
                    {option.label}
                  </button>
                ))}
                <button type="button" className="combo-item combo-other" onClick={() => { setOpen(false); setQuery(''); setCustom(true); setMessage('') }}>
                  ＋ أخرى / اكتب يدوياً…
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus
            className="combo-input"
            style={{ flex: 1 }}
            placeholder="اكتب اسم المدرسة…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addSchool(draft)
              if (event.key === 'Escape') { setCustom(false); setDraft(''); setMessage('') }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addSchool(draft)}>إضافة</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCustom(false); setDraft(''); setMessage('') }}>✕</button>
        </div>
      )}

      {message && <div style={{ fontSize: '0.78rem', color: 'var(--red)' }}>{message}</div>}
    </div>
  )
}

function HigherEducationRowsEditor({ rows, onChange, universityOptions = [], majorOptions = [], degreeOptions = [] }) {
  const normalizedRows = normalizeHigherEducationRows(rows)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const commit = (nextRows) => onChange(normalizeHigherEducationRows(nextRows))

  const commitRowChanges = (index, changes) => {
    const nextRows = normalizedRows.map((entry, rowIndex) => {
      if (rowIndex !== index) return entry

      const nextRow = { ...entry, ...changes }
      const nextState = normalizeHigherEducationStateValue(nextRow.state, { isCurrent: nextRow.is_current })
      nextRow.state = nextState

      if (Object.prototype.hasOwnProperty.call(changes, 'state')) {
        if (nextState === 'current') {
          nextRow.is_current = true
          nextRow.end_date = ''
        } else if (nextState === 'switched') {
          nextRow.is_current = false
        } else if (nextState === 'exited' || nextState === 'graduated') {
          nextRow.is_current = false
        }
        if (nextState !== 'current' && nextState !== 'graduated') {
          nextRow.final_gpa = ''
        }
      }

      if (nextRow.is_current) nextRow.end_date = ''
      return nextRow
    })

    commit(nextRows)
  }

  const updateRow = (index, key, value) => {
    const normalizedValue = key === 'start_date' || key === 'end_date'
      ? sanitizeDateInput(value)
      : normalizeLooseInput(value)
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [key]: normalizedValue } : row
    )))
  }

  const removeRow = (index) => {
    setMessage('')
    commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))
  }

  const addRecord = (value) => {
    const universityCollege = normalizeLooseInput(value)
    if (!universityCollege) {
      setMessage('يرجى إدخال الجامعة / الكليّة أولاً')
      return
    }
    setMessage('')
    commit([...normalizedRows, {
      university_college: universityCollege,
      major: '',
      degree: '',
      start_date: '',
      end_date: '',
      is_current: true,
      state: 'current',
      final_gpa: '',
    }])
    setOpen(false)
    setCustom(false)
    setQuery('')
    setDraft('')
  }

  const availableOptions = Array.from(new Map(
    universityOptions
      .map((option) => {
        const value = normalizeLooseInput(option?.value || option)
        const label = option?.label || value
        return value ? [value.toLowerCase(), { value, label }] : null
      })
      .filter(Boolean)
  ).values())

  const filteredOptions = availableOptions.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
  const degreeChoiceOptions = degreeOptions.length
    ? degreeOptions
    : [{ value: 'بكالوريوس' }, { value: 'ماجستير' }, { value: 'دكتوراه' }, { value: 'دبلوم' }]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const stateLabel = higherEducationStateLabel(row.state)

        return (
          <div key={`higher-education-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.university_college || '—'}</div>
                {stateLabel ? <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{stateLabel}</span> : null}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الجامعة / الكليّة</span>
                <ComboDropdown value={row.university_college} onChange={(value) => updateRow(index, 'university_college', value)} options={universityOptions} placeholder="—" />
              </label>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>التخصّص</span>
                  <ComboDropdown value={row.major} onChange={(value) => updateRow(index, 'major', value)} options={majorOptions} placeholder="—" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الدرجة العلميّة</span>
                  <ComboDropdown value={row.degree} onChange={(value) => updateRow(index, 'degree', value)} options={degreeChoiceOptions} placeholder="—" />
                </label>
              </div>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ البداية</span>
                  <input
                    className="combo-input"
                    type="date"
                    value={row.start_date || ''}
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    onChange={(event) => updateRow(index, 'start_date', event.target.value)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ النهاية</span>
                  {!row.is_current ? (
                    <input
                      className="combo-input"
                      type="date"
                      value={row.end_date || ''}
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                      onChange={(event) => updateRow(index, 'end_date', event.target.value)}
                    />
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>السجل ما يزال نشطًا</div>
                  )}
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>حالة السجل</span>
                <SelectDropdown
                  value={row.state}
                  onChange={(value) => commitRowChanges(index, { state: value })}
                  options={HIGHER_EDUCATION_STATE_OPTIONS}
                  placeholder="اختر الحالة…"
                />
              </label>
              {row.state === 'current' || row.state === 'graduated' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>المعدل التراكمي</span>
                  <input
                    className="combo-input"
                    value={row.final_gpa || ''}
                    placeholder="مثال: 3.6/4 أو 84%"
                    onChange={(event) => updateRow(index, 'final_gpa', normalizeFinalGpaValue(event.target.value))}
                  />
                </label>
              ) : null}
            </div>
          </div>
        )
      })}

      {!custom ? (
        <div ref={ref} style={{ position: 'relative' }}>
          <button type="button" className="combo-trigger" onClick={() => { setOpen((current) => !current); setQuery(''); setMessage('') }}>
            <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              أضف سجل تعليم عالٍ…
            </span>
            <span style={{ color: 'var(--gray-400)', fontSize: '0.7rem', flexShrink: 0 }}>▾</span>
          </button>
          {open && (
            <div className="combo-dropdown">
              <input
                autoFocus
                className="combo-search"
                placeholder="بحث…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
              />
              <div className="combo-list">
                {filteredOptions.length === 0 && (
                  <div style={{ padding: '8px 12px', color: 'var(--gray-400)', fontSize: '0.82rem' }}>لا توجد نتائج</div>
                )}
                {filteredOptions.map((option) => (
                  <button type="button" key={option.value} className="combo-item" onClick={() => addRecord(option.value)}>
                    {option.label}
                  </button>
                ))}
                <button type="button" className="combo-item combo-other" onClick={() => { setOpen(false); setQuery(''); setCustom(true); setMessage('') }}>
                  ＋ أخرى / اكتب يدوياً…
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus
            className="combo-input"
            style={{ flex: 1 }}
            placeholder="اكتب اسم الجامعة / الكليّة…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addRecord(draft)
              if (event.key === 'Escape') { setCustom(false); setDraft(''); setMessage('') }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addRecord(draft)}>إضافة</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCustom(false); setDraft(''); setMessage('') }}>✕</button>
        </div>
      )}

      {message && <div style={{ fontSize: '0.78rem', color: 'var(--red)' }}>{message}</div>}
    </div>
  )
}

function JobRowsEditor({ rows, onChange, jobTitleOptions = [], companyOptions = [] }) {
  const normalizedRows = normalizeJobRows(rows)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const commit = (nextRows) => onChange(normalizeJobRows(nextRows))

  const commitRowChanges = (index, changes) => {
    const nextRows = normalizedRows.map((entry, rowIndex) => {
      if (rowIndex !== index) return entry

      const nextRow = { ...entry, ...changes }
      const nextState = normalizeJobStateValue(nextRow.state, { isCurrent: nextRow.is_current })
      nextRow.state = nextState

      if (Object.prototype.hasOwnProperty.call(changes, 'state')) {
        if (nextState === 'current') {
          nextRow.is_current = true
          nextRow.end_date = ''
        } else {
          nextRow.is_current = false
        }
      }

      if (nextRow.is_current) nextRow.end_date = ''
      return nextRow
    })

    commit(nextRows)
  }

  const updateRow = (index, key, value) => {
    const normalizedValue = key === 'start_date' || key === 'end_date'
      ? sanitizeDateInput(value)
      : normalizeLooseInput(value)
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [key]: normalizedValue } : row
    )))
  }

  const removeRow = (index) => {
    setMessage('')
    commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))
  }

  const addRecord = (value) => {
    const jobTitle = normalizeLooseInput(value)
    if (!jobTitle) {
      setMessage('يرجى إدخال المسمّى الوظيفي أولاً')
      return
    }
    setMessage('')
    commit([...normalizedRows, {
      job_title: jobTitle,
      company: '',
      start_date: '',
      end_date: '',
      is_current: true,
      state: 'current',
    }])
    setOpen(false)
    setCustom(false)
    setQuery('')
    setDraft('')
  }

  const availableOptions = Array.from(new Map(
    jobTitleOptions
      .map((option) => {
        const value = normalizeLooseInput(option?.value || option)
        const label = option?.label || value
        return value ? [value.toLowerCase(), { value, label }] : null
      })
      .filter(Boolean)
  ).values())

  const filteredOptions = availableOptions.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const stateLabel = jobStateLabel(row.state)

        return (
          <div key={row.job_id || `job-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{jobRowLabel(row, index)}</div>
                {stateLabel ? <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{stateLabel}</span> : null}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>المسمّى الوظيفي</span>
                  <ComboDropdown value={row.job_title} onChange={(value) => updateRow(index, 'job_title', value)} options={jobTitleOptions} placeholder="—" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الشركة / المؤسسة</span>
                  <ComboDropdown value={row.company} onChange={(value) => updateRow(index, 'company', value)} options={companyOptions} placeholder="—" />
                </label>
              </div>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ البداية</span>
                  <input
                    className="combo-input"
                    type="date"
                    value={row.start_date || ''}
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    onChange={(event) => updateRow(index, 'start_date', event.target.value)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ النهاية</span>
                  {!row.is_current ? (
                    <input
                      className="combo-input"
                      type="date"
                      value={row.end_date || ''}
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                      onChange={(event) => updateRow(index, 'end_date', event.target.value)}
                    />
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>العمل الحالي لا يحتاج تاريخ نهاية</div>
                  )}
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الحالة</span>
                <SelectDropdown
                  value={row.state}
                  onChange={(value) => commitRowChanges(index, { state: value })}
                  options={JOB_STATE_OPTIONS}
                  placeholder="اختر الحالة…"
                />
              </label>
            </div>
          </div>
        )
      })}

      {!custom ? (
        <div ref={ref} style={{ position: 'relative' }}>
          <button type="button" className="combo-trigger" onClick={() => { setOpen((current) => !current); setQuery(''); setMessage('') }}>
            <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              أضف سجل عمل…
            </span>
            <span style={{ color: 'var(--gray-400)', fontSize: '0.7rem', flexShrink: 0 }}>▾</span>
          </button>
          {open && (
            <div className="combo-dropdown">
              <input
                autoFocus
                className="combo-search"
                placeholder="بحث…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
              />
              <div className="combo-list">
                {filteredOptions.length === 0 && (
                  <div style={{ padding: '8px 12px', color: 'var(--gray-400)', fontSize: '0.82rem' }}>لا توجد نتائج</div>
                )}
                {filteredOptions.map((option) => (
                  <button type="button" key={option.value} className="combo-item" onClick={() => addRecord(option.value)}>
                    {option.label}
                  </button>
                ))}
                <button type="button" className="combo-item combo-other" onClick={() => { setOpen(false); setQuery(''); setCustom(true); setMessage('') }}>
                  ＋ أخرى / اكتب يدوياً…
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus
            className="combo-input"
            style={{ flex: 1 }}
            placeholder="اكتب المسمّى الوظيفي…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addRecord(draft)
              if (event.key === 'Escape') { setCustom(false); setDraft(''); setMessage('') }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addRecord(draft)}>إضافة</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCustom(false); setDraft(''); setMessage('') }}>✕</button>
        </div>
      )}

      {message && <div style={{ fontSize: '0.78rem', color: 'var(--red)' }}>{message}</div>}
    </div>
  )
}

function ResponsibilityRowsEditor({ rows, onChange, youthGroupOptions = [], responsibilityOptions = [], activeJecYear = '', resolveYouthGroupLabel = (value) => value }) {
  const normalizedRows = normalizeResponsibilityRows(rows, { activeJecYear })

  const commit = (nextRows) => onChange(normalizeResponsibilityRows(nextRows, { activeJecYear }))

  const updateRow = (index, key, value) => {
    const normalizedValue = key === 'start_date' || key === 'end_date'
      ? sanitizeDateInput(value)
      : normalizeLooseInput(value)

    const nextRows = normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row

      const nextRow = { ...row, [key]: normalizedValue }
      if (key === 'is_current' && normalizedValue === 'true') nextRow.end_date = ''
      return nextRow
    })

    commit(nextRows)
  }

  const removeRow = (index) => {
    commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))
  }

  const addRow = () => {
    commit([
      ...normalizedRows,
      {
        youth_group_id: '',
        jec_year: '',
        is_current: true,
        responsibility: '',
        start_date: '',
        end_date: '',
      },
    ])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const stateLabel = responsibilityCurrentLabel(row?.is_current === true || row?.is_current === 'true')
        const title = normalizeLooseInput(row?.responsibility) || `المسؤولية ${index + 1}`
        const currentYouthGroupId = String(row?.youth_group_id || '').trim()
        const rowYouthGroupOptions = currentYouthGroupId && !youthGroupOptions.some((option) => String(option?.value || '').trim() === currentYouthGroupId)
          ? [...youthGroupOptions, { value: currentYouthGroupId, label: resolveYouthGroupLabel(currentYouthGroupId) || currentYouthGroupId }]
          : youthGroupOptions

        return (
          <div key={`responsibility-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{title}</div>
                <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{stateLabel}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                حذف
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الشبيبة</span>
                  <SelectDropdown
                    value={row.youth_group_id || ''}
                    onChange={(value) => updateRow(index, 'youth_group_id', value)}
                    options={rowYouthGroupOptions}
                    placeholder="اختر الشبيبة…"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>المسؤولية</span>
                  <ComboDropdown
                    value={row.responsibility || ''}
                    onChange={(value) => updateRow(index, 'responsibility', value)}
                    options={responsibilityOptions}
                    placeholder="اختر المسؤولية…"
                    customActionLabel="اكتب المسؤولية يدوياً…"
                    customInputPlaceholder="اكتب المسؤولية…"
                  />
                </label>
              </div>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الحالة</span>
                  <SelectDropdown
                    value={row.is_current === true ? 'true' : row.is_current === false ? 'false' : String(row.is_current || '')}
                    onChange={(value) => updateRow(index, 'is_current', value)}
                    options={RESPONSIBILITY_CURRENT_OPTIONS}
                    placeholder="اختر الحالة…"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>سنة JEC</span>
                  <input
                    className="combo-input"
                    value={row.jec_year || ''}
                    inputMode="numeric"
                    placeholder="مثال: 2025"
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    onChange={(event) => updateRow(index, 'jec_year', event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                  />
                </label>
              </div>

              <div className="profile-two-column-layout">
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ البداية</span>
                  <input
                    className="combo-input"
                    type="date"
                    value={row.start_date || ''}
                    dir="ltr"
                    style={{ textAlign: 'left' }}
                    onChange={(event) => updateRow(index, 'start_date', event.target.value)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>تاريخ النهاية</span>
                  {row.is_current === true ? (
                    <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>المسؤولية الحالية لا تحتاج تاريخ نهاية</div>
                  ) : (
                    <input
                      className="combo-input"
                      type="date"
                      value={row.end_date || ''}
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                      onChange={(event) => updateRow(index, 'end_date', event.target.value)}
                    />
                  )}
                </label>
              </div>
            </div>
          </div>
        )
      })}

      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة مسؤولية</button>
    </div>
  )
}

// ── Editable sub-table ────────────────────────────────────────────────────────
function SubTable({ rows, setRows, columns }) {
  // NOTE: setRows here is NOT a React state setter — it's a plain callback from the parent.
  // We must never pass a functional updater (prev => ...) to it; always pass the new value directly.
  const safeRows = Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === 'object' ? row : {}))
    : []
  const safeColumns = Array.isArray(columns) ? columns : []
  const update = (i, k, v) => setRows(safeRows.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const remove = (i) => setRows(safeRows.filter((_, idx) => idx !== i))
  const addRow = () => setRows([...safeRows, Object.fromEntries(safeColumns.map(c => [c.key, '']))])

  return (
    <div>
      {safeRows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {safeColumns.map(c => <th key={c.key}>{c.label}</th>)}
            <th style={{ width: 40 }}></th>
          </tr></thead>
          <tbody>
            {safeRows.map((row, i) => (
              <tr key={i}>
                {safeColumns.map(c => (
                  <td key={c.key}>
                    {c.yearFrom !== undefined
                      ? <YearPicker value={row[c.key]} onChange={v => update(i, c.key, v)} fromYear={c.yearFrom} />
                      : c.selectOptions
                        ? <SelectDropdown value={row[c.key]} onChange={v => update(i, c.key, v)} options={c.selectOptions} />
                        : c.comboOptions
                          ? <ComboDropdown value={row[c.key]} onChange={v => update(i, c.key, v)} options={c.comboOptions} />
                          : c.options
                            ? <SelectDropdown value={row[c.key]} onChange={v => update(i, c.key, v)} options={c.options.map(o => ({ value: o }))} />
                                : <input type={c.inputType || 'text'} value={row[c.key] || ''} onChange={e => update(i, c.key, e.target.value)} />}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)' }}
                    onClick={() => remove(i)}
                  ><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة سطر</button>
    </div>
  )
}

function normalizeAddressEditorRows(rows) {
  const source = Array.isArray(rows) && rows.length ? rows : [{ ...DEFAULT_ADDRESS_ROW }]
  const normalized = source.map((row, index) => ({
    country: normalizeCountryValue(row?.country),
    governorate: preserveLooseInput(row?.governorate),
    city: preserveLooseInput(row?.city),
    address: preserveLooseInput(row?.address ?? row?.street_address),
    location_url: String(row?.location_url || '').trim(),
    lat: sanitizeStoredCoordinate(row?.lat, 'lat'),
    lng: sanitizeStoredCoordinate(row?.lng, 'lng'),
    is_primary: Boolean(row?.is_primary),
  }))
  const primaryIndex = normalized.findIndex(row => row.is_primary)
  normalized.forEach((row, index) => { row.is_primary = index === (primaryIndex >= 0 ? primaryIndex : 0) })
  return normalized
}

function sanitizeAddressRows(rows) {
  const source = normalizeAddressEditorRows(rows)
  return source.map((row) => ({
    ...row,
    governorate: normalizeLooseInput(row.governorate),
    city: normalizeLooseInput(row.city),
    address: normalizeLooseInput(row.address),
    street_address: normalizeLooseInput(row.address),
    location_url: String(row.location_url || '').trim() || null,
    lat: sanitizeStoredCoordinate(row.lat, 'lat'),
    lng: sanitizeStoredCoordinate(row.lng, 'lng'),
  }))
}

function AddressRowsEditor({ rows, onChange, governorateOptions, locationOnly = false }) {
  const normalizedRows = normalizeAddressEditorRows(rows)
  const primaryIndex = normalizedRows.findIndex(row => row.is_primary)
  const targetIndex = primaryIndex >= 0 ? primaryIndex : 0
  const renderedRows = locationOnly
    ? [normalizedRows[targetIndex] || { ...DEFAULT_ADDRESS_ROW }]
    : normalizedRows
  const [mapDrafts, setMapDrafts] = useState({})
  const [mapEditors, setMapEditors] = useState({})
  const [mapErrors, setMapErrors] = useState({})

  const commit = (nextRows) => onChange(normalizeAddressEditorRows(nextRows))
  const resolveIndex = (index) => (locationOnly ? targetIndex : index)
  const updateRow = (index, key, value) => commit(normalizedRows.map((row, rowIndex) => (
    rowIndex === resolveIndex(index) ? { ...row, [key]: value } : row
  )))
  const openMapEditor = (index) => {
    const actualIndex = resolveIndex(index)
    const currentRow = normalizedRows[actualIndex] || { ...DEFAULT_ADDRESS_ROW }
    const existingUrl = String(currentRow.location_url || '').trim() || buildGoogleMapsOpenUrl(currentRow) || ''
    setMapEditors(prev => ({ ...prev, [actualIndex]: true }))
    setMapDrafts(prev => ({ ...prev, [actualIndex]: existingUrl }))
    setMapErrors(prev => ({ ...prev, [actualIndex]: '' }))
  }
  const closeMapEditor = (index) => {
    const actualIndex = resolveIndex(index)
    setMapEditors(prev => ({ ...prev, [actualIndex]: false }))
    setMapDrafts(prev => ({ ...prev, [actualIndex]: '' }))
    setMapErrors(prev => ({ ...prev, [actualIndex]: '' }))
  }
  const applyMapUrl = async (index) => {
    const actualIndex = resolveIndex(index)
    const draft = String(mapDrafts[actualIndex] || '').trim()
    if (!draft) {
      setMapErrors(prev => ({ ...prev, [actualIndex]: 'ألصق رابط Google Maps أولاً' }))
      return
    }
    const parsed = parseGoogleMapsUrl(draft)
    if (!parsed.isGoogleMapsUrl) {
      setMapErrors(prev => ({ ...prev, [actualIndex]: 'الرابط ليس من Google Maps' }))
      return
    }
    let lat = sanitizeStoredCoordinate(parsed.lat, 'lat')
    let lng = sanitizeStoredCoordinate(parsed.lng, 'lng')
    if (lat == null || lng == null) {
      try {
        const resolved = await api.resolveGoogleMapsLocation(draft)
        lat = sanitizeStoredCoordinate(resolved?.lat, 'lat')
        lng = sanitizeStoredCoordinate(resolved?.lng, 'lng')
      } catch {
        setMapErrors(prev => ({ ...prev, [actualIndex]: 'تعذر استخراج الموقع من هذا الرابط' }))
        return
      }
    }
    if (lat == null || lng == null) {
      setMapErrors(prev => ({ ...prev, [actualIndex]: 'تعذر استخراج الموقع من هذا الرابط' }))
      return
    }
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === actualIndex
        ? {
            ...row,
            location_url: draft,
            lat,
            lng,
          }
        : row
    )))
    closeMapEditor(actualIndex)
  }
  const removeMapLocation = (index) => {
    const actualIndex = resolveIndex(index)
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === actualIndex ? { ...row, location_url: '', lat: null, lng: null } : row
    )))
    closeMapEditor(actualIndex)
  }
  const setPrimary = (index) => commit(normalizedRows.map((row, rowIndex) => ({ ...row, is_primary: rowIndex === index })))
  const addRow = () => commit([...normalizedRows, { ...DEFAULT_ADDRESS_ROW, is_primary: false }])
  const removeRow = (index) => {
    const nextRows = normalizedRows.filter((_, rowIndex) => rowIndex !== index)
    commit(nextRows.length ? nextRows : [{ ...DEFAULT_ADDRESS_ROW }])
  }

  return (
    <div className="am-address-stack">
      {renderedRows.map((row, index) => {
        const actualIndex = resolveIndex(index)
        const addressSummary = [row?.address, row?.city, row?.governorate, row?.country]
          .map(value => String(value || '').trim())
          .filter(Boolean)
          .join('، ')
        return (
        <div key={index} className="am-address-card">
          <div className="am-address-card-header">
            <div>
              <div className="am-address-card-title">{locationOnly ? 'موقع المنزل' : `عنوان ${index + 1}`}</div>
              <div className="am-address-card-subtitle">
                {locationOnly
                  ? 'يمكنك هنا حفظ رابط Google Maps لموقعك فقط. باقي تفاصيل العنوان يديرها المشرف.'
                  : 'أدخل المحافظة ثم المدينة ثم العنوان التفصيلي، ثم أضف موقع المنزل عند الحاجة'}
              </div>
            </div>
            {!locationOnly && <div className="am-address-card-actions">
              {!row.is_primary && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrimary(index)}>
                  تعيين كرئيسي
                </button>
              )}
              {row.is_primary && (
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803d' }}>العنوان الرئيسي</span>
              )}
              {normalizedRows.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
                  حذف
                </button>
              )}
            </div>}
          </div>

          <div className="am-address-grid">
            {!locationOnly && <div className="am-address-field">
              <div className="am-field-hint am-address-label">البلد</div>
              <input className="form-control" value={normalizeCountryValue(row.country)} onChange={e => updateRow(index, 'country', normalizeCountryValue(e.target.value))} placeholder="الأردن" />
            </div>}

            {!locationOnly && <div className="am-address-field">
              <div className="am-field-hint am-address-label">المحافظة / الولاية</div>
              <ComboDropdown value={row.governorate} onChange={value => updateRow(index, 'governorate', value)} options={governorateOptions} placeholder="—" />
            </div>}

            {!locationOnly && <div className="am-address-field">
              <div className="am-field-hint am-address-label">المدينة</div>
              <input className="form-control" value={row.city || ''} onChange={e => updateRow(index, 'city', e.target.value)} placeholder="مثال: عمّان" />
            </div>}

            {!locationOnly && <div className="am-address-field am-address-field-wide">
              <div className="am-field-hint am-address-label">العنوان التفصيلي</div>
              <input className="form-control" value={row.address || ''} onChange={e => updateRow(index, 'address', e.target.value)} placeholder="مثال: جبل الحسين، قرب الكنيسة اللاتينية، شارع 12" />
            </div>}

            {locationOnly && addressSummary && (
              <div className="am-address-field am-address-field-wide">
                <div className="am-field-hint am-address-label">العنوان الحالي</div>
                <div className="view-value">{addressSummary}</div>
              </div>
            )}

            <div className="am-address-field am-address-field-wide">
              <div className="am-field-hint am-address-label">موقع المنزل</div>
              {(!buildGoogleMapsOpenUrl(row) || mapEditors[actualIndex]) ? (
                <div className="am-address-map-editor">
                  <input
                    className="form-control"
                    value={mapDrafts[actualIndex] || ''}
                    onChange={e => {
                      const nextValue = e.target.value
                      setMapDrafts(prev => ({ ...prev, [actualIndex]: nextValue }))
                      setMapErrors(prev => ({ ...prev, [actualIndex]: '' }))
                    }}
                    placeholder="ألصق رابط Google Maps هنا"
                    dir="ltr"
                  />
                  <div className="am-address-map-editor-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyMapUrl(index)}>حفظ الموقع</button>
                    {buildGoogleMapsOpenUrl(row) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeMapLocation(index)}>حذف الموقع</button>}
                    {buildGoogleMapsOpenUrl(row) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeMapEditor(index)}>إلغاء</button>}
                  </div>
                  {mapErrors[actualIndex] && <div className="am-field-error"><AlertCircle size={13} style={{ flexShrink: 0 }} /> {mapErrors[actualIndex]}</div>}
                </div>
              ) : (
                <div className="am-address-map-meta">
                  <button type="button" className="am-address-map-icon active" title="فتح موقع المنزل" onClick={() => window.open(buildGoogleMapsOpenUrl(row), '_blank', 'noopener,noreferrer')}>
                    <MapPin size={16} />
                  </button>
                  <button type="button" className="am-address-map-icon" title="تعديل موقع المنزل" onClick={() => openMapEditor(index)}>
                    <Pencil size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )})}
      {!locationOnly && <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة عنوان</button>}
    </div>
  )
}

// ── Inline field variants ─────────────────────────────────────────────────────
function InlineField({ label, value, onChange, dir = 'rtl' }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div className="editable-inline" style={{ flex: 1 }}>
        <input
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="—"
          dir={dir}
          style={dir === 'ltr' ? { direction: 'ltr', textAlign: 'left' } : undefined}
        />
        <Pencil size={12} className="edit-icon" />
      </div>
    </div>
  )
}

function InlineComboField({ label, value, onChange, options, dir = 'rtl' }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <ComboDropdown value={value} onChange={onChange} options={options} dir={dir} />
      </div>
    </div>
  )
}

function InlineSelectField({ label, value, onChange, options, dir = 'rtl' }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <SelectDropdown value={value} onChange={onChange} options={options} dir={dir} />
      </div>
    </div>
  )
}

function InlineYearField({ label, value, onChange, fromYear = 1960 }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <YearPicker value={value} onChange={onChange} fromYear={fromYear} />
      </div>
    </div>
  )
}

function InlineBirthDateField({ label, day, month, legacyValue, onChange }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <BirthDatePicker day={day} month={month} legacyValue={legacyValue} onChange={onChange} />
      </div>
    </div>
  )
}

function InlineDobField({ label, year, day, month, legacyValue, onChange, fromYear = 1960 }) {
  const [monthState, setMonthState] = useState('')
  const [dayState, setDayState] = useState('')

  useEffect(() => {
    const normalizedDay = toDatePart(day, 1, 31)
    const normalizedMonth = toDatePart(month, 1, 12)
    if (normalizedDay || normalizedMonth) {
      setDayState(normalizedDay)
      setMonthState(normalizedMonth)
      return
    }
    const legacy = parseLegacyBirthDate(legacyValue)
    setDayState(legacy.day)
    setMonthState(legacy.month)
  }, [day, month, legacyValue])

  const daysInMonth = monthState ? new Date(2000, parseInt(monthState, 10), 0).getDate() : 31
  const days = Array.from({ length: daysInMonth }, (_, index) => index + 1)
  const normalizedYear = year === null || year === undefined || year === '' ? '' : String(year)
  const currentYear = new Date().getFullYear()
  const years = []
  for (let value = currentYear; value >= fromYear; value--) years.push(value)

  const emit = ({ nextYear = normalizedYear, nextDay = dayState, nextMonth = monthState } = {}) => {
    setDayState(nextDay)
    setMonthState(nextMonth)
    onChange(nextYear, nextDay, nextMonth)
  }

  const partStyle = { display: 'flex', flexDirection: 'column', gap: 4 }
  const titleStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--gray-400)', textAlign: 'center' }

  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr) 110px', gap: 8, alignItems: 'end' }}>
          <div style={partStyle}>
            <div style={titleStyle}>اليوم</div>
            <select
              className="combo-trigger"
              style={{ cursor: 'pointer' }}
              value={dayState}
              onChange={e => emit({ nextDay: e.target.value })}
            >
              <option value="">—</option>
              {days.map(value => <option key={value} value={String(value)}>{value}</option>)}
            </select>
          </div>
          <div style={partStyle}>
            <div style={titleStyle}>الشهر</div>
            <select
              className="combo-trigger"
              style={{ cursor: 'pointer' }}
              value={monthState}
              onChange={e => emit({ nextMonth: e.target.value })}
            >
              <option value="">—</option>
              {MONTHS.map(item => (
                <option key={item.num} value={String(item.num)}>{item.num}</option>
              ))}
            </select>
          </div>
          <div style={partStyle}>
            <div style={titleStyle}>السنة</div>
            <select
              className="combo-trigger"
              style={{ cursor: 'pointer' }}
              value={normalizedYear}
              onChange={e => emit({ nextYear: e.target.value })}
            >
              <option value="">—</option>
              {years.map(value => <option key={value} value={String(value)}>{value}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

function ViewField({ label, value, dir = 'rtl', tone = 'default' }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'grid', gap: 4, padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', background: tone === 'subtle' ? 'var(--gray-50)' : 'white' }}>
      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--gray-400)' }}>{label}</div>
      <div style={{ color: 'var(--navy)', direction: dir, textAlign: dir === 'ltr' ? 'left' : 'right', lineHeight: 1.6 }}>{value}</div>
    </div>
  )
}

function ViewSegmentedField({ label, parts, dir = 'rtl', tone = 'default', valueDir = dir }) {
  const items = Array.isArray(parts)
    ? parts.filter((part) => part && part.value !== null && part.value !== undefined && part.value !== '')
    : []

  if (!items.length) return null

  return (
    <div className={`view-segmented-field${tone === 'subtle' ? ' subtle' : ''}`}>
      <div className="view-segmented-field-label">{label}</div>
      <div className="view-segmented-parts" dir={dir}>
        {items.map((part) => (
          <div key={part.key || part.label} className="view-segmented-part">
            <div className="view-segmented-part-label">{part.label}</div>
            <div
              className="view-segmented-part-value"
              dir={part.dir || valueDir}
              style={{ textAlign: (part.dir || valueDir) === 'ltr' ? 'left' : 'right' }}
            >
              {part.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ViewChipList({ values, emptyText = '—' }) {
  const items = Array.isArray(values) ? values.filter(Boolean) : []
  if (!items.length) return <div style={{ color: 'var(--gray-400)' }}>{emptyText}</div>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map((value, index) => (
        <span key={`${value}-${index}`} style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', color: 'var(--navy)', padding: '6px 10px', borderRadius: 999, fontSize: '0.82rem', fontWeight: 600 }}>
          {value}
        </span>
      ))}
    </div>
  )
}

function ViewEmptyState({ text = 'لا توجد بيانات', style = null }) {
  return <div style={{ color: 'var(--gray-400)', textAlign: 'center', padding: '10px 0', ...style }}>{text}</div>
}

function formatDateSegment(value, padLength = 2) {
  const text = String(value || '').trim()
  if (!text) return ''
  return /^\d+$/.test(text) ? text.padStart(padLength, '0') : text
}

function formatSchoolPeriod(row) {
  const start = String(row?.start_date || '').trim()
  const end = String(row?.end_date || '').trim()
  if (start && end) return `${start} - ${end}`
  if (start && row?.is_current) return `${start} - حاليًّا`
  if (start) return start
  if (end) return end
  if (row?.is_current) return 'حاليًّا'
  return ''
}

function formatHigherEducationPeriod(row) {
  const start = String(row?.start_date || '').trim()
  const end = String(row?.end_date || '').trim()
  if (start && end) return `${start} - ${end}`
  if (start && row?.is_current) return `${start} - حاليًّا`
  if (start) return start
  if (end) return end
  if (row?.is_current) return 'حاليًّا'
  return ''
}

function formatJobPeriod(row) {
  const start = String(row?.start_date || '').trim()
  const end = String(row?.end_date || '').trim()
  const isCurrent = normalizeJobStateValue(row?.state, { isCurrent: Boolean(row?.is_current) }) === 'current'
  if (start && end) return `${start} - ${end}`
  if (start && isCurrent) return `${start} - حاليًّا`
  if (start) return start
  if (end) return end
  if (isCurrent) return 'حاليًّا'
  return ''
}

function formatResponsibilityPeriod(row) {
  const start = String(row?.start_date || '').trim()
  const end = String(row?.end_date || '').trim()
  if (start && end) return `${start} - ${end}`
  if (start) return `${start} - حاليًّا`
  if (end) return end
  return ''
}

function groupResponsibilitiesByYear(items) {
  const grouped = (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const year = String(item?.jecYear || '').trim()
    const bucketKey = year || '__missing_year__'
    if (!acc[bucketKey]) {
      acc[bucketKey] = {
        key: bucketKey,
        year,
        label: year ? `سنة ${year}` : 'مسؤوليات بدون سنة JEC محددة',
        items: [],
      }
    }
    acc[bucketKey].items.push(item)
    return acc
  }, {})

  return Object.values(grouped)
    .sort((left, right) => {
      if (!left.year && !right.year) return 0
      if (!left.year) return 1
      if (!right.year) return -1

      const leftNumber = Number(left.year)
      const rightNumber = Number(right.year)
      if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && leftNumber !== rightNumber) {
        return rightNumber - leftNumber
      }

      return right.year.localeCompare(left.year, 'ar')
    })
    .map((bucket) => ({
      ...bucket,
      items: bucket.items.slice().sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
        return String(left.responsibility || '').localeCompare(String(right.responsibility || ''), 'ar')
      }),
    }))
}

function formatSchoolDisplayName(row) {
  const school = String(row?.school || '').trim()
  const section = String(row?.section || '').trim()
  if (school && section) return `${school} - ${section}`
  return school || '—'
}

function resolveSchoolLogoUrl(entries, type, name, section) {
  const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const all = Array.isArray(entries) ? entries : []
  const nameKey = norm(name)
  if (!nameKey) return null
  const sectionKey = norm(section || '')
  // Exact name + section match
  const exact = all.find(
    (e) => e.type === type && norm(e.name) === nameKey && norm(e.section || '') === sectionKey && e.logo_url,
  )
  if (exact) return exact.logo_url
  // Fall back to school-wide entry (empty section) when section was specified
  if (sectionKey && type === 'school') {
    const wide = all.find(
      (e) => e.type === type && norm(e.name) === nameKey && !norm(e.section || '') && e.logo_url,
    )
    if (wide) return wide.logo_url
  }
  return null
}

function ViewRecordCard({ title, badge, children, onOpenMap, actions, logoUrl, logoAlt, compact = false, highlighted = false }) {
  const [showLogo, setShowLogo] = useState(Boolean(logoUrl))
  const outerPadding = compact ? 10 : 12
  const logoSize = compact ? 46 : 56
  const logoRadius = compact ? 12 : 14
  const logoPadding = compact ? 6 : 7
  const headerMargin = children ? (compact ? 8 : 10) : 0
  const badgePadding = compact ? '3px 9px' : '4px 10px'
  const badgeFontSize = compact ? '0.72rem' : '0.76rem'

  useEffect(() => {
    setShowLogo(Boolean(logoUrl))
  }, [logoUrl])

  return (
    <div style={{ ...contactCardSurfaceStyle(highlighted), borderRadius: 'var(--radius-md)', padding: outerPadding }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: headerMargin, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 280px' }}>
          {showLogo ? (
            <span style={{ width: logoSize, height: logoSize, borderRadius: logoRadius, background: 'white', border: '1px solid var(--gray-200)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: logoPadding, flexShrink: 0, boxShadow: '0 4px 12px rgba(15, 39, 68, 0.08)' }}>
              <img src={logoUrl} alt={logoAlt || title || 'Logo'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} onError={() => setShowLogo(false)} />
            </span>
          ) : null}
          <div style={{ fontWeight: 700, color: 'var(--navy)', minWidth: 0 }}>{title || '—'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {badge ? <span style={{ background: 'white', border: '1px solid var(--gray-200)', color: 'var(--navy)', borderRadius: 999, padding: badgePadding, fontSize: badgeFontSize, fontWeight: 700 }}>{badge}</span> : null}
          {actions || null}
          {onOpenMap ? <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenMap}><MapPin size={14} /> فتح الموقع</button> : null}
        </div>
      </div>
      {children ? <div style={{ display: 'grid', gap: 10 }}>{children}</div> : null}
    </div>
  )
}

function SocialMediaCompactCard({ row, highlightPrimary = false }) {
  const href = buildSocialProfileUrl(row?.url)
  const theme = socialPlatformTheme(row?.platform)
  const platformLabel = socialPlatformLabel(row?.platform)
  const compactText = socialPlatformCompactText(row?.platform, row?.url)
  const Container = href ? 'a' : 'div'

  return (
    <Container
      href={href || undefined}
      target={href ? '_blank' : undefined}
      rel={href ? 'noopener noreferrer' : undefined}
      title={href || row?.url || platformLabel}
      aria-label={href ? `فتح ${platformLabel}` : platformLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        minWidth: 0,
        padding: '9px 10px',
        borderRadius: 12,
        ...contactCardSurfaceStyle(highlightPrimary),
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 10,
          background: theme.iconBackground,
          color: theme.iconColor,
          boxShadow: `0 8px 18px ${theme.cardShadow}`,
        }}
      >
        {socialPlatformIcon(row?.platform, 16)}
      </span>

      <span dir="ltr" style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1, textAlign: 'left', justifyItems: 'start' }}>
        <span dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap', textAlign: 'left', unicodeBidi: 'plaintext' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--navy)' }}>{platformLabel}</span>
        </span>
        <span
          dir="ltr"
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--gray-500)',
            fontSize: '0.75rem',
            fontWeight: 600,
            textAlign: 'left',
            unicodeBidi: 'plaintext',
          }}
        >
          {compactText}
        </span>
      </span>

    </Container>
  )
}

const MEMBERSHIP_AGE_GROUPS_DESC = ['العاملة', 'الجامعيّة', 'الثانوي', 'الإعدادي', 'البراعم']
const MEMBERSHIP_STATUS_OPTIONS = [
  { value: 'عضو حالي', label: 'عضو حالي' },
  { value: 'عضو قديم', label: 'عضو قديم' },
]

function youthMembershipAgeGroupRank(value) {
  return MEMBERSHIP_AGE_GROUPS_DESC.indexOf(normalizeLooseInput(value))
}

function canSelectYouthAgeGroup({ currentAgeGroup, candidateAgeGroup, allowHigherAgeGroups = false }) {
  if (allowHigherAgeGroups) return true

  const currentRank = youthMembershipAgeGroupRank(currentAgeGroup)
  const candidateRank = youthMembershipAgeGroupRank(candidateAgeGroup)
  if (currentRank < 0 || candidateRank < 0) return true

  return candidateRank >= currentRank
}

function normalizeYouthMembershipHistoryRows(rows) {
  const source = Array.isArray(rows) ? rows : []
  const seen = new Set()
  const normalized = []

  source.forEach((row) => {
    const ageGroup = normalizeLooseInput(row?.age_group)
    const startDate = sanitizeDateInput(row?.start_date)
    const endDate = sanitizeDateInput(row?.end_date)
    if (!ageGroup) return
    const dedupeKey = `${ageGroup}::${startDate}::${endDate}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    normalized.push({
      age_group: ageGroup,
      start_date: startDate,
      end_date: endDate,
    })
  })

  normalized.sort((left, right) => {
    const leftIndex = MEMBERSHIP_AGE_GROUPS_DESC.indexOf(left.age_group)
    const rightIndex = MEMBERSHIP_AGE_GROUPS_DESC.indexOf(right.age_group)
    const safeLeft = leftIndex >= 0 ? leftIndex : MEMBERSHIP_AGE_GROUPS_DESC.length
    const safeRight = rightIndex >= 0 ? rightIndex : MEMBERSHIP_AGE_GROUPS_DESC.length
    if (safeLeft !== safeRight) return safeLeft - safeRight
    return (left.start_date || '').localeCompare(right.start_date || '')
  })

  return normalized
}

function normalizeEditableYouthMembershipHistoryRows(rows) {
  const source = Array.isArray(rows) ? rows : []
  const normalized = source.map((row) => ({
    age_group: normalizeLooseInput(row?.age_group),
    start_date: sanitizeDateInput(row?.start_date),
    end_date: sanitizeDateInput(row?.end_date),
  }))

  if (!normalized.length) return []

  normalized.sort((left, right) => {
    const leftIndex = MEMBERSHIP_AGE_GROUPS_DESC.indexOf(left.age_group)
    const rightIndex = MEMBERSHIP_AGE_GROUPS_DESC.indexOf(right.age_group)
    const safeLeft = leftIndex >= 0 ? leftIndex : MEMBERSHIP_AGE_GROUPS_DESC.length
    const safeRight = rightIndex >= 0 ? rightIndex : MEMBERSHIP_AGE_GROUPS_DESC.length
    if (safeLeft !== safeRight) return safeLeft - safeRight
    return (left.start_date || '').localeCompare(right.start_date || '')
  })

  return normalized
}

function normalizeYouthMembershipStatusLabel(value, archived = false) {
  const statusLabel = normalizeLooseInput(value)
  if (statusLabel) return statusLabel
  return archived ? 'عضو قديم' : 'عضو حالي'
}

function normalizeYouthMembershipEditableHistoryForStatus(rows, statusLabel) {
  const normalized = normalizeEditableYouthMembershipHistoryRows(rows)
  if (normalizeYouthMembershipStatusLabel(statusLabel) !== 'عضو حالي' || !normalized.length) return normalized

  return normalized.map((entry, index) => (
    index === 0
      ? { ...entry, end_date: '' }
      : entry
  ))
}

function deriveCurrentYouthMembershipAgeGroup(row) {
  const historyRows = normalizeYouthMembershipHistoryRows(row?.age_group_history)
  if (historyRows.length) return historyRows[0].age_group
  return normalizeLooseInput(row?.current_age_group || row?.age_group)
}

function normalizeYouthMembershipRows(rows) {
  const source = Array.isArray(rows) ? rows : []
  return source.map((row) => {
    const statusLabel = normalizeYouthMembershipStatusLabel(row?.status_label, row?.archived)
    const editableAgeGroupHistory = normalizeYouthMembershipEditableHistoryForStatus(row?.age_group_history, statusLabel)
    const ageGroupHistory = normalizeYouthMembershipHistoryRows(editableAgeGroupHistory)
    const currentAgeGroup = deriveCurrentYouthMembershipAgeGroup({ ...row, age_group_history: ageGroupHistory })
    return {
      ...row,
      youth_group_id: normalizeLooseInput(row?.youth_group_id),
      youth_join_year: row?.youth_join_year === null || row?.youth_join_year === undefined ? '' : String(row.youth_join_year),
      age_group_history: editableAgeGroupHistory,
      current_age_group: currentAgeGroup,
      age_group: currentAgeGroup,
      status_label: statusLabel,
    }
  })
}

function serializeYouthMembershipRows(rows) {
  return normalizeYouthMembershipRows(rows).map(({ status_label, current_age_group, age_group_history, ...rest }) => ({
    ...rest,
    archived: status_label === 'عضو قديم',
    age_group: current_age_group || null,
    age_group_history: age_group_history.map((entry) => ({
      age_group: entry.age_group || null,
      start_date: entry.start_date || null,
      end_date: entry.end_date || null,
    })),
  }))
}

function formatYouthMembershipHistoryPeriod(row) {
  const start = sanitizeDateInput(row?.start_date)
  const end = sanitizeDateInput(row?.end_date)
  if (start && end) return `${start} - ${end}`
  if (start) return `${start} - حاليًّا`
  if (end) return end
  return 'غير محدد'
}

function YouthMembershipHistoryView({ rows }) {
  const items = normalizeYouthMembershipHistoryRows(rows)
  if (!items.length) return <ViewEmptyState text="لا يوجد تسلسل فئات محفوظ" />

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((item, index) => (
        <div
          key={`${item.age_group || 'age'}-${item.start_date || 'start'}-${item.end_date || 'end'}-${index}`}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 0.9fr) minmax(140px, 1.1fr)',
            gap: 8,
            alignItems: 'center',
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid var(--gray-200)',
            background: 'white',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{item.age_group}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--gray-500)' }}>{formatYouthMembershipHistoryPeriod(item)}</div>
        </div>
      ))}
    </div>
  )
}

function YouthMembershipCompactCard({ row, title, badge, logoUrl, logoAlt }) {
  const historyRows = normalizeYouthMembershipHistoryRows(row?.age_group_history)
  const currentAgeGroup = row?.current_age_group || row?.age_group
  const resolvedTitle = normalizeLooseInput(title) || 'الشبيبة'
  const membershipMetaParts = [
    currentAgeGroup ? { key: 'current-age-group', label: 'الفئة الحالية', value: currentAgeGroup } : null,
    row?.youth_join_year ? { key: 'join-year', label: 'سنة الانتساب', value: String(row.youth_join_year) } : null,
  ].filter(Boolean)

  return (
    <div
      style={{
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-md)',
        padding: 12,
        background: 'var(--gray-50)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 280px' }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, background: 'white', border: '1px solid rgba(15, 39, 68, 0.08)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 7, flexShrink: 0, boxShadow: '0 6px 14px rgba(15, 39, 68, 0.08)' }}>
            {logoUrl ? (
              <img src={logoUrl} alt={logoAlt || resolvedTitle || 'Youth Group'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            ) : (
              <Users size={18} color="var(--navy)" />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '0.98rem', lineHeight: 1.2 }}>{resolvedTitle}</div>
          </div>
        </div>
        {badge ? (
          <span style={{ fontSize: '0.76rem', color: 'var(--gray-500)', fontWeight: 700, background: 'white', border: '1px solid var(--gray-200)', borderRadius: 999, padding: '5px 10px' }}>
            {badge}
          </span>
        ) : null}
      </div>

      {membershipMetaParts.length ? (
        <div style={{ marginBottom: 10 }}>
          <ViewSegmentedField label="العضوية" parts={membershipMetaParts} tone="subtle" />
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--gray-400)' }}>الفئات العمرية</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {historyRows.map((item, index) => (
            <div
              key={`${item.age_group || 'age'}-${item.start_date || 'start'}-${item.end_date || 'end'}-${index}`}
              style={{
                display: 'grid',
                gap: 6,
                padding: '12px 14px',
                borderRadius: 14,
                background: 'white',
                border: '1px solid rgba(15, 39, 68, 0.08)',
                boxShadow: '0 6px 16px rgba(15, 39, 68, 0.04)',
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--navy)', lineHeight: 1.35, minWidth: 0, overflowWrap: 'anywhere' }}>
                {item.age_group}
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                <span style={{ fontSize: '0.76rem', color: 'var(--gray-500)', fontWeight: 700, background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 999, padding: '5px 10px' }}>
                  {formatYouthMembershipHistoryPeriod(item)}
                </span>
              </div>
            </div>
          ))}
          {!historyRows.length ? (
            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: '12px 14px',
                borderRadius: 14,
                background: 'white',
                border: '1px solid rgba(15, 39, 68, 0.08)',
                boxShadow: '0 6px 16px rgba(15, 39, 68, 0.04)',
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--navy)', lineHeight: 1.35 }}>لا توجد فئات عمرية محفوظة</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function YouthMembershipEditor({ rows, onChange, youthGroupOptions, allowHigherAgeGroups = false }) {
  const normalizedRows = normalizeYouthMembershipRows(rows)
  const ageGroupOptions = MEMBERSHIP_AGE_GROUPS_DESC.map((value) => ({ value, label: value }))

  const commit = (nextRows) => onChange(serializeYouthMembershipRows(nextRows))
  const updateMembershipRow = (index, key, value) => {
    commit(normalizedRows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }
  const removeMembershipRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))
  const addMembershipRow = () => commit([
    ...normalizedRows,
    { youth_group_id: '', youth_join_year: '', status_label: 'عضو حالي', age_group_history: [] },
  ])

  const updateHistoryRow = (membershipIndex, historyIndex, key, value) => {
    commit(normalizedRows.map((membershipRow, rowIndex) => {
      if (rowIndex !== membershipIndex) return membershipRow

      if (
        key === 'age_group'
        && !canSelectYouthAgeGroup({
          currentAgeGroup: membershipRow.current_age_group,
          candidateAgeGroup: value,
          allowHigherAgeGroups,
        })
      ) {
        return membershipRow
      }

      return {
        ...membershipRow,
        age_group_history: membershipRow.age_group_history.map((historyRow, entryIndex) => (
          entryIndex === historyIndex
            ? {
                ...historyRow,
                [key]: key === 'start_date' || key === 'end_date' ? sanitizeDateInput(value) : value,
              }
            : historyRow
        )),
      }
    }))
  }

  const addHistoryRow = (membershipIndex) => {
    commit(normalizedRows.map((membershipRow, rowIndex) => (
      rowIndex === membershipIndex
        ? {
            ...membershipRow,
            age_group_history: [
              ...membershipRow.age_group_history,
              { age_group: '', start_date: '', end_date: '' },
            ],
          }
        : membershipRow
    )))
  }

  const removeHistoryRow = (membershipIndex, historyIndex) => {
    commit(normalizedRows.map((membershipRow, rowIndex) => (
      rowIndex === membershipIndex
        ? {
            ...membershipRow,
            age_group_history: membershipRow.age_group_history.filter((_, entryIndex) => entryIndex !== historyIndex),
          }
        : membershipRow
    )))
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {normalizedRows.map((row, index) => (
        <div key={`membership-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)', display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.current_age_group || 'بدون فئة حالية'}</span>
              <span style={{ background: 'white', border: '1px solid var(--gray-200)', color: 'var(--gray-500)', borderRadius: 999, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 700 }}>{row.status_label}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeMembershipRow(index)}>
              حذف الشبيبة
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-500)' }}>اسم الشبيبة</span>
              <SelectDropdown value={row.youth_group_id} onChange={(value) => updateMembershipRow(index, 'youth_group_id', value)} options={youthGroupOptions} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-500)' }}>سنة الانتساب</span>
              <YearPicker value={row.youth_join_year} onChange={(value) => updateMembershipRow(index, 'youth_join_year', value)} fromYear={1964} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-500)' }}>الحالة</span>
              <SelectDropdown value={row.status_label} onChange={(value) => updateMembershipRow(index, 'status_label', value)} options={MEMBERSHIP_STATUS_OPTIONS} />
            </label>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--navy)' }}>الفئات العمرية ضمن هذه الشبيبة</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addHistoryRow(index)}>
                <Plus size={14} /> إضافة فئة عمرية
              </button>
            </div>
            {row.age_group_history.length ? row.age_group_history.map((historyRow, historyIndex) => {
              const disableEndDate = row.status_label === 'عضو حالي' && historyIndex === 0
              const availableAgeGroupOptions = ageGroupOptions.filter((option) => (
                canSelectYouthAgeGroup({
                  currentAgeGroup: row.current_age_group,
                  candidateAgeGroup: option.value,
                  allowHigherAgeGroups,
                }) || option.value === historyRow.age_group
              ))

              return (
              <div key={`membership-${index}-history-${historyIndex}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr) auto', gap: 8, alignItems: 'end', padding: 10, borderRadius: 12, background: 'white', border: '1px solid var(--gray-200)' }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--gray-500)' }}>الفئة العمرية</span>
                  <SelectDropdown value={historyRow.age_group} onChange={(value) => updateHistoryRow(index, historyIndex, 'age_group', value)} options={availableAgeGroupOptions} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--gray-500)' }}>من</span>
                  <input className="combo-input" type="date" value={historyRow.start_date || ''} onChange={(event) => updateHistoryRow(index, historyIndex, 'start_date', event.target.value)} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--gray-500)' }}>إلى</span>
                  <input className="combo-input" type="date" value={historyRow.end_date || ''} disabled={disableEndDate} onChange={(event) => updateHistoryRow(index, historyIndex, 'end_date', event.target.value)} />
                </label>
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeHistoryRow(index, historyIndex)}>
                  حذف
                </button>
              </div>
            )}) : <ViewEmptyState text="أضف الفئات التي مرّ بها العضو داخل هذه الشبيبة" />}
          </div>
        </div>
      ))}

      <button type="button" className="add-row-btn" onClick={addMembershipRow}><Plus size={14} /> إضافة شبيبة</button>
    </div>
  )
}

function ResponsibilityGroupCard({ groupName, groupId, items, logoUrl, logoAlt }) {
  const safeItems = Array.isArray(items) ? items : []
  const groupedItems = groupResponsibilitiesByYear(safeItems)

  return (
    <div
      style={{
        border: '1px solid var(--gray-200)',
        borderRadius: 'var(--radius-md)',
        padding: 10,
        background: 'var(--gray-50)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 280px' }}>
          <span style={{ width: 42, height: 42, borderRadius: 14, background: 'white', border: '1px solid rgba(15, 39, 68, 0.08)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 6, flexShrink: 0, boxShadow: '0 4px 10px rgba(15, 39, 68, 0.06)' }}>
            {logoUrl ? (
              <img src={logoUrl} alt={logoAlt || groupName || 'Youth Group'} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            ) : (
              <Shield size={16} color="var(--navy)" />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '0.92rem', lineHeight: 1.2 }}>{groupName || 'الشبيبة'}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {groupedItems.map((bucket) => (
          <div
            key={`${groupId || 'ungrouped'}-${bucket.key}`}
            style={{
              display: 'grid',
              gap: 8,
              padding: 10,
              borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.78)',
              border: '1px solid rgba(15, 39, 68, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: '0.74rem', color: bucket.year ? 'var(--navy)' : 'var(--gray-600)', fontWeight: 800, background: bucket.year ? 'rgba(15, 39, 68, 0.08)' : 'rgba(148, 163, 184, 0.14)', border: `1px solid ${bucket.year ? 'rgba(15, 39, 68, 0.12)' : 'rgba(148, 163, 184, 0.22)'}`, borderRadius: 999, padding: '5px 10px' }}>
                  {bucket.label}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
              {bucket.items.map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: 'grid',
                    gap: 6,
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: 'white',
                    border: '1px solid rgba(15, 39, 68, 0.08)',
                    boxShadow: '0 4px 10px rgba(15, 39, 68, 0.035)',
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', lineHeight: 1.4, minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 auto' }}>
                      {item.responsibility}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: item.isCurrent ? 'var(--green)' : 'var(--gray-600)', fontWeight: 700, background: item.isCurrent ? 'rgba(16, 185, 129, 0.12)' : 'rgba(148, 163, 184, 0.14)', border: `1px solid ${item.isCurrent ? 'rgba(16, 185, 129, 0.32)' : 'rgba(148, 163, 184, 0.24)'}`, borderRadius: 999, padding: '4px 9px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {responsibilityCurrentLabel(item.isCurrent)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {item.datePeriod ? (
                      <span style={{ fontSize: '0.72rem', color: 'var(--gray-500)', fontWeight: 700, background: 'rgba(201, 150, 60, 0.1)', border: '1px solid rgba(201, 150, 60, 0.28)', borderRadius: 999, padding: '4px 9px' }}>
                        {item.datePeriod}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function NationalitySectionView({ rows, lookup = null }) {
  const items = normalizeNationalityRows(rows, { lookup })
  if (!items.length) return <ViewEmptyState text="لا توجد بيانات جنسية" />

  return (
    <div className="profile-nationality-section">
      <div className="profile-nationality-grid">
        {items.map((row, index) => {
          const identifiers = [].filter(Boolean)

          return (
            <article key={`${row?.nationality || 'nat'}-${index}`} className="profile-nationality-card">
              <div className="profile-nationality-card-head">
                <div className="profile-nationality-card-title">
                  {renderNationalityLabel(row, { fallbackIcon: '🌍', gap: 8 })}
                </div>
              </div>

              <div className="profile-nationality-card-body">
                {identifiers.length ? (
                  <div className="profile-nationality-identifiers">
                    {identifiers.map((item) => (
                      <div key={item.label} className="profile-nationality-identifier-card">
                        <div className="profile-nationality-identifier-label">{item.label}</div>
                        <div className="profile-nationality-identifier-value" dir={item.dir}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

// ── Profile avatar ────────────────────────────────────────────────────────────
function ProfileAvatar({ personId, initials, photoUrl, onPhotoChange, toast, canUpload = false }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError]   = useState(false)
  useEffect(() => { setImgError(false) }, [photoUrl])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true)
    try {
      await api.uploadPhoto(personId, file)
      onPhotoChange(api.photoUrl(personId, Date.now()))
      toast('تم رفع الصورة بنجاح ✓', 'success')
    } catch (error) { toast(getApiErrorMessage(error, 'خطأ في رفع الصورة'), 'error') }
    setUploading(false); e.target.value = ''
  }
  const hasPhoto = photoUrl && !imgError

  return (
    <>
      <style>{`.profile-avatar-wrap:hover .avatar-cam-overlay{opacity:1!important}`}</style>
      <div className="profile-avatar profile-avatar-wrap"
        style={{ position: 'relative', cursor: canUpload ? 'pointer' : 'default', overflow: 'hidden', padding: hasPhoto ? 0 : undefined }}
        onClick={() => canUpload && !uploading && fileRef.current?.click()} title={canUpload ? 'انقر لتغيير الصورة' : undefined}>
        {hasPhoto
          ? <img src={photoUrl} alt="profile" onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }} />
          : <span>{uploading ? '…' : (initials || '؟')}</span>}
        {canUpload && <div className="avatar-cam-overlay" style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'rgba(0,0,0,0.42)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          opacity: 0, transition: 'opacity 0.18s', fontSize: '0.65rem', color: 'white', gap: 4, pointerEvents: 'none'
        }}><Camera size={22} /><span>تغيير الصورة</span></div>}
        {canUpload && <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }} onChange={handleFile} />}
      </div>
    </>
  )
}


// ── Unregistered profile avatar (uses uid-based photo endpoint) ───────────────
function UnregisteredProfileAvatar({ uid, initials, photoUrl, onPhotoChange, toast, canUpload = false }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError]   = useState(false)
  useEffect(() => { setImgError(false) }, [photoUrl])

  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true)
    try {
      await api.uploadUnregisteredPhoto(uid, file)
      onPhotoChange(api.unregisteredPhotoUrl(uid, Date.now()))
      toast('تم رفع الصورة بنجاح ✓', 'success')
    } catch (error) { toast(getApiErrorMessage(error, 'خطأ في رفع الصورة'), 'error') }
    setUploading(false); e.target.value = ''
  }
  const hasPhoto = photoUrl && !imgError

  return (
    <>
      <style>{`.profile-avatar-wrap:hover .avatar-cam-overlay{opacity:1!important}`}</style>
      <div className="profile-avatar profile-avatar-wrap"
        style={{
          position: 'relative', cursor: canUpload ? 'pointer' : 'default', overflow: 'hidden',
          padding: hasPhoto ? 0 : undefined,
          border: '2px dashed #e8b55a',
          background: hasPhoto ? 'transparent' : '#fffbeb',
        }}
        onClick={() => canUpload && !uploading && fileRef.current?.click()} title={canUpload ? 'انقر لتغيير الصورة' : undefined}>
        {hasPhoto
          ? <img src={photoUrl} alt="profile" onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }} />
          : <span style={{ color: '#b45309' }}>{uploading ? '…' : (initials || '؟')}</span>}
        {canUpload && <div className="avatar-cam-overlay" style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'rgba(0,0,0,0.42)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          opacity: 0, transition: 'opacity 0.18s', fontSize: '0.65rem', color: 'white', gap: 4, pointerEvents: 'none'
        }}><Camera size={22} /><span>تغيير الصورة</span></div>}
        {canUpload && <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }} onChange={handleFile} />}
      </div>
    </>
  )
}


// ── Mini node card used in org tab ────────────────────────────────────────────
function MiniNodeCard({ node }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        background: 'var(--navy)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.72rem', fontWeight: 700, color: 'white', flexShrink: 0, overflow: 'hidden'
      }}>
        {node.photo
          ? <img src={node.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : firstNameInitial(node.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--gray-800)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name || 'بدون اسم'}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--gold)' }}>
          {node.role || '—'}
        </div>
      </div>
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--gray-400)',
      marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function formatPeriodDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return d }
}

// Compare two date strings (YYYY-MM-DD or null).
// null means "still active / open end" → treated as infinity for max, and as today for overlap.
function minDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}
function maxDate(a, b) {
  if (!a || !b) return null   // null = still open
  return a > b ? a : b
}

// ── Bubble group-key logic (mirrored from OrgTree) ───────────────────────────
const AGE_GROUPS   = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
const COMMITTEES   = ['اللجنة الإعلاميّة', 'اللجنة الفنيّة', 'اللجنة الاجتماعيّة', 'لجنة الخدمة', 'لجنة العلاقات العامة', 'اللجنة اللوجستية', 'الفرقة الموسيقيّة', 'لجنة التنظيم', 'اللجنة الروحيّة', 'لجنة عمل المحبة', 'لجنة المواضيع', 'لجنة النشاطات', 'لجنة التدريب والتطوير']
const ACTING_PREFIX = 'قائم بأعمال '

function _isCompositeCommittee(str) {
  if (!str) return false
  if (COMMITTEES.includes(str)) return true
  const parts = str.split(/ و /).map(s => s.trim())
  return parts.length > 1 && parts.every(p => COMMITTEES.includes(p))
}

function _classifyRole(role) {
  if (!role) return null
  if (role.startsWith(ACTING_PREFIX)) role = role.slice(ACTING_PREFIX.length)
  if (role === 'المسؤول العام')         return { tier: 'general_manager' }
  if (role === 'المرشد الروحي')         return { tier: 'spiritual_guide' }
  if (role === 'مساعد المرشد الروحي')   return { tier: 'spiritual_guide_assistant' }
  if (/^مرشد روحي (فئة|فئتيّ|فئات)/.test(role)) return { tier: 'spiritual_guide_agegroup' }
  if (role === 'نائب المسؤول العام')    return { tier: 'reports_to_gm' }
  if (role === 'مستشار الشبيبة')        return { tier: 'reports_to_gm' }
  if (role === 'أمين السر')             return { tier: 'reports_to_gm' }
  if (role === 'أمين الصندوق')          return { tier: 'reports_to_gm' }
  if (role === 'أمين العهدة')           return { tier: 'reports_to_gm' }
  if (role === 'مساعد أمين السر' || role === 'مساعد أمين الصندوق' || role === 'مساعد أمين العهدة')
    return { tier: 'secretary_assistant' }
  if (role.startsWith('مسؤول ') && _isCompositeCommittee(role.slice('مسؤول '.length)))
    return { tier: 'reports_to_gm', committeeHead: true }
  if (_isCompositeCommittee(role))
    return { tier: 'committee_member', committee: role }
  if (/^مسؤول (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'reports_to_gm', councilHead: true }
  if (/^مجلس (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'council_head', councilHead: true }
  if (/^مسؤول مساعد في (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'council_assistant' }
  return null
}

function _extractGroups(role) {
  return AGE_GROUPS.filter(g => role.includes(g))
}

// Mirrors OrgTree's effectiveInGroup — uses node.inGroup if set, else derive from role
function _effectiveInGroup(node) {
  if (node.inGroup !== undefined && node.inGroup !== null) return node.inGroup
  const c = _classifyRole(node.role || '')
  if (!c) return false
  if (c.tier === 'reports_to_gm' && c.committeeHead)  return true
  if (c.tier === 'committee_member')                   return true
  if (c.tier === 'reports_to_gm' && c.councilHead)    return true
  if (c.tier === 'council_head')                       return true
  if (c.tier === 'spiritual_guide_agegroup')           return true
  return false
}

// Mirrors OrgTree's effectiveInCouncil — uses node.inCouncil if set, else derive from role
function _effectiveInCouncil(node) {
  if (node.inCouncil !== undefined && node.inCouncil !== null) return node.inCouncil
  const c = _classifyRole(node.role || '')
  if (!c) return false
  if (c.tier === 'general_manager')           return true
  if (c.tier === 'spiritual_guide')           return true
  if (c.tier === 'spiritual_guide_assistant') return true
  if (c.tier === 'spiritual_guide_agegroup')  return true
  if (c.tier === 'reports_to_gm')             return true
  return false
}

// Returns ALL group keys this node belongs to:
//   - "council:مجلس الشبيبة" if effectiveInCouncil
//   - committee / agegroup keys from effectiveInGroup (mirrors OrgTree.nodeGroupKeys)
// Note: a node can be in BOTH the council hull AND a committee/agegroup hull simultaneously.
function _nodeGroupKeys(node) {
  const keys = []
  const role = node.role || ''
  const c = _classifyRole(role)

  // مجلس الشبيبة hull — completely separate from the group/committee hulls
  if (_effectiveInCouncil(node)) keys.push('council:مجلس الشبيبة')

  if (!c) return keys
  if (c.tier === 'council_assistant') return keys   // never inside a group bubble
  if (!_effectiveInGroup(node)) return keys

  if (c.tier === 'reports_to_gm' && c.committeeHead) {
    const name = role.replace(ACTING_PREFIX, '').slice('مسؤول '.length)
    keys.push(`committee:${name}`)
  } else if (c.tier === 'committee_member') {
    keys.push(`committee:${role}`)
  } else if ((c.tier === 'reports_to_gm' && c.councilHead) || c.tier === 'council_head' || c.tier === 'spiritual_guide_agegroup') {
    const groups = AGE_GROUPS.filter(g => _extractGroups(role).includes(g))
    if (groups.length) keys.push(`agegroup:${groups.join('|')}`)
  }

  return keys
}

function _groupKeyLabel(key) {
  if (key.startsWith('council:'))  return key.slice('council:'.length)
  if (key.startsWith('committee:')) return key.slice('committee:'.length)
  if (key.startsWith('agegroup:')) {
    const groups = key.slice('agegroup:'.length).split('|')
    const n = groups.length
    const groupWord = n === 1 ? 'فئة' : n === 2 ? 'فئتيّ' : 'فئات'
    const groupList = n === 1 ? groups[0]
      : n === 2 ? `${groups[0]} و${groups[1]}`
      : groups.slice(0, -1).join(' و') + ' و' + groups[groups.length - 1]
    return `مجلس ${groupWord} ${groupList}`
  }

  return key
}

  // ── Org history aggregation ───────────────────────────────────────────────────
  //
//   { period, role, connections: { nodeId → { node, relType, periodIds[] } } }
//
// Then we collapse across periods within the same JEC year + same role into a
// single "entry" that shows the merged date span and annotates each connected
// person only when they were NOT present for the full span.

function isUnregisteredOrgNode(node) {
  return Boolean(node?.unregistered || node?.unregisteredId)
}

function orgNodeStableId(node) {
  if (isUnregisteredOrgNode(node) && node?.unregisteredId) return `unreg:${node.unregisteredId}`
  if (node?.personId) return `reg:${node.personId}`
  return `node:${node?.id}`
}

function orgNodeConnectionKey(node) {
  if (isUnregisteredOrgNode(node) && node?.unregisteredId) return `unreg:${node.unregisteredId}`
  if (node?.personId) return `pid:${node.personId}`
  return `nid:${node?.id}`
}

function compareOrgNodes(a, b) {
  if (isUnregisteredOrgNode(a) !== isUnregisteredOrgNode(b)) return isUnregisteredOrgNode(a) ? 1 : -1
  return (a?.name || '').localeCompare(b?.name || '', 'ar')
}

function buildOrgHistory(personIdOrMatcher, allPeriodTrees) {
  // allPeriodTrees: [{ groupName, period, nodes, edges }]

  // Step 1 — collect raw appearances per (groupName, jecYear, role)
  //   key = `${groupName}|||${jecYear}|||${role}`
  //   value = { groupName, jecYear, appearances: [{ period, thisNode, connections }] }
  //
  // connections per appearance: Map<nodeId, { node, relType }>
  //   relType: 'parent' | 'child' | 'peer'

  const entryMap = new Map()
  const matcher = typeof personIdOrMatcher === 'function'
    ? personIdOrMatcher
    : (n) => String(n.personId) === String(personIdOrMatcher)

  for (const { groupName, period, nodes, edges } of allPeriodTrees) {
    const myNodes = nodes.filter(matcher)
    for (const thisNode of myNodes) {
      const role    = thisNode.role || ''
      const jecYear = period?.jec_year ?? '—'
      // Stable identity: personId for registered, unregisteredId for unregistered.
      // This means:
      //   - Same person, same role, same JEC year across multiple periods → merged (date-span display)
      //   - Same person, DIFFERENT role simultaneously → separate entries (different role string)
      //   - Two different people with same role in same year → separate (different stableId)
      const stableId = orgNodeStableId(thisNode)
      const key = `${groupName}|||${jecYear}|||${role}|||${stableId}`

      if (!entryMap.has(key)) {
        entryMap.set(key, { groupName, jecYear, role, appearances: [] })
      }

      // Build connections map for this period
      const connections = new Map()
      const addConn = (n, relType) => {
        if (!connections.has(n.id)) connections.set(n.id, { node: n, relType })
      }

      edges.filter(e => e.type === 'hierarchy' && e.to   === thisNode.id).forEach(e => {
        const n = nodes.find(x => x.id === e.from); if (n) addConn(n, 'parent')
      })
      edges.filter(e => e.type === 'hierarchy' && e.from === thisNode.id).forEach(e => {
        const n = nodes.find(x => x.id === e.to);   if (n) addConn(n, 'child')
      })
      edges.filter(e => e.type === 'peer' && (e.from === thisNode.id || e.to === thisNode.id)).forEach(e => {
        const otherId = e.from === thisNode.id ? e.to : e.from
        const n = nodes.find(x => x.id === otherId); if (n) addConn(n, 'peer')
      })

      // Build bubble co-members: apply the same union-find merge OrgTree uses for age-group hulls,
      // so nodes in overlapping age-group keys end up in the same merged bubble.

      // Step A: collect raw keys for all nodes in this period
      const allRawKeys = new Map() // nodeId → rawKeys[]
      nodes.forEach(n => { allRawKeys.set(n.id, _nodeGroupKeys(n)) })

      // Step B: union-find merge for agegroup keys across the whole period
      const agKeySet = new Set()
      allRawKeys.forEach(keys => keys.forEach(k => { if (k.startsWith('agegroup:')) agKeySet.add(k) }))
      const agKeys = [...agKeySet]
      const ufParent = {}
      agKeys.forEach(k => { ufParent[k] = k })
      const ufFind = (k) => { while (ufParent[k] !== k) { ufParent[k] = ufParent[ufParent[k]]; k = ufParent[k] } return k }
      const ufUnion = (a, b) => { ufParent[ufFind(a)] = ufFind(b) }
      for (let i = 0; i < agKeys.length; i++) {
        const gi = agKeys[i].slice('agegroup:'.length).split('|')
        for (let j = i + 1; j < agKeys.length; j++) {
          const gj = agKeys[j].slice('agegroup:'.length).split('|')
          if (gi.some(g => gj.includes(g))) ufUnion(agKeys[i], agKeys[j])
        }
      }
      // Build mergedKey: for each raw agegroup key → find all agegroup keys in same component → sort by AGE_GROUPS order
      const agMergedKey = {}
      agKeys.forEach(k => {
        const root = ufFind(k)
        if (!agMergedKey[root]) {
          // collect all age group names in this component
          const allGroups = new Set()
          agKeys.forEach(k2 => { if (ufFind(k2) === root) k2.slice('agegroup:'.length).split('|').forEach(g => allGroups.add(g)) })
          const sorted2 = AGE_GROUPS.filter(g => allGroups.has(g))
          agMergedKey[root] = `agegroup:${sorted2.join('|')}`
        }
        agMergedKey[k] = agMergedKey[root]
      })

      // Step C: resolve each node's effective merged bubble keys
      const resolvedKeys = (nodeId) => {
        const raw = allRawKeys.get(nodeId) || []
        return raw.map(k => k.startsWith('agegroup:') ? agMergedKey[k] || k : k)
          .filter((k, i, arr) => arr.indexOf(k) === i) // dedupe
      }

      // Step D: find co-members per bubble key (Map<mergedKey, { nodes[] }>)
      const myMergedKeys = resolvedKeys(thisNode.id)
      const bubblesByKey = new Map() // mergedKey → Set<node> (excluding thisNode)
      myMergedKeys.forEach(k => { if (!bubblesByKey.has(k)) bubblesByKey.set(k, new Set()) })

      nodes.forEach(n => {
        if (n.id === thisNode.id) return
        const theirKeys = resolvedKeys(n.id)
        myMergedKeys.forEach(k => {
          if (theirKeys.includes(k)) bubblesByKey.get(k).add(n)
        })
      })

      // Convert to serializable: Map<mergedKey, Map<nodeId, { node }>>
      const bubbleCoMembersByKey = new Map()
      bubblesByKey.forEach((nodeSet, mergedKey) => {
        if (nodeSet.size === 0) return
        const m = new Map()
        nodeSet.forEach(n => m.set(n.id, { node: n }))
        bubbleCoMembersByKey.set(mergedKey, m)
      })

      entryMap.get(key).appearances.push({ period, thisNode, connections, bubbleCoMembersByKey, myMergedKeys })
    }
  }

  // Step 2 — per entry, compute merged span and smart connection annotations
  const entries = []

  for (const { groupName, jecYear, role, appearances } of entryMap.values()) {
    // Sort appearances by period start date
    const sorted = appearances.slice().sort((a, b) => {
      const ad = a.period?.from_date || ''
      const bd = b.period?.from_date || ''
      return ad.localeCompare(bd)
    })

    // Merged span for this role in this JEC year
    const entryStart = sorted[0]?.period?.from_date || null
    const entryEnd   = sorted.reduce((acc, ap) => {
      // null to_date = still active = open end = null in our convention
      if (acc === null) return null   // already open
      if (ap.period?.to_date === null || ap.period?.to_date === undefined) return null
      return maxDate(acc, ap.period.to_date)
    }, sorted[0]?.period?.to_date ?? null)

    const isActive = entryEnd === null

    // Step 3 — smart connections
    const connKey = (n) => orgNodeConnectionKey(n)

    const connMeta = new Map()

    for (const { period: ap, connections } of sorted) {
      const apFrom = ap?.from_date || null
      const apTo   = ap?.to_date ?? null
      for (const [, { node, relType }] of connections) {
        const ck = connKey(node)
        if (!connMeta.has(ck)) {
          connMeta.set(ck, { node, relType, spans: [] })
        }
        connMeta.get(ck).spans.push({ from: apFrom, to: apTo })
      }
    }

    // For each connected person, decide whether to annotate dates
    const smartConnections = []
    for (const [, { node, relType, spans }] of connMeta) {
      const connStart = spans.reduce((acc, s) => {
        if (acc === null || s.from === null) return minDate(acc, s.from)
        return minDate(acc, s.from)
      }, spans[0]?.from ?? null)
      const connEnd = spans.reduce((acc, s) => {
        if (acc === null) return null
        if (s.to === null) return null
        return maxDate(acc, s.to)
      }, spans[0]?.to ?? null)

      const coversStart = connStart === entryStart || (!connStart && !entryStart)
      const coversEnd   = connEnd === entryEnd || (!connEnd && !entryEnd) ||
                          (connEnd === null && entryEnd === null)

      const needsAnnotation = !(coversStart && coversEnd)

      smartConnections.push({ node, relType, connStart, connEnd, needsAnnotation })
    }

    // Step 4 — aggregate bubble co-members per merged key, across periods
    // bubblesPerKey: Map<mergedKey, Map<connKey, { node, spans[] }>>
    const bubblesPerKey = new Map()

    // Collect all merged keys this person's node ever has in this entry
    const allEntryMergedKeys = new Set()
    sorted.forEach(ap => (ap.myMergedKeys || []).forEach(k => allEntryMergedKeys.add(k)))

    for (const { period: ap, bubbleCoMembersByKey } of sorted) {
      const apFrom = ap?.from_date || null
      const apTo   = ap?.to_date ?? null
      if (!bubbleCoMembersByKey) continue
      bubbleCoMembersByKey.forEach((memberMap, mergedKey) => {
        if (!bubblesPerKey.has(mergedKey)) bubblesPerKey.set(mergedKey, new Map())
        const keyMeta = bubblesPerKey.get(mergedKey)
        memberMap.forEach(({ node }) => {
          const ck = connKey(node)
          if (!keyMeta.has(ck)) keyMeta.set(ck, { node, spans: [] })
          keyMeta.get(ck).spans.push({ from: apFrom, to: apTo })
        })
      })
    }

    // Resolve bubblesPerKey into final array per key
    const bubblesGrouped = [] // [{ mergedKey, label, members: [{ node, connStart, connEnd, needsAnnotation }] }]
    bubblesPerKey.forEach((keyMeta, mergedKey) => {
      const members = []
      keyMeta.forEach(({ node, spans }) => {
        const connStart = spans.reduce((acc, s) => minDate(acc, s.from), spans[0]?.from ?? null)
        const connEnd   = spans.reduce((acc, s) => {
          if (acc === null) return null
          if (s.to === null) return null
          return maxDate(acc, s.to)
        }, spans[0]?.to ?? null)
        const coversStart = connStart === entryStart || (!connStart && !entryStart)
        const coversEnd   = connEnd === entryEnd || (!connEnd && !entryEnd) || (connEnd === null && entryEnd === null)
        members.push({ node, connStart, connEnd, needsAnnotation: !(coversStart && coversEnd) })
      })
      // Sort: registered first, then by name
      members.sort((a, b) => compareOrgNodes(a.node, b.node))
      bubblesGrouped.push({ mergedKey, label: _groupKeyLabel(mergedKey), members })
    })
    // Sort bubble groups by label
    bubblesGrouped.sort((a, b) => a.label.localeCompare(b.label, 'ar'))

    // Keep entryGroupKeys for the header badge (all merged keys)
    const entryGroupKeys = [...allEntryMergedKeys]

    entries.push({
      groupName,
      jecYear,
      role,
      entryStart,
      entryEnd,
      isActive,
      smartConnections,
      bubblesGrouped,
      entryGroupKeys,
    })
  }

  // Sort entries: by groupName, then jecYear desc, then entryStart desc
  entries.sort((a, b) => {
    if (a.groupName !== b.groupName) return a.groupName.localeCompare(b.groupName)
    const ya = String(a.jecYear), yb = String(b.jecYear)
    if (ya !== yb) return yb.localeCompare(ya)
    return (b.entryStart || '').localeCompare(a.entryStart || '')
  })

  return entries
}

// ── Smart connection row ──────────────────────────────────────────────────────
function SmartConnRow({ node, connStart, connEnd, needsAnnotation, onViewProfile }) {
  const initials = firstNameInitial(node.baseName || node.name)
  // Both registered (personId) and unregistered (unregisteredId) are navigable
  const canClick = !!(node.personId || node.unregisteredId)
  const handleClick = () => {
    if (!canClick || !onViewProfile) return
    if (isUnregisteredOrgNode(node) && node.unregisteredId) onViewProfile(node.unregisteredId, true)
    else if (node.personId) onViewProfile(node.personId, false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 0', borderBottom: '1px solid var(--gray-100)',
    }}>
      <div
        onClick={handleClick}
        style={{
          width: 34, height: 34, borderRadius: '50%',
          background: node.unregistered ? '#fde68a' : 'var(--navy)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.72rem', fontWeight: 700,
          color: node.unregistered ? '#92400e' : 'white',
          flexShrink: 0, overflow: 'hidden',
          cursor: canClick ? 'pointer' : 'default',
          border: node.unregistered ? '1.5px dashed #c9963c' : 'none',
        }}
      >
        {node.photo
          ? <img src={node.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            onClick={handleClick}
            style={{
              fontWeight: 600, fontSize: '0.85rem', color: 'var(--gray-800)',
              cursor: canClick ? 'pointer' : 'default',
            }}
            onMouseEnter={e => { if (canClick) e.target.style.color = 'var(--navy)' }}
            onMouseLeave={e => { if (canClick) e.target.style.color = 'var(--gray-800)' }}
          >
            {node.name || 'بدون اسم'}
          </span>
          {node.unregistered && (
            <span style={{ fontSize: '0.68rem', color: '#b45309', background: '#fffbeb',
              border: '1px solid #e8b55a', borderRadius: 10, padding: '1px 6px' }}>
              غير مسجّل
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--gold)', marginTop: 1 }}>
          {node.role || '—'}
        </div>
        {needsAnnotation && (
          <div style={{ fontSize: '0.7rem', color: 'var(--gray-400)', marginTop: 2 }}>
            {formatPeriodDate(connStart)} — {connEnd ? formatPeriodDate(connEnd) : 'الآن'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared org history renderer ───────────────────────────────────────────────
function OrgHistoryView({ entries, onViewProfile }) {
  if (!entries.length) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray-400)' }}>
      <GitBranch size={40} style={{ marginBottom: 14, opacity: 0.35 }} />
      <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>لا يوجد دور في الهيكل التنظيمي</div>
      <div style={{ fontSize: '0.82rem' }}>لم يُضَف هذا الشخص إلى أي هيكل تنظيمي بعد</div>
    </div>
  )

  const byGroup = {}
  for (const entry of entries) {
    if (!byGroup[entry.groupName]) byGroup[entry.groupName] = {}
    const y = String(entry.jecYear)
    if (!byGroup[entry.groupName][y]) byGroup[entry.groupName][y] = []
    byGroup[entry.groupName][y].push(entry)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {Object.entries(byGroup).map(([groupName, byYear]) => (
        <div key={groupName}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
            paddingBottom: 8, borderBottom: '2px solid var(--navy)',
          }}>
            <GitBranch size={15} style={{ color: 'var(--navy)' }} />
            <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--navy)', fontFamily: 'var(--font-head)' }}>
              {groupName}
            </span>
          </div>

          {Object.entries(byYear)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([jecYear, yearEntries]) => (
              <div key={jecYear} style={{ marginBottom: 20 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--navy)', color: 'white',
                  fontSize: '0.78rem', fontWeight: 700, padding: '4px 14px',
                  borderRadius: 20, marginBottom: 12, fontFamily: 'var(--font-head)',
                }}>
                  سنة JEC {jecYear}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {yearEntries.map((entry, ei) => {
                    const parents        = entry.smartConnections.filter(c => c.relType === 'parent')
                    const children       = entry.smartConnections.filter(c => c.relType === 'child')
                    const peers          = entry.smartConnections.filter(c => c.relType === 'peer')
                    const bubblesGrouped = entry.bubblesGrouped || []

                    return (
                      <div key={ei} className="card" style={{ borderRight: '3px solid var(--gold)' }}>
                        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <span style={{
                            background: 'var(--navy)', color: 'white',
                            fontSize: '0.82rem', fontWeight: 700,
                            padding: '4px 12px', borderRadius: 20, fontFamily: 'var(--font-body)',
                          }}>
                            {entry.role || 'بدون دور محدد'}
                          </span>

                          <span style={{
                            fontSize: '0.72rem', fontWeight: 600,
                            color: entry.isActive ? '#2e7d32' : 'var(--gray-500)',
                            background: entry.isActive ? '#e8f5e9' : 'var(--gray-100)',
                            padding: '3px 10px', borderRadius: 20,
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            {formatPeriodDate(entry.entryStart)}
                            {' — '}
                            {entry.isActive ? 'الآن' : formatPeriodDate(entry.entryEnd)}
                            {entry.isActive && (
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4caf50', display: 'inline-block' }} />
                            )}
                          </span>

                          {bubblesGrouped.map(bg => (
                            <span key={bg.mergedKey} style={{
                              fontSize: '0.7rem', fontWeight: 600,
                              color: '#5b21b6', background: 'rgba(139,92,246,0.1)',
                              border: '1px solid rgba(139,92,246,0.3)',
                              padding: '3px 10px', borderRadius: 20,
                            }}>
                              {bg.label}
                            </span>
                          ))}
                        </div>

                        <div className="card-body" style={{ paddingTop: 10 }}>
                          {parents.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <SectionLabel>يرفع تقاريره إلى</SectionLabel>
                              {parents.map((c, i) => (
                                <SmartConnRow key={i} {...c} onViewProfile={onViewProfile} />
                              ))}
                            </div>
                          )}
                          {children.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <SectionLabel>يرفع إليه تقاريره ({children.length})</SectionLabel>
                              {children.map((c, i) => (
                                <SmartConnRow key={i} {...c} onViewProfile={onViewProfile} />
                              ))}
                            </div>
                          )}
                          {peers.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <SectionLabel>ارتباطات أفقية</SectionLabel>
                              {peers.map((c, i) => (
                                <SmartConnRow key={i} {...c} onViewProfile={onViewProfile} />
                              ))}
                            </div>
                          )}
                          {bubblesGrouped.map(bg => (
                            <div key={bg.mergedKey} style={{ marginBottom: 12 }}>
                              <SectionLabel>زملاء {bg.label} ({bg.members.length})</SectionLabel>
                              {bg.members.map((c, i) => (
                                <SmartConnRow key={i} {...c} relType="bubble" onViewProfile={onViewProfile} />
                              ))}
                            </div>
                          ))}
                          {!parents.length && !children.length && !peers.length && !bubblesGrouped.length && (
                            <div style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>
                              لا توجد علاقات هرمية محددة في هذه الفترة
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

// ── Shared data loader for org history ────────────────────────────────────────
async function loadOrgHistoryTrees({ personId = null, unregisteredId = null, groupIds = [] } = {}) {
  const groups = (Array.isArray(groupIds) ? groupIds : [])
    .map(g => String(g || '').trim())
    .filter(Boolean)

  const res = await api.getOrgTreeHistory({ personId, unregisteredId, groupIds: groups })
  return Array.isArray(res?.items) ? res.items : []
}

// ── Org history tab (registered) ──────────────────────────────────────────────
function OrgTab({ personId, orgContext, onViewProfile, relevantGroupIds }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const matcher = (n) => String(n.personId) === String(personId)
    loadOrgHistoryTrees({ personId, groupIds: relevantGroupIds })
      .then(trees => { if (!cancelled) { setEntries(buildOrgHistory(matcher, trees)); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [personId, relevantGroupIds])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  return <OrgHistoryView entries={entries} onViewProfile={onViewProfile} />
}

// ── Org history tab (unregistered) ────────────────────────────────────────────
function OrgTabUnregistered({ unregisteredId, orgContext, onViewProfile, relevantGroupIds }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const matcher = (n) => String(n.unregisteredId) === String(unregisteredId)
    loadOrgHistoryTrees({ unregisteredId, groupIds: relevantGroupIds })
      .then(trees => { if (!cancelled) { setEntries(buildOrgHistory(matcher, trees)); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [unregisteredId, relevantGroupIds])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  return <OrgHistoryView entries={entries} onViewProfile={onViewProfile} />
}

// ── GS org history helpers ─────────────────────────────────────────────────────
const GS_GROUP_KEY_PROFILE = 'GS'

// Classification helpers matching GeneralSecretariatTree for hull/bubble logic in profile
const GS_COMMITTEES_PROFILE = [
  'لجنة الخدمة','لجنة الإعلام','لجنة الابتكار','لجنة العلاقات العامة',
  'لجنة التدريب والتطوير','لجنة تطوير شبيبات الشمال','لجنة تطوير شبيبات الوسط',
  'لجنة تطوير شبيبات الجنوب','لجنة النشاطات',
]
const GS_PROJECTS_PROFILE = ['شبيبة ستور','الفرقة الموسيقيّة JEC Band','عائلات الشبيبة','الاستشارات','المسرح']
const GS_ACTING_PREFIX = 'قائم بأعمال '

// Mirrors classifyGSRole from GeneralSecretariatTree exactly
function _classifyGSRole(role) {
  if (!role) return null
  if (role.startsWith(GS_ACTING_PREFIX)) role = role.slice(GS_ACTING_PREFIX.length)
  if (role === 'الأمين العام')            return { tier: 'secretary_general' }
  if (role === 'المرشد الروحيّ العام')    return { tier: 'spiritual_guide' }
  if (role === 'مساعد المرشد الروحي')    return { tier: 'spiritual_guide_assistant' }
  if (role === 'نائب الأمين العام')       return { tier: 'reports_to_sg' }
  if (role === 'منسق الشرق الأوسط')      return { tier: 'middle_east_coordinator' }
  if (role === 'نائب منسق الشرق الأوسط') return { tier: 'deputy_me_coordinator' }
  if (role === 'مدير مكتب الأمانة')      return { tier: 'office_director' }
  if (role === 'مسؤول شبيبة ستور' || role === 'مدير شبيبة ستور') return { tier: 'store_manager', project: 'شبيبة ستور' }
  if (role === 'موظف شبيبة ستور') return { tier: 'store_employee', project: 'شبيبة ستور' }
  if (role.startsWith('مسؤول ')) {
    const rest = role.slice('مسؤول '.length)
    if (_isGSCompositeCommittee(rest)) return { tier: 'committee_head', committeeKey: rest }
  }
  if (role.startsWith('عضو ')) {
    const rest = role.slice('عضو '.length)
    if (_isGSCompositeCommittee(rest)) return { tier: 'committee_member', committeeKey: rest }
  }
  for (const proj of GS_PROJECTS_PROFILE) {
    if (role === `مسؤول ${proj}`) return { tier: 'project_head', project: proj }
    if (role === `مدير ${proj}`)  return { tier: 'project_director', project: proj }
    if (role === `موظف ${proj}`)  return { tier: 'project_employee', project: proj }
    if (role === `عضو ${proj}`)   return { tier: 'project_member', project: proj }
  }
  return null
}

function _isGSCompositeCommittee(str) {
  if (!str) return false
  if (GS_COMMITTEES_PROFILE.includes(str)) return true
  const parts = str.split(/ و /).map(s => s.trim())
  return parts.length > 1 && parts.every(p => GS_COMMITTEES_PROFILE.includes(p))
}

function _isDefaultGSGroupMember(role) {
  if (!role) return false
  const c = _classifyGSRole(role)
  if (!c) return false
  return ['committee_head','committee_member','project_head','project_director',
    'project_employee','project_member','store_manager','store_employee'].includes(c.tier)
}

function _effectiveGSInGroup(node) {
  if (node.inGroup !== undefined && node.inGroup !== null) return node.inGroup
  return _isDefaultGSGroupMember(node.role || '')
}

// Returns raw hull keys for a single node — mirrors nodeGSGroupKeys from the tree
function _gsRawNodeKeys(node) {
  const role = node.role || ''
  const c = _classifyGSRole(role)
  const keys = []

  // الأمانة العامة hull — respects node.inAmanah override
  if (c) {
    const defaultInAmanah = ['secretary_general','spiritual_guide','spiritual_guide_assistant',
      'reports_to_sg','committee_head','middle_east_coordinator'].includes(c.tier)
    const effectiveInAmanah = (node.inAmanah !== undefined && node.inAmanah !== null)
      ? node.inAmanah
      : defaultInAmanah
    if (effectiveInAmanah) keys.push('amanah:الأمانة العامة')
  }

  if (!c) return keys
  if (!_effectiveGSInGroup(node)) return keys

  // Committee head — keyed by their own nodeId
  if (c.tier === 'committee_head') return [...keys, `committee_head:${node.id}`]

  // Committee member — pinned to specific head, or falls to committeeKey for resolution
  if (c.tier === 'committee_member') {
    if (node.reportsToHeadId) return [...keys, `committee_head:${node.reportsToHeadId}`]
    return [...keys, `committee:${c.committeeKey}`]
  }

  // Project / store
  if (['project_head','project_director','project_employee','project_member'].includes(c.tier)) {
    return [...keys, `project:${c.project}`]
  }
  if (c.tier === 'store_manager' || c.tier === 'store_employee') {
    return [...keys, `project:شبيبة ستور`]
  }

  return keys
}

// Resolve raw keys to final hull keys for all nodes in a period,
// exactly mirroring GeneralSecretariatTree.renderHulls resolution logic.
// Returns Map<nodeId, finalKeys[]>
function _resolveGSHullKeys(nodes) {
  // Build raw keys for every node
  const rawByNode = new Map()
  nodes.forEach(n => { rawByNode.set(n.id, _gsRawNodeKeys(n)) })

  // Build a lookup: committeeKey → [committee_head nodeIds] (only those with effectiveGSInGroup)
  const committeeHeadsByKey = new Map() // committeeKey → nodeId[]
  nodes.forEach(n => {
    const c = _classifyGSRole(n.role)
    if (c?.tier === 'committee_head' && _effectiveGSInGroup(n)) {
      const headComs = c.committeeKey.split(/ و /).map(s => s.trim())
      headComs.forEach(com => {
        if (!committeeHeadsByKey.has(com)) committeeHeadsByKey.set(com, [])
        committeeHeadsByKey.get(com).push(n.id)
      })
    }
  })

  // Resolve each node's raw keys to final keys
  const finalByNode = new Map()
  nodes.forEach(n => {
    const raw = rawByNode.get(n.id) || []
    const final = []
    raw.forEach(k => {
      if (k.startsWith('committee_head:') && _classifyGSRole(n.role)?.tier === 'committee_head') {
        // Head's own hull key — keep as-is
        final.push(k)
        return
      }
      if (k.startsWith('committee:')) {
        // Unpinned member — resolve to matching head(s) hull, or keep standalone
        const committeeKey = k.slice('committee:'.length)
        const memberComs = committeeKey.split(/ و /).map(s => s.trim())
        const matchingHeadIds = new Set()
        memberComs.forEach(com => {
          ;(committeeHeadsByKey.get(com) || []).forEach(hid => matchingHeadIds.add(hid))
        })
        if (matchingHeadIds.size > 0) {
          matchingHeadIds.forEach(hid => final.push(`committee_head:${hid}`))
        } else {
          final.push(k) // standalone committee hull
        }
        return
      }
      // amanah, project, etc. — pass through
      final.push(k)
    })
    // Deduplicate
    finalByNode.set(n.id, [...new Set(final)])
  })

  return finalByNode
}

// Label for a resolved final hull key
function _gsGroupKeyLabel(key) {
  if (key === 'amanah:الأمانة العامة') return 'الأمانة العامة'
  if (key.startsWith('committee_head:')) return 'لجنة'   // fallback; overridden below with head's committeeKey
  if (key.startsWith('committee:')) return key.slice('committee:'.length)
  if (key.startsWith('project:')) return key.slice('project:'.length)
  return key
}

// Better label for committee_head keys — needs the nodes list to look up the head
  function _gsGroupKeyLabelWithNodes(key, nodes) {
    if (key.startsWith('committee_head:')) {
      const headId = key.slice('committee_head:'.length)
      const head = (nodes || []).find(n => n.id === headId)
      if (head) {
        const c = _classifyGSRole(head.role)
        if (c?.committeeKey) return c.committeeKey
        return head.role || 'لجنة'
      }
      return 'لجنة'
    }
    return _gsGroupKeyLabel(key)
}

function buildGSOrgHistory(personIdOrMatcher, allPeriodTrees) {
  const entryMap = new Map()
  const matcher = typeof personIdOrMatcher === 'function'
    ? personIdOrMatcher
    : (n) => String(n.personId) === String(personIdOrMatcher)

  for (const { groupName, period, nodes, edges } of allPeriodTrees) {
    const myNodes = nodes.filter(matcher)
    for (const thisNode of myNodes) {
      const role    = thisNode.role || ''
      const jecYear = period?.jec_year ?? '—'
      const stableId = orgNodeStableId(thisNode)
      const key = `${groupName}|||${jecYear}|||${role}|||${stableId}`

      if (!entryMap.has(key)) entryMap.set(key, { groupName, jecYear, role, appearances: [] })

      const connections = new Map()
      const addConn = (n, relType) => { if (!connections.has(n.id)) connections.set(n.id, { node: n, relType }) }

      edges.filter(e => e.type === 'hierarchy' && e.to   === thisNode.id).forEach(e => { const n=nodes.find(x=>x.id===e.from); if(n) addConn(n,'parent') })
      edges.filter(e => e.type === 'hierarchy' && e.from === thisNode.id).forEach(e => { const n=nodes.find(x=>x.id===e.to);   if(n) addConn(n,'child') })
      edges.filter(e => e.type === 'peer' && (e.from===thisNode.id||e.to===thisNode.id)).forEach(e => { const otherId=e.from===thisNode.id?e.to:e.from; const n=nodes.find(x=>x.id===otherId); if(n) addConn(n,'peer') })

      // Bubble keys: use the same hull resolution as the real tree
      const finalKeysByNode = _resolveGSHullKeys(nodes)
      const myFinalKeys = finalKeysByNode.get(thisNode.id) || []
      const bubblesByKey = new Map()
      myFinalKeys.forEach(k => { if (!bubblesByKey.has(k)) bubblesByKey.set(k, new Set()) })
      nodes.forEach(n => {
        if (n.id === thisNode.id) return
        const theirKeys = finalKeysByNode.get(n.id) || []
        myFinalKeys.forEach(k => { if (theirKeys.includes(k)) bubblesByKey.get(k).add(n) })
      })
      const bubbleCoMembersByKey = new Map()
      bubblesByKey.forEach((nodeSet, mergedKey) => {
        if (nodeSet.size === 0) return
        const m = new Map()
        nodeSet.forEach(n => m.set(n.id, { node: n }))
        bubbleCoMembersByKey.set(mergedKey, m)
      })

      entryMap.get(key).appearances.push({ period, thisNode, connections, bubbleCoMembersByKey, myMergedKeys: myFinalKeys, _nodes: nodes })
    }
  }

  // Collapse appearances into entries (same logic as buildOrgHistory but using GS label helper)
  const entries = []
  const connKey = (n) => orgNodeConnectionKey(n)

  for (const { groupName, jecYear, role, appearances } of entryMap.values()) {
    const sorted = appearances.slice().sort((a, b) => {
      const ad = a.period?.from_date || ''
      const bd = b.period?.from_date || ''
      return ad.localeCompare(bd)
    })

    const entryStart = sorted[0]?.period?.from_date || null
    const entryEnd   = sorted.reduce((acc, ap) => {
      if (acc === null) return null
      if (ap.period?.to_date === null || ap.period?.to_date === undefined) return null
      return maxDate(acc, ap.period.to_date)
    }, sorted[0]?.period?.to_date ?? null)

    const isActive = entryEnd === null

    // Smart connections
    const connMeta = new Map()
    for (const { period: ap, connections } of sorted) {
      const apFrom = ap?.from_date || null
      const apTo   = ap?.to_date ?? null
      for (const [, { node, relType }] of connections) {
        const ck = connKey(node)
        if (!connMeta.has(ck)) connMeta.set(ck, { node, relType, spans: [] })
        connMeta.get(ck).spans.push({ from: apFrom, to: apTo })
      }
    }

    const smartConnections = []
    for (const [, { node, relType, spans }] of connMeta) {
      const connStart = spans.reduce((acc, s) => minDate(acc, s.from), spans[0]?.from ?? null)
      const connEnd   = spans.reduce((acc, s) => {
        if (acc === null) return null
        if (s.to === null) return null
        return maxDate(acc, s.to)
      }, spans[0]?.to ?? null)
      const coversStart = connStart === entryStart || (!connStart && !entryStart)
      const coversEnd   = connEnd === entryEnd || (!connEnd && !entryEnd) || (connEnd === null && entryEnd === null)
      smartConnections.push({ node, relType, connStart, connEnd, needsAnnotation: !(coversStart && coversEnd) })
    }

    // Aggregate bubble co-members per GS key
    const allEntryMergedKeys = new Set()
    sorted.forEach(ap => (ap.myMergedKeys || []).forEach(k => allEntryMergedKeys.add(k)))

    const bubblesPerKey = new Map()
    for (const { period: ap, bubbleCoMembersByKey } of sorted) {
      const apFrom = ap?.from_date || null
      const apTo   = ap?.to_date ?? null
      if (!bubbleCoMembersByKey) continue
      bubbleCoMembersByKey.forEach((memberMap, mergedKey) => {
        if (!bubblesPerKey.has(mergedKey)) bubblesPerKey.set(mergedKey, new Map())
        const keyMeta = bubblesPerKey.get(mergedKey)
        memberMap.forEach(({ node }) => {
          const ck = connKey(node)
          if (!keyMeta.has(ck)) keyMeta.set(ck, { node, spans: [] })
          keyMeta.get(ck).spans.push({ from: apFrom, to: apTo })
        })
      })
    }

    const bubblesGrouped = []
    bubblesPerKey.forEach((keyMeta, mergedKey) => {
      const members = []
      keyMeta.forEach(({ node, spans }) => {
        const connStart = spans.reduce((acc, s) => minDate(acc, s.from), spans[0]?.from ?? null)
        const connEnd   = spans.reduce((acc, s) => {
          if (acc === null) return null
          if (s.to === null) return null
          return maxDate(acc, s.to)
        }, spans[0]?.to ?? null)
        const coversStart = connStart === entryStart || (!connStart && !entryStart)
        const coversEnd   = connEnd === entryEnd || (!connEnd && !entryEnd) || (connEnd === null && entryEnd === null)
        members.push({ node, connStart, connEnd, needsAnnotation: !(coversStart && coversEnd) })
      })
      members.sort((a, b) => compareOrgNodes(a.node, b.node))
      // Use GS-specific label helper with node lookup for committee_head keys
      // Collect all nodes from this entry's appearances for label resolution
      const allNodesForLabel = sorted.flatMap(ap => ap._nodes || [])
      bubblesGrouped.push({ mergedKey, label: _gsGroupKeyLabelWithNodes(mergedKey, allNodesForLabel), members })
    })
    bubblesGrouped.sort((a, b) => a.label.localeCompare(b.label, 'ar'))

    entries.push({
      groupName,
      jecYear,
      role,
      entryStart,
      entryEnd,
      isActive,
      smartConnections,
      bubblesGrouped,
      entryGroupKeys: [...allEntryMergedKeys],
    })
  }

  entries.sort((a, b) => {
    if (a.groupName !== b.groupName) return a.groupName.localeCompare(b.groupName)
    const ya = String(a.jecYear), yb = String(b.jecYear)
    if (ya !== yb) return yb.localeCompare(ya)
    return (b.entryStart || '').localeCompare(a.entryStart || '')
  })

  return entries
}

// ── GS org tab (registered) ────────────────────────────────────────────────────
function GSTab({ personId, onViewProfile }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const matcher = (n) => String(n.personId) === String(personId)
    loadOrgHistoryTrees({ personId, groupIds: [GS_GROUP_KEY_PROFILE] })
      .then(trees => { if (!cancelled) { setEntries(buildGSOrgHistory(matcher, trees)); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [personId])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  return <OrgHistoryView entries={entries} onViewProfile={onViewProfile} />
}

// ── GS org tab (unregistered) ──────────────────────────────────────────────────
function GSTabUnregistered({ unregisteredId, onViewProfile }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const matcher = (n) => String(n.unregisteredId) === String(unregisteredId)
    loadOrgHistoryTrees({ unregisteredId, groupIds: [GS_GROUP_KEY_PROFILE] })
      .then(trees => { if (!cancelled) { setEntries(buildGSOrgHistory(matcher, trees)); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [unregisteredId])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  return <OrgHistoryView entries={entries} onViewProfile={onViewProfile} />
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
function ConfirmDialog({ open, title, message, confirmLabel, confirmClass, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15,39,68,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div style={{
        background: 'white', borderRadius: 'var(--radius-lg)', padding: '28px 32px', maxWidth: 420, width: '90%',
        boxShadow: 'var(--shadow-lg)', direction: 'rtl',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.1rem', color: 'var(--navy)', marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--gray-600)', marginBottom: 24, lineHeight: 1.7 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
          <button className={`btn btn-sm ${confirmClass || 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── Main profile page ─────────────────────────────────────────────────────────
export default function Profile({ personId, isUnregistered, onBack, toast, orgContext, onViewProfile, onPromoted, currentUser, readOnly = false }) {
  const [data, setData]           = useState(null)
  const [photo, setPhoto]         = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [filters, setFilters]     = useState({})
  const [filtersResolved, setFiltersResolved] = useState(false)
  const [activeJecYear, setActiveJecYear] = useState('')
  const [personTitles, setPersonTitles] = useState([])
  const [schoolBranches, setSchoolBranches] = useState({})
  const [schoolLogoEntries, setSchoolLogoEntries] = useState([])
  const [nationalityIsoLookup, setNationalityIsoLookup] = useState(() => new Map())
  const [confirm, setConfirm]     = useState(null) // { action: 'delete' | 'archive' }
  const saveTimeout = useRef(null)
  const loadRequestId = useRef(0)
  const pendingSaveData = useRef(null)
  const saveInFlight = useRef(false)
  const activeSavePromise = useRef(Promise.resolve())
  const isUnmounted = useRef(false)
  const filtersLoaded = useRef(false)
  const editMetaLoaded = useRef(false)
  const isViewerAdmin = currentUser?.role === 'admin'
  const isViewingOwnProfile =
    currentUser
    && String(currentUser.person_id) === String(personId)
    && ((currentUser.person_type === 'unregistered') === !!isUnregistered)
  const canFullyEditProfile = !readOnly && isViewerAdmin
  const canEditOwnProfile = !readOnly && !isViewerAdmin && currentUser?.role === 'member' && isViewingOwnProfile
  const canEnterEditMode = canFullyEditProfile || canEditOwnProfile

  useEffect(() => {
    if (filtersLoaded.current) return
    let cancelled = false
    Promise.all([api.filters(), api.listSchoolLogos(), api.listNationalityIsoCodes()])
      .then(([filtersResponse, schoolLogosResponse, nationalityIsoResponse]) => {
        if (!cancelled) {
          setFilters(filtersResponse || {})
          setSchoolLogoEntries(Array.isArray(schoolLogosResponse?.entries) ? schoolLogosResponse.entries : [])
          setNationalityIsoLookup(normalizeNationalityIsoLookup(nationalityIsoResponse?.entries))
          filtersLoaded.current = true
          setFiltersResolved(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFilters({})
          setSchoolLogoEntries([])
          setNationalityIsoLookup(new Map())
          setFiltersResolved(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.getConfig()
      .then((configResponse) => {
        if (!cancelled) {
          setActiveJecYear(normalizeActiveJecYearValue(configResponse?.config?.active_jec_year))
        }
      })
      .catch(() => {
        if (!cancelled) setActiveJecYear('')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (readOnly || !isEditing || editMetaLoaded.current || !canEnterEditMode) return
    let cancelled = false
    api.getConfig()
      .then((configResponse) => {
        if (!cancelled) {
          setActiveJecYear(normalizeActiveJecYearValue(configResponse?.config?.active_jec_year))
          setPersonTitles(normalizePersonTitles(configResponse?.config?.person_titles || []))
          setSchoolBranches(normalizeSchoolBranches(configResponse?.config?.school_branches || {}))
          editMetaLoaded.current = true
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPersonTitles([])
          setSchoolBranches({})
        }
      })
    return () => { cancelled = true }
  }, [canEnterEditMode, isEditing, readOnly])

  useEffect(() => {
    if (!canEnterEditMode && isEditing) setIsEditing(false)
  }, [canEnterEditMode, isEditing])

  useEffect(() => () => {
    isUnmounted.current = true
    clearTimeout(saveTimeout.current)
    pendingSaveData.current = null
  }, [])

  // Helper: get sorted option list for a filter key (count desc, value only)
  const opts = useCallback((key) =>
    (Array.isArray(filters[key]) ? filters[key] : []).map(f => ({
      value: f.value,
      label: key === 'youth_group' ? api.formatYouthGroupLabel(f.label || f.value) : (f.label || f.value),
    }))
  , [filters])

  const responsibilityYouthGroupOptions = useMemo(() => {
    const membershipIds = new Set(
      normalizeYouthMembershipRows(data?.person_youth_group)
        .map((row) => String(row?.youth_group_id || '').trim())
        .filter(Boolean)
    )
    const optionMap = new Map()

    opts('youth_group').forEach((option) => {
      const value = String(option?.value || '').trim()
      if (!value || !membershipIds.has(value) || optionMap.has(value)) return
      optionMap.set(value, { value, label: option?.label || api.formatYouthGroupLabel(value) || value })
    })

    membershipIds.forEach((value) => {
      if (optionMap.has(value)) return
      optionMap.set(value, { value, label: api.formatYouthGroupLabel(value) || value })
    })

    return Array.from(optionMap.values())
  }, [data?.person_youth_group, opts])

  const personTitleMappings = useMemo(() => {
    const arabicToEnglish = new Map()
    const englishToArabic = new Map()
    personTitles.forEach((row) => {
      const arabicTitle = String(row?.arabic_title || '').replace(/\s+/g, ' ').trim()
      const englishTitle = String(row?.english_title || '').replace(/\s+/g, ' ').trim()
      if (!arabicTitle) return
      arabicToEnglish.set(normalizeTitleLookupKey(arabicTitle), englishTitle)
      if (englishTitle) englishToArabic.set(normalizeTitleLookupKey(englishTitle), arabicTitle)
    })
    return { arabicToEnglish, englishToArabic }
  }, [personTitles])

  const englishTitleForPerson = useMemo(() => {
    const arabicTitle = String(data?.person?.title || '').replace(/\s+/g, ' ').trim()
    if (!arabicTitle) return ''
    return personTitleMappings.arabicToEnglish.get(normalizeTitleLookupKey(arabicTitle)) || ''
  }, [data?.person?.title, personTitleMappings])

  const personTitleOptions = useCallback((currentValue) => {
    const configured = personTitles.map((row) => ({ value: row.arabic_title, label: row.arabic_title }))
    const current = String(currentValue || '').trim()
    if (current && !configured.some((option) => option.value === current)) {
      configured.push({ value: current, label: current })
    }
    return configured
  }, [personTitles])

  const personEnglishTitleOptions = useCallback((currentArabicValue) => {
    const configured = personTitles.map((row) => {
      const arabicTitle = String(row?.arabic_title || '').replace(/\s+/g, ' ').trim()
      const englishTitle = String(row?.english_title || '').replace(/\s+/g, ' ').trim() || arabicTitle
      return { value: englishTitle, label: englishTitle }
    })
    const currentEnglish = personTitleMappings.arabicToEnglish.get(normalizeTitleLookupKey(currentArabicValue)) || String(currentArabicValue || '').trim()
    if (currentEnglish && !configured.some((option) => option.value === currentEnglish)) {
      configured.push({ value: currentEnglish, label: currentEnglish })
    }
    return configured
  }, [personTitles, personTitleMappings])

  useEffect(() => {
    const requestId = ++loadRequestId.current
    let cancelled = false
    clearTimeout(saveTimeout.current)
    pendingSaveData.current = null
    setSaving(false)
    setLoading(true)
    setLoadError('')
    setData(null)
    setPhoto(null)
    // Both registered and unregistered return the same shape:
    // { person: { person_id, ar_first_name, ..., title? }, nationality: [...], ... }
    const loader = isUnregistered
      ? api.getUnregisteredPerson(personId)
      : api.getPerson(personId)
    loader.then(d => {
      if (cancelled || loadRequestId.current !== requestId) return
      // Ensure sub-arrays exist
      if (!d.person)             d.person = {}
      if (!d.nationality)        d.nationality = []
      if (!d.mobile_numbers)     d.mobile_numbers = []
      if (!d.emails)             d.emails = []
      if (!d.social_media)       d.social_media = []
      if (!d.addresses)          d.addresses = []
      if (!d.schools)            d.schools = []
      if (!d.higher_education)   d.higher_education = []
      if (!d.jobs)               d.jobs = []
      if (!d.hobbies_skills)     d.hobbies_skills = []
      if (!d.person_health_conditions) d.person_health_conditions = []
      if (!d.person_special_notes) d.person_special_notes = []
      if (!d.person_youth_group) d.person_youth_group = []
      if (!d.responsibilities)   d.responsibilities = []
      const personData = d.person || {}
      const normalizedDay = toDatePart(personData.birth_day, 1, 31)
      const normalizedMonth = toDatePart(personData.birth_month, 1, 12)
      if ((!normalizedDay || !normalizedMonth) && personData.birth_date) {
        const legacy = parseLegacyBirthDate(personData.birth_date)
        if (!normalizedDay && legacy.day) personData.birth_day = parseInt(legacy.day, 10)
        if (!normalizedMonth && legacy.month) personData.birth_month = parseInt(legacy.month, 10)
      }
      if (Object.prototype.hasOwnProperty.call(personData, 'birth_date')) {
        delete personData.birth_date
      }
      if (!Array.isArray(d.addresses) || d.addresses.length === 0) {
        const legacyLocation = [personData.address, personData.city, personData.governorate, personData.country].some(Boolean)
        d.addresses = legacyLocation
          ? [{
              country: normalizeCountryValue(personData.country),
              governorate: personData.governorate || '',
              city: personData.city || '',
              address: personData.address || '',
              lat: personData.lat ?? null,
              lng: personData.lng ?? null,
              is_primary: true,
            }]
          : [{ ...DEFAULT_ADDRESS_ROW }]
      }
      d.jobs = normalizeJobRows(d.jobs)
      d.mobile_numbers = normalizeMobileNumberRows(d.mobile_numbers, { validJobIds: d.jobs.map((row) => row.job_id) })
      d.emails = normalizeEmailRows(d.emails, { validJobIds: d.jobs.map((row) => row.job_id) })
      d.social_media = normalizeSocialMediaRows(d.social_media)
      d.nationality = normalizeNationalityRows(d.nationality, { lookup: nationalityIsoLookup })
      d.person_health_conditions = normalizePersonHealthConditionRows(d.person_health_conditions)
      d.person_special_notes = normalizePersonSpecialNoteRows(d.person_special_notes)
      personData.school_graduated = toBoolDefaultFalse(personData.school_graduated)
      personData.school_system = normalizeSchoolSystemValue(personData.school_system)
      personData.school_system_sector = normalizeLooseInput(personData.school_system_sector)
      personData.school_final_gpa = normalizeFinalGpaValue(personData.school_final_gpa)
      d.schools = normalizeSchoolRows(d.schools, { graduatedFromSchools: personData.school_graduated })
      d.higher_education = normalizeHigherEducationRows(d.higher_education)
      d.person_youth_group = normalizeYouthMembershipRows(d.person_youth_group)
      d.responsibilities = normalizeResponsibilityRows(d.responsibilities, { activeJecYear })
      d.addresses = normalizeAddressEditorRows(d.addresses)
      d.person = personData
      setLoadError('')
      setData(d)
      setPhoto(d.photo ?? null)
      setLoading(false)
    }).catch((error) => {
      if (cancelled || loadRequestId.current !== requestId) return
      setData(null)
      setPhoto(null)
      setLoadError(getApiErrorMessage(error, 'تعذّر تحميل الملف الشخصي'))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeJecYear, personId, isUnregistered])

  async function persistProfile(nextData) {
    let payload
    const SUB_KEYS = ['nationality', 'mobile_numbers', 'emails', 'social_media', 'schools', 'higher_education',
        'jobs', 'responsibilities', 'person_youth_group', 'hobbies_skills', 'person_health_conditions', 'person_special_notes', 'addresses']
    const stripId = (rows) =>
      Array.isArray(rows)
        ? rows.map(row => { const { person_id, ...rest } = row; return rest })
        : []
    payload = {
      person: {
        ...(nextData.person || {}),
        country: normalizeCountryValue(nextData.person?.country),
        school_system: storedSchoolSystemValue(nextData.person?.school_system),
        school_system_sector: normalizeLooseInput(nextData.person?.school_system_sector),
        school_final_gpa: normalizeFinalGpaValue(nextData.person?.school_final_gpa),
      },
      ...Object.fromEntries(SUB_KEYS.map(k => [k, stripId(nextData[k])])),
    }
    payload.nationality = serializeNationalityRows(payload.nationality, { dropEmpty: true })
    payload.schools = normalizeSchoolRows(payload.schools, { dropEmpty: true, graduatedFromSchools: Boolean(nextData.person?.school_graduated) })
    payload.higher_education = normalizeHigherEducationRows(payload.higher_education, { dropEmpty: true })
    payload.jobs = normalizeJobRows(payload.jobs, { dropEmpty: true })
    payload.responsibilities = normalizeResponsibilityRows(payload.responsibilities, { dropEmpty: true, activeJecYear })
    payload.emails = serializeEmailRows(payload.emails, { validJobIds: payload.jobs.map((row) => row.job_id) })
    payload.social_media = serializeSocialMediaRows(payload.social_media)
    payload.mobile_numbers = serializeMobileNumberRows(payload.mobile_numbers, { validJobIds: payload.jobs.map((row) => row.job_id) })
    payload.person_health_conditions = normalizePersonHealthConditionRows(payload.person_health_conditions, { dropEmpty: true })
    payload.person_special_notes = serializePersonSpecialNoteRows(payload.person_special_notes, { dropEmpty: true })
    payload.addresses = sanitizeAddressRows(payload.addresses)

    if (isUnregistered) {
      await api.updateUnregistered(personId, payload)
      return
    }

    await api.updatePerson(personId, payload)
  }

  async function commitQueuedSave() {
    if (saveInFlight.current) {
      return activeSavePromise.current
    }
    if (!pendingSaveData.current) {
      if (!isUnmounted.current) setSaving(false)
      return true
    }

    const nextData = pendingSaveData.current
    pendingSaveData.current = null
    saveInFlight.current = true
    if (!isUnmounted.current) setSaving(true)

    const task = (async () => {
      let saveSucceeded = true
      try {
        await persistProfile(nextData)
      } catch (error) {
        saveSucceeded = false
        toast(getApiErrorMessage(error, 'خطأ في الحفظ'), 'error')
      } finally {
        saveInFlight.current = false
        if (pendingSaveData.current) {
          void commitQueuedSave()
        } else if (!isUnmounted.current) {
          setSaving(false)
        }
      }

      return saveSucceeded
    })()

    activeSavePromise.current = task
    return task
  }

  function scheduleAutoSave(newData) {
    clearTimeout(saveTimeout.current)
    pendingSaveData.current = newData
    if (!isUnmounted.current) setSaving(true)
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null
      void commitQueuedSave()
    }, 1200)
  }

  async function flushPendingSave() {
    clearTimeout(saveTimeout.current)
    saveTimeout.current = null
    if (pendingSaveData.current) {
      return commitQueuedSave()
    }
    if (saveInFlight.current) {
      return activeSavePromise.current
    }
    return true
  }

  const update      = (changes)       => { const nd = { ...data, ...changes }; setData(nd); scheduleAutoSave(nd) }
  const updateField = (field, value)  => update({ person: { ...data.person, [field]: value } })
  const updateSub   = (key, newRows)  => {
    if (key === 'jobs') {
      const normalizedJobs = normalizeJobRows(newRows)
      update({
        jobs: normalizedJobs,
        mobile_numbers: normalizeMobileNumberRows(data.mobile_numbers, { validJobIds: normalizedJobs.map((row) => row.job_id) }),
        emails: normalizeEmailRows(data.emails, { validJobIds: normalizedJobs.map((row) => row.job_id) }),
      })
      return
    }
    if (key === 'mobile_numbers') {
      update({
        mobile_numbers: normalizeMobileNumberRows(newRows, { validJobIds: (data.jobs || []).map((row) => row.job_id) }),
      })
      return
    }
    if (key === 'emails') {
      update({
        emails: normalizeEmailRows(newRows, { validJobIds: (data.jobs || []).map((row) => row.job_id) }),
      })
      return
    }
    if (key === 'social_media') {
      update({
        social_media: normalizeSocialMediaRows(newRows),
      })
      return
    }
    if (key === 'responsibilities') {
      update({
        responsibilities: normalizeResponsibilityRows(newRows, { activeJecYear }),
      })
      return
    }
    update({ [key]: key === 'nationality' ? normalizeNationalityRows(newRows, { lookup: nationalityIsoLookup }) : newRows })
  }
  const updateArabicTitle = useCallback((value) => {
    updateField('title', String(value || '').replace(/\s+/g, ' ').trim())
  }, [updateField])
  const updateEnglishTitle = useCallback((englishValue) => {
    const normalizedEnglishValue = String(englishValue || '').replace(/\s+/g, ' ').trim()
    const mappedArabic = personTitleMappings.englishToArabic.get(normalizeTitleLookupKey(normalizedEnglishValue)) || ''
    updateField('title', mappedArabic)
  }, [personTitleMappings, updateField])
  const updateBirthDate = (year, day, month) => {
    update({
      person: {
        ...data.person,
        birth_year: year ? parseInt(year, 10) : null,
        birth_day: day ? parseInt(day, 10) : null,
        birth_month: month ? parseInt(month, 10) : null,
      },
    })
  }

  const handlePromote = async () => {
    if (!window.confirm('هل تريد تحويل هذا الشخص إلى عضو مسجّل؟ سيتم نقل بياناته إلى قائمة الأعضاء.')) return
    setPromoting(true)
    try {
      const saveSucceeded = await flushPendingSave()
      if (!saveSucceeded) return
      const res = await api.promoteUnregistered(personId)
      onPromoted && onPromoted(res.person_id)
    } catch (error) { toast(getApiErrorMessage(error, 'خطأ في التسجيل'), 'error') }
    finally { setPromoting(false) }
  }

  const handleDeleteConfirm = async () => {
    try {
      const saveSucceeded = await flushPendingSave()
      if (!saveSucceeded) return
      if (isUnregistered) {
        await api.deleteUnregistered(personId)
      } else {
        await api.deletePerson(personId)
      }
      toast('تم الحذف النهائي', 'success')
      onBack()
    } catch (error) { toast(getApiErrorMessage(error, 'خطأ في الحذف'), 'error') }
    setConfirm(null)
  }

  const handleArchiveConfirm = async () => {
    const memberships = Array.isArray(data?.person_youth_group) ? data.person_youth_group : []
    const activeMemberships = memberships.filter(row => !row?.archived)
    const scopedActiveMemberships = shouldScopeToViewerGroups
      ? activeMemberships.filter(row => viewerCouncilGroupIds.includes(String(row?.youth_group_id || '').trim()))
      : activeMemberships

    const target = scopedActiveMemberships[0] || activeMemberships[0] || null
    const youthGroupId = String(target?.youth_group_id || '').trim()
    if (!youthGroupId) {
      toast('لا توجد عضوية شبيبة نشطة لأرشفتها', 'error')
      setConfirm(null)
      return
    }

    try {
      const saveSucceeded = await flushPendingSave()
      if (!saveSucceeded) return
      if (isUnregistered) {
        await api.archiveUnregistered(personId, youthGroupId)
      } else {
        await api.archivePerson(personId, youthGroupId)
      }
      toast('تمت الأرشفة بنجاح', 'success')
      onBack()
    } catch (error) { toast(getApiErrorMessage(error, 'خطأ في الأرشفة'), 'error') }
    setConfirm(null)
  }

  const executeConfirm = () => {
    if (confirm?.action === 'delete') return handleDeleteConfirm()
    if (confirm?.action === 'archive') return handleArchiveConfirm()
  }

  const handleBack = async () => {
    const saveSucceeded = await flushPendingSave()
    if (!saveSucceeded) return
    onBack()
  }

  if (loading || !filtersResolved) return <div className="loading-center"><div className="spinner" /></div>
  if (!data)   return <div>{loadError || 'لم يُعثر على العضو'}</div>

  const { person, nationality, mobile_numbers, emails, social_media, addresses, schools, higher_education, jobs, hobbies_skills, person_health_conditions, person_special_notes, person_youth_group, responsibilities } = data

  const youthGroupName = (groupId, { allowCodeFallback = true, fallbackLabel = '—' } = {}) => {
    const gid = String(groupId || '').trim()
    if (!gid) return fallbackLabel
    const found = opts('youth_group').find(o => String(o?.value || '').trim() === gid)
    if (found?.label) return found.label
    if (!allowCodeFallback) return fallbackLabel
    return api.formatYouthGroupLabel(gid) || gid
  }

  const youthGroupLogoUrl = (groupId) => {
    const gid = String(groupId || '').trim()
    if (!gid) return ''
    return api.youthGroupLogoUrl(gid)
  }

  const viewerCouncilGroupIds = Object.keys(currentUser?.council_access || {})
  const isViewerLeader = (currentUser?.role === 'member') && viewerCouncilGroupIds.length > 0

  // Leaders can inspect member profiles, but only in their own youth groups.
  const shouldScopeToViewerGroups = isViewerLeader && !isViewingOwnProfile
  const normalizedPersonYouthGroup = normalizeYouthMembershipRows(person_youth_group || [])
  const visiblePersonYouthGroup = shouldScopeToViewerGroups
    ? normalizedPersonYouthGroup.filter(row => viewerCouncilGroupIds.includes(String(row?.youth_group_id || '').trim()))
    : normalizedPersonYouthGroup
  const normalizedResponsibilities = normalizeResponsibilityRows(responsibilities || [], { activeJecYear })
  const visibleResponsibilities = shouldScopeToViewerGroups
    ? normalizedResponsibilities.filter(row => viewerCouncilGroupIds.includes(String(row?.youth_group_id || '').trim()))
    : normalizedResponsibilities
  const activeVisibleYouthGroupIds = [...new Set(
    visiblePersonYouthGroup
      .filter((row) => !row?.archived)
      .map((row) => String(row?.youth_group_id || '').trim())
      .filter(Boolean)
  )]

  const relevantGroupIds = [...new Set([
    ...visiblePersonYouthGroup.map(r => r?.youth_group_id),
    ...visibleResponsibilities.map(r => r?.youth_group_id),
  ].map(v => String(v || '').trim()).filter(Boolean))]

  const groupedVisibleResponsibilities = visibleResponsibilities.reduce((groups, row, index) => {
    const youthGroupId = String(row?.youth_group_id || '').trim()
    const groupKey = youthGroupId || '__ungrouped__'
    if (!groups[groupKey]) {
      groups[groupKey] = {
        groupId: youthGroupId,
        groupName: youthGroupName(youthGroupId),
        items: [],
      }
    }
    groups[groupKey].items.push({
      key: row?.responsibility_record_id || `${groupKey}-${index}`,
      responsibility: String(row?.responsibility || '').trim() || 'المسؤولية',
      jecYear: String(row?.jec_year || '').trim(),
      isCurrent: row?.is_current === true || row?.is_current === 'true',
      datePeriod: formatResponsibilityPeriod(row),
    })
    return groups
  }, {})

  const arabicProfileTitle = String(person?.title || '').replace(/\s+/g, ' ').trim()
  const fullName = [person?.ar_first_name, person?.ar_second_name, person?.ar_third_name, person?.ar_last_name]
    .filter(Boolean).join(' ') || 'بلا اسم'
  const englishFullName = [person?.en_first_name, person?.en_second_name, person?.en_third_name, person?.en_last_name]
    .filter(Boolean).join(' ')
  const arabicNameParts = [
    { key: 'title', label: 'اللقب', value: arabicProfileTitle },
    { key: 'ar_first_name', label: 'الاسم الأول', value: person?.ar_first_name },
    { key: 'ar_second_name', label: 'الاسم الثاني', value: person?.ar_second_name },
    { key: 'ar_third_name', label: 'الاسم الثالث', value: person?.ar_third_name },
    { key: 'ar_last_name', label: 'اسم العائلة', value: person?.ar_last_name },
  ]
  const motherArabicNameParts = [
    { key: 'mother_ar_first_name', label: 'الاسم الأول', value: person?.mother_ar_first_name },
    { key: 'mother_ar_second_name', label: 'الاسم الثاني', value: person?.mother_ar_second_name },
    { key: 'mother_ar_last_name', label: 'اسم العائلة', value: person?.mother_ar_last_name },
  ]
  const englishNameParts = [
    { key: 'title', label: 'Title', value: englishTitleForPerson, dir: 'ltr' },
    { key: 'en_first_name', label: 'First Name', value: person?.en_first_name, dir: 'ltr' },
    { key: 'en_second_name', label: 'Second Name', value: person?.en_second_name, dir: 'ltr' },
    { key: 'en_third_name', label: 'Third Name', value: person?.en_third_name, dir: 'ltr' },
    { key: 'en_last_name', label: 'Last Name', value: person?.en_last_name, dir: 'ltr' },
  ]
  const motherEnglishNameParts = [
    { key: 'mother_en_first_name', label: 'First Name', value: person?.mother_en_first_name, dir: 'ltr' },
    { key: 'mother_en_second_name', label: 'Second Name', value: person?.mother_en_second_name, dir: 'ltr' },
    { key: 'mother_en_last_name', label: 'Last Name', value: person?.mother_en_last_name, dir: 'ltr' },
  ]
  const birthDateParts = [
    { key: 'birth_year', label: 'السنة', value: String(person?.birth_year || '').trim(), dir: 'ltr' },
    { key: 'birth_month', label: 'الشهر', value: formatDateSegment(person?.birth_month), dir: 'ltr' },
    { key: 'birth_day', label: 'اليوم', value: formatDateSegment(person?.birth_day), dir: 'ltr' },
  ]
  const initials = firstNameInitial(person?.ar_first_name)
  const editableYouthRows = normalizeYouthMembershipRows(person_youth_group)
  const primaryAddress = (addresses || []).find(row => row?.is_primary) || addresses?.[0] || null
  const heroLocation = [primaryAddress?.city, primaryAddress?.governorate, primaryAddress?.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join('، ')
  const heroNationalities = normalizeNationalityRows(nationality, { lookup: nationalityIsoLookup })
  const heroNationalityText = heroNationalities
    .map((row) => normalizeNationalityValue(row?.nationality))
    .filter(Boolean)
    .join('، ')
  const arabicDisplayName = [arabicProfileTitle, fullName].filter(Boolean).join(' ')
  const englishDisplayName = [englishTitleForPerson, englishFullName].filter(Boolean).join(' ')
  const graduatedFromSchools = toBoolDefaultFalse(person?.school_graduated)
  const schoolSystem = normalizeSchoolSystemValue(person?.school_system)
  const schoolSystemSector = normalizeLooseInput(person?.school_system_sector)
  const schoolFinalGpa = normalizeFinalGpaValue(person?.school_final_gpa)
  const schoolSystemOptions = buildSchoolSystemOptions((Array.isArray(filters.school_system) ? filters.school_system : []).map(item => item?.value), schoolSystem)
  const schoolViewRows = normalizeSchoolRows(schools, { graduatedFromSchools })
  const currentSchoolGrade = graduatedFromSchools ? '' : findHighestSchoolGrade(schoolViewRows)
  const higherEducationViewRows = normalizeHigherEducationRows(higher_education)
  const jobViewRows = normalizeJobRows(jobs)
  const mobileNumberViewRows = normalizeMobileNumberRows(mobile_numbers, { validJobIds: jobViewRows.map((row) => row.job_id) })
  const emailViewRows = normalizeEmailRows(emails, { validJobIds: jobViewRows.map((row) => row.job_id) })
  const socialMediaViewRows = normalizeSocialMediaRows(social_media)
  const healthConditionRows = normalizePersonHealthConditionRows(person_health_conditions)
  const specialNoteRows = normalizePersonSpecialNoteRows(person_special_notes)
  const jobOptions = extractJobOptions(jobViewRows)
  const schoolHeaderStatus = graduatedFromSchools ? 'متخرّج من المدارس' : 'على مقاعد الدراسة'
  const schoolHeaderSystem = schoolSystemDisplayLabel(schoolSystem, schoolSystemSector)
  const profileTimestamps = Array.isArray(data?.timestamps) ? data.timestamps : []

  const handleDownloadPdf = async () => {
    if (!data || downloadingPdf) return

    setDownloadingPdf(true)
    try {
      const matcher = isUnregistered
        ? (node) => String(node?.unregisteredId) === String(personId)
        : (node) => String(node?.personId) === String(personId)

      const [orgHistoryResult, gsOrgHistoryResult] = await Promise.allSettled([
        loadOrgHistoryTrees({
          personId: isUnregistered ? null : personId,
          unregisteredId: isUnregistered ? personId : null,
          groupIds: relevantGroupIds,
        }),
        loadOrgHistoryTrees({
          personId: isUnregistered ? null : personId,
          unregisteredId: isUnregistered ? personId : null,
          groupIds: [GS_GROUP_KEY_PROFILE],
        }),
      ])

      const orgEntries = orgHistoryResult.status === 'fulfilled'
        ? buildOrgHistory(matcher, orgHistoryResult.value)
        : []
      const gsOrgEntries = gsOrgHistoryResult.status === 'fulfilled'
        ? buildGSOrgHistory(matcher, gsOrgHistoryResult.value)
        : []

      const now = new Date()
      const timestampLabel = now.toLocaleString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
      const safeStamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
      ].join('')
      const jobLabelById = new Map(jobOptions.map((option) => [option.value, option.label]))
      const filledAtEntries = profileTimestamps
        .map((row) => {
          const timestamp = String(row?.timestamp || '').trim()
          if (!timestamp) return null
          const youthGroupId = String(row?.youth_group_id || '').trim()
          const parsed = Date.parse(timestamp.replace(' ', 'T'))
          const formattedTimestamp = Number.isNaN(parsed)
            ? timestamp
            : new Date(parsed).toLocaleString('ar-EG', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
          const youthGroupLabel = youthGroupName(youthGroupId)
          const sortValue = Number.isNaN(parsed) ? -1 : parsed
          return {
            key: `${youthGroupId}::${timestamp}`,
            label: youthGroupLabel || '—',
            timestamp: formattedTimestamp,
            sortValue,
          }
        })
        .filter(Boolean)
        .sort((left, right) => right.sortValue - left.sortValue || left.label.localeCompare(right.label, 'ar'))
      const seenFilledAtEntries = new Set()
      const dedupedFilledAtEntries = filledAtEntries
        .filter((entry) => {
          if (seenFilledAtEntries.has(entry.key)) return false
          seenFilledAtEntries.add(entry.key)
          return true
        })
      const filledAtLabel = dedupedFilledAtEntries
        .map((entry) => `${entry.label}: ${entry.timestamp}`)
        .join('\n') || '—'
      const youthGroupLogos = activeVisibleYouthGroupIds
        .map((groupId) => {
          const normalizedGroupId = String(groupId || '').trim()
          if (!normalizedGroupId) return null
          return {
            groupId: normalizedGroupId,
            label: youthGroupName(normalizedGroupId) || '',
            url: api.youthGroupLogoUrl(normalizedGroupId, safeStamp),
          }
        })
        .filter(Boolean)

      await downloadProfilePdf({
        fileName: `profile-${String(personId || 'person').replace(/[^a-zA-Z0-9_-]/g, '_')}-${safeStamp}.pdf`,
        downloadedAtLabel: timestampLabel,
        filledAtEntries: dedupedFilledAtEntries,
        filledAtLabel,
        personTypeLabel: isUnregistered ? 'شخص غير مسجّل' : 'عضو مسجّل',
        arabicDisplayName,
        englishDisplayName,
        initials,
        photoUrl: photo || '',
        youthGroupLogos,
        summaryBadges: [
          heroLocation ? `الموقع: ${heroLocation}` : '',
          person?.gender ? `الجنس: ${person.gender}` : '',
          person?.birth_year ? `سنة الميلاد: ${person.birth_year}` : '',
          heroNationalityText ? `الجنسية: ${heroNationalityText}` : '',
        ].filter(Boolean),
        sections: [
          {
            title: 'البيانات الشخصية',
            fields: [
              { label: 'الاسم الكامل بالعربية', value: arabicDisplayName },
              { label: 'English Name', value: englishDisplayName, dir: 'ltr' },
              { label: 'اسم الأم بالعربية', value: motherArabicNameParts.map((part) => part.value).filter(Boolean).join(' ') },
              { label: 'Mother\'s Name', value: motherEnglishNameParts.map((part) => part.value).filter(Boolean).join(' '), dir: 'ltr' },
              { label: 'الجنس', value: person?.gender },
              { label: 'تاريخ الميلاد', value: birthDateParts.map((part) => part.value).filter(Boolean).join(' / '), dir: 'ltr' },
            ],
          },
          {
            title: 'الجنسية',
            records: nationality.map((row) => ({
              title: String(row?.nationality || 'جنسية').trim() || 'جنسية',
              chips: [],
            })),
            emptyText: 'لا توجد بيانات جنسية محفوظة',
          },
          {
            title: 'العناوين',
            records: addresses.map((row, index) => ({
              title: `العنوان ${index + 1}`,
              badge: row?.is_primary ? 'الرئيسي' : '',
              fields: [
                { label: 'البلد', value: row?.country },
                { label: 'المحافظة', value: row?.governorate },
                { label: 'المدينة', value: row?.city },
                { label: 'العنوان التفصيلي', value: row?.address },
                { label: 'الموقع على الخريطة', value: buildGoogleMapsOpenUrl(row) || '', href: buildGoogleMapsOpenUrl(row) || '', dir: 'ltr' },
              ],
            })),
            emptyText: 'لا توجد عناوين محفوظة',
          },
          {
            title: 'وسائل التواصل',
            records: [
              ...mobileNumberViewRows.map((row) => {
                const linkedJobLabels = parseLinkedJobIds(row?.linked_job_ids)
                  .map((jobId) => jobLabelById.get(jobId) || '')
                  .filter(Boolean)
                return {
                  title: phoneRowTitle(row),
                  titleDir: 'ltr',
                  titleHref: row?.mobile_number ? `tel:${String(row.mobile_number).trim()}` : '',
                  badge: mobileNumberBadgeLabel(row),
                  chips: [
                    row?.phone_calls_flag ? 'يدعم الاتصالات' : '',
                    row?.whatsapp_flag ? 'واتساب' : '',
                    ...linkedJobLabels,
                  ].filter(Boolean),
                }
              }),
              ...emailViewRows.map((row) => ({
                title: row?.email || 'بريد إلكتروني',
                titleDir: 'ltr',
                titleHref: row?.email ? `mailto:${row.email}` : '',
                badge: row?.type === 'personal'
                  ? (row?.is_primary ? 'شخصي - الرئيسي' : 'شخصي')
                  : emailTypeLabel(row?.type, row?.family_relation),
                chips: row?.type === 'work'
                  ? parseLinkedJobIds(row?.linked_job_ids).map((jobId) => jobLabelById.get(jobId) || '').filter(Boolean)
                  : [],
              })),
              ...socialMediaViewRows.map((row) => ({
                title: socialPlatformLabel(row?.platform),
                subtitle: buildSocialProfileUrl(row?.url) || row?.url || '',
                subtitleDir: 'ltr',
                subtitleHref: buildSocialProfileUrl(row?.url) || '',
                badge: row?.is_primary ? 'الرئيسي' : '',
              })),
            ],
            emptyText: 'لا توجد وسائل تواصل محفوظة',
          },
          {
            title: 'الشبيبة والمسؤوليات',
            note: shouldScopeToViewerGroups
              ? 'يعكس هذا التصدير فقط بيانات الشبيبة الواقعة ضمن المجموعات التي يملك المستخدم الحالي صلاحية قيادتها.'
              : '',
            records: [
              ...visiblePersonYouthGroup.map((row) => ({
                title: youthGroupName(row?.youth_group_id),
                badge: row?.archived ? 'عضو قديم' : 'عضو حالي',
                fields: [
                  { label: 'سنة الانتساب', value: row?.youth_join_year },
                  { label: 'الفئة الحالية', value: row?.current_age_group || row?.age_group },
                  { label: 'تسلسل الفئات', value: normalizeYouthMembershipHistoryRows(row?.age_group_history).map((entry) => `${entry.age_group} (${formatYouthMembershipHistoryPeriod(entry)})`).join('، ') },
                ],
                accent: 'gold',
              })),
              ...visibleResponsibilities.map((row) => ({
                title: row?.responsibility || 'مسؤولية',
                badge: youthGroupName(row?.youth_group_id),
                fields: [
                  { label: 'سنة JEC', value: row?.jec_year },
                  { label: 'الحالة', value: responsibilityCurrentLabel(row?.is_current === true || row?.is_current === 'true') },
                  { label: 'تاريخ البداية', value: row?.start_date },
                  { label: 'تاريخ النهاية', value: row?.end_date },
                ],
              })),
            ],
            emptyText: 'لا توجد بيانات شبيبة أو مسؤوليات مرئية لهذا المستخدم',
          },
          {
            title: 'التعليم',
            fields: [
              { label: 'الحالة المدرسية', value: schoolHeaderStatus },
              { label: 'نظام الدراسة', value: schoolHeaderSystem },
              { label: 'الصف الحالي', value: currentSchoolGrade },
              { label: 'المعدل النهائي المدرسي', value: formatSchoolGpaDisplay(schoolFinalGpa) },
            ],
            records: [
              ...schoolViewRows.map((row) => {
                const schoolTitle = formatSchoolDisplayName(row)
                return {
                  title: schoolTitle,
                  badge: row?.is_current ? 'حاليًّا' : '',
                  logoUrl: resolveSchoolLogoUrl(schoolLogoEntries, 'school', row?.school, row?.section) || '',
                  logoAlt: schoolTitle,
                  fields: [
                    { label: 'الفترة', value: formatSchoolPeriod(row) },
                    { label: 'الصفوف', value: Array.isArray(row?.grades_attended) ? row.grades_attended.join('، ') : '' },
                  ],
                }
              }),
              ...higherEducationViewRows.map((row) => ({
                title: row?.university_college || 'الجامعة / الكلية',
                badge: higherEducationStateLabel(row?.state) || row?.degree || '',
                logoUrl: resolveSchoolLogoUrl(schoolLogoEntries, 'university', row?.university_college, '') || '',
                logoAlt: row?.university_college || 'الجامعة / الكلية',
                fields: [
                  { label: 'التخصّص', value: row?.major },
                  { label: 'الدرجة العلميّة', value: row?.degree },
                  { label: 'الفترة', value: formatHigherEducationPeriod(row) },
                  { label: 'المعدل التراكمي', value: (row?.state === 'current' || row?.state === 'graduated') ? formatUniversityGpaDisplay(row?.final_gpa) : '' },
                ],
              })),
            ],
            emptyText: 'لا توجد بيانات تعليمية محفوظة',
          },
          {
            title: 'العمل',
            records: jobViewRows.map((row) => ({
              title: jobRowLabel(row),
              badge: jobStateLabel(row?.state),
              fields: [
                { label: 'الشركة / المؤسسة', value: row?.company },
                { label: 'الفترة', value: formatJobPeriod(row) },
              ],
            })),
            emptyText: 'لا توجد بيانات عمل محفوظة',
          },
          {
            title: 'الصحة',
            records: healthConditionRows.map((row) => ({
              title: row?.details || '—',
              badge: personHealthConditionTypeLabel(row?.type),
            })),
            emptyText: 'لا توجد معلومات صحية محفوظة',
          },
          {
            title: 'الملاحظات الخاصة',
            records: specialNoteRows.map((row) => ({
              title: row?.note_title || 'ملاحظة خاصة',
              body: row?.note || '',
            })),
            emptyText: 'لا توجد ملاحظات خاصة محفوظة',
          },
          {
            title: 'الهوايات والمهارات',
            chips: hobbies_skills.map((row) => row?.hobby_skill).filter(Boolean),
            emptyText: 'لا توجد هوايات أو مهارات محفوظة',
          },
          {
            title: 'الهيكل التنظيمي في الشبيبة',
            type: 'org-history',
            entries: orgEntries,
            emptyText: 'لا يوجد مسار تنظيمي محفوظ داخل الشبيبة',
          },
          {
            title: 'المسار التنظيمي في الأمانة العامة',
            type: 'org-history',
            entries: gsOrgEntries,
            emptyText: 'لا يوجد مسار تنظيمي محفوظ داخل الأمانة العامة',
          },
        ],
      })

      toast('تم تنزيل ملف PDF', 'success')
    } catch {
      toast('تعذّر إنشاء ملف PDF', 'error')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const TABS = [
    { id: 'info',    label: 'المعلومات الأساسية', icon: Shield },
    { id: 'address', label: 'العناوين',            icon: MapPin },
    { id: 'youth',   label: 'الشبيبة',            icon: Users },
    { id: 'edu',     label: 'التعليم',             icon: GraduationCap },
    { id: 'work',    label: 'العمل',               icon: Briefcase },
    { id: 'health',  label: 'الصحة',               icon: Shield },
    { id: 'notes',   label: 'ملاحظات خاصة',        icon: Pencil },
    { id: 'hobbies', label: 'الهوايات',            icon: Heart },
    { id: 'org', label: 'هيكل الشبيبة', icon: GitBranch },
    { id: 'gsorg', label: 'الأمانة العامة', icon: GitBranch },
  ]

  // For photo upload in unregistered profile
  const handlePhotoChange = isUnregistered
    ? (newUrl) => setPhoto(newUrl)
    : (newUrl) => setPhoto(newUrl)

  const isViewMode = readOnly || !isEditing
  const isAddressViewMode = readOnly || !isEditing

  return (
    <div className="profile-page">
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'delete' ? 'تأكيد الحذف النهائي' : 'تأكيد الأرشفة'}
        message={
          confirm?.action === 'delete'
            ? `هل أنت متأكد من حذف "${data?.person ? [data.person.ar_first_name, data.person.ar_last_name].filter(Boolean).join(' ') : ''}" نهائياً؟ سيتم حذف جميع بياناته بشكل دائم ولا يمكن التراجع عن هذا الإجراء.`
            : `هل تريد أرشفة هذا السجل؟ سينتقل إلى تبويب الأرشيف في قائمة الأعضاء ويمكن استعادته لاحقاً.`
        }
        confirmLabel={confirm?.action === 'delete' ? 'حذف نهائي' : 'أرشفة'}
        confirmClass={confirm?.action === 'delete' ? 'btn-danger' : 'btn-primary'}
        onConfirm={executeConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* Back + saving indicator + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={handleBack}>
          <ArrowRight size={15} /> العودة للقائمة
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            title="تنزيل الملف الشخصي بصيغة PDF"
          >
            <Download size={14} /> {downloadingPdf ? 'جارٍ إعداد PDF…' : 'تنزيل PDF'}
          </button>
          {canEnterEditMode && (
            <button
              className={`btn btn-sm ${isEditing ? 'btn-ghost' : 'btn-primary'}`}
              onClick={() => setIsEditing((current) => !current)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Pencil size={14} /> {isEditing ? 'إنهاء التحرير' : 'تعديل الملف'}
            </button>
          )}
          {isEditing && saving && <span style={{ fontSize: '0.82rem', color: 'var(--gray-400)' }}>جارٍ الحفظ…</span>}
          {canFullyEditProfile && isUnregistered && (
            <button
              className="btn btn-gold btn-sm"
              onClick={handlePromote}
              disabled={promoting}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Users size={14} />
              {promoting ? 'جارٍ التسجيل…' : 'تسجيل كعضو رسمي'}
            </button>
          )}
          {canFullyEditProfile && <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirm({ action: 'archive' })}
            title="أرشفة السجل"
            style={{ color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Archive size={14} /> أرشفة
          </button>}
          {canFullyEditProfile && <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirm({ action: 'delete' })}
            title="حذف نهائي"
            style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Trash2 size={14} /> حذف نهائي
          </button>}
        </div>
      </div>

      {/* Unregistered banner */}
      {isUnregistered && (
        <div style={{
          background: '#fffbeb', border: '1px solid #e8b55a', borderRadius: 'var(--radius-md)',
          padding: '10px 16px', marginBottom: 16, fontSize: '0.85rem', color: '#92400e',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <UserX size={16} style={{ flexShrink: 0 }} />
          <span>{canFullyEditProfile
            ? 'هذا الشخص لم يُسجَّل بعد كعضو رسمي. يمكن تسجيله كعضو رسمي بالضغط على الزر أعلاه.'
            : 'هذا الشخص لم يُسجَّل بعد كعضو رسمي. التسجيل كعضو رسمي متاح فقط للمشرفين.'}
          </span>
        </div>
      )}

      {/* Hero */}
      <div className="profile-hero" style={{ marginBottom: 20 }}>
        {isUnregistered ? (
          <UnregisteredProfileAvatar uid={personId} initials={initials} photoUrl={photo}
            onPhotoChange={setPhoto} toast={toast} canUpload={canFullyEditProfile} />
        ) : (
          <ProfileAvatar personId={personId} initials={initials} photoUrl={photo}
            onPhotoChange={setPhoto} toast={toast} canUpload={canFullyEditProfile} />
        )}
        <div className="profile-details">
          <div className="profile-identity-block">
            <div className="profile-name">
              {arabicDisplayName}
            </div>
            {englishDisplayName && (
              <div className="profile-name-secondary">
                {englishDisplayName}
              </div>
            )}
          </div>
          <div className="profile-sub">
            {heroLocation && (
              <div className="profile-sub-item profile-sub-item-location">
                <span className="profile-sub-icon" aria-hidden="true">📍</span>
                <span>{heroLocation}</span>
              </div>
            )}
            {person?.gender && (
              <div className="profile-sub-item">
                <GenderChipContent gender={person.gender} />
              </div>
            )}
            {person?.birth_year && (
              <div className="profile-sub-item">
                <span className="profile-sub-icon" aria-hidden="true">🗓</span>
                <span>{person.birth_year}</span>
              </div>
            )}
            {heroNationalities.length > 0 && (
              <div className="profile-sub-item">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {heroNationalities.map((row, index) => (
                    <span key={`${row?.nationality || 'nat'}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {index > 0 ? <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.72)' }}>•</span> : null}
                      {renderNationalityLabel(row, { fallbackIcon: '🌍', gap: 6 })}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
          {Array.isArray(orgContext?.nodes) && (() => {
            const n = orgContext.nodes.find(x => x.id === orgContext.currentNodeId)
            return n?.role ? (
              <div style={{ marginTop: 8 }}>
                <span style={{ background: 'var(--navy)', color: 'white', fontSize: '0.75rem',
                  fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
                  <GitBranch size={11} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
                  {n.role}
                </span>
              </div>
            ) : null
          })()}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs profile-tabs">
        <div className="profile-tabs-scroll">
          {TABS.map(t => (
            <button key={t.id} className={`tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              <t.icon size={15} style={{ flexShrink: 0 }} />
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Info ── */}
      {activeTab === 'info' && (
        <div className="profile-tab-panel">
          {isViewMode ? (
            <div className="profile-two-column-layout profile-view-grid">
              <div className="profile-stack-column">
              <div className="card">
                <div className="card-header"><span className="card-title"><Shield size={15} /> البيانات الشخصية</span></div>
                <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                  <ViewSegmentedField label="الاسم الكامل" parts={arabicNameParts} />
                  <ViewSegmentedField label="English Name" parts={englishNameParts} dir="ltr" valueDir="ltr" tone="subtle" />
                  <ViewSegmentedField label="اسم الأم" parts={motherArabicNameParts} />
                  <ViewSegmentedField label="Mother's Name" parts={motherEnglishNameParts} dir="ltr" valueDir="ltr" tone="subtle" />
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 0.7fr) minmax(220px, 1.3fr)', gap: 10, alignItems: 'start' }}>
                    <ViewField label="الجنس" value={person?.gender} />
                    <ViewSegmentedField label="تاريخ الميلاد" parts={birthDateParts} dir="ltr" valueDir="ltr" />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title"><Globe size={15} /> الجنسية</span></div>
                <div className="card-body"><NationalitySectionView rows={nationality} lookup={nationalityIsoLookup} /></div>
              </div>
            </div>

            <div className="profile-stack-column">
              <div className="card">
                <div className="card-header"><span className="card-title"><Phone size={15} /> أرقام الهاتف</span></div>
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  {mobileNumberViewRows.length ? mobileNumberViewRows.map((row, index) => {
                    const country = detectPhoneCountry(row?.mobile_number)
                    const phoneCallHref = row?.phone_calls_flag ? buildPhoneCallHref(row?.mobile_number) : ''
                    const whatsAppUrl = row?.whatsapp_flag ? buildWhatsAppChatUrl(row?.mobile_number) : ''
                    const linkedJobLabels = parseLinkedJobIds(row?.linked_job_ids)
                      .map((jobId) => jobOptions.find((option) => option.value === jobId)?.label || '')
                      .filter(Boolean)
                    const actions = (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
                        {row?.phone_calls_flag ? (
                          phoneCallHref ? (
                            <a
                              href={phoneCallHref}
                              title="اتصال"
                              aria-label="اتصال"
                              onClick={(event) => event.stopPropagation()}
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, background: 'white', border: '1px solid var(--gray-200)', color: 'var(--navy)', textDecoration: 'none' }}
                            >
                              <PhoneCall size={13} />
                            </a>
                          ) : (
                            <span
                              title="اتصالات"
                              aria-label="اتصالات"
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, background: 'white', border: '1px solid var(--gray-200)', color: 'var(--navy)' }}
                            >
                              <PhoneCall size={13} />
                            </span>
                          )
                        ) : null}
                        {row?.whatsapp_flag ? (
                          whatsAppUrl ? (
                            <a
                              href={whatsAppUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="فتح محادثة واتساب"
                              aria-label="فتح محادثة واتساب"
                              onClick={(event) => event.stopPropagation()}
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 999, background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)', color: '#25D366', textDecoration: 'none', boxShadow: '0 4px 10px rgba(15,23,42,0.06)' }}
                            >
                              <WhatsAppIcon size={20} />
                            </a>
                          ) : (
                            <span
                              title="واتساب"
                              aria-label="واتساب"
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 999, background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 4px 10px rgba(15,23,42,0.06)' }}
                            >
                              <WhatsAppIcon size={20} />
                            </span>
                          )
                        ) : null}
                      </div>
                    )

                    const highlightPrimary = parseMobileNumberTypeMeta(row?.type).baseType === 'personal'
                      && countPersonalMobileRows(mobileNumberViewRows) > 1
                      && Boolean(row?.is_primary)

                    return (
                      <ViewRecordCard
                        key={`phone-${index}`}
                        title={(
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
                            {country?.flag ? (
                              <img
                                src={emojiAssetUrlFromEmoji(country.flag)}
                                alt={country.name}
                                title={country.name}
                                width="20"
                                height="20"
                                style={{ width: 20, height: 20, flexShrink: 0 }}
                              />
                            ) : null}
                            <span dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>{phoneRowTitle(row) || '—'}</span>
                          </span>
                        )}
                        badge={mobileNumberBadgeLabel(row)}
                        highlighted={highlightPrimary}
                        actions={actions}
                      >
                        {parseMobileNumberTypeMeta(row?.type).baseType === 'work'
                          ? <ViewChipList values={linkedJobLabels} emptyText="غير مرتبط بأي سجل عمل" />
                          : null}
                      </ViewRecordCard>
                    )
                  }) : <ViewEmptyState text="لا توجد أرقام هاتف" />}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title"><Mail size={15} /> البريد الإلكتروني</span></div>
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  {emailViewRows.length ? emailViewRows.map((row, index) => {
                    const linkedJobLabels = parseLinkedJobIds(row?.linked_job_ids)
                      .map((jobId) => jobOptions.find((option) => option.value === jobId)?.label || '')
                      .filter(Boolean)
                    const badge = row?.type === 'personal'
                      ? 'شخصي'
                      : emailTypeLabel(row?.type, row?.family_relation)

                    const highlightPrimary = row?.type === 'personal'
                      && countPersonalEmailRows(emailViewRows) > 1
                      && Boolean(row?.is_primary)

                    return (
                      <ViewRecordCard
                        key={`email-${index}`}
                        title={<span dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>{row?.email || '—'}</span>}
                        badge={badge}
                        highlighted={highlightPrimary}
                        actions={row?.email ? (
                          <a
                            href={`mailto:${row.email}`}
                            onClick={(event) => event.stopPropagation()}
                            title="إرسال بريد إلكتروني"
                            aria-label="إرسال بريد إلكتروني"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 32,
                              height: 32,
                              borderRadius: 999,
                              background: '#ffffff',
                              border: '1px solid rgba(15,23,42,0.08)',
                              boxShadow: '0 4px 10px rgba(15,23,42,0.06)',
                              color: 'var(--navy)',
                              textDecoration: 'none',
                            }}
                          >
                            <Mail size={16} />
                          </a>
                        ) : null}
                      >
                        {row?.type === 'work'
                          ? <ViewChipList values={linkedJobLabels} emptyText="غير مرتبط بأي سجل عمل" />
                          : null}
                      </ViewRecordCard>
                    )
                  }) : <ViewEmptyState text="لا توجد عناوين بريد إلكتروني" />}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title"><Globe size={15} /> وسائل التواصل الاجتماعي</span></div>
                <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {socialMediaViewRows.length ? socialMediaViewRows.map((row, index) => {
                    const highlightPrimary = countSocialPlatformRows(socialMediaViewRows, row?.platform) > 1 && Boolean(row?.is_primary)

                    return (
                      <SocialMediaCompactCard
                        key={`social-${index}`}
                        row={row}
                        highlightPrimary={highlightPrimary}
                      />
                    )
                  }) : <ViewEmptyState text="لا توجد حسابات تواصل اجتماعي" style={{ gridColumn: '1 / -1' }} />}
                </div>
              </div>
            </div>
            </div>
          ) : (
            <div className="profile-two-column-layout">
              <div className="card">
              <div className="card-header"><span className="card-title"><Shield size={15} /> البيانات الشخصية</span></div>
              <div className="card-body">
                <div className="profile-name-columns">
                  <div className="profile-name-section">
                    <div className="profile-name-section-title">الاسم بالعربية</div>
                    {isUnregistered && (
                      <InlineSelectField label="اللقب" value={person?.title} onChange={updateArabicTitle} options={personTitleOptions(person?.title)} />
                    )}
                    <InlineComboField label="الاسم الأول"   value={person?.ar_first_name}  onChange={v => updateField('ar_first_name', v)}  options={opts('ar_first_name')} />
                    <InlineComboField label="الاسم الثاني"  value={person?.ar_second_name} onChange={v => updateField('ar_second_name', v)} options={opts('ar_second_name')} />
                    <InlineComboField label="الاسم الثالث"  value={person?.ar_third_name}  onChange={v => updateField('ar_third_name', v)}  options={opts('ar_third_name')} />
                    <InlineComboField label="اسم العائلة"   value={person?.ar_last_name}   onChange={v => updateField('ar_last_name', v)}   options={opts('ar_last_name')} />
                    <div className="profile-name-section-title" style={{ marginTop: 12 }}>اسم الأم</div>
                    <InlineComboField label="الاسم الأول" value={person?.mother_ar_first_name} onChange={v => updateField('mother_ar_first_name', v)} options={opts('mother_ar_first_name')} />
                    <InlineComboField label="الاسم الثاني" value={person?.mother_ar_second_name} onChange={v => updateField('mother_ar_second_name', v)} options={opts('mother_ar_second_name')} />
                    <InlineComboField label="اسم العائلة" value={person?.mother_ar_last_name} onChange={v => updateField('mother_ar_last_name', v)} options={opts('mother_ar_last_name')} />
                  </div>
                  <div className="profile-name-section profile-name-section-english">
                    <div className="profile-name-section-title">English Name</div>
                    {isUnregistered && (
                      <InlineSelectField label="Title" value={englishTitleForPerson} onChange={updateEnglishTitle} options={personEnglishTitleOptions(person?.title)} dir="ltr" />
                    )}
                    <InlineComboField label="First Name"  value={person?.en_first_name}  onChange={v => updateField('en_first_name', v)} options={opts('en_first_name')} dir="ltr" />
                    <InlineComboField label="Second Name" value={person?.en_second_name} onChange={v => updateField('en_second_name', v)} options={opts('en_second_name')} dir="ltr" />
                    <InlineComboField label="Third Name"  value={person?.en_third_name}  onChange={v => updateField('en_third_name', v)} options={opts('en_third_name')} dir="ltr" />
                    <InlineComboField label="Last Name"   value={person?.en_last_name}   onChange={v => updateField('en_last_name', v)} options={opts('en_last_name')} dir="ltr" />
                    <div className="profile-name-section-title" style={{ marginTop: 12 }}>Mother's Name</div>
                    <InlineComboField label="First Name" value={person?.mother_en_first_name} onChange={v => updateField('mother_en_first_name', v)} options={opts('mother_en_first_name')} dir="ltr" />
                    <InlineComboField label="Second Name" value={person?.mother_en_second_name} onChange={v => updateField('mother_en_second_name', v)} options={opts('mother_en_second_name')} dir="ltr" />
                    <InlineComboField label="Last Name" value={person?.mother_en_last_name} onChange={v => updateField('mother_en_last_name', v)} options={opts('mother_en_last_name')} dir="ltr" />
                  </div>
                </div>
                <InlineSelectField label="الجنس"        value={person?.gender}      onChange={v => updateField('gender', v)}       options={opts('gender')} />
                <InlineDobField
                  label="تاريخ الميلاد"
                  year={person?.birth_year}
                  day={person?.birth_day}
                  month={person?.birth_month}
                  legacyValue={person?.birth_date}
                  onChange={updateBirthDate}
                />
              </div>
            </div>
            <div className="profile-stack-column">
              <div className="card">
                <div className="card-header"><span className="card-title"><Globe size={15} /> الجنسية</span></div>
                <div className="card-body">
                  <NationalityRowsEditor
                    rows={nationality}
                    onChange={rows => updateSub('nationality', rows)}
                    lookup={nationalityIsoLookup}
                    options={opts('nationality')}
                  />
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title"><Phone size={15} /> أرقام الهاتف</span></div>
                <div className="card-body">
                  <PhoneNumbersEditor rows={mobile_numbers} onChange={rows => updateSub('mobile_numbers', rows)} jobRows={jobs} />
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title"><Mail size={15} /> البريد الإلكتروني</span></div>
                <div className="card-body">
                  <EmailsEditor rows={emails} onChange={rows => updateSub('emails', rows)} jobRows={jobs} />
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title"><Globe size={15} /> وسائل التواصل الاجتماعي</span></div>
                <div className="card-body">
                  <SocialMediaEditor rows={social_media} onChange={rows => updateSub('social_media', rows)} />
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'address' && (
        <div className="profile-tab-panel">
          <div className="card">
            <div className="card-header"><span className="card-title"><MapPin size={15} /> العناوين</span></div>
            <div className="card-body">
              {isAddressViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {addresses.length ? addresses.map((row, index) => {
                    const addressParts = [
                      { key: 'country', label: 'البلد', value: row?.country },
                      { key: 'governorate', label: 'المحافظة', value: row?.governorate },
                      { key: 'city', label: 'المدينة', value: row?.city },
                      { key: 'address', label: 'العنوان التفصيلي', value: row?.address },
                    ]
                    return (
                      <ViewRecordCard
                        key={`address-${index}`}
                        title={`العنوان ${index + 1}`}
                        badge={row?.is_primary ? 'الرئيسي' : ''}
                        onOpenMap={buildGoogleMapsOpenUrl(row) ? () => window.open(buildGoogleMapsOpenUrl(row), '_blank', 'noopener,noreferrer') : null}
                      >
                        <ViewSegmentedField label="العنوان" parts={addressParts} />
                      </ViewRecordCard>
                    )
                  }) : <ViewEmptyState text="لا توجد عناوين محفوظة" />}
                </div>
              ) : (
                <AddressRowsEditor rows={addresses} onChange={rows => updateSub('addresses', rows)} governorateOptions={opts('governorate')} locationOnly={false} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Youth ── */}
      {activeTab === 'youth' && (
        <div className="profile-tab-panel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {shouldScopeToViewerGroups && (
            <div style={{
              background: '#fffbeb', border: '1px solid #e8b55a', borderRadius: 'var(--radius-md)',
              padding: '8px 12px', fontSize: '0.8rem', color: '#92400e',
            }}>
              يتم عرض بيانات الشبيبة المرتبطة فقط بمجموعاتك التي لديك فيها صلاحية قيادة.
            </div>
          )}
          <div className="card">
            <div className="card-header"><span className="card-title"><Users size={15} /> انتساب الشبيبة</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {visiblePersonYouthGroup.length ? visiblePersonYouthGroup.map((row, i) => (
                    <YouthMembershipCompactCard
                      key={`youth-${i}`}
                      row={row}
                      title={youthGroupName(row?.youth_group_id, { allowCodeFallback: false, fallbackLabel: 'الشبيبة' })}
                      badge={row?.archived ? 'عضو قديم' : 'عضو حالي'}
                      logoUrl={youthGroupLogoUrl(row?.youth_group_id)}
                      logoAlt={youthGroupName(row?.youth_group_id, { allowCodeFallback: false, fallbackLabel: 'الشبيبة' })}
                    />
                  )) : <ViewEmptyState text="لا توجد بيانات ضمن مجموعاتك" />}
                </div>
              ) : (
                <YouthMembershipEditor
                  rows={editableYouthRows}
                  onChange={(rows) => updateSub('person_youth_group', rows)}
                  youthGroupOptions={opts('youth_group')}
                  allowHigherAgeGroups={canFullyEditProfile}
                />
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title"><Shield size={15} /> المسؤوليات</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {visibleResponsibilities.length ? Object.values(groupedVisibleResponsibilities).map((group) => (
                    <ResponsibilityGroupCard
                      key={`resp-group-${group.groupId || 'ungrouped'}`}
                      groupName={group.groupName || 'الشبيبة'}
                      groupId={group.groupId}
                      items={group.items}
                      logoUrl={youthGroupLogoUrl(group.groupId)}
                      logoAlt={group.groupName}
                    />
                  )) : <ViewEmptyState text="لا توجد بيانات ضمن مجموعاتك" />}
                </div>
              ) : (
                <ResponsibilityRowsEditor
                  rows={normalizedResponsibilities}
                  onChange={rows => updateSub('responsibilities', rows)}
                  youthGroupOptions={responsibilityYouthGroupOptions}
                  responsibilityOptions={opts('responsibility')}
                  activeJecYear={activeJecYear}
                  resolveYouthGroupLabel={youthGroupName}
                />
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ── Education ── */}
      {activeTab === 'edu' && (
        <div className="profile-tab-panel">
          <div className="profile-two-column-layout">
            <div className="card">
              <div className="card-header">
                <div className="profile-card-title-stack">
                  <span className="card-title"><School size={15} /> المدارس</span>
                  <div className="profile-card-meta-line">
                    <span className="profile-card-meta-item">{schoolHeaderStatus}</span>
                    <span className="profile-card-meta-separator" aria-hidden="true">•</span>
                    {currentSchoolGrade ? (
                      <>
                        <span className="profile-card-meta-item">الصف الحالي: {currentSchoolGrade}</span>
                        <span className="profile-card-meta-separator" aria-hidden="true">•</span>
                      </>
                    ) : null}
                    <span className="profile-card-meta-item">نظام الدراسة: {schoolHeaderSystem}</span>
                    {graduatedFromSchools && schoolFinalGpa ? (
                      <>
                        <span className="profile-card-meta-separator" aria-hidden="true">•</span>
                        <span className="profile-card-meta-item">المعدل النهائي: {formatSchoolGpaDisplay(schoolFinalGpa)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="card-body">
                {isViewMode ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                      {schoolViewRows.length ? schoolViewRows.map((row, index) => {
                      const meta = [
                        formatSchoolPeriod(row) ? `الفترة: ${formatSchoolPeriod(row)}` : '',
                      ].filter(Boolean)
                      const schoolLogoUrl = resolveSchoolLogoUrl(schoolLogoEntries, 'school', row?.school, row?.section)
                      return (
                        <ViewRecordCard key={`school-${index}`} title={formatSchoolDisplayName(row)} badge={row?.is_current ? 'حاليًّا' : ''} logoUrl={schoolLogoUrl} logoAlt={formatSchoolDisplayName(row)}>
                          {meta.length ? <ViewChipList values={meta} /> : null}
                          {row?.grades_attended?.length ? <ViewField label="الصفوف" value={row.grades_attended.join('، ')} /> : null}
                        </ViewRecordCard>
                      )
                    }) : <ViewEmptyState text="لا توجد مدارس محفوظة" />}
                  </div>
                ) : (
                  <SchoolRowsEditor
                    rows={schools}
                    onChange={rows => updateSub('schools', rows)}
                    schoolOptions={opts('school')}
                    schoolBranches={schoolBranches}
                    graduatedFromSchools={graduatedFromSchools}
                    schoolSystem={schoolSystem}
                    schoolSystemSector={schoolSystemSector}
                    schoolFinalGpa={schoolFinalGpa}
                    schoolSystemOptions={schoolSystemOptions}
                    onGraduatedChange={value => update({
                      person: {
                        ...data.person,
                        school_graduated: value,
                        school_system: schoolSystem,
                        school_system_sector: schoolSystemSector,
                        school_final_gpa: value ? schoolFinalGpa : '',
                      },
                      schools: normalizeSchoolRows(schools, { graduatedFromSchools: value }),
                    })}
                    onSchoolSystemChange={value => update({
                      person: {
                        ...data.person,
                        school_system: normalizeSchoolSystemValue(value),
                        school_system_sector: normalizeSchoolSystemValue(value) === DEFAULT_SCHOOL_SYSTEM ? schoolSystemSector : '',
                      },
                    })}
                    onSchoolSystemSectorChange={value => updateField('school_system_sector', normalizeLooseInput(value))}
                    onSchoolFinalGpaChange={value => updateField('school_final_gpa', normalizeFinalGpaValue(value))}
                  />
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title"><GraduationCap size={15} /> التعليم العالي</span></div>
              <div className="card-body">
                {isViewMode ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {higherEducationViewRows.length ? higherEducationViewRows.map((row, index) => {
                      const meta = [
                        formatHigherEducationPeriod(row) ? `الفترة: ${formatHigherEducationPeriod(row)}` : '',
                        (row?.state === 'current' || row?.state === 'graduated') && row?.final_gpa ? `المعدل التراكمي: ${formatUniversityGpaDisplay(row.final_gpa)}` : '',
                      ].filter(Boolean)
                      const stateBadge = higherEducationStateLabel(row?.state)
                      const uniLogoUrl = resolveSchoolLogoUrl(schoolLogoEntries, 'university', row?.university_college, '')
                      return (
                        <ViewRecordCard key={`edu-${index}`} title={row?.university_college || 'الجامعة / الكلية'} badge={stateBadge || row?.degree || ''} logoUrl={uniLogoUrl} logoAlt={row?.university_college || 'الجامعة / الكلية'}>
                          {meta.length ? <ViewChipList values={meta} /> : null}
                          <div className="profile-two-column-layout">
                            <ViewField label="التخصّص" value={row?.major} />
                            <ViewField label="الدرجة العلميّة" value={row?.degree} />
                          </div>
                        </ViewRecordCard>
                      )
                    }) : <ViewEmptyState text="لا توجد بيانات تعليم عالٍ" />}
                  </div>
                ) : (
                  <HigherEducationRowsEditor
                    rows={higher_education}
                    onChange={rows => updateSub('higher_education', rows)}
                    universityOptions={opts('university')}
                    majorOptions={opts('major')}
                    degreeOptions={opts('degree')}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Work ── */}
      {activeTab === 'work' && (
        <div className="profile-tab-panel">
          <div className="card">
            <div className="card-header"><span className="card-title"><Briefcase size={15} /> التوظيف</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {jobViewRows.length ? jobViewRows.map((row, index) => {
                    const company = normalizeLooseInput(row?.company)
                    const title = normalizeLooseInput(row?.job_title) || company || 'الوظيفة'
                    const stateBadge = jobStateLabel(row?.state)
                    const period = formatJobPeriod(row)
                    const meta = [
                      period && !(stateBadge === 'حاليًّا' && period === 'حاليًّا') ? `الفترة: ${period}` : '',
                    ].filter(Boolean)
                    return (
                      <ViewRecordCard key={`job-${index}`} title={title} badge={stateBadge}>
                        {meta.length ? <ViewChipList values={meta} /> : null}
                        <ViewField label="الشركة / المؤسسة" value={company} />
                      </ViewRecordCard>
                    )
                  }) : <ViewEmptyState text="لا توجد بيانات عمل" />}
                </div>
              ) : (
                <JobRowsEditor
                  rows={jobs}
                  onChange={rows => updateSub('jobs', rows)}
                  jobTitleOptions={opts('job_title')}
                  companyOptions={opts('company')}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Health ── */}
      {activeTab === 'health' && (
        <div className="profile-tab-panel">
          <div className="card">
            <div className="card-header"><span className="card-title"><Shield size={15} /> الحالات الصحية والحساسيات والعمليات الجراجية</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {healthConditionRows.length ? healthConditionRows.map((row, index) => (
                    <ViewRecordCard
                      key={`health-${index}`}
                      title={row?.details || '—'}
                      badge={personHealthConditionTypeLabel(row?.type)}
                    />
                  )) : <ViewEmptyState text="لا توجد معلومات صحية محفوظة" />}
                </div>
              ) : (
                <SubTable
                  rows={healthConditionRows}
                  setRows={rows => updateSub('person_health_conditions', normalizePersonHealthConditionRows(rows))}
                  columns={[
                    { key: 'type', label: 'النوع', selectOptions: PERSON_HEALTH_TYPE_OPTIONS },
                    { key: 'details', label: 'التفاصيل' },
                  ]}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Special notes ── */}
      {activeTab === 'notes' && (
        <div className="profile-tab-panel">
          <div className="card">
            <div className="card-header"><span className="card-title"><Pencil size={15} /> الملاحظات الخاصة</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {specialNoteRows.length ? specialNoteRows.map((row, index) => (
                    <ViewRecordCard
                      key={`special-note-${index}`}
                      title={row?.note_title || 'ملاحظة خاصة'}
                    >
                      {row?.note ? (
                        <div style={{ display: 'grid', gap: 4, padding: '10px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', background: 'white' }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--gray-400)' }}>الملاحظة</div>
                          <div style={{ color: 'var(--navy)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{row.note}</div>
                        </div>
                      ) : null}
                    </ViewRecordCard>
                  )) : <ViewEmptyState text="لا توجد ملاحظات خاصة محفوظة" />}
                </div>
              ) : (
                <SpecialNotesEditor rows={specialNoteRows} onChange={rows => updateSub('person_special_notes', rows)} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Hobbies ── */}
      {activeTab === 'hobbies' && (
        <div className="profile-tab-panel">
          <div className="card">
            <div className="card-header"><span className="card-title"><Heart size={15} /> الهوايات والمهارات</span></div>
            <div className="card-body">
              {isViewMode ? (
                <ViewChipList values={hobbies_skills.map((row) => row?.hobby_skill).filter(Boolean)} emptyText="لا توجد هوايات أو مهارات محفوظة" />
              ) : (
                <TagField items={hobbies_skills} valueKey="hobby_skill" placeholder="أضف هواية أو مهارة…"
                  options={opts('hobby_skill')}
                  onAdd={v => updateSub('hobbies_skills', [...hobbies_skills, { hobby_skill: v }])}
                  onRemove={i => updateSub('hobbies_skills', hobbies_skills.filter((_, idx) => idx !== i))} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Org tab ── */}
      {activeTab === 'org' && !isUnregistered && (
        <div className="profile-tab-panel">
          <OrgTab personId={personId} orgContext={orgContext} onViewProfile={onViewProfile} relevantGroupIds={relevantGroupIds} />
        </div>
      )}
      {activeTab === 'org' && isUnregistered && (
        <div className="profile-tab-panel">
          <OrgTabUnregistered unregisteredId={personId} orgContext={orgContext} onViewProfile={onViewProfile} relevantGroupIds={relevantGroupIds} />
        </div>
      )}
      {activeTab === 'gsorg' && !isUnregistered && (
        <div className="profile-tab-panel">
          <GSTab personId={personId} onViewProfile={onViewProfile} />
        </div>
      )}
      {activeTab === 'gsorg' && isUnregistered && (
        <div className="profile-tab-panel">
          <GSTabUnregistered unregisteredId={personId} onViewProfile={onViewProfile} />
        </div>
      )}
    </div>
  )
}
