import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Plus, Trash2, Edit2, GripVertical, Clock, AlertTriangle, CheckCircle, BookOpen, Calendar, Zap, X } from 'lucide-react'
import { api } from '../api.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_BOUNDARY_HOUR = 4   // entries before 4 AM belong to the previous day

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const ARABIC_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
  fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', textAlign: 'right',
  outline: 'none', boxSizing: 'border-box',
}
const labelStyle = { fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }

// ── Time helpers ──────────────────────────────────────────────────────────────

function fmtTime(dt) {
  if (!dt) return '—'
  const h = dt.getHours()
  const m = dt.getMinutes()
  const ampm = h >= 12 ? 'م' : 'ص'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDuration(minutes) {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}د`
  if (m === 0) return `${h}س`
  return `${h}س ${m}د`
}

function fmtDurationLong(minutes) {
  if (minutes === 0) return 'مضبوط تماماً'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const parts = []
  if (h > 0) parts.push(`${h} ساعة`)
  if (m > 0) parts.push(`${m} دقيقة`)
  return parts.join(' و')
}

function scheduleDay(dt) {
  // Returns a Date whose .toDateString() represents the "schedule day"
  const d = new Date(dt)
  if (d.getHours() < DAY_BOUNDARY_HOUR) d.setDate(d.getDate() - 1)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function dayLabel(dateObj) {
  return `${ARABIC_DAYS[dateObj.getDay()]}، ${dateObj.getDate()} ${ARABIC_MONTHS[dateObj.getMonth()]}`
}

function parseDurationInput(raw) {
  // Accepts: "90", "1:30", "1h30", "1h 30m", "1.5"
  const s = String(raw || '').trim()
  if (!s) return null
  // h:mm
  const colonMatch = s.match(/^(\d+):(\d{1,2})$/)
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])
  // Xh Ym
  const hmMatch = s.match(/^(\d+)\s*[hHسساعة]+\s*(\d*)\s*[mMددقيقة]*/i)
  if (hmMatch) return parseInt(hmMatch[1]) * 60 + (parseInt(hmMatch[2]) || 0)
  // decimal hours
  const floatMatch = s.match(/^(\d+(?:\.\d+)?)$/)
  if (floatMatch) {
    const v = parseFloat(floatMatch[1])
    return v >= 1 && v <= 24 && s.includes('.') ? Math.round(v * 60) : parseInt(v)
  }
  return null
}

// ── Compute schedule from ordered entries ──────────────────────────────────────

function computeTimeline(entries, exceptions, eventStartDt) {
  const start = new Date(eventStartDt)
  let cursor = new Date(start)

  const computed = entries
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(entry => {
      const s = new Date(cursor)
      const e = new Date(cursor.getTime() + (entry.duration_minutes || 0) * 60000)
      cursor = e
      return { ...entry, _start: s, _end: e, _type: 'entry' }
    })

  const excComputed = exceptions.map(exc => ({
    ...exc,
    _start: exc.fixed_time ? new Date(exc.fixed_time) : null,
    _type: 'exception',
  }))

  return { computed, excComputed }
}

// ── Duration bar ──────────────────────────────────────────────────────────────

function DurationBar({ entries, eventStartDt, eventEndDt }) {
  const totalMinutes = entries.reduce((s, e) => s + (e.duration_minutes || 0), 0)
  const eventMinutes = eventStartDt && eventEndDt
    ? Math.round((new Date(eventEndDt) - new Date(eventStartDt)) / 60000)
    : null

  if (eventMinutes === null) return null

  const diff = eventMinutes - totalMinutes
  const over = diff < 0
  const exact = diff === 0
  const pct = Math.min(100, (totalMinutes / Math.max(eventMinutes, 1)) * 100)

  return (
    <div style={{ background: over ? '#fef2f2' : exact ? '#f0fdf4' : '#f8fafc', border: `1px solid ${over ? '#fecaca' : exact ? '#bbf7d0' : '#e9ecf3'}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {over
            ? <AlertTriangle size={14} color="#dc2626" />
            : exact
              ? <CheckCircle size={14} color="#16a34a" />
              : <Clock size={14} color="#6b7280" />}
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: over ? '#dc2626' : exact ? '#15803d' : '#374151' }}>
            {over
              ? `تجاوز البرنامج بـ ${fmtDurationLong(-diff)}`
              : exact
                ? 'البرنامج مضبوط تماماً'
                : `متبقي ${fmtDurationLong(diff)}`}
          </span>
        </div>
        <span style={{ fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 600 }}>
          {fmtDuration(totalMinutes)} / {fmtDuration(eventMinutes)}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#e9ecf3', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: over ? '#ef4444' : exact ? '#22c55e' : '#3b82f6',
          transition: '0.3s', borderRadius: 3,
        }} />
      </div>
    </div>
  )
}

