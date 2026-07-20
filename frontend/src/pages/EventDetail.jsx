import { useEffect, useState, useCallback, useRef, useDeferredValue, useMemo } from 'react'
import * as XLSX from 'xlsx-js-style'
import {
  ArrowRight, Edit2, X, Plus, Trash2, Upload, Star,
  MapPin, Users, UserCheck, Building2, UserPlus, ChevronDown, ChevronUp,
  Image as ImageIcon, Hash, Download, FileText, Bus, Cake,
} from 'lucide-react'
import { api } from '../api.js'
import { getArabicPersonNameParts, formatArabicPersonName } from '../personName.js'
import EventTeams from './EventTeams.jsx'
import EventSchedule from './EventSchedule.jsx'
import EventBedrooms from './EventBedrooms.jsx'
import EventTransportSupport from './EventTransportSupport.jsx'
import EventBirthdays from './EventBirthdays.jsx'

// ── Search utilities (same logic as Members page) ─────────────────────────────

function _normalizeWord(word) {
  word = String(word)
  word = word.replace(/[ؗ-ًؚ-ْ]/g, '')
  word = word.replace(/ـ/g, '')
  word = word.replace(/[إأآا]/g, 'ا')
  word = word.replace(/[يى]/g, 'ي')
  word = word.replace(/ؤ/g, 'و')
  word = word.replace(/ئ/g, 'ي')
  word = word.replace(/ة/g, 'ه')
  word = word.replace(/^ال/, '')
  return word.toLowerCase().trim()
}
function normalizeAr(text) {
  if (!text) return ''
  return String(text).replace(/\s+/g, ' ').trim().split(' ').map(_normalizeWord).join(' ')
}

function _normalizeNameVariations(raw) {
  const out = {}
  if (!raw) return out
  const entries = Array.isArray(raw)
    ? raw.map(r => [r.name, r.variations])
    : Object.entries(raw)
  for (const [baseRaw, variationsRaw] of entries) {
    const base = normalizeAr(baseRaw)
    if (!base) continue
    const source = Array.isArray(variationsRaw) ? variationsRaw : (typeof variationsRaw === 'string' ? [variationsRaw] : [])
    const values = [...new Set(source.map(v => normalizeAr(v)).filter(v => v && v !== base))]
    out[base] = values
  }
  return out
}

function _buildAliasLookup(variationMap) {
  const map = new Map()
  const ensure = (w) => { if (!map.has(w)) map.set(w, new Set([w])); return map.get(w) }
  for (const [base, vars] of Object.entries(variationMap || {})) {
    if (!base) continue
    const baseSet = ensure(base)
    for (const v of vars || []) {
      if (!v) continue
      baseSet.add(v)
      const vSet = ensure(v)
      vSet.add(base)
      for (const sibling of vars || []) { if (sibling) vSet.add(sibling) }
    }
  }
  return map
}

function _expandQueryWords(words, aliasLookup) {
  return words.map(w => {
    const expanded = new Set([w])
    const exact = aliasLookup.get(w)
    if (exact?.size) exact.forEach(v => expanded.add(v))
    for (const [key, values] of aliasLookup.entries()) {
      if (!key || !values?.size) continue
      if (key.includes(w) || w.includes(key)) values.forEach(v => expanded.add(v))
    }
    return [...expanded]
  })
}

function _nameMatches(parts, queryWordGroups) {
  if (!queryWordGroups.length) return true
  const partMatches = (part, alts) => alts.some(alt => part.includes(alt))
  if (queryWordGroups.every(group => parts.some(p => partMatches(p, group)))) return true
  let pi = 0, qi = 0
  while (pi < parts.length && qi < queryWordGroups.length) {
    if (partMatches(parts[pi], queryWordGroups[qi])) qi++
    pi++
  }
  return qi === queryWordGroups.length
}

function _getPersonNameParts(p) {
  return [
    ...getArabicPersonNameParts(p),
    p.en_first_name, p.en_second_name, p.en_third_name, p.en_last_name,
  ].filter(Boolean).map(normalizeAr)
}

const _SEARCH_CACHE = new WeakMap()
function _getCachedFields(p) {
  if (_SEARCH_CACHE.has(p)) return _SEARCH_CACHE.get(p)
  const computed = { nameParts: _getPersonNameParts(p) }
  _SEARCH_CACHE.set(p, computed)
  return computed
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle = { fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }
const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
  fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', textAlign: 'right', outline: 'none',
  boxSizing: 'border-box',
}

const ALL_AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

// Mirrors backend _populate_arabic_name_from_full_name logic
function parseNameParts(raw) {
  const parts = (raw || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { ar_first_name: parts[0] }
  if (parts.length === 2) return { ar_first_name: parts[0], ar_last_name: parts[1] }
  if (parts.length === 3) return { ar_first_name: parts[0], ar_second_name: parts[1], ar_last_name: parts[2] }
  return { ar_first_name: parts[0], ar_second_name: parts[1], ar_third_name: parts[2], ar_last_name: parts.slice(3).join(' ') }
}

// ── Create New Unregistered Person Modal ──────────────────────────────────────

function CreateUnregisteredModal({ initialName, onBack, onClose, onCreated, toast }) {
  const parsed = parseNameParts(initialName)
  const [firstName,  setFirstName]  = useState(parsed.ar_first_name  || '')
  const [secondName, setSecondName] = useState(parsed.ar_second_name || '')
  const [thirdName,  setThirdName]  = useState(parsed.ar_third_name  || '')
  const [lastName,   setLastName]   = useState(parsed.ar_last_name   || '')
  const [gender,     setGender]     = useState('')
  const [ygId,       setYgId]       = useState('')
  const [ygLabel,    setYgLabel]    = useState('')
  const [ageGroup,   setAgeGroup]   = useState('')
  const [availableYgs, setAvailableYgs] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listYouthGroupProfiles()
      .then(d => setAvailableYgs(d.groups || d.youth_groups || []))
      .catch(() => {})
  }, [])

  const handleSubmit = async () => {
    if (!firstName.trim()) { toast('الاسم الأول مطلوب', 'error'); return }
    setSaving(true)
    try {
      const personYg = ygId && ageGroup
        ? [{ youth_group_id: ygId, age_group: ageGroup }]
        : []
      const res = await api.addUnregistered({
        person: {
          ar_first_name:  firstName.trim()  || undefined,
          ar_second_name: secondName.trim() || undefined,
          ar_third_name:  thirdName.trim()  || undefined,
          ar_last_name:   lastName.trim()   || undefined,
          gender:         gender            || undefined,
        },
        person_youth_group: personYg,
      })
      // Build a person object with the same shape PersonSearchModal returns for unregistered
      const personData = {
        ...(res.record?.person || {}),
        person_id:       res.person_id,
        ar_first_name:   firstName.trim(),
        ar_second_name:  secondName.trim(),
        ar_third_name:   thirdName.trim(),
        ar_last_name:    lastName.trim(),
        gender,
        _type:             'unregistered',
        _youth_group_ids:  ygId    ? [ygId]    : [],
        _youth_groups:     ygLabel ? [ygLabel]  : [],
        _age_groups:       ageGroup ? [ageGroup] : [],
      }
      onCreated(personData)
    } catch (e) {
      toast(e?.message || 'تعذّر إنشاء الملف الشخصي', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 520, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', marginBottom: 20 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', fontSize: '0.82rem', fontFamily: 'var(--font-body)', padding: '2px 6px' }}>
              ← رجوع
            </button>
            <span style={{ fontWeight: 800, color: '#0f2744' }}>إنشاء ملف شخص جديد غير مسجّل</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}>✕</button>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          {/* Name parts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>الاسم الأول <span style={{ color: '#e53e3e' }}>*</span></label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} style={inputStyle} placeholder="مطلوب" autoFocus />
            </div>
            <div>
              <label style={labelStyle}>الاسم الثاني</label>
              <input value={secondName} onChange={e => setSecondName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>الاسم الثالث</label>
              <input value={thirdName} onChange={e => setThirdName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>اللقب / اسم العائلة</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Gender */}
          <div>
            <label style={labelStyle}>الجنس</label>
            <select value={gender} onChange={e => setGender(e.target.value)} style={inputStyle}>
              <option value="">— اختياري —</option>
              <option value="ذكر">ذكر</option>
              <option value="أنثى">أنثى</option>
            </select>
          </div>

          {/* YG + age group */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>فرقة الشبيبة</label>
              <select value={ygId} onChange={e => {
                const yg = availableYgs.find(g => (g.group_id || g.youth_group_id) === e.target.value)
                setYgId(e.target.value)
                setYgLabel(yg?.group_name || yg?.name || yg?.group_id || yg?.youth_group_id || e.target.value)
              }} style={inputStyle}>
                <option value="">— اختياري —</option>
                {availableYgs.map(g => {
                  const id = g.group_id || g.youth_group_id
                  return <option key={id} value={id}>{g.group_name || g.name || id}</option>
                })}
              </select>
            </div>
            <div>
              <label style={labelStyle}>الفئة العمريّة</label>
              <select value={ageGroup} onChange={e => setAgeGroup(e.target.value)} style={inputStyle}>
                <option value="">— اختياري —</option>
                {ALL_AGE_GROUPS.map(ag => <option key={ag} value={ag}>{ag}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onBack} className="btn btn-ghost btn-sm">رجوع</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-gold btn-sm">
            {saving ? 'جارٍ الإنشاء...' : 'إنشاء وإضافة'}
          </button>
        </div>
      </div>
    </div>
  )
}
const chipBtn = {
  padding: '4px 12px', border: '1.5px solid #e2e6ef', borderRadius: 20, background: 'white',
  cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: '#4a5568',
  transition: '0.15s', fontWeight: 600,
}
const chipBtnActive = { background: '#0f2744', color: 'white', borderColor: '#0f2744' }

// ── Approval flow utilities ───────────────────────────────────────────────────

const PROPOSAL_ST = new Set(['مقترح من اللجنة', 'مقترح من الشبيبة', 'مقترح من الأمانة العامة'])
const FINAL_REJECTED_ST = new Set([
  'تم الاعتذار من مكتب الأمانة', 'تم الاعتذار من المسؤول العام',
  'تم الاعتذار من مسؤول اللجنة', 'تم الاعتذار من الشخص',
])
const FINAL_APPROVED_ST = 'تمت الموافقة من الشخص'

function isFinalStatus(s) { return FINAL_REJECTED_ST.has(s) || s === FINAL_APPROVED_ST }
function isRejectedStatus(s) { return FINAL_REJECTED_ST.has(s) }

function getNextApprove(status, isInGsTree, skipMasoulStep) {
  if (PROPOSAL_ST.has(status)) return 'بانتظار موافقة مكتب الأمانة'
  if (status === 'بانتظار موافقة مكتب الأمانة') {
    if (skipMasoulStep) return 'بانتظار موافقة الشخص'
    return isInGsTree ? 'بانتظار موافقة مسؤول اللجنة' : 'بانتظار موافقة المسؤول العام'
  }
  if (status === 'بانتظار موافقة المسؤول العام' || status === 'بانتظار موافقة مسؤول اللجنة')
    return 'بانتظار موافقة الشخص'
  if (status === 'بانتظار موافقة الشخص') return FINAL_APPROVED_ST
  return null
}

function getNextReject(status) {
  if (status === 'بانتظار موافقة مكتب الأمانة') return 'تم الاعتذار من مكتب الأمانة'
  if (status === 'بانتظار موافقة المسؤول العام') return 'تم الاعتذار من المسؤول العام'
  if (status === 'بانتظار موافقة مسؤول اللجنة') return 'تم الاعتذار من مسؤول اللجنة'
  if (status === 'بانتظار موافقة الشخص') return 'تم الاعتذار من الشخص'
  return null
}

function getStepIndex(status) {
  if (PROPOSAL_ST.has(status)) return 0
  if (status === 'بانتظار موافقة مكتب الأمانة' || status === 'تم الاعتذار من مكتب الأمانة') return 1
  if (['بانتظار موافقة المسؤول العام', 'بانتظار موافقة مسؤول اللجنة',
       'تم الاعتذار من المسؤول العام', 'تم الاعتذار من مسؤول اللجنة'].includes(status)) return 2
  if (status === 'بانتظار موافقة الشخص' || status === 'تم الاعتذار من الشخص') return 3
  if (status === FINAL_APPROVED_ST) return 4
  return 0
}

// ── Status Flow Component ─────────────────────────────────────────────────────

