import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  ArrowRight, Pencil, Trash2, Plus, Check, Camera, UserX,
  GraduationCap, Briefcase, Heart, Users, Shield,
  Phone, PhoneCall, Globe, School, GitBranch, Archive, ArchiveRestore, MapPin, Mail,
  Facebook, Instagram, Linkedin, ExternalLink
} from 'lucide-react'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { api } from '../api.js'
import { buildGoogleMapsOpenUrl, parseGoogleMapsUrl, sanitizeStoredCoordinate } from '../location.js'

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
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
  return (
    <select
      className="combo-trigger"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      dir={dir}
      style={{ cursor: 'pointer', direction: dir, textAlign }}
    >
      <option value="">{placeholder}</option>
      {safeOptions.map(o => (
        <option key={o.value || o} value={o.value || o}>{o.label || o.value || o}</option>
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
      school: normalizeLooseInput(row?.school),
      section: normalizeLooseInput(row?.section),
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
      const state = normalizeHigherEducationStateValue(row?.state, { isCurrent: rawCurrent })
      const isCurrent = state === 'switched'
        ? false
        : state === 'current'
          ? true
          : rawCurrent

      return {
        university_college: normalizeLooseInput(row?.university_college),
        major: normalizeLooseInput(row?.major),
        degree: normalizeLooseInput(row?.degree),
        start_date: startDate,
        end_date: isCurrent ? '' : sanitizeDateInput(row?.end_date),
        is_current: isCurrent,
        state,
      }
    })
    .filter((row) => (dropEmpty ? (row.university_college || row.major || row.degree || row.start_date || row.end_date || row.state) : true))

  return dropEmpty
    ? normalized.map((row) => ({
        ...row,
        university_college: row.university_college || null,
        major: row.major || null,
        degree: row.degree || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        state: row.state || null,
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
      const state = normalizeJobStateValue(row?.state, { isCurrent: rawCurrent })
      const isCurrent = state === 'current'

      return {
        job_id: normalizeLooseInput(row?.job_id) || createLocalId('job'),
        job_title: normalizeLooseInput(row?.job_title),
        company: normalizeLooseInput(row?.company),
        start_date: startDate,
        end_date: isCurrent ? '' : sanitizeDateInput(row?.end_date),
        is_current: isCurrent,
        state,
      }
    })
    .filter((row) => (dropEmpty ? (row.job_title || row.company || row.start_date || row.end_date || row.state) : true))

  return dropEmpty
    ? normalized.map((row) => ({
        ...row,
        job_title: row.job_title || null,
        company: row.company || null,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        state: row.state || null,
      }))
    : normalized
}

function jobRowLabel(row, index = null) {
  const jobTitle = normalizeLooseInput(row?.job_title)
  const company = normalizeLooseInput(row?.company)
  if (jobTitle && company) return `${jobTitle} - ${company}`
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
  return text
}

function emailTypeLabel(value) {
  const normalized = normalizeEmailType(value)
  if (normalized === 'personal') return 'شخصي'
  if (normalized === 'work') return 'عمل'
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

function normalizeSocialUrl(value) {
  return normalizeLooseInput(value)
}

function buildSocialProfileUrl(value) {
  const text = normalizeSocialUrl(value)
  if (!text) return ''
  return /^https?:\/\//i.test(text) ? text : `https://${text}`
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
    const winner = primaryIndex >= 0 ? primaryIndex : 0
    entries.forEach((entry, entryIndex) => {
      nextRows[entry.index] = {
        ...entry.row,
        is_primary: entryIndex === winner,
      }
    })
  })

  return nextRows
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
      const type = normalizeEmailType(row?.type)
      const linkedJobIds = type === 'work'
        ? parseLinkedJobIds(row?.linked_job_ids).filter((jobId) => !validJobIdSet || validJobIdSet.has(jobId))
        : []

      return {
        email: normalizeLooseInput(row?.email),
        type,
        is_primary: type === 'personal' ? toBoolDefaultFalse(row?.is_primary) : false,
        linked_job_ids: linkedJobIds,
      }
    })
    .filter((row) => (dropEmpty ? row.email : true))

  let primaryAssigned = false
  return normalized.map((row) => {
    if (row.type !== 'personal') return { ...row, is_primary: false }
    if (!row.is_primary) return row
    if (primaryAssigned) return { ...row, is_primary: false }
    primaryAssigned = true
    return row
  })
}

function serializeEmailRows(rows, { validJobIds = null } = {}) {
  return normalizeEmailRows(rows, { dropEmpty: true, validJobIds }).map((row) => ({
    ...row,
    linked_job_ids: row.type === 'work' && row.linked_job_ids.length ? JSON.stringify(row.linked_job_ids) : null,
  }))
}

const DEFAULT_ADDRESS_ROW = { country: 'الأردن', governorate: '', city: '', address: '', location_url: '', lat: null, lng: null, is_primary: true }
const DEFAULT_MOBILE_NUMBER_ROW = { mobile_number: '', type: 'personal', phone_calls_flag: true, whatsapp_flag: true, linked_job_ids: [] }
const DEFAULT_EMAIL_ROW = { email: '', type: 'personal', is_primary: false, linked_job_ids: [] }
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

function normalizeSchoolSystemValue(value) {
  const text = normalizeLooseInput(value)
  if (text === 'وطني') return DEFAULT_SCHOOL_SYSTEM
  return text
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

function preserveLooseInput(value) {
  return String(value ?? '')
}

function normalizeLooseInput(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
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

function sanitizeNationalityIdentifierValue(field, value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (field === 'passport_number') return text.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return text.replace(/\D/g, '')
}

function normalizeNationalityRows(rows, { dropEmpty = false } = {}) {
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
      iso_alpha2: normalizeIsoAlpha2(row?.iso_alpha2),
      national_id: isJordanianNationality(nationality)
        ? sanitizeNationalityIdentifierValue('national_id', row?.national_id)
        : '',
      passport_number: isChildrenOfJordanianMothersNationality(nationality)
        ? ''
        : sanitizeNationalityIdentifierValue('passport_number', row?.passport_number),
      jordanian_mothers_children_serial: isChildrenOfJordanianMothersNationality(nationality)
        ? sanitizeNationalityIdentifierValue('jordanian_mothers_children_serial', row?.jordanian_mothers_children_serial)
        : '',
    })
  }

  return dropEmpty ? normalized.filter((row) => row.nationality) : normalized
}

