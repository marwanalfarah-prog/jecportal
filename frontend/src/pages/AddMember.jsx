import { useState, useEffect, useRef } from 'react'
import { X, UserPlus, ChevronRight, ChevronLeft, Check, AlertCircle, MapPin, Pencil } from 'lucide-react'
import { api, getApiErrorMessage } from '../api.js'
import { buildGoogleMapsOpenUrl, parseGoogleMapsUrl, sanitizeStoredCoordinate } from '../location.js'

// Strip non-Arabic characters — allows Arabic letters, diacritics, tatweel, spaces, and common Arabic punctuation
function stripToArabic(str) {
  // Keep: Arabic block (\u0600-\u06FF), Arabic Extended (\u0750-\u077F),
  //        Arabic Presentation Forms (\uFB50-\uFDFF, \uFE70-\uFEFF),
  //        spaces and common punctuation (hyphen, apostrophe/hamza variants)
  return str.replace(/[^\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s\-']/g, '')
}

// Normalize Arabic text: collapse multiple spaces, trim
function normalizeAr(str) {
  return stripToArabic(str).replace(/\s+/g, ' ').trim()
}

function normalizeEn(str) {
  return String(str || '').replace(/\s+/g, ' ').trim()
}

function normalizeLoose(str) {
  return String(str || '').replace(/\s+/g, ' ').trim()
}

function preserveLooseInput(str) {
  return String(str ?? '')
}

function normalizeSchoolLookupKey(value) {
  return normalizeLoose(value).replace(/[أإآ]/g, 'ا').toLowerCase()
}

function normalizeSchoolBranches(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  const entries = Array.isArray(raw)
    ? raw.map((row) => [row?.school, row?.branches])
    : Object.entries(raw)

  for (const [schoolRaw, branchesRaw] of entries) {
    const school = normalizeLoose(schoolRaw)
    if (!school) continue

    const source = Array.isArray(branchesRaw) ? branchesRaw : (typeof branchesRaw === 'string' ? [branchesRaw] : [])
    const seen = new Set()
    const branches = []
    for (const branchRaw of source) {
      const branch = normalizeLoose(branchRaw)
      if (!branch || seen.has(branch)) continue
      seen.add(branch)
      branches.push(branch)
    }

    out[school] = branches
  }

  return out
}

function schoolBranchesForName(schoolBranches, schoolName) {
  const school = normalizeLoose(schoolName)
  if (!school) return []
  const lookupKey = normalizeSchoolLookupKey(school)
  const entry = Object.entries(normalizeSchoolBranches(schoolBranches)).find(([name]) => normalizeSchoolLookupKey(name) === lookupKey)
  return entry ? entry[1] : []
}

function normalizeSchoolGradeValue(value) {
  return normalizeLoose(value)
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

function sanitizeDateInput(value) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeCountryValue(str) {
  const text = normalizeLoose(str)
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

const NATIONALITY_JORDANIAN = 'أردنيّة'
const NATIONALITY_CHILDREN_OF_JORDANIAN_MOTHERS = 'أبناء الأردنيّات'

function normalizeNationalityValue(value) {
  return normalizeLoose(value)
}

function normalizeNationalityLookupKey(value) {
  return normalizeNationalityValue(value).replace(/[أإآ]/g, 'ا').toLowerCase()
}

function isJordanianNationality(value) {
  return normalizeNationalityLookupKey(value) === normalizeNationalityLookupKey(NATIONALITY_JORDANIAN)
}

function isChildrenOfJordanianMothersNationality(value) {
  return normalizeNationalityLookupKey(value) === normalizeNationalityLookupKey(NATIONALITY_CHILDREN_OF_JORDANIAN_MOTHERS)
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

    normalized.push({ nationality })
  }

  return dropEmpty ? normalized.filter((row) => row.nationality) : normalized
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
  return []
}


// ─────────────────────────────────────────────────────────────────
// Static data  (mirrors Google Form exactly)
// ─────────────────────────────────────────────────────────────────
const GENDER_OPTIONS = ['ذكر', 'أنثى']

const NATIONALITIES = ['أردنيّة', 'أبناء الأردنيّات', 'عراقيّة', 'سوريّة', 'مصريّة']

const AGE_GROUPS = ['العاملة', 'الجامعيّة', 'الثانوي', 'الإعدادي', 'البراعم']

const SCHOOL_OPTIONS = [
  'مدرسة حكوميّة','البطريركيّة اللاتينيّة','راهبات الورديّة',
  'راهبات الفرنسيسكان','كليّة سيّدة الناصرة','كليّة تراسانطة',
  'كليّة دي لاسال - الفرير','الروم الكاثوليك','الأورثوذكسيّة',
  'المطران للبنين','الأهليّة للبنات','المعمدانيّة',
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
  const text = normalizeLoose(value)
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

const UNIVERSITY_OPTIONS = [
  'لم أدرس في الجامعة أو الكليّة',
  'الجامعة الأردنيّة','جامعة اليرموك','جامعة مؤتة',
  'جامعة العلوم والتكنولوجيا الأردنيّة','جامعة آل البيت',
  'الجامعة الهاشميّة','جامعة البلقاء التطبيقيّة',
  'جامعة الحسين بن طلال','جامعة الطفيلة التقنيّة',
  'الجامعة الألمانيّة الأردنيّة','الجامعة الأردنيّة - فرع العقبة',
  'جامعة عمان الأهليّة','جامعة فيلادلفيا',
  'جامعة الأميرة سميّة للتكنولوجيا','جامعة الإسراء','جامعة البترا',
  'جامعة العلوم التطبيقيّة الخاصة','جامعة جرش',
  'جامعة الزيتونة الأردنيّة','جامعة الزرقاء','جامعة إربد الأهليّة',
  'جامعة عمان العربيّة','الجامعة العربيّة المفتوحة - فرع الأردن',
  'الجامعة الأمريكيّة في مادبا','جامعة جدارا','جامعة الشّرق الأوسط',
  'جامعة عجلون الوطنيّة','جامعة العقبة للتكنولوجيا',
  'جامعة الحسين التقنيّة','كلية عمون الجامعيّة التطبيقيّة',
  'الأكاديميّة الأردنيّة للموسيقى',
]

const HOBBIES_SCHOOL = [
  'العزف','الترتيل','الرياضة','التمثيل','تأدية حركات التراتيل',
  'الرسم','القراءة','أشغال يدويّة','الدبكة والرقصات الفولكلوريّة','الغناء',
]

const HOBBIES_ADULT = [
  'العزف','الغناء','الترتيل','الرياضة','التصوير الفوتوغرافي',
  'التصميم الجرافيكي','التمثيل','الإخراج (السينمائي/ المسرحي)',
  'تصوير فيديو','كتابة نصوص','التصميم الداخلي/ ديكور','مونتاج فيديو',
  'رسوم متحركة Animation','الرسم','القراءة','مهارات التواصل',
  'مهارات إداريّة','مهارات العمل الجماعي','مهارات التخطيط',
  'تحضير الألعاب','التنظيم لأعمال تطوعيّة',
  'أجهزة الصوت (صوتيّات ومِكسرات)','أشغال يدويّة',
  'الدبكة والرقصات الفولكلوريّة','تأدية حركات التراتيل',
]

const RESP_OPTIONS = ['لا','نعم']
const RESP_CURRENT_OPTIONS = ['حاليًّا', 'سابقًا']

const YOUTH_SCHOOL_GROUPS = ['البراعم','الإعدادي','الثانوي']
const ADULT_GROUPS        = ['الجامعيّة','العاملة']

const MONTHS_DATA = [
  {en:'Jan',ar:'كانون الثاني',num:1},{en:'Feb',ar:'شباط',num:2},
  {en:'Mar',ar:'آذار',num:3},{en:'Apr',ar:'نيسان',num:4},
  {en:'May',ar:'أيار',num:5},{en:'Jun',ar:'حزيران',num:6},
  {en:'Jul',ar:'تموز',num:7},{en:'Aug',ar:'آب',num:8},
  {en:'Sep',ar:'أيلول',num:9},{en:'Oct',ar:'تشرين الأول',num:10},
  {en:'Nov',ar:'تشرين الثاني',num:11},{en:'Dec',ar:'كانون الأول',num:12},
]

const DEFAULT_ADDRESS = { country: 'الأردن', governorate: '', city: '', address: '', location_url: '', lat: null, lng: null, is_primary: true }

// ─────────────────────────────────────────────────────────────────
// Small reusable input atoms
// ─────────────────────────────────────────────────────────────────

/** Single-choice radio card list */
function RadioList({ options, value, onChange }) {
  return (
    <div className="am-option-list">
      {options.map(o => (
        <button key={o} type="button"
          className={'am-option-item' + (value === o ? ' am-selected' : '')}
          onClick={() => onChange(o)}>
          <span className={'am-radio-circle' + (value === o ? ' am-selected' : '')} />
          {o}
        </button>
      ))}
    </div>
  )
}

/** Multi-choice checkbox card list + "Other:" free text at bottom */
function CheckList({ options, selected, onChange, otherVal, onOtherChange }) {
  const toggle = o =>
    onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])

  return (
    <div className="am-option-list am-checklist">
      {options.map(o => (
        <button key={o} type="button"
          className={'am-option-item' + (selected.includes(o) ? ' am-selected' : '')}
          onClick={() => toggle(o)}>
          <span className={'am-check-box' + (selected.includes(o) ? ' am-selected' : '')}>
            {selected.includes(o) && <Check size={11} strokeWidth={3} />}
          </span>
          {o}
        </button>
      ))}
      {/* Other row */}
      <div className="am-option-item am-other-item">
        <span className={'am-check-box' + (otherVal ? ' am-selected' : '')}>
          {otherVal && <Check size={11} strokeWidth={3} />}
        </span>
        <span className="am-other-label">أخرى:</span>
        <input className="am-other-input" placeholder="اكتب هنا…"
          value={otherVal || ''}
          onChange={e => onOtherChange(e.target.value)} />
      </div>
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
    <div className="am-option-list am-checklist">
      {options.map((option) => {
        const active = selectedSet.has(option)
        return (
          <button key={option} type="button"
            className={'am-option-item' + (active ? ' am-selected' : '')}
            onClick={() => toggle(option)}>
            <span className={'am-check-box' + (active ? ' am-selected' : '')}>
              {active && <Check size={11} strokeWidth={3} />}
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
      <button type="button" className="am-select-trigger" onClick={() => setOpen((current) => !current)}>
        <span className={'am-select-value' + (!normalizedSelected.length ? ' am-placeholder' : '')}>{summary}</span>
        <ChevronLeft size={15} className={'am-chevron' + (open ? ' am-open' : '')} />
      </button>
      {open && (
        <div className="am-dropdown">
          <div className="am-dropdown-list" style={{ maxHeight: 260 }}>
            {options.map((option) => {
              const active = selectedSet.has(option)
              return (
                <button
                  key={option}
                  type="button"
                  className={'am-dropdown-item' + (active ? ' am-selected' : '')}
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

/** Searchable dropdown + optional "Other / free text" entry */
function SearchSelect({ value, onChange, options, placeholder = 'اختر…', allowOther = true }) {
  const [open,   setOpen]  = useState(false)
  const [query,  setQuery] = useState('')
  const [custom, setCust]  = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getOptVal = (o) => (typeof o === 'object' ? o.value : o)
  const getOptLbl = (o) => (typeof o === 'object' ? (o.label || o.value) : o)
  const known    = options.some(o => getOptVal(o) === value)
  const currentLabel = options.find(o => getOptVal(o) === value)
  const filtered = options.filter(o => getOptLbl(o).toLowerCase().includes(query.toLowerCase()))
  const pick     = v => { onChange(v); setOpen(false); setQuery(''); setCust(false) }

  // free-text mode (unknown value or custom triggered)
  if (custom || (value && !known)) {
    return (
      <div className="am-custom-row">
        <input autoFocus className="form-control am-custom-input"
          value={value || ''} placeholder="اكتب قيمة…"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setCust(false); onChange('') } }} />
        <button type="button" className="btn btn-ghost btn-sm"
          title="إلغاء"
          onClick={() => { setCust(false); onChange('') }}>✕</button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="am-select-trigger"
        onClick={() => { setOpen(o => !o); setQuery('') }}>
        <span className={'am-select-value' + (!value ? ' am-placeholder' : '')}>
          {(currentLabel ? getOptLbl(currentLabel) : value) || placeholder}
        </span>
        <ChevronLeft size={15} className={'am-chevron' + (open ? ' am-open' : '')} />
      </button>

      {open && (
        <div className="am-dropdown">
          <input autoFocus className="am-dropdown-search" placeholder="بحث…"
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.stopPropagation()} />
          <div className="am-dropdown-list">
            {filtered.length === 0
              ? <div className="am-dropdown-empty">لا توجد نتائج</div>
                  : filtered.map(o => (
                    <button key={String(getOptVal(o))} type="button"
                  className={'am-dropdown-item' + (value === getOptVal(o) ? ' am-selected' : '')}
                  onClick={() => pick(getOptVal(o))}>{getOptLbl(o)}</button>
                ))
            }
            {allowOther && (
              <button type="button" className="am-dropdown-item am-dropdown-other"
                onClick={() => { setOpen(false); setQuery(''); setCust(true); onChange('') }}>
                ＋ أخرى / اكتب يدوياً…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Year dropdown */
function YearSelect({ value, onChange, fromYear = 1960, placeholder = 'اختر السنة…' }) {
  const cur = new Date().getFullYear()
  const years = []
  for (let y = cur; y >= fromYear; y--) years.push(y)
  return (
    <select className="form-control" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
    </select>
  )
}

/** Birth-date picker — stores as (birth_day, birth_month[number]) */
function BirthDatePicker({ day, month, onDayChange, onMonthChange }) {
  const currentMonth = month ? String(month) : ''
  const currentDay = day ? String(day) : ''
  const daysInMonth = currentMonth ? new Date(2000, parseInt(currentMonth, 10), 0).getDate() : 31

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1 }}>
        <select className="form-control" value={currentMonth}
          onChange={e => onMonthChange(e.target.value)}>
          <option value="">الشهر</option>
          {MONTHS_DATA.map(m => (
            <option key={m.num} value={String(m.num)}>{m.ar} - {m.num}</option>
          ))}
        </select>
      </div>
      <div style={{ width: 110 }}>
        <select className="form-control" value={currentDay}
          onChange={e => onDayChange(e.target.value)}>
          <option value="">اليوم</option>
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
            <option key={d} value={String(d)}>{d}</option>
          ))}
        </select>
      </div>
    </div>
  )
}





/** Unified nationalities picker — tags for all selected nationalities + dropdown to add more */
function NationalitiesPicker({ values, onChange, knownOptions }) {
  const [open,    setOpen]    = useState(false)
  const [custom,  setCustom]  = useState(false)
  const [query,   setQuery]   = useState('')
  const [freeVal, setFreeVal] = useState('')
  const [message, setMessage] = useState('')
  const ref = useRef(null)
  const rows = normalizeNationalityRows(values)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const commit = (nextRows) => onChange(normalizeNationalityRows(nextRows))

  const add = (val) => {
    const nationality = normalizeNationalityValue(val)
    const error = getNationalitySelectionError(rows, nationality)
    if (error) {
      setMessage(error)
      return
    }

    commit([...rows, { nationality }])
    setMessage('')
    setOpen(false); setQuery(''); setFreeVal(''); setCustom(false)
  }
  const remove = (idx) => { setMessage(''); commit(rows.filter((_, i) => i !== idx)) }
  const updateRow = (idx, key, value) => commit(rows.map((row, i) => (
    i === idx ? { ...row, [key]: value } : row
  )))

  const available = Array.from(new Map(
    knownOptions
      .map(option => {
        const value = normalizeNationalityValue(option)
        return value ? [normalizeNationalityLookupKey(value), value] : null
      })
      .filter(Boolean)
  ).values()).filter(option => !getNationalitySelectionError(rows, option))
  const filtered  = available.filter(o => o.toLowerCase().includes(query.toLowerCase()))
  const conflictHint = rows.some(row => isJordanianNationality(row.nationality))
    ? 'لا يمكن اختيار أبناء الأردنيّات مع الجنسية الأردنيّة.'
    : rows.some(row => isChildrenOfJordanianMothersNationality(row.nationality))
      ? 'لا يمكن اختيار الجنسية الأردنيّة مع أبناء الأردنيّات.'
      : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((row, index) => (
        <div key={`${row.nationality}-${index}`} style={{ border: '1px solid var(--gray-200)', borderRadius: '16px', padding: '12px 14px', background: 'var(--gray-50)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{row.nationality}</div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--red, #dc2626)' }} onClick={() => remove(index)}>
              حذف
            </button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {nationalityIdentifierFields(row).map(field => (
              <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-500)' }}>{field.label}</span>
                <input
                  className="form-control"
                  value={row[field.key] || ''}
                  dir={field.dir}
                  inputMode={field.inputMode}
                  placeholder={field.hint}
                  onChange={e => updateRow(index, field.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* Add nationality button */}
      {!custom ? (
        <div ref={ref} style={{ position: 'relative' }}>
          <button type="button" className="am-select-trigger"
            style={rows.length > 0 ? { background: 'var(--gray-50)', borderStyle: 'dashed' } : {}}
            onClick={() => { setOpen(o => !o); setQuery(''); setMessage('') }}>
            <span className={'am-select-value' + (rows.length === 0 ? ' am-placeholder' : '')}>
              {rows.length === 0 ? 'اختر الجنسية…' : '＋ إضافة جنسية أخرى'}
            </span>
            <ChevronLeft size={15} className={'am-chevron' + (open ? ' am-open' : '')} />
          </button>

          {open && (
            <div className="am-dropdown">
              <input autoFocus className="am-dropdown-search" placeholder="بحث…"
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.stopPropagation()} />
              <div className="am-dropdown-list">
                {filtered.length === 0 && query
                  ? <div className="am-dropdown-empty">لا توجد نتائج</div>
                  : filtered.map(o => (
                      <button key={o} type="button" className="am-dropdown-item"
                        onClick={() => add(o)}>{o}</button>
                    ))
                }
                <button type="button" className="am-dropdown-item am-dropdown-other"
                  onClick={() => { setOpen(false); setQuery(''); setCustom(true) }}>
                  ＋ أخرى / اكتب يدوياً…
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="am-custom-row">
          <input autoFocus className="form-control am-other-free" lang="ar"
            placeholder="اكتب الجنسية…"
            value={freeVal}
            onChange={e => setFreeVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') add(freeVal)
              if (e.key === 'Escape') { setCustom(false); setFreeVal(''); setMessage('') }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => add(freeVal)}>إضافة</button>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => { setCustom(false); setFreeVal(''); setMessage('') }}>✕</button>
        </div>
      )}

      {conflictHint && <div className="am-field-hint" style={{ color: '#92400e' }}>{conflictHint}</div>}
      {message && <div className="am-field-error"><AlertCircle size={13} style={{ flexShrink: 0 }} /> {message}</div>}
    </div>
  )
}

function AddressEntriesField({ entries, onChange, governorateOptions = [], errors = {} }) {
  const rows = Array.isArray(entries) && entries.length ? entries : [{ ...DEFAULT_ADDRESS }]
  const [mapDrafts, setMapDrafts] = useState({})
  const [mapEditors, setMapEditors] = useState({})
  const [mapErrors, setMapErrors] = useState({})

  const setRows = (nextRows) => {
    const normalized = nextRows.length ? nextRows.map((row) => ({
      country: normalizeCountryValue(row.country),
      governorate: preserveLooseInput(row.governorate),
      city: preserveLooseInput(row.city),
      address: preserveLooseInput(row.address),
      location_url: String(row.location_url || '').trim(),
      lat: sanitizeStoredCoordinate(row.lat, 'lat'),
      lng: sanitizeStoredCoordinate(row.lng, 'lng'),
      is_primary: Boolean(row.is_primary),
    })) : [{ ...DEFAULT_ADDRESS }]

    const primaryIndex = normalized.findIndex(row => row.is_primary)
    normalized.forEach((row, index) => {
      row.is_primary = index === (primaryIndex >= 0 ? primaryIndex : 0)
    })
    onChange(normalized)
  }

  const updateRow = (index, key, value) => setRows(rows.map((row, rowIndex) => (
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
    setRows(rows.map((row, rowIndex) => (
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
    setRows(rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, location_url: '', lat: null, lng: null } : row
    )))
    openMapEditor(index)
  }

  const setPrimary = (index) => setRows(rows.map((row, rowIndex) => ({ ...row, is_primary: rowIndex === index })))

  const addRow = () => setRows([...rows, { ...DEFAULT_ADDRESS, is_primary: false }])

  const removeRow = (index) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index)
    if (!next.length) {
      onChange([{ ...DEFAULT_ADDRESS }])
      return
    }
    if (!next.some(row => row.is_primary)) next[0].is_primary = true
    setRows(next)
  }

  return (
    <div className="am-address-stack">
      {rows.map((row, index) => (
        <div key={index} className="am-address-card">
          <div className="am-address-card-header">
            <div>
              <div className="am-address-card-title">عنوان {index + 1}</div>
              <div className="am-address-card-subtitle">أدخل المحافظة ثم المدينة، ويمكنك إضافة العنوان التفصيلي وموقع المنزل عند الحاجة</div>
            </div>
            <div className="am-address-card-actions">
              {!row.is_primary && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrimary(index)}>
                  تعيين كرئيسي
                </button>
              )}
              {row.is_primary && (
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--green, #15803d)' }}>العنوان الرئيسي</span>
              )}
              {rows.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--red, #dc2626)' }}
                  onClick={() => removeRow(index)}>
                  حذف
                </button>
              )}
            </div>
          </div>

          <div className="am-address-grid">
            <div className="am-address-field">
              <div className="am-field-hint am-address-label">البلد</div>
              <input
                className="form-control"
                value={normalizeCountryValue(row.country)}
                onChange={e => updateRow(index, 'country', normalizeCountryValue(e.target.value))}
                placeholder="الأردن"
              />
            </div>

            <div className="am-address-field">
              <div className="am-field-hint am-address-label">المحافظة / الولاية</div>
              <SearchSelect
                value={row.governorate}
                onChange={value => updateRow(index, 'governorate', value)}
                options={governorateOptions}
                allowOther={true}
                placeholder="اختر أو اكتب المحافظة / الولاية…"
              />
              {errors[`address_governorate_${index}`] && <div className="am-field-error"><AlertCircle size={13} style={{ flexShrink: 0 }} /> {errors[`address_governorate_${index}`]}</div>}
            </div>

            <div className="am-address-field">
              <div className="am-field-hint am-address-label">المدينة</div>
              <input
                className="form-control"
                value={row.city || ''}
                onChange={e => updateRow(index, 'city', e.target.value)}
                placeholder="مثال: عمّان"
              />
            </div>

            <div className="am-address-field am-address-field-wide">
              <div className="am-field-hint am-address-label">العنوان التفصيلي</div>
              <input
                className="form-control"
                value={row.address || ''}
                onChange={e => updateRow(index, 'address', e.target.value)}
                placeholder="مثال: جبل الحسين، قرب الكنيسة اللاتينية، شارع 12"
              />
              {errors[`address_text_${index}`] && <div className="am-field-error"><AlertCircle size={13} style={{ flexShrink: 0 }} /> {errors[`address_text_${index}`]}</div>}
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

      <button type="button" className="am-select-trigger"
        style={{ borderStyle: 'dashed', background: 'var(--gray-50)' }}
        onClick={addRow}>
        <span className="am-select-value am-placeholder">＋ إضافة عنوان آخر</span>
      </button>
    </div>
  )
}

/** Form field wrapper — label, hint, children, error */
function Field({ label, required, hint, error, children }) {
  return (
    <div className="am-field">
      <div className="am-field-label">
        {label}
        {required && <span className="am-required">*</span>}
      </div>
      {hint && <div className="am-field-hint">{hint}</div>}
      <div className="am-field-control">{children}</div>
      {error && (
        <div className="am-field-error">
          <AlertCircle size={13} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}
    </div>
  )
}

/** Step progress bar */
function StepBar({ steps, current }) {
  return (
    <div className="am-stepbar">
      {steps.map((label, i) => (
        <div key={i} className="am-step-wrap">
          <div className={'am-step-dot' + (i < current ? ' done' : i === current ? ' active' : '')}>
            {i < current ? <Check size={13} strokeWidth={3} /> : i + 1}
          </div>
          <span className={'am-step-text' + (i === current ? ' active' : i < current ? ' done' : '')}>
            {label}
          </span>
          {i < steps.length - 1 && (
            <div className={'am-step-bar' + (i < current ? ' done' : '')} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Main modal
// ─────────────────────────────────────────────────────────────────
const BLANK = {
  // step 0
  ar_first_name: '', ar_second_name: '', ar_third_name: '', ar_last_name: '',
  en_first_name: '', en_second_name: '', en_third_name: '', en_last_name: '',
  mother_ar_first_name: '', mother_ar_second_name: '', mother_ar_last_name: '',
  mother_en_first_name: '', mother_en_second_name: '', mother_en_last_name: '',
  gender: '', birth_year: '', birth_day: '', birth_month: '',
  nationalities: [], mobile: '', addresses: [{ ...DEFAULT_ADDRESS }],
  // step 1
  youth_groups: [{ youth_group: '', join_year: '', age_group: '' }],
  // step 2 – school
  school: '', school_other: '', school_section: '', school_system: '', school_start_date: '', school_end_date: '', school_is_current: true, school_graduated: false, school_grades: [], hobbies_school: [], hobbies_school_other: '',
  // step 2 – adult
  university: '', university_other: '', major: '',
  job_title: '', company: '',
  has_resp: '', resp_text: '', resp_jec_year: '', resp_is_current: 'حاليًّا', resp_start_date: '', resp_end_date: '',
  hobbies_adult: [], hobbies_adult_other: '',
}

export default function AddMemberModal({ onClose, onAdded, toast, prefillName = '' }) {
  const [form,    setForm]    = useState(BLANK)
  const [step,    setStep]    = useState(0)
  const [errors,  setErrors]  = useState({})
  const [saving,  setSaving]  = useState(false)
  const [filters, setFilters] = useState({})
  const [schoolBranches, setSchoolBranches] = useState({})
  const bodyRef = useRef(null)

  useEffect(() => { api.filters().then(setFilters).catch(() => {}) }, [])
  useEffect(() => {
    let cancelled = false
    api.getConfig()
      .then((response) => {
        if (!cancelled) setSchoolBranches(normalizeSchoolBranches(response?.config?.school_branches || {}))
      })
      .catch(() => {
        if (!cancelled) setSchoolBranches({})
      })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!prefillName.trim()) return
    const pts = prefillName.trim().split(/\s+/)
    setForm(f => ({
      ...f,
      ar_first_name:  pts[0] || '',
      ar_second_name: pts[1] || '',
      ar_third_name:  pts.length >= 4 ? pts[2] : '',
      ar_last_name:   pts.length >= 4 ? pts.slice(3).join(' ')
                 : pts.length === 3 ? pts[2]
                 : pts.length === 2 ? pts[1] : '',
    }))
  }, [prefillName])

  const set    = (k, v)  => setForm(f => ({ ...f, [k]: v }))
  const dynOpt = k       => {
    const src = filters[k] || []
    if (k === 'youth_group') {
      return src
        .map(x => ({ value: x.value, label: api.formatYouthGroupLabel(x.label || x.value) }))
        .filter(x => x.value)
    }
    return src.map(x => x.value).filter(Boolean)
  }

  const primaryAgeGroup = form.youth_groups[0]?.age_group || ''
  const isSchool = YOUTH_SCHOOL_GROUPS.includes(primaryAgeGroup)
  const isAdult  = ADULT_GROUPS.includes(primaryAgeGroup)
  const selectedSchoolName = form.school === 'أخرى' ? normalizeLoose(form.school_other) : normalizeLoose(form.school)
  const selectedSchoolSections = schoolBranchesForName(schoolBranches, selectedSchoolName)
  const schoolSystemOptions = buildSchoolSystemOptions(dynOpt('school_system'), form.school_system)

  const STEP_LABELS = [
    'البيانات الشخصيّة',
    'معلومات الشبيبة',
    isSchool ? 'المدرسة والهوايات' : isAdult ? 'التعليم والعمل' : 'التفاصيل',
  ]

  useEffect(() => {
    if (!selectedSchoolSections.length) {
      if (form.school_section) set('school_section', '')
      return
    }
    if (form.school_section && !selectedSchoolSections.includes(form.school_section)) {
      set('school_section', '')
    }
  }, [selectedSchoolSections, form.school_section])

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [step])

  // ── validation ─────────────────────────────────────────────────
  const validate = s => {
    const e = {}
    if (s === 0) {
      const arabicOnly = /^[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s\-']+$/
      if (!form.ar_first_name.trim())                              e.ar_first_name  = 'هذا الحقل مطلوب'
      else if (!arabicOnly.test(form.ar_first_name.trim()))        e.ar_first_name  = 'يُسمح بالأحرف العربيّة فقط'
      if (!form.ar_second_name.trim())                             e.ar_second_name = 'هذا الحقل مطلوب'
      else if (!arabicOnly.test(form.ar_second_name.trim()))       e.ar_second_name = 'يُسمح بالأحرف العربيّة فقط'
      if (!form.ar_third_name.trim())                              e.ar_third_name  = 'هذا الحقل مطلوب'
      else if (!arabicOnly.test(form.ar_third_name.trim()))        e.ar_third_name  = 'يُسمح بالأحرف العربيّة فقط'
      if (!form.ar_last_name.trim())                               e.ar_last_name   = 'هذا الحقل مطلوب'
      else if (!arabicOnly.test(form.ar_last_name.trim()))         e.ar_last_name   = 'يُسمح بالأحرف العربيّة فقط'
      if (!form.gender)                                      e.gender      = 'هذا الحقل مطلوب'
      if (!form.birth_year)                                  e.birth_year  = 'هذا الحقل مطلوب'
      if (!form.birth_day || !form.birth_month)              e.birth_day   = 'هذا الحقل مطلوب'
      if (form.nationalities.length === 0)                   e.nationality = 'هذا الحقل مطلوب'
      if (!form.mobile.trim()) {
        e.mobile = 'هذا الحقل مطلوب'
      } else {
        const m = form.mobile.trim()
        const localJO  = /^07[789]\d{7}$/.test(m)   // 07X + 7 digits = 10 digits
        const intl     = /^00(?!962)\d+$/.test(m)    // 00... but not 00962
        if (!localJO && !intl) {
          e.mobile = 'رقم غير صحيح — يجب أن يكون رقمًا أردنيًّا (07X XXXXXXX) أو دوليًّا (00... بدون 00962)'
        }
      }
      if (!Array.isArray(form.addresses) || form.addresses.length === 0) {
        e.addresses = 'يرجى إدخال عنوان واحد على الأقل'
      } else {
        form.addresses.forEach((entry, index) => {
          if (!normalizeLoose(entry?.governorate)) e[`address_governorate_${index}`] = 'هذا الحقل مطلوب'
        })
        const primaryCount = form.addresses.filter(entry => entry?.is_primary).length
        if (primaryCount !== 1) e.addresses = 'يجب تحديد عنوان رئيسي واحد فقط'
      }
    }
    if (s === 1) {
      const yg = form.youth_groups
      if (!yg[0]?.youth_group)  e.youth_group_0 = 'هذا الحقل مطلوب'
      if (!yg[0]?.join_year)    e.join_year_0   = 'هذا الحقل مطلوب'
      if (!yg[0]?.age_group)    e.age_group_0   = 'هذا الحقل مطلوب'
      yg.slice(1).forEach((g, i) => {
        if (!g.youth_group)  e[`youth_group_${i+1}`] = 'هذا الحقل مطلوب'
        if (!g.join_year)    e[`join_year_${i+1}`]   = 'هذا الحقل مطلوب'
        if (!g.age_group)    e[`age_group_${i+1}`]   = 'هذا الحقل مطلوب'
      })
    }
    if (s === 2 && isSchool) {
      const sch = form.school === 'أخرى' ? form.school_other : form.school
      if (!sch.trim()) e.school = 'هذا الحقل مطلوب'
      const startDate = sanitizeDateInput(form.school_start_date)
      const endDate = sanitizeDateInput(form.school_end_date)
      if (startDate && endDate && endDate < startDate) e.school_end_date = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
      const h = [...form.hobbies_school, ...(form.hobbies_school_other.trim() ? [form.hobbies_school_other] : [])]
      if (!h.length)   e.hobbies = 'يرجى اختيار هواية واحدة على الأقل'
    }
    if (s === 2 && isAdult) {
      const uni = form.university === 'أخرى' ? form.university_other : form.university
      if (!uni.trim())                e.university  = 'هذا الحقل مطلوب'
      if (!form.job_title.trim())     e.job_title   = 'هذا الحقل مطلوب'
      if (!form.company.trim())       e.company     = 'هذا الحقل مطلوب'
      if (!form.has_resp)             e.has_resp    = 'هذا الحقل مطلوب'
      if (form.has_resp === 'نعم' && !form.resp_text.trim()) e.resp_text = 'هذا الحقل مطلوب'
      if (form.has_resp === 'نعم' && !/^\d{4}$/.test(String(form.resp_jec_year || '').trim())) e.resp_jec_year = 'أدخل سنة JEC صحيحة'
      const respStartDate = sanitizeDateInput(form.resp_start_date)
      const respEndDate = sanitizeDateInput(form.resp_end_date)
      if (respStartDate && respEndDate && respEndDate < respStartDate) e.resp_end_date = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
      const h = [...form.hobbies_adult, ...(form.hobbies_adult_other.trim() ? [form.hobbies_adult_other] : [])]
      if (!h.length)                  e.hobbies     = 'يرجى اختيار هواية واحدة على الأقل'
    }
    return e
  }

  const goNext = () => {
    const e = validate(step)
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({})
    setStep(s => s + 1)
  }
  const goBack = () => { setErrors({}); setStep(s => s - 1) }

  const handleCreateBlankProfile = async () => {
    setSaving(true)
    try {
      const res = await api.addPerson({ person: {} })
      toast('تم إنشاء ملف فارغ بنجاح ✓', 'success')
      onAdded(res.person_id)
    } catch (error) {
      toast(getApiErrorMessage(error, 'حدث خطأ أثناء إنشاء الملف الفارغ'), 'error')
    }
    setSaving(false)
  }

  // ── submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const e = validate(2)
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    try {
      const school      = form.school      === 'أخرى' ? form.school_other      : form.school
      const university  = form.university  === 'أخرى' ? form.university_other  : form.university
      const schoolSection = selectedSchoolSections.includes(form.school_section) ? form.school_section : ''
      const schoolStartDate = sanitizeDateInput(form.school_start_date)
      const schoolEndDate = form.school_is_current ? '' : sanitizeDateInput(form.school_end_date)
      const schoolGrades = normalizeSchoolGrades(form.school_grades)

      const hobbies = isSchool
        ? [...form.hobbies_school, ...(form.hobbies_school_other.trim() ? [form.hobbies_school_other.trim()] : [])]
        : [...form.hobbies_adult,  ...(form.hobbies_adult_other.trim()  ? [form.hobbies_adult_other.trim()]  : [])]

      const responsibilities = form.has_resp === 'نعم'
        ? form.youth_groups.map(g => ({
            youth_group_id: g.youth_group,
            responsibility: form.resp_text,
            jec_year: /^\d{4}$/.test(String(form.resp_jec_year || '').trim()) ? parseInt(form.resp_jec_year, 10) : null,
            is_current: form.resp_is_current === 'حاليًّا',
            start_date: sanitizeDateInput(form.resp_start_date) || null,
            end_date: sanitizeDateInput(form.resp_end_date) || null,
          })).filter(r => r.youth_group_id)
        : []

      const addresses = (Array.isArray(form.addresses) ? form.addresses : [])
        .map((entry, index) => ({
          country: normalizeCountryValue(entry.country),
          governorate: normalizeLoose(entry.governorate) || null,
          city: normalizeLoose(entry.city) || null,
          address: normalizeLoose(entry.address) || null,
          location_url: String(entry.location_url || '').trim() || null,
          lat: sanitizeStoredCoordinate(entry.lat, 'lat'),
          lng: sanitizeStoredCoordinate(entry.lng, 'lng'),
          is_primary: Boolean(entry.is_primary) || index === 0,
        }))
        .filter(entry => entry.governorate || entry.city || entry.address || entry.location_url || entry.lat != null || entry.lng != null)

      const body = {
        person: {
          ar_first_name:  normalizeAr(form.ar_first_name), ar_second_name: normalizeAr(form.ar_second_name) || null,
          ar_third_name:  normalizeAr(form.ar_third_name) || null, ar_last_name: normalizeAr(form.ar_last_name) || null,
          en_first_name: normalizeEn(form.en_first_name) || null,
          en_second_name: normalizeEn(form.en_second_name) || null,
          en_third_name: normalizeEn(form.en_third_name) || null,
          en_last_name: normalizeEn(form.en_last_name) || null,
          mother_ar_first_name: normalizeAr(form.mother_ar_first_name) || null,
          mother_ar_second_name: normalizeAr(form.mother_ar_second_name) || null,
          mother_ar_last_name: normalizeAr(form.mother_ar_last_name) || null,
          mother_en_first_name: normalizeEn(form.mother_en_first_name) || null,
          mother_en_second_name: normalizeEn(form.mother_en_second_name) || null,
          mother_en_last_name: normalizeEn(form.mother_en_last_name) || null,
          gender:      form.gender || null,
          birth_year:  form.birth_year ? parseInt(form.birth_year, 10) : null,
          birth_day:   form.birth_day ? parseInt(form.birth_day, 10) : null,
          birth_month: form.birth_month ? parseInt(form.birth_month, 10) : null,
          school_graduated: Boolean(form.school_graduated),
          school_system: storedSchoolSystemValue(form.school_system),
        },
        nationality:        normalizeNationalityRows(form.nationalities, { dropEmpty: true }).map(row => ({
          nationality: row.nationality,
        })),
        mobile_numbers:     form.mobile.trim() ? [{ mobile_number: form.mobile.trim(), type: 'personal', phone_calls_flag: true, whatsapp_flag: true }] : [],
        addresses,
        schools:            school ? [{
          school,
          section: schoolSection || null,
          start_date: schoolStartDate || null,
          end_date: schoolEndDate || null,
          is_current: Boolean(form.school_is_current) && !Boolean(form.school_graduated),
          grades_attended: serializeSchoolGrades(schoolGrades) || null,
        }] : [],
        person_youth_group: form.youth_groups.filter(g => g.youth_group).map(g => ({
          youth_group_id:   g.youth_group,
          youth_join_year:  g.join_year || null,
          age_group:        g.age_group || null,
          age_group_history: g.age_group ? [{ age_group: g.age_group, start_date: null, end_date: null }] : [],
        })),
        higher_education: (university && university !== 'لم أدرس في الجامعة أو الكليّة')
          ? [{ university_college: university, major: form.major.trim() || null, degree: null }]
          : [],
        jobs: (form.job_title.trim() && form.job_title.trim() !== 'لا يوجد')
          ? [{ job_title: form.job_title.trim(), company: form.company.trim() || null }]
          : [],
        responsibilities,
        hobbies_skills: hobbies.map(h => ({ hobby_skill: h })),
      }

      const res = await api.addPerson(body)
      toast('تمت إضافة العضو بنجاح ✓', 'success')
      onAdded(res.person_id)
    } catch (error) {
      toast(getApiErrorMessage(error, 'حدث خطأ أثناء الإضافة'), 'error')
    }
    setSaving(false)
  }

  // fallback governorate list if filters not loaded yet
  const govOpts = dynOpt('governorate').length
    ? dynOpt('governorate')
    : ['عمّان','الزرقاء','إربد','البلقاء','مادبا','الكرك','الطفيلة','معان','العقبة','جرش','عجلون','المفرق']

  // ── render ──────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal am-modal">

        {/* ── header ── */}
        <div className="modal-header">
          <span className="modal-title">
            <UserPlus size={17} style={{ display: 'inline', marginInlineEnd: 8 }} />
            إضافة عضو جديد
          </span>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        {/* ── step bar ── */}
        <div className="am-stepbar-wrap">
          <StepBar steps={STEP_LABELS} current={step} />
        </div>

        {/* ── scrollable body ── */}
        <div className="modal-body am-modal-body" ref={bodyRef}>

          {prefillName && (
            <div className="am-prefill-notice">
              <UserPlus size={14} />
              تم تعبئة الاسم تلقائياً من الهيكل التنظيمي — يرجى مراجعة البيانات وإكمالها
            </div>
          )}

          {step === 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                marginBottom: 14,
                borderRadius: 12,
                border: '1px solid rgba(15,39,68,0.1)',
                background: 'rgba(15,39,68,0.04)',
              }}
            >
              <div style={{ display: 'grid', gap: 3 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.88rem' }}>بدء ملف فارغ</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.78rem' }}>أنشئ الملف الآن وابدأ تعبئة البيانات مباشرة من صفحة الملف الشخصي.</div>
              </div>
              <button type="button" className="btn btn-ghost" onClick={handleCreateBlankProfile} disabled={saving}>
                <Pencil size={14} />
                {saving ? 'جارٍ الإنشاء…' : 'إنشاء ملف فارغ'}
              </button>
            </div>
          )}

          {/* ════════════ STEP 0: Personal info ════════════ */}
          {step === 0 && <>
            <div className="am-form-intro">
              أعزائنا أعضاء شبيبة الأردن، نرجو منكم تعبئة البيانات الشخصيّة.
            </div>

            <div className="am-field-hint" style={{ marginBottom: 8, fontStyle: 'italic', color: 'var(--gray-500)', fontSize: '0.82rem' }}>
              مثال: جورج ميشيل نجيب حنّا
            </div>
            <Field label="الاسم الأول" required error={errors.ar_first_name}>
              <input className="form-control" value={form.ar_first_name} lang="ar"
                onChange={e => set('ar_first_name', stripToArabic(e.target.value))}
                placeholder="مثال: جورج" />
            </Field>
            <Field label="الاسم الثاني" required error={errors.ar_second_name}>
              <input className="form-control" value={form.ar_second_name} lang="ar"
                onChange={e => set('ar_second_name', stripToArabic(e.target.value))}
                placeholder="مثال: ميشيل" />
            </Field>
            <Field label="الاسم الثالث" required error={errors.ar_third_name}>
              <input className="form-control" value={form.ar_third_name} lang="ar"
                onChange={e => set('ar_third_name', stripToArabic(e.target.value))}
                placeholder="مثال: نجيب" />
            </Field>
            <Field label="اسم العائلة" required error={errors.ar_last_name}>
              <input className="form-control" value={form.ar_last_name} lang="ar"
                onChange={e => set('ar_last_name', stripToArabic(e.target.value))}
                placeholder="مثال: حنّا" />
            </Field>

            <div className="am-field-hint" style={{ marginBottom: 8, fontStyle: 'italic', color: 'var(--gray-500)', fontSize: '0.82rem', direction: 'ltr', textAlign: 'left' }}>
              English name is optional
            </div>
            <Field label="English First Name">
              <input className="form-control" value={form.en_first_name} dir="ltr"
                onChange={e => set('en_first_name', e.target.value)}
                placeholder="Example: George" />
            </Field>
            <Field label="English Second Name">
              <input className="form-control" value={form.en_second_name} dir="ltr"
                onChange={e => set('en_second_name', e.target.value)}
                placeholder="Example: Michel" />
            </Field>
            <Field label="English Third Name">
              <input className="form-control" value={form.en_third_name} dir="ltr"
                onChange={e => set('en_third_name', e.target.value)}
                placeholder="Example: Najib" />
            </Field>
            <Field label="English Last Name">
              <input className="form-control" value={form.en_last_name} dir="ltr"
                onChange={e => set('en_last_name', e.target.value)}
                placeholder="Example: Hanna" />
            </Field>

            <div className="am-field-hint" style={{ marginTop: 14, marginBottom: 8, fontStyle: 'italic', color: 'var(--gray-500)', fontSize: '0.82rem' }}>
              اسم الأم الأخير اختياري
            </div>
            <Field label="اسم الأم الأول">
              <input className="form-control" value={form.mother_ar_first_name} lang="ar"
                onChange={e => set('mother_ar_first_name', stripToArabic(e.target.value))}
                placeholder="مثال: ماري" />
            </Field>
            <Field label="اسم الأم الثاني">
              <input className="form-control" value={form.mother_ar_second_name} lang="ar"
                onChange={e => set('mother_ar_second_name', stripToArabic(e.target.value))}
                placeholder="مثال: مي" />
            </Field>
            <Field label="اسم عائلة الأم">
              <input className="form-control" value={form.mother_ar_last_name} lang="ar"
                onChange={e => set('mother_ar_last_name', stripToArabic(e.target.value))}
                placeholder="مثال: سليم" />
            </Field>

            <div className="am-field-hint" style={{ marginBottom: 8, fontStyle: 'italic', color: 'var(--gray-500)', fontSize: '0.82rem', direction: 'ltr', textAlign: 'left' }}>
              Mother's English last name is optional
            </div>
            <Field label="Mother's English First Name">
              <input className="form-control" value={form.mother_en_first_name} dir="ltr"
                onChange={e => set('mother_en_first_name', e.target.value)}
                placeholder="Example: Mary" />
            </Field>
            <Field label="Mother's English Second Name">
              <input className="form-control" value={form.mother_en_second_name} dir="ltr"
                onChange={e => set('mother_en_second_name', e.target.value)}
                placeholder="Example: May" />
            </Field>
            <Field label="Mother's English Last Name">
              <input className="form-control" value={form.mother_en_last_name} dir="ltr"
                onChange={e => set('mother_en_last_name', e.target.value)}
                placeholder="Example: Salim" />
            </Field>

            <Field label="الجنس" required error={errors.gender}>
              <RadioList options={GENDER_OPTIONS} value={form.gender}
                onChange={v => set('gender', v)} />
            </Field>

            <Field label="سنة الميلاد" required error={errors.birth_year}
              hint="يرجى كتابة الأرقام باللغة الإنجليزية">
              <YearSelect value={form.birth_year} onChange={v => set('birth_year', v)} />
            </Field>

            <Field label="تاريخ الميلاد" required error={errors.birth_day}
              hint="يرجى الانتباه أن ترتيب خانات اليوم والشهر قد تختلف حسب نوع الموبايل">
              <BirthDatePicker
                day={form.birth_day}
                month={form.birth_month}
                onDayChange={v => set('birth_day', v)}
                onMonthChange={v => set('birth_month', v)}
              />
            </Field>

            <Field label="الجنسية" required error={errors.nationality}>
              <NationalitiesPicker
                values={form.nationalities}
                onChange={v => set('nationalities', v)}
                knownOptions={[...NATIONALITIES, ...dynOpt('nationality').filter(n => !NATIONALITIES.includes(n))]}
              />
            </Field>

            <Field label="رقم الموبايل" required error={errors.mobile}
              hint="أردني: 07X-XXXXXXX (10 أرقام) · دولي: 00... (بدون 00962) — أرقام فقط بدون مسافات أو رموز">
              <input className="form-control" type="tel" value={form.mobile}
                placeholder="07XXXXXXXX أو 00XXXXXXXXXXX"
                inputMode="numeric"
                onChange={e => {
                  // Strip anything that isn't a digit
                  const clean = e.target.value.replace(/[^\d]/g, '')
                  set('mobile', clean)
                }} />
            </Field>

            <Field label="العنوان / مكان الإقامة" required error={errors.addresses}
              hint="يمكنك إضافة أكثر من عنوان مع تحديد عنوان رئيسي واحد فقط">
              <AddressEntriesField
                entries={form.addresses}
                onChange={value => set('addresses', value)}
                governorateOptions={govOpts}
                errors={errors}
              />
            </Field>
          </>}

          {/* ════════════ STEP 1: Youth groups ════════════ */}
          {step === 1 && <>
            {form.youth_groups.map((yg, idx) => {
              const setYG = (k, v) => setForm(f => {
                const updated = f.youth_groups.map((g, i) => i === idx ? { ...g, [k]: v } : g)
                return { ...f, youth_groups: updated }
              })
              const removeYG = () => setForm(f => ({ ...f, youth_groups: f.youth_groups.filter((_, i) => i !== idx) }))
              return (
                <div key={idx} style={idx > 0 ? { borderTop: '2px solid var(--gray-200)', paddingTop: 16, marginTop: 8 } : {}}>
                  {idx > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--navy)' }}>شبيبة {idx + 1}</span>
                      <button type="button" className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--red, #dc2626)', fontSize: '0.78rem' }}
                        onClick={removeYG}>✕ حذف</button>
                    </div>
                  )}
                  <Field label="اسم الشبيبة" required error={errors[`youth_group_${idx}`]}>
                    <SearchSelect value={yg.youth_group} onChange={v => setYG('youth_group', v)}
                      options={dynOpt('youth_group')} allowOther={false} />
                  </Field>
                  <Field label="سنة الانتساب للشبيبة" required error={errors[`join_year_${idx}`]}>
                    <YearSelect value={yg.join_year} onChange={v => setYG('join_year', v)} fromYear={1964} />
                  </Field>
                  <Field label="الفئة حاليًّا" required error={errors[`age_group_${idx}`]}>
                    <RadioList options={AGE_GROUPS} value={yg.age_group}
                      onChange={v => setYG('age_group', v)} />
                  </Field>
                </div>
              )
            })}
            <button type="button" className="am-select-trigger"
              style={{ marginTop: 12, borderStyle: 'dashed', background: 'var(--gray-50)' }}
              onClick={() => setForm(f => ({ ...f, youth_groups: [...f.youth_groups, { youth_group: '', join_year: '', age_group: '' }] }))}>
              <span className="am-select-value am-placeholder">＋ إضافة شبيبة أخرى</span>
            </button>
          </>}

          {/* ════════════ STEP 2a: School age groups ════════════ */}
          {step === 2 && isSchool && <>
            <Field label="اختر المدرسة" required error={errors.school}
              hint="إن لم يكن اسم المدرسة موجودًا، يرجى كتابته بالمكان الفارغ">
              <RadioList
                options={[...SCHOOL_OPTIONS, 'أخرى']}
                value={form.school}
                onChange={v => {
                  set('school', v)
                  set('school_section', '')
                  if (v !== 'أخرى') set('school_other', '')
                }}
              />
              {form.school === 'أخرى' && (
                <input className="form-control am-other-free" autoFocus
                  placeholder="اكتب اسم المدرسة…"
                  value={form.school_other}
                  onChange={e => set('school_other', e.target.value)} />
              )}
            </Field>

            {selectedSchoolSections.length > 0 && (
              <Field label="القسم / الفرع" hint="يظهر هذا الحقل فقط إذا كانت للمدرسة أقسام محددة في صفحة الإعدادات">
                <SearchSelect
                  value={form.school_section}
                  onChange={v => set('school_section', v)}
                  options={selectedSchoolSections}
                  placeholder="اختر القسم…"
                  allowOther={false}
                />
              </Field>
            )}

            <Field label="نظام الدراسة" hint="هذا الحقل عام على مستوى المدارس كلها">
              <SearchSelect
                value={form.school_system}
                onChange={v => set('school_system', normalizeSchoolSystemValue(v))}
                options={schoolSystemOptions}
                placeholder="اختر نظام الدراسة…"
              />
            </Field>

            <Field label="تاريخ البداية" hint="تاريخ بدء الدراسة في هذه المدرسة">
              <input
                className="form-control"
                type="date"
                value={form.school_start_date}
                onChange={e => set('school_start_date', e.target.value)}
                dir="ltr"
              />
            </Field>

            <Field label="الحالة وتاريخ النهاية" error={errors.school_end_date} hint="إذا كان الطالب متخرجًا فلن تبقى أي مدرسة نشطة">
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', color: 'var(--navy)' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.school_is_current)}
                      disabled={Boolean(form.school_graduated)}
                      onChange={e => {
                        set('school_is_current', e.target.checked)
                        if (e.target.checked) set('school_end_date', '')
                      }}
                    />
                    حاليًّا
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', color: 'var(--navy)' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.school_graduated)}
                      onChange={e => {
                        set('school_graduated', e.target.checked)
                        if (e.target.checked) {
                          set('school_is_current', false)
                        }
                      }}
                    />
                    متخرّج من المدارس
                  </label>
                </div>
                {!form.school_is_current && (
                  <input
                    className="form-control"
                    type="date"
                    value={form.school_end_date}
                    onChange={e => set('school_end_date', e.target.value)}
                    dir="ltr"
                  />
                )}
                {form.school_graduated && <div style={{ fontSize: '0.78rem', color: 'var(--gray-400)' }}>لا يمكن وجود مدرسة نشطة بعد التخرّج، لكن يمكن حفظ تاريخ النهاية</div>}
              </div>
            </Field>

            <Field label="الصفوف التي دَرَسها في هذه المدرسة" hint="يمكن اختيار أكثر من صف">
              <CompactMultiSelect
                options={SCHOOL_GRADE_OPTIONS}
                selected={form.school_grades}
                onChange={v => set('school_grades', normalizeSchoolGrades(v))}
                placeholder="اختر الصفوف…"
              />
            </Field>

            <Field label="الهوايات والمهارات" required error={errors.hobbies}
              hint="يمكنك اختيار أكثر من هواية أو مهارة وفي حال عدم وجودها يرجى الكتابة في المكان الفارغ">
              <CheckList options={HOBBIES_SCHOOL}
                selected={form.hobbies_school}
                onChange={v => set('hobbies_school', v)}
                otherVal={form.hobbies_school_other}
                onOtherChange={v => set('hobbies_school_other', v)} />
            </Field>
          </>}

          {/* ════════════ STEP 2b: Adult age groups ════════════ */}
          {step === 2 && isAdult && <>
            <Field label="الجامعة / الكليّة" required error={errors.university}
              hint="إن لم يكن اسم الجامعة أو الكليّة مذكورًا، يرجى كتابة الاسم في المكان الفارغ">
              <SearchSelect value={form.university} onChange={v => set('university', v)}
                options={UNIVERSITY_OPTIONS} />
            </Field>

            {form.university && form.university !== 'لم أدرس في الجامعة أو الكليّة' && (
              <Field label="التخصّص" required error={errors.major} hint="باللغة العربيّة">
                <input className="form-control" value={form.major}
                  onChange={e => set('major', e.target.value)}
                  placeholder="مثال: هندسة حاسوب" />
              </Field>
            )}

            <Field label="الوظيفة" required error={errors.job_title}
              hint={'في حال كنت "عامل مياومة" يرجى كتابة ذلك\nكتابة "لا يوجد" في حال عدم وجود عمل'}>
              <input className="form-control" value={form.job_title}
                onChange={e => set('job_title', e.target.value)}
                placeholder="مثال: مهندس، طالب، لا يوجد…" />
            </Field>

            <Field label="الشركة / المؤسسة" required error={errors.company}
              hint='كتابة "لا يوجد" في حال عدم وجود عمل'>
              <input className="form-control" value={form.company}
                onChange={e => set('company', e.target.value)}
                placeholder="مثال: شركة X، جامعة Y، لا يوجد…" />
            </Field>

            <Field label="هل لديك أي مسؤوليات في الشبيبة؟"
              required error={errors.has_resp}
              hint="في حال كان الجواب نعم، يرجى تعبئة بيانات المسؤولية">
              <RadioList options={RESP_OPTIONS} value={form.has_resp}
                onChange={v => set('has_resp', v)} />
              {form.has_resp === 'نعم' && (
                <>
                  <input className="form-control am-other-free" autoFocus
                    placeholder="اكتب مسؤولياتك…"
                    value={form.resp_text}
                    onChange={e => set('resp_text', e.target.value)} />
                  {errors.resp_text ? <div className="am-field-error">{errors.resp_text}</div> : null}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 700 }}>سنة JEC</span>
                      <input className="form-control" inputMode="numeric" placeholder="2026"
                        value={form.resp_jec_year}
                        onChange={e => set('resp_jec_year', String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4))} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 700 }}>الحالة</span>
                      <select className="form-control" value={form.resp_is_current} onChange={e => set('resp_is_current', e.target.value)}>
                        {RESP_CURRENT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  </div>
                  {errors.resp_jec_year ? <div className="am-field-error">{errors.resp_jec_year}</div> : null}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 700 }}>تاريخ البداية</span>
                      <input className="form-control" type="date"
                        value={form.resp_start_date}
                        onChange={e => set('resp_start_date', sanitizeDateInput(e.target.value))} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 700 }}>تاريخ النهاية</span>
                      <input className="form-control" type="date"
                        value={form.resp_end_date}
                        onChange={e => set('resp_end_date', sanitizeDateInput(e.target.value))} />
                    </label>
                  </div>
                  {errors.resp_end_date ? <div className="am-field-error">{errors.resp_end_date}</div> : null}
                </>
              )}
            </Field>

            <Field label="الهوايات والمهارات" required error={errors.hobbies}
              hint="يمكنك اختيار أكثر من هواية أو مهارة وفي حال عدم وجودها يرجى الكتابة في المكان الفارغ">
              <CheckList options={HOBBIES_ADULT}
                selected={form.hobbies_adult}
                onChange={v => set('hobbies_adult', v)}
                otherVal={form.hobbies_adult_other}
                onOtherChange={v => set('hobbies_adult_other', v)} />
            </Field>
          </>}

          {/* No age group selected yet when reaching step 2 */}
          {step === 2 && !isSchool && !isAdult && (
            <div className="am-no-group">
              <AlertCircle size={32} />
              <p>يرجى العودة واختيار الفئة العمرية أولاً</p>
            </div>
          )}
        </div>

        {/* ── footer nav ── */}
        <div className="modal-footer am-footer">
          <div className="am-footer-right">
            {step > 0 && (
              <button className="btn btn-ghost" onClick={goBack} disabled={saving}>
                <ChevronRight size={14} /> السابق
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>إلغاء</button>
          </div>

          {step < 2 ? (
            <button className="btn btn-gold btn-lg" onClick={goNext}>
              التالي <ChevronLeft size={14} />
            </button>
          ) : (
            <button className="btn btn-gold btn-lg" onClick={handleSubmit} disabled={saving}>
              {saving ? 'جارٍ الحفظ…' : <><UserPlus size={15} /> إضافة العضو</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
