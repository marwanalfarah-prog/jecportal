import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, RotateCcw, ImagePlus, Pencil, X, Search, ChevronDown, Award, Users, Building2, Languages, CalendarRange, Target, BookOpen, GraduationCap } from 'lucide-react'
import { api } from '../api.js'

function cleanText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text
}

const VERSE_SEGMENT_RE = /^\s*(\d+)\s*:\s*(\d+)\s*(?:-\s*(?:(\d+)\s*:\s*)?(\d+))?\s*$/

function parseVerseSegment(segmentText) {
  const text = cleanText(segmentText)
  if (!text) return null
  const match = text.match(VERSE_SEGMENT_RE)
  if (!match) return null

  const startChapter = Number(match[1])
  const startVerse = Number(match[2])
  const endChapter = Number(match[3] || match[1])
  const endVerse = Number(match[4] || match[2])
  if (!startChapter || !startVerse || !endChapter || !endVerse) return null
  if (endChapter < startChapter) return null
  if (endChapter === startChapter && endVerse < startVerse) return null

  return {
    start: { chapter: startChapter, verse: startVerse },
    end: { chapter: endChapter, verse: endVerse },
  }
}

function renderVerseSegment(segment) {
  const start = segment?.start || {}
  const end = segment?.end || {}
  const sc = Number(start?.chapter)
  const sv = Number(start?.verse)
  const ec = Number(end?.chapter)
  const ev = Number(end?.verse)
  if (!sc || !sv || !ec || !ev) return ''
  if (sc === ec && sv === ev) return `${sc}: ${sv}`
  if (sc === ec) return `${sc}: ${sv}-${ev}`
  return `${sc}: ${sv}-${ec}: ${ev}`
}

function verseTextFromData(verse) {
  if (typeof verse === 'string') return cleanText(verse).replace(/:\s*/g, ': ')
  const row = verse && typeof verse === 'object' ? verse : {}
  const raw = cleanText(row?.raw)
  if (raw) return raw
  const segments = Array.isArray(row?.segments) ? row.segments : []
  return segments.map(renderVerseSegment).filter(Boolean).join(', ')
}

function validateVersesInput(value) {
  const text = cleanText(value)
  if (!text) return { valid: false, message: 'يرجى إدخال أرقام الآيات' }
  const parts = text.split(/[،,؛;]/).map((part) => cleanText(part)).filter(Boolean)
  if (!parts.length) return { valid: false, message: 'يرجى إدخال أرقام الآيات' }
  for (const part of parts) {
    if (!parseVerseSegment(part)) {
      return { valid: false, message: 'صيغة الآيات غير صحيحة. مثال: 3:15 أو 3:15-16 أو 3:15-4:2' }
    }
  }
  return { valid: true, message: '' }
}

function normalizeMap(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  Object.entries(raw).forEach(([baseRaw, varsRaw]) => {
    const base = cleanText(baseRaw)
    if (!base) return

    const source = Array.isArray(varsRaw) ? varsRaw : (typeof varsRaw === 'string' ? [varsRaw] : [])
    const seen = new Set()
    const values = []
    for (const item of source) {
      const v = cleanText(item)
      if (!v || v === base || seen.has(v)) continue
      seen.add(v)
      values.push(v)
    }
    out[base] = values
  })

  return out
}

function normalizePersonTitles(raw) {
  const entries = []
  if (Array.isArray(raw)) {
    for (const row of raw) entries.push(row)
  } else if (raw && typeof raw === 'object') {
    for (const [arabicTitle, englishTitle] of Object.entries(raw)) {
      entries.push({ arabic_title: arabicTitle, english_title: englishTitle })
    }
  }

  const seen = new Set()
  const titles = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const arabicTitle = cleanText(entry.arabic_title || entry.arabic || entry.title || entry.name || entry.ar)
    const englishTitle = cleanText(entry.english_title || entry.english || entry.en)
    if (!arabicTitle || seen.has(arabicTitle)) continue
    seen.add(arabicTitle)
    titles.push({ arabic_title: arabicTitle, english_title: englishTitle })
  }
  return titles
}

function normalizeSchoolBranches(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  const items = Array.isArray(raw)
    ? raw.map((row) => [row?.school, row?.branches])
    : Object.entries(raw)

  for (const [schoolRaw, branchesRaw] of items) {
    const school = cleanText(schoolRaw)
    if (!school) continue

    const source = Array.isArray(branchesRaw) ? branchesRaw : (typeof branchesRaw === 'string' ? [branchesRaw] : [])
    const seen = new Set()
    const branches = []
    for (const item of source) {
      const branch = cleanText(item)
      if (!branch || seen.has(branch)) continue
      seen.add(branch)
      branches.push(branch)
    }
    out[school] = branches
  }

  return out
}

function formatMottoSource(ref) {
  if (!ref || typeof ref !== 'object') return ''
  const abbr = String(ref?.book?.book_abbr || ref?.book?.abbr || ref?.book?.book_name || '').trim()
  const verseRaw = verseTextFromData(ref?.verse).replace(/:\s*/g, ': ')
  if (!abbr || !verseRaw) return ''
  return `(${abbr} ${verseRaw})`
}

function formatMottoText(item) {
  const title = cleanText(item?.title)
  if (!title) return '—'
  const ref = Array.isArray(item?.bible_references) ? item.bible_references[0] : null
  const source = formatMottoSource(ref)
  return source ? `${title} ${source}` : title
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid #e2e6ef',
  borderRadius: 8,
  fontFamily: 'var(--font-body)',
  fontSize: '0.9rem',
  direction: 'rtl',
  textAlign: 'right',
  outline: 'none',
  background: 'white',
}