// ── Live indicator ────────────────────────────────────────────────────────────

function LiveIndicator({ computed }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000)
    return () => clearInterval(t)
  }, [])

  if (!computed.length) return null

  const eventStart = computed[0]._start
  const eventEnd   = computed[computed.length - 1]._end

  if (now < eventStart || now > eventEnd) return null

  const active = computed.find(e => now >= e._start && now < e._end)
  if (!active) return null

  const elapsedMin = Math.round((now - active._start) / 60000)
  const remainMin  = Math.round((active._end - now) / 60000)
  const pct        = Math.round((elapsedMin / (active.duration_minutes || 1)) * 100)
  const overTime   = elapsedMin > active.duration_minutes

  return (
    <div style={{ background: 'linear-gradient(135deg, #0f2744 0%, #1e3a5f 100%)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Zap size={14} color="#fcd34d" />
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fcd34d', letterSpacing: 1, textTransform: 'uppercase' }}>مباشر الآن</span>
        <span style={{ marginRight: 'auto', fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)' }}>{fmtTime(now)}</span>
      </div>
      <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: 4 }}>{active.title}</div>
      {active.description && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)', marginBottom: 8 }}>{active.description}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: '0.7rem', color: overTime ? '#fca5a5' : 'rgba(255,255,255,0.7)' }}>
          {overTime ? `تجاوز بـ ${fmtDurationLong(elapsedMin - active.duration_minutes)}` : `مضى ${fmtDurationLong(elapsedMin)}`}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>
          {overTime ? '—' : `${fmtDurationLong(remainMin)} متبقي`}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: overTime ? '#f87171' : '#fcd34d', transition: '0.5s', borderRadius: 2 }} />
      </div>
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, index, onEdit, onDelete, isActive, dragHandlers }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      {...dragHandlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
        background: isActive ? 'linear-gradient(90deg, #0f274408 0%, #fff 100%)' : hovered ? '#fafbff' : 'white',
        borderRadius: 10, border: `1px solid ${isActive ? '#c5d8f8' : '#edf0f7'}`,
        borderRight: isActive ? '3px solid #0f2744' : '1px solid #edf0f7',
        transition: '0.15s', cursor: dragHandlers ? 'grab' : 'default',
        marginBottom: 6, userSelect: 'none',
      }}
    >
      {dragHandlers && <GripVertical size={14} color="#c5cdd8" style={{ flexShrink: 0, marginTop: 2 }} />}

      {/* Time badge */}
      <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 52 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: isActive ? '#0f2744' : '#4a5568', lineHeight: 1.2 }}>
          {fmtTime(entry._start)}
        </div>
        {entry._end && (
          <div style={{ fontSize: '0.63rem', color: '#9ba5bc', marginTop: 1 }}>{fmtTime(entry._end)}</div>
        )}
      </div>

      {/* Connector line */}
      <div style={{ width: 2, alignSelf: 'stretch', background: isActive ? '#0f2744' : '#e9ecf3', borderRadius: 1, flexShrink: 0, margin: '2px 0' }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f2744', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.title}
          </span>
          {isActive && <span style={{ fontSize: '0.6rem', fontWeight: 800, background: '#0f2744', color: '#fcd34d', padding: '1px 6px', borderRadius: 8, flexShrink: 0 }}>الآن</span>}
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#9ba5bc', flexShrink: 0 }}>{fmtDuration(entry.duration_minutes)}</span>
        </div>
        {entry.description && (
          <div style={{ fontSize: '0.73rem', color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.description}</div>
        )}
        {entry.preset_id && (
          <span style={{ fontSize: '0.6rem', background: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: 8, marginTop: 3, display: 'inline-block' }}>من القائمة</span>
        )}
      </div>

      {/* Actions */}
      {hovered && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onEdit(entry)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 3, borderRadius: 5 }}
            onMouseEnter={e => e.currentTarget.style.color = '#4a5568'} onMouseLeave={e => e.currentTarget.style.color = '#9ba5bc'}>
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 3, borderRadius: 5 }}
            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#9ba5bc'}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Exception row ──────────────────────────────────────────────────────────────

