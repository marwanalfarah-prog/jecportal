import { useEffect, useState, useCallback } from 'react'
import { Plus, CalendarDays, ChevronLeft, Search, Trash2, Edit2, MapPin } from 'lucide-react'
import { api } from '../api.js'
import EventDetail from './EventDetail.jsx'
import CampLocations from './CampLocations.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_TYPE_COLORS = {
  'مخيم':          { bg: '#e8f4fd', color: '#1565c0', border: '#90caf9' },
  'لقاء':          { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
  'نشاط':          { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
  'رحلة':          { bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' },
  'لقاء تنشئة':   { bg: '#fce4ec', color: '#880e4f', border: '#f48fb1' },
  'دورة تدريبية': { bg: '#e0f2f1', color: '#004d40', border: '#80cbc4' },
  'لقاء مشترك':   { bg: '#e8eaf6', color: '#283593', border: '#9fa8da' },
  'اجتماع':        { bg: '#fafafa', color: '#424242', border: '#bdbdbd' },
}

function eventTypeBadge(type) {
  const style = EVENT_TYPE_COLORS[type] || { bg: '#f5f5f5', color: '#555', border: '#ddd' }
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 700, padding: '2px 10px', borderRadius: 20,
      background: style.bg, color: style.color, border: `1px solid ${style.border}`,
      whiteSpace: 'nowrap',
    }}>{type}</span>
  )
}

function organizerLabel(evt) {
  if (evt.organizer_type === 'gs') return 'الأمانة العامة'
  if (evt.organizer_type === 'yg') return 'فرقة شبيبة'
  return 'مشترك'
}

function formatDateRange(start, end) {
  if (!start) return '—'
  const fmt = (s) => {
    try { return new Date(s).toLocaleDateString('ar-JO', { day: 'numeric', month: 'short', year: 'numeric' }) }
    catch { return s }
  }
  if (!end) return fmt(start)
  return `${fmt(start)} — ${fmt(end)}`
}

// ── Create Event Form ─────────────────────────────────────────────────────────