function ScopeDropdown({ options, selectedValues, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = (options || []).filter((item) =>
    String(item?.label || '').toLowerCase().includes(String(search || '').toLowerCase())
  )

  const selectedSet = new Set(selectedValues || [])
  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedSet.has(item.value))

  const toggleOne = (value) => {
    const key = String(value)
    if (selectedSet.has(key)) {
      onChange((selectedValues || []).filter((v) => String(v) !== key))
      return
    }
    onChange([...(selectedValues || []), key])
  }

  const selectAll = () => onChange((options || []).map((item) => String(item.value)))
  const clearAll = () => onChange([])

  const toggleFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filtered.map((item) => String(item.value)))
      onChange((selectedValues || []).filter((v) => !filteredSet.has(String(v))))
      return
    }
    const next = new Set((selectedValues || []).map((v) => String(v)))
    filtered.forEach((item) => next.add(String(item.value)))
    onChange([...next])
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ width: '100%', justifyContent: 'space-between', border: '1.5px solid #e2e6ef', padding: '8px 10px' }}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style={{ color: '#2d3748', fontSize: '0.84rem' }}>
          {selectedValues?.length ? `${selectedValues.length} محدد` : 'الكل / اختر النطاقات'}
        </span>
        <ChevronDown size={14} style={{ color: '#9ba5bc' }} />
      </button>

      {open ? (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          left: 0,
          zIndex: 20,
          border: '1px solid #e2e6ef',
          borderRadius: 10,
          background: 'white',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
        }}>
          <div style={{ padding: 10, borderBottom: '1px solid #edf2f7', display: 'grid', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', right: 9, top: 10, color: '#9ba5bc' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث ضمن النطاقات..."
                style={{ ...inputStyle, paddingRight: 28, direction: 'rtl' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll}>تحديد الكل</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>إلغاء الكل</button>
              <span style={{ marginRight: 'auto', fontSize: '0.75rem', color: '#9ba5bc' }}>
                {selectedValues?.length || 0} / {options?.length || 0}
              </span>
            </div>
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto', padding: 8, display: 'grid', gap: 4 }}>
            {filtered.length ? (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#4a5568', padding: '4px 6px' }}>
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleFiltered} />
                (تحديد كل النتائج)
              </label>
            ) : null}

            {filtered.map((item) => {
              const checked = selectedSet.has(String(item.value))
              return (
                <label key={item.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: '#2d3748', padding: '4px 6px' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleOne(item.value)} />
                  {item.label}
                </label>
              )
            })}

            {!filtered.length ? (
              <div style={{ textAlign: 'center', color: '#9ba5bc', fontSize: '0.82rem', padding: 8 }}>لا توجد نتائج</div>
            ) : null}
          </div>

          <div style={{ padding: 10, borderTop: '1px solid #edf2f7', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>تم</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OverviewStatCard({ label, value, note }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 14,
      border: '1px solid #e2e6ef',
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      display: 'grid',
      gap: 4,
      minHeight: 92,
    }}>
      <div style={{ fontSize: '0.78rem', color: '#718096', fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 900, fontSize: '1.45rem', color: '#0f2744' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: '#4a5568' }}>{note}</div>
    </div>
  )
}

function SectionPanel({ icon: Icon, title, hint, children }) {
  return (
    <div style={{
      border: '1px solid #e2e6ef',
      borderRadius: 14,
      background: 'white',
      padding: 14,
      display: 'grid',
      gap: 12,
      boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: 'rgba(15, 39, 68, 0.06)',
          color: '#0f2744',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {Icon ? <Icon size={16} /> : null}
        </div>
        <div style={{ display: 'grid', gap: 3 }}>
          <div style={{ fontWeight: 800, color: '#1a2a3a', fontSize: '0.92rem' }}>{title}</div>
          {hint ? <div style={{ fontSize: '0.8rem', color: '#718096', lineHeight: 1.7 }}>{hint}</div> : null}
        </div>
      </div>
      {children}
    </div>
  )
}

function EmptyStatePanel({ title, description }) {
  return (
    <div style={{
      textAlign: 'center',
      color: '#718096',
      padding: '24px 16px',
      fontSize: '0.86rem',
      border: '1px dashed #d6dce8',
      borderRadius: 12,
      background: '#fbfcfe',
      display: 'grid',
      gap: 4,
    }}>
      <div style={{ fontWeight: 700, color: '#4a5568' }}>{title}</div>
      <div>{description}</div>
    </div>
  )
}

export default function Config({ toast }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('general')
  const [activeJecYear, setActiveJecYear] = useState('')
  const [rows, setRows] = useState([])
  const [personTitles, setPersonTitles] = useState([])
  const [schoolBranches, setSchoolBranches] = useState({})
  const [schoolOptions, setSchoolOptions] = useState([])

  // ── School / University Logos ─────────────────────────────────────────────
  const [schoolLogos, setSchoolLogos] = useState([])
  const [schoolLogosLoading, setSchoolLogosLoading] = useState(true)
  const [universityOptions, setUniversityOptions] = useState([])
  const [logoEntryType, setLogoEntryType] = useState('school')
  const [logoEntryName, setLogoEntryName] = useState('')
  const [logoEntrySection, setLogoEntrySection] = useState('')
  const [logoEntryUploading, setLogoEntryUploading] = useState(false)
  const [schoolLogoBustById, setSchoolLogoBustById] = useState({})

  const [mottosLoading, setMottosLoading] = useState(true)
  const [mottosSaving, setMottosSaving] = useState(false)
  const [mottos, setMottos] = useState([])
  const [bibleBooksTree, setBibleBooksTree] = useState([])
  const [youthGroupScopes, setYouthGroupScopes] = useState([])
  const [editingMottoId, setEditingMottoId] = useState('')
  const [deletingMottoId, setDeletingMottoId] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoBustById, setLogoBustById] = useState({})

  const [mottoTitle, setMottoTitle] = useState('')
  const [mottoYearLabel, setMottoYearLabel] = useState('')
  const [targetScopes, setTargetScopes] = useState([])
  const [applicationFromDate, setApplicationFromDate] = useState('')
  const [applicationToDate, setApplicationToDate] = useState('')
  const [applicationIsPresent, setApplicationIsPresent] = useState(true)
  const [logoFile, setLogoFile] = useState(null)
  const [selectedTestamentId, setSelectedTestamentId] = useState('')
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [selectedBookId, setSelectedBookId] = useState('')
  const [selectedVersesInput, setSelectedVersesInput] = useState('')

  const [baseName, setBaseName] = useState('')
  const [variationsInput, setVariationsInput] = useState('')
  const [titleArabic, setTitleArabic] = useState('')
  const [titleEnglish, setTitleEnglish] = useState('')
  const [selectedSchoolName, setSelectedSchoolName] = useState('')
  const [schoolBranchInput, setSchoolBranchInput] = useState('')

  function resetMottoForm() {
    setEditingMottoId('')
    setMottoTitle('')
    setMottoYearLabel('')
    setTargetScopes([])
    setApplicationFromDate('')
    setApplicationToDate('')
    setApplicationIsPresent(true)
    setLogoFile(null)
    setSelectedTestamentId('')
    setSelectedSectionId('')
    setSelectedBookId('')
    setSelectedVersesInput('')
  }

  const loadMottosData = async () => {
    setMottosLoading(true)
    try {
      const [meta, list] = await Promise.all([
        api.getMottosMeta(),
        api.listMottos(),
      ])
      setBibleBooksTree(Array.isArray(meta?.bible_books_tree) ? meta.bible_books_tree : [])
      setYouthGroupScopes(Array.isArray(meta?.scopes?.youth_groups) ? meta.scopes.youth_groups : [])
      setMottos(Array.isArray(list?.mottos) ? list.mottos : [])
    } catch {
      toast?.('تعذر تحميل بيانات الشعار', 'error')
      setBibleBooksTree([])
      setYouthGroupScopes([])
      setMottos([])
    } finally {
      setMottosLoading(false)
    }
  }

  const scopeOptions = useMemo(() => {
    return [
      { value: 'JEC_JORDAN', label: 'JECJordan' },
      ...(youthGroupScopes || []).map((group) => ({
        value: String(group.group_id || ''),
        label: String(group.group_name || group.group_id || ''),
      })).filter((item) => item.value),
    ]
  }, [youthGroupScopes])

  function parseVariations(value) {
    const values = String(value || '')
      .split(/[\n,،]/)
      .map(cleanText)
      .filter(Boolean)
    return [...new Set(values)]
  }

  const hasRows = rows.length > 0
  const hasPersonTitleRows = personTitles.length > 0
  const selectedSchoolBranches = schoolBranches[selectedSchoolName] || []

  const variationCount = useMemo(() => rows.reduce((sum, row) => sum + parseVariations(row.variationsText).length, 0), [rows])
  const personTitleCount = useMemo(() => personTitles.length, [personTitles])
  const schoolBranchCount = useMemo(
    () => Object.values(schoolBranches).reduce((sum, branches) => sum + (Array.isArray(branches) ? branches.length : 0), 0),
    [schoolBranches],
  )
  const configTabs = [
    {
      id: 'general',
      label: 'الإعدادات العامة',
      summary: activeJecYear ? `سنة JEC الحالية: ${activeJecYear}` : 'سنة JEC الحالية غير محددة',
      description: 'إعدادات عامة على مستوى النظام، ومنها سنة JEC المعتمدة حالياً كقيمة افتراضية.',
      icon: CalendarRange,
      tips: ['أدخل سنة JEC الحالية بصيغة 4 أرقام', 'احفظ الإعدادات لاعتمادها في النوافذ المرتبطة', 'يمكن تعديلها لاحقاً عند بدء سنة جديدة'],
    },
    {
      id: 'mottos',
      label: 'شعار سنة الشبيبة',
      summary: `${mottos.length} شعار محفوظ`,
      description: 'إدارة الشعار السنوي، النطاق، المرجع الكتابي، والصورة.',
      icon: Award,
      tips: ['حدّد النص والسنة', 'اختر النطاق وتاريخ التطبيق', 'أضف المرجع والصورة ثم احفظ'],
    },
    {
      id: 'personTitles',
      label: 'ألقاب الأشخاص',
      summary: `${personTitleCount} لقب`,
      description: 'إعداد الألقاب العربية والإنجليزية المستخدمة في نماذج الإدخال.',
      icon: Users,
      tips: ['أدخل اللقب بالعربية', 'أضف المقابل الإنجليزي إن وجد', 'راجع القائمة ثم احفظ'],
    },
    {
      id: 'schoolBranches',
      label: 'فروع المدارس',
      summary: `${Object.keys(schoolBranches).length} مدرسة / ${schoolBranchCount} فرع`,
      description: 'تنظيم المدارس وفروعها ضمن إعدادات النظام.',
      icon: Building2,
      tips: ['اختر المدرسة', 'أضف الفروع التابعة لها', 'احفظ بعد مراجعة التعديلات'],
    },
    {
      id: 'nameVariations',
      label: 'اختلافات الأسماء',
      summary: `${rows.length} اسم أساسي / ${variationCount} اختلاف`,
      description: 'تحسين البحث بربط الاسم الأساسي باختلافاته الشائعة.',
      icon: Languages,
      tips: ['أدخل الاسم الأساسي', 'أضف الاختلافات الشائعة', 'احفظ أو أعد الضبط عند الحاجة'],
    },
    {
      id: 'schoolLogos',
      label: 'شعارات المدارس والجامعات',
      summary: `${schoolLogos.length} شعار`,
      description: 'رفع شعارات المدارس (على مستوى المدرسة أو الفرع) والجامعات.',
      icon: GraduationCap,
      tips: ['اختر النوع (مدرسة / جامعة)', 'حدد الاسم والفرع إن وجد', 'ارفع الصورة ثم احفظ'],
    },
  ]
  const schoolOptionsMerged = useMemo(() => {
    const values = new Set()
    const merged = []

    const register = (value) => {
      const school = cleanText(value)
      if (!school || values.has(school)) return
      values.add(school)
      merged.push(school)
    }

    schoolOptions.forEach(register)
    Object.keys(schoolBranches).forEach(register)

    return merged.sort((a, b) => a.localeCompare(b, 'ar'))
  }, [schoolBranches, schoolOptions])
  const verseValidation = useMemo(() => validateVersesInput(selectedVersesInput), [selectedVersesInput])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const [response, filtersResponse] = await Promise.all([api.getConfig(), api.filters()])
      const nameVariations = normalizeMap(response?.config?.name_variations || {})
      setActiveJecYear(cleanText(response?.config?.active_jec_year || ''))
      const parsedRows = Object.entries(nameVariations).map(([base, variations]) => ({
        base,
        variationsText: variations.join('، '),
      }))
      setRows(parsedRows)
      setPersonTitles(normalizePersonTitles(response?.config?.person_titles || []))
      setSchoolBranches(normalizeSchoolBranches(response?.config?.school_branches || {}))
      setSchoolOptions((filtersResponse?.school || []).map((item) => cleanText(item?.value)).filter(Boolean))
      setUniversityOptions((filtersResponse?.university || []).map((item) => cleanText(item?.value)).filter(Boolean))
      setTitleArabic('')
      setTitleEnglish('')
      setSelectedSchoolName('')
      setSchoolBranchInput('')
    } catch {
      toast?.('تعذر تحميل الإعدادات', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadSchoolLogos = async () => {
    setSchoolLogosLoading(true)
    try {
      const res = await api.listSchoolLogos()
      setSchoolLogos(Array.isArray(res?.entries) ? res.entries : [])
    } catch {
      toast?.('تعذر تحميل شعارات المدارس', 'error')
      setSchoolLogos([])
    } finally {
      setSchoolLogosLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([loadConfig(), loadMottosData(), loadSchoolLogos()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const testaments = Array.isArray(bibleBooksTree) ? bibleBooksTree : []
  const selectedTestament = testaments.find((t) => String(t.id) === String(selectedTestamentId)) || null

  const selectableSections = useMemo(() => {
    const out = []
    const sections = Array.isArray(selectedTestament?.sections) ? selectedTestament.sections : []

    for (const section of sections) {
      const sectionBooks = Array.isArray(section?.books) ? section.books : []
      if (sectionBooks.length > 0) {
        out.push({
          id: String(section?.id || ''),
          label: String(section?.name || ''),
          books: sectionBooks,
        })
      }

      const subsections = Array.isArray(section?.subsections) ? section.subsections : []
      for (const subsection of subsections) {
        const subsectionBooks = Array.isArray(subsection?.books) ? subsection.books : []
        if (subsectionBooks.length === 0) continue
        out.push({
          id: String(subsection?.id || ''),
          label: section?.name ? `${section.name} / ${subsection?.name || ''}` : String(subsection?.name || ''),
          books: subsectionBooks,
        })
      }
    }

    return out.filter((item) => item.id)
  }, [selectedTestament])

  const selectedSection = selectableSections.find((s) => String(s.id) === String(selectedSectionId)) || null
  const books = Array.isArray(selectedSection?.books) ? selectedSection.books : []

  const resolveSectionIdByBook = (testamentId, bookId) => {
    const tid = String(testamentId || '')
    const bid = String(bookId || '')
    if (!tid || !bid) return ''

    const testament = testaments.find((t) => String(t?.id || '') === tid)
    if (!testament) return ''

    for (const section of (testament.sections || [])) {
      if ((section.books || []).some((book) => String(book?.id || '') === bid)) {
        return String(section?.id || '')
      }
      for (const subsection of (section.subsections || [])) {
        if ((subsection.books || []).some((book) => String(book?.id || '') === bid)) {
          return String(subsection?.id || '')
        }
      }
    }

    return ''
  }

  const sectionExistsInTestament = (testamentId, sectionId) => {
    const tid = String(testamentId || '')
    const sid = String(sectionId || '')
    if (!tid || !sid) return false

    const testament = testaments.find((t) => String(t?.id || '') === tid)
    if (!testament) return false

    for (const section of (testament.sections || [])) {
      if (String(section?.id || '') === sid) return true
      for (const subsection of (section.subsections || [])) {
        if (String(subsection?.id || '') === sid) return true
      }
    }

    return false
  }

  const updateRow = (index, key, value) => {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  const updatePersonTitleRow = (index, key, value) => {
    setPersonTitles(prev => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  const removePersonTitleRow = (index) => {
    setPersonTitles(prev => prev.filter((_, i) => i !== index))
  }

  const addPersonTitleRow = () => {
    const arabicTitle = cleanText(titleArabic)
    const englishTitle = cleanText(titleEnglish)

    if (!arabicTitle) {
      toast?.('يرجى إدخال اللقب بالعربية', 'error')
      return
    }

    setPersonTitles(prev => {
      const existingIndex = prev.findIndex((row) => cleanText(row.arabic_title) === arabicTitle)
      if (existingIndex >= 0) {
        return prev.map((row, index) => (
          index === existingIndex
            ? { ...row, english_title: englishTitle || row.english_title || '' }
            : row
        ))
      }
      return [...prev, { arabic_title: arabicTitle, english_title: englishTitle }]
    })

    setTitleArabic('')
    setTitleEnglish('')
  }

  const updateSchoolBranchRow = (school, index, value) => {
    const schoolName = cleanText(school)
    if (!schoolName) return
    setSchoolBranches((prev) => {
      const current = Array.isArray(prev[schoolName]) ? prev[schoolName] : []
      const next = current.map((branch, rowIndex) => (rowIndex === index ? value : branch))
      return {
        ...prev,
        [schoolName]: next,
      }
    })
  }

  const removeSchoolBranchRow = (school, index) => {
    const schoolName = cleanText(school)
    if (!schoolName) return
    setSchoolBranches((prev) => {
      const current = Array.isArray(prev[schoolName]) ? prev[schoolName] : []
      const next = current.filter((_, rowIndex) => rowIndex !== index)
      if (next.length === 0) {
        const { [schoolName]: _removed, ...rest } = prev
        return rest
      }
      return {
        ...prev,
        [schoolName]: next,
      }
    })
  }

  const removeSelectedSchoolEntry = () => {
    const schoolName = cleanText(selectedSchoolName)
    if (!schoolName) return
    setSchoolBranches((prev) => {
      const { [schoolName]: _removed, ...rest } = prev
      return rest
    })
    setSchoolBranchInput('')
    setSelectedSchoolName('')
  }

  const addSchoolBranchRow = () => {
    const schoolName = cleanText(selectedSchoolName)
    const branchName = cleanText(schoolBranchInput)

    if (!schoolName) {
      toast?.('يرجى اختيار المدرسة أولاً', 'error')
      return
    }
    if (!branchName) {
      toast?.('يرجى إدخال اسم الفرع', 'error')
      return
    }

    setSchoolBranches((prev) => {
      const current = Array.isArray(prev[schoolName]) ? prev[schoolName] : []
      if (current.some((branch) => cleanText(branch) === branchName)) return prev
      return {
        ...prev,
        [schoolName]: [...current, branchName],
      }
    })
    setSchoolBranchInput('')
  }

  const addRow = () => {
    const base = cleanText(baseName)
    const vars = parseVariations(variationsInput)

    if (!base) {
      toast?.('يرجى إدخال الاسم الأساسي', 'error')
      return
    }
    if (!vars.length) {
      toast?.('يرجى إدخال اختلاف واحد على الأقل', 'error')
      return
    }

    setRows(prev => {
      const existingIdx = prev.findIndex(r => cleanText(r.base) === base)
      if (existingIdx >= 0) {
        const current = parseVariations(prev[existingIdx].variationsText)
        const merged = [...new Set([...current, ...vars].filter(v => v !== base))]
        return prev.map((row, i) => (i === existingIdx ? { ...row, variationsText: merged.join('، ') } : row))
      }
      return [...prev, { base, variationsText: vars.filter(v => v !== base).join('، ') }]
    })

    setBaseName('')
    setVariationsInput('')
  }

  const buildPayloadMap = () => {
    const out = {}
    rows.forEach((row) => {
      const base = cleanText(row.base)
      if (!base) return

      const vars = parseVariations(row.variationsText).filter(v => v !== base)
      out[base] = vars
    })
    return out
  }

  const buildPersonTitlesPayload = () => {
    const draftArabicTitle = cleanText(titleArabic)
    const draftEnglishTitle = cleanText(titleEnglish)
    const source = draftArabicTitle
      ? [...personTitles, { arabic_title: draftArabicTitle, english_title: draftEnglishTitle }]
      : personTitles
    return normalizePersonTitles(source)
  }

  const buildSchoolBranchesPayload = () => {
    const payload = normalizeSchoolBranches(schoolBranches)
    const schoolName = cleanText(selectedSchoolName)
    const branchName = cleanText(schoolBranchInput)
    if (schoolName && branchName) {
      const current = Array.isArray(payload[schoolName]) ? payload[schoolName] : []
      if (!current.includes(branchName)) {
        payload[schoolName] = [...current, branchName]
      }
    }
    return normalizeSchoolBranches(payload)
  }

  const handleSave = async () => {
    const normalizedActiveJecYear = cleanText(activeJecYear)
    if (normalizedActiveJecYear && !/^\d{4}$/.test(normalizedActiveJecYear)) {
      toast?.('يرجى إدخال سنة JEC الحالية بصيغة 4 أرقام', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        active_jec_year: normalizedActiveJecYear,
        name_variations: buildPayloadMap(),
        person_titles: buildPersonTitlesPayload(),
        school_branches: buildSchoolBranchesPayload(),
      }
      await api.putConfig(payload)
      toast?.('تم حفظ الإعدادات', 'success')
      await loadConfig()
    } catch {
      toast?.('تعذر حفظ الإعدادات', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!confirm('سيتم حذف كل اختلافات الأسماء. هل تريد المتابعة؟')) return
    setSaving(true)
    try {
      await api.putConfig({
        active_jec_year: cleanText(activeJecYear),
        name_variations: {},
        person_titles: buildPersonTitlesPayload(),
        school_branches: buildSchoolBranchesPayload(),
      })
      toast?.('تمت إعادة ضبط اختلافات الأسماء', 'success')
      await loadConfig()
    } catch {
      toast?.('تعذر إعادة الضبط', 'error')
    } finally {
      setSaving(false)
    }
  }

  const editMotto = (motto) => {
    const item = motto || {}
    setEditingMottoId(String(item.id || ''))
    setMottoTitle(String(item.title || ''))
    setMottoYearLabel(String(item.year_label || ''))
    const selected = []
    if (item?.targets?.jec_jordan) selected.push('JEC_JORDAN')
    if (Array.isArray(item?.targets?.youth_groups)) {
      for (const gid of item.targets.youth_groups) selected.push(String(gid))
    }
    setTargetScopes([...new Set(selected)])
    setApplicationFromDate(String(item?.application_from_date || ''))
    setApplicationToDate(String(item?.application_to_date || ''))
    setApplicationIsPresent(Boolean(item?.application_is_present))
    setLogoFile(null)

    const firstRef = Array.isArray(item?.bible_references) ? item.bible_references[0] : null
    const refTestamentId = String(firstRef?.book?.testament_id || '')
    const refBookId = String(firstRef?.book?.book_id || '')
    const rawSectionId = String(firstRef?.book?.section_id || '')
    const resolvedSectionId = sectionExistsInTestament(refTestamentId, rawSectionId)
      ? rawSectionId
      : resolveSectionIdByBook(refTestamentId, refBookId)

    setSelectedTestamentId(refTestamentId)
    setSelectedSectionId(resolvedSectionId)
    setSelectedBookId(refBookId)
    setSelectedVersesInput(verseTextFromData(firstRef?.verse))
  }

  const saveMotto = async () => {
    const title = cleanText(mottoTitle)
    const yearLabel = cleanText(mottoYearLabel)
    const selectedScopes = [...new Set((targetScopes || []).map((x) => String(x).trim()).filter(Boolean))]
    const targetJecJordan = selectedScopes.includes('JEC_JORDAN')
    const youthGroups = selectedScopes.filter((x) => x !== 'JEC_JORDAN')
    const testament = selectedTestament
    const section = selectedSection
    const book = books.find((b) => String(b.id) === String(selectedBookId)) || null
    const verses = cleanText(selectedVersesInput)

    if (!title) {
      toast?.('يرجى إدخال نص الشعار', 'error')
      return
    }
    if (yearLabel && !/^\d{4}$/.test(yearLabel)) {
      toast?.('يرجى إدخال السنة بصيغة 4 أرقام فقط', 'error')
      return
    }
    if (!targetJecJordan && youthGroups.length === 0) {
      toast?.('يرجى اختيار نطاق واحد على الأقل (JECJordan أو فرق الشبيبة)', 'error')
      return
    }
    if (!testament || !section || !book) {
      toast?.('يرجى اختيار مسار المرجع الكتابي كاملاً', 'error')
      return
    }
    if (!verseValidation.valid) {
      toast?.(verseValidation.message, 'error')
      return
    }
    if (!applicationFromDate) {
      toast?.('يرجى إدخال تاريخ بداية التطبيق', 'error')
      return
    }
    if (!applicationIsPresent && !applicationToDate) {
      toast?.('يرجى إدخال تاريخ نهاية التطبيق أو اختيار أنها حالية', 'error')
      return
    }
    if (!applicationIsPresent && applicationToDate < applicationFromDate) {
      toast?.('تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية', 'error')
      return
    }

    const payload = {
      title,
      year_label: yearLabel,
      application_from_date: applicationFromDate,
      application_to_date: applicationIsPresent ? '' : applicationToDate,
      application_is_present: applicationIsPresent,
      targets: {
        jec_jordan: targetJecJordan,
        youth_groups: youthGroups,
      },
      bible_references: [{
        book: {
          testament_id: testament.id,
          section_id: section.id,
          book_id: book.id,
        },
        verses,
      }],
    }

    setMottosSaving(true)
    try {
      let saved = null
      if (editingMottoId) {
        const response = await api.updateMotto(editingMottoId, payload)
        saved = response?.motto || null
      } else {
        const response = await api.createMotto(payload)
        saved = response?.motto || null
      }

      if (logoFile && saved?.id) {
        setLogoUploading(true)
        try {
          await api.uploadMottoLogo(saved.id, logoFile)
          setLogoBustById((prev) => ({ ...prev, [saved.id]: Date.now() }))
        } finally {
          setLogoUploading(false)
        }
      }

      toast?.('تم حفظ الشعار بنجاح', 'success')
      await loadMottosData()
      resetMottoForm()
    } catch {
      toast?.('تعذر حفظ الشعار', 'error')
    } finally {
      setMottosSaving(false)
    }
  }

  const removeMotto = async (id) => {
    if (!id) return
    if (!confirm('سيتم حذف هذا الشعار نهائياً. هل تريد المتابعة؟')) return

    setDeletingMottoId(String(id))
    try {
      await api.deleteMotto(id)
      toast?.('تم حذف الشعار', 'success')
      await loadMottosData()
      if (String(editingMottoId) === String(id)) {
        resetMottoForm()
      }
    } catch {
      toast?.('تعذر حذف الشعار', 'error')
    } finally {
      setDeletingMottoId('')
    }
  }

  if (loading || mottosLoading || schoolLogosLoading) return <div className="loading-center"><div className="spinner" /></div>

  const activeTabMeta = configTabs.find((tab) => tab.id === activeTab) || configTabs[0]
  const ActiveTabIcon = activeTabMeta.icon

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="card-body" style={{ display: 'grid', gap: 18, background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,0.8) 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
              <div style={{ fontSize: '0.76rem', letterSpacing: '0.08em', color: '#c9963c', fontWeight: 800 }}>
                CONTROL CENTER
              </div>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: '1.45rem', fontWeight: 900, color: '#0f2744' }}>
                إعدادات النظام
              </div>
              <div style={{ color: '#4a5568', fontSize: '0.92rem', lineHeight: 1.9 }}>
                الصفحة مرتبة الآن حسب نوع الإعداد. اختر التبويب المناسب ثم أكمل الخطوات داخله: إدخال البيانات، مراجعة العناصر الحالية، ثم الحفظ.
              </div>
            </div>

            <div style={{ minWidth: 280, padding: 14, borderRadius: 16, border: '1px solid rgba(201,150,60,0.24)', background: 'linear-gradient(135deg, rgba(201,150,60,0.1), rgba(15,39,68,0.04))', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f2744' }}>
                  {ActiveTabIcon ? <ActiveTabIcon size={18} /> : null}
                </div>
                <div style={{ display: 'grid', gap: 2 }}>
                  <div style={{ fontSize: '0.78rem', color: '#8c6724', fontWeight: 800 }}>التبويب الحالي</div>
                  <div style={{ fontSize: '1rem', color: '#1a2a3a', fontWeight: 900 }}>{activeTabMeta.label}</div>
                </div>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#4a5568', lineHeight: 1.8 }}>{activeTabMeta.description}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {activeTabMeta.tips.map((tip, index) => (
                  <div key={`${activeTabMeta.id}-tip-${index}`} style={{ fontSize: '0.8rem', color: '#2d3748' }}>
                    {index + 1}. {tip}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <OverviewStatCard label="الشعارات" value={mottos.length} note="عدد الشعارات المعرفة حالياً" />
            <OverviewStatCard label="الألقاب" value={personTitleCount} note="ألقاب يمكن استخدامها في الإدخال" />
            <OverviewStatCard label="المدارس والفروع" value={`${Object.keys(schoolBranches).length}/${schoolBranchCount}`} note="مدارس مقابل عدد الفروع" />
            <OverviewStatCard label="اختلافات البحث" value={variationCount} note="بدائل أسماء لتحسين نتائج البحث" />
            <OverviewStatCard label="شعارات المدارس والجامعات" value={schoolLogos.length} note="شعارات مرفوعة لمدارس وجامعات" />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {configTabs.map((tab) => {
              const isActive = tab.id === activeTab
              const TabIcon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    minWidth: 210,
                    padding: '14px 16px',
                    borderRadius: 16,
                    border: isActive ? '1.5px solid #c9963c' : '1.5px solid #e2e6ef',
                    background: isActive ? 'linear-gradient(135deg, rgba(201,150,60,0.14), rgba(15,39,68,0.04))' : '#fff',
                    color: '#1a2a3a',
                    display: 'grid',
                    gap: 8,
                    textAlign: 'right',
                    cursor: 'pointer',
                    boxShadow: isActive ? '0 6px 18px rgba(201,150,60,0.12)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: isActive ? 'rgba(255,255,255,0.8)' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isActive ? '#8c6724' : '#0f2744', flexShrink: 0 }}>
                      {TabIcon ? <TabIcon size={16} /> : null}
                    </div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span style={{ fontSize: '0.92rem', fontWeight: 800 }}>{tab.label}</span>
                      <span style={{ fontSize: '0.78rem', color: isActive ? '#8c6724' : '#718096' }}>{tab.summary}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.78rem', color: '#4a5568', lineHeight: 1.7 }}>{tab.description}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {activeTab === 'mottos' ? (
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">إدارة شعار سنة الشبيبة</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>{mottos.length} شعار محفوظ</span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <SectionPanel
            icon={Award}
            title="ملخص إدارة الشعار"
            hint="يمكنك إضافة شعار خاص بـ JECJordan و/أو فرق شبيبة محددة، مع مرجع كتابي منظم وصورة مرافقة."
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <OverviewStatCard label="الشعارات الحالية" value={mottos.length} note="جميع الشعارات المحفوظة" />
              <OverviewStatCard label="النطاقات المتاحة" value={scopeOptions.length} note="JECJordan مع فرق الشبيبة" />
              <OverviewStatCard label="وضع التحرير" value={editingMottoId ? 'نشط' : 'جديد'} note={editingMottoId ? 'أنت تعدل شعاراً محفوظاً' : 'سيتم إنشاء شعار جديد'} />
            </div>
          </SectionPanel>

          <SectionPanel icon={Award} title="البيانات الأساسية" hint="ابدأ بنص الشعار والسنة المرجعية إن كانت مطلوبة.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                نص الشعار
              </label>
              <input
                value={mottoTitle}
                onChange={(e) => setMottoTitle(e.target.value)}
                placeholder="مثال: كونوا شهوداً للرجاء"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                السنة (اختياري)
              </label>
              <input
                type="number"
                min="1900"
                max="2100"
                value={mottoYearLabel}
                onChange={(e) => setMottoYearLabel(e.target.value)}
                placeholder="مثال: 2026"
                style={inputStyle}
              />
            </div>
          </div>
          </SectionPanel>

          <SectionPanel icon={CalendarRange} title="فترة التطبيق" hint="حدد تاريخ البداية والنهاية، أو فعّل خيار الحالي إذا كان الشعار ما زال معتمداً.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4, display: 'block' }}>من</label>
                <input
                  type="date"
                  value={applicationFromDate}
                  onChange={(e) => setApplicationFromDate(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4, display: 'block' }}>إلى</label>
                <input
                  type="date"
                  value={applicationToDate}
                  onChange={(e) => setApplicationToDate(e.target.value)}
                  disabled={applicationIsPresent}
                  style={{ ...inputStyle, opacity: applicationIsPresent ? 0.65 : 1 }}
                />
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.84rem', color: '#2d3748', paddingBottom: 8, minHeight: 42 }}>
                <input
                  type="checkbox"
                  checked={applicationIsPresent}
                  onChange={(e) => setApplicationIsPresent(e.target.checked)}
                />
                حالي
              </label>
            </div>
          </SectionPanel>

          <SectionPanel icon={Target} title="نطاق التطبيق" hint="اختر ما إذا كان الشعار عاماً على JECJordan أو مخصصاً لفرق شبيبة بعينها.">
            <ScopeDropdown options={scopeOptions} selectedValues={targetScopes} onChange={setTargetScopes} />
          </SectionPanel>

          <SectionPanel icon={BookOpen} title="المرجع الكتابي" hint="اختر المسار الكامل للمرجع ثم أدخل الآيات بصيغة واضحة مثل 5:15 أو 5:15-6:12.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4, display: 'block' }}>العهد</label>
                <select
                  value={selectedTestamentId}
                  onChange={(e) => {
                    setSelectedTestamentId(e.target.value)
                    setSelectedSectionId('')
                    setSelectedBookId('')
                  }}
                  style={{ ...inputStyle, direction: 'rtl' }}
                >
                  <option value="">اختر</option>
                  {testaments.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4, display: 'block' }}>القسم</label>
                <select
                  value={selectedSectionId}
                  onChange={(e) => {
                    setSelectedSectionId(e.target.value)
                    setSelectedBookId('')
                  }}
                  style={{ ...inputStyle, direction: 'rtl' }}
                >
                  <option value="">اختر</option>
                  {selectableSections.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4, display: 'block' }}>الكتاب</label>
                <select
                  value={selectedBookId}
                  onChange={(e) => setSelectedBookId(e.target.value)}
                  style={{ ...inputStyle, direction: 'rtl' }}
                >
                  <option value="">اختر</option>
                  {books.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4, display: 'block' }}>أرقام الآيات</label>
                <input
                  value={selectedVersesInput}
                  onChange={(e) => setSelectedVersesInput(e.target.value)}
                  placeholder="5:15 أو 5:15-6:12"
                  style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
                />
                {!verseValidation.valid && cleanText(selectedVersesInput) ? (
                  <div style={{ color: '#c53030', fontSize: '0.74rem', marginTop: 4 }}>{verseValidation.message}</div>
                ) : null}
              </div>
            </div>
          </SectionPanel>

          <SectionPanel icon={ImagePlus} title="صورة الشعار" hint="اختيار الصورة اختياري، وسيتم رفعها مباشرة بعد نجاح حفظ بيانات الشعار.">
            <label className="btn btn-ghost btn-sm" style={{ width: 'fit-content', cursor: 'pointer', gap: 6 }}>
              <ImagePlus size={14} />
              {logoFile ? `تم اختيار: ${logoFile.name}` : 'اختيار ملف شعار'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              />
            </label>
            <div style={{ fontSize: '0.76rem', color: '#718096' }}>
              يتم رفع الشعار بعد حفظ الشعار. الامتدادات المدعومة: jpg, jpeg, png, webp, gif.
            </div>
          </SectionPanel>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {editingMottoId ? (
              <button className="btn btn-ghost btn-sm" onClick={resetMottoForm} style={{ gap: 6 }}>
                <X size={14} /> إلغاء التعديل
              </button>
            ) : null}
            <button className="btn btn-gold btn-sm" onClick={saveMotto} disabled={mottosSaving || logoUploading || !verseValidation.valid} style={{ gap: 6 }}>
              <Save size={14} /> {mottosSaving || logoUploading ? 'جار الحفظ...' : 'حفظ الشعار'}
            </button>
          </div>

          {mottos.length ? (
            <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                    <th style={{ padding: '10px', textAlign: 'right' }}>الشعار</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>فترة التطبيق</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>النطاق</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>المرجع الكتابي</th>
                    <th style={{ padding: '10px', textAlign: 'center' }}>الشعار</th>
                    <th style={{ width: 130 }} />
                  </tr>
                </thead>
                <tbody>
                  {mottos.map((item, index) => {
                    const targetNames = []
                    if (item?.targets?.jec_jordan) targetNames.push('JECJordan')
                    const groups = item?.targets_meta?.youth_groups || []
                    groups.forEach((g) => targetNames.push(g.group_name || g.group_id))

                    const scopeBase = item?.targets?.jec_jordan
                      ? 'شعار شبيبة الأردن'
                      : (groups.length ? `شعار شبيبة ${groups.map((g) => g.group_name || g.group_id).join('، ')}` : 'شعار الشبيبة')
                    const scopeWithYear = item?.year_label
                      ? `${scopeBase} لعام ${item.year_label}`
                      : scopeBase

                    return (
                      <tr key={item.id || `motto-${index}`} style={{ borderBottom: index < mottos.length - 1 ? '1px solid #f1f4f9' : 'none' }}>
                        <td style={{ padding: 10 }}>
                          <div style={{ fontWeight: 700, color: '#1a2a3a' }}>{formatMottoText(item)}</div>
                          <div style={{ color: '#718096', fontSize: '0.78rem' }}>{scopeWithYear}</div>
                        </td>
                        <td style={{ padding: 10, color: '#2d3748' }}>
                          {item?.application_from_date || '—'}
                          {' - '}
                          {item?.application_is_present ? 'حالي' : (item?.application_to_date || '—')}
                        </td>
                        <td style={{ padding: 10, color: '#2d3748' }}>{targetNames.join('، ') || '—'}</td>
                        <td style={{ padding: 10, color: '#2d3748' }}>
                          {(() => {
                            const ref = Array.isArray(item?.bible_references) ? item.bible_references[0] : null
                            if (!ref) return '—'
                            return formatMottoSource(ref) || '—'
                          })()}
                        </td>
                        <td style={{ padding: 10, textAlign: 'center' }}>
                          {item.logo_url ? (
                            <img
                              src={api.mottoLogoUrl(item.id, logoBustById[item.id] || 0)}
                              alt={item.title || 'motto logo'}
                              style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, border: '1px solid #e2e6ef', background: '#fff' }}
                            />
                          ) : (
                            <span style={{ color: '#9ba5bc' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => editMotto(item)} title="تعديل">
                              <Pencil size={14} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => removeMotto(item.id)}
                              disabled={deletingMottoId === String(item.id)}
                              style={{ color: 'var(--red)' }}
                              title="حذف"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyStatePanel title="لا توجد شعارات محفوظة بعد" description="ابدأ بإضافة أول شعار ثم احفظه ليظهر هنا مع فترة التطبيق والنطاق." />}
        </div>
      </div>
      ) : null}

      {activeTab === 'general' ? (
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">الإعدادات العامة</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>
            {activeJecYear ? `سنة JEC الحالية: ${activeJecYear}` : 'غير محددة'}
          </span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <SectionPanel icon={CalendarRange} title="سنة JEC الحالية" hint="تُستخدم هذه القيمة كسنة افتراضية في النوافذ التي تنشئ فترات أو سجلات مرتبطة بسنة JEC.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <OverviewStatCard label="السنة المعتمدة" value={activeJecYear || '—'} note="القيمة الحالية في إعدادات النظام" />
              <OverviewStatCard label="الحالة" value={activeJecYear ? 'مضبوطة' : 'غير مضبوطة'} note="يمكن تركها فارغة إذا لم ترد فرض قيمة افتراضية" />
            </div>
          </SectionPanel>

          <SectionPanel icon={CalendarRange} title="تحديث السنة الافتراضية" hint="أدخل سنة مكونة من 4 أرقام مثل 2026. إذا تُرك الحقل فارغاً، ستبقى بعض الشاشات تستخدم سنة الجهاز الحالية كبديل.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                  سنة JEC الحالية
                </label>
                <input
                  value={activeJecYear}
                  onChange={(e) => setActiveJecYear(String(e.target.value || '').replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="مثال: 2026"
                  style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
                />
              </div>
            </div>
          </SectionPanel>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-gold btn-sm" onClick={handleSave} disabled={saving} style={{ gap: 6 }}>
              <Save size={14} /> {saving ? 'جار الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {activeTab === 'personTitles' ? (
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">ألقاب الأشخاص</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>
            {personTitleCount} لقب
          </span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <SectionPanel icon={Users} title="ما الذي تضبطه هنا؟" hint="أضف الألقاب التي تستخدم مع الأشخاص مثل الأب، الأخت، الأخ. هذه القيم ستظهر لاحقاً في قوائم الإدخال.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <OverviewStatCard label="الألقاب الحالية" value={personTitleCount} note="عدد الألقاب المحفوظة" />
              <OverviewStatCard label="المسودة" value={cleanText(titleArabic) ? 'جاهزة' : 'فارغة'} note="تحقق من اللقب العربي قبل الإضافة" />
            </div>
          </SectionPanel>

          <SectionPanel icon={Users} title="إضافة أو تعديل لقب" hint="اللقب العربي مطلوب، أما الحقل الإنجليزي فهو اختياري لعرض ترجمة أو مقابل مناسب.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                اللقب بالعربية
              </label>
              <input
                value={titleArabic}
                onChange={(e) => setTitleArabic(e.target.value)}
                placeholder="مثال: الأب"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                English Title
              </label>
              <input
                value={titleEnglish}
                onChange={(e) => setTitleEnglish(e.target.value)}
                placeholder="Example: Father"
                style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
              />
            </div>
            <button className="btn btn-gold btn-sm" onClick={addPersonTitleRow} style={{ gap: 6, whiteSpace: 'nowrap' }}>
              <Plus size={14} /> إضافة
            </button>
          </div>
          </SectionPanel>

          {hasPersonTitleRows ? (
            <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>العربية</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: '#4a5568', fontWeight: 700 }}>English</th>
                    <th style={{ padding: '10px 12px', width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {personTitles.map((row, index) => (
                    <tr key={`title-row-${index}`} style={{ borderBottom: index < personTitles.length - 1 ? '1px solid #f1f4f9' : 'none' }}>
                      <td style={{ padding: 10 }}>
                        <input
                          value={row.arabic_title || ''}
                          onChange={(e) => updatePersonTitleRow(index, 'arabic_title', e.target.value)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <input
                          value={row.english_title || ''}
                          onChange={(e) => updatePersonTitleRow(index, 'english_title', e.target.value)}
                          placeholder="Optional"
                          style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)' }}
                          onClick={() => removePersonTitleRow(index)}
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyStatePanel title="لا توجد ألقاب محفوظة بعد" description="أدخل لقباً جديداً من الأعلى ثم احفظ الإعدادات ليتم اعتماده في النماذج." />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-gold btn-sm" onClick={handleSave} disabled={saving} style={{ gap: 6 }}>
              <Save size={14} /> {saving ? 'جار الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {activeTab === 'schoolBranches' ? (
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">فروع المدارس</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>
            {Object.keys(schoolBranches).length} مدرسة / {schoolBranchCount} فرع
          </span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <SectionPanel icon={Building2} title="تنظيم المدارس والفروع" hint="اختر اسم المدرسة أولاً ثم أضف الفروع التابعة لها. تُحفظ الفروع لكل مدرسة بشكل مستقل ضمن إعدادات النظام.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <OverviewStatCard label="عدد المدارس" value={Object.keys(schoolBranches).length} note="مدارس تحتوي على فروع محفوظة" />
              <OverviewStatCard label="إجمالي الفروع" value={schoolBranchCount} note="مجموع الفروع في كل المدارس" />
              <OverviewStatCard label="المدرسة المختارة" value={selectedSchoolName || '—'} note="اختر مدرسة لعرض فروعها" />
            </div>
          </SectionPanel>

          <SectionPanel icon={Building2} title="إضافة فرع جديد" hint="إذا لم تظهر المدرسة في القائمة بعد، تأكد أن مصدر البيانات يوفرها أو اختر مدرسة محفوظة مسبقاً.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                اسم المدرسة
              </label>
              <select value={selectedSchoolName} onChange={(e) => setSelectedSchoolName(e.target.value)} style={inputStyle}>
                <option value="">اختر مدرسة</option>
                {schoolOptionsMerged.map((school) => (
                  <option key={school} value={school}>{school}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                اسم الفرع
              </label>
              <input
                value={schoolBranchInput}
                onChange={(e) => setSchoolBranchInput(e.target.value)}
                placeholder="مثال: فرع طبربور"
                style={inputStyle}
              />
            </div>
            <button className="btn btn-gold btn-sm" onClick={addSchoolBranchRow} style={{ gap: 6, whiteSpace: 'nowrap' }}>
              <Plus size={14} /> إضافة
            </button>
          </div>
          </SectionPanel>

          {selectedSchoolName ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1a2a3a' }}>
                  فروع {selectedSchoolName}
                </div>
                {selectedSchoolBranches.length > 0 ? (
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={removeSelectedSchoolEntry}>
                    <Trash2 size={14} /> حذف المدرسة من القائمة
                  </button>
                ) : null}
              </div>

              {selectedSchoolBranches.length > 0 ? (
                <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                    <thead>
                      <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الفرع</th>
                        <th style={{ padding: '10px 12px', width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSchoolBranches.map((branch, index) => (
                        <tr key={`school-branch-${selectedSchoolName}-${index}`} style={{ borderBottom: index < selectedSchoolBranches.length - 1 ? '1px solid #f1f4f9' : 'none' }}>
                          <td style={{ padding: 10 }}>
                            <input
                              value={branch || ''}
                              onChange={(e) => updateSchoolBranchRow(selectedSchoolName, index, e.target.value)}
                              style={inputStyle}
                            />
                          </td>
                          <td style={{ padding: 10 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--red)' }}
                              onClick={() => removeSchoolBranchRow(selectedSchoolName, index)}
                              title="حذف"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyStatePanel title="لا توجد فروع محفوظة لهذه المدرسة بعد" description="أضف فرعاً من النموذج أعلاه ثم احفظ الإعدادات لتثبيت التغيير." />}
            </div>
          ) : <EmptyStatePanel title="اختر مدرسة لعرض فروعها وإدارتها" description="بعد اختيار المدرسة ستظهر الفروع الحالية ويمكنك تعديلها أو حذفها." />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-gold btn-sm" onClick={handleSave} disabled={saving} style={{ gap: 6 }}>
              <Save size={14} /> {saving ? 'جار الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {activeTab === 'nameVariations' ? (
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">اختلافات الأسماء للبحث</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>
            {rows.length} اسم اساسي / {variationCount} اختلاف
          </span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <SectionPanel icon={Languages} title="كيف تعمل اختلافات الأسماء؟" hint="أدخل اسماً أساسياً واختلافاته الشائعة. عند البحث عن أي اسم، سيبحث النظام أيضاً ضمن الاختلافات المعرفة له.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
              <OverviewStatCard label="الأسماء الأساسية" value={rows.length} note="عدد الأسماء المعرفة" />
              <OverviewStatCard label="إجمالي الاختلافات" value={variationCount} note="كل البدائل المرتبطة بالأسماء" />
              <OverviewStatCard label="مسودة الإدخال" value={cleanText(baseName) ? 'جاهزة' : 'فارغة'} note="أدخل الاسم الأساسي والاختلافات قبل الإضافة" />
            </div>
          </SectionPanel>

          <SectionPanel icon={Languages} title="إضافة اسم واختلافاته" hint="يمكنك فصل الاختلافات بفواصل عربية أو إنجليزية، وسيتم دمج المكرر تلقائياً.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                الاسم الاساسي
              </label>
              <input
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                placeholder="مثال: العودة"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                الاختلافات (افصل بفاصلة)
              </label>
              <input
                value={variationsInput}
                onChange={(e) => setVariationsInput(e.target.value)}
                placeholder="مثال: معايعة، عوده"
                style={inputStyle}
              />
            </div>
            <button className="btn btn-gold btn-sm" onClick={addRow} style={{ gap: 6, whiteSpace: 'nowrap' }}>
              <Plus size={14} /> إضافة
            </button>
          </div>
          </SectionPanel>

          {hasRows ? (
            <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الاسم الاساسي</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الاختلافات</th>
                    <th style={{ padding: '10px 12px', width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`row-${index}`} style={{ borderBottom: index < rows.length - 1 ? '1px solid #f1f4f9' : 'none' }}>
                      <td style={{ padding: 10 }}>
                        <input
                          value={row.base}
                          onChange={(e) => updateRow(index, 'base', e.target.value)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <input
                          value={row.variationsText}
                          onChange={(e) => updateRow(index, 'variationsText', e.target.value)}
                          placeholder="افصل بفاصلة"
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)' }}
                          onClick={() => removeRow(index)}
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyStatePanel title="لا توجد اختلافات أسماء مضافة بعد" description="أضف اسماً أساسياً مع اختلافاته ليستخدمها النظام في البحث الذكي." />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={saving} style={{ gap: 6 }}>
              <RotateCcw size={14} /> إعادة ضبط
            </button>
            <button className="btn btn-gold btn-sm" onClick={handleSave} disabled={saving} style={{ gap: 6 }}>
              <Save size={14} /> {saving ? 'جار الحفظ...' : 'حفظ التغييرات'}
            </button>
          </div>
        </div>
      </div>
      ) : null}

      {activeTab === 'schoolLogos' ? (
      <SchoolLogosTab
        schoolBranches={schoolBranches}
        schoolOptions={schoolOptionsMerged}
        universityOptions={universityOptions}
        schoolLogos={schoolLogos}
        logoEntryType={logoEntryType}
        setLogoEntryType={setLogoEntryType}
        logoEntryName={logoEntryName}
        setLogoEntryName={setLogoEntryName}
        logoEntrySection={logoEntrySection}
        setLogoEntrySection={setLogoEntrySection}
        logoEntryUploading={logoEntryUploading}
        setLogoEntryUploading={setLogoEntryUploading}
        schoolLogoBustById={schoolLogoBustById}
        setSchoolLogoBustById={setSchoolLogoBustById}
        onReload={loadSchoolLogos}
        toast={toast}
      />
      ) : null}
    </div>
  )
}

function SchoolLogosTab({
  schoolBranches,
  schoolOptions,
  universityOptions,
  schoolLogos,
  logoEntryType,
  setLogoEntryType,
  logoEntryName,
  setLogoEntryName,
  logoEntrySection,
  setLogoEntrySection,
  logoEntryUploading,
  setLogoEntryUploading,
  schoolLogoBustById,
  setSchoolLogoBustById,
  onReload,
  toast,
}) {
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [fileByEntryId, setFileByEntryId] = useState({})

  const branches = logoEntryType === 'school' && logoEntryName
    ? (schoolBranches[logoEntryName] || [])
    : []

  const handleCreate = async () => {
    const name = cleanText(logoEntryName)
    if (!name) {
      toast?.('يرجى إدخال الاسم', 'error')
      return
    }
    setCreating(true)
    try {
      await api.createSchoolLogoEntry({
        type: logoEntryType,
        name,
        section: cleanText(logoEntrySection),
      })
      toast?.('تم إضافة المدخل. ارفع الصورة الآن.', 'success')
      setLogoEntryName('')
      setLogoEntrySection('')
      await onReload()
    } catch (err) {
      const msg = err?.message || ''
      if (msg.includes('409') || msg.includes('already')) {
        toast?.('هذا المدخل موجود مسبقاً', 'error')
      } else {
        toast?.('تعذر إضافة المدخل', 'error')
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id) => {
    if (!id) return
    if (!confirm('سيتم حذف هذا المدخل والشعار المرفق معه. هل تريد المتابعة؟')) return
    setDeletingId(String(id))
    try {
      await api.deleteSchoolLogoEntry(id)
      toast?.('تم الحذف', 'success')
      await onReload()
    } catch {
      toast?.('تعذر الحذف', 'error')
    } finally {
      setDeletingId('')
    }
  }

  const handleUpload = async (entryId, file) => {
    if (!file) return
    setLogoEntryUploading(true)
    try {
      await api.uploadSchoolLogo(entryId, file)
      setSchoolLogoBustById((prev) => ({ ...prev, [entryId]: Date.now() }))
      setFileByEntryId((prev) => { const next = { ...prev }; delete next[entryId]; return next })
      toast?.('تم رفع الشعار', 'success')
      await onReload()
    } catch {
      toast?.('تعذر رفع الشعار', 'error')
    } finally {
      setLogoEntryUploading(false)
    }
  }

  const schoolLogosCount = schoolLogos.filter((e) => e.type === 'school').length
  const universityLogosCount = schoolLogos.filter((e) => e.type === 'university').length

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="card-title">شعارات المدارس والجامعات</span>
        <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>{schoolLogos.length} شعار</span>
      </div>

      <div className="card-body" style={{ display: 'grid', gap: 14 }}>
        <SectionPanel
          icon={GraduationCap}
          title="إدارة شعارات المدارس والجامعات"
          hint="يمكنك رفع شعار لكل مدرسة ككل أو لكل فرع على حدة، وكذلك شعار لكل جامعة. الشعار المرفوع على مستوى المدرسة يُطبّق تلقائياً على كل فروعها ما لم يوجد شعار خاص بالفرع."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <OverviewStatCard label="شعارات المدارس" value={schoolLogosCount} note="شعارات مدارس (كل المدرسة أو فرع)" />
            <OverviewStatCard label="شعارات الجامعات" value={universityLogosCount} note="شعارات جامعات وكليات" />
          </div>
        </SectionPanel>

        <SectionPanel
          icon={ImagePlus}
          title="إضافة مدخل جديد"
          hint="اختر النوع، ثم اسم المدرسة أو الجامعة. إذا أردت شعاراً خاصاً بفرع معين اختر الفرع، وإلا اتركه فارغاً ليُطبَّق على المدرسة بأكملها."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>النوع</label>
              <select
                value={logoEntryType}
                onChange={(e) => { setLogoEntryType(e.target.value); setLogoEntryName(''); setLogoEntrySection('') }}
                style={inputStyle}
              >
                <option value="school">مدرسة</option>
                <option value="university">جامعة / كلية</option>
              </select>
            </div>

            {logoEntryType === 'school' ? (
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>المدرسة</label>
                <select
                  value={logoEntryName}
                  onChange={(e) => { setLogoEntryName(e.target.value); setLogoEntrySection('') }}
                  style={inputStyle}
                >
                  <option value="">اختر مدرسة</option>
                  {schoolOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>الجامعة / الكلية</label>
                <select
                  value={logoEntryName}
                  onChange={(e) => setLogoEntryName(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">اختر جامعة</option>
                  {universityOptions.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            )}

            {logoEntryType === 'school' && branches.length > 0 ? (
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>الفرع (اختياري)</label>
                <select
                  value={logoEntrySection}
                  onChange={(e) => setLogoEntrySection(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">كل الفروع (شعار عام للمدرسة)</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <button
              className="btn btn-gold btn-sm"
              onClick={handleCreate}
              disabled={creating || !cleanText(logoEntryName)}
              style={{ gap: 6, whiteSpace: 'nowrap' }}
            >
              <Plus size={14} /> {creating ? 'جار الإضافة...' : 'إضافة'}
            </button>
          </div>
        </SectionPanel>

        {schoolLogos.length > 0 ? (
          <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>النوع</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الاسم</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الفرع</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#4a5568', fontWeight: 700 }}>الشعار</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>رفع شعار</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {schoolLogos.map((entry, index) => {
                  const entryId = entry.id
                  const bust = schoolLogoBustById[entryId] || 0
                  const selectedFile = fileByEntryId[entryId] || null
                  return (
                    <tr key={entryId || `sl-${index}`} style={{ borderBottom: index < schoolLogos.length - 1 ? '1px solid #f1f4f9' : 'none' }}>
                      <td style={{ padding: 10, color: '#2d3748' }}>
                        {entry.type === 'university' ? 'جامعة' : 'مدرسة'}
                      </td>
                      <td style={{ padding: 10, fontWeight: 700, color: '#1a2a3a' }}>{entry.name || '—'}</td>
                      <td style={{ padding: 10, color: '#718096' }}>
                        {entry.section ? entry.section : <span style={{ color: '#b0b8cc', fontStyle: 'italic' }}>كل الفروع</span>}
                      </td>
                      <td style={{ padding: 10, textAlign: 'center' }}>
                        {entry.logo_url ? (
                          <img
                            src={api.schoolLogoUrl(entryId, bust)}
                            alt={entry.name}
                            style={{ width: 38, height: 38, objectFit: 'contain', borderRadius: 6, border: '1px solid #e2e6ef', background: '#fff' }}
                          />
                        ) : (
                          <span style={{ color: '#9ba5bc', fontSize: '0.78rem' }}>لا يوجد</span>
                        )}
                      </td>
                      <td style={{ padding: 10 }}>
                        <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }} className="btn btn-ghost btn-sm">
                          <ImagePlus size={13} />
                          {selectedFile ? selectedFile.name.slice(0, 18) + (selectedFile.name.length > 18 ? '…' : '') : 'اختيار'}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null
                              if (file) {
                                setFileByEntryId((prev) => ({ ...prev, [entryId]: file }))
                                handleUpload(entryId, file)
                              }
                            }}
                          />
                        </label>
                        {logoEntryUploading ? <span style={{ fontSize: '0.74rem', color: '#718096', marginRight: 4 }}>جار الرفع...</span> : null}
                      </td>
                      <td style={{ padding: 10 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)' }}
                          onClick={() => handleDelete(entryId)}
                          disabled={deletingId === String(entryId)}
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyStatePanel
            title="لا توجد شعارات مضافة بعد"
            description="أضف مدخلاً جديداً من النموذج أعلاه ثم ارفع الصورة المناسبة."
          />
        )}
      </div>
    </div>
  )
}