function ExceptionRow({ exc, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false)
  const dt = exc._start

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
        background: hovered ? '#fffdf5' : '#fffbeb', borderRadius: 10,
        border: '1px dashed #fde68a', marginBottom: 6, transition: '0.15s',
      }}
    >
      <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 52 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#92400e' }}>{dt ? fmtTime(dt) : '—'}</div>
        {dt && <div style={{ fontSize: '0.6rem', color: '#b45309', marginTop: 1 }}>{dayLabel(scheduleDay(dt))}</div>}
      </div>

      <div style={{ width: 2, alignSelf: 'stretch', background: '#fde68a', borderRadius: 1, flexShrink: 0, margin: '2px 0' }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#92400e' }}>{exc.title}</div>
        {exc.description && <div style={{ fontSize: '0.73rem', color: '#b45309', marginTop: 2 }}>{exc.description}</div>}
        <span style={{ fontSize: '0.6rem', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 8, marginTop: 3, display: 'inline-block' }}>وقت استثنائي</span>
      </div>

      {hovered && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => onEdit(exc)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3, borderRadius: 5 }}
            onMouseEnter={e => e.currentTarget.style.color = '#92400e'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
            <Edit2 size={13} />
          </button>
          <button onClick={() => onDelete(exc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3, borderRadius: 5 }}
            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Add/Edit Entry Modal ──────────────────────────────────────────────────────

function EntryModal({ initial, nextStartTime, presets, onClose, onSave, toast }) {
  const isEdit = !!initial?.id
  const [title, setTitle]       = useState(initial?.title || '')
  const [desc, setDesc]         = useState(initial?.description || '')
  const [durStr, setDurStr]     = useState(initial?.duration_minutes ? String(initial.duration_minutes) : '')
  const [presetId, setPresetId] = useState(initial?.preset_id || '')
  const [saving, setSaving]     = useState(false)
  const [showPresets, setShowPresets] = useState(false)

  const applyPreset = (p) => {
    setTitle(p.title)
    setDesc(p.description || '')
    if (p.default_duration_minutes) setDurStr(String(p.default_duration_minutes))
    setPresetId(p.id)
    setShowPresets(false)
  }

  const handleSave = async () => {
    if (!title.trim()) { toast('العنوان مطلوب', 'error'); return }
    const dur = parseDurationInput(durStr)
    if (!dur || dur < 1) { toast('أدخل مدة صحيحة (مثال: 30، 1:30، 1.5)', 'error'); return }
    setSaving(true)
    try {
      await onSave({ title: title.trim(), description: desc.trim(), duration_minutes: dur, preset_id: presetId || null })
      onClose()
    } catch (e) {
      toast(e?.message || 'تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 480, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, color: '#0f2744' }}>{isEdit ? 'تعديل الفقرة' : 'إضافة فقرة'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          {/* Preset picker */}
          {presets.length > 0 && (
            <div>
              <label style={labelStyle}>من القائمة الجاهزة <span style={{ fontWeight: 400, color: '#9ba5bc' }}>(اختياري)</span></label>
              {showPresets ? (
                <div style={{ border: '1.5px solid #e2e6ef', borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
                  {presets.map(p => (
                    <button key={p.id} onClick={() => applyPreset(p)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: 'none', borderBottom: '1px solid #f5f6fa', background: 'none', cursor: 'pointer', textAlign: 'right', fontFamily: 'var(--font-body)' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f7f9ff'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <BookOpen size={12} color="#3b82f6" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f2744' }}>{p.title}</div>
                        {p.default_duration_minutes && <div style={{ fontSize: '0.68rem', color: '#9ba5bc' }}>{fmtDuration(p.default_duration_minutes)}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setShowPresets(true)}
                  style={{ ...inputStyle, background: '#f7f9ff', cursor: 'pointer', textAlign: 'right', color: '#4a5568', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={14} color="#3b82f6" />
                  <span>اختر من القائمة الجاهزة…</span>
                </button>
              )}
            </div>
          )}

          <div>
            <label style={labelStyle}>العنوان <span style={{ color: '#e53e3e' }}>*</span></label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="مثال: صلاة الصباح، عشاء، محاضرة…" />
          </div>

          <div>
            <label style={labelStyle}>وصف مختصر <span style={{ fontWeight: 400, color: '#9ba5bc' }}>(اختياري)</span></label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              style={{ ...inputStyle, resize: 'vertical' }} placeholder="تفاصيل إضافية…" />
          </div>

          <div>
            <label style={labelStyle}>
              المدة <span style={{ color: '#e53e3e' }}>*</span>
              <span style={{ fontWeight: 400, color: '#9ba5bc', marginRight: 6 }}>دقيقة أو س:دد</span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={durStr} onChange={e => setDurStr(e.target.value)}
                style={{ ...inputStyle, textAlign: 'center', direction: 'ltr' }}
                placeholder="30 أو 1:30" />
              {parseDurationInput(durStr) && (
                <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  = {fmtDuration(parseDurationInput(durStr))}
                </span>
              )}
            </div>
            {nextStartTime && (
              <div style={{ fontSize: '0.7rem', color: '#9ba5bc', marginTop: 5 }}>
                ستبدأ هذه الفقرة في {fmtTime(nextStartTime)}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-gold btn-sm">
            {saving ? 'جارٍ الحفظ...' : isEdit ? 'حفظ' : 'إضافة'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add/Edit Exception Modal ───────────────────────────────────────────────────

function ExceptionModal({ initial, onClose, onSave, toast }) {
  const isEdit = !!initial?.id
  const [title, setTitle]       = useState(initial?.title || '')
  const [desc, setDesc]         = useState(initial?.description || '')
  const [fixedTime, setFixedTime] = useState(initial?.fixed_time ? initial.fixed_time.slice(0, 16) : '')
  const [saving, setSaving]     = useState(false)

  const handleSave = async () => {
    if (!title.trim()) { toast('العنوان مطلوب', 'error'); return }
    if (!fixedTime)    { toast('الوقت مطلوب', 'error'); return }
    setSaving(true)
    try {
      await onSave({ title: title.trim(), description: desc.trim(), fixed_time: fixedTime })
      onClose()
    } catch (e) {
      toast(e?.message || 'تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 440, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, color: '#0f2744' }}>{isEdit ? 'تعديل الوقت الاستثنائي' : 'إضافة وقت استثنائي'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '12px 18px 6px', background: '#fffbeb', borderBottom: '1px solid #fde68a', fontSize: '0.75rem', color: '#92400e', lineHeight: 1.5 }}>
          الأوقات الاستثنائية لها وقت ثابت ومستقل عن برنامج الفقرات، وتُعرض في جدول البرنامج حسب موضعها الزمني. لا تؤثر على حساب أوقات الفقرات.
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>العنوان <span style={{ color: '#e53e3e' }}>*</span></label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="مثال: وصول المشاركين، مغادرة المكان…" />
          </div>
          <div>
            <label style={labelStyle}>وصف مختصر <span style={{ fontWeight: 400, color: '#9ba5bc' }}>(اختياري)</span></label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelStyle}>الوقت الثابت <span style={{ color: '#e53e3e' }}>*</span></label>
            <input type="datetime-local" value={fixedTime} onChange={e => setFixedTime(e.target.value)}
              style={{ ...inputStyle, direction: 'ltr', textAlign: 'left' }} />
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e6ef', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-gold btn-sm">
            {saving ? 'جارٍ الحفظ...' : isEdit ? 'حفظ' : 'إضافة'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Presets Manager Modal ─────────────────────────────────────────────────────

function PresetsManagerModal({ onClose, onPresetsChanged, toast }) {
  const [presets, setPresets]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDur, setEditDur]   = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc]   = useState('')
  const [newDur, setNewDur]     = useState('')
  const [saving, setSaving]     = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.listSchedulePresets()
      .then(d => { setPresets(d.presets || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!newTitle.trim()) { toast('العنوان مطلوب', 'error'); return }
    const dur = parseDurationInput(newDur)
    setSaving(true)
    try {
      await api.createSchedulePreset({ title: newTitle.trim(), description: newDesc.trim(), default_duration_minutes: dur || null })
      setNewTitle(''); setNewDesc(''); setNewDur('')
      load(); onPresetsChanged()
      toast('تمت الإضافة', 'success')
    } catch (e) { toast(e?.message || 'تعذّر الإضافة', 'error') }
    finally { setSaving(false) }
  }

  const startEdit = (p) => { setEditId(p.id); setEditTitle(p.title); setEditDesc(p.description || ''); setEditDur(p.default_duration_minutes ? String(p.default_duration_minutes) : '') }

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) { toast('العنوان مطلوب', 'error'); return }
    const dur = parseDurationInput(editDur)
    setSaving(true)
    try {
      await api.updateSchedulePreset(editId, { title: editTitle.trim(), description: editDesc.trim(), default_duration_minutes: dur || null })
      setEditId(null); load(); onPresetsChanged()
      toast('تم الحفظ', 'success')
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id, title) => {
    if (!window.confirm(`حذف "${title}"؟`)) return
    try {
      await api.deleteSchedulePreset(id)
      load(); onPresetsChanged(); toast('تم الحذف', 'success')
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, color: '#0f2744' }}>إدارة القائمة الجاهزة للفقرات</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}><X size={16} /></button>
        </div>

        {/* Add new */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0f2f8', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#4a5568', marginBottom: 10 }}>إضافة فقرة جديدة للقائمة</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} style={inputStyle} placeholder="العنوان *" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} style={inputStyle} placeholder="وصف مختصر (اختياري)" />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newDur} onChange={e => setNewDur(e.target.value)} style={{ ...inputStyle, direction: 'ltr', textAlign: 'left', flex: 1 }} placeholder="المدة الافتراضية (اختياري): 30 أو 1:30" />
              <button onClick={handleAdd} disabled={saving} className="btn btn-gold btn-sm" style={{ flexShrink: 0 }}>إضافة</button>
            </div>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 18px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : presets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ba5bc', fontSize: '0.85rem' }}>لا توجد فقرات في القائمة بعد</div>
          ) : (
            presets.map(p => (
              <div key={p.id} style={{ padding: '10px 12px', border: '1px solid #edf0f7', borderRadius: 10, marginBottom: 8, background: editId === p.id ? '#f7f9ff' : 'white' }}>
                {editId === p.id ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={inputStyle} autoFocus />
                    <input value={editDesc} onChange={e => setEditDesc(e.target.value)} style={inputStyle} placeholder="وصف مختصر" />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={editDur} onChange={e => setEditDur(e.target.value)} style={{ ...inputStyle, direction: 'ltr', textAlign: 'left', flex: 1 }} placeholder="المدة" />
                      <button onClick={handleSaveEdit} disabled={saving} className="btn btn-gold btn-sm">حفظ</button>
                      <button onClick={() => setEditId(null)} className="btn btn-ghost btn-sm">إلغاء</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f2744' }}>{p.title}</div>
                      {p.description && <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>{p.description}</div>}
                      {p.default_duration_minutes && (
                        <span style={{ fontSize: '0.63rem', color: '#6b7280', background: '#f1f5f9', padding: '1px 6px', borderRadius: 6, marginTop: 3, display: 'inline-block' }}>
                          {fmtDuration(p.default_duration_minutes)}
                        </span>
                      )}
                    </div>
                    <button onClick={() => startEdit(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#4a5568'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(p.id, p.title)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main EventSchedule ─────────────────────────────────────────────────────────

export default function EventSchedule({ eventId, event, onRefresh, toast }) {
  const [presets, setPresets]         = useState([])
  const [showEntryModal, setEntryModal]     = useState(false)
  const [editEntry, setEditEntry]           = useState(null)
  const [showExcModal, setExcModal]         = useState(false)
  const [editExc, setEditExc]               = useState(null)
  const [showPresetsManager, setPresetsManager] = useState(false)
  const [dragIdx, setDragIdx]               = useState(null)
  const [dragOver, setDragOver]             = useState(null)
  const [saving, setSaving]                 = useState(null)

  const entries    = (event.schedule || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const exceptions = event.schedule_exceptions || []
  const eventStart = event.start_datetime
  const eventEnd   = event.end_datetime

  const loadPresets = useCallback(() => {
    api.listSchedulePresets().then(d => setPresets(d.presets || [])).catch(() => {})
  }, [])

  useEffect(() => { loadPresets() }, [loadPresets])

  const { computed, excComputed } = useMemo(
    () => computeTimeline(entries, exceptions, eventStart),
    [entries, exceptions, eventStart],
  )

  // Live indicator needs current time
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])

  const activeEntryId = useMemo(() => {
    const active = computed.find(e => now >= e._start && now < e._end)
    return active?.id || null
  }, [computed, now])

  // ── Group computed entries + exceptions by schedule day ──────────────────────

  const grouped = useMemo(() => {
    const map = new Map()
    const addToDay = (dayKey, dayObj, item) => {
      if (!map.has(dayKey)) map.set(dayKey, { dayObj, items: [] })
      map.get(dayKey).items.push(item)
    }
    for (const e of computed) {
      const d = scheduleDay(e._start)
      addToDay(d.toDateString(), d, { ...e, _kind: 'entry' })
    }
    for (const e of excComputed) {
      if (!e._start) continue
      const d = scheduleDay(e._start)
      addToDay(d.toDateString(), d, { ...e, _kind: 'exception' })
    }
    // Sort items within each day by time, then sort days
    const sorted = [...map.values()].sort((a, b) => a.dayObj - b.dayObj)
    for (const group of sorted) {
      group.items.sort((a, b) => (a._start || 0) - (b._start || 0))
    }
    return sorted
  }, [computed, excComputed])

  // ── Next start time for new entry ────────────────────────────────────────────

  const nextStartTime = computed.length > 0
    ? computed[computed.length - 1]._end
    : (eventStart ? new Date(eventStart) : null)

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleAddEntry = async (body) => {
    await api.addScheduleEntry(eventId, body)
    toast('تمت إضافة الفقرة', 'success')
    onRefresh()
  }

  const handleEditEntry = async (body) => {
    await api.updateScheduleEntry(eventId, editEntry.id, body)
    toast('تم الحفظ', 'success')
    onRefresh()
    setEditEntry(null)
  }

  const handleDeleteEntry = async (id) => {
    if (!window.confirm('حذف هذه الفقرة؟')) return
    try {
      await api.deleteScheduleEntry(eventId, id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  const handleAddExc = async (body) => {
    await api.addScheduleException(eventId, body)
    toast('تمت الإضافة', 'success')
    onRefresh()
  }

  const handleEditExc = async (body) => {
    await api.updateScheduleException(eventId, editExc.id, body)
    toast('تم الحفظ', 'success')
    onRefresh()
    setEditExc(null)
  }

  const handleDeleteExc = async (id) => {
    if (!window.confirm('حذف هذا الوقت الاستثنائي؟')) return
    try {
      await api.deleteScheduleException(eventId, id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  // ── Drag & drop (regular entries only) ──────────────────────────────────────

  const handleDragStart = useCallback((e, idx) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDrop = useCallback(async (toIdx) => {
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setDragOver(null); return }
    const reordered = [...entries]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const orderedIds = reordered.map(e => e.id)
    setSaving('reorder')
    try {
      await api.reorderScheduleEntries(eventId, orderedIds)
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر إعادة الترتيب', 'error') }
    finally { setSaving(null); setDragIdx(null); setDragOver(null) }
  }, [dragIdx, entries, eventId, onRefresh, toast])

  // ── Render ────────────────────────────────────────────────────────────────────

  const isEmpty = entries.length === 0 && exceptions.length === 0

  return (
    <div style={{ direction: 'rtl' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setEntryModal(true)}
          className="btn btn-gold btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Plus size={13} /> إضافة فقرة
        </button>
        <button onClick={() => setExcModal(true)}
          className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Calendar size={13} /> وقت استثنائي
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setPresetsManager(true)}
          className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}>
          <BookOpen size={12} /> القائمة الجاهزة ({presets.length})
        </button>
      </div>

      {/* Live indicator (Option B) */}
      {computed.length > 0 && <LiveIndicator computed={computed} />}

      {/* Duration bar (Option A) */}
      {entries.length > 0 && (
        <DurationBar entries={entries} eventStartDt={eventStart} eventEndDt={eventEnd} />
      )}

      {/* Drag hint */}
      {entries.length > 1 && (
        <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
          <GripVertical size={12} /> اسحب وأفلت لإعادة ترتيب الفقرات — ستُحدَّث الأوقات تلقائياً
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <Clock size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لم يُضَف أي برنامج بعد</div>
          <div style={{ fontSize: '0.76rem', marginTop: 6 }}>أضف الفقرات أو الأوقات الاستثنائية باستخدام الأزرار أعلاه</div>
        </div>
      )}

      {/* Schedule by day */}
      {grouped.map(({ dayObj, items }) => (
        <div key={dayObj.toDateString()} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0f2744', flexShrink: 0 }} />
            <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f2744' }}>{dayLabel(dayObj)}</span>
            <div style={{ flex: 1, height: 1, background: '#e9ecf3' }} />
          </div>

          {items.map((item) => {
            if (item._kind === 'exception') {
              return (
                <ExceptionRow
                  key={`exc-${item.id}`}
                  exc={item}
                  onEdit={(exc) => { setEditExc(exc); setExcModal(true) }}
                  onDelete={handleDeleteExc}
                />
              )
            }

            // Regular entry — find its index in the flat entries list for drag
            const entryIdx = entries.findIndex(e => e.id === item.id)
            const isDragging = dragIdx === entryIdx
            const isOver    = dragOver === entryIdx

            return (
              <div key={`ent-${item.id}`}
                onDragOver={e => { e.preventDefault(); setDragOver(entryIdx) }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => { e.preventDefault(); handleDrop(entryIdx) }}
                style={{ opacity: isDragging ? 0.4 : 1, outline: isOver ? '2px dashed #93c5fd' : 'none', borderRadius: 10, transition: '0.1s' }}
              >
                <EntryRow
                  entry={item}
                  index={entryIdx}
                  isActive={item.id === activeEntryId}
                  onEdit={(e) => { setEditEntry(e); setEntryModal(true) }}
                  onDelete={handleDeleteEntry}
                  dragHandlers={{
                    draggable: true,
                    onDragStart: (e) => handleDragStart(e, entryIdx),
                  }}
                />
              </div>
            )
          })}
        </div>
      ))}

      {/* Saving overlay */}
      {saving === 'reorder' && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#0f2744', color: 'white', padding: '8px 20px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 700, zIndex: 2000 }}>
          جارٍ حفظ الترتيب…
        </div>
      )}

      {/* Modals */}
      {showEntryModal && !editEntry && (
        <EntryModal
          nextStartTime={nextStartTime}
          presets={presets}
          onClose={() => setEntryModal(false)}
          onSave={handleAddEntry}
          toast={toast}
        />
      )}
      {showEntryModal && editEntry && (
        <EntryModal
          initial={editEntry}
          nextStartTime={null}
          presets={presets}
          onClose={() => { setEntryModal(false); setEditEntry(null) }}
          onSave={handleEditEntry}
          toast={toast}
        />
      )}
      {showExcModal && !editExc && (
        <ExceptionModal
          onClose={() => setExcModal(false)}
          onSave={handleAddExc}
          toast={toast}
        />
      )}
      {showExcModal && editExc && (
        <ExceptionModal
          initial={editExc}
          onClose={() => { setExcModal(false); setEditExc(null) }}
          onSave={handleEditExc}
          toast={toast}
        />
      )}
      {showPresetsManager && (
        <PresetsManagerModal
          onClose={() => setPresetsManager(false)}
          onPresetsChanged={loadPresets}
          toast={toast}
        />
      )}
    </div>
  )
}
