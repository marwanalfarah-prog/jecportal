import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, RotateCcw, ImagePlus, Pencil, X, Search, ChevronDown } from 'lucide-react'
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

export default function Config({ toast }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState([])

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

  const variationCount = useMemo(() => rows.reduce((sum, row) => sum + parseVariations(row.variationsText).length, 0), [rows])
  const verseValidation = useMemo(() => validateVersesInput(selectedVersesInput), [selectedVersesInput])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const response = await api.getConfig()
      const nameVariations = normalizeMap(response?.config?.name_variations || {})
      const parsedRows = Object.entries(nameVariations).map(([base, variations]) => ({
        base,
        variationsText: variations.join('، '),
      }))
      setRows(parsedRows)
    } catch {
      toast?.('تعذر تحميل الإعدادات', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([loadConfig(), loadMottosData()])
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

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { name_variations: buildPayloadMap() }
      await api.putConfig(payload)
      toast?.('تم حفظ اختلافات الأسماء', 'success')
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
      await api.resetConfig()
      toast?.('تمت إعادة الضبط', 'success')
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

  if (loading || mottosLoading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">إدارة شعار سنة الشبيبة</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>{mottos.length} شعار محفوظ</span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e6ef',
            borderRadius: 10,
            padding: 12,
            fontSize: '0.83rem',
            color: '#4a5568',
            lineHeight: 1.7,
          }}>
            يمكنك إضافة شعار خاص بـ JECJordan و/أو فرق شبيبة محددة، مع مرجع كتابي واحد منظم (مسار الكتاب + أرقام الآيات).
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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

          <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: '0.82rem', color: '#4a5568', fontWeight: 700 }}>فترة تطبيق الشعار</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
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
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.84rem', color: '#2d3748', paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={applicationIsPresent}
                  onChange={(e) => setApplicationIsPresent(e.target.checked)}
                />
                حالي
              </label>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: '0.82rem', color: '#4a5568', fontWeight: 700 }}>نطاق تطبيق الشعار</div>
            <ScopeDropdown options={scopeOptions} selectedValues={targetScopes} onChange={setTargetScopes} />
          </div>

          <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: '0.82rem', color: '#4a5568', fontWeight: 700 }}>المرجع الكتابي</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
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
          </div>

          <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: '0.82rem', color: '#4a5568', fontWeight: 700 }}>صورة الشعار</div>
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
          </div>

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
          ) : (
            <div style={{ textAlign: 'center', color: '#9ba5bc', padding: '8px 0', fontSize: '0.86rem' }}>
              لا توجد شعارات محفوظة بعد.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">اختلافات الأسماء للبحث</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>
            {rows.length} اسم اساسي / {variationCount} اختلاف
          </span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e6ef',
            borderRadius: 10,
            padding: 12,
            fontSize: '0.83rem',
            color: '#4a5568',
            lineHeight: 1.7,
          }}>
            أدخل اسما اساسيا واختلافاته. مثال: العودة {'->'} معايعة. عند البحث عن اي اسم، سيبحث النظام ايضا في الاختلافات المعرفة له.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, alignItems: 'end' }}>
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
          ) : (
            <div style={{ textAlign: 'center', color: '#9ba5bc', padding: '18px 0', fontSize: '0.86rem' }}>
              لا توجد اختلافات أسماء مضافة بعد.
            </div>
          )}

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
    </div>
  )
}
