import { useEffect, useState, useRef, useMemo, useDeferredValue } from 'react'
import { Search, ChevronRight, ChevronLeft, UserPlus, ArrowUpAZ, ArrowDownAZ, ChevronDown, X, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { api } from '../api.js'

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
  return [p.first_name, p.second_name, p.third_name, p.last_name]
    .filter(Boolean).map(normalizeArabic)
}

function getDisplayName(p) {
  return [p.title, p.first_name, p.second_name, p.third_name, p.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
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
  const youthGroups = Array.isArray(person?._youth_groups)
    ? person._youth_groups.map(value => toYouthGroupShortLabel(value))
    : []

  const ageGroups = Array.isArray(person?._age_groups)
    ? person._age_groups.map(value => String(value ?? '').trim())
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

const PERSON_SEARCH_CACHE = new WeakMap()
function getCachedSearchFields(p) {
  const cached = PERSON_SEARCH_CACHE.get(p)
  if (cached) return cached

  const computed = {
    nameParts: getNameParts(p),
    otherFields: [p.gender, p.governorate, String(p.birth_year ?? '')].map(normalizeArabic),
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
const COL_DEFS = [
  { key: 'first_name',      label: 'الاسم الأول',         filterKey: 'first_name',      dataKey: 'first_name' },
  { key: 'second_name',     label: 'الاسم الثاني',         filterKey: 'second_name',     dataKey: 'second_name' },
  { key: 'third_name',      label: 'الاسم الثالث',         filterKey: 'third_name',      dataKey: 'third_name' },
  { key: 'last_name',       label: 'اسم العائلة',           filterKey: 'last_name',       dataKey: 'last_name' },
  { key: 'gender',          label: 'الجنس',                 filterKey: 'gender',          dataKey: 'gender' },
  { key: 'governorate',     label: 'المحافظة',               filterKey: 'governorate',     dataKey: 'governorate' },
  { key: 'birth_year',      label: 'سنة الميلاد',           filterKey: 'birth_year',      dataKey: 'birth_year' },
  { key: 'nationality',     label: 'الجنسية',                filterKey: 'nationality',     dataKey: p => p._nationalities },
  { key: 'youth_group',     label: 'فرقة الشبيبة',          filterKey: 'youth_group',     dataKey: p => p._youth_groups },
  { key: 'age_group',       label: 'الفئة العمرية',          filterKey: 'age_group',       dataKey: p => p._age_groups },
  { key: 'youth_join_year', label: 'سنة الانتساب',           filterKey: 'youth_join_year', dataKey: p => p._youth_join_years },
  { key: 'responsibility_youth_group', label: 'مسؤولية في',     filterKey: 'responsibility_youth_group', dataKey: p => p._responsibility_youth_groups },
  { key: 'responsibility_time',        label: 'الفترة',       filterKey: 'responsibility_time',        dataKey: p => p._responsibility_times },
  { key: 'responsibility',             label: 'المسؤولية',    filterKey: 'responsibility',             dataKey: p => p._responsibilities },
  { key: 'school',          label: 'المدرسة',                filterKey: 'school',          dataKey: p => p._schools },
  { key: 'university',      label: 'الجامعة / الكلية',      filterKey: 'university',      dataKey: p => p._universities },
  { key: 'major',           label: 'التخصص',                 filterKey: 'major',           dataKey: p => p._majors },
  { key: 'degree',          label: 'الدرجة العلمية',         filterKey: 'degree',          dataKey: p => p._degrees },
  { key: 'job_title',       label: 'المسمى الوظيفي',         filterKey: 'job_title',       dataKey: p => p._job_titles },
  { key: 'company',         label: 'الشركة',                 filterKey: 'company',         dataKey: p => p._companies },
  { key: 'hobby_skill',     label: 'الهوايات والمهارات',    filterKey: 'hobby_skill',     dataKey: p => p._hobbies },
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
export default function Members({ onSelectPerson, onSelectUnregistered, onAdd, toast }) {
  const [activeTab, setActiveTab]         = useState('registered')
  const [allPersons, setAllPersons]       = useState([])
  const [unregistered, setUnreg]          = useState([])
  const [loading, setLoading]             = useState(true)
  const [unregLoading, setUnregLoading]   = useState(true)
  const [confirm, setConfirm]             = useState(null) // { type, id, name, action }
  const [archivePrompt, setArchivePrompt] = useState(null) // { type, id, name, options, selectedId }

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
  const [archiveGroup, setArchiveGroup]   = useState('all')
  const [nameVariations, setNameVariations] = useState({})
  const PER_PAGE = 50

  const nameAliasLookup = useMemo(() => buildNameAliasLookup(nameVariations), [nameVariations])

  useEffect(() => {
    let canceled = false

    ;(async () => {
      try {
        const enriched = await api.personsEnriched()
        if (!canceled) setAllPersons(enriched)
      } finally {
        if (!canceled) setLoading(false)
      }
    })()

    ;(async () => {
      try {
        const unreg = await api.getUnregistered()
        if (!canceled) setUnreg(unreg)
      } finally {
        if (!canceled) setUnregLoading(false)
      }
    })()

    ;(async () => {
      try {
        const cfg = await api.getConfig()
        if (!canceled) setNameVariations(normalizeNameVariations(cfg?.config?.name_variations || {}))
      } catch {
        if (!canceled) setNameVariations({})
      }
    })()

    return () => { canceled = true }
  }, [])

  // Split active vs archived
  const activePersons   = useMemo(() => allPersons.filter(p => !p.archived), [allPersons])
  const archivedPersons = useMemo(() => allPersons.filter(p => p.archived),  [allPersons])
  const activeUnreg     = useMemo(() => unregistered.filter(r => !r.archived), [unregistered])
  const archivedUnreg   = useMemo(() => unregistered.filter(r => r.archived),  [unregistered])
  const archivedAll     = useMemo(() => [
    ...archivedPersons.map(p => ({ ...p, _isReg: true })),
    ...archivedUnreg.map(r => ({ ...r, _isReg: false })),
  ], [archivedPersons, archivedUnreg])

  const toGroupLabel = (groupId) => {
    const gid = String(groupId || '').trim()
    if (!gid) return '—'
    const short = toYouthGroupShortLabel(gid)
    return short || api.formatYouthGroupLabel(gid) || gid
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

  const archiveGroupOptions = useMemo(() => {
    const counts = new Map()
    for (const row of archivedAll) {
      const ids = getArchivedMembershipIds(row)
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: `${toGroupLabel(id)} (${count})` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'))
  }, [archivedAll])

  const visibleArchived = useMemo(() => {
    const qText = normalizeArabic(deferredArchiveQ)
    return archivedAll.filter(row => {
      if (qText) {
        const nameParts = getNameParts(row)
        const words = qText.split(/\s+/).filter(Boolean)
        if (!nameMatches(nameParts, expandQueryWords(words, nameAliasLookup))) return false
      }
      if (archiveGroup !== 'all') {
        const ids = getArchivedMembershipIds(row)
        if (!ids.includes(archiveGroup)) return false
      }
      return true
    })
  }, [archivedAll, deferredArchiveQ, archiveGroup])

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
      const refreshed = await api.personsEnriched()
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
        const refreshed = await api.personsEnriched()
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
        const refreshed = await api.personsEnriched()
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

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

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
        <button className={`tab${activeTab === 'unregistered' ? ' active' : ''}`} onClick={() => setActiveTab('unregistered')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', marginLeft: 5 }}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg>
          غير المسجّلين
          {activeUnreg.length > 0 && (
            <span style={{ background: '#e8b55a', color: '#92400e', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', marginRight: 6 }}>
              {activeUnreg.length.toLocaleString('ar-EG')}
            </span>
          )}
        </button>
        <button className={`tab${activeTab === 'archived' ? ' active' : ''}`} onClick={() => setActiveTab('archived')}>
          <Archive size={14} style={{ display: 'inline', marginLeft: 5 }} />
          الأرشيف
          {archivedAll.length > 0 && (
            <span style={{ background: 'var(--gray-400)', color: 'white', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', marginRight: 6 }}>
              {archivedAll.length.toLocaleString('ar-EG')}
            </span>
          )}
        </button>
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
            <button className={`btn ${showFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters(s => !s)}>
              <ChevronDown size={15} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              فلترة
              {hasAnyFilter && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', marginRight: 2 }} />}
            </button>
            {hasAnyFilter && <button className="btn btn-ghost btn-sm" onClick={clearAll}><X size={14} /> مسح الكل</button>}
            <button className="btn btn-gold" onClick={onAdd}><UserPlus size={16} /> إضافة عضو</button>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px 10px' }}>
              {COL_DEFS.map(col => {
                const opts = cascadedOpts[col.key] ?? []
                if (opts.length === 0) return null
                return <FilterBox key={col.key} label={col.label} allValues={opts} selected={filterState[col.key]?.selected ?? null} sort={filterState[col.key]?.sort ?? null} onChange={(sel, sort) => updateFilter(col.key, sel, sort)} />
              })}
            </div>
          )}

          {/* Count */}
          <div style={{ fontSize: '0.83rem', color: 'var(--gray-500)', marginBottom: 10 }}>
            عرض <strong>{visible.length.toLocaleString('ar-EG')}</strong> من أصل {activePersons.length.toLocaleString('ar-EG')} عضو
            {hasAnyFilter && <span style={{ color: 'var(--gold)', fontWeight: 600, marginRight: 6 }}>(مفلتر)</span>}
          </div>

          {/* List */}
          <div className="card" style={{ overflow: 'hidden' }}>
            {pageRows.length === 0 ? (
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
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" title="أرشفة" onClick={e => handleArchivePerson(e, p)}
                      style={{ padding: '4px 8px', color: 'var(--gray-500)' }}>
                      <Archive size={14} />
                    </button>
                    <button className="btn btn-ghost btn-sm" title="حذف نهائي" onClick={e => handleDeletePerson(e, p)}
                      style={{ padding: '4px 8px', color: 'var(--red)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
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
            <button className={`btn ${showUFilters ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowUFilters(s => !s)}>
              <ChevronDown size={15} style={{ transform: showUFilters ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              فلترة
              {hasAnyUFilter && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', marginRight: 2 }} />}
            </button>
            {hasAnyUFilter && <button className="btn btn-ghost btn-sm" onClick={clearUAll}><X size={14} /> مسح الكل</button>}
          </div>

          {/* Filter panel */}
          {showUFilters && (
            <div style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius-lg)', padding: '16px 18px', marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px 10px' }}>
              {UNREG_COL_DEFS.map(col => {
                const opts = uCascadedOpts[col.key] ?? []
                if (opts.length === 0) return null
                return <FilterBox key={col.key} label={col.label} allValues={opts} selected={uFilterState[col.key]?.selected ?? null} sort={uFilterState[col.key]?.sort ?? null} onChange={(sel, sort) => updateUFilter(col.key, sel, sort)} />
              })}
            </div>
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
          <div style={{ fontSize: '0.83rem', color: 'var(--gray-500)', marginBottom: 10 }}>
            <Archive size={13} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
            الأرشيف — <strong>{visibleArchived.length.toLocaleString('ar-EG')}</strong> من أصل {archivedAll.length.toLocaleString('ar-EG')}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <Search size={17} className="search-icon" />
              <input
                placeholder="بحث في الأرشيف…"
                value={archiveQ}
                onChange={e => setArchiveQ(e.target.value)}
              />
              {archiveQ && <X size={15} style={{ color: 'var(--gray-400)', cursor: 'pointer', flexShrink: 0 }} onClick={() => setArchiveQ('')} />}
            </div>
            <select
              value={archiveGroup}
              onChange={e => setArchiveGroup(e.target.value)}
              style={{
                padding: '9px 12px',
                border: '1.5px solid var(--gray-200)',
                borderRadius: 8,
                fontFamily: 'var(--font-body)',
                fontSize: '0.88rem',
                direction: 'rtl',
                outline: 'none',
                background: 'white',
                minWidth: 170,
              }}
            >
              <option value="all">كل فرق الشبيبة</option>
              {archiveGroupOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>

          {visibleArchived.length === 0 ? (
            <div className="card">
              <div className="empty-state"><Archive size={48} /><p>لا توجد سجلات مؤرشفة</p></div>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {visibleArchived.map(r => {
                const name = getDisplayName(r)
                const isReg = r._isReg
                return (
                  <div key={r.person_id} className="member-row"
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
