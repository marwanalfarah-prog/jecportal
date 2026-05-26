import { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import {
  Plus, Trash2, Edit2, X, Save, ArrowRight,
  Users, User, CheckCircle, FileText, MessageSquare,
  ToggleLeft, ToggleRight, Search, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react'
import { api } from '../api.js'
import { EmptyState, ErrorState, LoadingState } from '../pageStates.jsx'

// ─── Constants — mirror OrgTree exactly ───────────────────────────────────────
const BARAEM_GROUP = 'البراعم'
const BARAEM_BIG_GROUP = 'البراعم الكبرى'
const BARAEM_SMALL_GROUP = 'البراعم الصغرى'
const BARAEM_ROLE_GROUPS = [BARAEM_GROUP, BARAEM_BIG_GROUP, BARAEM_SMALL_GROUP]
const BARAEM_DETAIL_OPTIONS = [
  { value: BARAEM_GROUP, label: 'عام' },
  { value: BARAEM_BIG_GROUP, label: 'الكبرى' },
  { value: BARAEM_SMALL_GROUP, label: 'الصغرى' },
]
const AGE_GROUPS = [BARAEM_GROUP, 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
const COMMITTEES = [
  'اللجنة الإعلاميّة', 'اللجنة الفنيّة', 'اللجنة الاجتماعيّة', 'لجنة الخدمة',
  'لجنة العلاقات العامة', 'اللجنة اللوجستية', 'الفرقة الموسيقيّة', 'لجنة التنظيم',
  'اللجنة الروحيّة', 'لجنة عمل المحبة', 'لجنة المواضيع', 'لجنة النشاطات',
  'لجنة التدريب والتطوير', 'لجنة المساندة العامة', 'اللجنة الترفيهيّة',
]
const ROLE_TABS = [
  { id: 'gm',          label: 'مسؤول عام / نائب' },
  { id: 'spiritual',   label: 'المرشدون الروحيون' },
  { id: 'secretaries', label: 'الأمناء' },
  { id: 'agegroup',    label: 'مسؤول فئة' },
  { id: 'committee',   label: 'لجنة' },
]

function hasBaraemSelection(groups) {
  const list = Array.isArray(groups) ? groups : []
  return BARAEM_ROLE_GROUPS.some(g => list.includes(g))
}

function selectedBaraemGroup(groups) {
  const list = Array.isArray(groups) ? groups : []
  return BARAEM_ROLE_GROUPS.find(g => list.includes(g)) || ''
}

function setBaraemGroup(groups, group) {
  const list = Array.isArray(groups) ? groups : []
  return [...list.filter(g => !BARAEM_ROLE_GROUPS.includes(g)), group]
}

function toggleAgeGroupSelection(groups, group) {
  const list = Array.isArray(groups) ? groups : []
  if (group === BARAEM_GROUP) {
    return hasBaraemSelection(list)
      ? list.filter(g => !BARAEM_ROLE_GROUPS.includes(g))
      : [...list, BARAEM_GROUP]
  }
  return list.includes(group) ? list.filter(x => x !== group) : [...list, group]
}
// Google Forms-equivalent question types
const QUESTION_TYPES = [
  { id: 'short_text',  label: 'إجابة قصيرة',     icon: '▬' },
  { id: 'paragraph',   label: 'فقرة',              icon: '≡' },
  { id: 'choice',      label: 'اختيار من متعدد',  icon: '◉' },
  { id: 'checkbox',    label: 'مربعات اختيار',    icon: '☑' },
  { id: 'dropdown',    label: 'قائمة منسدلة',     icon: '▾' },
  { id: 'scale',       label: 'مقياس خطي',        icon: '◁▷' },
  { id: 'date',        label: 'تاريخ',             icon: '📅' },
  { id: 'time',        label: 'وقت',               icon: '🕐' },
  { id: 'yes_no',      label: 'نعم / لا',          icon: '✓✗' },
  { id: 'redirect',    label: 'رابط / توجيه',      icon: '↗' },
]
const REDIRECT_PAGES = [
  { id: 'promotions', label: 'الترفيعات' },
  { id: 'orgtree',    label: 'الهيكل التنظيمي' },
  { id: 'profile',    label: 'ملفي الشخصي' },
]

const uid = () => Math.random().toString(36).slice(2, 10)

// ─── Shared mini-styles ───────────────────────────────────────────────────────
const inp = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef',
  borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.9rem',
  direction: 'rtl', outline: 'none', background: '#fafbfc', boxSizing: 'border-box',
}
const btnSty = (v = 'navy', sm = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: sm ? '6px 12px' : '9px 18px',
  borderRadius: 8, border: 'none', cursor: 'pointer',
  fontFamily: 'var(--font-body)', fontSize: sm ? '0.8rem' : '0.88rem', fontWeight: 700,
  ...(v === 'navy'  ? { background: '#0f2744', color: 'white' } :
      v === 'red'   ? { background: '#fee2e2', color: '#c62828', border: '1px solid #fca5a5' } :
      { background: '#f0f4ff', color: '#0f2744', border: '1.5px solid #c5d8f8' }),
})
const checkBox = (active) => (
  <span style={{
    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
    border: `2px solid ${active ? '#0f2744' : '#c8d0e0'}`,
    background: active ? '#0f2744' : 'white',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.6rem', color: 'white', transition: 'all 0.12s',
  }}>{active ? '✓' : ''}</span>
)
const rowBtnSty = (active) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderRadius: 8, cursor: 'pointer', width: '100%',
  border: `1.5px solid ${active ? '#0f2744' : '#e2e6ef'}`,
  background: active ? '#0f2744' : 'white',
  fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: active ? 700 : 500,
  color: active ? 'white' : '#4a5568', transition: 'all 0.12s',
})
const chkBtnSty = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px',
  borderRadius: 8, cursor: 'pointer',
  border: `1.5px solid ${active ? '#0f2744' : '#e2e6ef'}`,
  background: active ? '#eef4ff' : 'white',
  fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: active ? 700 : 500,
  color: active ? '#0f2744' : '#4a5568', transition: 'all 0.12s',
})