function serializeNationalityRows(rows, { dropEmpty = false } = {}) {
  return normalizeNationalityRows(rows, { dropEmpty }).map((row) => ({
    nationality: row.nationality,
    national_id: row.national_id,
    passport_number: row.passport_number,
    jordanian_mothers_children_serial: row.jordanian_mothers_children_serial,
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

function nationalityIdentifierFields(row) {
  const fields = []

  if (isJordanianNationality(row?.nationality)) {
    fields.unshift({ key: 'national_id', label: 'الرقم الوطني', hint: 'أرقام فقط', dir: 'ltr', inputMode: 'numeric' })
  }

  if (isChildrenOfJordanianMothersNationality(row?.nationality)) {
    fields.unshift({
      key: 'jordanian_mothers_children_serial',
      label: 'الرقم المتسلسل لهويّة أبناء الأردنيّات',
      hint: 'أرقام فقط',
      dir: 'ltr',
      inputMode: 'numeric',
    })
    return fields
  }

  fields.unshift({ key: 'passport_number', label: 'رقم جواز السفر', hint: 'أحرف وأرقام فقط', dir: 'ltr', inputMode: 'text' })

  return fields
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
    const relation = text.slice('family:'.length).trim()
    return relation ? `family:${relation}` : 'family'
  }
  const known = PHONE_NUMBER_TYPE_OPTIONS.find(option => option.value.toLowerCase() === text.toLowerCase())
  return known ? known.value : text
}

function parseMobileNumberTypeMeta(value) {
  const normalized = normalizeMobileNumberType(value)
  if (normalized.startsWith('family:')) {
    return {
      normalized,
      selectorValue: 'family',
      baseType: 'family',
      familyRelation: normalized.slice('family:'.length).trim(),
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

function buildFamilyMobileNumberType(relation) {
  const normalizedRelation = String(relation ?? '').replace(/\s+/g, ' ').trim()
  return normalizedRelation ? `family:${normalizedRelation}` : 'family'
}

function phoneNumberTypeLabel(value) {
  const { normalized, baseType, familyRelation } = parseMobileNumberTypeMeta(value)
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

function buildWhatsAppWebChatUrl(value) {
  const phone = normalizeWhatsAppPhone(value)
  if (!phone) return ''
  return `https://web.whatsapp.com/send?phone=${phone}`
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
    const type = normalizeMobileNumberType(row?.type)
    const linkedJobIds = type === 'work'
      ? parseLinkedJobIds(row?.linked_job_ids).filter((jobId) => !validJobIdSet || validJobIdSet.has(jobId))
      : []

    return {
      mobile_number: normalizeMobileNumberValue(row?.mobile_number),
      type,
      phone_calls_flag: toBoolDefaultTrue(row?.phone_calls_flag),
      whatsapp_flag: toBoolDefaultTrue(row?.whatsapp_flag),
      linked_job_ids: linkedJobIds,
    }
  })

  return dropEmpty
    ? normalized.filter((row) => row.mobile_number)
    : normalized
}

function serializeMobileNumberRows(rows, { validJobIds = null } = {}) {
  return normalizeMobileNumberRows(rows, { dropEmpty: true, validJobIds }).map((row) => ({
    ...row,
    linked_job_ids: row.type === 'work' && row.linked_job_ids.length ? JSON.stringify(row.linked_job_ids) : null,
  }))
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

function NationalityRowsEditor({ rows, onChange, options = [], placeholder = 'أضف جنسية…' }) {
  const normalizedRows = normalizeNationalityRows(rows)
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
    onChange(normalizeNationalityRows(nextRows))
  }

  const updateRow = (index, key, value) => {
    updateRows(normalizedRows.map((row, rowIndex) => (
      rowIndex === index
        ? { ...row, [key]: sanitizeNationalityIdentifierValue(key, value) }
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
      { nationality, iso_alpha2: '', national_id: '', passport_number: '', jordanian_mothers_children_serial: '' },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => (
        <div key={`nationality-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{renderNationalityLabel(row)}</div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeRow(index)}>
              حذف
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            {nationalityIdentifierFields(row).map((field) => (
              <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>{field.label}</span>
                <input
                  className="combo-input"
                  value={row[field.key] || ''}
                  dir={field.dir}
                  inputMode={field.inputMode}
                  style={{ direction: field.dir, textAlign: field.dir === 'ltr' ? 'left' : 'right' }}
                  placeholder={field.hint}
                  onChange={(event) => updateRow(index, field.key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      {!custom ? (
        <div ref={ref} style={{ position: 'relative' }}>
          <button type="button" className="combo-trigger" onClick={() => { setOpen((current) => !current); setQuery(''); setMessage('') }}>
            <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {placeholder}
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
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus
            className="combo-input"
            style={{ flex: 1 }}
            placeholder="اكتب الجنسية…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addNationality(draft)
              if (event.key === 'Escape') { setCustom(false); setDraft(''); setMessage('') }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNationality(draft)}>إضافة</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCustom(false); setDraft(''); setMessage('') }}>✕</button>
        </div>
      )}

      {conflictHint && <div style={{ fontSize: '0.78rem', color: '#92400e' }}>{conflictHint}</div>}
      {message && <div style={{ fontSize: '0.78rem', color: 'var(--red)' }}>{message}</div>}
    </div>
  )
}

function PhoneNumbersEditor({ rows, onChange, jobRows = [] }) {
  const jobOptions = extractJobOptions(jobRows)
  const validJobIds = jobOptions.map((option) => option.value)
  const normalizedRows = normalizeMobileNumberRows(rows, { validJobIds })
  const typeOptions = Array.from(new Map(
    [...PHONE_NUMBER_TYPE_OPTIONS, ...normalizedRows
      .map((row) => parseMobileNumberTypeMeta(row.type))
      .filter((meta) => meta.normalized && meta.baseType !== 'family')
      .map((meta) => ({ value: meta.selectorValue, label: PHONE_NUMBER_TYPE_OPTIONS.find((option) => option.value === meta.selectorValue)?.label || meta.selectorValue }))]
      .map((option) => [option.value, option])
  ).values())
  const familyRelationOptions = Array.from(new Map(
    [...PHONE_NUMBER_FAMILY_RELATION_OPTIONS,
      ...normalizedRows
        .map((row) => parseMobileNumberTypeMeta(row.type).familyRelation)
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
        const currentFamilyRelation = parseMobileNumberTypeMeta(row.type).familyRelation
        nextRow.type = selectedType === 'family'
          ? buildFamilyMobileNumberType(currentFamilyRelation)
          : selectedType
        if (parseMobileNumberTypeMeta(nextRow.type).baseType !== 'work') nextRow.linked_job_ids = []
      }
      if (key === 'family_relation') {
        nextRow.type = buildFamilyMobileNumberType(value)
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

  const addRow = () => commit([...normalizedRows, { ...DEFAULT_MOBILE_NUMBER_ROW }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const typeMeta = parseMobileNumberTypeMeta(row.type)
        const linkedIds = parseLinkedJobIds(row.linked_job_ids)
        return (
          <div key={`phone-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div dir="ltr" style={{ fontWeight: 700, color: 'var(--navy)', direction: 'ltr', unicodeBidi: 'plaintext' }}>{row.mobile_number || '—'}</div>
                <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{phoneNumberTypeLabel(row.type)}</span>
              </div>
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

  const commit = (nextRows) => onChange(normalizeEmailRows(nextRows, { validJobIds }))
  const updateRow = (index, key, value) => {
    commit(normalizedRows.map((row, rowIndex) => {
      if (rowIndex !== index) return row

      const nextRow = { ...row, [key]: value }
      if (key === 'type') {
        nextRow.type = normalizeEmailType(value)
        if (nextRow.type !== 'personal') nextRow.is_primary = false
        if (nextRow.type !== 'work') nextRow.linked_job_ids = []
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
  const addRow = () => commit([...normalizedRows, { ...DEFAULT_EMAIL_ROW, is_primary: !normalizedRows.some((row) => row.type === 'personal' && row.is_primary) }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => {
        const linkedIds = parseLinkedJobIds(row.linked_job_ids)
        return (
          <div key={`email-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.email || '—'}</div>
                <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                  {emailTypeLabel(row.type)}{row.type === 'personal' && row.is_primary ? ' • الرئيسي' : ''}
                </span>
              </div>
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

                {row.type === 'personal' ? (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الإعدادات</span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(row.is_primary)}
                        onChange={(event) => updateRow(index, 'is_primary', event.target.checked)}
                      />
                      البريد الشخصي الرئيسي
                    </label>
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
  const addRow = () => commit([...normalizedRows, { ...DEFAULT_SOCIAL_MEDIA_ROW }])
  const removeRow = (index) => commit(normalizedRows.filter((_, rowIndex) => rowIndex !== index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {normalizedRows.map((row, index) => (
        <div key={`social-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--navy)' }}>
                {socialPlatformIcon(row.platform, 16)}
                <span>{socialPlatformLabel(row.platform)}</span>
              </div>
              <span dir="ltr" style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600, direction: 'ltr', unicodeBidi: 'plaintext' }}>{row.url || '—'}</span>
            </div>
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

              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>الإعدادات</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.88rem' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.is_primary)}
                    onChange={(event) => updateRow(index, 'is_primary', event.target.checked)}
                  />
                  الملف الرئيسي لهذه المنصة
                </label>
              </label>
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
      ))}
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

function SchoolRowsEditor({ rows, onChange, schoolOptions = [], schoolBranches = {}, graduatedFromSchools = false, onGraduatedChange, schoolSystem = '', schoolSystemOptions = [], onSchoolSystemChange }) {
  const normalizedRows = normalizeSchoolRows(rows, { graduatedFromSchools })
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

  const commit = (nextRows) => onChange(normalizeSchoolRows(nextRows, { graduatedFromSchools }))

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
    commit([...normalizedRows, { school, section: '', start_date: '', end_date: '', is_current: true, grades_attended: [] }])
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
              onChange={(value) => onSchoolSystemChange && onSchoolSystemChange(normalizeSchoolSystemValue(value))}
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
      {normalizedRows.map((row, index) => {
        const configuredSections = schoolBranchesForName(schoolBranches, row.school)
        const sectionOptions = configuredSections.includes(row.section) || !row.section
          ? configuredSections
          : [...configuredSections, row.section]

        return (
          <div key={`school-row-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
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
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.job_title || '—'}</div>
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
        <table className="sub-table">
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
                            ? <SelectDropdown value={row[c.key]} onChange={v => update(i, c.key, v)}
                                options={c.options.map(o => ({ value: o }))} />
                            : <input value={row[c.key] || ''} onChange={e => update(i, c.key, e.target.value)} />}
                  </td>
                ))}
                <td>
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)' }}
                    onClick={() => remove(i)}><Trash2 size={14} /></button>
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
    address: preserveLooseInput(row?.address),
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
    location_url: String(row.location_url || '').trim() || null,
    lat: sanitizeStoredCoordinate(row.lat, 'lat'),
    lng: sanitizeStoredCoordinate(row.lng, 'lng'),
  }))
}

function AddressRowsEditor({ rows, onChange, governorateOptions }) {
  const normalizedRows = normalizeAddressEditorRows(rows)
  const [mapDrafts, setMapDrafts] = useState({})
  const [mapEditors, setMapEditors] = useState({})
  const [mapErrors, setMapErrors] = useState({})

  const commit = (nextRows) => onChange(normalizeAddressEditorRows(nextRows))
  const updateRow = (index, key, value) => commit(normalizedRows.map((row, rowIndex) => (
    rowIndex === index ? { ...row, [key]: value } : row
  )))
  const openMapEditor = (index) => {
    setMapEditors(prev => ({ ...prev, [index]: true }))
    setMapErrors(prev => ({ ...prev, [index]: '' }))
  }
  const closeMapEditor = (index) => {
    setMapEditors(prev => ({ ...prev, [index]: false }))
    setMapDrafts(prev => ({ ...prev, [index]: '' }))
    setMapErrors(prev => ({ ...prev, [index]: '' }))
  }
  const applyMapUrl = async (index) => {
    const draft = String(mapDrafts[index] || '').trim()
    if (!draft) {
      setMapErrors(prev => ({ ...prev, [index]: 'ألصق رابط Google Maps أولاً' }))
      return
    }
    const parsed = parseGoogleMapsUrl(draft)
    if (!parsed.isGoogleMapsUrl) {
      setMapErrors(prev => ({ ...prev, [index]: 'الرابط ليس من Google Maps' }))
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
        setMapErrors(prev => ({ ...prev, [index]: 'تعذر استخراج الموقع من هذا الرابط' }))
        return
      }
    }
    if (lat == null || lng == null) {
      setMapErrors(prev => ({ ...prev, [index]: 'تعذر استخراج الموقع من هذا الرابط' }))
      return
    }
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === index
        ? {
            ...row,
            location_url: draft,
            lat,
            lng,
          }
        : row
    )))
    closeMapEditor(index)
  }
  const clearMapLocation = (index) => {
    commit(normalizedRows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, location_url: '', lat: null, lng: null } : row
    )))
    openMapEditor(index)
  }
  const setPrimary = (index) => commit(normalizedRows.map((row, rowIndex) => ({ ...row, is_primary: rowIndex === index })))
  const addRow = () => commit([...normalizedRows, { ...DEFAULT_ADDRESS_ROW, is_primary: false }])
  const removeRow = (index) => {
    const nextRows = normalizedRows.filter((_, rowIndex) => rowIndex !== index)
    commit(nextRows.length ? nextRows : [{ ...DEFAULT_ADDRESS_ROW }])
  }

  return (
    <div className="am-address-stack">
      {normalizedRows.map((row, index) => (
        <div key={index} className="am-address-card">
          <div className="am-address-card-header">
            <div>
              <div className="am-address-card-title">عنوان {index + 1}</div>
              <div className="am-address-card-subtitle">أدخل المحافظة ثم المدينة ثم العنوان التفصيلي، ثم أضف موقع المنزل عند الحاجة</div>
            </div>
            <div className="am-address-card-actions">
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
            </div>
          </div>

          <div className="am-address-grid">
            <div className="am-address-field">
              <div className="am-field-hint am-address-label">البلد</div>
              <input className="form-control" value={normalizeCountryValue(row.country)} onChange={e => updateRow(index, 'country', normalizeCountryValue(e.target.value))} placeholder="الأردن" />
            </div>

            <div className="am-address-field">
              <div className="am-field-hint am-address-label">المحافظة / الولاية</div>
              <ComboDropdown value={row.governorate} onChange={value => updateRow(index, 'governorate', value)} options={governorateOptions} placeholder="—" />
            </div>

            <div className="am-address-field">
              <div className="am-field-hint am-address-label">المدينة</div>
              <input className="form-control" value={row.city || ''} onChange={e => updateRow(index, 'city', e.target.value)} placeholder="مثال: عمّان" />
            </div>

            <div className="am-address-field am-address-field-wide">
              <div className="am-field-hint am-address-label">العنوان التفصيلي</div>
              <input className="form-control" value={row.address || ''} onChange={e => updateRow(index, 'address', e.target.value)} placeholder="مثال: جبل الحسين، قرب الكنيسة اللاتينية، شارع 12" />
            </div>

            <div className="am-address-field am-address-field-wide">
              <div className="am-field-hint am-address-label">موقع المنزل</div>
              {(!buildGoogleMapsOpenUrl(row) || mapEditors[index]) ? (
                <div className="am-address-map-editor">
                  <input
                    className="form-control"
                    value={mapDrafts[index] || ''}
                    onChange={e => {
                      const nextValue = e.target.value
                      setMapDrafts(prev => ({ ...prev, [index]: nextValue }))
                      setMapErrors(prev => ({ ...prev, [index]: '' }))
                    }}
                    placeholder="ألصق رابط Google Maps هنا"
                    dir="ltr"
                  />
                  <div className="am-address-map-editor-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyMapUrl(index)}>حفظ الموقع</button>
                    {buildGoogleMapsOpenUrl(row) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeMapEditor(index)}>إلغاء</button>}
                  </div>
                  {mapErrors[index] && <div className="am-field-error"><AlertCircle size={13} style={{ flexShrink: 0 }} /> {mapErrors[index]}</div>}
                </div>
              ) : (
                <div className="am-address-map-meta">
                  <button type="button" className="am-address-map-icon active" title="فتح موقع المنزل" onClick={() => window.open(buildGoogleMapsOpenUrl(row), '_blank', 'noopener,noreferrer')}>
                    <MapPin size={16} />
                  </button>
                  <button type="button" className="am-address-map-icon" title="تعديل موقع المنزل" onClick={() => clearMapLocation(index)}>
                    <Pencil size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="add-row-btn" onClick={addRow}><Plus size={14} /> إضافة عنوان</button>
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

function ViewEmptyState({ text = 'لا توجد بيانات' }) {
  return <div style={{ color: 'var(--gray-400)', textAlign: 'center', padding: '10px 0' }}>{text}</div>
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
  if (start && end) return `${start} - ${end}`
  if (start && row?.is_current) return `${start} - حاليًّا`
  if (start) return start
  if (end) return end
  if (row?.is_current) return 'حاليًّا'
  return ''
}

function formatSchoolDisplayName(row) {
  const school = String(row?.school || '').trim()
  const section = String(row?.section || '').trim()
  if (school && section) return `${school} - ${section}`
  return school || '—'
}

function ViewRecordCard({ title, badge, children, onOpenMap, actions }) {
  return (
    <div style={{ border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--gray-50)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: children ? 10 : 0, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{title || '—'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {badge ? <span style={{ background: 'white', border: '1px solid var(--gray-200)', color: 'var(--navy)', borderRadius: 999, padding: '4px 10px', fontSize: '0.76rem', fontWeight: 700 }}>{badge}</span> : null}
          {actions || null}
          {onOpenMap ? <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenMap}><MapPin size={14} /> فتح الموقع</button> : null}
        </div>
      </div>
      {children ? <div style={{ display: 'grid', gap: 10 }}>{children}</div> : null}
    </div>
  )
}

// ── Profile avatar ────────────────────────────────────────────────────────────
function ProfileAvatar({ personId, initials, photoUrl, onPhotoChange, toast }) {
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
    } catch { toast('خطأ في رفع الصورة', 'error') }
    setUploading(false); e.target.value = ''
  }
  const hasPhoto = photoUrl && !imgError

  return (
    <>
      <style>{`.profile-avatar-wrap:hover .avatar-cam-overlay{opacity:1!important}`}</style>
      <div className="profile-avatar profile-avatar-wrap"
        style={{ position: 'relative', cursor: 'pointer', overflow: 'hidden', padding: hasPhoto ? 0 : undefined }}
        onClick={() => !uploading && fileRef.current?.click()} title="انقر لتغيير الصورة">
        {hasPhoto
          ? <img src={photoUrl} alt="profile" onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }} />
          : <span>{uploading ? '…' : (initials || '؟')}</span>}
        <div className="avatar-cam-overlay" style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'rgba(0,0,0,0.42)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          opacity: 0, transition: 'opacity 0.18s', fontSize: '0.65rem', color: 'white', gap: 4, pointerEvents: 'none'
        }}><Camera size={22} /><span>تغيير الصورة</span></div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }} onChange={handleFile} />
      </div>
    </>
  )
}


// ── Unregistered profile avatar (uses uid-based photo endpoint) ───────────────
function UnregisteredProfileAvatar({ uid, initials, photoUrl, onPhotoChange, toast }) {
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
    } catch { toast('خطأ في رفع الصورة', 'error') }
    setUploading(false); e.target.value = ''
  }
  const hasPhoto = photoUrl && !imgError

  return (
    <>
      <style>{`.profile-avatar-wrap:hover .avatar-cam-overlay{opacity:1!important}`}</style>
      <div className="profile-avatar profile-avatar-wrap"
        style={{
          position: 'relative', cursor: 'pointer', overflow: 'hidden',
          padding: hasPhoto ? 0 : undefined,
          border: '2px dashed #e8b55a',
          background: hasPhoto ? 'transparent' : '#fffbeb',
        }}
        onClick={() => !uploading && fileRef.current?.click()} title="انقر لتغيير الصورة">
        {hasPhoto
          ? <img src={photoUrl} alt="profile" onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }} />
          : <span style={{ color: '#b45309' }}>{uploading ? '…' : (initials || '؟')}</span>}
        <div className="avatar-cam-overlay" style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'rgba(0,0,0,0.42)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          opacity: 0, transition: 'opacity 0.18s', fontSize: '0.65rem', color: 'white', gap: 4, pointerEvents: 'none'
        }}><Camera size={22} /><span>تغيير الصورة</span></div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: 'none' }} onChange={handleFile} />
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
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [filters, setFilters]     = useState({})
  const [personTitles, setPersonTitles] = useState([])
  const [schoolBranches, setSchoolBranches] = useState({})
  const [confirm, setConfirm]     = useState(null) // { action: 'delete' | 'archive' }
  const saveTimeout = useRef(null)
  const filtersLoaded = useRef(false)
  const editMetaLoaded = useRef(false)

  useEffect(() => {
    if (filtersLoaded.current) return
    let cancelled = false
    api.filters()
      .then((filtersResponse) => {
        if (!cancelled) {
          setFilters(filtersResponse || {})
          filtersLoaded.current = true
        }
      })
      .catch(() => {
        if (!cancelled) setFilters({})
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (readOnly || !isEditing || editMetaLoaded.current) return
    let cancelled = false
    api.getConfig()
      .then((configResponse) => {
        if (!cancelled) {
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
  }, [isEditing, readOnly])

  // Helper: get sorted option list for a filter key (count desc, value only)
  const opts = useCallback((key) =>
    (filters[key] || []).map(f => ({
      value: f.value,
      label: key === 'youth_group' ? api.formatYouthGroupLabel(f.label || f.value) : (f.label || f.value),
    }))
  , [filters])

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
    setLoading(true)
    // Both registered and unregistered return the same shape:
    // { person: { person_id, first_name, ..., title? }, nationality: [...], ... }
    const loader = isUnregistered
      ? api.getUnregisteredPerson(personId)
      : api.getPerson(personId)
    loader.then(d => {
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
      d.nationality = normalizeNationalityRows(d.nationality)
      personData.school_graduated = toBoolDefaultFalse(personData.school_graduated)
      personData.school_system = normalizeSchoolSystemValue(personData.school_system)
      d.schools = normalizeSchoolRows(d.schools, { graduatedFromSchools: personData.school_graduated })
      d.higher_education = normalizeHigherEducationRows(d.higher_education)
      d.addresses = normalizeAddressEditorRows(d.addresses)
      d.person = personData
      setData(d)
      setPhoto(d.photo ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [personId, isUnregistered])

  const scheduleAutoSave = (newData) => {
    clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(async () => {
      setSaving(true)
      try {
        // Build a clean payload: strip person_id from sub-table rows to avoid
        // primary-key conflicts, and only send fields the backend understands.
          const SUB_KEYS = ['nationality', 'mobile_numbers', 'emails', 'social_media', 'schools', 'higher_education',
              'jobs', 'responsibilities', 'person_youth_group', 'hobbies_skills', 'addresses']
        const stripId = (rows) =>
          Array.isArray(rows)
            ? rows.map(row => { const { person_id, ...rest } = row; return rest })
            : []
        const payload = {
          person: {
            ...(newData.person || {}),
            country: normalizeCountryValue(newData.person?.country),
            school_system: storedSchoolSystemValue(newData.person?.school_system),
          },
          ...Object.fromEntries(SUB_KEYS.map(k => [k, stripId(newData[k])])),
        }
        payload.nationality = serializeNationalityRows(payload.nationality, { dropEmpty: true })
        payload.schools = normalizeSchoolRows(payload.schools, { dropEmpty: true, graduatedFromSchools: Boolean(newData.person?.school_graduated) })
        payload.higher_education = normalizeHigherEducationRows(payload.higher_education, { dropEmpty: true })
        payload.jobs = normalizeJobRows(payload.jobs, { dropEmpty: true })
        payload.emails = serializeEmailRows(payload.emails, { validJobIds: payload.jobs.map((row) => row.job_id) })
        payload.social_media = serializeSocialMediaRows(payload.social_media)
        payload.mobile_numbers = serializeMobileNumberRows(payload.mobile_numbers, { validJobIds: payload.jobs.map((row) => row.job_id) })
        payload.addresses = sanitizeAddressRows(payload.addresses)
        if (isUnregistered) {
          await api.updateUnregistered(personId, payload)
        } else {
          await api.updatePerson(personId, payload)
        }
        // Keep autosave quiet while the user is typing; the inline saving indicator is enough.
      } catch { toast('خطأ في الحفظ', 'error') }
      setSaving(false)
    }, 1200)
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
    update({ [key]: newRows })
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
      const res = await api.promoteUnregistered(personId)
      onPromoted && onPromoted(res.person_id)
    } catch { toast('خطأ في التسجيل', 'error') }
    setPromoting(false)
  }

  const handleDeleteConfirm = async () => {
    try {
      if (isUnregistered) {
        await api.deleteUnregistered(personId)
      } else {
        await api.deletePerson(personId)
      }
      toast('تم الحذف النهائي', 'success')
      onBack()
    } catch { toast('خطأ في الحذف', 'error') }
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
      if (isUnregistered) {
        await api.archiveUnregistered(personId, youthGroupId)
      } else {
        await api.archivePerson(personId, youthGroupId)
      }
      toast('تمت الأرشفة بنجاح', 'success')
      onBack()
    } catch { toast('خطأ في الأرشفة', 'error') }
    setConfirm(null)
  }

  const executeConfirm = () => {
    if (confirm?.action === 'delete') return handleDeleteConfirm()
    if (confirm?.action === 'archive') return handleArchiveConfirm()
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!data)   return <div>لم يُعثر على العضو</div>

  const { person, nationality, mobile_numbers, emails, social_media, addresses, schools, higher_education, jobs, hobbies_skills, person_youth_group, responsibilities } = data

  const youthGroupName = (groupId) => {
    const gid = String(groupId || '').trim()
    if (!gid) return '—'
    const found = opts('youth_group').find(o => String(o?.value || '').trim() === gid)
    return found?.label || api.formatYouthGroupLabel(gid) || gid
  }

  const viewerCouncilGroupIds = Object.keys(currentUser?.council_access || {})
  const isViewerLeader = (currentUser?.role === 'member') && viewerCouncilGroupIds.length > 0
  const isViewingOwnProfile =
    currentUser
    && String(currentUser.person_id) === String(personId)
    && ((currentUser.person_type === 'unregistered') === !!isUnregistered)

  // Leaders can inspect member profiles, but only in their own youth groups.
  const shouldScopeToViewerGroups = isViewerLeader && !isViewingOwnProfile
  const visiblePersonYouthGroup = shouldScopeToViewerGroups
    ? (person_youth_group || []).filter(row => viewerCouncilGroupIds.includes(String(row?.youth_group_id || '').trim()))
    : (person_youth_group || [])
  const visibleResponsibilities = shouldScopeToViewerGroups
    ? (responsibilities || []).filter(row => viewerCouncilGroupIds.includes(String(row?.youth_group_id || '').trim()))
    : (responsibilities || [])

  const relevantGroupIds = [...new Set([
    ...visiblePersonYouthGroup.map(r => r?.youth_group_id),
    ...visibleResponsibilities.map(r => r?.youth_group_id),
  ].map(v => String(v || '').trim()).filter(Boolean))]

  const arabicProfileTitle = String(person?.title || '').replace(/\s+/g, ' ').trim()
  const fullName = [person?.first_name, person?.second_name, person?.third_name, person?.last_name]
    .filter(Boolean).join(' ') || 'بلا اسم'
  const englishFullName = [person?.english_first_name, person?.english_second_name, person?.english_third_name, person?.english_last_name]
    .filter(Boolean).join(' ')
  const arabicNameParts = [
    { key: 'title', label: 'اللقب', value: arabicProfileTitle },
    { key: 'first_name', label: 'الاسم الأول', value: person?.first_name },
    { key: 'second_name', label: 'الاسم الثاني', value: person?.second_name },
    { key: 'third_name', label: 'الاسم الثالث', value: person?.third_name },
    { key: 'last_name', label: 'اسم العائلة', value: person?.last_name },
  ]
  const motherArabicNameParts = [
    { key: 'mother_first_name', label: 'الاسم الأول', value: person?.mother_first_name },
    { key: 'mother_second_name', label: 'الاسم الثاني', value: person?.mother_second_name },
    { key: 'mother_third_name', label: 'الاسم الثالث', value: person?.mother_third_name },
  ]
  const englishNameParts = [
    { key: 'title', label: 'Title', value: englishTitleForPerson, dir: 'ltr' },
    { key: 'english_first_name', label: 'First Name', value: person?.english_first_name, dir: 'ltr' },
    { key: 'english_second_name', label: 'Second Name', value: person?.english_second_name, dir: 'ltr' },
    { key: 'english_third_name', label: 'Third Name', value: person?.english_third_name, dir: 'ltr' },
    { key: 'english_last_name', label: 'Last Name', value: person?.english_last_name, dir: 'ltr' },
  ]
  const motherEnglishNameParts = [
    { key: 'mother_english_first_name', label: 'First Name', value: person?.mother_english_first_name, dir: 'ltr' },
    { key: 'mother_english_second_name', label: 'Second Name', value: person?.mother_english_second_name, dir: 'ltr' },
    { key: 'mother_english_third_name', label: 'Third Name', value: person?.mother_english_third_name, dir: 'ltr' },
  ]
  const birthDateParts = [
    { key: 'birth_year', label: 'السنة', value: String(person?.birth_year || '').trim(), dir: 'ltr' },
    { key: 'birth_month', label: 'الشهر', value: formatDateSegment(person?.birth_month), dir: 'ltr' },
    { key: 'birth_day', label: 'اليوم', value: formatDateSegment(person?.birth_day), dir: 'ltr' },
  ]
  const initials = firstNameInitial(person?.first_name)
  const editableYouthRows = (person_youth_group || []).map(row => ({
    ...row,
    status_label: row?.archived ? 'عضو قديم' : 'عضو حالي',
  }))
  const primaryAddress = (addresses || []).find(row => row?.is_primary) || addresses?.[0] || null
  const heroLocation = [primaryAddress?.city, primaryAddress?.governorate, primaryAddress?.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join('، ')
  const primaryNationality = nationality?.[0] || null
  const arabicDisplayName = [arabicProfileTitle, fullName].filter(Boolean).join(' ')
  const englishDisplayName = [englishTitleForPerson, englishFullName].filter(Boolean).join(' ')
  const graduatedFromSchools = toBoolDefaultFalse(person?.school_graduated)
  const schoolSystem = normalizeSchoolSystemValue(person?.school_system)
  const schoolSystemOptions = buildSchoolSystemOptions((filters.school_system || []).map(item => item?.value), schoolSystem)
  const schoolViewRows = normalizeSchoolRows(schools, { graduatedFromSchools })
  const currentSchoolGrade = graduatedFromSchools ? '' : findHighestSchoolGrade(schoolViewRows)
  const higherEducationViewRows = normalizeHigherEducationRows(higher_education)
  const jobViewRows = normalizeJobRows(jobs)
  const emailViewRows = normalizeEmailRows(emails, { validJobIds: jobViewRows.map((row) => row.job_id) })
  const socialMediaViewRows = normalizeSocialMediaRows(social_media)
  const jobOptions = extractJobOptions(jobViewRows)
  const schoolHeaderStatus = graduatedFromSchools ? 'متخرّج من المدارس' : 'على مقاعد الدراسة'
  const schoolHeaderSystem = schoolSystem || DEFAULT_SCHOOL_SYSTEM

  const TABS = [
    { id: 'info',    label: 'المعلومات الأساسية', icon: Shield },
    { id: 'address', label: 'العناوين',            icon: MapPin },
    { id: 'youth',   label: 'الشبيبة',            icon: Users },
    { id: 'edu',     label: 'التعليم',             icon: GraduationCap },
    { id: 'work',    label: 'العمل',               icon: Briefcase },
    { id: 'hobbies', label: 'الهوايات',            icon: Heart },
    { id: 'org', label: 'هيكل الشبيبة', icon: GitBranch },
    { id: 'gsorg', label: 'الأمانة العامة', icon: GitBranch },
  ]

  const TAB_INTROS = {
    info: {
      tone: 'info',
      title: 'بطاقة التعريف الأساسية',
      text: 'البيانات الشخصية والجنسية ووسائل التواصل الأساسية في مكان واحد لقراءة أسرع وتحرير أوضح.',
    },
    address: {
      tone: 'address',
      title: 'العناوين والموقع',
      text: 'العناوين مفصولة هنا لتسهيل مراجعة السكن والموقع الجغرافي دون مزاحمة البيانات الشخصية.',
    },
    youth: {
      tone: 'youth',
      title: 'الانتساب والمسؤوليات',
      text: 'كل ما يرتبط بانتماء العضو داخل الشبيبة ومسؤولياته الحالية أو السابقة.',
    },
    edu: {
      tone: 'edu',
      title: 'المسار التعليمي',
      text: 'المدارس والتعليم العالي ضمن تبويب واحد حتى يظهر التسلسل الدراسي كاملاً في مكان واحد.',
    },
    work: {
      tone: 'work',
      title: 'الحياة المهنية',
      text: 'الوظائف والمؤسسات بشكل مبسط مع إبراز آخر المعلومات المهنية للعضو.',
    },
    hobbies: {
      tone: 'hobbies',
      title: 'الهوايات والمهارات',
      text: 'عرض مختصر وواضح للهوايات والمهارات التي يمكن الاستفادة منها في الخدمة والأنشطة.',
    },
    org: {
      tone: 'org',
      title: 'المسار التنظيمي في الشبيبة',
      text: 'استعراض تاريخ الأدوار والعلاقات التنظيمية داخل فرق الشبيبة عبر الفترات المختلفة.',
    },
    gsorg: {
      tone: 'gsorg',
      title: 'المسار التنظيمي في الأمانة العامة',
      text: 'عرض متسلسل للأدوار والعلاقات المرتبطة بالأمانة العامة عبر السنوات والفترات.',
    },
  }

  // For photo upload in unregistered profile
  const handlePhotoChange = isUnregistered
    ? (newUrl) => setPhoto(newUrl)
    : (newUrl) => setPhoto(newUrl)

  const isViewMode = readOnly || !isEditing

  return (
    <div className="profile-page">
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'delete' ? 'تأكيد الحذف النهائي' : 'تأكيد الأرشفة'}
        message={
          confirm?.action === 'delete'
            ? `هل أنت متأكد من حذف "${data?.person ? [data.person.first_name, data.person.last_name].filter(Boolean).join(' ') : ''}" نهائياً؟ سيتم حذف جميع بياناته بشكل دائم ولا يمكن التراجع عن هذا الإجراء.`
            : `هل تريد أرشفة هذا السجل؟ سينتقل إلى تبويب الأرشيف في قائمة الأعضاء ويمكن استعادته لاحقاً.`
        }
        confirmLabel={confirm?.action === 'delete' ? 'حذف نهائي' : 'أرشفة'}
        confirmClass={confirm?.action === 'delete' ? 'btn-danger' : 'btn-primary'}
        onConfirm={executeConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* Back + saving indicator + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowRight size={15} /> العودة للقائمة
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!readOnly && (
            <button
              className={`btn btn-sm ${isEditing ? 'btn-ghost' : 'btn-primary'}`}
              onClick={() => setIsEditing((current) => !current)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Pencil size={14} /> {isEditing ? 'إنهاء التحرير' : 'تعديل الملف'}
            </button>
          )}
          {isEditing && saving && <span style={{ fontSize: '0.82rem', color: 'var(--gray-400)' }}>جارٍ الحفظ…</span>}
          {isUnregistered && (
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirm({ action: 'archive' })}
            title="أرشفة السجل"
            style={{ color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Archive size={14} /> أرشفة
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirm({ action: 'delete' })}
            title="حذف نهائي"
            style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Trash2 size={14} /> حذف نهائي
          </button>
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
          <span>هذا الشخص لم يُسجَّل بعد كعضو رسمي. يمكن تسجيله كعضو رسمي بالضغط على الزر أعلاه.</span>
        </div>
      )}

      {/* Hero */}
      <div className="profile-hero" style={{ marginBottom: 20 }}>
        {isUnregistered ? (
          <UnregisteredProfileAvatar uid={personId} initials={initials} photoUrl={photo}
            onPhotoChange={setPhoto} toast={toast} />
        ) : (
          <ProfileAvatar personId={personId} initials={initials} photoUrl={photo}
            onPhotoChange={setPhoto} toast={toast} />
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
                <span>{person.gender}</span>
              </div>
            )}
            {person?.birth_year && (
              <div className="profile-sub-item">
                <span className="profile-sub-icon" aria-hidden="true">🗓</span>
                <span>{person.birth_year}</span>
              </div>
            )}
            {primaryNationality && (
              <div className="profile-sub-item">
                {renderNationalityLabel(primaryNationality, { fallbackIcon: '🌍', gap: 6 })}
              </div>
            )}
          </div>
          {orgContext?.nodes && (() => {
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
          <div className={`profile-tab-intro ${TAB_INTROS.info.tone}`}>
            <div className="profile-tab-intro-icon"><Shield size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.info.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.info.text}</div>
            </div>
          </div>
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
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  {nationality.length ? nationality.map((row, index) => {
                    const details = [
                      row?.national_id ? `الرقم الوطني: ${row.national_id}` : '',
                      row?.passport_number ? `جواز السفر: ${row.passport_number}` : '',
                      row?.jordanian_mothers_children_serial ? `الرقم المتسلسل: ${row.jordanian_mothers_children_serial}` : '',
                    ].filter(Boolean)
                    return <ViewRecordCard key={`${row?.nationality || 'nat'}-${index}`} title={renderNationalityLabel(row, { fallbackIcon: '🌍' })}>{details.length ? <ViewChipList values={details} /> : <ViewEmptyState text="لا توجد معرّفات إضافية" />}</ViewRecordCard>
                  }) : <ViewEmptyState text="لا توجد بيانات جنسية" />}
                </div>
              </div>
            </div>

            <div className="profile-stack-column">
              <div className="card">
                <div className="card-header"><span className="card-title"><Phone size={15} /> أرقام الموبايل</span></div>
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  {mobile_numbers.length ? mobile_numbers.map((row, index) => {
                    const country = detectPhoneCountry(row?.mobile_number)
                    const whatsAppUrl = row?.whatsapp_flag ? buildWhatsAppWebChatUrl(row?.mobile_number) : ''
                    const linkedJobLabels = parseLinkedJobIds(row?.linked_job_ids)
                      .map((jobId) => jobOptions.find((option) => option.value === jobId)?.label || '')
                      .filter(Boolean)
                    const actions = (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
                        {row?.phone_calls_flag ? (
                          <span
                            title="اتصالات"
                            aria-label="اتصالات"
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, background: 'white', border: '1px solid var(--gray-200)', color: 'var(--navy)' }}
                          >
                            <PhoneCall size={13} />
                          </span>
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
                            <span dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>{formatDisplayPhoneNumber(row?.mobile_number) || '—'}</span>
                          </span>
                        )}
                        badge={phoneNumberTypeLabel(row?.type)}
                        actions={actions}
                      >
                        {parseMobileNumberTypeMeta(row?.type).baseType === 'work'
                          ? <ViewChipList values={linkedJobLabels} emptyText="غير مرتبط بأي سجل عمل" />
                          : null}
                      </ViewRecordCard>
                    )
                  }) : <ViewEmptyState text="لا توجد أرقام موبايل" />}
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
                      ? (row?.is_primary ? 'شخصي • الرئيسي' : 'شخصي')
                      : 'عمل'

                    return (
                      <ViewRecordCard
                        key={`email-${index}`}
                        title={<span dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>{row?.email || '—'}</span>}
                        badge={badge}
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
                <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                  {socialMediaViewRows.length ? socialMediaViewRows.map((row, index) => {
                    const href = buildSocialProfileUrl(row?.url)
                    const badge = row?.is_primary
                      ? `${socialPlatformLabel(row?.platform)} • الرئيسي`
                      : socialPlatformLabel(row?.platform)

                    return (
                      <ViewRecordCard
                        key={`social-${index}`}
                        title={(
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 999, background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 4px 10px rgba(15,23,42,0.06)', color: 'var(--navy)' }}>
                            {socialPlatformIcon(row?.platform, 18)}
                          </span>
                        )}
                        badge={badge}
                        actions={href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            title="فتح الرابط"
                            aria-label="فتح الرابط"
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
                            <ExternalLink size={16} />
                          </a>
                        ) : null}
                      />
                    )
                  }) : <ViewEmptyState text="لا توجد حسابات تواصل اجتماعي" />}
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
                    <InlineComboField label="الاسم الأول"   value={person?.first_name}  onChange={v => updateField('first_name', v)}  options={opts('first_name')} />
                    <InlineComboField label="الاسم الثاني"  value={person?.second_name} onChange={v => updateField('second_name', v)} options={opts('second_name')} />
                    <InlineComboField label="الاسم الثالث"  value={person?.third_name}  onChange={v => updateField('third_name', v)}  options={opts('third_name')} />
                    <InlineComboField label="اسم العائلة"   value={person?.last_name}   onChange={v => updateField('last_name', v)}   options={opts('last_name')} />
                    <div className="profile-name-section-title" style={{ marginTop: 12 }}>اسم الأم</div>
                    <InlineComboField label="الاسم الأول" value={person?.mother_first_name} onChange={v => updateField('mother_first_name', v)} options={opts('mother_first_name')} />
                    <InlineComboField label="الاسم الثاني" value={person?.mother_second_name} onChange={v => updateField('mother_second_name', v)} options={opts('mother_second_name')} />
                    <InlineComboField label="الاسم الثالث" value={person?.mother_third_name} onChange={v => updateField('mother_third_name', v)} options={opts('mother_third_name')} />
                  </div>
                  <div className="profile-name-section profile-name-section-english">
                    <div className="profile-name-section-title">English Name</div>
                    {isUnregistered && (
                      <InlineSelectField label="Title" value={englishTitleForPerson} onChange={updateEnglishTitle} options={personEnglishTitleOptions(person?.title)} dir="ltr" />
                    )}
                    <InlineComboField label="First Name"  value={person?.english_first_name}  onChange={v => updateField('english_first_name', v)} options={opts('english_first_name')} dir="ltr" />
                    <InlineComboField label="Second Name" value={person?.english_second_name} onChange={v => updateField('english_second_name', v)} options={opts('english_second_name')} dir="ltr" />
                    <InlineComboField label="Third Name"  value={person?.english_third_name}  onChange={v => updateField('english_third_name', v)} options={opts('english_third_name')} dir="ltr" />
                    <InlineComboField label="Last Name"   value={person?.english_last_name}   onChange={v => updateField('english_last_name', v)} options={opts('english_last_name')} dir="ltr" />
                    <div className="profile-name-section-title" style={{ marginTop: 12 }}>Mother's Name</div>
                    <InlineComboField label="First Name" value={person?.mother_english_first_name} onChange={v => updateField('mother_english_first_name', v)} options={opts('mother_english_first_name')} dir="ltr" />
                    <InlineComboField label="Second Name" value={person?.mother_english_second_name} onChange={v => updateField('mother_english_second_name', v)} options={opts('mother_english_second_name')} dir="ltr" />
                    <InlineComboField label="Third Name" value={person?.mother_english_third_name} onChange={v => updateField('mother_english_third_name', v)} options={opts('mother_english_third_name')} dir="ltr" />
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
                    options={opts('nationality')}
                  />
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title"><Phone size={15} /> أرقام الموبايل</span></div>
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
          <div className={`profile-tab-intro ${TAB_INTROS.address.tone}`}>
            <div className="profile-tab-intro-icon"><MapPin size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.address.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.address.text}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title"><MapPin size={15} /> العناوين</span></div>
            <div className="card-body">
              {isViewMode ? (
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
                <AddressRowsEditor rows={addresses} onChange={rows => updateSub('addresses', rows)} governorateOptions={opts('governorate')} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Youth ── */}
      {activeTab === 'youth' && (
        <div className="profile-tab-panel">
          <div className={`profile-tab-intro ${TAB_INTROS.youth.tone}`}>
            <div className="profile-tab-intro-icon"><Users size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.youth.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.youth.text}</div>
            </div>
          </div>
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
                    <ViewRecordCard key={`youth-${i}`} title={youthGroupName(row?.youth_group_id)} badge={row?.archived ? 'عضو قديم' : 'عضو حالي'}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <ViewField label="سنة الانتساب" value={row?.youth_join_year} />
                        <ViewField label="الفئة العمرية" value={row?.age_group} />
                      </div>
                    </ViewRecordCard>
                  )) : <ViewEmptyState text="لا توجد بيانات ضمن مجموعاتك" />}
                </div>
              ) : (
                <SubTable rows={editableYouthRows}
                  setRows={rows => updateSub('person_youth_group', rows.map(({ status_label, ...rest }) => ({
                    ...rest,
                    archived: status_label === 'عضو قديم',
                  })))}
                  columns={[
                    { key: 'youth_group_id',   label: 'اسم الشبيبة',  selectOptions: opts('youth_group') },
                    { key: 'youth_join_year',  label: 'سنة الانتساب', yearFrom: 1964 },
                    { key: 'age_group',        label: 'الفئة العمرية', selectOptions: opts('age_group') },
                    {
                      key: 'status_label',
                      label: 'الحالة',
                      selectOptions: [
                        { value: 'عضو حالي', label: 'عضو حالي' },
                        { value: 'عضو قديم', label: 'عضو قديم' },
                      ],
                    },
                  ]} />
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title"><Shield size={15} /> المسؤوليات</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {visibleResponsibilities.length ? visibleResponsibilities.map((row, i) => (
                    <ViewRecordCard key={`resp-${i}`} title={row?.responsibility || 'المسؤولية'} badge={youthGroupName(row?.youth_group_id)}>
                      <ViewField label="الفترة" value={row?.time} />
                    </ViewRecordCard>
                  )) : <ViewEmptyState text="لا توجد بيانات ضمن مجموعاتك" />}
                </div>
              ) : (
                <SubTable rows={responsibilities}
                  setRows={rows => updateSub('responsibilities', rows)}
                  columns={[
                    { key: 'youth_group_id',   label: 'الشبيبة',    selectOptions: opts('youth_group') },
                    { key: 'time',             label: 'الفترة' },
                    { key: 'responsibility',   label: 'المسؤولية',   comboOptions: opts('responsibility') },
                  ]} />
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ── Education ── */}
      {activeTab === 'edu' && (
        <div className="profile-tab-panel">
          <div className={`profile-tab-intro ${TAB_INTROS.edu.tone}`}>
            <div className="profile-tab-intro-icon"><GraduationCap size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.edu.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.edu.text}</div>
            </div>
          </div>
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
                      return (
                        <ViewRecordCard key={`school-${index}`} title={formatSchoolDisplayName(row)} badge={row?.is_current ? 'حاليًّا' : ''}>
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
                    schoolSystemOptions={schoolSystemOptions}
                    onGraduatedChange={value => update({
                      person: { ...data.person, school_graduated: value, school_system: schoolSystem },
                      schools: normalizeSchoolRows(schools, { graduatedFromSchools: value }),
                    })}
                    onSchoolSystemChange={value => updateField('school_system', normalizeSchoolSystemValue(value))}
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
                      ].filter(Boolean)
                      const stateBadge = higherEducationStateLabel(row?.state)
                      return (
                        <ViewRecordCard key={`edu-${index}`} title={row?.university_college || 'الجامعة / الكلية'} badge={stateBadge || row?.degree || ''}>
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
          <div className={`profile-tab-intro ${TAB_INTROS.work.tone}`}>
            <div className="profile-tab-intro-icon"><Briefcase size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.work.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.work.text}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-title"><Briefcase size={15} /> التوظيف</span></div>
            <div className="card-body">
              {isViewMode ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {jobViewRows.length ? jobViewRows.map((row, index) => {
                    const meta = [
                      formatJobPeriod(row) ? `الفترة: ${formatJobPeriod(row)}` : '',
                    ].filter(Boolean)
                    return (
                      <ViewRecordCard key={`job-${index}`} title={row?.job_title || 'الوظيفة'} badge={jobStateLabel(row?.state)}>
                        {meta.length ? <ViewChipList values={meta} /> : null}
                        <ViewField label="الشركة / المؤسسة" value={row?.company} />
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

      {/* ── Hobbies ── */}
      {activeTab === 'hobbies' && (
        <div className="profile-tab-panel">
          <div className={`profile-tab-intro ${TAB_INTROS.hobbies.tone}`}>
            <div className="profile-tab-intro-icon"><Heart size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.hobbies.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.hobbies.text}</div>
            </div>
          </div>
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
          <div className={`profile-tab-intro ${TAB_INTROS.org.tone}`}>
            <div className="profile-tab-intro-icon"><GitBranch size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.org.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.org.text}</div>
            </div>
          </div>
          <OrgTab personId={personId} orgContext={orgContext} onViewProfile={onViewProfile} relevantGroupIds={relevantGroupIds} />
        </div>
      )}
      {activeTab === 'org' && isUnregistered && (
        <div className="profile-tab-panel">
          <div className={`profile-tab-intro ${TAB_INTROS.org.tone}`}>
            <div className="profile-tab-intro-icon"><GitBranch size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.org.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.org.text}</div>
            </div>
          </div>
          <OrgTabUnregistered unregisteredId={personId} orgContext={orgContext} onViewProfile={onViewProfile} relevantGroupIds={relevantGroupIds} />
        </div>
      )}
      {activeTab === 'gsorg' && !isUnregistered && (
        <div className="profile-tab-panel">
          <div className={`profile-tab-intro ${TAB_INTROS.gsorg.tone}`}>
            <div className="profile-tab-intro-icon"><GitBranch size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.gsorg.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.gsorg.text}</div>
            </div>
          </div>
          <GSTab personId={personId} onViewProfile={onViewProfile} />
        </div>
      )}
      {activeTab === 'gsorg' && isUnregistered && (
        <div className="profile-tab-panel">
          <div className={`profile-tab-intro ${TAB_INTROS.gsorg.tone}`}>
            <div className="profile-tab-intro-icon"><GitBranch size={18} /></div>
            <div>
              <div className="profile-tab-intro-title">{TAB_INTROS.gsorg.title}</div>
              <div className="profile-tab-intro-text">{TAB_INTROS.gsorg.text}</div>
            </div>
          </div>
          <GSTabUnregistered unregisteredId={personId} onViewProfile={onViewProfile} />
        </div>
      )}
    </div>
  )
}
