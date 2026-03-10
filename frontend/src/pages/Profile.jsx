import { useEffect, useState, useRef, useCallback } from 'react'
import {
  ArrowRight, Pencil, Trash2, Plus, Camera, UserX,
  GraduationCap, Briefcase, Heart, Users, Shield,
  Phone, Globe, School, GitBranch, Archive, ArchiveRestore
} from 'lucide-react'
import { api } from '../api.js'

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
}

// ── Combo dropdown (searchable + free-text "other") ──────────────────────────
// options: [{ value, count }] sorted by count desc
function ComboDropdown({ value, onChange, options, placeholder = '—' }) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [custom, setCustom] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const getLabel = (o) => (o?.label || o?.value)
  const filtered = options.filter(o =>
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
          placeholder="اكتب قيمة…"
          defaultValue={value || ''}
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
        <span style={{ flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || <span style={{ color: 'var(--gray-400)' }}>{placeholder}</span>}
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
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
          />
          <div className="combo-list">
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', color: 'var(--gray-400)', fontSize: '0.82rem' }}>لا توجد نتائج</div>
            )}
            {filtered.map(o => (
              <button type="button" key={o.value} className={`combo-item${value === o.value ? ' selected' : ''}`}
                onClick={() => pick(o.value)}>
                {getLabel(o)}
              </button>
            ))}
            <button type="button" className="combo-item combo-other"
              onClick={() => { setOpen(false); setQuery(''); setCustom(true) }}>
              ＋ أخرى / اكتب يدوياً…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Select-only dropdown (no free text) ───────────────────────────────────────