function StatusFlow({ status, isInGsTree, skipMasoulStep }) {
  const steps = [
    { label: 'مقترح',          skipped: false },
    { label: 'مكتب الأمانة',   skipped: false },
    { label: isInGsTree ? 'مسؤول اللجنة' : 'المسؤول العام', skipped: !!skipMasoulStep },
    { label: 'الشخص',          skipped: false },
    { label: '✓',              skipped: false },
  ]
  const currentIdx = getStepIndex(status)
  const rejected   = isRejectedStatus(status)
  const approved   = status === FINAL_APPROVED_ST

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 8, marginTop: 2, flexWrap: 'nowrap', overflowX: 'auto' }}>
      {steps.map(({ label, skipped }, i) => {
        const isActive  = i === currentIdx && !rejected && !approved && !skipped
        const isDone    = (i < currentIdx || approved) && !skipped
        const isRejHere = rejected && i === currentIdx
        const dotColor  = isRejHere ? '#fca5a5' : skipped ? '#e5e7eb' : isActive ? '#fcd34d' : isDone ? '#86efac' : '#e5e7eb'
        const textColor = isRejHere ? '#dc2626' : skipped ? '#d1d5db' : isActive ? '#92400e' : isDone ? '#374151' : '#c5cdd8'
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: skipped ? 0.4 : 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, transition: '0.15s' }} />
              <span style={{ fontSize: '0.62rem', fontWeight: isActive || isRejHere ? 700 : 500, color: textColor, whiteSpace: 'nowrap', textDecoration: skipped ? 'line-through' : 'none' }}>
                {isRejHere ? `✗ ${label}` : label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span style={{ fontSize: '0.5rem', color: '#d1d5db', margin: '0 2px' }}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const SUPERVISOR_STATUSES = [
  'مقترح من اللجنة', 'مقترح من الشبيبة', 'مقترح من الأمانة العامة',
  'بانتظار موافقة مكتب الأمانة', 'بانتظار موافقة المسؤول العام',
  'بانتظار موافقة مسؤول اللجنة', 'بانتظار موافقة الشخص',
  'تمت الموافقة من الشخص',
  'تم الاعتذار من مكتب الأمانة', 'تم الاعتذار من المسؤول العام',
  'تم الاعتذار من مسؤول اللجنة', 'تم الاعتذار من الشخص',
]
const PROPOSAL_STATUSES = new Set(['مقترح من اللجنة', 'مقترح من الشبيبة', 'مقترح من الأمانة العامة'])
const FINAL_APPROVED = 'تمت الموافقة من الشخص'

function statusColor(status) {
  if (PROPOSAL_STATUSES.has(status)) return { bg: '#fffbeb', color: '#92400e', border: '#fde68a' }
  if (status === FINAL_APPROVED) return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' }
  if (status?.includes('اعتذار')) return { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' }
  return { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' }
}

function StatusBadge({ status }) {
  const c = statusColor(status)
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: c.bg, color: c.color, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

const ATTENDANCE_STATUS_OPTIONS = [
  { value: 'registered', label: 'مسجّل', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  { value: 'attended', label: 'حضر', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  { value: 'apologized', label: 'اعتذر', bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
]

function getAttendanceStatus(entry) {
  const status = entry?.attendance_status
  return ATTENDANCE_STATUS_OPTIONS.some(opt => opt.value === status) ? status : 'registered'
}

function isAttendanceApologized(entry) {
  return entry?.attendance_status === 'apologized'
}

function shouldShowAttendanceStatus(regType, entry) {
  if (regType === 'members' || regType === 'guests') return true
  if (regType === 'supervisors' || regType === 'gs_committee') return entry?.status === FINAL_APPROVED_ST
  return false
}

function AttendanceStatusBadge({ entry }) {
  const option = ATTENDANCE_STATUS_OPTIONS.find(opt => opt.value === getAttendanceStatus(entry)) || ATTENDANCE_STATUS_OPTIONS[0]
  return (
    <span style={{ fontSize: '0.63rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: option.bg, color: option.color, border: `1px solid ${option.border}`, whiteSpace: 'nowrap' }}>
      {option.label}
    </span>
  )
}

function AttendanceApologyDetails({ entry }) {
  if (!isAttendanceApologized(entry) || (!entry.apology_date && !entry.apology_reason)) return null
  return (
    <div style={{ fontSize: '0.7rem', color: '#b91c1c', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 7, padding: '4px 8px', marginTop: 5 }}>
      {entry.apology_date && <span style={{ fontWeight: 700 }}>{entry.apology_date}</span>}
      {entry.apology_date && entry.apology_reason && <span> · </span>}
      {entry.apology_reason && <span>{entry.apology_reason}</span>}
    </div>
  )
}

function formatDt(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('ar-JO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

function SectionCard({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid #e2e6ef', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f7f9ff', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#0f2744', fontSize: '0.88rem' }}>
          {Icon && <Icon size={16} color="#0f2744" />} {title}
        </div>
        {open ? <ChevronUp size={15} color="#9ba5bc" /> : <ChevronDown size={15} color="#9ba5bc" />}
      </button>
      {open && <div style={{ padding: '16px' }}>{children}</div>}
    </div>
  )
}

// ── Person Search Modal ───────────────────────────────────────────────────────

function PersonSearchModal({ onSelect, onCreateNew, onClose, title = 'اختر شخصاً' }) {
  const [search, setSearch]         = useState('')
  const deferredSearch              = useDeferredValue(search)
  const [registered, setRegistered] = useState([])
  const [unregistered, setUnreg]    = useState([])
  const [aliasLookup, setAlias]     = useState(new Map())
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    let canceled = false
    Promise.all([
      api.membersIndex(),
      api.getUnregistered(),
      api.getConfig(),
    ]).then(([mi, unreg, cfg]) => {
      if (canceled) return
      setRegistered((Array.isArray(mi) ? mi : []).map(m => ({ ...m, _type: 'registered' })))
      setUnreg((Array.isArray(unreg) ? unreg : []).map(p => ({ ...p, _type: 'unregistered' })))
      const variations = _normalizeNameVariations(cfg?.config?.name_variations || {})
      setAlias(_buildAliasLookup(variations))
      setLoading(false)
    }).catch(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = deferredSearch.trim()
    if (!q) return [...registered.slice(0, 50), ...unregistered.slice(0, 20)]

    const normQ = normalizeAr(q)
    const qWords = normQ.split(/\s+/).filter(Boolean)
    const qWordGroups = _expandQueryWords(qWords, aliasLookup)

    const matchReg = registered.filter(p => {
      const { nameParts } = _getCachedFields(p)
      return _nameMatches(nameParts, qWordGroups)
    })

    // Unregistered persons have the same ar_first_name/ar_second_name/… shape as registered
    const matchUnreg = unregistered.filter(p => {
      const { nameParts } = _getCachedFields(p)
      return _nameMatches(nameParts, qWordGroups)
    })

    return [...matchReg, ...matchUnreg]
  }, [deferredSearch, registered, unregistered, aliasLookup])

  const isPending = search !== deferredSearch

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', fontWeight: 800, color: '#0f2744', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}>✕</button>
        </div>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #f5f6fa', position: 'relative' }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالاسم (عربي أو إنجليزي)…"
            style={inputStyle}
          />
          {isPending && (
            <div style={{ position: 'absolute', left: 26, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14 }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
            </div>
          )}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          ) : (
            <>
              {filtered.map(m => {
                const key = m._type === 'unregistered' ? `unreg-${m.person_id}` : `reg-${m.person_id}`
                const displayName = formatArabicPersonName(m) || m.person_id
                const sub = (() => {
                  if (m._type === 'unregistered') return 'غير مسجّل في النظام'
                  const ygs  = Array.isArray(m._youth_groups)  ? m._youth_groups  : []
                  const ages = Array.isArray(m._age_groups)    ? m._age_groups    : []
                  if (!ygs.length) return ''
                  const parts = ygs.map((yg, i) => ages[i] ? `${yg} · ${ages[i]}` : yg)
                  // Show all YGs if ≤2, otherwise first + count
                  return parts.length <= 2
                    ? parts.join('  |  ')
                    : `${parts[0]}  (+${parts.length - 1})`
                })()
                return (
                  <button key={key} onClick={() => onSelect({
                    ...m,
                    display_name: displayName,
                    // ensure the right ID field is set per type
                    person_id: m._type === 'registered' ? m.person_id : null,
                    unregistered_id: m._type === 'unregistered' ? m.person_id : null,
                  })}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'right', borderBottom: '1px solid #f5f6fa', fontFamily: 'var(--font-body)' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f7f9ff'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: m._type === 'unregistered' ? '#fffbeb' : '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${m._type === 'unregistered' ? '#fde68a' : '#c5d8f8'}`, fontSize: '0.75rem', fontWeight: 800, color: m._type === 'unregistered' ? '#92400e' : '#0f2744' }}>
                      {(displayName[0] || '؟')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f2744', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sub}
                        {m._type === 'registered' && (m._youth_group_ids?.length || 0) > 1 && (
                          <span style={{ marginRight: 4, fontSize: '0.65rem', background: '#e0e7ff', color: '#4338ca', padding: '0px 5px', borderRadius: 6, fontWeight: 700, verticalAlign: 'middle' }}>
                            {m._youth_group_ids.length} فرق
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}

              {/* Create new unregistered profile */}
              {search.trim() && onCreateNew && (
                <button
                  onClick={() => onCreateNew(search.trim())}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', border: 'none', background: '#fffbeb', cursor: 'pointer', textAlign: 'right', fontFamily: 'var(--font-body)' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fffbeb'}
                >
                  <UserPlus size={14} color="#92400e" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#92400e' }}>
                      إنشاء ملف جديد لـ "{search.trim()}"
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: 1 }}>
                      سيتم إنشاء ملف شخصي غير مسجّل في النظام
                    </div>
                  </div>
                </button>
              )}

              {!loading && filtered.length === 0 && !search.trim() && (
                <div style={{ padding: 40, textAlign: 'center', color: '#9ba5bc', fontSize: '0.85rem' }}>ابدأ بالكتابة للبحث</div>
              )}
              {!loading && filtered.length === 0 && search.trim() && (
                <div style={{ padding: '20px', textAlign: 'center', color: '#9ba5bc', fontSize: '0.85rem' }}>لا توجد نتائج مطابقة</div>
              )}
            </>
          )}
        </div>
        <div style={{ padding: '8px 18px', borderTop: '1px solid #f5f6fa', fontSize: '0.72rem', color: '#9ba5bc', textAlign: 'center' }}>
          {!loading && `${registered.length + unregistered.length} شخص في النظام`}
        </div>
      </div>
    </div>
  )
}

// ── Hulls Multi-Select ────────────────────────────────────────────────────────

function HullsSelector({ hulls, setHulls, hullInput, setHullInput, existingHulls }) {
  const addHull = (name) => {
    const trimmed = name.trim()
    if (trimmed && !hulls.includes(trimmed)) {
      setHulls(prev => [...prev, trimmed])
    }
    setHullInput('')
  }

  const removeHull = (name) => setHulls(prev => prev.filter(h => h !== name))

  const suggestions = existingHulls.filter(h => !hulls.includes(h))

  return (
    <div>
      <label style={labelStyle}>الهياكل</label>
      {hulls.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {hulls.map(h => (
            <span key={h} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 12, padding: '2px 8px 2px 6px', fontWeight: 600 }}>
              {h}
              <button type="button" onClick={() => removeHull(h)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', padding: 0, lineHeight: 1, fontSize: '0.8rem', fontWeight: 700 }}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={hullInput}
          onChange={e => setHullInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHull(hullInput) } }}
          style={{ ...inputStyle, flex: 1 }}
          placeholder="اكتب اسم الهيكل واضغط Enter…"
        />
        {hullInput.trim() && (
          <button type="button" onClick={() => addHull(hullInput)}
            style={{ padding: '0 12px', border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', color: '#1d4ed8', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            إضافة
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <div style={{ marginTop: 7, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {suggestions.map(h => (
            <button key={h} type="button" onClick={() => addHull(h)}
              style={{ fontSize: '0.72rem', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 10, padding: '2px 9px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 500 }}>
              + {h}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add Registration Entry Modal ──────────────────────────────────────────────

function _buildYgOptions(p) {
  if (!p || p._type === 'new_unreg') return []
  // _youth_group_ids / _youth_groups / _age_groups are guaranteed parallel arrays
  // (all three are built from the same active_youth_rows list in build_members_index)
  const ids    = Array.isArray(p._youth_group_ids) ? p._youth_group_ids : []
  const labels = Array.isArray(p._youth_groups)    ? p._youth_groups    : []
  const ages   = Array.isArray(p._age_groups)      ? p._age_groups      : []
  return ids
    .map((id, i) => ({
      id:        String(id        || '').trim(),
      label:     String(labels[i] || id || '').trim(),
      age_group: String(ages[i]   || '').trim(),
    }))
    .filter(o => o.id)
}

function AddRegModal({ regType, nights, onClose, onAdded, toast, existingHulls = [] }) {
  const [step, setStep] = useState('search') // 'search' | 'create_unreg' | 'details'
  const [newUnregName, setNewUnregName]       = useState('')
  const [person, setPerson]                   = useState(null)
  const [status, setStatus]                   = useState('مقترح من اللجنة')
  const [role, setRole]                       = useState('')
  const [hulls, setHulls]                     = useState([])
  const [hullInput, setHullInput]             = useState('')
  const [reason, setReason]                   = useState('')
  const [notes, setNotes]                     = useState('')
  const [nightsStaying, setNightsStaying]     = useState([])
  const [saving, setSaving]                   = useState(false)
  const [loadingGsRole, setLoadingGsRole]     = useState(false)
  const [confirmationStatus, setConfirmSt]    = useState('confirmed')
  // YG selection
  const [ygOptions, setYgOptions]       = useState([])
  const [selectedYgIdx, setSelectedYgIdx] = useState(0)
  const [manualYgId, setManualYgId]     = useState('')
  const [availableYgs, setAvailableYgs] = useState([])

  const isSupervisionType = regType === 'supervisors' || regType === 'gs_committee'
  const showYgSelector    = regType === 'members' || regType === 'supervisors'

  useEffect(() => {
    api.listYouthGroupProfiles()
      .then(d => setAvailableYgs(d.groups || d.youth_groups || []))
      .catch(() => {})
  }, [])

  const handlePersonSelect = async (p) => {
    setPerson(p)
    const opts = _buildYgOptions(p)
    setYgOptions(opts)
    setSelectedYgIdx(0)

    const contextPersonId = p._type === 'registered'
      ? p.person_id
      : (p.unregistered_id || p.person_id)

    if (isSupervisionType && contextPersonId) {
      setLoadingGsRole(true)
      setStep('details')
      try {
        const res = await api.getPersonRegContext(contextPersonId)
        if (regType === 'gs_committee' && res.gs_role) setRole(res.gs_role)
      } catch {}
      setLoadingGsRole(false)
    } else {
      setStep('details')
    }
  }

  // Resolve selected YG id for the body
  const resolvedYg = (() => {
    if (!showYgSelector) return {}
    if (ygOptions.length > 0) {
      const sel = ygOptions[selectedYgIdx] || ygOptions[0]
      return { youth_group_id: sel.id || null }
    }
    return { youth_group_id: manualYgId || null }
  })()

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const body = {
        person_id: person._type === 'registered'
          ? person.person_id
          : (person.unregistered_id || person.person_id),
        notes,
        nights_staying: nightsStaying,
        ...resolvedYg,
      }
      if (regType === 'members') body.confirmation_status = confirmationStatus
      if (isSupervisionType)    body.status = status
      if (regType === 'gs_committee') { body.role = role; body.hulls = hulls }
      if (regType === 'guests')       body.reason = reason
      await onAdded(body)
      onClose()
    } catch (e) {
      toast(e?.message || 'تعذّر الإضافة', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleNight = (n) => setNightsStaying(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])

  if (step === 'search') {
    return (
      <PersonSearchModal
        title={regType === 'members' ? 'إضافة مشارك' : regType === 'supervisors' ? 'إضافة مسؤول' : regType === 'gs_committee' ? 'إضافة من الأمانة العامة / اللجان' : 'إضافة ضيف'}
        onClose={onClose}
        onSelect={handlePersonSelect}
        onCreateNew={(name) => { setNewUnregName(name); setStep('create_unreg') }}
      />
    )
  }

  if (step === 'create_unreg') {
    return (
      <CreateUnregisteredModal
        initialName={newUnregName}
        onBack={() => setStep('search')}
        onClose={onClose}
        toast={toast}
        onCreated={(createdPerson) => {
          const opts = _buildYgOptions(createdPerson)
          setYgOptions(opts)
          setSelectedYgIdx(0)
          handlePersonSelect(createdPerson)
        }}
      />
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 500, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', marginBottom: 20 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', fontWeight: 800, color: '#0f2744', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{person?.display_name || person?.full_name}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}>✕</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>

          {/* Confirmation status — members only */}
          {regType === 'members' && (
            <div>
              <label style={labelStyle}>حالة التسجيل</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['confirmed', 'مؤكّد', '#f0fdf4', '#15803d', '#bbf7d0'], ['pending', 'قيد الانتظار', '#fffbeb', '#92400e', '#fde68a']].map(([val, label, bg, color, border]) => (
                  <button key={val} type="button"
                    onClick={() => setConfirmSt(val)}
                    style={{ ...chipBtn, flex: 1, ...(confirmationStatus === val ? { background: bg, color, borderColor: border } : {}) }}>
                    {label}
                  </button>
                ))}
              </div>
              {confirmationStatus === 'pending' && (
                <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '5px 10px' }}>
                  سيتم تعيين رقم الأولويّة تلقائيًا ضمن فرقة الشبيبة
                </div>
              )}
            </div>
          )}

          {/* Status — supervision types */}
          {isSupervisionType && (
            <div>
              <label style={labelStyle}>الحالة الحاليّة</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {SUPERVISOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {isSupervisionType && loadingGsRole && (
            <div style={{ fontSize: '0.78rem', color: '#9ba5bc', padding: '6px 0' }}>جارٍ التحقق من الهيكل التنظيمي…</div>
          )}

          {/* YG — members and supervisors */}
          {showYgSelector && (
            <div>
              <label style={labelStyle}>فرقة الشبيبة</label>
              {ygOptions.length > 0 ? (
                <select
                  value={selectedYgIdx}
                  onChange={e => setSelectedYgIdx(Number(e.target.value))}
                  style={inputStyle}
                >
                  {ygOptions.map((opt, i) => (
                    <option key={opt.id || i} value={i}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={manualYgId}
                  onChange={e => setManualYgId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— اختر فرقة —</option>
                  {availableYgs.map(g => {
                    const id = g.group_id || g.youth_group_id
                    return <option key={id} value={id}>{g.group_name || g.name || id}</option>
                  })}
                </select>
              )}
            </div>
          )}

          {/* Role — gs_committee */}
          {regType === 'gs_committee' && (
            <div>
              <label style={labelStyle}>الدور في هذا النشاط</label>
              <input value={role} onChange={e => setRole(e.target.value)} style={inputStyle} placeholder="مثال: مسؤول النشاط، عضو اللجنة…" />
            </div>
          )}

          {/* Hulls — gs_committee */}
          {regType === 'gs_committee' && (
            <HullsSelector hulls={hulls} setHulls={setHulls} hullInput={hullInput} setHullInput={setHullInput} existingHulls={existingHulls} />
          )}

          {/* Reason — guests */}
          {regType === 'guests' && (
            <div>
              <label style={labelStyle}>سبب الحضور</label>
              <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} placeholder="سبب حضور الضيف" />
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={labelStyle}>ملاحظات</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ ...inputStyle, resize: 'vertical' }} placeholder="ملاحظات اختياريّة…" />
          </div>

          {/* Nights staying (camps) */}
          {nights?.length > 0 && (
            <div>
              <label style={labelStyle}>الليالي التي سيبيت فيها</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {nights.map(n => (
                  <button key={n} type="button" onClick={() => toggleNight(n)}
                    style={{ ...chipBtn, ...(nightsStaying.includes(n) ? chipBtnActive : {}), fontSize: '0.72rem' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-gold btn-sm">
            {saving ? 'جارٍ الإضافة...' : 'إضافة'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── YG fields for EditRegModal (loads available YGs lazily) ──────────────────

function EditYgFields({ ygId, setYgId }) {
  const [availableYgs, setAvailableYgs] = useState([])
  useEffect(() => {
    api.listYouthGroupProfiles().then(d => setAvailableYgs(d.groups || d.youth_groups || [])).catch(() => {})
  }, [])

  return (
    <div>
      <label style={labelStyle}>فرقة الشبيبة</label>
      <select value={ygId || ''} onChange={e => setYgId(e.target.value || null)} style={inputStyle}>
        <option value="">— اختر —</option>
        {availableYgs.map(g => {
          const id    = g.group_id || g.youth_group_id
          const label = g.group_name || g.name || id
          return <option key={id} value={id}>{label}</option>
        })}
      </select>
    </div>
  )
}

// ── Edit Registration Modal ───────────────────────────────────────────────────

function EditRegModal({ entry, regType, nights, teams, onClose, onSaved, toast, existingHulls = [] }) {
  const [status, setStatus]             = useState(entry.status || '')
  const [role, setRole]                 = useState(entry.role || '')
  const [hulls, setHulls]               = useState(Array.isArray(entry.hulls) ? entry.hulls : [])
  const [hullInput, setHullInput]       = useState('')
  const [reason, setReason]             = useState(entry.reason || '')
  const [notes, setNotes]               = useState(entry.notes || '')
  const [ygId, setYgId]                 = useState(entry.youth_group_id || '')
  const [teamId, setTeamId]             = useState(entry.team_id || '')
  const [teamRole, setTeamRole]         = useState(entry.team_role || '')
  const [nightsStaying, setNightsStaying] = useState(entry.nights_staying || [])
  const [attendanceStatus, setAttendanceStatus] = useState(shouldShowAttendanceStatus(regType, entry) ? getAttendanceStatus(entry) : '')
  const [apologyDate, setApologyDate]   = useState(entry.apology_date || '')
  const [apologyReason, setApologyReason] = useState(entry.apology_reason || '')
  const [saving, setSaving]             = useState(false)

  const isSupervisionType = regType === 'supervisors' || regType === 'gs_committee'
  const attendanceEntry = { ...entry, status }
  const showAttendanceFields = shouldShowAttendanceStatus(regType, attendanceEntry)
  const toggleNight = (n) => setNightsStaying(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])

  useEffect(() => {
    if (showAttendanceFields && !attendanceStatus) setAttendanceStatus('registered')
  }, [showAttendanceFields, attendanceStatus])

  const handleSave = async () => {
    setSaving(true)
    try {
      const body = { notes, nights_staying: nightsStaying }
      if (regType === 'members' || regType === 'supervisors') {
        body.youth_group_id = ygId || null
      }
      if (regType === 'members' || regType === 'supervisors') {
        body.team_id = teamId || null
      }
      if (regType === 'supervisors') {
        body.team_role = teamRole || null
      }
      if (isSupervisionType) body.status = status
      if (regType === 'gs_committee') { body.role = role; body.hulls = hulls }
      if (regType === 'guests') body.reason = reason
      if (showAttendanceFields) {
        const savedAttendanceStatus = attendanceStatus || 'registered'
        body.attendance_status = savedAttendanceStatus
        body.apology_date = savedAttendanceStatus === 'apologized' ? apologyDate : ''
        body.apology_reason = savedAttendanceStatus === 'apologized' ? apologyReason : ''
      }
      await onSaved(body)
      onClose()
    } catch (e) {
      toast(e?.message || 'تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 500, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', marginBottom: 20 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', fontWeight: 800, color: '#0f2744', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>تعديل: {entry.name}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}>✕</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
            {isSupervisionType && (
            <div>
              <label style={labelStyle}>الحالة</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {SUPERVISOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          {regType === 'gs_committee' && (
            <div>
              <label style={labelStyle}>الدور في النشاط</label>
              <input value={role} onChange={e => setRole(e.target.value)} style={inputStyle} />
            </div>
          )}
          {regType === 'gs_committee' && (
            <HullsSelector hulls={hulls} setHulls={setHulls} hullInput={hullInput} setHullInput={setHullInput} existingHulls={existingHulls} />
          )}
          {regType === 'guests' && (
            <div>
              <label style={labelStyle}>سبب الحضور</label>
              <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} />
            </div>
          )}
          {showAttendanceFields && (
            <div>
              <label style={labelStyle}>حالة الحضور</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ATTENDANCE_STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAttendanceStatus(opt.value)}
                    style={{
                      ...chipBtn,
                      flex: 1,
                      minWidth: 92,
                      ...(attendanceStatus === opt.value ? { background: opt.bg, color: opt.color, borderColor: opt.border } : {}),
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {attendanceStatus === 'apologized' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <div>
                    <label style={labelStyle}>تاريخ الاعتذار <span style={{ color: '#9ba5bc', fontWeight: 400 }}>(اختياري)</span></label>
                    <input type="date" value={apologyDate} onChange={e => setApologyDate(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>سبب الاعتذار <span style={{ color: '#9ba5bc', fontWeight: 400 }}>(اختياري)</span></label>
                    <textarea value={apologyReason} onChange={e => setApologyReason(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                  </div>
                </div>
              )}
            </div>
          )}
          {(regType === 'members' || regType === 'supervisors') && (
            <EditYgFields ygId={ygId} setYgId={setYgId} />
          )}
          {(regType === 'members' || regType === 'supervisors') && teams && teams.length > 0 && (
            <div>
              <label style={labelStyle}>الفريق</label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)} style={inputStyle}>
                <option value="">— بدون فريق —</option>
                {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {regType === 'supervisors' && teams && teams.length > 0 && teamId && (
            <div>
              <label style={labelStyle}>الدور في الفريق</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['main', 'مسؤول رئيسي'], ['assistant', 'مسؤول مساعد']].map(([val, lbl]) => (
                  <button key={val} type="button" onClick={() => setTeamRole(v => v === val ? '' : val)}
                    style={{ flex: 1, padding: '7px 0', border: `1.5px solid ${teamRole === val ? '#7c3aed' : '#e2e6ef'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700, background: teamRole === val ? '#f5f3ff' : 'white', color: teamRole === val ? '#7c3aed' : '#6b7280' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label style={labelStyle}>ملاحظات</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          {nights?.length > 0 && (
            <div>
              <label style={labelStyle}>الليالي</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {nights.map(n => (
                  <button key={n} type="button" onClick={() => toggleNight(n)}
                    style={{ ...chipBtn, ...(nightsStaying.includes(n) ? chipBtnActive : {}), fontSize: '0.72rem' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-gold btn-sm">
            {saving ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── YG Apology Modal ──────────────────────────────────────────────────────────

function AddYgApologyModal({ eventId, onClose, onAdded, toast }) {
  const [ygId, setYgId]               = useState('')
  const [reason, setReason]           = useState('')
  const [availableYgs, setAvailableYgs] = useState([])
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    api.listYouthGroupProfiles()
      .then(d => setAvailableYgs(d.groups || d.youth_groups || []))
      .catch(() => {})
  }, [])

  const handleSubmit = async () => {
    if (!ygId) { toast('يرجى اختيار الفرقة', 'error'); return }
    setSaving(true)
    try {
      await api.addEventYgApology(eventId, { youth_group_id: ygId, reason: reason.trim() })
      onAdded()
    } catch (e) {
      toast(e?.message || 'تعذّر التسجيل', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 440, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', fontWeight: 800, color: '#0f2744', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>تسجيل اعتذار فرقة</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}>✕</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>الفرقة المعتذرة <span style={{ color: '#e53e3e' }}>*</span></label>
            <select value={ygId} onChange={e => setYgId(e.target.value)} style={inputStyle} autoFocus>
              <option value="">— اختر فرقة —</option>
              {availableYgs.map(g => {
                const id = g.group_id || g.youth_group_id
                return <option key={id} value={id}>{g.group_name || g.name || id}</option>
              })}
            </select>
          </div>
          <div>
            <label style={labelStyle}>سبب الاعتذار <span style={{ color: '#9ba5bc', fontWeight: 400 }}>(اختياري)</span></label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="سبب اعتذار الفرقة عن المشاركة…"
            />
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-gold btn-sm">
            {saving ? 'جارٍ التسجيل...' : 'تسجيل الاعتذار'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── YG Apologies Section (used inside MembersRegistrationTab) ─────────────────

function YgApologiesSection({ eventId, apologies, onRefresh, toast }) {
  const [showAdd,   setShowAdd]   = useState(false)
  const [expanded,  setExpanded]  = useState(apologies.length > 0)

  const handleDelete = async (apologyId, ygLabel) => {
    if (!window.confirm(`هل تريد حذف اعتذار "${ygLabel || 'هذه الفرقة'}"؟`)) return
    try {
      await api.deleteEventYgApology(eventId, apologyId)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch { toast('تعذّر الحذف', 'error') }
  }

  return (
    <div style={{ marginTop: 24, borderTop: '1.5px dashed #e2e6ef', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: expanded ? 12 : 0 }}>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: apologies.length > 0 ? '#b91c1c' : '#9ba5bc' }}>اعتذارات الشبيبات</span>
          {apologies.length > 0 && (
            <span style={{ fontSize: '0.63rem', fontWeight: 800, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '1px 7px', borderRadius: 10 }}>
              {apologies.length}
            </span>
          )}
          {expanded ? <ChevronUp size={13} color="#9ba5bc" /> : <ChevronDown size={13} color="#9ba5bc" />}
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAdd(true)} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}>
          <Plus size={12} /> تسجيل اعتذار فرقة
        </button>
      </div>

      {expanded && (
        <div>
          {apologies.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 10, fontSize: '0.82rem' }}>
              لا توجد اعتذارات مسجّلة
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {apologies.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 10, borderRight: '3px solid #f87171' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f2744' }}>
                      {a.youth_group_label || a.youth_group_id}
                    </div>
                    {a.reason && (
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 3 }}>
                        <span style={{ fontWeight: 600, color: '#4a5568' }}>السبب: </span>{a.reason}
                      </div>
                    )}
                    <div style={{ fontSize: '0.68rem', color: '#9ba5bc', marginTop: 3 }}>{formatDt(a.apologized_at)}</div>
                  </div>
                  <span style={{ fontSize: '0.63rem', fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    معتذر
                  </span>
                  <button
                    onClick={() => handleDelete(a.id, a.youth_group_label)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: '4px 5px', borderRadius: 6, flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <AddYgApologyModal
          eventId={eventId}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); onRefresh(); toast('تم تسجيل الاعتذار', 'success') }}
          toast={toast}
        />
      )}
    </div>
  )
}

// ── Members Registration Tab ──────────────────────────────────────────────────

function MembersRegistrationTab({ eventId, entries, nights, onRefresh, toast, onViewProfile, teams, ygApologies, eventAgeGroups = [] }) {
  const [showAdd,      setShowAdd]      = useState(false)
  const [editEntry,    setEditEntry]    = useState(null)
  const [acting,       setActing]       = useState(null)
  const [showDenied,   setShowDenied]   = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const isCamp = nights?.length > 0

  const getSt = (e) => e.confirmation_status || 'confirmed'

  const attendanceApologized = useMemo(() => entries.filter(isAttendanceApologized), [entries])
  const activeEntries = useMemo(() => entries.filter(e => !isAttendanceApologized(e)), [entries])
  const confirmed = useMemo(() => activeEntries.filter(e => getSt(e) === 'confirmed'), [activeEntries])
  const pending   = useMemo(() => [...activeEntries.filter(e => getSt(e) === 'pending')]
    .sort((a, b) => (a.yg_priority || 999) - (b.yg_priority || 999)), [activeEntries])
  const denied    = useMemo(() => activeEntries.filter(e => getSt(e) === 'denied'), [activeEntries])

  const groupByYg = (list) => {
    const byYg = {}
    for (const m of list) {
      const key = m.youth_group_label || m.youth_group_id || 'غير محدّدة'
      if (!byYg[key]) byYg[key] = []
      byYg[key].push(m)
    }
    return byYg
  }

  // Group pending by YG label for display, preserving priority order
  const pendingByYg             = useMemo(() => groupByYg(pending),             [pending])
  const confirmedByYg           = useMemo(() => groupByYg(confirmed),           [confirmed])
  const deniedByYg              = useMemo(() => groupByYg(denied),              [denied])
  const attendanceApologizedByYg = useMemo(() => groupByYg(attendanceApologized), [attendanceApologized])

  const handleAdd = async (body) => {
    await api.addEventRegistration(eventId, 'members', body)
    toast('تمت الإضافة', 'success')
    onRefresh()
  }

  const handleSave = async (regId, body) => {
    await api.updateEventRegistration(eventId, 'members', regId, body)
    toast('تم الحفظ', 'success')
    onRefresh()
  }

  const handleDelete = async (regId, name) => {
    if (!window.confirm(`هل تريد إزالة "${name}"؟`)) return
    try {
      await api.deleteEventRegistration(eventId, 'members', regId)
      toast('تمت الإزالة', 'success')
      onRefresh()
    } catch { toast('تعذّر الإزالة', 'error') }
  }

  const handleAction = async (entry, action) => {
    const ygKey   = entry.youth_group_label || entry.youth_group_id || ''
    const ygQueue = pendingByYg[ygKey] || []
    const idx     = ygQueue.findIndex(m => m.id === entry.id)
    // deny cascades to everyone below (after) in the queue; approve to everyone above (before)
    const cascadeCount = action === 'deny' ? ygQueue.length - idx - 1 : idx

    if (cascadeCount > 0) {
      const msg = action === 'deny'
        ? `سيتم الاعتذار من هذا الشخص وكذلك ${cascadeCount} شخص/أشخاص آخرين بعده في قائمة انتظار نفس الشبيبة.\nهل تريد المتابعة؟`
        : `سيتم تأكيد هذا الشخص وكذلك ${cascadeCount} شخص/أشخاص آخرين قبله في قائمة انتظار نفس الشبيبة.\nهل تريد المتابعة؟`
      if (!window.confirm(msg)) return
    }

    setActing(entry.id)
    try {
      await api.actionMemberRegistration(eventId, entry.id, action)
      toast(action === 'approve' ? '✓ تم التأكيد' : '✗ تم الاعتذار', 'success')
      onRefresh()
    } catch { toast('تعذّر تحديث الحالة', 'error') }
    finally { setActing(null) }
  }

  const renderCard = (entry, showActions = false, ygQueue = []) => {
    const entryIdx     = ygQueue.findIndex(m => m.id === entry.id)
    const cascadeCnt   = ygQueue.length - entryIdx - 1  // people below (deny cascade)
    const approveCnt   = entryIdx                        // people above (approve cascade)
    const entryStatus = getSt(entry)
    const isProcessing = acting === entry.id

    const accentColor = entryStatus === 'confirmed' ? '#86efac'
      : entryStatus === 'denied' ? '#d1d5db'
      : '#fcd34d'

    return (
      <div key={entry.id} style={{
        background: entryStatus === 'denied' ? '#fafafa' : 'white',
        borderRadius: 10,
        padding: '11px 14px 11px 14px',
        transition: '0.15s',
        opacity: isProcessing ? 0.6 : 1,
        border: '1px solid #edf0f7',
        borderRight: `3px solid ${accentColor}`,
        boxShadow: '0 1px 4px rgba(15,39,68,0.05)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Name row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              {onViewProfile ? (
                <button onClick={() => onViewProfile(entry.person_id, !!entry.is_unregistered)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)', fontWeight: 700, color: '#0f2744', fontSize: '0.92rem', textAlign: 'right' }}>
                  {entry.name}
                </button>
              ) : (
                <span style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.92rem' }}>{entry.name}</span>
              )}
              {entryStatus === 'pending' && (
                <span style={{ fontSize: '0.63rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
                  #{entry.yg_priority} انتظار
                </span>
              )}
              {entryStatus === 'denied' && (
                <span style={{ fontSize: '0.63rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#f9fafb', color: '#9ca3af', border: '1px solid #e5e7eb' }}>معتذر منه</span>
              )}
              {!!entry.is_unregistered && (
                <span style={{ fontSize: '0.6rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>غير مسجّل</span>
              )}
              {shouldShowAttendanceStatus('members', entry) && getAttendanceStatus(entry) !== 'registered' && (
                <AttendanceStatusBadge entry={entry} />
              )}
            </div>

            {/* Age group — only when multi-age-group event or mismatch */}
            {entry.age_group && (eventAgeGroups.length > 1 || !eventAgeGroups.includes(entry.age_group)) && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                <span style={{ fontSize: '0.72rem', color: '#4a5568', background: '#f1f5f9', padding: '2px 8px', borderRadius: 6 }}>{entry.age_group}</span>
              </div>
            )}

            {entry.notes && (
              <div style={{ fontSize: '0.7rem', color: '#9ba5bc', fontStyle: 'italic', marginTop: 4 }}>{entry.notes}</div>
            )}
            <AttendanceApologyDetails entry={entry} />
          </div>

          <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <button onClick={() => setEditEntry(entry)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: '4px 5px', borderRadius: 6, transition: '0.12s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#6b7280'}
              onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
              <Edit2 size={13} />
            </button>
            <button onClick={() => handleDelete(entry.id, entry.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: '4px 5px', borderRadius: 6, transition: '0.12s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Approve / Deny buttons */}
        {showActions && entryStatus === 'pending' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button onClick={() => handleAction(entry, 'approve')} disabled={isProcessing}
              style={{ flex: 1, padding: '5px 0', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700 }}>
              ✓ تأكيد{approveCnt > 0 ? ` (+${approveCnt})` : ''}
            </button>
            <button onClick={() => handleAction(entry, 'deny')} disabled={isProcessing}
              style={{ flex: 1, padding: '5px 0', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700 }}>
              ✗ اعتذار{cascadeCnt > 0 ? ` (+${cascadeCnt})` : ''}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Stats + Add button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {[
          { key: 'all',       label: 'الكل',     value: entries.length,   dot: '#94a3b8', activeBg: '#f1f5f9', activeBorder: '#94a3b8' },
          { key: 'confirmed', label: 'مؤكّدون',  value: confirmed.length, dot: '#86efac', activeBg: '#f0fdf4', activeBorder: '#4ade80' },
          { key: 'pending',   label: 'انتظار',   value: pending.length,   dot: '#fcd34d', activeBg: '#fffbeb', activeBorder: '#fbbf24' },
          { key: 'denied',    label: 'معتذر منهم', value: denied.length,    dot: '#d1d5db', activeBg: '#f9fafb', activeBorder: '#9ca3af' },
          { key: 'attendance_apologized', label: 'اعتذروا حضوراً', value: attendanceApologized.length, dot: '#fca5a5', activeBg: '#fff1f2', activeBorder: '#f87171' },
        ].map(({ key, label, value, dot, activeBg, activeBorder }) => {
          const isActive = activeFilter === key
          return (
            <button key={key} onClick={() => setActiveFilter(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                background: isActive ? activeBg : '#f8fafc',
                border: `${isActive ? '1.5px' : '1px'} solid ${isActive ? activeBorder : '#e9ecf3'}`,
                borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font-body)', transition: '0.15s',
              }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
              <span style={{ fontSize: '0.72rem', color: isActive ? '#374151' : '#6b7280', fontWeight: isActive ? 700 : 600 }}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f2744' }}>{value}</span>
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => { window.location.href = api.eventParticipantsExportUrl(eventId) }}
          className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Download size={13} /> XLSX
        </button>
        <button onClick={() => setShowAdd(true)} className="btn btn-gold btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> إضافة مشارك
        </button>
      </div>

      {/* Empty state */}
      {entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 10 }}>
          <div style={{ fontSize: '0.85rem' }}>لا يوجد مشاركون بعد</div>
        </div>
      )}
      {entries.length > 0 && activeFilter !== 'all' && (() => {
        const visible = activeFilter === 'confirmed' ? confirmed
          : activeFilter === 'pending' ? pending
          : activeFilter === 'denied' ? denied
          : attendanceApologized
        return visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 10 }}>
            <div style={{ fontSize: '0.85rem' }}>لا توجد نتائج لهذا الفلتر</div>
          </div>
        ) : null
      })()}

      {(activeFilter === 'all' || activeFilter === 'attendance_apologized') && attendanceApologized.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#b91c1c', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fca5a5', display: 'inline-block' }} />
            اعتذروا عن الحضور
            <span style={{ fontWeight: 800, color: '#0f2744', background: '#fff1f2', border: '1px solid #fecaca', borderRadius: 20, fontSize: '0.65rem', padding: '1px 7px' }}>{attendanceApologized.length}</span>
          </div>
          {Object.entries(attendanceApologizedByYg).map(([ygLabel, ygMembers]) => (
            <div key={ygLabel} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ background: '#f1f5f9', color: '#374151', padding: '2px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700 }}>{ygLabel}</span>
                <span style={{ color: '#c9d3e0', fontSize: '0.68rem' }}>{ygMembers.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {ygMembers.map(e => renderCard(e))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Confirmed ────────────────────────────────── */}
      {(activeFilter === 'all' || activeFilter === 'confirmed') && confirmed.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#16a34a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#86efac', display: 'inline-block' }} />
            مؤكّدون
            <span style={{ fontWeight: 800, color: '#0f2744', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 20, fontSize: '0.65rem', padding: '1px 7px' }}>{confirmed.length}</span>
          </div>
          {Object.entries(confirmedByYg).map(([ygLabel, ygMembers]) => (
            <div key={ygLabel} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ background: '#f1f5f9', color: '#374151', padding: '2px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700 }}>{ygLabel}</span>
                <span style={{ color: '#c9d3e0', fontSize: '0.68rem' }}>{ygMembers.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {ygMembers.map(e => renderCard(e))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pending queue ─────────────────────────────── */}
      {(activeFilter === 'all' || activeFilter === 'pending') && pending.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d97706', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fcd34d', display: 'inline-block' }} />
            قائمة الانتظار
            <span style={{ fontWeight: 800, color: '#0f2744', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 20, fontSize: '0.65rem', padding: '1px 7px' }}>{pending.length}</span>
          </div>
          {Object.entries(pendingByYg).map(([ygLabel, ygMembers]) => (
            <div key={ygLabel} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ background: '#f1f5f9', color: '#374151', padding: '2px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700 }}>
                  {ygLabel}
                </span>
                <span style={{ color: '#c9d3e0', fontSize: '0.68rem' }}>{ygMembers.length} في الانتظار</span>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {ygMembers.map(e => renderCard(e, true, ygMembers))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Denied (collapsible) ──────────────────────── */}
      {(activeFilter === 'all' || activeFilter === 'denied') && denied.length > 0 && (
        <div>
          <button onClick={() => setShowDenied(v => !v)}
            style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d1d5db', display: 'inline-block' }} />
            معتذر منهم
            <span style={{ fontWeight: 800, color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 20, fontSize: '0.65rem', padding: '1px 7px' }}>{denied.length}</span>
            {showDenied ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showDenied && (
            <div>
              {Object.entries(deniedByYg).map(([ygLabel, ygMembers]) => (
                <div key={ygLabel} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ background: '#f1f5f9', color: '#374151', padding: '2px 10px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700 }}>{ygLabel}</span>
                    <span style={{ color: '#c9d3e0', fontSize: '0.68rem' }}>{ygMembers.length}</span>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {ygMembers.map(e => renderCard(e))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <YgApologiesSection eventId={eventId} apologies={ygApologies} onRefresh={onRefresh} toast={toast} />

      {showAdd && (
        <AddRegModal regType="members" nights={nights} onClose={() => setShowAdd(false)} onAdded={handleAdd} toast={toast} />
      )}
      {editEntry && (
        <EditRegModal entry={editEntry} regType="members" nights={nights} teams={teams}
          onClose={() => setEditEntry(null)}
          onSaved={(body) => handleSave(editEntry.id, body)}
          toast={toast}
        />
      )}
    </div>
  )
}

// ── Registration Tab ──────────────────────────────────────────────────────────

function RegistrationTab({ eventId, regType, label, entries, nights, onRefresh, toast, onViewProfile, teams }) {
  const [showAdd,      setShowAdd]      = useState(false)
  const [editEntry,    setEditEntry]    = useState(null)
  const [advancing,    setAdvancing]    = useState(null)
  const [activeFilter, setActiveFilter] = useState('all')

  const isSupervisionType = regType === 'supervisors' || regType === 'gs_committee'
  const isGuest = regType === 'guests'
  const isCamp  = nights?.length > 0

  const existingHulls = useMemo(() => {
    if (regType !== 'gs_committee') return []
    return [...new Set(entries.flatMap(e => Array.isArray(e.hulls) ? e.hulls : []).filter(Boolean))]
  }, [entries, regType])

  const attendanceApologized = useMemo(
    () => entries.filter(e => shouldShowAttendanceStatus(regType, e) && isAttendanceApologized(e)),
    [entries, regType]
  )
  const activeEntries = useMemo(() => entries.filter(e => !isAttendanceApologized(e)), [entries])
  const guestRegistered = useMemo(() => activeEntries.filter(e => getAttendanceStatus(e) === 'registered'), [activeEntries])
  const guestAttended = useMemo(() => activeEntries.filter(e => getAttendanceStatus(e) === 'attended'), [activeEntries])

  const handleAdd = async (body) => {
    await api.addEventRegistration(eventId, regType, body)
    toast('تمت الإضافة', 'success')
    onRefresh()
  }

  const handleSave = async (regId, body) => {
    await api.updateEventRegistration(eventId, regType, regId, body)
    toast('تم الحفظ', 'success')
    onRefresh()
  }

  const handleDelete = async (regId, name) => {
    if (!window.confirm(`هل تريد إزالة "${name}"؟`)) return
    try {
      await api.deleteEventRegistration(eventId, regType, regId)
      toast('تمت الإزالة', 'success')
      onRefresh()
    } catch { toast('تعذّر الإزالة', 'error') }
  }

  const handleAdvanceStatus = async (regId, newStatus) => {
    setAdvancing(regId)
    try {
      await api.updateEventRegistration(eventId, regType, regId, { status: newStatus })
      onRefresh()
    } catch { toast('تعذّر تحديث الحالة', 'error') }
    finally { setAdvancing(null) }
  }

  const approvedCount   = isSupervisionType ? activeEntries.filter(e => e.status === FINAL_APPROVED_ST).length : 0
  const rejectedCount   = isSupervisionType ? activeEntries.filter(e => isRejectedStatus(e.status)).length   : 0
  const pendingSupCount = isSupervisionType ? activeEntries.length - approvedCount - rejectedCount            : 0

  const filteredEntries = useMemo(() => {
    if (activeFilter === 'all') return entries
    if (activeFilter === 'attendance_apologized') return attendanceApologized
    if (isGuest) {
      if (activeFilter === 'registered') return guestRegistered
      if (activeFilter === 'attended') return guestAttended
      return entries
    }
    if (!isSupervisionType) return entries
    if (activeFilter === 'approved')    return activeEntries.filter(e => e.status === FINAL_APPROVED_ST)
    if (activeFilter === 'rejected')    return activeEntries.filter(e => isRejectedStatus(e.status))
    if (activeFilter === 'in_progress') return activeEntries.filter(e => !isFinalStatus(e.status))
    return entries
  }, [entries, activeEntries, activeFilter, attendanceApologized, guestRegistered, guestAttended, isGuest, isSupervisionType])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {isSupervisionType ? (
          <>
            {[
              { key: 'all',         label: 'الكل',      value: entries.length,  dot: '#94a3b8', activeBg: '#f1f5f9', activeBorder: '#94a3b8' },
              { key: 'approved',    label: 'موافقة',    value: approvedCount,   dot: '#86efac', activeBg: '#f0fdf4', activeBorder: '#4ade80' },
              { key: 'in_progress', label: 'بالإجراء', value: pendingSupCount, dot: '#93c5fd', activeBg: '#eff6ff', activeBorder: '#60a5fa' },
              { key: 'rejected',    label: 'اعتذار',   value: rejectedCount,   dot: '#fca5a5', activeBg: '#fff1f2', activeBorder: '#f87171' },
              { key: 'attendance_apologized', label: 'اعتذروا حضوراً', value: attendanceApologized.length, dot: '#fca5a5', activeBg: '#fff1f2', activeBorder: '#f87171' },
            ].map(({ key, label: lbl, value, dot, activeBg, activeBorder }) => {
              const isActive = activeFilter === key
              return (
                <button key={key} onClick={() => setActiveFilter(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                    background: isActive ? activeBg : '#f8fafc',
                    border: `${isActive ? '1.5px' : '1px'} solid ${isActive ? activeBorder : '#e9ecf3'}`,
                    borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font-body)', transition: '0.15s',
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.72rem', color: isActive ? '#374151' : '#6b7280', fontWeight: isActive ? 700 : 600 }}>{lbl}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f2744' }}>{value}</span>
                </button>
              )
            })}
          </>
        ) : isGuest ? (
          <>
            {[
              { key: 'all', label: 'الكل', value: entries.length, dot: '#94a3b8', activeBg: '#f1f5f9', activeBorder: '#94a3b8' },
              { key: 'registered', label: 'مسجّلون', value: guestRegistered.length, dot: '#93c5fd', activeBg: '#eff6ff', activeBorder: '#60a5fa' },
              { key: 'attended', label: 'حضروا', value: guestAttended.length, dot: '#86efac', activeBg: '#f0fdf4', activeBorder: '#4ade80' },
              { key: 'attendance_apologized', label: 'اعتذروا حضوراً', value: attendanceApologized.length, dot: '#fca5a5', activeBg: '#fff1f2', activeBorder: '#f87171' },
            ].map(({ key, label: lbl, value, dot, activeBg, activeBorder }) => {
              const isActive = activeFilter === key
              return (
                <button key={key} onClick={() => setActiveFilter(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                    background: isActive ? activeBg : '#f8fafc',
                    border: `${isActive ? '1.5px' : '1px'} solid ${isActive ? activeBorder : '#e9ecf3'}`,
                    borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font-body)', transition: '0.15s',
                  }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.72rem', color: isActive ? '#374151' : '#6b7280', fontWeight: isActive ? 700 : 600 }}>{lbl}</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f2744' }}>{value}</span>
                </button>
              )
            })}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.88rem' }}>{label}</span>
            {entries.length > 0 && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, background: '#f1f5f9', color: '#64748b', padding: '2px 9px', borderRadius: 20, border: '1px solid #e2e8f0' }}>{entries.length}</span>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {regType === 'supervisors' && (
          <button type="button" onClick={() => { window.location.href = api.eventSupervisorsExportUrl(eventId) }}
            className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Download size={13} /> XLSX
          </button>
        )}
        {regType === 'gs_committee' && (
          <button type="button" onClick={() => { window.location.href = api.eventGsCommitteeExportUrl(eventId) }}
            className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Download size={13} /> XLSX
          </button>
        )}
        <button onClick={() => setShowAdd(true)} className="btn btn-gold btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> إضافة
        </button>
      </div>

      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <div style={{ fontSize: '0.85rem' }}>لا يوجد إدخالات بعد</div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <div style={{ fontSize: '0.85rem' }}>لا توجد نتائج لهذا الفلتر</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {filteredEntries.map(entry => {
            const isProcessing = advancing === entry.id
            const skipMasoul   = !!entry.skip_masoul_step
            const nextApprove  = isSupervisionType ? getNextApprove(entry.status, entry.is_in_gs_tree, skipMasoul) : null
            const nextReject   = isSupervisionType ? getNextReject(entry.status) : null
            const isProposal   = isSupervisionType && PROPOSAL_ST.has(entry.status)
            const isFinal      = isSupervisionType && isFinalStatus(entry.status)
            const isApproved   = entry.status === FINAL_APPROVED_ST
            const isRejected   = isRejectedStatus(entry.status)

            const accentColor = !isSupervisionType ? '#e2e8f0'
              : isApproved ? '#86efac'
              : isRejected ? '#fca5a5'
              : isProposal ? '#e2e8f0'
              : '#93c5fd'

            return (
              <div key={entry.id} style={{
                background: 'white',
                borderRadius: 10, padding: '11px 14px',
                border: '1px solid #edf0f7',
                borderRight: `3px solid ${accentColor}`,
                boxShadow: '0 1px 4px rgba(15,39,68,0.05)',
                opacity: isProcessing ? 0.7 : 1, transition: '0.15s',
              }}>
                {/* Top row: name + edit/delete */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 5 }}>
                      {onViewProfile ? (
                        <button onClick={() => onViewProfile(entry.person_id, !!entry.is_unregistered)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)', fontWeight: 700, color: '#0f2744', fontSize: '0.92rem', textAlign: 'right' }}>
                          {entry.name}
                        </button>
                      ) : (
                        <span style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.92rem' }}>{entry.name}</span>
                      )}
                      {!!entry.is_unregistered && (
                        <span style={{ fontSize: '0.6rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>غير مسجّل</span>
                      )}
                      {shouldShowAttendanceStatus(regType, entry) && (
                        <AttendanceStatusBadge entry={entry} />
                      )}
                    </div>

                    {/* YG + age group */}
                    {(regType === 'members' || regType === 'supervisors') && (entry.youth_group_label || entry.age_group) && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
                        {entry.youth_group_label && (
                          <span style={{ fontSize: '0.72rem', color: '#4a5568', background: '#f1f5f9', padding: '2px 8px', borderRadius: 6 }}>{entry.youth_group_label}</span>
                        )}
                        {entry.age_group && (
                          <span style={{ fontSize: '0.72rem', color: '#4a5568', background: '#f1f5f9', padding: '2px 8px', borderRadius: 6 }}>{entry.age_group}</span>
                        )}
                      </div>
                    )}

                    {/* Team + role badge (supervisors only) */}
                    {regType === 'supervisors' && entry.team_id && (() => {
                      const teamName = teams?.find(t => t.team_id === entry.team_id)?.name || ''
                      const roleLabel = entry.team_role === 'main' ? 'رئيسي' : entry.team_role === 'assistant' ? 'مساعد' : null
                      const roleColor = entry.team_role === 'main'
                        ? { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' }
                        : { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' }
                      return (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
                          {teamName && (
                            <span style={{ fontSize: '0.72rem', color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
                              {teamName}
                            </span>
                          )}
                          {roleLabel && (
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, background: roleColor.bg, color: roleColor.text, border: `1px solid ${roleColor.border}`, padding: '2px 8px', borderRadius: 6 }}>
                              {roleLabel}
                            </span>
                          )}
                        </div>
                      )
                    })()}

                    {regType === 'gs_committee' && entry.role && (
                      <div style={{ fontSize: '0.73rem', color: '#6b7280', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: '#4a5568' }}>الدور: </span>{entry.role}
                      </div>
                    )}
                    {regType === 'gs_committee' && Array.isArray(entry.hulls) && entry.hulls.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                        {entry.hulls.map(h => (
                          <span key={h} style={{ fontSize: '0.68rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 10, padding: '1px 8px', fontWeight: 600 }}>{h}</span>
                        ))}
                      </div>
                    )}
                    {isGuest && entry.reason && (
                      <div style={{ fontSize: '0.73rem', color: '#6b7280', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: '#4a5568' }}>السبب: </span>{entry.reason}
                      </div>
                    )}
                    {entry.notes && (
                      <div style={{ fontSize: '0.7rem', color: '#9ba5bc', fontStyle: 'italic' }}>{entry.notes}</div>
                    )}
                    {shouldShowAttendanceStatus(regType, entry) && (
                      <AttendanceApologyDetails entry={entry} />
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    <button onClick={() => setEditEntry(entry)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: '4px 5px', borderRadius: 6, transition: '0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#6b7280'}
                      onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(entry.id, entry.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: '4px 5px', borderRadius: 6, transition: '0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Approval flow */}
                {isSupervisionType && (
                  <>
                    <StatusFlow status={entry.status} isInGsTree={!!entry.is_in_gs_tree} skipMasoulStep={skipMasoul} />

                    {getStepIndex(entry.status) === 2 && (entry.gs_tree_superior_name || entry.yg_masoul_aam_name) && (
                      <div style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: 6 }}>
                        {entry.is_in_gs_tree
                          ? `مسؤول اللجنة: ${entry.gs_tree_superior_name}`
                          : `المسؤول العام: ${entry.yg_masoul_aam_name}`}
                      </div>
                    )}

                    {!isFinal && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        {nextApprove && (
                          <button onClick={() => handleAdvanceStatus(entry.id, nextApprove)} disabled={isProcessing}
                            style={{ padding: '4px 14px', border: `1px solid ${isProposal ? '#c7d2fe' : '#bbf7d0'}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.73rem', fontWeight: 700, background: isProposal ? '#eef2ff' : '#f0fdf4', color: isProposal ? '#4338ca' : '#16a34a' }}>
                            {isProposal ? '→ إرسال للمكتب' : '✓ موافقة'}
                          </button>
                        )}
                        {nextReject && (
                          <button onClick={() => handleAdvanceStatus(entry.id, nextReject)} disabled={isProcessing}
                            style={{ padding: '4px 14px', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.73rem', fontWeight: 700, background: '#fef2f2', color: '#dc2626' }}>
                            ✗ اعتذار
                          </button>
                        )}
                      </div>
                    )}

                    {isFinal && (
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: isApproved ? '#16a34a' : '#9ca3af', marginTop: 4 }}>
                        {isApproved ? '✓ تمت الموافقة النهائيّة' : '✗ ' + entry.status}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddRegModal regType={regType} nights={nights} onClose={() => setShowAdd(false)} onAdded={handleAdd} toast={toast} existingHulls={existingHulls} />
      )}
      {editEntry && (
        <EditRegModal entry={editEntry} regType={regType} nights={nights} teams={teams}
          onClose={() => setEditEntry(null)}
          onSaved={(body) => handleSave(editEntry.id, body)}
          toast={toast}
          existingHulls={existingHulls}
        />
      )}
    </div>
  )
}

// ── Image Manager ─────────────────────────────────────────────────────────────

function ImageManager({ eventId, images, kind, onRefresh, toast }) {
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  const upload = kind === 'logos' ? api.uploadEventLogo : api.uploadEventPoster
  const urlFn  = kind === 'logos' ? api.eventLogoUrl : api.eventPosterUrl
  const delFn  = kind === 'logos' ? api.deleteEventLogo : api.deleteEventPoster
  const mainFn = kind === 'logos' ? api.setMainEventLogo : api.setMainEventPoster

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await upload(eventId, file)
      toast('تم الرفع', 'success')
      onRefresh()
    } catch { toast('تعذّر رفع الملف', 'error') }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleDelete = async (imgId) => {
    if (!window.confirm('هل تريد حذف هذه الصورة؟')) return
    try { await delFn(eventId, imgId); toast('تم الحذف', 'success'); onRefresh() }
    catch { toast('تعذّر الحذف', 'error') }
  }

  const handleSetMain = async (imgId) => {
    try { await mainFn(eventId, imgId); toast('تم تعيينها كصورة رئيسيّة', 'success'); onRefresh() }
    catch { toast('تعذّر التعيين', 'error') }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {images.map(img => (
          <div key={img.id} style={{ position: 'relative', border: `2px solid ${img.is_main ? '#c9963c' : '#e2e6ef'}`, borderRadius: 10, overflow: 'hidden', width: 110, flexShrink: 0 }}>
            <img src={urlFn(eventId, img.id, img.id)} alt=""
              style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
            {img.is_main && (
              <div style={{ position: 'absolute', top: 4, right: 4, background: '#c9963c', borderRadius: 6, padding: '1px 5px', fontSize: '0.6rem', color: 'white', fontWeight: 800 }}>رئيسيّة</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '5px 4px', background: '#f7f9ff' }}>
              {!img.is_main && (
                <button onClick={() => handleSetMain(img.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c9963c', padding: 2 }} title="جعلها رئيسيّة">
                  <Star size={13} />
                </button>
              )}
              <button onClick={() => handleDelete(img.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', padding: 2 }} title="حذف">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ width: 110, height: 110, border: '2px dashed #c5d8f8', borderRadius: 10, background: '#f0f4ff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#4a6fa5', flexShrink: 0 }}>
          {uploading ? <div className="spinner" /> : <><Upload size={20} /><span style={{ fontSize: '0.72rem', fontWeight: 600 }}>رفع</span></>}
        </button>
      </div>
    </div>
  )
}

// ── Document Manager (المراسلة) ───────────────────────────────────────────────

const DOC_EXT_COLORS = {
  pdf:  { bg: '#fff1f2', color: '#dc2626', border: '#fecaca' },
  docx: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  doc:  { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  xlsx: { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  xls:  { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  pptx: { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  ppt:  { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
}

function docExtStyle(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase()
  return DOC_EXT_COLORS[ext] || { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' }
}

function docExt(filename) {
  return (filename || '').split('.').pop().toUpperCase()
}

function DocumentManager({ eventId, documents, onRefresh, toast }) {
  const fileRef   = useRef()
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadEventDocument(eventId, file)
      toast('تم رفع الملف', 'success')
      onRefresh()
    } catch { toast('تعذّر رفع الملف', 'error') }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleDelete = async (docId) => {
    if (!window.confirm('هل تريد حذف هذا الملف؟')) return
    try { await api.deleteEventDocument(eventId, docId); toast('تم الحذف', 'success'); onRefresh() }
    catch { toast('تعذّر الحذف', 'error') }
  }

  const handleSetMain = async (docId) => {
    try { await api.setMainEventDocument(eventId, docId); toast('تم تعيينه كملف رئيسي', 'success'); onRefresh() }
    catch { toast('تعذّر التعيين', 'error') }
  }

  return (
    <div style={{ direction: 'rtl' }}>
      <input ref={fileRef} type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.odt,.ods,.odp"
        style={{ display: 'none' }} onChange={handleUpload} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {documents.map(doc => {
          const style = docExtStyle(doc.filename)
          const name  = doc.original_name || doc.filename
          return (
            <div key={doc.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              border: `1.5px solid ${doc.is_main ? '#c9963c' : '#e2e6ef'}`,
              borderRadius: 10, padding: '9px 12px', background: doc.is_main ? '#fffdf5' : 'white',
            }}>
              {/* Type badge */}
              <div style={{
                flexShrink: 0, width: 38, height: 38, borderRadius: 8,
                background: style.bg, border: `1px solid ${style.border}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
              }}>
                <FileText size={14} color={style.color} />
                <span style={{ fontSize: '0.5rem', fontWeight: 800, color: style.color, letterSpacing: '-0.02em' }}>
                  {docExt(doc.filename)}
                </span>
              </div>

              {/* Name + main badge */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f2744', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                {doc.is_main && (
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#c9963c', background: '#fef9ec', border: '1px solid #f9d87e', borderRadius: 10, padding: '1px 6px' }}>
                    رئيسي
                  </span>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <a href={api.eventDocumentUrl(eventId, doc.id)} download={name} title="تحميل"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, background: '#f0f4ff', color: '#4a6fa5', border: 'none', cursor: 'pointer', textDecoration: 'none' }}>
                  <Download size={13} />
                </a>
                {!doc.is_main && (
                  <button onClick={() => handleSetMain(doc.id)} title="جعله رئيسياً"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid #e2e6ef', cursor: 'pointer', color: '#c9963c' }}>
                    <Star size={13} />
                  </button>
                )}
                <button onClick={() => handleDelete(doc.id)} title="حذف"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid #fecaca', cursor: 'pointer', color: '#dc2626' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}

        {/* Upload button */}
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', border: '2px dashed #c5d8f8', borderRadius: 10, background: '#f0f4ff', cursor: 'pointer', color: '#4a6fa5', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 600 }}>
          {uploading ? <div className="spinner" /> : <Upload size={15} />}
          {uploading ? 'جارٍ الرفع...' : 'رفع ملف مراسلة'}
        </button>
      </div>
    </div>
  )
}

// ── Info Edit Panel ───────────────────────────────────────────────────────────

function InfoPanel({ event, onSaved, toast }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({})

  const startEdit = () => {
    setForm({
      jec_year:              event.jec_year || '',
      event_type:            event.event_type || '',
      organizer_type:        event.organizer_type || 'gs',
      target_type:           event.target_type || 'age_groups',
      target_age_groups:     event.target_age_groups || [],
      target_hull_label:     event.target_hull_label || '',
      title_source:          event.title_source || 'age_groups',
      title_label:           event.title_label || '',
      start_datetime:        (event.start_datetime || '').replace(' ', 'T').slice(0, 16),
      end_datetime:          (event.end_datetime || '').replace(' ', 'T').slice(0, 16),
      theme_text:            event.theme_text || '',
      theme_is_verse:        event.theme_is_verse || false,
      has_teams:             event.has_teams || false,
      has_team_leaders:      event.has_team_leaders || false,
      num_teams:             event.num_teams ?? '',
      max_members_per_team:  event.max_members_per_team ?? '',
    })
    setEditing(true)
  }

  const f = (field) => (val) => setForm(prev => ({ ...prev, [field]: val }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaved({ ...form })
      setEditing(false)
      toast('تم الحفظ', 'success')
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <InfoRow label="سنة الرعاية" value={event.jec_year} />
          <InfoRow label="نوع النشاط" value={event.event_type} />
          <InfoRow label="المنظِّم" value={event.organizer_type === 'gs' ? 'الأمانة العامة' : event.organizer_type === 'yg' ? 'فرقة شبيبة' : 'مشترك'} />
          <InfoRow label="الفئة المستهدفة" value={event.target_age_groups?.join('، ') || event.target_hull_label || '—'} />
          <InfoRow label="البداية" value={formatDt(event.start_datetime)} />
          <InfoRow label="النهاية" value={formatDt(event.end_datetime)} />
        </div>
        {event.theme_text && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#fffdf7', border: '1px solid #f0e8d8', borderRadius: 8 }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginBottom: 3 }}>الشعار / العنوان</div>
            <div style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.9rem' }}>{event.theme_text}</div>
            {event.theme_is_verse && <div style={{ fontSize: '0.7rem', color: '#c9963c', marginTop: 2 }}>آية كتابيّة</div>}
          </div>
        )}
        {event.event_type === 'مخيم' && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: '#f8fafc', border: '1px solid #e9ecf3', borderRadius: 10 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>إعدادات الفرق</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: event.has_teams ? '#16a34a' : '#9ca3af' }}>
                  {event.has_teams ? '✓' : '✗'} فرق
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: event.has_teams && event.has_team_leaders ? '#16a34a' : '#9ca3af' }}>
                  {event.has_teams && event.has_team_leaders ? '✓' : '✗'} مسؤوليّ فرق
                </span>
              </div>
              {event.has_teams && event.num_teams && (
                <InfoRow label="عدد الفرق" value={event.num_teams} />
              )}
              {event.has_teams && event.max_members_per_team && (
                <InfoRow label="الحد الأقصى / فرقة" value={event.max_members_per_team} />
              )}
            </div>
          </div>
        )}
        {event.nights?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: '0.74rem', color: '#6b7280', marginBottom: 6 }}>الليالي ({event.nights.length})</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {event.nights.map(n => <span key={n} style={{ fontSize: '0.72rem', background: '#e8eaf6', color: '#283593', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>{n}</span>)}
            </div>
          </div>
        )}
        {event.locations?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: '0.74rem', color: '#6b7280', marginBottom: 6 }}>المواقع</div>
            {event.locations.map((loc, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: '#0f2744', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <MapPin size={12} style={{ flexShrink: 0 }} />
                <span>{loc.name || '—'}</span>
                {loc.camp_location_id && (
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#f0f4ff', color: '#1d4ed8', border: '1px solid #c5d8f8', padding: '1px 6px', borderRadius: 8 }}>
                    مرتبط بموقع التخييم
                  </span>
                )}
                {loc.maps_urls?.map((u, j) => (
                  <a key={j} href={u} target="_blank" rel="noreferrer"
                    style={{ fontSize: '0.72rem', color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>
                    خريطة
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
        <button onClick={startEdit} className="btn btn-ghost btn-sm" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Edit2 size={13} /> تعديل المعلومات
        </button>
      </div>
    )
  }

  // Edit mode — simplified fields
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}>سنة الرعاية</label>
          <input value={form.jec_year} onChange={e => f('jec_year')(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>نوع النشاط</label>
          <input value={form.event_type} onChange={e => f('event_type')(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>تاريخ البداية</label>
          <input type="datetime-local" value={form.start_datetime} onChange={e => f('start_datetime')(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>تاريخ النهاية</label>
          <input type="datetime-local" value={form.end_datetime} onChange={e => f('end_datetime')(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>الشعار / العنوان (اختياري)</label>
        <input value={form.theme_text} onChange={e => f('theme_text')(e.target.value)} style={inputStyle} placeholder="شعار النشاط…" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, cursor: 'pointer', fontSize: '0.78rem', color: '#4a5568' }}>
          <input type="checkbox" checked={form.theme_is_verse} onChange={e => f('theme_is_verse')(e.target.checked)} />
          آية كتابيّة (قابلة للضغط)
        </label>
      </div>

      {form.event_type === 'مخيم' && (
        <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid #e9ecf3', borderRadius: 10, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3 }}>إعدادات الفرق</div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.has_teams}
              onChange={e => {
                f('has_teams')(e.target.checked)
                if (!e.target.checked) {
                  f('has_team_leaders')(false)
                  f('num_teams')('')
                  f('max_members_per_team')('')
                }
              }} />
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f2744' }}>يحتوي المخيم على فرق</div>
              <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginTop: 1 }}>سيتم توزيع المشاركين على فرق</div>
            </div>
          </label>

          {form.has_teams && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', paddingRight: 22 }}>
                <input type="checkbox" checked={!!form.has_team_leaders}
                  onChange={e => f('has_team_leaders')(e.target.checked)} />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f2744' }}>يحتوي على مسؤوليّ فرق</div>
                  <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginTop: 1 }}>لكل فرقة مسؤول مخصّص</div>
                </div>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingRight: 22 }}>
                <div>
                  <label style={labelStyle}>عدد الفرق <span style={{ fontWeight: 400, color: '#9ba5bc' }}>(اختياري)</span></label>
                  <input type="number" min="1" value={form.num_teams}
                    onChange={e => f('num_teams')(e.target.value === '' ? '' : Number(e.target.value))}
                    style={inputStyle} placeholder="مثال: 4" />
                </div>
                <div>
                  <label style={labelStyle}>الحد الأقصى / فرقة <span style={{ fontWeight: 400, color: '#9ba5bc' }}>(اختياري)</span></label>
                  <input type="number" min="1" value={form.max_members_per_team}
                    onChange={e => f('max_members_per_team')(e.target.value === '' ? '' : Number(e.target.value))}
                    style={inputStyle} placeholder="مثال: 10" />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => setEditing(false)} className="btn btn-ghost btn-sm">إلغاء</button>
        <button onClick={handleSave} disabled={saving} className="btn btn-gold btn-sm">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.88rem' }}>{value || '—'}</div>
    </div>
  )
}

// ── Locations Manager ─────────────────────────────────────────────────────────

function LocationsManager({ event, onSaved, toast }) {
  const isCamp = event.event_type === 'مخيم'

  const initLocs = () => (event.locations || []).map(l => ({
    ...l,
    _mode: l.camp_location_id ? 'linked' : 'manual',
  }))

  const [locations,     setLocations]     = useState(initLocs)
  const [campLocs,      setCampLocs]      = useState([])
  const [saving,        setSaving]        = useState(false)

  useEffect(() => {
    if (!isCamp) return
    api.listCampLocations().then(d => setCampLocs(d.locations || [])).catch(() => {})
  }, [isCamp])

  const addLocation = () => setLocations(prev => [
    ...prev,
    { id: Date.now().toString(), name: '', maps_urls: [], camp_location_id: null, _mode: isCamp ? 'linked' : 'manual' },
  ])
  const removeLocation   = (id) => setLocations(prev => prev.filter(l => l.id !== id))
  const updateField      = (id, field, val) => setLocations(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l))
  const addMapUrl        = (id) => setLocations(prev => prev.map(l => l.id === id ? { ...l, maps_urls: [...(l.maps_urls || []), ''] } : l))
  const updateMapUrl     = (id, idx, val) => setLocations(prev => prev.map(l => l.id === id ? { ...l, maps_urls: (l.maps_urls || []).map((u, i) => i === idx ? val : u) } : l))
  const removeMapUrl     = (id, idx) => setLocations(prev => prev.map(l => l.id === id ? { ...l, maps_urls: (l.maps_urls || []).filter((_, i) => i !== idx) } : l))

  const setMode = (id, mode) => setLocations(prev => prev.map(l => l.id === id
    ? { ...l, _mode: mode, camp_location_id: mode === 'manual' ? null : l.camp_location_id }
    : l))

  const selectCampLoc = (id, campLocId) => {
    const cl = campLocs.find(c => c.id === campLocId)
    const mapsUrls = (cl?.buildings || []).map(b => b.maps_url).filter(Boolean)
    setLocations(prev => prev.map(l => l.id === id
      ? { ...l, camp_location_id: campLocId, name: cl?.name || '', maps_urls: mapsUrls }
      : l))
  }

  const handleSave = async () => {
    setSaving(true)
    // Strip the internal _mode helper before persisting
    const toSave = locations.map(({ _mode, ...rest }) => rest)
    try { await onSaved({ locations: toSave }); toast('تم الحفظ', 'success') }
    catch { toast('تعذّر الحفظ', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div>
      {locations.map(loc => {
        const linkedCampLoc = loc._mode === 'linked' && loc.camp_location_id
          ? campLocs.find(c => c.id === loc.camp_location_id)
          : null

        return (
          <div key={loc.id} style={{ border: '1px solid #e2e6ef', borderRadius: 10, padding: 12, marginBottom: 10 }}>

            {/* Mode toggle (camps only) + delete */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              {isCamp && [['linked', 'من المواقع المحفوظة'], ['manual', 'إدخال يدوي']].map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => setMode(loc.id, mode)}
                  style={{
                    padding: '3px 12px', borderRadius: 20, border: `1.5px solid ${loc._mode === mode ? '#0f2744' : '#e2e6ef'}`,
                    background: loc._mode === mode ? '#0f2744' : 'white',
                    color: loc._mode === mode ? 'white' : '#6b7280',
                    cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 700,
                  }}>
                  {label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={() => removeLocation(loc.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', padding: 4 }}>
                <Trash2 size={15} />
              </button>
            </div>

            {/* ── Linked mode ── */}
            {loc._mode === 'linked' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <select value={loc.camp_location_id || ''} onChange={e => selectCampLoc(loc.id, e.target.value)} style={inputStyle}>
                  <option value="">— اختر موقع تخييم —</option>
                  {campLocs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>

                {linkedCampLoc && (
                  <div style={{ background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f2744', marginBottom: 6 }}>
                      {linkedCampLoc.name}
                    </div>
                    {(linkedCampLoc.buildings || []).filter(b => b.maps_url).map(b => (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <MapPin size={11} color="#3b82f6" />
                        <span style={{ fontSize: '0.72rem', color: '#374151', fontWeight: 600 }}>{b.name}:</span>
                        <a href={b.maps_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '0.72rem', color: '#1d4ed8', textDecoration: 'none' }}>
                          فتح على الخريطة
                        </a>
                      </div>
                    ))}
                    {(linkedCampLoc.buildings || []).every(b => !b.maps_url) && (
                      <div style={{ fontSize: '0.72rem', color: '#9ba5bc' }}>لا توجد روابط خرائط مضافة لهذا الموقع</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* ── Manual mode (original fields) ── */
              <div>
                <input value={loc.name} onChange={e => updateField(loc.id, 'name', e.target.value)}
                  placeholder="اسم الموقع (مثال: دير مار الياس)" style={{ ...inputStyle, marginBottom: 8 }} />
                {(loc.maps_urls || []).map((url, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input value={url} onChange={e => updateMapUrl(loc.id, idx, e.target.value)}
                      placeholder="رابط Google Maps…" style={{ ...inputStyle, flex: 1, fontSize: '0.78rem' }} />
                    <button onClick={() => removeMapUrl(loc.id, idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', padding: 4 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addMapUrl(loc.id)}
                  style={{ fontSize: '0.75rem', color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font-body)' }}>
                  + إضافة رابط خريطة
                </button>
              </div>
            )}
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={addLocation} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> إضافة موقع
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-gold btn-sm">
          {saving ? 'جارٍ الحفظ...' : 'حفظ المواقع'}
        </button>
      </div>
    </div>
  )
}

// ── YG Quotas Tab ─────────────────────────────────────────────────────────────

const YG_CASE_STYLES = {
  1: { border: '#93c5fd', bg: '#eff6ff', text: '#1d4ed8', label: 'أقل من العدد المعطى',  dot: '#3b82f6', bar: '#3b82f6' },
  2: { border: '#86efac', bg: '#f0fdf4', text: '#15803d', label: 'مساوي للعدد المعطى',   dot: '#22c55e', bar: '#22c55e' },
  3: { border: '#fcd34d', bg: '#fffbeb', text: '#d97706', label: 'أكثر من العدد المعطى', dot: '#f59e0b', bar: '#f59e0b' },
  4: { border: '#fca5a5', bg: '#fff5f5', text: '#dc2626', label: 'معتذرة',         dot: '#ef4444', bar: '#fca5a5' },
  5: { border: '#c4b5fd', bg: '#f5f3ff', text: '#6d28d9', label: 'لم تعتذر',  dot: '#8b5cf6', bar: '#8b5cf6' },
  6: { border: '#e5e7eb', bg: '#f9fafb', text: '#9ca3af', label: 'بدون عدد معطى', dot: '#d1d5db', bar: '#e5e7eb' },
}

function YgQuotasTab({ eventId, event, onRefresh, toast }) {
  const [youthGroups, setYouthGroups]         = useState([])
  const [quotas, setQuotas]                   = useState({})
  const [saving, setSaving]                   = useState(false)
  const [loadingYgs, setLoadingYgs]           = useState(true)


  const members     = event.registration?.members || []
  const ygApologies = event.yg_apologies || []
  const activeMembers = useMemo(() => members.filter(m => !isAttendanceApologized(m)), [members])
  const attendanceApologizedMembers = useMemo(() => members.filter(isAttendanceApologized), [members])

  const apologizedYgIds = useMemo(
    () => new Set(ygApologies.map(a => a.youth_group_id)),
    [ygApologies]
  )

  useEffect(() => {
    api.listYouthGroupProfiles()
      .then(d => { setYouthGroups(d.groups || d.youth_groups || []); setLoadingYgs(false) })
      .catch(() => setLoadingYgs(false))
  }, [])

  useEffect(() => {
    const q = event.yg_quotas || {}
    setQuotas(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])))
  }, [event.yg_quotas])

  const memberCounts = useMemo(() => {
    const counts = {}
    for (const m of activeMembers)
      if (m.youth_group_id && (m.confirmation_status || 'confirmed') === 'confirmed')
        counts[m.youth_group_id] = (counts[m.youth_group_id] || 0) + 1
    return counts
  }, [activeMembers])

  const waitingCounts = useMemo(() => {
    const counts = {}
    for (const m of activeMembers)
      if (m.youth_group_id && m.confirmation_status === 'pending')
        counts[m.youth_group_id] = (counts[m.youth_group_id] || 0) + 1
    return counts
  }, [activeMembers])

  const deniedCounts = useMemo(() => {
    const counts = {}
    for (const m of activeMembers)
      if (m.youth_group_id && m.confirmation_status === 'denied')
        counts[m.youth_group_id] = (counts[m.youth_group_id] || 0) + 1
    return counts
  }, [activeMembers])

  // Enrich each YG with its case number then sort by case → name
  const sortedGroups = useMemo(() => {
    return [...youthGroups]
      .map(yg => {
        const ygId      = yg.group_id
        const apologized = apologizedYgIds.has(ygId)
        const raw       = quotas[ygId]
        const hasQuota  = raw !== undefined && raw !== null && raw !== ''
        const quota     = hasQuota ? parseInt(raw, 10) : null
        const confirmed = memberCounts[ygId] || 0
        const wait      = waitingCounts[ygId] || 0
        let caseNum
        if (confirmed > 0) {
          if      (hasQuota && !isNaN(quota) && quota > 0 && confirmed < quota) caseNum = 1
          else if (hasQuota && !isNaN(quota) && confirmed === quota && wait === 0) caseNum = 2
          else                                                                   caseNum = 3
        } else {
          if      (apologized)               caseNum = 4
          else if (hasQuota && !isNaN(quota) && quota > 0) caseNum = 5
          else                               caseNum = 6
        }
        return { ...yg, caseNum, quota, confirmed }
      })
      .sort((a, b) => a.caseNum !== b.caseNum
        ? a.caseNum - b.caseNum
        : (a.group_name || '').localeCompare(b.group_name || '', 'ar'))
  }, [youthGroups, quotas, memberCounts, waitingCounts, apologizedYgIds])

  const caseCounts = useMemo(() => {
    const counts = {}
    for (const yg of sortedGroups) counts[yg.caseNum] = (counts[yg.caseNum] || 0) + 1
    return counts
  }, [sortedGroups])

  const totalQuota = useMemo(() =>
    Object.values(quotas).reduce((s, v) => { const n = parseInt(v, 10); return s + (isNaN(n) ? 0 : n) }, 0),
    [quotas]
  )

  const handleSave = async () => {
    const missing = youthGroups.filter(yg => {
      if (apologizedYgIds.has(yg.group_id)) return false
      const v = quotas[yg.group_id]
      return v === undefined || v === null || v === ''
    })
    if (missing.length > 0) {
      toast(`يرجى تحديد العدد المعطى لجميع الشبيبات — ${missing.length} شبيبة بدون عدد`, 'error')
      return
    }
    setSaving(true)
    try {
      const q = Object.fromEntries(
        Object.entries(quotas)
          .map(([k, v]) => [k, parseInt(v, 10)])
          .filter(([, v]) => !isNaN(v) && v >= 0)
      )
      await api.updateEvent(eventId, { yg_quotas: q })
      toast('تم حفظ الأعداد المعطاة', 'success')
      onRefresh()
    } catch {
      toast('تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDownloadXlsx = () => {
    const headers = ['الشبيبة', 'العدد المعطى', 'مؤكّدون', 'انتظار', 'اعتذار', 'الحالة']
    const rows = sortedGroups.map(yg => ({
      'الشبيبة':     yg.group_name || yg.group_id,
      'العدد المعطى': yg.quota !== null && !isNaN(yg.quota) ? yg.quota : '',
      'مؤكّدون':     memberCounts[yg.group_id]  || 0,
      'انتظار':      waitingCounts[yg.group_id] || 0,
      'اعتذار':      deniedCounts[yg.group_id]  || 0,
      'الحالة':      YG_CASE_STYLES[yg.caseNum]?.label || '',
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers })
    worksheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 24 }]

    const numCols = headers.length

    // Header row — dark navy bg, white bold text
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (!worksheet[addr]) worksheet[addr] = { t: 's', v: '' }
      worksheet[addr].s = {
        fill: { patternType: 'solid', fgColor: { rgb: '0F2744' } },
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        alignment: { horizontal: 'center' },
      }
    }

    // Data rows — background matches the UI case color
    sortedGroups.forEach((yg, i) => {
      const bgHex = (YG_CASE_STYLES[yg.caseNum]?.bg || '#ffffff').replace('#', '').toUpperCase()
      for (let c = 0; c < numCols; c++) {
        const addr = XLSX.utils.encode_cell({ r: i + 1, c })
        if (!worksheet[addr]) worksheet[addr] = { t: 's', v: '' }
        worksheet[addr].s = {
          fill: { patternType: 'solid', fgColor: { rgb: bgHex } },
          alignment: { horizontal: c === 0 ? 'right' : 'center' },
        }
      }
    })

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'YG Quotas')
    XLSX.writeFile(workbook, `event-youth-group-quotas-${eventId}.xlsx`)
  }

  if (loadingYgs) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>

  const totalConfirmed = activeMembers.filter(m => (m.confirmation_status || 'confirmed') === 'confirmed').length
  const totalWaiting   = activeMembers.filter(m => m.confirmation_status === 'pending').length
  const totalDenied    = activeMembers.filter(m => m.confirmation_status === 'denied').length

  return (
    <div style={{ direction: 'rtl' }}>

      {/* ── Overall fill bar ── */}
      {totalQuota > 0 && (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 10, padding: '11px 16px', marginBottom: 18, boxShadow: '0 1px 3px rgba(15,39,68,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#64748b' }}>الإشغال الكلي</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f2744', direction: 'ltr' }}>
              {totalConfirmed} / {totalQuota} — {Math.round(totalConfirmed / totalQuota * 100)}%
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(totalConfirmed / totalQuota, 1) * 100}%`, background: 'linear-gradient(90deg, #0f2744, #c9963c)', borderRadius: 4, transition: '0.3s' }} />
          </div>
        </div>
      )}

      {/* ── Section cards ── */}
      {sortedGroups.length > 0 && (() => {
        const participating    = sortedGroups.filter(yg => yg.caseNum <= 3)
        const nonParticipating = sortedGroups.filter(yg => yg.caseNum >= 4)
        const COLS = '1fr 62px 62px 62px 86px'

        const colHeaderRow = (
          <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '6px 16px', background: '#f8fafc', borderBottom: '1px solid #edf0f7' }}>
            {[
              { label: 'الشبيبة', align: 'right'  },
              { label: 'مؤكّد',   align: 'center' },
              { label: 'انتظار',  align: 'center' },
              { label: 'اعتذار',        align: 'center' },
              { label: 'العدد المعطى', align: 'center' },
            ].map(({ label, align }) => (
              <div key={label} style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textAlign: align, letterSpacing: '0.03em' }}>{label}</div>
            ))}
          </div>
        )

        const buildRows = (groups) => {
          const rows = []
          let lastCaseNum = null
          const grpCounts = {}
          for (const yg of groups) grpCounts[yg.caseNum] = (grpCounts[yg.caseNum] || 0) + 1

          for (let i = 0; i < groups.length; i++) {
            const yg = groups[i]

            // Case sub-group label
            if (yg.caseNum !== lastCaseNum) {
              lastCaseNum = yg.caseNum
              const st = YG_CASE_STYLES[yg.caseNum]
              rows.push(
                <div key={`cl-${yg.caseNum}`} style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '5px 16px',
                  background: '#f8fafc',
                  borderTop: i > 0 ? '1px solid #edf0f7' : 'none',
                  borderBottom: '1px solid #edf0f7',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.63rem', fontWeight: 700, color: st.text }}>{st.label}</span>
                  <span style={{ fontSize: '0.6rem', color: '#c5cdd8', fontWeight: 600 }}>({grpCounts[yg.caseNum]})</span>
                </div>
              )
            }

            // Data row
            const ygId       = yg.group_id
            const st         = YG_CASE_STYLES[yg.caseNum]
            const apologized = apologizedYgIds.has(ygId)
            const confirmed  = memberCounts[ygId]  || 0
            const waiting    = waitingCounts[ygId] || 0
            const denied     = deniedCounts[ygId]  || 0
            const raw        = quotas[ygId]
            const hasQuota   = raw !== undefined && raw !== null && raw !== ''
            const quota      = hasQuota ? parseInt(raw, 10) : null
            const isLast     = i === groups.length - 1

            rows.push(
              <div key={ygId} style={{
                display: 'grid', gridTemplateColumns: COLS,
                background: st.bg,
                borderBottom: isLast ? 'none' : '1px solid rgba(226,232,240,0.5)',
                alignItems: 'center',
                minHeight: 44,
              }}>
                {/* Name cell */}
                <div style={{ padding: '9px 16px 9px 8px', borderRight: `3px solid ${st.border}`, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: st.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {yg.group_name || ygId}
                  </span>
                  {!apologized && hasQuota && quota !== null && confirmed > 0 && (
                    <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, color: '#94a3b8', direction: 'ltr', whiteSpace: 'nowrap' }}>
                      {confirmed}/{quota}
                    </span>
                  )}
                </div>

                {/* Confirmed cell */}
                <div style={{ textAlign: 'center', padding: '5px 3px' }}>
                  <span style={{ display: 'inline-block', fontWeight: 800, fontSize: '0.88rem', minWidth: 32, padding: '3px 6px', borderRadius: 7, background: confirmed > 0 ? '#dcfce7' : 'transparent', color: confirmed > 0 ? '#15803d' : '#d1d5db' }}>
                    {confirmed}
                  </span>
                </div>

                {/* Waiting cell */}
                <div style={{ textAlign: 'center', padding: '5px 3px' }}>
                  <span style={{ display: 'inline-block', fontWeight: 800, fontSize: '0.88rem', minWidth: 32, padding: '3px 6px', borderRadius: 7, background: waiting > 0 ? '#fef9c3' : 'transparent', color: waiting > 0 ? '#92400e' : '#d1d5db' }}>
                    {waiting}
                  </span>
                </div>

                {/* Denied cell */}
                <div style={{ textAlign: 'center', padding: '5px 3px' }}>
                  <span style={{ display: 'inline-block', fontWeight: 800, fontSize: '0.88rem', minWidth: 32, padding: '3px 6px', borderRadius: 7, background: denied > 0 ? '#f3f4f6' : 'transparent', color: denied > 0 ? '#4b5563' : '#d1d5db' }}>
                    {denied}
                  </span>
                </div>

                {/* Quota input cell */}
                <div style={{ padding: '5px 16px 5px 8px' }}>
                  <input
                    type="number" min="0"
                    value={quotas[ygId] ?? ''}
                    onChange={e => setQuotas(prev => ({ ...prev, [ygId]: e.target.value }))}
                    placeholder="—"
                    style={{
                      width: '100%', padding: '5px 6px',
                      border: `1.5px solid ${!hasQuota ? '#f0b429' : '#e2e8f0'}`,
                      borderRadius: 7, fontFamily: 'var(--font-body)', fontSize: '0.85rem',
                      textAlign: 'center', outline: 'none', direction: 'ltr',
                      background: !hasQuota ? '#fffbeb' : 'white',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )
          }
          return rows
        }

        const renderSection = (title, dotColor, headerBg, groups) => {
          if (groups.length === 0) return null
          const sectionConfirmed = groups.reduce((s, yg) => s + (memberCounts[yg.group_id] || 0), 0)
          return (
            <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,39,68,0.06)' }}>
              {/* Section header */}
              <div style={{ padding: '11px 16px', background: headerBg, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #edf0f7' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f2744' }}>{title}</span>
                <span style={{ fontSize: '0.67rem', fontWeight: 700, color: '#6b7280', background: 'white', border: '1px solid #e2e8f0', padding: '1px 8px', borderRadius: 8 }}>
                  {groups.length} فرقة
                </span>
                {sectionConfirmed > 0 && (
                  <span style={{ marginRight: 'auto', fontSize: '0.7rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '2px 10px', borderRadius: 20, border: '1px solid #86efac' }}>
                    {sectionConfirmed} مؤكّد
                  </span>
                )}
              </div>
              {/* Column header */}
              {colHeaderRow}
              {/* Grouped rows */}
              <div>{buildRows(groups)}</div>
            </div>
          )
        }

        return (
          <div style={{ display: 'grid', gap: 16 }}>
            {renderSection('المشاركون', '#3b82f6', '#f0f9ff', participating)}
            {renderSection('غير المشاركون', '#94a3b8', '#f8fafc', nonParticipating)}
          </div>
        )
      })()}

      {youthGroups.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ba5bc', border: '1.5px dashed #e9ecf3', borderRadius: 12, fontSize: '0.88rem' }}>
          لا توجد شبيبات مسجّلة في النظام
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={handleDownloadXlsx} disabled={youthGroups.length === 0}
          className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> تنزيل Excel
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-gold btn-sm">
          {saving ? 'جارٍ الحفظ...' : 'حفظ الأعداد'}
        </button>
      </div>
    </div>
  )
}

// ── Main EventDetail ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'info',         label: 'المعلومات',      icon: Edit2,     campOnly: false, teamsOnly: false },
  { id: 'registration', label: 'التسجيل',        icon: Users,     campOnly: false, teamsOnly: false },
  { id: 'schedule',     label: 'جدول البرنامج',  icon: Hash,      campOnly: false, teamsOnly: false },
  { id: 'teams',        label: 'الفرق',           icon: Users,     campOnly: true,  teamsOnly: true  },
  { id: 'yg_quotas',   label: 'حصص الشبيبات',   icon: Hash,      campOnly: true,  teamsOnly: false },
  { id: 'bedrooms',    label: 'المنامات',         icon: Building2, campOnly: true,  teamsOnly: false },
  { id: 'transport',   label: 'دعم المواصلات',   icon: Bus,       campOnly: false, teamsOnly: false },
  { id: 'birthdays',   label: 'أعياد الميلاد',    icon: Cake,      campOnly: false, teamsOnly: false },
]

const REG_SUB_TABS = [
  { id: 'members',      label: 'المشاركون',              icon: Users,     regKey: 'members' },
  { id: 'supervisors',  label: 'المسؤولون',               icon: UserCheck, regKey: 'supervisors' },
  { id: 'gs_committee', label: 'الأمانة العامة واللجان',  icon: Building2, regKey: 'gs_committee' },
  { id: 'guests',       label: 'الضيوف',                  icon: UserPlus,  regKey: 'guests' },
]

export default function EventDetail({ eventId, onBack, toast, onViewProfile, onOpenBibleReference }) {
  const [event, setEvent]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('info')
  const [activeSubTab, setActiveSubTab] = useState('members')

  const load = useCallback(() => {
    setLoading(true)
    api.getEvent(eventId)
      .then(d => { setEvent(d.event); setLoading(false) })
      .catch(() => setLoading(false))
  }, [eventId])

  useEffect(() => { load() }, [load])

  const handleUpdate = async (body) => {
    const res = await api.updateEvent(eventId, body)
    setEvent(res.event)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!event)  return <div style={{ padding: 40, color: '#e53e3e' }}>تعذّر تحميل النشاط.</div>

  const reg = event.registration || {}
  const isCamp = event.event_type === 'مخيم'

  return (
    <div style={{ padding: '20px 24px', direction: 'rtl' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0f2744', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center' }}>
          <ArrowRight size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '1.15rem', lineHeight: 1.2 }}>
            {event.display_name || event.base_title}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#9ba5bc', marginTop: 2 }}>
            {event.jec_year} · {event.event_type}
          </div>
        </div>
        {/* Main logo thumbnail */}
        {event.logos?.find(l => l.is_main) && (
          <img
            src={api.eventLogoUrl(eventId, event.logos.find(l => l.is_main).id)}
            alt="الشعار"
            style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8, border: '1px solid #e2e6ef', background: '#f7f9ff' }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e2e6ef', marginBottom: 20, overflowX: 'auto' }}>
        {TABS.filter(tab => (!tab.campOnly || isCamp) && (!tab.teamsOnly || event.has_teams)).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
              fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap',
              background: 'none', color: activeTab === tab.id ? '#0f2744' : '#9ba5bc',
              borderBottom: `2px solid ${activeTab === tab.id ? '#0f2744' : 'transparent'}`,
              marginBottom: -2, transition: '0.15s', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <tab.icon size={14} /> {tab.label}
            {tab.id === 'registration' && REG_SUB_TABS.reduce((s, t) => s + (reg[t.regKey]?.length || 0), 0) > 0 && (
              <span style={{ fontSize: '0.65rem', background: '#0f2744', color: 'white', padding: '1px 6px', borderRadius: 10 }}>
                {REG_SUB_TABS.reduce((s, t) => s + (reg[t.regKey]?.length || 0), 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {activeTab === 'info' && (
        <div>
          <SectionCard title="المعلومات الأساسيّة" icon={Edit2}>
            <InfoPanel event={event} onSaved={handleUpdate} toast={toast} />
          </SectionCard>

          <SectionCard title="المواقع" icon={MapPin}>
            <LocationsManager event={event} onSaved={handleUpdate} toast={toast} />
          </SectionCard>

          <SectionCard title="الشعارات (Logos)" icon={ImageIcon}>
            <ImageManager eventId={eventId} images={event.logos || []} kind="logos" onRefresh={load} toast={toast} />
          </SectionCard>

          <SectionCard title="البوسترات (Posters)" icon={ImageIcon} defaultOpen={false}>
            <ImageManager eventId={eventId} images={event.posters || []} kind="posters" onRefresh={load} toast={toast} />
          </SectionCard>

          <SectionCard title="المراسلة" icon={FileText} defaultOpen={false}>
            <DocumentManager eventId={eventId} documents={event.documents || []} onRefresh={load} toast={toast} />
          </SectionCard>
        </div>
      )}

      {/* Registration tab with sub-tabs */}
      {activeTab === 'registration' && (
        <div>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid #e2e6ef', marginBottom: 18, overflowX: 'auto' }}>
            {REG_SUB_TABS.map(sub => (
              <button key={sub.id} onClick={() => setActiveSubTab(sub.id)}
                style={{
                  padding: '7px 14px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
                  fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap',
                  background: 'none', color: activeSubTab === sub.id ? '#0f2744' : '#9ba5bc',
                  borderBottom: `2px solid ${activeSubTab === sub.id ? '#0f2744' : 'transparent'}`,
                  marginBottom: -2, transition: '0.15s', display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <sub.icon size={13} /> {sub.label}
                {reg[sub.regKey]?.length > 0 && (
                  <span style={{ fontSize: '0.63rem', background: activeSubTab === sub.id ? '#0f2744' : '#e2e6ef', color: activeSubTab === sub.id ? 'white' : '#4a5568', padding: '1px 6px', borderRadius: 10 }}>
                    {reg[sub.regKey].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeSubTab === 'members' && (
            <MembersRegistrationTab
              eventId={eventId}
              entries={reg.members || []} nights={isCamp ? event.nights : []}
              onRefresh={load} toast={toast} onViewProfile={onViewProfile}
              teams={event.teams || []}
              ygApologies={event.yg_apologies || []}
              eventAgeGroups={event.target_age_groups || []}
            />
          )}
          {activeSubTab === 'supervisors' && (
            <RegistrationTab
              eventId={eventId} regType="supervisors" label="المسؤولون"
              entries={reg.supervisors || []} nights={isCamp ? event.nights : []}
              onRefresh={load} toast={toast} onViewProfile={onViewProfile}
              teams={event.teams || []}
            />
          )}
          {activeSubTab === 'gs_committee' && (
            <RegistrationTab
              eventId={eventId} regType="gs_committee" label="الأمانة العامة واللجان القائمة"
              entries={reg.gs_committee || []} nights={isCamp ? event.nights : []}
              onRefresh={load} toast={toast} onViewProfile={onViewProfile}
              teams={event.teams || []}
            />
          )}
          {activeSubTab === 'guests' && (
            <RegistrationTab
              eventId={eventId} regType="guests" label="الضيوف"
              entries={reg.guests || []} nights={isCamp ? event.nights : []}
              onRefresh={load} toast={toast} onViewProfile={onViewProfile}
              teams={event.teams || []}
            />
          )}
        </div>
      )}
      {activeTab === 'schedule' && (
        <EventSchedule eventId={eventId} event={event} onRefresh={load} toast={toast} />
      )}
      {activeTab === 'teams' && isCamp && event.has_teams && (
        <EventTeams eventId={eventId} event={event} onRefresh={load} toast={toast} />
      )}
      {activeTab === 'yg_quotas' && isCamp && (
        <YgQuotasTab eventId={eventId} event={event} onRefresh={load} toast={toast} />
      )}
      {activeTab === 'bedrooms' && isCamp && (
        <EventBedrooms eventId={eventId} event={event} onRefresh={load} toast={toast} />
      )}
      {activeTab === 'transport' && (
        <EventTransportSupport eventId={eventId} event={event} onRefresh={load} toast={toast} />
      )}
      {activeTab === 'birthdays' && (
        <EventBirthdays event={event} />
      )}
    </div>
  )
}