function CreateEventModal({ onClose, onCreated, toast }) {
  const [constants, setConstants] = useState(null)
  const [presets, setPresets]     = useState([])
  const [loading, setLoading]     = useState(false)
  const [youthGroups, setYouthGroups] = useState([])

  // Form state
  const [jecYear, setJecYear]       = useState('')
  const [eventType, setEventType]   = useState('')
  const [organizerType, setOrgType] = useState('gs')
  const [orgYgParts, setOrgYgParts] = useState([]) // [{yg_id, yg_label, age_groups:[]}]
  const [titleSource, setTitleSrc]  = useState('age_groups')
  const [titlePresetId, setPresetId] = useState('')
  const [titleLabel, setTitleLabel] = useState('')
  const [targetType, setTargetType] = useState('age_groups')
  const [targetAgeGroups, setTargetAgeGroups] = useState([])
  const [targetHullLabel, setHullLabel] = useState('')
  const [startDt, setStartDt]       = useState('')
  const [endDt, setEndDt]           = useState('')
  const [nights, setNights]         = useState([])
  const [newPresetName, setNewPresetName] = useState('')
  const [addingPreset, setAddingPreset]   = useState(false)

  useEffect(() => {
    api.getEventsConstants().then(setConstants).catch(() => {})
    api.listEventTitlePresets('gs').then(d => setPresets(d.presets || [])).catch(() => {})
    api.listYouthGroupProfiles().then(d => setYouthGroups(d.groups || d.youth_groups || [])).catch(() => {})
  }, [])

  // Recompute nights when dates change
  useEffect(() => {
    if (!startDt || !endDt) { setNights([]); return }
    api.computeEventNights(startDt, endDt).then(d => setNights(d.nights || [])).catch(() => {})
  }, [startDt, endDt])

  // Auto-build title label from age groups
  const autoLabel = (() => {
    if (titleSource !== 'age_groups') return ''
    const ags = targetAgeGroups
    if (!ags.length) return ''
    if (ags.length === 1) return `فئة ${ags[0]}`
    if (ags.length === 2) return `فئتيّ ${ags[0]} و${ags[1]}`
    return `فئات ${ags.join(' و')}`
  })()

  const effectiveTitleLabel = titleSource === 'age_groups' ? autoLabel
    : titleSource === 'preset' ? (presets.find(p => p.id === titlePresetId)?.name || '')
    : titleLabel

  const previewName = eventType && effectiveTitleLabel
    ? `${eventType} ${effectiveTitleLabel}`
    : eventType || '—'

  const toggleTargetAg = (ag) => {
    setTargetAgeGroups(prev =>
      prev.includes(ag) ? prev.filter(x => x !== ag) : [...prev, ag]
    )
  }

  const addYgParticipant = (yg) => {
    const id = yg.group_id || yg.youth_group_id
    if (orgYgParts.find(p => p.yg_id === id)) return
    setOrgYgParts(prev => [...prev, { yg_id: id, yg_label: yg.group_name || yg.name || id, age_groups: [] }])
  }

  const removeYgParticipant = (ygId) => setOrgYgParts(prev => prev.filter(p => p.yg_id !== ygId))

  const toggleYgAg = (ygId, ag) => {
    setOrgYgParts(prev => prev.map(p => {
      if (p.yg_id !== ygId) return p
      const ags = p.age_groups.includes(ag) ? p.age_groups.filter(x => x !== ag) : [...p.age_groups, ag]
      return { ...p, age_groups: ags }
    }))
  }

  const handleAddPreset = async () => {
    const name = newPresetName.trim()
    if (!name) return
    setAddingPreset(true)
    try {
      const res = await api.createEventTitlePreset({ organizer: 'gs', name })
      setPresets(prev => [...prev, res.preset])
      setPresetId(res.preset.id)
      setNewPresetName('')
    } catch {
      toast('تعذّر إضافة العنوان', 'error')
    } finally {
      setAddingPreset(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!eventType) { toast('اختر نوع النشاط', 'error'); return }
    if (!jecYear.trim()) { toast('اختر سنة الرعاية', 'error'); return }
    if (titleSource !== 'age_groups' && !effectiveTitleLabel) { toast('العنوان مطلوب', 'error'); return }

    setLoading(true)
    try {
      const body = {
        jec_year: jecYear.trim(),
        event_type: eventType,
        organizer_type: organizerType,
        organizer_yg_participants: orgYgParts,
        target_type: targetType,
        target_age_groups: targetAgeGroups,
        target_hull_label: targetHullLabel,
        title_source: titleSource,
        title_preset_id: titleSource === 'preset' ? titlePresetId : null,
        title_label: titleSource === 'age_groups' ? autoLabel : titleLabel,
        start_datetime: startDt || null,
        end_datetime: endDt || null,
      }
      const res = await api.createEvent(body)
      toast('تم إنشاء النشاط بنجاح', 'success')
      onCreated(res.event)
    } catch (err) {
      toast(err?.message || 'تعذّر إنشاء النشاط', 'error')
    } finally {
      setLoading(false)
    }
  }

  const ags = constants?.age_groups || []

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 680, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', direction: 'rtl', marginBottom: 24 }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #e2e6ef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '1rem' }}>إنشاء نشاط جديد</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', fontSize: 20, padding: 4 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ padding: '20px 24px', display: 'grid', gap: 18 }}>

            {/* Row: JEC Year + Event Type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>سنة الرعاية (السنة الكنسيّة)</label>
                <input
                  value={jecYear} onChange={e => setJecYear(e.target.value)}
                  placeholder="مثال: 2025-2026"
                  style={inputStyle}
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>نوع النشاط</label>
                <select value={eventType} onChange={e => setEventType(e.target.value)} style={inputStyle} required>
                  <option value="">— اختر —</option>
                  {(constants?.event_types || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Organizer */}
            <div>
              <label style={labelStyle}>المنظِّم</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[['gs', 'الأمانة العامة للشبيبة المسيحيّة'], ['yg', 'فرقة شبيبة'], ['combined', 'الأمانة العامة + فرقة/فرق']].map(([val, lbl]) => (
                  <button key={val} type="button"
                    onClick={() => { setOrgType(val); if (val === 'gs') setOrgYgParts([]) }}
                    style={{ ...chipBtn, ...(organizerType === val ? chipBtnActive : {}) }}
                  >{lbl}</button>
                ))}
              </div>

              {(organizerType === 'yg' || organizerType === 'combined') && (
                <div style={{ marginTop: 12, border: '1px solid #e2e6ef', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 8 }}>اختر فرق الشبيبة المشاركة</div>
                  <select onChange={e => {
                    const yg = youthGroups.find(g => (g.group_id || g.youth_group_id) === e.target.value)
                    if (yg) addYgParticipant(yg)
                    e.target.value = ''
                  }} style={{ ...inputStyle, marginBottom: 10 }}>
                    <option value="">— أضف فرقة —</option>
                    {youthGroups.filter(g => !orgYgParts.find(p => p.yg_id === (g.group_id || g.youth_group_id))).map(g => (
                      <option key={g.group_id || g.youth_group_id} value={g.group_id || g.youth_group_id}>{g.group_name || g.name || g.group_id}</option>
                    ))}
                  </select>
                  {orgYgParts.map(part => (
                    <div key={part.yg_id} style={{ background: '#f7f9ff', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f2744' }}>{part.yg_label}</span>
                        <button type="button" onClick={() => removeYgParticipant(part.yg_id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', padding: 2 }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#4a5568', marginBottom: 4 }}>الفئات المشاركة:</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ags.map(ag => (
                          <button key={ag} type="button"
                            onClick={() => toggleYgAg(part.yg_id, ag)}
                            style={{ ...chipBtn, ...(part.age_groups.includes(ag) ? chipBtnActive : {}), fontSize: '0.72rem', padding: '2px 8px' }}
                          >{ag}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Target */}
            <div>
              <label style={labelStyle}>الفئة المستهدفة</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                {[['age_groups', 'فئة / فئات عمريّة'], ['hull', 'مجموعة خاصة (Hull)']].map(([val, lbl]) => (
                  <button key={val} type="button"
                    onClick={() => setTargetType(val)}
                    style={{ ...chipBtn, ...(targetType === val ? chipBtnActive : {}) }}
                  >{lbl}</button>
                ))}
              </div>
              {targetType === 'age_groups' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ags.map(ag => (
                    <button key={ag} type="button"
                      onClick={() => toggleTargetAg(ag)}
                      style={{ ...chipBtn, ...(targetAgeGroups.includes(ag) ? chipBtnActive : {}) }}
                    >{ag}</button>
                  ))}
                </div>
              ) : (
                <input value={targetHullLabel} onChange={e => setHullLabel(e.target.value)}
                  placeholder="مثال: عائلة الأمانة العامة"
                  style={inputStyle}
                />
              )}
            </div>

            {/* Title */}
            <div>
              <label style={labelStyle}>العنوان / الاسم</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                {[['age_groups', 'من الفئة المستهدفة'], ['preset', 'من القائمة المحفوظة'], ['custom', 'مخصّص (مرة واحدة)']].map(([val, lbl]) => (
                  <button key={val} type="button"
                    onClick={() => setTitleSrc(val)}
                    style={{ ...chipBtn, ...(titleSource === val ? chipBtnActive : {}) }}
                  >{lbl}</button>
                ))}
              </div>

              {titleSource === 'preset' && (
                <div>
                  <select value={titlePresetId} onChange={e => setPresetId(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }}>
                    <option value="">— اختر عنواناً محفوظاً —</option>
                    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)}
                      placeholder="أضف عنواناً جديداً للقائمة…"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button type="button" onClick={handleAddPreset} disabled={addingPreset || !newPresetName.trim()}
                      style={{ padding: '8px 14px', background: '#0f2744', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}
                    >{addingPreset ? '...' : 'إضافة'}</button>
                  </div>
                </div>
              )}

              {titleSource === 'custom' && (
                <input value={titleLabel} onChange={e => setTitleLabel(e.target.value)}
                  placeholder="مثال: ذكرى تأسيس الشبيبة"
                  style={inputStyle}
                />
              )}

              {effectiveTitleLabel && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#f0f4ff', borderRadius: 8, border: '1px solid #c5d8f8' }}>
                  <div style={{ fontSize: '0.74rem', color: '#6b7280', marginBottom: 2 }}>معاينة الاسم</div>
                  <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '1.05rem', direction: 'rtl' }}>{previewName}</div>
                </div>
              )}
            </div>

            {/* Dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={labelStyle}>تاريخ البداية</label>
                <input type="datetime-local" value={startDt} onChange={e => setStartDt(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>تاريخ النهاية</label>
                <input type="datetime-local" value={endDt} onChange={e => setEndDt(e.target.value)} style={inputStyle} />
              </div>
            </div>

            {nights.length > 0 && (
              <div style={{ padding: '10px 14px', background: '#f7f9ff', borderRadius: 8, border: '1px solid #e2e6ef' }}>
                <div style={{ fontSize: '0.74rem', color: '#6b7280', marginBottom: 4 }}>الليالي ({nights.length})</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {nights.map(n => (
                    <span key={n} style={{ fontSize: '0.75rem', background: '#e8eaf6', color: '#283593', padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>{n}</span>
                  ))}
                </div>
              </div>
            )}

          </div>

          <div style={{ padding: '14px 24px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">إلغاء</button>
            <button type="submit" disabled={loading} className="btn btn-gold btn-sm">
              {loading ? 'جارٍ الإنشاء...' : 'إنشاء النشاط'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Shared micro-styles ───────────────────────────────────────────────────────

const labelStyle = { fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }
const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
  fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', textAlign: 'right', outline: 'none',
  boxSizing: 'border-box',
}
const chipBtn = {
  padding: '5px 14px', border: '1.5px solid #e2e6ef', borderRadius: 20, background: 'white',
  cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: '#4a5568',
  transition: '0.15s', fontWeight: 600,
}
const chipBtnActive = { background: '#0f2744', color: 'white', borderColor: '#0f2744' }

// ── Events list page ──────────────────────────────────────────────────────────

const OUTER_TABS = [
  { id: 'events',    label: 'الأنشطة',          icon: CalendarDays },
  { id: 'locations', label: 'مواقع التخييم',     icon: MapPin },
]

export default function Events({ toast, onViewProfile, onOpenBibleReference }) {
  const [outerTab, setOuterTab]       = useState('events')
  const [events, setEvents]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [showCreate, setShowCreate]   = useState(false)
  const [selectedId, setSelectedId]   = useState(null)

  const loadEvents = useCallback(() => {
    setLoading(true)
    api.listEvents()
      .then(d => { setEvents(d.events || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadEvents() }, [loadEvents])

  const handleDelete = async (evt) => {
    if (!window.confirm(`هل تريد حذف "${evt.display_name || evt.base_title}"؟`)) return
    try {
      await api.deleteEvent(evt.id)
      toast('تم الحذف', 'success')
      setEvents(prev => prev.filter(e => e.id !== evt.id))
    } catch {
      toast('تعذّر الحذف', 'error')
    }
  }

  if (selectedId) {
    return (
      <EventDetail
        eventId={selectedId}
        onBack={() => { setSelectedId(null); loadEvents() }}
        toast={toast}
        onViewProfile={onViewProfile}
        onOpenBibleReference={onOpenBibleReference}
      />
    )
  }

  // Group events by JEC year (descending)
  const q = search.trim().toLowerCase()
  const filtered = events.filter(e => {
    if (!q) return true
    const name = (e.display_name || e.base_title || '').toLowerCase()
    const type = (e.event_type || '').toLowerCase()
    const year = (e.jec_year || '').toLowerCase()
    return name.includes(q) || type.includes(q) || year.includes(q)
  })

  const byYear = {}
  for (const evt of filtered) {
    const yr = evt.jec_year || 'غير محدد'
    if (!byYear[yr]) byYear[yr] = []
    byYear[yr].push(evt)
  }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a))

  return (
    <div style={{ padding: '20px 24px', direction: 'rtl' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(15,39,68,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <CalendarDays size={20} color="#0f2744" />
        </div>
        <div>
          <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '1.1rem' }}>الأنشطة والمخيمات</div>
          <div style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>{events.length} نشاط مسجّل</div>
        </div>
      </div>

      {/* Outer tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e2e6ef', marginBottom: 20 }}>
        {OUTER_TABS.map(tab => (
          <button key={tab.id} onClick={() => setOuterTab(tab.id)}
            style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
              fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap', background: 'none',
              color: outerTab === tab.id ? '#0f2744' : '#9ba5bc',
              borderBottom: `2px solid ${outerTab === tab.id ? '#0f2744' : 'transparent'}`,
              marginBottom: -2, transition: '0.15s', display: 'flex', alignItems: 'center', gap: 5,
            }}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Events tab ── */}
      {outerTab === 'events' && (
        <>
          {/* Events toolbar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 260 }}>
              <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc', pointerEvents: 'none' }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث…"
                style={{ ...inputStyle, paddingRight: 32 }}
              />
            </div>
            <button onClick={() => setShowCreate(true)} className="btn btn-gold btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> نشاط جديد
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ba5bc' }}>
              <CalendarDays size={40} style={{ marginBottom: 12, opacity: 0.35 }} />
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{search ? 'لا توجد نتائج' : 'لا توجد أنشطة بعد'}</div>
              {!search && <div style={{ fontSize: '0.82rem', marginTop: 6 }}>ابدأ بإنشاء أول نشاط</div>}
            </div>
          ) : (
            years.map(year => (
              <div key={year} style={{ marginBottom: 28 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#c9963c', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, paddingBottom: 6, borderBottom: '2px solid #f0e8d8' }}>
                  سنة الرعاية {year}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                  {byYear[year].map(evt => (
                    <div key={evt.id}
                      style={{ background: 'white', border: '1px solid #e2e6ef', borderRadius: 12, padding: '16px 18px', cursor: 'pointer', transition: '0.15s', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
                      onClick={() => setSelectedId(evt.id)}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(15,39,68,0.10)'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.95rem', flex: 1, lineHeight: 1.3 }}>
                          {evt.display_name || evt.base_title || '—'}
                        </div>
                        {eventTypeBadge(evt.event_type)}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>المنظِّم:</span> {organizerLabel(evt)}
                      </div>
                      {(evt.start_datetime || evt.end_datetime) && (
                        <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 4 }}>
                          📅 {formatDateRange(evt.start_datetime, evt.end_datetime)}
                        </div>
                      )}
                      {evt.nights?.length > 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#9ba5bc' }}>🌙 {evt.nights.length} ليلة</div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid #f5f6fa' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedId(evt.id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0f2744', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <ChevronLeft size={13} /> فتح
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(evt) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', padding: 4 }}
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* ── Camp Locations tab ── */}
      {outerTab === 'locations' && (
        <CampLocations toast={toast} />
      )}

      {showCreate && (
        <CreateEventModal
          onClose={() => setShowCreate(false)}
          onCreated={(evt) => { setShowCreate(false); setEvents(prev => [...prev, evt]); setSelectedId(evt.id) }}
          toast={toast}
        />
      )}
    </div>
  )
}