// ─── Role Picker — mirrors OrgTree's RolePicker exactly ──────────────────────
function RolePicker({ value, onChange }) {
  const v = value || {}
  const tab                = v.tab               ?? null
  const gmValue            = v.gmValue           ?? ''
  const spiritualValue     = v.spiritualValue    ?? ''
  const sgGroups           = v.sgGroups          ?? []
  const secretaryValue     = v.secretaryValue    ?? ''
  const secretaryAssist    = v.secretaryAssistant?? false
  const selectedGroups     = v.selectedGroups    ?? []
  const ageMemberType      = v.ageMemberType     ?? 'مسؤول'
  const selectedCommittees = v.selectedCommittees?? []
  const committeeMemberType= v.committeeMemberType?? 'عضو'
  const isActing           = v.isActing          ?? false

  const set        = (patch) => onChange({ ...v, ...patch })
  const toggleGrp  = (g) => set({ selectedGroups: toggleAgeGroupSelection(selectedGroups, g) })
  const toggleSg   = (g) => set({ sgGroups: toggleAgeGroupSelection(sgGroups, g) })
  const toggleCom  = (c) => set({ selectedCommittees: selectedCommittees.includes(c) ? selectedCommittees.filter(x=>x!==c) : [...selectedCommittees, c] })

  const secSty = { padding: '12px 14px', background: '#f8f9fd', borderRadius: 8, border: '1px solid #e2e6ef', marginTop: 8 }
  const lblSty = { fontSize: '0.72rem', fontWeight: 700, color: '#9ba5bc', display: 'block', marginBottom: 6, letterSpacing: '0.04em' }

  return (
    <div>
      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 6 }}>
        المسؤولية / الدور *
      </label>
      {/* 5 tabs identical to OrgTree */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 3, marginBottom: 4 }}>
        {ROLE_TABS.map(t => (
          <button key={t.id} type="button"
            onClick={() => set({ tab: tab === t.id ? null : t.id })}
            style={{
              padding: '5px 4px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700,
              cursor: 'pointer', border: `1.5px solid ${tab === t.id ? '#0f2744' : '#e2e6ef'}`,
              background: tab === t.id ? '#0f2744' : 'white',
              color: tab === t.id ? 'white' : '#4a5568',
              fontFamily: 'var(--font-body)', lineHeight: 1.3, textAlign: 'center', transition: 'all 0.12s',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1 — GM */}
      {tab === 'gm' && (
        <div style={secSty}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {['المسؤول العام', 'نائب المسؤول العام', 'مستشار الشبيبة'].map(r => (
              <button key={r} type="button" style={rowBtnSty(gmValue === r)} onClick={() => set({ gmValue: r })}>
                <span>{r}</span>{checkBox(gmValue === r)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2 — Spiritual */}
      {tab === 'spiritual' && (
        <div style={secSty}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {['المرشد الروحي', 'مساعد المرشد الروحي', 'مرشد روحي فئة'].map(r => (
              <button key={r} type="button" style={rowBtnSty(spiritualValue === r)}
                onClick={() => set({ spiritualValue: r, sgGroups: r !== 'مرشد روحي فئة' ? [] : sgGroups })}>
                <span>{r}</span>{checkBox(spiritualValue === r)}
              </button>
            ))}
          </div>
          {spiritualValue === 'مرشد روحي فئة' && (
            <>
              <span style={lblSty}>الفئات العمرية</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {AGE_GROUPS.map(g => (
                  <button key={g} type="button" style={chkBtnSty(g === BARAEM_GROUP ? hasBaraemSelection(sgGroups) : sgGroups.includes(g))} onClick={() => toggleSg(g)}>
                    {checkBox(g === BARAEM_GROUP ? hasBaraemSelection(sgGroups) : sgGroups.includes(g))} {g}
                  </button>
                ))}
              </div>
              {hasBaraemSelection(sgGroups) && (
                <div style={{ marginTop: 8 }}>
                  <span style={lblSty}>تفصيل البراعم</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {BARAEM_DETAIL_OPTIONS.map(opt => (
                      <button key={opt.value} type="button" style={chkBtnSty(selectedBaraemGroup(sgGroups) === opt.value)} onClick={() => set({ sgGroups: setBaraemGroup(sgGroups, opt.value) })}>
                        {checkBox(selectedBaraemGroup(sgGroups) === opt.value)} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab 3 — Secretaries */}
      {tab === 'secretaries' && (
        <div style={secSty}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {['أمين الصندوق', 'أمين السر', 'أمين العهدة'].map(r => (
              <button key={r} type="button" style={rowBtnSty(secretaryValue === r)} onClick={() => set({ secretaryValue: r })}>
                <span>{r}</span>{checkBox(secretaryValue === r)}
              </button>
            ))}
          </div>
          {secretaryValue && (
            <button type="button" style={chkBtnSty(secretaryAssist)} onClick={() => set({ secretaryAssistant: !secretaryAssist })}>
              {checkBox(secretaryAssist)} مساعد (مثال: مساعد {secretaryValue})
            </button>
          )}
        </div>
      )}

      {/* Tab 4 — Age group */}
      {tab === 'agegroup' && (
        <div style={secSty}>
          <span style={lblSty}>نوع المشاركة</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {['مسؤول', 'عضو مجلس', 'مسؤول مساعد'].map(mt => (
              <button key={mt} type="button" style={chkBtnSty(ageMemberType === mt)} onClick={() => set({ ageMemberType: mt })}>
                {checkBox(ageMemberType === mt)} {mt}
              </button>
            ))}
          </div>
          <span style={lblSty}>الفئات العمرية</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {AGE_GROUPS.map(g => (
              <button key={g} type="button" style={chkBtnSty(g === BARAEM_GROUP ? hasBaraemSelection(selectedGroups) : selectedGroups.includes(g))} onClick={() => toggleGrp(g)}>
                {checkBox(g === BARAEM_GROUP ? hasBaraemSelection(selectedGroups) : selectedGroups.includes(g))} {g}
              </button>
            ))}
          </div>
          {hasBaraemSelection(selectedGroups) && (
            <div style={{ marginTop: 8 }}>
              <span style={lblSty}>تفصيل البراعم</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {BARAEM_DETAIL_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" style={chkBtnSty(selectedBaraemGroup(selectedGroups) === opt.value)} onClick={() => set({ selectedGroups: setBaraemGroup(selectedGroups, opt.value) })}>
                    {checkBox(selectedBaraemGroup(selectedGroups) === opt.value)} {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 5 — Committee */}
      {tab === 'committee' && (
        <div style={secSty}>
          <span style={lblSty}>اللجان (يمكن اختيار أكثر من واحدة)</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {COMMITTEES.map(c => (
              <button key={c} type="button" style={rowBtnSty(selectedCommittees.includes(c))} onClick={() => toggleCom(c)}>
                <span>{c}</span>{checkBox(selectedCommittees.includes(c))}
              </button>
            ))}
          </div>
          <span style={lblSty}>الصفة</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {['مسؤول', 'عضو'].map(mt => (
              <button key={mt} type="button" style={chkBtnSty(committeeMemberType === mt)} onClick={() => set({ committeeMemberType: mt })}>
                {checkBox(committeeMemberType === mt)} {mt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* قائم بأعمال */}
      {tab && (
        <button type="button"
          style={{ ...chkBtnSty(isActing), marginTop: 8, width: '100%', justifyContent: 'space-between' }}
          onClick={() => set({ isActing: !isActing })}>
          <span>قائم بأعمال</span>{checkBox(isActing)}
        </button>
      )}
    </div>
  )
}

// ─── Youth Group Multi-select Dropdown (portal to escape overflow clipping) ───
function YouthGroupPicker({ youthGroups, selected, onChange }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [rect, setRect]     = useState(null)
  const triggerRef          = useRef(null)
  const dropRef             = useRef(null)

  const getVal = (g) => (typeof g === 'object' ? g.value : g)
  const getLbl = (g) => (typeof g === 'object' ? (g.label || g.value) : g)
  const filtered = youthGroups.filter(g => !search.trim() || getLbl(g).toLowerCase().includes(search.trim().toLowerCase()))
  const toggle   = (g) => onChange(selected.includes(g) ? selected.filter(x => x !== g) : [...selected, g])
  const selectedLabels = selected.map(v => {
    const hit = youthGroups.find(g => getVal(g) === v)
    return hit ? getLbl(hit) : v
  })

  const label = selected.length === 0                ? '— اختر فرقة شبيبة —'
              : selected.length === youthGroups.length ? 'جميع فرق الشبيبة'
              : selected.length === 1                 ? selectedLabels[0]
              : `${selected.length} مجموعات مختارة`

  const handleOpen = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setRect({ top: r.bottom + 2, left: r.left, width: r.width })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (dropRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const update = () => {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect()
        setRect({ top: r.bottom + 2, left: r.left, width: r.width })
      }
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [open])

  return (
    <div>
      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }}>
        فرقة الشبيبة *
        <span style={{ fontSize: '0.72rem', fontWeight: 500, color: '#9ba5bc', marginRight: 6 }}>(يجب اختيار فرقة واحدة على الأقل)</span>
      </label>

      <button ref={triggerRef} type="button" onClick={handleOpen}
        style={{
          ...inp, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', background: open ? '#fff' : '#fafbfc',
          borderColor: open ? '#0f2744' : selected.length === 0 ? '#fca5a5' : '#e2e6ef',
        }}>
        <span style={{ color: selected.length === 0 ? '#9ba5bc' : '#0f2744', fontWeight: selected.length > 0 ? 700 : 400 }}>
          {label}
        </span>
        {open ? <ChevronUp size={15} color="#9ba5bc" /> : <ChevronDown size={15} color="#9ba5bc" />}
      </button>

      {open && rect && ReactDOM.createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: rect.top,
          left: rect.left,
          width: rect.width,
          zIndex: 99999,
          background: 'white',
          border: '1.5px solid #0f2744',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          maxHeight: 300,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e6ef', position: 'relative', flexShrink: 0 }}>
            <Search size={13} style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc', pointerEvents: 'none' }}/>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="بحث…"
              style={{ ...inp, paddingRight: 28, fontSize: '0.82rem', padding: '6px 28px 6px 8px', borderColor: '#e2e6ef' }} />
          </div>
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e6ef', flexShrink: 0 }}>
            <button type="button" onClick={() => onChange(youthGroups.map(g => getVal(g)))}
              style={{ flex: 1, padding: '7px', background: 'none', border: 'none', borderLeft: '1px solid #e2e6ef', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, color: '#0f2744' }}>
              ✓ تحديد الكل
            </button>
            <button type="button" onClick={() => onChange([])}
              style={{ flex: 1, padding: '7px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, color: '#9ba5bc' }}>
              ✕ مسح الكل
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(g => {
              const gid = getVal(g)
              const chk = selected.includes(gid)
              return (
                <button key={gid} type="button" onClick={() => toggle(gid)}
                  style={{ width: '100%', padding: '9px 14px', background: chk ? '#eef4ff' : 'none', border: 'none', borderBottom: '1px solid #f5f6fa', cursor: 'pointer', textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10 }}
                  onMouseEnter={e => { if (!chk) e.currentTarget.style.background = '#f8f9fd' }}
                  onMouseLeave={e => { if (!chk) e.currentTarget.style.background = 'none' }}>
                  {checkBox(chk)}
                  <span style={{ fontWeight: chk ? 700 : 500, color: chk ? '#0f2744' : '#4a5568' }}>{getLbl(g)}</span>
                </button>
              )
            })}
            {filtered.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#9ba5bc', fontSize: '0.82rem' }}>لا توجد نتائج</div>}
          </div>
          <div style={{ padding: '7px 14px', borderTop: '1px solid #e2e6ef', fontSize: '0.74rem', color: '#9ba5bc', textAlign: 'center', flexShrink: 0 }}>
            {selected.length} من {youthGroups.length} فرقة مختارة
          </div>
        </div>,
        document.body
      )}

      {selected.length > 0 && selected.length < youthGroups.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
          {selected.map((g, idx) => (
            <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eef4ff', border: '1px solid #c5d8f8', borderRadius: 6, padding: '2px 8px', fontSize: '0.75rem', color: '#0f2744', fontWeight: 600 }}>
              {selectedLabels[idx] || g}
              <button type="button" onClick={() => toggle(g)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 0, display: 'flex' }}>
                <X size={10}/>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Question Editor — Google Forms style ────────────────────────────────────
function QuestionEditor({ question, index, total, onChange, onRemove, onMoveUp, onMoveDown }) {
  const [optInput, setOptInput] = useState('')

  const addOption = () => {
    if (!optInput.trim()) return
    onChange({ ...question, options: [...(question.options || []), optInput.trim()] })
    setOptInput('')
  }

  const needsOptions = ['choice', 'checkbox', 'dropdown'].includes(question.type)
  const isScale      = question.type === 'scale'
  const isRedirect   = question.type === 'redirect'

  return (
    <div style={{ border: '1.5px solid #e2e6ef', borderRadius: 12, marginBottom: 14, overflow: 'hidden', background: 'white' }}>
      <div style={{ background: '#f8f9fd', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #e2e6ef' }}>
        <span style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.78rem', background: '#e2e6ef', borderRadius: 6, padding: '2px 8px' }}>س {index + 1}</span>
        <div style={{ flex: 1 }}/>
        <button onClick={onMoveUp} disabled={index === 0} style={{ background: 'none', border: 'none', cursor: index === 0 ? 'default' : 'pointer', color: '#9ba5bc', padding: '2px 5px', opacity: index === 0 ? 0.3 : 1 }}>↑</button>
        <button onClick={onMoveDown} disabled={index === total - 1} style={{ background: 'none', border: 'none', cursor: index === total - 1 ? 'default' : 'pointer', color: '#9ba5bc', padding: '2px 5px', opacity: index === total - 1 ? 0.3 : 1 }}>↓</button>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', padding: '2px 5px', display: 'flex' }}><Trash2 size={15}/></button>
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ marginBottom: 12 }}>
          <input value={question.text} onChange={e => onChange({ ...question, text: e.target.value })}
            placeholder="نص السؤال *"
            style={{ ...inp, fontSize: '0.95rem', fontWeight: 600, borderColor: question.text ? '#e2e6ef' : '#fca5a5' }}/>
        </div>

        {/* Type picker — Google Forms style */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9ba5bc', marginBottom: 6, letterSpacing: '0.04em' }}>نوع السؤال</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {QUESTION_TYPES.map(t => {
              const active = question.type === t.id
              return (
                <button key={t.id} type="button"
                  onClick={() => onChange({ ...question, type: t.id })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                    border: `1.5px solid ${active ? '#0f2744' : '#e2e6ef'}`,
                    background: active ? '#0f2744' : 'white',
                    color: active ? 'white' : '#4a5568',
                    fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: active ? 700 : 500,
                    transition: 'all 0.12s',
                  }}>
                  <span style={{ opacity: 0.8, fontSize: '0.7rem' }}>{t.icon}</span>
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Options for choice / checkbox / dropdown */}
        {needsOptions && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9ba5bc', marginBottom: 6 }}>الخيارات</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {(question.options || []).map((opt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {question.type === 'choice'   && <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #c8d0e0', flexShrink: 0 }}/>}
                  {question.type === 'checkbox' && <span style={{ width: 14, height: 14, borderRadius: 3, border: '2px solid #c8d0e0', flexShrink: 0 }}/>}
                  {question.type === 'dropdown' && <span style={{ color: '#9ba5bc', fontSize: '0.75rem', flexShrink: 0, minWidth: 18 }}>{i+1}.</span>}
                  <input value={opt} onChange={e => { const ops=[...question.options]; ops[i]=e.target.value; onChange({ ...question, options: ops }) }}
                    style={{ ...inp, flex: 1 }} placeholder={`الخيار ${i+1}`}/>
                  <button type="button" onClick={() => onChange({ ...question, options: question.options.filter((_,j) => j!==i) })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', display: 'flex', padding: 3 }}>
                    <X size={13}/>
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={optInput} onChange={e => setOptInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addOption()}
                placeholder="إضافة خيار…" style={{ ...inp, flex: 1 }}/>
              <button type="button" onClick={addOption} style={btnSty('outline', true)}>إضافة</button>
            </div>
          </div>
        )}

        {/* Scale */}
        {isScale && (
          <div style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {[{ key:'scale_min', label:'من', opts:[0,1] }, { key:'scale_max', label:'إلى', opts:[2,3,4,5,6,7,8,9,10] }].map(({key,label,opts}) => (
              <div key={key}>
                <div style={{ fontSize:'0.72rem', color:'#9ba5bc', fontWeight:700, marginBottom:4 }}>{label}</div>
                <select value={question[key] ?? (key==='scale_min'?1:5)} onChange={e => onChange({ ...question, [key]: +e.target.value })} style={inp}>
                  {opts.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            ))}
            <div>
              <div style={{ fontSize:'0.72rem', color:'#9ba5bc', fontWeight:700, marginBottom:4 }}>تسمية البداية</div>
              <input value={question.scale_label_min??''} onChange={e => onChange({ ...question, scale_label_min: e.target.value })} placeholder="مثال: سيء" style={inp}/>
            </div>
            <div>
              <div style={{ fontSize:'0.72rem', color:'#9ba5bc', fontWeight:700, marginBottom:4 }}>تسمية النهاية</div>
              <input value={question.scale_label_max??''} onChange={e => onChange({ ...question, scale_label_max: e.target.value })} placeholder="مثال: ممتاز" style={inp}/>
            </div>
          </div>
        )}

        {/* Redirect */}
        {isRedirect && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize:'0.72rem', color:'#9ba5bc', fontWeight:700, marginBottom:4 }}>الصفحة المستهدفة</div>
              <select value={question.redirect_page||''} onChange={e => onChange({ ...question, redirect_page: e.target.value })} style={inp}>
                <option value="">— اختر —</option>
                {REDIRECT_PAGES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:'0.72rem', color:'#9ba5bc', fontWeight:700, marginBottom:4 }}>نص الرابط</div>
              <input value={question.redirect_label||''} onChange={e => onChange({ ...question, redirect_label: e.target.value })}
                placeholder="افتح صفحة الترفيعات" style={inp}/>
            </div>
          </div>
        )}

        {/* Required */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid #f5f6fa' }}>
          <button type="button" onClick={() => onChange({ ...question, required: !question.required })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            {question.required ? <ToggleRight size={22} color="#0f2744"/> : <ToggleLeft size={22} color="#9ba5bc"/>}
            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: '#4a5568', fontWeight: question.required ? 700 : 500 }}>
              إجابة إلزامية
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Response Viewer ──────────────────────────────────────────────────────────
function ResponseViewer({ questionnaire, onClose }) {
  const [responses, setResponses] = useState([])
  const [questions, setQuestions] = useState(questionnaire.questions || [])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)

  useEffect(() => {
    api.getQuestionnaireResponses(questionnaire.id)
      .then(d => {
        setResponses(d.responses || [])
        // Use freshly-fetched questionnaire questions if backend returns them
        if (d.questionnaire?.questions?.length) setQuestions(d.questionnaire.questions)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [questionnaire.id])

  const qMap = Object.fromEntries(questions.map(q => [q.id, q]))

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'white', borderRadius:16, width:'100%', maxWidth:800, maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,0.28)', direction:'rtl' }}>
        <div style={{ padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'#0f2744', borderRadius:'16px 16px 0 0' }}>
          <div>
            <div style={{ color:'white', fontWeight:800 }}>ردود الاستبيان</div>
            <div style={{ color:'rgba(255,255,255,0.55)', fontSize:'0.78rem' }}>{questionnaire.title} · {responses.length} رد</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer' }}><X size={20}/></button>
        </div>
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
          <div style={{ width:220, borderLeft:'1px solid #e2e6ef', overflowY:'auto', flexShrink:0 }}>
            {loading ? <div style={{ padding:32, textAlign:'center' }}><div className="spinner"/></div>
            : responses.length === 0 ? <div style={{ padding:24, textAlign:'center', color:'#9ba5bc', fontSize:'0.85rem' }}>لا توجد ردود بعد</div>
            : responses.map(r => (
              <button key={r.id} onClick={() => setSelected(r)}
                style={{ width:'100%', padding:'11px 14px', background:selected?.id===r.id?'#eef4ff':'none', border:'none', borderBottom:'1px solid #f5f6fa', cursor:'pointer', textAlign:'right', fontFamily:'var(--font-body)', display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:r.read_by_admin?'#c8d0e0':'#c9963c', flexShrink:0 }}/>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:'0.85rem', color:'#1a2a3a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.respondent_name}</div>
                  <div style={{ fontSize:'0.72rem', color:'#9ba5bc' }}>{new Date(r.submitted_at).toLocaleDateString('ar-EG')}</div>
                </div>
              </button>
            ))}
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:20 }}>
            {!selected
              ? <div style={{ textAlign:'center', color:'#9ba5bc', marginTop:60 }}><MessageSquare size={40} style={{ opacity:0.3, marginBottom:12 }}/><div>اختر مستجيباً من القائمة</div></div>
              : <>
                  <div style={{ marginBottom:16, padding:'10px 14px', background:'#f8f9fd', borderRadius:8, border:'1px solid #e2e6ef' }}>
                    <div style={{ fontWeight:800, color:'#0f2744' }}>{selected.respondent_name}</div>
                    <div style={{ fontSize:'0.78rem', color:'#9ba5bc' }}>{new Date(selected.submitted_at).toLocaleString('ar-EG')}</div>
                  </div>
                  {(selected.answers||[]).map((ans,i) => {
                    const q = qMap[ans.question_id]
                    const qText = q?.text || `سؤال ${i+1}`
                    // Normalize answer to a displayable string regardless of stored format
                    const raw = ans.answer
                    let display
                    if (raw === null || raw === undefined || raw === '') {
                      display = '—'
                    } else if (Array.isArray(raw)) {
                      display = raw.length ? raw.join(' | ') : '—'
                    } else if (typeof raw === 'object') {
                      // e.g. {question_id: ..., answer: ...} nested accidentally
                      const inner = raw.answer ?? raw.value ?? JSON.stringify(raw)
                      display = Array.isArray(inner) ? inner.join(' | ') : String(inner)
                    } else {
                      display = String(raw)
                    }
                    return (
                      <div key={i} style={{ marginBottom:14, padding:'12px 14px', border:'1px solid #e2e6ef', borderRadius:8 }}>
                        <div style={{ fontSize:'0.82rem', color:'#4a5568', fontWeight:700, marginBottom:6 }}>س{i+1}: {qText}</div>
                        <div style={{ fontSize:'0.9rem', color:'#1a2a3a', fontWeight:600, background:'#f8f9fd', padding:'7px 10px', borderRadius:6 }}>{display}</div>
                      </div>
                    )
                  })}
                </>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Questionnaire Form ───────────────────────────────────────────────────────
const blankRole = { tab: null, gmValue:'', spiritualValue:'', sgGroups:[], secretaryValue:'', secretaryAssistant:false, selectedGroups:[], ageMemberType:'مسؤول', selectedCommittees:[], committeeMemberType:'عضو', isActing:false }

function QuestionnaireForm({ initial, youthGroups, persons, onSave, onCancel, toast }) {
  const blank = { title:'', description:'', active:true, target_type:'role', role:blankRole, target_youth_groups:[], target_person_id:null, target_person_type:null, target_person_name:null, questions:[] }
  const [form, setForm]       = useState(initial ? { ...blank, ...initial, role:initial.role||blankRole, target_youth_groups:initial.target_youth_groups||[] } : blank)
  const [saving, setSaving]   = useState(false)
  const [pSearch, setPSearch] = useState('')

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const addQ  = () => setF('questions', [...form.questions, { id:uid(), text:'', type:'short_text', options:[], required:false, scale_min:1, scale_max:5 }])
  const updQ  = (i,q)=> { const qs=[...form.questions]; qs[i]=q; setF('questions',qs) }
  const delQ  = (i)  => setF('questions', form.questions.filter((_,j)=>j!==i))
  const moveQ = (i,d)=> { const qs=[...form.questions]; const t=i+d; if(t<0||t>=qs.length)return; [qs[i],qs[t]]=[qs[t],qs[i]]; setF('questions',qs) }

  const submit = async () => {
    if (!form.title.trim())                                        { toast('يرجى إدخال عنوان الاستبيان','error'); return }
    if (form.target_type==='role' && !form.role?.tab)              { toast('يرجى اختيار نوع المسؤولية','error'); return }
    if (form.target_type==='role' && form.target_youth_groups.length===0) { toast('يرجى اختيار فرقة شبيبة واحدة على الأقل','error'); return }
    if (form.target_type==='person' && !form.target_person_id)    { toast('يرجى اختيار الشخص المستهدف','error'); return }
    if (form.questions.length===0)                                 { toast('يرجى إضافة سؤال واحد على الأقل','error'); return }
    setSaving(true)
    try {
      // Flatten the nested `role` object into the flat fields the backend expects
      const r = form.role || {}
      const payload = {
        title:              form.title,
        description:        form.description,
        active:             form.active,
        target_type:        form.target_type,
        questions:          form.questions,
        // role targeting — flat fields matching backend schema
        role_tab:           form.target_type === 'role' ? (r.tab || null) : null,
        role_member_type:   form.target_type === 'role'
          ? (r.tab === 'agegroup'   ? (r.ageMemberType || null)
           : r.tab === 'committee'  ? (r.committeeMemberType || null)
           : r.tab === 'secretaries'? (r.secretaryAssistant ? 'مساعد' : r.secretaryValue || null)
           : r.tab === 'gm'         ? (r.gmValue || null)
           : r.tab === 'spiritual'  ? (r.spiritualValue || null)
           : null)
          : null,
        role_groups:        form.target_type === 'role'
          ? (r.tab === 'agegroup'  ? (r.selectedGroups?.length  ? r.selectedGroups  : null)
           : r.tab === 'spiritual' ? (r.sgGroups?.length        ? r.sgGroups        : null)
           : null)
          : null,
        role_committees:    form.target_type === 'role' && r.tab === 'committee'
          ? (r.selectedCommittees?.length ? r.selectedCommittees : null)
          : null,
        role_is_acting:     form.target_type === 'role' ? (r.isActing || false) : false,
        // youth groups — store as array; keep single-value field for backward compat
        target_youth_groups: form.target_type === 'role' ? (form.target_youth_groups || []) : [],
        target_youth_group:  form.target_type === 'role' && form.target_youth_groups?.length === 1
          ? form.target_youth_groups[0] : null,
        // person targeting
        target_person_id:   form.target_type === 'person' ? form.target_person_id   : null,
        target_person_type: form.target_type === 'person' ? form.target_person_type : null,
        target_person_name: form.target_type === 'person' ? form.target_person_name : null,
        // keep raw role for round-trip editing
        role:               form.target_type === 'role' ? r : null,
      }
      await onSave(payload)
    } catch { toast('حدث خطأ أثناء الحفظ','error') }
    setSaving(false)
  }

  const filtP = persons.filter(p => {
    const q = pSearch.trim().toLowerCase()
    if (!q) return true
    return (p.display_name||p.username||'').toLowerCase().includes(q) || String(p.person_id||'').includes(q)
  }).slice(0,30)

  const crd = { background:'white', borderRadius:12, border:'1px solid #e2e6ef', overflow:'hidden', marginBottom:16 }
  const hdr = { padding:'13px 18px', borderBottom:'1px solid #e2e6ef', display:'flex', alignItems:'center', justifyContent:'space-between', background:'#f8f9fd' }
  const lbl = { fontSize:'0.78rem', fontWeight:700, color:'#4a5568', display:'block', marginBottom:5 }

  return (
    <div style={{ maxWidth:820, margin:'0 auto' }}>
      <div style={crd}>
        <div style={hdr}><span style={{ fontWeight:800, color:'#0f2744' }}>معلومات الاستبيان</span></div>
        <div style={{ padding:18 }}>
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>العنوان *</label>
            <input value={form.title} onChange={e=>setF('title',e.target.value)} placeholder="عنوان الاستبيان…"
              style={{ ...inp, borderColor:form.title?'#e2e6ef':'#fca5a5' }}/>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>وصف / تعليمات (اختياري)</label>
            <textarea value={form.description} onChange={e=>setF('description',e.target.value)} placeholder="أضف وصفاً أو تعليمات…" rows={3}
              style={{ ...inp, resize:'vertical', fontFamily:'var(--font-body)' }}/>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button type="button" onClick={()=>setF('active',!form.active)} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', color:form.active?'#0f2744':'#9ba5bc' }}>
              {form.active ? <ToggleRight size={26}/> : <ToggleLeft size={26}/>}
            </button>
            <span style={{ fontSize:'0.85rem', color:'#4a5568' }}>{form.active?'الاستبيان نشط':'الاستبيان معطّل'}</span>
          </div>
        </div>
      </div>

      <div style={crd}>
        <div style={hdr}><span style={{ fontWeight:800, color:'#0f2744' }}>الاستهداف</span></div>
        <div style={{ padding:18 }}>
          <div style={{ display:'flex', gap:10, marginBottom:18 }}>
            {[{id:'role',label:'حسب المسؤولية',icon:Users},{id:'person',label:'شخص محدد',icon:User}].map(t=>(
              <button key={t.id} type="button" onClick={()=>setF('target_type',t.id)}
                style={{ flex:1, padding:12, borderRadius:10, border:`2px solid ${form.target_type===t.id?'#0f2744':'#e2e6ef'}`, background:form.target_type===t.id?'#eef4ff':'white', cursor:'pointer', fontFamily:'var(--font-body)', display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontWeight:700, color:form.target_type===t.id?'#0f2744':'#9ba5bc' }}>
                <t.icon size={16}/> {t.label}
              </button>
            ))}
          </div>

          {form.target_type === 'role' && (
            <>
              <div style={{ marginBottom:18 }}>
                <RolePicker value={form.role} onChange={r=>setF('role',r)}/>
              </div>
              <YouthGroupPicker youthGroups={youthGroups} selected={form.target_youth_groups} onChange={v=>setF('target_youth_groups',v)}/>
            </>
          )}

          {form.target_type === 'person' && (
            <div>
              <label style={lbl}>اختر الشخص *</label>
              <div style={{ position:'relative', marginBottom:8 }}>
                <Search size={13} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', color:'#9ba5bc', pointerEvents:'none' }}/>
                <input value={pSearch} onChange={e=>setPSearch(e.target.value)} placeholder="ابحث بالاسم أو الرقم…" style={{ ...inp, paddingRight:28 }}/>
              </div>
              {form.target_person_id && (
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#e8f5e9', borderRadius:8, border:'1px solid #a5d6a7', marginBottom:8 }}>
                  <CheckCircle size={16} color="#388e3c"/>
                  <span style={{ fontWeight:700, color:'#1b5e20', fontSize:'0.88rem' }}>{form.target_person_name}</span>
                  <button type="button" onClick={()=>{setF('target_person_id',null);setF('target_person_name',null);setF('target_person_type',null)}}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#9ba5bc', marginRight:'auto', display:'flex' }}><X size={14}/></button>
                </div>
              )}
              <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid #e2e6ef', borderRadius:8 }}>
                {filtP.map(p=>(
                  <button key={`${p.person_type}-${p.person_id}`}
                    onClick={()=>{setF('target_person_id',String(p.person_id));setF('target_person_name',p.display_name||p.username);setF('target_person_type',p.person_type||'registered');setPSearch('')}}
                    style={{ width:'100%', padding:'9px 14px', background:'none', border:'none', cursor:'pointer', textAlign:'right', fontFamily:'var(--font-body)', borderBottom:'1px solid #f5f6fa', display:'flex', alignItems:'center', gap:8 }}
                    onMouseEnter={e=>e.currentTarget.style.background='#f7f9ff'}
                    onMouseLeave={e=>e.currentTarget.style.background='none'}>
                    <User size={13} color="#9ba5bc"/>
                    <span style={{ fontWeight:600, fontSize:'0.88rem', color:'#1a2a3a' }}>{p.display_name||p.username}</span>
                    <span style={{ fontSize:'0.72rem', color:'#9ba5bc', marginRight:'auto' }}>ID: {p.person_id}</span>
                  </button>
                ))}
                {filtP.length===0 && <div style={{ padding:'20px', textAlign:'center', color:'#9ba5bc', fontSize:'0.85rem' }}>لا توجد نتائج</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={crd}>
        <div style={hdr}>
          <span style={{ fontWeight:800, color:'#0f2744' }}>الأسئلة ({form.questions.length})</span>
          <button type="button" onClick={addQ} style={btnSty('navy',true)}><Plus size={14}/> إضافة سؤال</button>
        </div>
        <div style={{ padding:18 }}>
          {form.questions.length===0 && (
            <div style={{ textAlign:'center', padding:'40px', color:'#9ba5bc' }}>
              <FileText size={32} style={{ opacity:0.4, marginBottom:10 }}/>
              <div>لا توجد أسئلة بعد — اضغط "إضافة سؤال"</div>
            </div>
          )}
          {form.questions.map((q,i) => (
            <QuestionEditor key={q.id} question={q} index={i} total={form.questions.length}
              onChange={nq=>updQ(i,nq)} onRemove={()=>delQ(i)}
              onMoveUp={()=>moveQ(i,-1)} onMoveDown={()=>moveQ(i,1)}/>
          ))}
          {form.questions.length>0 && (
            <button type="button" onClick={addQ} style={{ ...btnSty('outline',true), width:'100%', justifyContent:'center', marginTop:4 }}>
              <Plus size={14}/> إضافة سؤال آخر
            </button>
          )}
        </div>
      </div>

      <div style={{ display:'flex', gap:10, justifyContent:'flex-end', paddingBottom:28 }}>
        <button type="button" onClick={onCancel} style={btnSty('outline')}>إلغاء</button>
        <button type="button" onClick={submit} disabled={saving} style={btnSty('navy')}>
          {saving ? <><RefreshCw size={14} style={{ animation:'spin 0.7s linear infinite' }}/> جارٍ الحفظ…</> : <><Save size={15}/> حفظ الاستبيان</>}
        </button>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Questionnaire({ toast }) {
  const [questionnaires, setQs]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState('')
  const [view, setView]           = useState('list')
  const [editing, setEditing]     = useState(null)
  const [viewingResp, setViewResp]= useState(null)
  const [persons, setPersons]     = useState([])
  const [youthGroups, setYGs]     = useState([])
  const [formDataReady, setFormDataReady] = useState(false)
  const [formDataError, setFormDataError] = useState('')
  const formDataPromiseRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const qd = await api.adminListQuestionnaires()
      setQs(qd.questionnaires || [])
    } catch {
      setLoadError('تعذر تحميل قائمة الاستبيانات حالياً. حاول مرة أخرى.')
      toast('تعذر تحميل الاستبيانات', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const ensureFormData = useCallback((opts = {}) => {
    const { silent = false } = opts
    if (formDataReady) return Promise.resolve()
    if (formDataPromiseRef.current) return formDataPromiseRef.current
    setFormDataError('')

    const p = Promise.all([api.listUsersBasic(), api.filters()])
      .then(([ud, fd]) => {
        setPersons(ud.users || [])
        setYGs((fd.youth_group || []).map(g => ({ value: g.value, label: api.formatYouthGroupLabel(g.label || g.value) })).filter(g => g.value).sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ar')))
        setFormDataReady(true)
        setFormDataError('')
      })
      .catch(() => {
        setFormDataError('تعذر تحميل بيانات النموذج اللازمة لإنشاء أو تعديل الاستبيان.')
        if (!silent) toast('تعذر تحميل بيانات النموذج. حاول مرة أخرى','error')
      })
      .finally(() => {
        formDataPromiseRef.current = null
      })

    formDataPromiseRef.current = p
    return p
  }, [formDataReady, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (loading || formDataReady || formDataPromiseRef.current || formDataError) return
    const timer = setTimeout(() => { ensureFormData({ silent: true }) }, 400)
    return () => clearTimeout(timer)
  }, [loading, formDataError, formDataReady, ensureFormData])

  const handleCreate = async (f) => { await api.createQuestionnaire(f); toast('تم إنشاء الاستبيان بنجاح','success'); setView('list'); load() }
  const handleUpdate = async (f) => { await api.updateQuestionnaire(editing.id,f); toast('تم تحديث الاستبيان','success'); setEditing(null); setView('list'); load() }
  const handleDelete = async (q) => { if(!confirm(`هل تريد حذف "${q.title}"؟`)) return; await api.deleteQuestionnaire(q.id); toast('تم حذف الاستبيان','success'); load() }
  const handleToggle = async (q) => { await api.updateQuestionnaire(q.id,{...q,active:!q.active}); toast(q.active?'تم تعطيل الاستبيان':'تم تفعيل الاستبيان','success'); load() }

  const openCreate = async () => {
    setView('create')
    setFormDataError('')
    await ensureFormData()
  }

  const openEdit = async (q) => {
    setEditing(q)
    setView('edit')
    setFormDataError('')
    await ensureFormData()
  }

  if (view==='create') return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button onClick={()=>setView('list')} style={btnSty('outline',true)}><ArrowRight size={14}/> رجوع</button>
        <h2 style={{ fontFamily:'var(--font-head)', color:'#0f2744', margin:0, fontSize:'1.2rem', fontWeight:800 }}>إنشاء استبيان جديد</h2>
      </div>
      {!formDataReady ? (
        formDataError ? (
          <ErrorState
            title="تعذر تجهيز نموذج الاستبيان"
            description={formDataError}
            onRetry={() => ensureFormData()}
            minHeight={260}
          />
        ) : (
          <LoadingState
            title="جارٍ تجهيز نموذج الاستبيان"
            description="يتم تحميل الأشخاص والمجموعات المستهدفة الآن."
            minHeight={260}
          />
        )
      ) : (
        <QuestionnaireForm youthGroups={youthGroups} persons={persons} onSave={handleCreate} onCancel={()=>setView('list')} toast={toast}/>
      )}
    </div>
  )

  if (view==='edit' && editing) return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button onClick={()=>{setView('list');setEditing(null)}} style={btnSty('outline',true)}><ArrowRight size={14}/> رجوع</button>
        <h2 style={{ fontFamily:'var(--font-head)', color:'#0f2744', margin:0, fontSize:'1.2rem', fontWeight:800 }}>تعديل الاستبيان</h2>
      </div>
      {!formDataReady ? (
        formDataError ? (
          <ErrorState
            title="تعذر تجهيز نموذج الاستبيان"
            description={formDataError}
            onRetry={() => ensureFormData()}
            minHeight={260}
          />
        ) : (
          <LoadingState
            title="جارٍ تجهيز نموذج الاستبيان"
            description="يتم تحميل الأشخاص والمجموعات المستهدفة الآن."
            minHeight={260}
          />
        )
      ) : (
        <QuestionnaireForm initial={editing} youthGroups={youthGroups} persons={persons} onSave={handleUpdate} onCancel={()=>{setView('list');setEditing(null)}} toast={toast}/>
      )}
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h2 style={{ fontFamily:'var(--font-head)', color:'#0f2744', margin:0, fontSize:'1.2rem', fontWeight:800 }}>إدارة الاستبيانات</h2>
          <p style={{ color:'#9ba5bc', fontSize:'0.82rem', margin:'4px 0 0' }}>أنشئ وتابع استبيانات موجّهة للأعضاء بحسب مسؤولياتهم</p>
        </div>
        <button onClick={openCreate} style={btnSty('navy')}><Plus size={16}/> استبيان جديد</button>
      </div>

      {loading ? (
        <LoadingState
          title="جارٍ تحميل الاستبيانات"
          description="يتم تجهيز قائمة الاستبيانات والردود الآن."
          minHeight={320}
        />
      ) : loadError ? (
        <ErrorState
          title="تعذر تحميل الاستبيانات"
          description={loadError}
          onRetry={load}
          minHeight={320}
        />
      ) : questionnaires.length===0 ? (
        <EmptyState
          title="لا توجد استبيانات بعد"
          description={'اضغط على "استبيان جديد" للبدء بإنشاء أول استبيان.'}
          icon={FileText}
          minHeight={260}
        />
      ) : questionnaires.map(q => (
        <div key={q.id} style={{ background:'white', borderRadius:12, border:'1px solid #e2e6ef', marginBottom:12, padding:'14px 18px', display:'flex', alignItems:'flex-start', gap:14 }}>
          <div style={{ width:10, height:10, borderRadius:'50%', background:q.active?'#38a169':'#9ba5bc', marginTop:6, flexShrink:0 }}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, color:'#0f2744', marginBottom:4 }}>{q.title}</div>
            {q.description && <div style={{ color:'#9ba5bc', fontSize:'0.82rem', marginBottom:6 }}>{q.description}</div>}
            <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:4 }}>
              {q.target_type==='role' && q.role?.tab && (
                <span style={{ background:'#eef4ff', border:'1px solid #c5d8f8', borderRadius:6, padding:'2px 8px', fontSize:'0.75rem', color:'#0f2744', fontWeight:600 }}>
                  {ROLE_TABS.find(t=>t.id===q.role.tab)?.label||q.role.tab}
                </span>
              )}
              {q.target_type==='role' && (q.target_youth_groups||[]).length>0 && (
                <span style={{ background:'#f0fdf4', border:'1px solid #a7f3d0', borderRadius:6, padding:'2px 8px', fontSize:'0.75rem', color:'#065f46', fontWeight:600 }}>
                  {q.target_youth_groups.length===1?(q.target_youth_group_names?.[0] || q.target_youth_groups[0]):`${q.target_youth_groups.length} مجموعات`}
                </span>
              )}
              {q.target_type==='person' && (
                <span style={{ background:'#fdf4ff', border:'1px solid #e9d5ff', borderRadius:6, padding:'2px 8px', fontSize:'0.75rem', color:'#581c87', fontWeight:600 }}>
                  👤 {q.target_person_name}
                </span>
              )}
              <span style={{ background:'#f8f9fd', border:'1px solid #e2e6ef', borderRadius:6, padding:'2px 8px', fontSize:'0.75rem', color:'#4a5568' }}>
                {(q.questions||[]).length} سؤال
              </span>
            </div>
            <div style={{ fontSize:'0.73rem', color:'#b0bac9' }}>أُنشئ: {new Date(q.created_at).toLocaleDateString('ar-EG')}</div>
          </div>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button onClick={()=>setViewResp(q)} title="الردود" style={btnSty('outline',true)}><MessageSquare size={14}/></button>
            <button onClick={()=>handleToggle(q)} title={q.active?'تعطيل':'تفعيل'} style={btnSty('outline',true)}>
              {q.active?<ToggleRight size={14} color="#38a169"/>:<ToggleLeft size={14}/>}
            </button>
            <button onClick={()=>openEdit(q)} title="تعديل" style={btnSty('outline',true)}><Edit2 size={14}/></button>
            <button onClick={()=>handleDelete(q)} title="حذف" style={{ ...btnSty('outline',true), color:'#e53e3e', borderColor:'#fed7d7' }}><Trash2 size={14}/></button>
          </div>
        </div>
      ))}

      {viewingResp && <ResponseViewer questionnaire={viewingResp} onClose={()=>setViewResp(null)}/>}
    </div>
  )
}
