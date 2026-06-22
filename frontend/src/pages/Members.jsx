import { useEffect, useState, useRef, useMemo, useDeferredValue } from 'react'
import { Search, ChevronRight, ChevronLeft, UserPlus, ArrowUpAZ, ArrowDownAZ, ChevronDown, X, Trash2, Archive, ArchiveRestore, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { api } from '../api.js'
import { ErrorState, LoadingState } from '../pageStates.jsx'
import { formatArabicPersonName, getArabicPersonNameParts } from '../personName.js'

// ── Arabic normalization ──────────────────────────────────────────────────────
function normalizeWord(word) {
  word = String(word)
  word = word.replace(/[\u0617-\u061A\u064B-\u0652]/g, '')
  word = word.replace(/\u0640/g, '')
  word = word.replace(/[إأآا]/g, 'ا')
  word = word.replace(/[يى]/g, 'ي')
  word = word.replace(/ؤ/g, 'و')
  word = word.replace(/ئ/g, 'ي')
  word = word.replace(/ة/g, 'ه')
  word = word.replace(/^ال/, '')
  return word.toLowerCase().trim()
}
function normalizeArabic(text) {
  if (!text) return ''
  return String(text).replace(/\s+/g, ' ').trim().split(' ').map(normalizeWord).join(' ')
}

function normalizeNameVariations(raw) {
  const out = {}
  if (!raw) return out

  const entries = []
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      entries.push([row.name, row.variations])
    }
  } else if (typeof raw === 'object') {
    for (const [base, variations] of Object.entries(raw)) entries.push([base, variations])
  }

  for (const [baseRaw, variationsRaw] of entries) {
    const base = normalizeArabic(baseRaw)
    if (!base) continue
    const source = Array.isArray(variationsRaw) ? variationsRaw : (typeof variationsRaw === 'string' ? [variationsRaw] : [])
    const values = [...new Set(source.map(v => normalizeArabic(v)).filter(v => v && v !== base))]
    out[base] = values
  }

  return out
}

function buildNameAliasLookup(variationMap) {
  const map = new Map()
  const ensure = (word) => {
    if (!map.has(word)) map.set(word, new Set([word]))
    return map.get(word)
  }

  for (const [base, vars] of Object.entries(variationMap || {})) {
    if (!base) continue
    const baseSet = ensure(base)
    for (const v of vars || []) {
      if (!v) continue
      baseSet.add(v)
      const vSet = ensure(v)
      vSet.add(base)
      for (const sibling of vars || []) {
        if (sibling) vSet.add(sibling)
      }
    }
  }

  return map
}

function expandQueryWords(words, aliasLookup) {
  return words.map((w) => {
    const expanded = new Set([w])

    const exact = aliasLookup.get(w)
    if (exact && exact.size) {
      exact.forEach(v => expanded.add(v))
    }

    for (const [key, values] of aliasLookup.entries()) {
      if (!key || !values?.size) continue
      if (key.includes(w) || w.includes(key)) {
        values.forEach(v => expanded.add(v))
      }
    }

    return [...expanded]
  })
}
function getNameParts(p) {
  return [
    ...getArabicPersonNameParts(p),
    p.en_first_name,
    p.en_second_name,
    p.en_third_name,
    p.en_last_name,
  ]
    .filter(Boolean).map(normalizeArabic)
}

function getDisplayName(p) {
  return formatArabicPersonName(p)
}

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
}

function toYouthGroupShortLabel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const withoutPrefix = raw.replace(/^\s*شبيبة\s*/u, '').trim()
  if (!withoutPrefix) return ''

  const shortPart = withoutPrefix.includes('-')
    ? withoutPrefix.split('-').map(part => part.trim()).filter(Boolean).at(-1)
    : withoutPrefix

  return shortPart ? `شبيبة ${shortPart}` : ''
}

function calcAgeFromBirthDate(person) {
  const year = Number(person?.birth_year)
  const month = Number(person?.birth_month)
  const day = Number(person?.birth_day)

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return null

  const birthDate = new Date(year, month - 1, day)
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null
  }

  const today = new Date()
  let age = today.getFullYear() - year
  const hasHadBirthdayThisYear =
    today.getMonth() > (month - 1) ||
    (today.getMonth() === (month - 1) && today.getDate() >= day)

  if (!hasHadBirthdayThisYear) age -= 1
  return age >= 0 ? age : null
}

function buildMemberMeta(person) {
  const archived = Boolean(person?.archived)
  const youthGroupSource = archived ? person?._archived_youth_groups : person?._youth_groups
  const ageGroupSource = archived ? person?._archived_age_groups : person?._age_groups

  const youthGroups = Array.isArray(youthGroupSource)
    ? youthGroupSource.map(value => toYouthGroupShortLabel(value) || String(value ?? '').trim())
    : []

  const ageGroups = Array.isArray(ageGroupSource)
    ? ageGroupSource.map(value => String(value ?? '').trim())
    : []

  const pairsCount = Math.max(youthGroups.length, ageGroups.length)
  const youthWithAge = pairsCount
    ? Array.from({ length: pairsCount }, (_, index) => {
        const youth = youthGroups[index] || '—'
        const ageGroup = ageGroups[index] || '—'
        return `${youth} (${ageGroup})`
      }).join('، ')
    : '—'

  const age = calcAgeFromBirthDate(person)
  const ageLabel = age == null ? '—' : `${age} سنة`

  return [youthWithAge, ageLabel].join(' · ')
}

const EXPORT_EXCLUDED_ROOT_KEYS = new Set([
  'org_tree',
  'orgTree',
  'general_secretariat_tree',
  'generalSecretariatTree',
  'gen_sec_tree',
  'genSecTree',
])

const EXPORT_HIDDEN_PERSON_KEYS = new Set([
  'person_id',
  'title',
  'ar_first_name',
  'ar_second_name',
  'ar_third_name',
  'ar_last_name',
  'en_first_name',
  'en_second_name',
  'en_third_name',
  'en_last_name',
  'mother_ar_first_name',
  'mother_ar_second_name',
  'mother_ar_last_name',
  'mother_en_first_name',
  'mother_en_second_name',
  'mother_en_last_name',
  'gender',
  'birth_year',
  'birth_month',
  'birth_day',
  'registered',
  'archived',
  'address',
  'country',
  'governorate',
  'city',
  'lat',
  'lng',
  'school_graduated',
  'school_system',
  'school_system_sector',
  'school_final_gpa',
  'street_address',
])

const EXPORT_FIELD_LABELS = {
  person_id: 'معرّف الشخص',
  title: 'اللقب',
  gender: 'الجنس',
  church: 'الكنيسة',
  parish: 'الرعية',
  diocese: 'الأبرشية',
  marital_status: 'الحالة الاجتماعية',
  birth_place: 'مكان الولادة',
  country_of_birth: 'بلد الولادة',
  governorate: 'المحافظة',
  city: 'المدينة',
  country: 'البلد',
  school_system: 'النظام الدراسي',
  school_system_sector: 'الحقل / الفرع',
  school_final_gpa: 'معدل المدرسة',
  baptism_name: 'اسم المعمودية',
  confirmation_name: 'اسم التثبيت',
  created_at: 'تاريخ الإنشاء',
  updated_at: 'آخر تحديث',
  notes: 'ملاحظات',
  nationality: 'الجنسية',
  iso_alpha2: 'رمز الدولة',
  national_id: 'الرقم الوطني',
  passport_number: 'رقم جواز السفر',
  jordanian_mothers_children_serial: 'الرقم التسلسلي لأبناء الأردنيات',
  mobile_number: 'رقم الهاتف',
  family_relation: 'صلة القرابة',
  email: 'البريد الإلكتروني',
  platform: 'المنصة',
  url: 'الرابط',
  school: 'المدرسة',
  section: 'القسم',
  grades_attended: 'الصفوف',
  university_college: 'الجامعة / الكلية',
  institution_name: 'الجامعة / الكلية',
  major: 'التخصص',
  degree: 'الدرجة العلمية',
  education_state: 'الحالة',
  final_gpa: 'المعدل',
  job_title: 'المسمّى الوظيفي',
  company: 'الشركة / المؤسسة',
  responsibility: 'المسؤولية',
  jec_year: 'سنة JEC',
  is_current: 'الحالة',
  youth_group_id: 'فرقة الشبيبة',
  age_group: 'الفئة العمرية',
  youth_join_year: 'سنة الانتساب',
  hobby_skill: 'الهواية / المهارة',
  type: 'النوع',
  details: 'التفاصيل',
  note_title: 'عنوان الملاحظة',
  note: 'الملاحظة',
}

function formatExportPrimitive(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  return String(value).replace(/\s+/g, ' ').trim()
}

function joinExportParts(values, separator = '، ') {
  return values.map(formatExportPrimitive).filter(Boolean).join(separator)
}

function joinExportLines(values) {
  return values.map(formatExportPrimitive).filter(Boolean).join('\n')
}

function hasMeaningfulExportValue(value) {
  return formatExportPrimitive(value) !== ''
}