function SelectDropdown({ value, onChange, options, placeholder = '—' }) {
  return (
    <select
      className="combo-trigger"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      style={{ cursor: 'pointer' }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
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

// ── Editable sub-table ────────────────────────────────────────────────────────
function SubTable({ rows, setRows, columns }) {
  // NOTE: setRows here is NOT a React state setter — it's a plain callback from the parent.
  // We must never pass a functional updater (prev => ...) to it; always pass the new value directly.
  const update = (i, k, v) => setRows(rows.map((row, idx) => idx === i ? { ...row, [k]: v } : row))
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i))
  const addRow = () => setRows([...rows, Object.fromEntries(columns.map(c => [c.key, '']))])
  return (
    <div>
      {rows.length > 0 && (
        <table className="sub-table">
          <thead><tr>
            {columns.map(c => <th key={c.key}>{c.label}</th>)}
            <th style={{ width: 40 }}></th>
          </tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map(c => (
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

// ── Inline field variants ─────────────────────────────────────────────────────
function InlineField({ label, value, onChange }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div className="editable-inline" style={{ flex: 1 }}>
        <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="—" />
        <Pencil size={12} className="edit-icon" />
      </div>
    </div>
  )
}

function InlineComboField({ label, value, onChange, options }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <ComboDropdown value={value} onChange={onChange} options={options} />
      </div>
    </div>
  )
}

function InlineSelectField({ label, value, onChange, options }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <div style={{ flex: 1 }}>
        <SelectDropdown value={value} onChange={onChange} options={options} />
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
// For each period tree in which this person appears, we record:
//   { period, role, connections: { nodeId → { node, relType, periodIds[] } } }
//
// Then we collapse across periods within the same JEC year + same role into a
// single "entry" that shows the merged date span and annotates each connected
// person only when they were NOT present for the full span.

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
      const stableId = thisNode.personId
        ? `reg:${thisNode.personId}`
        : thisNode.unregisteredId
          ? `unreg:${thisNode.unregisteredId}`
          : `node:${thisNode.id}`
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
    const connKey = (n) => n.personId ? `pid:${n.personId}` : n.unregisteredId ? `unreg:${n.unregisteredId}` : `nid:${n.id}`

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
      members.sort((a, b) => {
        if (!!a.node.personId !== !!b.node.personId) return a.node.personId ? -1 : 1
        return (a.node.name || '').localeCompare(b.node.name || '', 'ar')
      })
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
    if (node.personId) onViewProfile(node.personId, false)
    else if (node.unregisteredId) onViewProfile(node.unregisteredId, true)
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
async function loadAllPeriodTrees(nodeMatcher, relevantGroupIds = []) {
  const allPeriodTrees = []
  const groups = (Array.isArray(relevantGroupIds) ? relevantGroupIds : [])
    .map(g => String(g || '').trim())
    .filter(Boolean)

  await Promise.all(groups.map(async (groupName) => {
    try {
      const periods = await api.getOrgTreePeriods(groupName)
      if (!periods?.length) return
      await Promise.all(periods.map(async (period) => {
        try {
          const tree  = await api.getOrgTreePeriod(groupName, period.id)
          const nodes = tree.nodes || []
          const edges = tree.edges || []
          if (!nodes.some(nodeMatcher)) return
          allPeriodTrees.push({ groupName, period, nodes, edges })
        } catch { /* skip */ }
      }))
    } catch { /* skip */ }
  }))

  return allPeriodTrees
}

// ── Org history tab (registered) ──────────────────────────────────────────────
function OrgTab({ personId, orgContext, onViewProfile, relevantGroupIds }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const matcher = (n) => String(n.personId) === String(personId)
    loadAllPeriodTrees(matcher, relevantGroupIds)
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
    loadAllPeriodTrees(matcher, relevantGroupIds)
      .then(trees => { if (!cancelled) { setEntries(buildOrgHistory(matcher, trees)); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [unregisteredId, relevantGroupIds])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  return <OrgHistoryView entries={entries} onViewProfile={onViewProfile} />
}

// ── GS org history helpers ─────────────────────────────────────────────────────
const GS_GROUP_KEY_PROFILE = 'GS'

async function loadGSPeriodTrees(nodeMatcher) {
  const allPeriodTrees = []
  try {
    const periods = await api.getOrgTreePeriods(GS_GROUP_KEY_PROFILE)
    if (!periods?.length) return allPeriodTrees
    await Promise.all(periods.map(async (period) => {
      try {
        const tree  = await api.getOrgTreePeriod(GS_GROUP_KEY_PROFILE, period.id)
        const nodes = tree.nodes || []
        const edges = tree.edges || []
        if (!nodes.some(nodeMatcher)) return
        allPeriodTrees.push({ groupName: 'الأمانة العامة', period, nodes, edges })
      } catch { /* skip */ }
    }))
  } catch { /* skip */ }
  return allPeriodTrees
}

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
    const head = nodes.find(n => n.id === headId)
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
      const stableId = thisNode.personId
        ? `reg:${thisNode.personId}`
        : thisNode.unregisteredId
          ? `unreg:${thisNode.unregisteredId}`
          : `node:${thisNode.id}`
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
  const connKey = (n) => n.personId ? `pid:${n.personId}` : n.unregisteredId ? `unreg:${n.unregisteredId}` : `nid:${n.id}`

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
      members.sort((a, b) => {
        if (!!a.node.personId !== !!b.node.personId) return a.node.personId ? -1 : 1
        return (a.node.name || '').localeCompare(b.node.name || '', 'ar')
      })
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
    loadGSPeriodTrees(matcher)
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
    loadGSPeriodTrees(matcher)
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
  const [promoting, setPromoting] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [filters, setFilters]     = useState({})
  const [confirm, setConfirm]     = useState(null) // { action: 'delete' | 'archive' }
  const saveTimeout = useRef(null)

  // Load filter options once
  useEffect(() => {
    api.filters().then(setFilters).catch(() => {})
  }, [])

  // Helper: get sorted option list for a filter key (count desc, value only)
  const opts = useCallback((key) =>
    (filters[key] || []).map(f => ({
      value: f.value,
      label: key === 'youth_group' ? api.formatYouthGroupLabel(f.label || f.value) : (f.label || f.value),
    }))
  , [filters])

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
        const SUB_KEYS = ['nationality', 'mobile_numbers', 'schools', 'higher_education',
                          'jobs', 'responsibilities', 'person_youth_group', 'hobbies_skills']
        const stripId = (rows) =>
          Array.isArray(rows)
            ? rows.map(row => { const { person_id, ...rest } = row; return rest })
            : []
        const payload = {
          person: newData.person || {},
          ...Object.fromEntries(SUB_KEYS.map(k => [k, stripId(newData[k])])),
        }
        if (isUnregistered) {
          await api.updateUnregistered(personId, payload)
        } else {
          await api.updatePerson(personId, payload)
        }
        toast('تم الحفظ تلقائياً ✓', 'success')
      } catch { toast('خطأ في الحفظ', 'error') }
      setSaving(false)
    }, 1200)
  }

  const update      = (changes)       => { const nd = { ...data, ...changes }; setData(nd); scheduleAutoSave(nd) }
  const updateField = (field, value)  => update({ person: { ...data.person, [field]: value } })
  const updateSub   = (key, newRows)  => update({ [key]: newRows })
  const updateBirthYear = (value) => {
    update({ person: { ...data.person, birth_year: value ? parseInt(value, 10) : null } })
  }
  const updateBirthDate = (day, month) => {
    update({
      person: {
        ...data.person,
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

  const { person, nationality, mobile_numbers, schools, higher_education, jobs, hobbies_skills, person_youth_group, responsibilities } = data

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

  const fullName = [person?.first_name, person?.second_name, person?.third_name, person?.last_name]
    .filter(Boolean).join(' ') || 'بلا اسم'
  const initials = firstNameInitial(person?.first_name)
  const editableYouthRows = (person_youth_group || []).map(row => ({
    ...row,
    status_label: row?.archived ? 'عضو قديم' : 'عضو حالي',
  }))
  // For مكرّسين, prepend title to displayed name in header
  const displayName = (isUnregistered && person?.title)
    ? `${person.title} ${fullName}`.trim()
    : fullName

  const TABS = [
    { id: 'info',    label: 'المعلومات الأساسية', icon: Shield },
    { id: 'youth',   label: 'الشبيبة',            icon: Users },
    { id: 'edu',     label: 'التعليم',             icon: GraduationCap },
    { id: 'work',    label: 'العمل',               icon: Briefcase },
    { id: 'hobbies', label: 'الهوايات',            icon: Heart },
    { id: 'org', label: 'هيكل الشبيبة', icon: GitBranch },
    { id: 'gsorg', label: 'الأمانة العامة', icon: GitBranch },
  ]

  // For photo upload in unregistered profile
  const handlePhotoChange = isUnregistered
    ? (newUrl) => setPhoto(newUrl)
    : (newUrl) => setPhoto(newUrl)

  return (
    <div>
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
          {saving && <span style={{ fontSize: '0.82rem', color: 'var(--gray-400)' }}>جارٍ الحفظ…</span>}
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
          <div className="profile-name">
            {displayName}

          </div>
          <div className="profile-sub">
            {person?.governorate && <span>📍 {person.governorate}</span>}
            {person?.gender      && <span>{person.gender}</span>}
            {person?.birth_year  && <span>🗓 {person.birth_year}</span>}
            {nationality?.[0]    && <span>🌍 {nationality[0].nationality}</span>}

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
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}>
            <t.icon size={14} style={{ display: 'inline', marginLeft: 5 }} />{t.label}
          </button>
        ))}
      </div>

      {/* ── Info ── */}
      {activeTab === 'info' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card">
            <div className="card-header"><span className="card-title"><Shield size={15} /> البيانات الشخصية</span></div>
            <div className="card-body">
              <InlineComboField label="الاسم الأول"   value={person?.first_name}  onChange={v => updateField('first_name', v)}  options={opts('first_name')} />
              <InlineComboField label="الاسم الثاني"  value={person?.second_name} onChange={v => updateField('second_name', v)} options={opts('second_name')} />
              <InlineComboField label="الاسم الثالث"  value={person?.third_name}  onChange={v => updateField('third_name', v)}  options={opts('third_name')} />
              <InlineComboField label="اسم العائلة"   value={person?.last_name}   onChange={v => updateField('last_name', v)}   options={opts('last_name')} />
              <InlineSelectField label="الجنس"        value={person?.gender}      onChange={v => updateField('gender', v)}       options={opts('gender')} />
              <InlineSelectField label="المحافظة"     value={person?.governorate} onChange={v => updateField('governorate', v)}  options={opts('governorate')} />
              <InlineYearField   label="سنة الميلاد"  value={person?.birth_year}  onChange={updateBirthYear} />
              <InlineBirthDateField
                label="تاريخ الميلاد"
                day={person?.birth_day}
                month={person?.birth_month}
                legacyValue={person?.birth_date}
                onChange={updateBirthDate}
              />
              {isUnregistered && (
                <InlineField label="اللقب / العنوان" value={person?.title} onChange={v => updateField('title', v)} />
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><span className="card-title"><Globe size={15} /> الجنسية</span></div>
              <div className="card-body">
                <TagField items={nationality} valueKey="nationality" placeholder="أضف جنسية…"
                  options={opts('nationality')}
                  onAdd={v => updateSub('nationality', [...nationality, { nationality: v }])}
                  onRemove={i => updateSub('nationality', nationality.filter((_, idx) => idx !== i))} />
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title"><Phone size={15} /> أرقام الموبايل</span></div>
              <div className="card-body">
                <TagField items={mobile_numbers} valueKey="mobile_number" placeholder="أضف رقم هاتف…"
                  onAdd={v => updateSub('mobile_numbers', [...mobile_numbers, { mobile_number: v }])}
                  onRemove={i => updateSub('mobile_numbers', mobile_numbers.filter((_, idx) => idx !== i))} />
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title"><School size={15} /> المدرسة</span></div>
              <div className="card-body">
                <TagField items={schools} valueKey="school" placeholder="أضف مدرسة…"
                  options={opts('school')}
                  onAdd={v => updateSub('schools', [...schools, { school: v }])}
                  onRemove={i => updateSub('schools', schools.filter((_, idx) => idx !== i))} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Youth ── */}
      {activeTab === 'youth' && (
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
              {readOnly ? (
                <table className="sub-table">
                  <thead>
                    <tr>
                      <th>اسم الشبيبة</th>
                      <th>سنة الانتساب</th>
                      <th>الفئة العمرية</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePersonYouthGroup.length ? visiblePersonYouthGroup.map((row, i) => (
                      <tr key={i}>
                        <td>{youthGroupName(row?.youth_group_id)}</td>
                        <td>{row?.youth_join_year || '—'}</td>
                        <td>{row?.age_group || '—'}</td>
                        <td>{row?.archived ? 'عضو قديم' : 'عضو حالي'}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} style={{ color: 'var(--gray-400)' }}>لا توجد بيانات ضمن مجموعاتك</td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
              {readOnly ? (
                <table className="sub-table">
                  <thead>
                    <tr>
                      <th>الشبيبة</th>
                      <th>الفترة</th>
                      <th>المسؤولية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResponsibilities.length ? visibleResponsibilities.map((row, i) => (
                      <tr key={i}>
                        <td>{youthGroupName(row?.youth_group_id)}</td>
                        <td>{row?.time || '—'}</td>
                        <td>{row?.responsibility || '—'}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={3} style={{ color: 'var(--gray-400)' }}>لا توجد بيانات ضمن مجموعاتك</td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
      )}

      {/* ── Education ── */}
      {activeTab === 'edu' && (
        <div className="card">
          <div className="card-header"><span className="card-title"><GraduationCap size={15} /> التعليم العالي</span></div>
          <div className="card-body">
            <SubTable rows={higher_education}
              setRows={rows => updateSub('higher_education', rows)}
              columns={[
                { key: 'university_college', label: 'الجامعة / الكلية', comboOptions: opts('university') },
                { key: 'major',              label: 'التخصص',            comboOptions: opts('major') },
                { key: 'degree',             label: 'الدرجة العلمية',    comboOptions: opts('degree').length ? opts('degree') : [
                    { value: 'بكالوريوس' }, { value: 'ماجستير' }, { value: 'دكتوراه' }, { value: 'دبلوم' }
                  ] },
              ]} />
          </div>
        </div>
      )}

      {/* ── Work ── */}
      {activeTab === 'work' && (
        <div className="card">
          <div className="card-header"><span className="card-title"><Briefcase size={15} /> التوظيف</span></div>
          <div className="card-body">
            <SubTable rows={jobs}
              setRows={rows => updateSub('jobs', rows)}
              columns={[
                { key: 'job_title', label: 'المسمى الوظيفي',    comboOptions: opts('job_title') },
                { key: 'company',   label: 'الشركة / المؤسسة',  comboOptions: opts('company') },
              ]} />
          </div>
        </div>
      )}

      {/* ── Hobbies ── */}
      {activeTab === 'hobbies' && (
        <div className="card">
          <div className="card-header"><span className="card-title"><Heart size={15} /> الهوايات والمهارات</span></div>
          <div className="card-body">
            <TagField items={hobbies_skills} valueKey="hobby_skill" placeholder="أضف هواية أو مهارة…"
              options={opts('hobby_skill')}
              onAdd={v => updateSub('hobbies_skills', [...hobbies_skills, { hobby_skill: v }])}
              onRemove={i => updateSub('hobbies_skills', hobbies_skills.filter((_, idx) => idx !== i))} />
          </div>
        </div>
      )}

      {/* ── Org tab ── */}
      {activeTab === 'org' && !isUnregistered && (
        <OrgTab personId={personId} orgContext={orgContext} onViewProfile={onViewProfile} relevantGroupIds={relevantGroupIds} />
      )}
      {activeTab === 'org' && isUnregistered && (
        <OrgTabUnregistered unregisteredId={personId} orgContext={orgContext} onViewProfile={onViewProfile} relevantGroupIds={relevantGroupIds} />
      )}
      {activeTab === 'gsorg' && !isUnregistered && (
        <GSTab personId={personId} onViewProfile={onViewProfile} />
      )}
      {activeTab === 'gsorg' && isUnregistered && (
        <GSTabUnregistered unregisteredId={personId} onViewProfile={onViewProfile} />
      )}
    </div>
  )
}