function humanizeExportKey(key) {
  if (!key) return ''
  if (EXPORT_FIELD_LABELS[key]) return EXPORT_FIELD_LABELS[key]
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatBirthDate(person) {
  const year = formatExportPrimitive(person?.birth_year)
  const month = formatExportPrimitive(person?.birth_month)
  const day = formatExportPrimitive(person?.birth_day)
  if (year && month && day) return `${day}/${month}/${year}`
  return joinExportParts([day, month, year], ' / ')
}

function formatRange(start, end, isCurrent, state) {
  const startText = formatExportPrimitive(start)
  const endText = formatExportPrimitive(end)
  const normalizedState = formatExportPrimitive(state).toLowerCase()
  const current = isCurrent || normalizedState === 'current'
  if (startText && endText) return `${startText} → ${endText}`
  if (startText && current) return `${startText} → حتى الآن`
  if (startText) return startText
  if (endText) return endText
  if (current) return 'حتى الآن'
  return ''
}

function normalizeHigherEducationExportState(value, { isCurrent = false } = {}) {
  const text = formatExportPrimitive(value)
  if (!text) return isCurrent ? 'current' : ''
  const lookup = text.toLowerCase()
  if (lookup === 'current' || text === 'حاليًّا' || text === 'حاليا' || text === 'حالي') return 'current'
  if (lookup === 'switched' || lookup === 'switched major|university' || lookup === 'switched major/university' || text === 'حوّل التخصّص أو الجامعة / الكليّة' || text === 'حوّل التخصص أو الجامعة / الكلية') return 'switched'
  if (lookup === 'exited' || text === 'منسحب' || text === 'انسحب') return 'exited'
  if (lookup === 'graduated' || text === 'متخرّج' || text === 'متخرج') return 'graduated'
  return text
}

function higherEducationExportStateLabel(value, { isCurrent = false } = {}) {
  const normalized = normalizeHigherEducationExportState(value, { isCurrent })
  if (normalized === 'current') return 'حاليًّا'
  if (normalized === 'switched') return 'حوّل التخصّص أو الجامعة / الكليّة'
  if (normalized === 'exited') return 'منسحب'
  if (normalized === 'graduated') return 'متخرّج'
  return normalized
}

function normalizeJobExportState(value, { isCurrent = false } = {}) {
  const text = formatExportPrimitive(value)
  if (!text) return isCurrent ? 'current' : 'previous'
  const lookup = text.toLowerCase()
  if (lookup === 'current' || text === 'حاليًّا' || text === 'حاليا' || text === 'حالي') return 'current'
  if (lookup === 'previous' || text === 'سابق') return 'previous'
  return text
}

function jobExportStateLabel(value, { isCurrent = false } = {}) {
  const normalized = normalizeJobExportState(value, { isCurrent })
  if (normalized === 'current') return 'حاليًّا'
  if (normalized === 'previous') return 'سابق'
  return normalized
}

function summarizeExtraFields(row, excludeKeys = []) {
  const exclude = new Set(excludeKeys)
  return Object.entries(row || {})
    .filter(([key, value]) => !exclude.has(key) && value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
    .map(([key, value]) => {
      const rendered = Array.isArray(value)
        ? joinExportParts(value)
        : formatExportPrimitive(value)
      return rendered ? `${humanizeExportKey(key)}: ${rendered}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function buildYouthGroupNameLookup(groups) {
  const lookup = new Map()
  ;(Array.isArray(groups) ? groups : []).forEach((entry) => {
    const id = formatExportPrimitive(entry?.group_id ?? entry?.value ?? entry?.id ?? entry?.youth_group_id)
    const label = formatExportPrimitive(entry?.group_name ?? entry?.label ?? entry?.name ?? entry?.youth_group_name ?? entry?.title)
    if (!id || !label) return
    lookup.set(id, label)
  })
  return lookup
}

function extendYouthGroupLookupFromMembers(lookup, rows) {
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const memberIds = Array.isArray(row?._youth_group_ids) ? row._youth_group_ids : []
    const memberNames = Array.isArray(row?._youth_groups) ? row._youth_groups : []
    memberIds.forEach((id, index) => {
      const key = formatExportPrimitive(id)
      const label = formatExportPrimitive(memberNames[index])
      if (key && label && !lookup.has(key)) lookup.set(key, label)
    })

    const archivedIds = Array.isArray(row?._archived_youth_group_ids) ? row._archived_youth_group_ids : []
    archivedIds.forEach((id) => {
      const key = formatExportPrimitive(id)
      if (key && !lookup.has(key)) lookup.set(key, getYouthGroupDisplayName(key, lookup))
    })

    const responsibilityIds = Array.isArray(row?._responsibility_youth_group_ids) ? row._responsibility_youth_group_ids : []
    const responsibilityNames = Array.isArray(row?._responsibility_youth_groups) ? row._responsibility_youth_groups : []
    responsibilityIds.forEach((id, index) => {
      const key = formatExportPrimitive(id)
      const label = formatExportPrimitive(responsibilityNames[index])
      if (key && label && !lookup.has(key)) lookup.set(key, label)
    })
  })
  return lookup
}

function getYouthGroupDisplayName(value, youthGroupLookup) {
  const id = formatExportPrimitive(value)
  if (!id) return ''
  const explicit = youthGroupLookup?.get(id)
  if (explicit && !api.isRawYouthGroupIdentifier(explicit)) return explicit
  const short = toYouthGroupShortLabel(id)
  if (short) return short
  return api.formatYouthGroupLabel(id) || api.genericYouthGroupLabel
}

function resolveYouthGroupDisplayLabel(label, groupId) {
  const text = formatExportPrimitive(label)
  if (text && !api.isRawYouthGroupIdentifier(text)) return text
  return api.formatYouthGroupLabel(groupId) || api.genericYouthGroupLabel
}

function buildJobLabelLookup(rows) {
  const lookup = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = formatExportPrimitive(row?.job_id)
    if (!id) return
    const label = joinExportParts([row?.job_title, row?.company], ' - ')
    lookup.set(id, resolveYouthGroupDisplayLabel(label, id))
  })
  return lookup
}

function formatNationalityRows(rows) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const docs = [
      row?.national_id ? `الرقم الوطني: ${formatExportPrimitive(row.national_id)}` : '',
      row?.passport_number ? `جواز السفر: ${formatExportPrimitive(row.passport_number)}` : '',
      row?.jordanian_mothers_children_serial ? `الرقم التسلسلي: ${formatExportPrimitive(row.jordanian_mothers_children_serial)}` : '',
    ].filter(Boolean)
    const base = formatExportPrimitive(row?.nationality)
    return joinExportParts([base, docs.join('، ')], '، ')
  }))
}

function formatAddressRows(rows) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const main = joinExportParts([row?.country, row?.governorate, row?.city, row?.address])
    const type = row?.is_primary ? '[رئيسي]' : '[إضافي]'
    const coords = row?.lat != null && row?.lng != null
      ? `الإحداثيات: ${formatExportPrimitive(row.lat)}, ${formatExportPrimitive(row.lng)}`
      : ''
    return joinExportLines([
      joinExportParts([type, main], ' '),
      coords,
    ])
  }))
}

function formatMobileRows(rows, jobLookup) {
  const typeLabels = {
    personal: 'شخصي',
    work: 'عمل',
    home: 'منزل',
    family: 'عائلي',
  }

  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const tags = []
    const type = formatExportPrimitive(row?.type)
    if (type === 'family') tags.push(joinExportParts([typeLabels[type], row?.family_relation], ' - '))
    else if (type) tags.push(typeLabels[type] || type)
    if (row?.phone_calls_flag) tags.push('مكالمات')
    if (row?.whatsapp_flag) tags.push('واتساب')
    const linkedJobs = (Array.isArray(row?.linked_job_ids) ? row.linked_job_ids : [])
      .map((jobId) => jobLookup.get(formatExportPrimitive(jobId)) || formatExportPrimitive(jobId))
      .filter(Boolean)
    if (linkedJobs.length) tags.push(`مرتبط بـ ${linkedJobs.join('، ')}`)
    return joinExportParts([row?.mobile_number, tags.join('، ')], '، ')
  }))
}

function formatEmailRows(rows, jobLookup) {
  const typeLabels = { personal: 'شخصي', work: 'عمل' }
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const tags = []
    const type = formatExportPrimitive(row?.type)
    if (type) tags.push(typeLabels[type] || type)
    if (row?.is_primary) tags.push('رئيسي')
    const linkedJobs = (Array.isArray(row?.linked_job_ids) ? row.linked_job_ids : [])
      .map((jobId) => jobLookup.get(formatExportPrimitive(jobId)) || formatExportPrimitive(jobId))
      .filter(Boolean)
    if (linkedJobs.length) tags.push(`مرتبط بـ ${linkedJobs.join('، ')}`)
    return joinExportParts([row?.email, tags.join('، ')], '، ')
  }))
}

function formatSocialMediaRows(rows) {
  const platformLabels = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' }
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const platform = platformLabels[formatExportPrimitive(row?.platform)] || formatExportPrimitive(row?.platform)
    const suffix = row?.is_primary ? '[رئيسي]' : ''
    return joinExportParts([platform ? `${platform}:` : '', row?.url, suffix], '، ')
  }))
}

function formatSchoolRows(rows, person) {
  const schoolStatus = formatExportPrimitive(person?.school_graduated)
  const system = joinExportParts([
    schoolStatus ? `الحالة: ${schoolStatus}` : 'الحالة: على مقاعد الدراسة',
    person?.school_system,
    person?.school_system_sector,
    person?.school_final_gpa ? `المعدل: ${formatExportPrimitive(person.school_final_gpa)}` : '',
  ], '، ')

  const entries = (Array.isArray(rows) ? rows : []).map((row) => {
    const grades = Array.isArray(row?.grades_attended) ? row.grades_attended : []
    const extras = []
    const hasCurrentFlag = row?.is_current === true || row?.is_current === false
    if (hasCurrentFlag) extras.push(row.is_current ? 'حاليًا' : 'سابقًا')
    if (row?.section) extras.push(`القسم: ${formatExportPrimitive(row.section)}`)
    if (grades.length) extras.push(`الصفوف: ${grades.map(formatExportPrimitive).filter(Boolean).join('، ')}`)
    const range = formatRange(row?.start_date, row?.end_date, row?.is_current, row?.state)
    if (range) extras.push(range)
    const other = summarizeExtraFields(row, ['person_id', 'school_record_id', 'school', 'school_name', 'section', 'grades_attended', 'is_current', 'start_date', 'end_date', 'state'])
    if (other) extras.push(other)
    return joinExportLines([row?.school ?? row?.school_name, extras.join('، ')])
  })

  return joinExportLines([system, ...entries])
}

function formatHigherEducationRows(rows) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const institutionName = row?.university_college ?? row?.institution_name
    const state = row?.state ?? row?.education_state
    const extras = []
    const head = joinExportParts([institutionName, row?.major, row?.degree], '، ')
    const range = formatRange(row?.start_date, row?.end_date, row?.is_current, state)
    if (range) extras.push(range)
    const stateLabel = higherEducationExportStateLabel(state, { isCurrent: Boolean(row?.is_current) })
    if (stateLabel) extras.push(`الحالة: ${stateLabel}`)
    if (row?.final_gpa) extras.push(`المعدل: ${formatExportPrimitive(row.final_gpa)}`)
    const other = summarizeExtraFields(row, ['person_id', 'university_college', 'institution_name', 'major', 'degree', 'start_date', 'end_date', 'is_current', 'state', 'education_state', 'final_gpa'])
    if (other) extras.push(other)
    return joinExportLines([head, extras.join('، ')])
  }))
}

function formatJobRows(rows) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const head = joinExportParts([row?.job_title, row?.company], '، ')
    const extras = []
    const range = formatRange(row?.start_date, row?.end_date, row?.is_current, row?.state)
    if (range) extras.push(range)
    const stateLabel = jobExportStateLabel(row?.state, { isCurrent: Boolean(row?.is_current) })
    if (stateLabel) extras.push(`الحالة: ${stateLabel}`)
    const other = summarizeExtraFields(row, ['person_id', 'job_id', 'job_title', 'company', 'employer_name', 'start_date', 'end_date', 'is_current', 'state', 'employment_state'])
    if (other) extras.push(other)
    return joinExportLines([head, extras.join('، ')])
  }))
}

function formatResponsibilitiesRows(rows, youthGroupLookup) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const group = getYouthGroupDisplayName(row?.youth_group_id, youthGroupLookup)
    const details = [
      row?.responsibility ?? row?.responsibility_name,
      row?.jec_year ? `سنة JEC: ${row.jec_year}` : '',
      row?.is_current === true || row?.is_current === 'true' ? 'الحالة: حاليًّا' : 'الحالة: سابقًا',
      row?.start_date ? `البداية: ${row.start_date}` : '',
      row?.end_date ? `النهاية: ${row.end_date}` : '',
    ].map(formatExportPrimitive).filter(Boolean)
    const other = summarizeExtraFields(row, ['person_id', 'youth_group_id', 'responsibility', 'responsibility_name', 'jec_year', 'is_current', 'start_date', 'end_date'])
    if (other) details.push(other)
    return joinExportLines([group, details.join('، ')])
  }))
}

function formatYouthMembershipRows(rows, youthGroupLookup) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const group = getYouthGroupDisplayName(row?.youth_group_id, youthGroupLookup)
    const details = []
    if (row?.age_group) details.push(`الفئة: ${formatExportPrimitive(row.age_group)}`)
    if (row?.youth_join_year) details.push(`منذ: ${formatExportPrimitive(row.youth_join_year)}`)
    if (row?.archived) details.push('مؤرشف')
    const other = summarizeExtraFields(row, ['person_id', 'youth_group_id', 'age_group', 'youth_join_year', 'archived'])
    if (other) details.push(other)
    return joinExportLines([group, details.join('، ')])
  }))
}

function formatHobbyRows(rows) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => joinExportLines([row?.hobby_skill, summarizeExtraFields(row, ['person_id', 'hobby_skill'])])))
}

function formatHealthRows(rows) {
  const typeLabels = { illness: 'الحالات الصحية', allergy: 'حساسية', surgery: 'العمليات الجراجية' }
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const label = typeLabels[formatExportPrimitive(row?.type)] || formatExportPrimitive(row?.type)
    return joinExportParts([label ? `${label}:` : '', row?.details], ' ')
  }))
}

function formatSpecialNotesRows(rows) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => joinExportParts([row?.note_title ? `${formatExportPrimitive(row.note_title)}:` : '', row?.note], ' ')))
}

function formatTimestampRows(rows, youthGroupLookup) {
  return joinExportLines((Array.isArray(rows) ? rows : []).map((row) => {
    const lines = []
    Object.entries(row || {}).forEach(([key, value]) => {
      if (key === 'person_id') return
      if (key === 'youth_group_id') {
        const group = getYouthGroupDisplayName(value, youthGroupLookup)
        if (group) lines.push(`فرقة الشبيبة: ${group}`)
        return
      }
      const rendered = Array.isArray(value) ? joinExportParts(value) : formatExportPrimitive(value)
      if (rendered) lines.push(`${humanizeExportKey(key)}: ${rendered}`)
    })
    return joinExportLines(lines)
  }))
}

function buildExportPhotoUrl(photoPath) {
  const text = formatExportPrimitive(photoPath)
  if (!text) return ''
  try {
    return new URL(text, globalThis.location?.origin || 'http://localhost').toString()
  } catch {
    return text
  }
}

function buildExportViewRow(record, youthGroupLookup) {
  const payload = record || {}
  const person = payload.person || {}
  const addresses = Array.isArray(payload.addresses) ? payload.addresses : []
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : []
  const jobLookup = buildJobLabelLookup(jobs)

  const row = {
    'الاسم الكامل': getDisplayName(person),
    'الاسم بالإنجليزية': joinExportParts([person.en_first_name, person.en_second_name, person.en_third_name, person.en_last_name], ' '),
    'اسم الأم': joinExportParts([person.mother_ar_first_name, person.mother_ar_second_name, person.mother_ar_last_name], ' '),
    'اسم الأم بالإنجليزية': joinExportParts([person.mother_en_first_name, person.mother_en_second_name, person.mother_en_last_name], ' '),
    'اللقب': formatExportPrimitive(person.title),
    'الجنس': formatExportPrimitive(person.gender),
    'تاريخ الميلاد': formatBirthDate(person),
    'الجنسية والوثائق': formatNationalityRows(payload.nationality),
    'العنوان': formatAddressRows(addresses),
    'أرقام الهواتف': formatMobileRows(payload.mobile_numbers, jobLookup),
    'البريد الإلكتروني': formatEmailRows(payload.emails, jobLookup),
    'وسائل التواصل الاجتماعي': formatSocialMediaRows(payload.social_media),
    'عضويات الشبيبة': formatYouthMembershipRows(payload.person_youth_group, youthGroupLookup),
    'المسؤوليات': formatResponsibilitiesRows(payload.responsibilities, youthGroupLookup),
    'التعليم المدرسي': formatSchoolRows(payload.schools, person),
    'التعليم العالي': formatHigherEducationRows(payload.higher_education),
    'الخبرة العملية': formatJobRows(jobs),
    'الهوايات والمهارات': formatHobbyRows(payload.hobbies_skills),
    'الحالات الصحية': formatHealthRows(payload.person_health_conditions),
    'الملاحظات الخاصة': formatSpecialNotesRows(payload.person_special_notes),
    'الصورة': buildExportPhotoUrl(payload.photo),
    'الطوابع الزمنية': formatTimestampRows(payload.timestamps, youthGroupLookup),
  }

  Object.entries(person).forEach(([key, value]) => {
    if (EXPORT_HIDDEN_PERSON_KEYS.has(key)) return
    const text = formatExportPrimitive(value)
    if (!text) return
    row[humanizeExportKey(key)] = text
  })

  return row
}

function buildWorksheetHeaders(rows) {
  const headers = []
  const seen = new Set()
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (seen.has(key)) return
      const hasAnyValue = rows.some((candidate) => hasMeaningfulExportValue(candidate?.[key]))
      if (!hasAnyValue) return
      seen.add(key)
      headers.push(key)
    })
  })
  return headers
}

async function mapWithConcurrency(items, limit, worker) {
  const results = []
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit)
    const chunkResults = await Promise.all(chunk.map(worker))
    results.push(...chunkResults)
  }
  return results
}

function buildExportFileName(prefix) {
  const stamp = new Date().toISOString().slice(0, 10)
  return `${prefix}-${stamp}.xlsx`
}

const PERSON_SEARCH_CACHE = new WeakMap()
function getCachedSearchFields(p) {
  const cached = PERSON_SEARCH_CACHE.get(p)
  if (cached) return cached

  const computed = {
    nameParts: getNameParts(p),
    otherFields: [p.gender, p.country, p.governorate, p.city, p.school_system, p.school_graduated, String(p.birth_year ?? '')].map(normalizeArabic),
  }
  PERSON_SEARCH_CACHE.set(p, computed)
  return computed
}

function nameMatches(parts, queryWordGroups) {
  if (!queryWordGroups.length) return true
  const partMatches = (part, alternatives) => alternatives.some(alt => part.includes(alt))

  if (queryWordGroups.every(group => parts.some(p => partMatches(p, group)))) return true
  let pi = 0, qi = 0
  while (pi < parts.length && qi < queryWordGroups.length) {
    if (partMatches(parts[pi], queryWordGroups[qi])) qi++
    pi++
  }
  return qi === queryWordGroups.length
}

// ── Column definitions ────────────────────────────────────────────────────────
const BIRTH_MONTHS_AR = {
  '1': 'كانون الثاني', '2': 'شباط', '3': 'آذار', '4': 'نيسان',
  '5': 'أيار', '6': 'حزيران', '7': 'تموز', '8': 'آب',
  '9': 'أيلول', '10': 'تشرين الأول', '11': 'تشرين الثاني', '12': 'كانون الأول',
}

const COL_DEFS = [
  // ── Arabic name parts ─────────────────────────────────────────────────────
  { key: 'ar_first_name',  label: 'الاسم الأول',    filterKey: 'ar_first_name',  dataKey: 'ar_first_name' },
  { key: 'ar_second_name', label: 'الاسم الثاني',   filterKey: 'ar_second_name', dataKey: 'ar_second_name' },
  { key: 'ar_third_name',  label: 'الاسم الثالث',   filterKey: 'ar_third_name',  dataKey: 'ar_third_name' },
  { key: 'ar_last_name',   label: 'اسم العائلة',    filterKey: 'ar_last_name',   dataKey: 'ar_last_name' },
  // ── English name parts ────────────────────────────────────────────────────
  { key: 'en_first_name',  label: 'First Name',     filterKey: 'en_first_name',  dataKey: 'en_first_name' },
  { key: 'en_second_name', label: 'Second Name',    filterKey: 'en_second_name', dataKey: 'en_second_name' },
  { key: 'en_third_name',  label: 'Third Name',     filterKey: 'en_third_name',  dataKey: 'en_third_name' },
  { key: 'en_last_name',   label: 'Last Name',      filterKey: 'en_last_name',   dataKey: 'en_last_name' },
  // ── Mother Arabic name ────────────────────────────────────────────────────
  { key: 'mother_ar_first_name',  label: 'اسم الأم الأول',   filterKey: 'mother_ar_first_name',  dataKey: 'mother_ar_first_name' },
  { key: 'mother_ar_second_name', label: 'اسم الأم الثاني',  filterKey: 'mother_ar_second_name', dataKey: 'mother_ar_second_name' },
  { key: 'mother_ar_last_name',   label: 'لقب الأم',         filterKey: 'mother_ar_last_name',   dataKey: 'mother_ar_last_name' },
  // ── Mother English name ───────────────────────────────────────────────────
  { key: 'mother_en_first_name',  label: "Mother's First",   filterKey: 'mother_en_first_name',  dataKey: 'mother_en_first_name' },
  { key: 'mother_en_second_name', label: "Mother's Second",  filterKey: 'mother_en_second_name', dataKey: 'mother_en_second_name' },
  { key: 'mother_en_last_name',   label: "Mother's Last",    filterKey: 'mother_en_last_name',   dataKey: 'mother_en_last_name' },
  // ── Personal ──────────────────────────────────────────────────────────────
  { key: 'title',       label: 'اللقب',             filterKey: 'title',       dataKey: 'title' },
  { key: 'gender',      label: 'الجنس',              filterKey: 'gender',      dataKey: 'gender' },
  { key: 'nationality', label: 'الجنسية',             filterKey: 'nationality', dataKey: p => p._nationalities },
  { key: 'has_photo',   label: 'الصورة الشخصية',    filterKey: 'has_photo',   dataKey: p => p._photo ? ['نعم'] : ['لا'] },
  // ── Birth ─────────────────────────────────────────────────────────────────
  { key: 'birth_year',  label: 'سنة الميلاد',       filterKey: 'birth_year',  dataKey: 'birth_year' },
  { key: 'birth_month', label: 'شهر الميلاد',       filterKey: 'birth_month', dataKey: p => {
    const m = p.birth_month != null ? String(p.birth_month) : ''
    const name = BIRTH_MONTHS_AR[m]
    return name ? [name] : []
  }},
  { key: 'birth_day',   label: 'يوم الميلاد',       filterKey: 'birth_day',   dataKey: 'birth_day' },
  // ── Location ──────────────────────────────────────────────────────────────
  { key: 'country',     label: 'البلد',              filterKey: 'country',     dataKey: 'country' },
  { key: 'governorate', label: 'المحافظة',            filterKey: 'governorate', dataKey: 'governorate' },
  { key: 'city',        label: 'المدينة',             filterKey: 'city',        dataKey: 'city' },
  { key: 'street_address',          label: 'العنوان التفصيلي',    filterKey: 'street_address',          dataKey: p => p._street_addresses },
  { key: 'has_multiple_addresses',  label: 'تعدد العناوين',        filterKey: 'has_multiple_addresses',  dataKey: p => p._has_multiple_addresses },
  { key: 'address_type',            label: 'نوع العنوان',          filterKey: 'address_type',            dataKey: p => p._address_types },
  { key: 'has_location',            label: 'إحداثيات الموقع',      filterKey: 'has_location',            dataKey: p => p._has_location },
  // ── Youth Group ───────────────────────────────────────────────────────────
  { key: 'youth_group',      label: 'فرقة الشبيبة',        filterKey: 'youth_group',      dataKey: p => p._youth_groups },
  { key: 'youth_is_current', label: 'حالة العضوية',         filterKey: 'youth_is_current', dataKey: p => p._youth_is_current },
  { key: 'age_group',        label: 'الفئة العمرية حاليًا', filterKey: 'age_group',        dataKey: p => p._age_groups },
  { key: 'age_group_prev',   label: 'الفئة العمرية سابقًا', filterKey: 'age_group_prev',   dataKey: p => p._prev_age_groups },
  { key: 'youth_join_year',  label: 'سنة الانتساب',         filterKey: 'youth_join_year',  dataKey: p => p._youth_join_years },
  // ── Responsibilities ──────────────────────────────────────────────────────
  { key: 'responsibility_youth_group', label: 'مسؤولية في',     filterKey: 'responsibility_youth_group', dataKey: p => p._responsibility_youth_groups },
  { key: 'responsibility_jec_year',    label: 'سنة JEC',        filterKey: 'responsibility_jec_year',    dataKey: p => p._responsibility_jec_years },
  { key: 'responsibility_is_current',  label: 'حالة المسؤولية', filterKey: 'responsibility_is_current',  dataKey: p => p._responsibility_current_states },
  { key: 'responsibility',             label: 'المسؤولية',      filterKey: 'responsibility',             dataKey: p => p._responsibilities },
  // ── Org Tree ──────────────────────────────────────────────────────────────
  { key: 'org_tree_group',    label: 'فرقة الشجرة التنظيمية', filterKey: 'org_tree_group',    dataKey: p => p._org_tree_groups },
  { key: 'org_tree_jec_year', label: 'سنة JEC (الشجرة)',      filterKey: 'org_tree_jec_year', dataKey: p => p._org_tree_jec_years },
  { key: 'org_tree_role',     label: 'الدور في الشجرة',        filterKey: 'org_tree_role',     dataKey: p => p._org_tree_roles },
  // ── General Secretariat Tree ──────────────────────────────────────────────
  { key: 'gs_tree_jec_year', label: 'سنة JEC (الأمانة)',  filterKey: 'gs_tree_jec_year', dataKey: p => p._gs_tree_jec_years },
  { key: 'gs_tree_role',     label: 'الدور في الأمانة',   filterKey: 'gs_tree_role',     dataKey: p => p._gs_tree_roles },
  // ── School Education ──────────────────────────────────────────────────────
  { key: 'school_graduated',     label: 'الحالة الدراسية',   filterKey: 'school_graduated',     dataKey: 'school_graduated' },
  { key: 'school_system',        label: 'النظام الدراسي',    filterKey: 'school_system',        dataKey: 'school_system' },
  { key: 'school_system_sector', label: 'الحقل / الفرع',     filterKey: 'school_system_sector', dataKey: 'school_system_sector' },
  { key: 'school',               label: 'المدرسة',           filterKey: 'school',               dataKey: p => p._schools },
  { key: 'school_status',        label: 'حالة المدرسة',           filterKey: 'school_status',        dataKey: p => p._school_statuses },
  { key: 'school_section',       label: 'المدرسة - القسم',        filterKey: 'school_section',       dataKey: p => p._school_sections },
  { key: 'school_grade',         label: 'الصف الدراسي الحالي',    filterKey: 'school_grade',         dataKey: p => p._school_current_grades },
  { key: 'school_grade_prev',    label: 'الصف الدراسي السابق',    filterKey: 'school_grade_prev',    dataKey: p => p._school_previous_grades },
  { key: 'school_gpa',           label: 'معدل المدرسة',            filterKey: 'school_gpa',           dataKey: 'school_final_gpa' },
  // ── Higher Education ──────────────────────────────────────────────────────
  { key: 'university',       label: 'الجامعة / الكلية',  filterKey: 'university',       dataKey: p => p._universities },
  { key: 'major',            label: 'التخصص',             filterKey: 'major',            dataKey: p => p._majors },
  { key: 'degree',           label: 'الدرجة العلمية',     filterKey: 'degree',           dataKey: p => p._degrees },
  { key: 'higher_ed_state',  label: 'حالة الجامعة',       filterKey: 'higher_ed_state',  dataKey: p => p._higher_ed_states },
  { key: 'uni_gpa',          label: 'معدل الجامعة',        filterKey: 'uni_gpa',          dataKey: p => p._uni_gpas },
  // ── Work ──────────────────────────────────────────────────────────────────
  { key: 'job_title',  label: 'المسمى الوظيفي',   filterKey: 'job_title',  dataKey: p => p._job_titles },
  { key: 'company',    label: 'الشركة',             filterKey: 'company',    dataKey: p => p._companies },
  { key: 'job_state',  label: 'حالة العمل',         filterKey: 'job_state',  dataKey: p => p._job_states },
  // ── Mobile ────────────────────────────────────────────────────────────────
  { key: 'mobile_type',             label: 'نوع الجوال',            filterKey: 'mobile_type',             dataKey: p => p._mobile_types },
  { key: 'mobile_personal_primary', label: 'أولوية الجوال الشخصي',  filterKey: 'mobile_personal_primary', dataKey: p => p._mobile_personal_primary },
  { key: 'mobile_family_relation',  label: 'علاقة جوال العائلة',   filterKey: 'mobile_family_relation',  dataKey: p => p._mobile_family_relations },
  { key: 'has_whatsapp',            label: 'واتساب',                filterKey: 'has_whatsapp',            dataKey: p => p._has_whatsapp },
  { key: 'has_phone_calls',         label: 'مكالمات هاتفية',        filterKey: 'has_phone_calls',         dataKey: p => p._has_phone_calls },
  // ── Email ─────────────────────────────────────────────────────────────────
  { key: 'email_type',             label: 'نوع البريد',             filterKey: 'email_type',             dataKey: p => p._email_types },
  { key: 'email_personal_primary', label: 'أولوية البريد الشخصي',   filterKey: 'email_personal_primary', dataKey: p => p._email_personal_primary },
  { key: 'email_family_relation',  label: 'علاقة بريد العائلة',    filterKey: 'email_family_relation',  dataKey: p => p._email_family_relations },
  // ── Social Media ──────────────────────────────────────────────────────────
  { key: 'social_platform', label: 'وسيلة التواصل',      filterKey: 'social_platform', dataKey: p => p._social_platforms },
  { key: 'social_primary',  label: 'أولوية التواصل',      filterKey: 'social_primary',  dataKey: p => p._social_primary },
  // ── Hobbies ───────────────────────────────────────────────────────────────
  { key: 'hobby_skill', label: 'الهوايات والمهارات',  filterKey: 'hobby_skill', dataKey: p => p._hobbies },
  // ── Health ────────────────────────────────────────────────────────────────
  { key: 'health_type',   label: 'نوع الحالة الصحية',    filterKey: 'health_type',   dataKey: p => p._health_types },
  { key: 'health_detail', label: 'تفاصيل الحالة الصحية', filterKey: 'health_detail', dataKey: p => p._health_details },
  // ── Special Notes ─────────────────────────────────────────────────────────
  { key: 'special_note_title',  label: 'عنوان الملاحظة', filterKey: 'special_note_title',  dataKey: p => p._special_note_titles },
  { key: 'special_note_detail', label: 'نص الملاحظة',    filterKey: 'special_note_detail', dataKey: p => p._special_note_details },
]

const FILTER_GROUPS = [
  { label: 'الاسم',              keys: ['ar_first_name', 'ar_second_name', 'ar_third_name', 'ar_last_name'] },
  { label: 'الاسم بالإنجليزية', keys: ['en_first_name', 'en_second_name', 'en_third_name', 'en_last_name'] },
  { label: 'اسم الأم',           keys: ['mother_ar_first_name', 'mother_ar_second_name', 'mother_ar_last_name'] },
  { label: 'اسم الأم بالإنجليزية', keys: ['mother_en_first_name', 'mother_en_second_name', 'mother_en_last_name'] },
  { label: 'الشخصية',            keys: ['title', 'gender', 'nationality', 'has_photo'] },
  { label: 'الميلاد',            keys: ['birth_year', 'birth_month', 'birth_day'] },
  { label: 'الموقع والسكن',       keys: ['country', 'governorate', 'city', 'street_address', 'has_multiple_addresses', 'address_type', 'has_location'] },
  { label: 'فرقة الشبيبة',        keys: ['youth_group', 'youth_is_current', 'age_group', 'age_group_prev', 'youth_join_year'] },
  { label: 'المسؤوليات',          keys: ['responsibility_youth_group', 'responsibility_jec_year', 'responsibility_is_current', 'responsibility'] },
  { label: 'الشجرة التنظيمية',    keys: ['org_tree_group', 'org_tree_jec_year', 'org_tree_role'] },
  { label: 'الأمانة العامة',      keys: ['gs_tree_jec_year', 'gs_tree_role'] },
  { label: 'التعليم المدرسي',     keys: ['school_graduated', 'school_system', 'school_system_sector', 'school', 'school_status', 'school_section', 'school_grade', 'school_grade_prev', 'school_gpa'] },
  { label: 'التعليم العالي',       keys: ['university', 'major', 'degree', 'higher_ed_state', 'uni_gpa'] },
  { label: 'العمل',              keys: ['job_title', 'company', 'job_state'] },
  { label: 'الجوال',              keys: ['mobile_type', 'mobile_personal_primary', 'mobile_family_relation', 'has_whatsapp', 'has_phone_calls'] },
  { label: 'البريد الإلكتروني',  keys: ['email_type', 'email_personal_primary', 'email_family_relation'] },
  { label: 'وسائل التواصل الاجتماعي', keys: ['social_platform', 'social_primary'] },
  { label: 'الهوايات والمهارات',  keys: ['hobby_skill'] },
  { label: 'الصحة',              keys: ['health_type', 'health_detail'] },
  { label: 'ملاحظات خاصة',       keys: ['special_note_title', 'special_note_detail'] },
]

function getValues(p, col) {
  if (typeof col.dataKey === 'function') {
    const arr = col.dataKey(p)
    return Array.isArray(arr) ? arr.map(String) : []
  }
  const v = p[col.dataKey]
  return v != null && String(v) !== '' ? [String(v)] : []
}

// ── Apply filters to a row set, optionally skipping one column key ────────────
function applyFilters(rows, filterState, skipKey, q, nameAliasLookup) {
  let result = rows

  if (q?.trim()) {
    const normQ  = normalizeArabic(q)
    const qWords = normQ.split(/\s+/).filter(Boolean)
    const qWordGroups = expandQueryWords(qWords, nameAliasLookup)
    result = result.filter(p => {
      const { nameParts, otherFields } = getCachedSearchFields(p)
      if (nameMatches(nameParts, qWordGroups)) return true
      return otherFields.some(f => f.includes(normQ))
    })
  }

  for (const col of COL_DEFS) {
    if (col.key === skipKey) continue
    const fs = filterState[col.key]
    if (!fs?.selected) continue
    if (fs.selected.size === 0) return []
    // Skip if all values selected (no effective filter)
    // We can't know total opts here so we check against the set itself being non-restrictive
    // by checking passthrough: if every person passes, skip for perf
    result = result.filter(p => {
      const vals = getValues(p, col)
      if (vals.length === 0) return fs.selected.has('')
      return vals.some(v => fs.selected.has(v))
    })
  }

  return result
}

// ── Build { value, count }[] for a column from a set of rows ─────────────────
function buildOpts(rows, col) {
  const counts = new Map()
  for (const p of rows) {
    const vals = getValues(p, col)
    const keys = vals.length === 0 ? [''] : vals
    for (const v of keys) {
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'))
}

// ── Google-Sheets dropdown ────────────────────────────────────────────────────
function GSDropdown({ allValues, selected, onApply, onClose, anchorRef }) {
  const ref = useRef(null)
  const [search, setSearch]   = useState('')
  const [checked, setChecked] = useState(new Set(selected))
  const [sort, setSort]       = useState(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          anchorRef?.current && !anchorRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  const filtered = allValues.filter(({ value }) =>
    normalizeArabic(value).includes(normalizeArabic(search)) ||
    value.toLowerCase().includes(search.toLowerCase())
  )
  const allFilteredChecked = filtered.length > 0 && filtered.every(({ value }) => checked.has(value))

  const toggleOne = (v) => setChecked(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })
  const toggleFiltered = () => {
    if (allFilteredChecked) setChecked(prev => { const n = new Set(prev); filtered.forEach(({ value }) => n.delete(value)); return n })
    else                    setChecked(prev => { const n = new Set(prev); filtered.forEach(({ value }) => n.add(value)); return n })
  }
  const selectAll = () => setChecked(new Set(allValues.map(({ value }) => value)))
  const clearAll  = () => setChecked(new Set())

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 1000,
      background: 'white', border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
      width: 260, overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--gray-400)', marginBottom: 6, letterSpacing: '0.8px' }}>الترتيب</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['asc', <ArrowUpAZ size={13}/>, 'أ → ي'], ['desc', <ArrowDownAZ size={13}/>, 'ي → أ']].map(([val, icon, lbl]) => (
            <button key={val} onClick={() => setSort(s => s === val ? null : val)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: '6px 4px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              border: `1.5px solid ${sort === val ? 'var(--navy)' : 'var(--gray-200)'}`,
              background: sort === val ? 'var(--navy)' : 'white',
              color: sort === val ? 'white' : 'var(--gray-600)',
              fontSize: '0.78rem', fontFamily: 'var(--font-body)', fontWeight: 600,
            }}>{icon} {lbl}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray-100)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'var(--gray-50)',
          border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-sm)', padding: '5px 9px',
        }}>
          <Search size={12} style={{ color: 'var(--gray-400)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث…" style={{
            border: 'none', background: 'transparent', flex: 1, outline: 'none',
            fontFamily: 'var(--font-body)', fontSize: '0.82rem',
            direction: 'rtl', textAlign: 'right', color: 'var(--gray-700)',
          }} />
          {search && <X size={11} style={{ color: 'var(--gray-400)', cursor: 'pointer' }} onClick={() => setSearch('')} />}
        </div>
      </div>

      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={selectAll} style={linkStyle}>تحديد الكل</button>
        <span style={{ color: 'var(--gray-300)' }}>|</span>
        <button onClick={clearAll}  style={linkStyle}>إلغاء الكل</button>
        <span style={{ marginRight: 'auto', fontSize: '0.72rem', color: 'var(--gray-400)' }}>
          {checked.size} / {allValues.length}
        </span>
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
        {filtered.length > 0 && (
          <label style={itemStyle(allFilteredChecked)}>
            <input type="checkbox" checked={allFilteredChecked} onChange={toggleFiltered}
              style={{ accentColor: 'var(--navy)', flexShrink: 0 }} />
            <span style={{ fontStyle: 'italic', color: 'var(--gray-400)', fontSize: '0.8rem', flex: 1 }}>
              {search ? `كل النتائج (${filtered.length})` : '(تحديد الكل)'}
            </span>
          </label>
        )}
        {filtered.length === 0 && (
          <div style={{ padding: '14px', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.82rem' }}>لا توجد قيم</div>
        )}
        {filtered.map(({ value, count }) => (
          <label key={value} style={itemStyle(checked.has(value))}>
            <input type="checkbox" checked={checked.has(value)} onChange={() => toggleOne(value)}
              style={{ accentColor: 'var(--navy)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.84rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {value === '' ? <em style={{ color: 'var(--gray-400)' }}>(فارغ)</em> : value}
            </span>
            <span style={{
              fontSize: '0.7rem', color: 'var(--gray-400)', background: 'var(--gray-100)',
              borderRadius: 10, padding: '1px 6px', flexShrink: 0, fontWeight: 600,
            }}>{count}</span>
          </label>
        ))}
      </div>

      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--gray-100)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary btn-sm" onClick={() => { onApply(checked, sort); onClose() }}>تطبيق</button>
      </div>
    </div>
  )
}

const linkStyle = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  color: 'var(--navy-light)', fontSize: '0.78rem', fontFamily: 'var(--font-body)',
  fontWeight: 600, textDecoration: 'underline',
}
const itemStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
  cursor: 'pointer', background: active ? 'rgba(15,39,68,0.04)' : 'transparent',
  transition: 'background 0.1s',
})

// ── Filter box ────────────────────────────────────────────────────────────────
function FilterBox({ label, allValues, selected, sort, onChange }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const isFiltered = selected !== null && selected.size < allValues.length
  const hasSort    = !!sort
  const active     = isFiltered || hasSort

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-500)', marginBottom: 4 }}>
        {label}
      </label>
      <button ref={btnRef} onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
        border: `1.5px solid ${active ? 'var(--navy)' : 'var(--gray-200)'}`,
        background: active ? 'rgba(15,39,68,0.04)' : 'white',
        fontFamily: 'var(--font-body)', fontSize: '0.83rem',
        color: active ? 'var(--navy)' : 'var(--gray-500)',
        fontWeight: active ? 700 : 400,
        transition: 'all 0.15s', gap: 5,
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'right' }}>
          {isFiltered ? `${selected.size} من ${allValues.length}`
            : hasSort ? (sort === 'asc' ? '↑ أ → ي' : '↓ ي → أ')
            : 'الكل'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {sort === 'asc'  && <ArrowUpAZ size={12} style={{ color: 'var(--navy)' }} />}
          {sort === 'desc' && <ArrowDownAZ size={12} style={{ color: 'var(--navy)' }} />}
          {isFiltered && <span style={{ color: 'var(--gold)', fontSize: '0.55rem' }}>●</span>}
          <ChevronDown size={12} style={{ color: 'var(--gray-400)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </div>
      </button>
      {open && (
        <GSDropdown
          allValues={allValues}
          selected={selected ?? new Set(allValues.map(({ value }) => value))}
          onApply={(sel, s) => onChange(sel, s)}
          onClose={() => setOpen(false)}
          anchorRef={btnRef}
        />
      )}
    </div>
  )
}

// ── Grouped filter panel ──────────────────────────────────────────────────────
const COL_MAP = Object.fromEntries(COL_DEFS.map(c => [c.key, c]))

function FilterPanel({ groups, opts, filterState, onUpdate }) {
  return (
    <div style={{
      background: 'white', border: '1px solid var(--gray-200)',
      borderRadius: 'var(--radius-lg)', padding: '18px 20px',
      marginBottom: 16, direction: 'rtl',
    }}>
      {groups.map((group, gi) => {
        if (group.visibleWhen && !group.visibleWhen(filterState)) return null
        const visibleCols = group.keys
          .map(key => COL_MAP[key])
          .filter(col => col && (opts[col.key] ?? []).length > 0)
        if (!visibleCols.length) return null
        return (
          <div key={group.label}>
            {gi > 0 && (
              <div style={{ height: 1, background: 'var(--gray-100)', margin: '14px 0 12px' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{
                fontSize: '0.68rem', fontWeight: 800, color: 'var(--navy)',
                opacity: 0.55, whiteSpace: 'nowrap', flexShrink: 0,
                letterSpacing: '0.5px', textTransform: 'uppercase',
              }}>
                {group.label}
              </span>
              <div style={{ flex: 1, height: '1px', background: 'var(--gray-150, #eef0f3)' }} />
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))',
              gap: '10px 10px',
            }}>
              {visibleCols.map(col => (
                <FilterBox
                  key={col.key}
                  label={col.label}
                  allValues={opts[col.key] ?? []}
                  selected={filterState[col.key]?.selected ?? null}
                  sort={filterState[col.key]?.sort ?? null}
                  onChange={(sel, sort) => onUpdate(col.key, sel, sort)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, photoUrl }) {
  const [imgError, setImgError] = useState(false)
  const initials = firstNameInitial(name)

  if (photoUrl && !imgError) {
    return (
      <div className="member-avatar" style={{ padding: 0, overflow: 'hidden' }}>
        <img
          src={photoUrl}
          alt={name}
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
        />
      </div>
    )
  }
  return <div className="member-avatar">{initials}</div>
}

// ── Unregistered uses same COL_DEFS, getValues, applyFilters, buildOpts as registered
// because /api/unregistered now returns enriched records with identical shape.
// Alias them for clarity:
const UNREG_COL_DEFS = COL_DEFS
const getUnregValues = getValues
const applyUnregFilters = applyFilters
const buildUnregOpts = buildOpts

// ── Confirm Dialog ────────────────────────────────────────────────────────────
function ConfirmDialog({ open, title, message, confirmLabel, confirmClass, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15,39,68,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div style={{
        background: 'white', borderRadius: 'var(--radius-lg)', padding: '28px 32px', maxWidth: 400, width: '90%',
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

// ── Archive Membership Dialog ───────────────────────────────────────────────
function ArchiveMembershipDialog({ open, name, options, selectedId, onChange, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15,39,68,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div style={{
        background: 'white', borderRadius: 'var(--radius-lg)', padding: '24px 28px', maxWidth: 460, width: '92%',
        boxShadow: 'var(--shadow-lg)', direction: 'rtl',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '1.08rem', color: 'var(--navy)', marginBottom: 8 }}>
          اختيار فرقة الأرشفة
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--gray-600)', marginBottom: 14, lineHeight: 1.7 }}>
          اختر فرقة الشبيبة التي تريد أرشفة <strong>"{name}"</strong> ضمنها.
        </div>

        <div style={{ marginBottom: 18 }}>
          <select
            value={selectedId || ''}
            onChange={e => onChange(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1.5px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-body)',
              fontSize: '0.9rem',
              background: 'white',
            }}
          >
            <option value="">اختر فرقة الشبيبة…</option>
            {(options || []).map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
          <button className="btn btn-primary btn-sm" onClick={onConfirm} disabled={!selectedId}>أرشفة</button>
        </div>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Members({ onSelectPerson, onSelectUnregistered, onAdd, toast, restrictedToPersonIds = null, restrictedToUnregIds = null }) {
  const [activeTab, setActiveTab]         = useState('registered')
  const [allPersons, setAllPersons]       = useState([])
  const [unregistered, setUnreg]          = useState([])
  const [loading, setLoading]             = useState(true)
  const [unregLoading, setUnregLoading]   = useState(true)
  const [registeredLoadError, setRegisteredLoadError] = useState('')
  const [unregisteredLoadError, setUnregisteredLoadError] = useState('')
  const [confirm, setConfirm]             = useState(null) // { type, id, name, action }
  const [archivePrompt, setArchivePrompt] = useState(null) // { type, id, name, options, selectedId }
  const [reloadKey, setReloadKey]         = useState(0)

  // Registered state
  const [q, setQ]                         = useState('')
  const deferredQ                         = useDeferredValue(q)
  const [showFilters, setShowFilters]     = useState(false)
  const [filterState, setFilterState]     = useState({})
  const [page, setPage]                   = useState(1)

  // Unregistered state
  const [uq, setUq]                       = useState('')
  const deferredUq                        = useDeferredValue(uq)
  const [showUFilters, setShowUFilters]   = useState(false)
  const [uFilterState, setUFilterState]   = useState({})
  const [uPage, setUPage]                 = useState(1)
  const [archiveQ, setArchiveQ]           = useState('')
  const deferredArchiveQ                   = useDeferredValue(archiveQ)
  const [showArchiveFilters, setShowArchiveFilters] = useState(false)
  const [archiveFilterState, setArchiveFilterState] = useState({})
  const [nameVariations, setNameVariations] = useState({})
  const [exportingTarget, setExportingTarget] = useState('')
  const PER_PAGE = 50

  const nameAliasLookup = useMemo(() => buildNameAliasLookup(nameVariations), [nameVariations])

  // Whether viewing in restricted (member-privilege) mode.
  // Computed as a stable boolean so it is safe to use as a useEffect dependency
  // (Set objects get new references on every parent render, causing infinite loops).
  const isRestricted = !!(restrictedToPersonIds || restrictedToUnregIds)

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setUnregLoading(true)
    setRegisteredLoadError('')
    setUnregisteredLoadError('')

    if (isRestricted) {
      // Restricted mode: load both registered and unregistered from single endpoint
      ;(async () => {
        try {
          const accessible = await api.getAccessibleMembers()
          if (!canceled) {
            setAllPersons(accessible.registered || [])
            setUnreg(accessible.unregistered || [])
          }
        } catch {
          if (!canceled) {
            setAllPersons([])
            setUnreg([])
            setRegisteredLoadError('تعذر تحميل الأعضاء المسجّلين حالياً. حاول مرة أخرى.')
            toast?.('تعذر تحميل الأعضاء', 'error')
          }
        } finally {
          if (!canceled) {
            setLoading(false)
            setUnregLoading(false)
          }
        }
      })()
    } else {
      // Admin mode: load registered and unregistered separately
      ;(async () => {
        try {
          const enriched = await api.membersIndex()
          if (!canceled) setAllPersons(enriched)
        } catch {
          if (!canceled) {
            setAllPersons([])
            setRegisteredLoadError('تعذر تحميل الأعضاء المسجّلين حالياً. حاول مرة أخرى.')
            toast?.('تعذر تحميل الأعضاء المسجّلين', 'error')
          }
        } finally {
          if (!canceled) setLoading(false)
        }
      })()

      ;(async () => {
        try {
          const unreg = await api.getUnregistered()
          if (!canceled) setUnreg(unreg)
        } catch {
          if (!canceled) {
            setUnreg([])
            setUnregisteredLoadError('تعذر تحميل غير المسجّلين حالياً. حاول مرة أخرى.')
            toast?.('تعذر تحميل غير المسجّلين', 'error')
          }
        } finally {
          if (!canceled) setUnregLoading(false)
        }
      })()
    }

    ;(async () => {
      try {
        const cfg = await api.getConfig()
        if (!canceled) setNameVariations(normalizeNameVariations(cfg?.config?.name_variations || {}))
      } catch {
        if (!canceled) setNameVariations({})
      }
    })()

    return () => { canceled = true }
  }, [reloadKey, toast, isRestricted])

  // The backend already filters in restricted mode; in admin mode the full list is returned.
  // We never re-filter on the frontend to avoid incorrectly excluding the user's own entry.
  const visiblePersons = allPersons

  // Split active vs archived
  const activePersons   = useMemo(() => visiblePersons.filter(p => !p.archived), [visiblePersons])
  const archivedPersons = useMemo(() => visiblePersons.filter(p => p.archived), [visiblePersons])
  const activeUnreg     = useMemo(() => unregistered.filter(r => !r.archived), [unregistered])
  const archivedUnreg   = useMemo(() => unregistered.filter(r => r.archived),  [unregistered])
  const archivedAll     = useMemo(() => {
    const overlay = (r) => ({
      ...r,
      // Expose archived youth data via the active-membership keys so filters work
      _youth_groups:     r._archived_youth_groups?.length     ? r._archived_youth_groups     : (r._youth_groups     || []),
      _age_groups:       r._archived_age_groups?.length       ? r._archived_age_groups       : (r._age_groups       || []),
      _youth_join_years: r._archived_youth_join_years?.length ? r._archived_youth_join_years : (r._youth_join_years || []),
    })
    return [
      ...archivedPersons.map(p => ({ ...overlay(p), _isReg: true })),
      ...archivedUnreg.map(r => ({ ...overlay(r), _isReg: false })),
    ]
  }, [archivedPersons, archivedUnreg])

  const toGroupLabel = (groupId) => {
    const gid = String(groupId || '').trim()
    if (!gid) return '—'
    const short = toYouthGroupShortLabel(gid)
    return short || api.formatYouthGroupLabel(gid) || api.genericYouthGroupLabel
  }

  const getActiveMembershipChoices = (row) => {
    const ids = Array.isArray(row?._youth_group_ids) ? row._youth_group_ids : []
    const names = Array.isArray(row?._youth_groups) ? row._youth_groups : []
    const ages = Array.isArray(row?._age_groups) ? row._age_groups : []

    const choices = []
    const seen = new Set()
    for (let i = 0; i < ids.length; i += 1) {
      const id = String(ids[i] || '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const groupLabel = names[i] ? toYouthGroupShortLabel(names[i]) || String(names[i]) : toGroupLabel(id)
      const age = String(ages[i] || '').trim()
      choices.push({ id, label: age ? `${groupLabel} (${age})` : groupLabel })
    }
    return choices
  }

  const getArchivedMembershipIds = (row) => {
    if (Array.isArray(row?._archived_youth_group_ids) && row._archived_youth_group_ids.length > 0) {
      return row._archived_youth_group_ids.map(v => String(v || '').trim()).filter(Boolean)
    }
    if (row?.archived && Array.isArray(row?._youth_group_ids) && row._youth_group_ids.length > 0) {
      return row._youth_group_ids.map(v => String(v || '').trim()).filter(Boolean)
    }
    return []
  }

  const visibleArchived = useMemo(() => {
    let rows = applyFilters(archivedAll, archiveFilterState, null, deferredArchiveQ, nameAliasLookup)
    const primarySortCol = COL_DEFS.find(c => archiveFilterState[c.key]?.sort)
    if (primarySortCol) {
      const dir = archiveFilterState[primarySortCol.key].sort
      rows = [...rows].sort((a, b) => {
        const va = normalizeArabic(getValues(a, primarySortCol)[0] ?? '')
        const vb = normalizeArabic(getValues(b, primarySortCol)[0] ?? '')
        return dir === 'asc' ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar')
      })
    }
    return rows
  }, [archivedAll, archiveFilterState, deferredArchiveQ, nameAliasLookup])

  const firstActiveMembershipGroup = (row) => {
    if (Array.isArray(row?._youth_group_ids) && row._youth_group_ids.length > 0) {
      return String(row._youth_group_ids[0] || '').trim() || null
    }
    return null
  }

  const firstArchivedMembershipGroup = (row) => {
    if (Array.isArray(row?._archived_youth_group_ids) && row._archived_youth_group_ids.length > 0) {
      return String(row._archived_youth_group_ids[0] || '').trim() || null
    }
    return null
  }

  // ── Registered logic ──────────────────────────────────────────────────────
  const updateFilter = (key, selected, sort) => { setFilterState(f => ({ ...f, [key]: { selected, sort } })); setPage(1) }
  const clearAll = () => { setFilterState({}); setQ(''); setPage(1) }
  const hasAnyFilter = q.trim() || Object.values(filterState).some(f => f?.selected || f?.sort)
  const primarySortCol = COL_DEFS.find(c => filterState[c.key]?.sort)

  const visible = useMemo(() => {
    let rows = applyFilters(activePersons, filterState, null, deferredQ, nameAliasLookup)
    if (primarySortCol) {
      const dir = filterState[primarySortCol.key].sort
      rows = [...rows].sort((a, b) => {
        const va = normalizeArabic(getValues(a, primarySortCol)[0] ?? '')
        const vb = normalizeArabic(getValues(b, primarySortCol)[0] ?? '')
        return dir === 'asc' ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar')
      })
    }
    return rows
  }, [activePersons, filterState, deferredQ, primarySortCol, nameAliasLookup])

  const cascadedOpts = useMemo(() => {
    if (!showFilters) return {}
    const result = {}
    for (const col of COL_DEFS) result[col.key] = buildOpts(applyFilters(activePersons, filterState, col.key, deferredQ, nameAliasLookup), col)
    return result
  }, [activePersons, filterState, deferredQ, showFilters, nameAliasLookup])

  const totalPages = Math.ceil(visible.length / PER_PAGE)
  const pageRows   = visible.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // ── Unregistered logic ────────────────────────────────────────────────────
  const updateUFilter = (key, selected, sort) => { setUFilterState(f => ({ ...f, [key]: { selected, sort } })); setUPage(1) }
  const clearUAll = () => { setUFilterState({}); setUq(''); setUPage(1) }
  const hasAnyUFilter = uq.trim() || Object.values(uFilterState).some(f => f?.selected || f?.sort)
  const primaryUSortCol = UNREG_COL_DEFS.find(c => uFilterState[c.key]?.sort)

  const visibleUnreg = useMemo(() => {
    let rows = applyUnregFilters(activeUnreg, uFilterState, null, deferredUq, nameAliasLookup)
    if (primaryUSortCol) {
      const dir = uFilterState[primaryUSortCol.key].sort
      rows = [...rows].sort((a, b) => {
        const va = normalizeArabic(getUnregValues(a, primaryUSortCol)[0] ?? '')
        const vb = normalizeArabic(getUnregValues(b, primaryUSortCol)[0] ?? '')
        return dir === 'asc' ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar')
      })
    }
    return rows
  }, [activeUnreg, uFilterState, deferredUq, primaryUSortCol, nameAliasLookup])

  const uCascadedOpts = useMemo(() => {
    if (!showUFilters) return {}
    const result = {}
    for (const col of UNREG_COL_DEFS) result[col.key] = buildUnregOpts(applyUnregFilters(activeUnreg, uFilterState, col.key, deferredUq, nameAliasLookup), col)
    return result
  }, [activeUnreg, uFilterState, deferredUq, showUFilters, nameAliasLookup])

  const uTotalPages = Math.ceil(visibleUnreg.length / PER_PAGE)
  const uPageRows   = visibleUnreg.slice((uPage - 1) * PER_PAGE, uPage * PER_PAGE)

  // ── Archived logic ────────────────────────────────────────────────────────
  const updateArchiveFilter = (key, selected, sort) => { setArchiveFilterState(f => ({ ...f, [key]: { selected, sort } })) }
  const clearArchiveAll = () => { setArchiveFilterState({}); setArchiveQ('') }
  const hasAnyArchiveFilter = archiveQ.trim() || Object.values(archiveFilterState).some(f => f?.selected || f?.sort)

  const cascadedArchiveOpts = useMemo(() => {
    if (!showArchiveFilters) return {}
    const result = {}
    for (const col of COL_DEFS) result[col.key] = buildOpts(applyFilters(archivedAll, archiveFilterState, col.key, deferredArchiveQ, nameAliasLookup), col)
    return result
  }, [archivedAll, archiveFilterState, deferredArchiveQ, showArchiveFilters, nameAliasLookup])

  const handleDeleteUnreg = async (e, r) => {
    e.stopPropagation()
    const name = getDisplayName(r) || 'هذا الشخص'
    setConfirm({ type: 'delete-unreg', id: r.person_id, name })
  }

  const handleDeletePerson = async (e, p) => {
    e.stopPropagation()
    const name = getDisplayName(p) || 'هذا العضو'
    setConfirm({ type: 'delete-reg', id: p.person_id, name })
  }

  const handleArchivePerson = async (e, p) => {
    e.stopPropagation()
    const options = getActiveMembershipChoices(p)
    if (!options.length) {
      toast?.('لا توجد عضوية شبيبة نشطة لأرشفتها', 'error')
      return
    }
    const name = getDisplayName(p) || 'هذا العضو'
    setArchivePrompt({ type: 'archive-reg', id: p.person_id, name, options, selectedId: options[0].id })
  }

  const handleUnarchivePerson = async (e, p) => {
    e.stopPropagation()
    const youthGroupId = firstArchivedMembershipGroup(p)
    if (!youthGroupId) {
      toast?.('لا توجد عضوية مؤرشفة لاستعادتها', 'error')
      return
    }
    try {
      await api.unarchivePerson(p.person_id, youthGroupId)
      const refreshed = await api.membersIndex()
      setAllPersons(refreshed)
      toast?.('تم استعادة العضو', 'success')
    } catch { toast?.('خطأ في الاستعادة', 'error') }
  }

  const handleArchiveUnreg = async (e, r) => {
    e.stopPropagation()
    const options = getActiveMembershipChoices(r)
    if (!options.length) {
      toast?.('لا توجد عضوية شبيبة نشطة لأرشفتها', 'error')
      return
    }
    const name = getDisplayName(r) || 'هذا الشخص'
    setArchivePrompt({ type: 'archive-unreg', id: r.person_id, name, options, selectedId: options[0].id })
  }

  const executeArchivePrompt = async () => {
    if (!archivePrompt) return
    const { type, id, selectedId } = archivePrompt
    const youthGroupId = String(selectedId || '').trim()
    if (!youthGroupId) {
      toast?.('يرجى اختيار فرقة الشبيبة', 'error')
      return
    }
    try {
      if (type === 'archive-reg') {
        await api.archivePerson(id, youthGroupId)
        const refreshed = await api.membersIndex()
        setAllPersons(refreshed)
      } else if (type === 'archive-unreg') {
        await api.archiveUnregistered(id, youthGroupId)
        const refreshed = await api.getUnregistered()
        setUnreg(refreshed)
      }
      toast?.('تمت الأرشفة', 'success')
      setArchivePrompt(null)
    } catch {
      toast?.('حدث خطأ', 'error')
    }
  }

  const handleUnarchiveUnreg = async (e, r) => {
    e.stopPropagation()
    const youthGroupId = firstArchivedMembershipGroup(r)
    if (!youthGroupId) {
      toast?.('لا توجد عضوية مؤرشفة لاستعادتها', 'error')
      return
    }
    try {
      await api.unarchiveUnregistered(r.person_id, youthGroupId)
      const refreshed = await api.getUnregistered()
      setUnreg(refreshed)
      toast?.('تم استعادة الشخص', 'success')
    } catch { toast?.('خطأ في الاستعادة', 'error') }
  }

  const executeConfirm = async () => {
    if (!confirm) return
    const { type, id, youthGroupId } = confirm
    try {
      if (type === 'delete-reg') {
        await api.deletePerson(id)
        setAllPersons(ps => ps.filter(p => p.person_id !== id))
        toast?.('تم حذف العضو نهائياً', 'success')
      } else if (type === 'delete-unreg') {
        await api.deleteUnregistered(id)
        setUnreg(rs => rs.filter(r => r.person_id !== id))
        toast?.('تم الحذف', 'success')
      } else if (type === 'archive-reg') {
        await api.archivePerson(id, youthGroupId)
        const refreshed = await api.membersIndex()
        setAllPersons(refreshed)
        toast?.('تمت الأرشفة', 'success')
      } else if (type === 'archive-unreg') {
        await api.archiveUnregistered(id, youthGroupId)
        const refreshed = await api.getUnregistered()
        setUnreg(refreshed)
        toast?.('تمت الأرشفة', 'success')
      }
    } catch { toast?.('حدث خطأ', 'error') }
    setConfirm(null)
  }

  const exportProfilesToWorkbook = async ({ rows, mode }) => {
    if (!rows.length) {
      toast?.('لا توجد نتائج لتصديرها', 'error')
      return
    }

    const target = mode === 'archived' ? 'archived' : (mode === 'unregistered' ? 'unregistered' : 'registered')
    setExportingTarget(target)
    try {
      const youthGroupLookup = extendYouthGroupLookupFromMembers(
        buildYouthGroupNameLookup([]),
        [...allPersons, ...unregistered]
      )

      const detailedRecords = await mapWithConcurrency(rows, 10, async (row) => {
        const isUnreg = mode === 'unregistered' || (mode === 'archived' && !row._isReg)
        const payload = isUnreg
          ? await api.getUnregisteredPerson(row.person_id)
          : await api.getPerson(row.person_id)
        return buildExportViewRow(payload, youthGroupLookup)
      })

      const headers = buildWorksheetHeaders(detailedRecords)
      const sheet = XLSX.utils.json_to_sheet(detailedRecords, { header: headers })
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, 'Members')
      XLSX.writeFile(workbook, buildExportFileName(mode === 'unregistered' ? 'unregistered-members-export' : 'members-export'))
      toast?.(`تم تنزيل ${rows.length.toLocaleString('ar-EG')} سجل`, 'success')
    } catch {
      toast?.('تعذر إنشاء ملف Excel', 'error')
    } finally {
      setExportingTarget('')
    }
  }

  const retryLoad = () => setReloadKey((value) => value + 1)
  const archivedLoadError = registeredLoadError || unregisteredLoadError

  if (loading) {
    return (
      <LoadingState
        title="جارٍ تحميل الأعضاء"
        description="يتم تجهيز سجلات الأعضاء والبيانات المرتبطة بها الآن."
        minHeight={320}
      />
    )
  }

  return (
    <div>
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.type?.startsWith('delete') ? 'تأكيد الحذف النهائي' :
          confirm?.type?.startsWith('archive') ? 'تأكيد الأرشفة' : ''
        }
        message={
          confirm?.type === 'delete-reg'
            ? `هل أنت متأكد من حذف العضو "${confirm?.name}" نهائياً؟ سيتم حذف جميع بياناته بشكل دائم ولا يمكن التراجع عن هذا الإجراء.`
            : confirm?.type === 'delete-unreg'
            ? `هل أنت متأكد من حذف "${confirm?.name}"؟ لا يمكن التراجع عن هذا الإجراء.`
            : confirm?.type === 'archive-reg'
            ? `هل تريد أرشفة العضو "${confirm?.name}"؟ سينتقل إلى تبويب الأرشيف ويمكن استعادته لاحقاً.`
            : `هل تريد أرشفة "${confirm?.name}"؟ سينتقل إلى تبويب الأرشيف ويمكن استعادته لاحقاً.`
        }
        confirmLabel={confirm?.type?.startsWith('delete') ? 'حذف نهائي' : 'أرشفة'}
        confirmClass={confirm?.type?.startsWith('delete') ? 'btn-danger' : 'btn-primary'}
        onConfirm={executeConfirm}
        onCancel={() => setConfirm(null)}
      />

      <ArchiveMembershipDialog
        open={!!archivePrompt}
        name={archivePrompt?.name || ''}
        options={archivePrompt?.options || []}
        selectedId={archivePrompt?.selectedId || ''}
        onChange={(value) => setArchivePrompt(prev => (prev ? { ...prev, selectedId: value } : prev))}
        onConfirm={executeArchivePrompt}
        onCancel={() => setArchivePrompt(null)}
      />

      {/* Tab switcher */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab${activeTab === 'registered' ? ' active' : ''}`} onClick={() => setActiveTab('registered')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', marginLeft: 5 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          الأعضاء المسجّلون
          <span style={{ background: 'var(--navy)', color: 'white', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', marginRight: 6 }}>
            {activePersons.length.toLocaleString('ar-EG')}
          </span>
        </button>
        {(activeUnreg.length > 0 || archivedUnreg.length > 0 || !isRestricted) && <button className={`tab${activeTab === 'unregistered' ? ' active' : ''}`} onClick={() => setActiveTab('unregistered')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', marginLeft: 5 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg>
          غير المسجّلين
          {activeUnreg.length > 0 && (
            <span style={{ background: '#e8b55a', color: '#92400e', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', marginRight: 6 }}>
              {activeUnreg.length.toLocaleString('ar-EG')}
            </span>
          )}
        </button>}
        {(archivedAll.length > 0 || !isRestricted) && <button className={`tab${activeTab === 'archived' ? ' active' : ''}`} onClick={() => setActiveTab('archived')}>
          <Archive size={14} style={{ display: 'inline', marginLeft: 5 }} />
          الأرشيف
          {archivedAll.length > 0 && (
            <span style={{ background: 'var(--gray-400)', color: 'white', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', marginRight: 6 }}>
              {archivedAll.length.toLocaleString('ar-EG')}
            </span>
          )}
        </button>}
      </div>

      {/* ═══════════════════ REGISTERED TAB ═══════════════════ */}
      {activeTab === 'registered' && (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <Search size={17} className="search-icon" />
              <input placeholder="ابحث بأي بيانات…" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
              {q && <X size={15} style={{ color: 'var(--gray-400)', cursor: 'pointer', flexShrink: 0 }} onClick={() => { setQ(''); setPage(1) }} />}
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => exportProfilesToWorkbook({ rows: visible, mode: 'registered' })}
              disabled={exportingTarget === 'registered' || visible.length === 0}
            >
              <Download size={15} />
              {exportingTarget === 'registered' ? 'جارٍ التصدير…' : 'تنزيل Excel'}
            </button>
            <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(s => !s)}>
              <ChevronDown size={15} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              فلترة
              {hasAnyFilter && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', marginRight: 2 }} />}
            </button>
            {hasAnyFilter && <button className="btn btn-ghost btn-sm" onClick={clearAll}><X size={14} /> مسح الكل</button>}
          </div>

          {/* Filter panel */}
          {showFilters && (
            <FilterPanel
              groups={FILTER_GROUPS}
              opts={cascadedOpts}
              filterState={filterState}
              onUpdate={updateFilter}
            />
          )}

          {/* Count */}
          <div style={{ fontSize: '0.83rem', color: 'var(--gray-500)', marginBottom: 10 }}>
            عرض <strong>{visible.length.toLocaleString('ar-EG')}</strong> من أصل {activePersons.length.toLocaleString('ar-EG')} عضو
            {hasAnyFilter && <span style={{ color: 'var(--gold)', fontWeight: 600, marginRight: 6 }}>(مفلتر)</span>}
          </div>

          {/* List */}
          <div className="card" style={{ overflow: 'hidden' }}>
            {registeredLoadError ? (
              <ErrorState
                title="تعذر تحميل الأعضاء المسجّلين"
                description={registeredLoadError}
                onRetry={retryLoad}
                minHeight={240}
              />
            ) : pageRows.length === 0 ? (
              <div className="empty-state"><Search size={48} /><p>لا توجد نتائج مطابقة</p></div>
            ) : pageRows.map(p => {
              const name = getDisplayName(p)
              return (
                <div key={p.person_id} className="member-row" onClick={() => onSelectPerson(p.person_id)}>
                  <Avatar name={name} photoUrl={p._photo} />
                  <div className="member-info">
                    <div className="member-name">{name}</div>
                    <div className="member-meta">{buildMemberMeta(p)}</div>
                  </div>
                  {!isRestricted && (
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="أرشفة"
                        onClick={e => handleArchivePerson(e, p)}
                        style={{ padding: '4px 8px', color: 'var(--gray-500)' }}
                      >
                        <Archive size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" title="حذف نهائي" onClick={e => handleDeletePerson(e, p)}
                        style={{ padding: '4px 8px', color: 'var(--red)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                  <ChevronLeft size={16} style={{ color: 'var(--gray-300)', flexShrink: 0 }} />
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}><ChevronRight size={16} /></button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const pg = totalPages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= totalPages - 3 ? totalPages - 6 + i : page - 3 + i
                return <button key={pg} className={`page-btn${page === pg ? ' active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>
              })}
              <button className="page-btn" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}><ChevronLeft size={16} /></button>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ UNREGISTERED TAB ═══════════════════ */}
      {activeTab === 'unregistered' && (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <Search size={17} className="search-icon" />
              <input placeholder="ابحث بأي بيانات…" value={uq} onChange={e => { setUq(e.target.value); setUPage(1) }} />
              {uq && <X size={15} style={{ color: 'var(--gray-400)', cursor: 'pointer', flexShrink: 0 }} onClick={() => { setUq(''); setUPage(1) }} />}
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => exportProfilesToWorkbook({ rows: visibleUnreg, mode: 'unregistered' })}
              disabled={exportingTarget === 'unregistered' || visibleUnreg.length === 0}
            >
              <Download size={15} />
              {exportingTarget === 'unregistered' ? 'جارٍ التصدير…' : 'تنزيل Excel'}
            </button>
            <button className={`btn ${showUFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowUFilters(s => !s)}>
              <ChevronDown size={15} style={{ transform: showUFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              فلترة
              {hasAnyUFilter && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', marginRight: 2 }} />}
            </button>
            {hasAnyUFilter && <button className="btn btn-ghost btn-sm" onClick={clearUAll}><X size={14} /> مسح الكل</button>}
          </div>

          {/* Filter panel */}
          {showUFilters && (
            <FilterPanel
              groups={FILTER_GROUPS}
              opts={uCascadedOpts}
              filterState={uFilterState}
              onUpdate={updateUFilter}
            />
          )}

          {/* Count */}
          <div style={{ fontSize: '0.83rem', color: 'var(--gray-500)', marginBottom: 10 }}>
            عرض <strong>{visibleUnreg.length.toLocaleString('ar-EG')}</strong> من أصل {activeUnreg.length.toLocaleString('ar-EG')} شخص غير مسجّل
            {hasAnyUFilter && <span style={{ color: 'var(--gold)', fontWeight: 600, marginRight: 6 }}>(مفلتر)</span>}
          </div>

          {/* List */}
          <div className="card" style={{ overflow: 'hidden' }}>
            {unregLoading ? (
              <div className="loading-center" style={{ minHeight: 180 }}><div className="spinner" /></div>
            ) : unregisteredLoadError ? (
              <ErrorState
                title="تعذر تحميل غير المسجّلين"
                description={unregisteredLoadError}
                onRetry={retryLoad}
                minHeight={240}
              />
            ) : uPageRows.length === 0 ? (
              <div className="empty-state"><Search size={48} /><p>لا توجد نتائج مطابقة</p></div>
            ) : uPageRows.map(r => {
              const name = getDisplayName(r)
              return (
                <div key={r.person_id} className="member-row" onClick={() => onSelectUnregistered?.(r.person_id)} style={{ cursor: 'pointer' }}>
                  <Avatar name={name} photoUrl={r._photo} />
                  <div className="member-info">
                    <div className="member-name">{name || 'بدون اسم'}</div>
                    <div className="member-meta">{buildMemberMeta(r)}</div>
                  </div>
                  {!isRestricted && (
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" title="أرشفة" onClick={e => handleArchiveUnreg(e, r)}
                        style={{ padding: '4px 8px', color: 'var(--gray-500)' }}>
                        <Archive size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" title="حذف" onClick={e => handleDeleteUnreg(e, r)}
                        style={{ padding: '4px 8px', color: 'var(--red)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                  <ChevronLeft size={16} style={{ color: 'var(--gray-300)', flexShrink: 0 }} />
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {uTotalPages > 1 && (
            <div className="pagination">
              <button className="page-btn" onClick={() => setUPage(p => p - 1)} disabled={uPage === 1}><ChevronRight size={16} /></button>
              {Array.from({ length: Math.min(uTotalPages, 7) }, (_, i) => {
                const pg = uTotalPages <= 7 ? i + 1 : uPage <= 4 ? i + 1 : uPage >= uTotalPages - 3 ? uTotalPages - 6 + i : uPage - 3 + i
                return <button key={pg} className={`page-btn${uPage === pg ? ' active' : ''}`} onClick={() => setUPage(pg)}>{pg}</button>
              })}
              <button className="page-btn" onClick={() => setUPage(p => p + 1)} disabled={uPage === uTotalPages}><ChevronLeft size={16} /></button>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ ARCHIVED TAB ═══════════════════ */}
      {activeTab === 'archived' && (
        <>
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <Search size={17} className="search-icon" />
              <input placeholder="ابحث بأي بيانات…" value={archiveQ} onChange={e => setArchiveQ(e.target.value)} />
              {archiveQ && <X size={15} style={{ color: 'var(--gray-400)', cursor: 'pointer', flexShrink: 0 }} onClick={() => setArchiveQ('')} />}
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => exportProfilesToWorkbook({ rows: visibleArchived, mode: 'archived' })}
              disabled={exportingTarget === 'archived' || visibleArchived.length === 0}
            >
              <Download size={15} />
              {exportingTarget === 'archived' ? 'جارٍ التصدير…' : 'تنزيل Excel'}
            </button>
            <button className={`btn ${showArchiveFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowArchiveFilters(s => !s)}>
              <ChevronDown size={15} style={{ transform: showArchiveFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              فلترة
              {hasAnyArchiveFilter && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', marginRight: 2 }} />}
            </button>
            {hasAnyArchiveFilter && <button className="btn btn-ghost btn-sm" onClick={clearArchiveAll}><X size={14} /> مسح الكل</button>}
          </div>

          {/* Filter panel */}
          {showArchiveFilters && (
            <FilterPanel
              groups={FILTER_GROUPS}
              opts={cascadedArchiveOpts}
              filterState={archiveFilterState}
              onUpdate={updateArchiveFilter}
            />
          )}

          {/* Count */}
          <div style={{ fontSize: '0.83rem', color: 'var(--gray-500)', marginBottom: 10 }}>
            <Archive size={13} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
            عرض <strong>{visibleArchived.length.toLocaleString('ar-EG')}</strong> من أصل {archivedAll.length.toLocaleString('ar-EG')} في الأرشيف
            {hasAnyArchiveFilter && <span style={{ color: 'var(--gold)', fontWeight: 600, marginRight: 6 }}>(مفلتر)</span>}
          </div>

          {archivedLoadError ? (
            <div className="card">
              <ErrorState
                title="تعذر تحميل بيانات الأرشيف"
                description="تعذر تحميل بعض البيانات اللازمة لعرض الأرشيف. حاول إعادة المحاولة."
                onRetry={retryLoad}
                minHeight={240}
              />
            </div>
          ) : visibleArchived.length === 0 ? (
            <div className="card">
              <div className="empty-state"><Archive size={48} /><p>لا توجد سجلات مؤرشفة</p></div>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {visibleArchived.map(r => {
                const name   = getDisplayName(r)
                const isReg  = r._isReg
                const ptype  = isReg ? 'registered' : 'unregistered'
                return (
                  <div key={`${ptype}-${r.person_id}`} className="member-row"
                    onClick={() => isReg ? onSelectPerson(r.person_id) : onSelectUnregistered?.(r.person_id)}
                    style={{ opacity: 0.75 }}>
                    <Avatar name={name} photoUrl={r._photo} />
                    <div className="member-info">
                      <div className="member-name">{name || 'بدون اسم'}</div>
                      <div className="member-meta">
                        {buildMemberMeta(r)}
                        <span style={{ marginRight: 8, background: 'var(--gray-200)', color: 'var(--gray-600)', borderRadius: 10, fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px' }}>
                          {isReg ? 'مسجّل' : 'غير مسجّل'}
                        </span>
                      </div>
                    </div>
                    {!isRestricted && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-sm" title="استعادة من الأرشيف"
                          onClick={e => { e.stopPropagation(); isReg ? handleUnarchivePerson(e, r) : handleUnarchiveUnreg(e, r) }}
                          style={{ padding: '4px 8px', color: 'var(--green)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ArchiveRestore size={14} /> استعادة
                        </button>
                        <button className="btn btn-ghost btn-sm" title="حذف نهائي"
                          onClick={e => { e.stopPropagation(); isReg ? handleDeletePerson(e, r) : handleDeleteUnreg(e, r) }}
                          style={{ padding: '4px 8px', color: 'var(--red)' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    <ChevronLeft size={16} style={{ color: 'var(--gray-300)', flexShrink: 0 }} />
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
