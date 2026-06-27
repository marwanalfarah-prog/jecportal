import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Trash2, Edit2, ChevronDown, ChevronUp, MapPin, Building2,
  Layers, DoorOpen, Upload, X, Star, Image as ImageIcon, BedDouble,
} from 'lucide-react'
import { api } from '../api.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const BED_TYPES = ['سرير فردي', 'سرير مزدوج', 'سرير طابقي', 'سرير طابقي ثلاثي']
const BED_MULTIPLIERS = { 'سرير فردي': 1, 'سرير مزدوج': 2, 'سرير طابقي': 2, 'سرير طابقي ثلاثي': 3 }
const BUILTIN_FEATURES = ['حمام', 'مكيف', 'مروحة', 'ثلاجة صغيرة']

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
  fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', textAlign: 'right',
  outline: 'none', boxSizing: 'border-box', background: 'white',
}
const labelStyle = { fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }

// ── Helpers ───────────────────────────────────────────────────────────────────

function normBeds(room) {
  if (Array.isArray(room.beds) && room.beds.length) return room.beds
  // Legacy single-type fields
  if (room.bed_count) return [{ type: room.bed_type || 'سرير فردي', count: room.bed_count }]
  return []
}

function roomCapacity(room) {
  return normBeds(room).reduce((s, b) => s + (b.count || 0) * (BED_MULTIPLIERS[b.type] || 1), 0)
}

function floorTotals(floor) {
  const rooms = floor.rooms || []
  return {
    rooms: rooms.length,
    beds: rooms.reduce((s, r) => s + (r.bed_count || 0), 0),
    capacity: rooms.reduce((s, r) => s + roomCapacity(r), 0),
  }
}

function buildingTotals(bld) {
  const t = { rooms: 0, beds: 0, capacity: 0 }
  for (const flr of bld.floors || []) {
    const f = floorTotals(flr)
    t.rooms    += f.rooms
    t.beds     += f.beds
    t.capacity += f.capacity
  }
  return t
}

function locationTotals(loc) {
  const t = { buildings: (loc.buildings || []).length, rooms: 0, beds: 0, capacity: 0 }
  for (const bld of loc.buildings || []) {
    const b = buildingTotals(bld)
    t.rooms    += b.rooms
    t.beds     += b.beds
    t.capacity += b.capacity
  }
  return t
}

function bedLabel(room) {
  const beds = normBeds(room)
  if (!beds.length) return '—'
  return beds.map(b => {
    const mult = BED_MULTIPLIERS[b.type] || 1
    const persons = (b.count || 0) * mult
    return mult === 1 ? `${b.count} ${b.type}` : `${b.count} ${b.type} (${persons} أسرة)`
  }).join(' + ')
}

// ── Inline editable text ──────────────────────────────────────────────────────

function InlineEdit({ value, onSave, style }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value)
  const ref = useRef()

  const commit = () => {
    if (val.trim() && val.trim() !== value) onSave(val.trim())
    setEditing(false)
  }

  if (!editing) {
    return (
      <span
        style={{ cursor: 'text', borderBottom: '1px dashed transparent', ...style }}
        onDoubleClick={() => { setVal(value); setEditing(true) }}
        title="انقر مرتين للتعديل"
      >
        {value}
      </span>
    )
  }
  return (
    <input
      ref={ref}
      autoFocus
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      style={{ ...inputStyle, width: 'auto', minWidth: 120, padding: '2px 8px', fontSize: 'inherit', fontWeight: 'inherit', ...style }}
    />
  )
}

// ── Room Modal (Add / Edit) ───────────────────────────────────────────────────

function RoomModal({ initial, onClose, onSave, toast }) {
  const isEdit = !!initial?.id

  const initBeds = () => {
    const b = normBeds(initial || {})
    return b.length ? b : [{ type: 'سرير فردي', count: 1 }]
  }

  const [name,       setName]       = useState(initial?.name || '')
  const [beds,       setBeds]       = useState(initBeds)
  const [features,   setFeatures]   = useState(initial?.features || [])
  const [isVip,      setIsVip]      = useState(initial?.is_vip || false)
  const [customFeat, setCustomFeat] = useState('')
  const [saving,     setSaving]     = useState(false)

  const totalCap = beds.reduce((s, b) => s + (b.count || 0) * (BED_MULTIPLIERS[b.type] || 1), 0)

  const updateBed = (i, field, value) =>
    setBeds(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: value } : b))

  const addBedGroup = () =>
    setBeds(prev => [...prev, { type: 'سرير فردي', count: 1 }])

  const removeBedGroup = (i) =>
    setBeds(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)

  const toggleFeature = (f) =>
    setFeatures(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])

  const addCustom = () => {
    const t = customFeat.trim()
    if (t && !features.includes(t)) setFeatures(prev => [...prev, t])
    setCustomFeat('')
  }

  const removeFeature = (f) => setFeatures(prev => prev.filter(x => x !== f))

  const handleSave = async () => {
    if (!name.trim()) { toast('اسم الغرفة مطلوب', 'error'); return }
    setSaving(true)
    try {
      await onSave({ name: name.trim(), beds, features, is_vip: isVip })
      onClose()
    } catch (e) {
      toast(e?.message || 'تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  const customFeatures = features.filter(f => !BUILTIN_FEATURES.includes(f))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 500, direction: 'rtl', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', marginBottom: 20 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, color: '#0f2744' }}>{isEdit ? 'تعديل الغرفة' : 'إضافة غرفة'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 18, display: 'grid', gap: 14 }}>

          {/* Name */}
          <div>
            <label style={labelStyle}>اسم / رقم الغرفة <span style={{ color: '#e53e3e' }}>*</span></label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="مثال: 101، غرفة A، الجناح الكبير…" />
          </div>

          {/* Bed groups */}
          <div>
            <label style={labelStyle}>الأسرة</label>
            <div style={{ display: 'grid', gap: 8 }}>
              {beds.map((bed, i) => {
                const mult   = BED_MULTIPLIERS[bed.type] || 1
                const persons = (bed.count || 0) * mult
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      value={bed.type}
                      onChange={e => updateBed(i, 'type', e.target.value)}
                      style={{ ...inputStyle, flex: 2 }}
                    >
                      {BED_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input
                      type="number" min={1} value={bed.count}
                      onChange={e => updateBed(i, 'count', Math.max(1, parseInt(e.target.value) || 1))}
                      style={{ ...inputStyle, flex: '0 0 64px', textAlign: 'center', direction: 'ltr' }}
                    />
                    {mult > 1 && (
                      <span style={{ fontSize: '0.7rem', color: '#6b7280', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        = {persons}
                      </span>
                    )}
                    <button
                      onClick={() => removeBedGroup(i)}
                      disabled={beds.length === 1}
                      style={{ background: 'none', border: 'none', cursor: beds.length === 1 ? 'not-allowed' : 'pointer', color: beds.length === 1 ? '#e2e6ef' : '#c5cdd8', padding: 3, flexShrink: 0 }}
                      onMouseEnter={e => { if (beds.length > 1) e.currentTarget.style.color = '#ef4444' }}
                      onMouseLeave={e => e.currentTarget.style.color = beds.length === 1 ? '#e2e6ef' : '#c5cdd8'}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
            <button onClick={addBedGroup}
              style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1.5px dashed #c5d8f8', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', color: '#4a6fa5', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600 }}>
              <Plus size={12} /> إضافة نوع سرير آخر
            </button>
          </div>

          {/* Capacity preview */}
          <div style={{ background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BedDouble size={14} color="#0f2744" />
            <span style={{ fontSize: '0.82rem', color: '#0f2744', fontWeight: 700 }}>
              الطاقة الاستيعابية الإجمالية: {totalCap} {totalCap === 1 ? 'شخص' : 'أشخاص'}
            </span>
          </div>

          {/* VIP */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setIsVip(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                border: `1.5px solid ${isVip ? '#f59e0b' : '#e2e6ef'}`,
                borderRadius: 20, background: isVip ? '#fffbeb' : 'white',
                cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem',
                fontWeight: 700, color: isVip ? '#92400e' : '#6b7280',
              }}
            >
              <Star size={13} color={isVip ? '#f59e0b' : '#c5cdd8'} fill={isVip ? '#f59e0b' : 'none'} />
              {isVip ? 'غرفة VIP' : 'غرفة عادية'}
            </button>
            <span style={{ fontSize: '0.72rem', color: '#9ba5bc' }}>انقر للتبديل</span>
          </div>

          {/* Features */}
          <div>
            <label style={labelStyle}>المميزات</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {BUILTIN_FEATURES.map(f => {
                const active = features.includes(f)
                return (
                  <button key={f} type="button" onClick={() => toggleFeature(f)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${active ? '#0f2744' : '#e2e6ef'}`,
                      background: active ? '#0f2744' : 'white', color: active ? 'white' : '#4a5568',
                      cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600,
                    }}>
                    {f}
                  </button>
                )
              })}
            </div>

            {customFeatures.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {customFeatures.map(f => (
                  <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, color: '#0f2744' }}>
                    {f}
                    <button onClick={() => removeFeature(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 0, display: 'flex', lineHeight: 1 }}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={customFeat}
                onChange={e => setCustomFeat(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustom()}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="أضف ميزة مخصصة…"
              />
              <button onClick={addCustom} className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>إضافة</button>
            </div>
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

// ── Room card ─────────────────────────────────────────────────────────────────

function RoomCard({ room, locId, bldId, flrId, onRefresh, toast }) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm(`حذف الغرفة "${room.name}"؟`)) return
    try {
      await api.deleteCampRoom(locId, bldId, flrId, room.id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  const handleSave = async (body) => {
    await api.updateCampRoom(locId, bldId, flrId, room.id, body)
    toast('تم الحفظ', 'success')
    onRefresh()
  }

  const cap = roomCapacity(room)

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: room.is_vip ? 'linear-gradient(135deg, #fffbeb 0%, #fef9f0 100%)' : 'white',
          border: `1px solid ${room.is_vip ? '#fde68a' : '#edf0f7'}`,
          borderRadius: 10, padding: '12px 14px',
          borderRight: room.is_vip ? '3px solid #f59e0b' : `1px solid #edf0f7`,
          transition: '0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f2744' }}>{room.name}</span>
              {room.is_vip && (
                <span style={{ fontSize: '0.6rem', fontWeight: 800, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: 8 }}>VIP</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <BedDouble size={12} color="#6b7280" style={{ marginTop: 3, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {normBeds(room).map((b, i) => {
                  const mult = BED_MULTIPLIERS[b.type] || 1
                  const persons = (b.count || 0) * mult
                  return (
                    <span key={i} style={{ display: 'inline-block', fontSize: '0.75rem', color: '#374151', fontWeight: 600, marginLeft: i < normBeds(room).length - 1 ? 6 : 0 }}>
                      {b.count} {b.type}{mult > 1 ? ` (${persons})` : ''}
                      {i < normBeds(room).length - 1 && <span style={{ color: '#c5cdd8', margin: '0 4px' }}>+</span>}
                    </span>
                  )
                })}
              </div>
              <span style={{ fontSize: '0.72rem', background: '#f0f4ff', color: '#1d4ed8', padding: '1px 8px', borderRadius: 10, fontWeight: 700, border: '1px solid #c5d8f8', flexShrink: 0 }}>
                {cap} {cap === 1 ? 'شخص' : 'أشخاص'}
              </span>
            </div>

            {room.features?.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {room.features.map(f => (
                  <span key={f} style={{ fontSize: '0.65rem', background: '#f8fafc', color: '#4a5568', border: '1px solid #e2e8f0', padding: '1px 7px', borderRadius: 10, fontWeight: 600 }}>{f}</span>
                ))}
              </div>
            )}
          </div>

          {hovered && (
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 3 }}
                onMouseEnter={e => e.currentTarget.style.color = '#4a5568'} onMouseLeave={e => e.currentTarget.style.color = '#9ba5bc'}>
                <Edit2 size={13} />
              </button>
              <button onClick={handleDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 3 }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#9ba5bc'}>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <RoomModal
          initial={room}
          onClose={() => setEditing(false)}
          onSave={handleSave}
          toast={toast}
        />
      )}
    </>
  )
}

// ── Floor section ─────────────────────────────────────────────────────────────

function FloorSection({ floor, locId, bldId, onRefresh, toast, defaultOpen }) {
  const [open, setOpen]         = useState(defaultOpen)
  const [showAddRoom, setAddRoom] = useState(false)
  const [uploadingPlan, setUploading] = useState(false)
  const [planBust, setPlanBust]   = useState(Date.now())
  const planInputRef              = useRef()

  const totals = floorTotals(floor)

  const handleRename = async (name) => {
    try {
      await api.updateCampFloor(locId, bldId, floor.id, { name })
      toast('تم الحفظ', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
  }

  const handleDelete = async () => {
    if (!window.confirm(`حذف الطابق "${floor.name}" وجميع غرفه؟`)) return
    try {
      await api.deleteCampFloor(locId, bldId, floor.id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  const handleAddRoom = async (body) => {
    await api.addCampRoom(locId, bldId, floor.id, body)
    toast('تمت إضافة الغرفة', 'success')
    onRefresh()
    setAddRoom(false)
  }

  const handleUploadPlan = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.uploadFloorPlan(locId, bldId, floor.id, file)
      toast('تم رفع مخطط الطابق', 'success')
      setPlanBust(Date.now())
      onRefresh()
    } catch (err) { toast(err?.message || 'تعذّر الرفع', 'error') }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleDeletePlan = async () => {
    if (!window.confirm('حذف مخطط الطابق؟')) return
    try {
      await api.deleteFloorPlan(locId, bldId, floor.id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  return (
    <div style={{ border: '1px solid #e9ecf3', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
      {/* Floor header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f8fafc', cursor: 'pointer' }}
        onClick={() => setOpen(v => !v)}>
        <Layers size={13} color="#6b7280" style={{ flexShrink: 0 }} />
        <InlineEdit
          value={floor.name}
          onSave={handleRename}
          style={{ fontWeight: 700, color: '#374151', fontSize: '0.85rem' }}
        />
        <div style={{ display: 'flex', gap: 6, marginRight: 'auto', alignItems: 'center' }}>
          {[
            { label: `${totals.rooms} غرفة`, color: '#6b7280' },
            { label: `${totals.capacity} شخص`, color: '#1d4ed8' },
          ].map(({ label, color }) => (
            <span key={label} style={{ fontSize: '0.68rem', color, fontWeight: 700, background: '#f1f5f9', padding: '1px 7px', borderRadius: 8 }}>{label}</span>
          ))}
        </div>
        <button onClick={e => { e.stopPropagation(); handleDelete() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3, flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
          <Trash2 size={13} />
        </button>
        {open ? <ChevronUp size={14} color="#9ba5bc" /> : <ChevronDown size={14} color="#9ba5bc" />}
      </div>

      {open && (
        <div style={{ padding: '12px 14px' }}>
          {/* Floor plan image */}
          <div style={{ marginBottom: 14 }}>
            {floor.floor_plan_image ? (
              <div>
                <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
                  <img
                    src={api.floorPlanUrl(floor.id, planBust)}
                    alt="مخطط الطابق"
                    style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid #e2e6ef', display: 'block' }}
                  />
                  <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 6 }}>
                    <button onClick={() => planInputRef.current?.click()}
                      style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid #e2e6ef', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, color: '#374151', fontFamily: 'var(--font-body)' }}>
                      تغيير
                    </button>
                    <button onClick={handleDeletePlan}
                      style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, color: '#dc2626', fontFamily: 'var(--font-body)' }}>
                      حذف
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={() => planInputRef.current?.click()} disabled={uploadingPlan}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: '1.5px dashed #c5d8f8', borderRadius: 8, background: '#f7f9ff', cursor: 'pointer', color: '#4a6fa5', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'var(--font-body)' }}>
                {uploadingPlan ? <><div className="spinner" style={{ width: 14, height: 14 }} /> جارٍ الرفع…</> : <><Upload size={13} /> رفع مخطط الطابق</>}
              </button>
            )}
            <input ref={planInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadPlan} />
          </div>

          {/* Rooms grid */}
          {floor.rooms?.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginBottom: 10 }}>
              {floor.rooms.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  locId={locId}
                  bldId={bldId}
                  flrId={floor.id}
                  onRefresh={onRefresh}
                  toast={toast}
                />
              ))}
            </div>
          )}

          {floor.rooms?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#c5cdd8', fontSize: '0.82rem', border: '1.5px dashed #e9ecf3', borderRadius: 8, marginBottom: 10 }}>
              لا توجد غرف في هذا الطابق بعد
            </div>
          )}

          <button onClick={() => setAddRoom(true)} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}>
            <Plus size={12} /> إضافة غرفة
          </button>
        </div>
      )}

      {showAddRoom && (
        <RoomModal
          onClose={() => setAddRoom(false)}
          onSave={handleAddRoom}
          toast={toast}
        />
      )}
    </div>
  )
}

// ── Building section ──────────────────────────────────────────────────────────

function BuildingSection({ building, locId, onRefresh, toast, defaultOpen }) {
  const [open, setOpen]           = useState(defaultOpen)
  const [showAddFloor, setAddFloor] = useState(false)
  const [newFloorName, setFloorName] = useState('')
  const [editMapsUrl, setEditMaps]  = useState(false)
  const [mapsUrlVal, setMapsUrlVal] = useState(building.maps_url || '')
  const [savingUrl, setSavingUrl]   = useState(false)

  const totals = buildingTotals(building)

  const handleRename = async (name) => {
    try {
      await api.updateCampBuilding(locId, building.id, { name })
      toast('تم الحفظ', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
  }

  const handleSaveMapsUrl = async () => {
    setSavingUrl(true)
    try {
      await api.updateCampBuilding(locId, building.id, { maps_url: mapsUrlVal.trim() })
      toast('تم الحفظ', 'success')
      onRefresh()
      setEditMaps(false)
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
    finally { setSavingUrl(false) }
  }

  const handleDelete = async () => {
    if (!window.confirm(`حذف المبنى "${building.name}" وجميع طوابقه وغرفه؟`)) return
    try {
      await api.deleteCampBuilding(locId, building.id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  const handleAddFloor = async () => {
    if (!newFloorName.trim()) { toast('اسم الطابق مطلوب', 'error'); return }
    try {
      await api.addCampFloor(locId, building.id, { name: newFloorName.trim() })
      toast('تمت إضافة الطابق', 'success')
      setFloorName('')
      setAddFloor(false)
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الإضافة', 'error') }
  }

  return (
    <div style={{ border: '1.5px solid #dce4f0', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
      {/* Building header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#f0f4ff', cursor: 'pointer', borderBottom: open ? '1px solid #dce4f0' : 'none' }}
        onClick={() => setOpen(v => !v)}>
        <Building2 size={15} color="#0f2744" style={{ flexShrink: 0 }} />
        <InlineEdit
          value={building.name}
          onSave={handleRename}
          style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.92rem' }}
        />
        <div style={{ display: 'flex', gap: 6, marginRight: 'auto', alignItems: 'center' }}>
          {[
            { label: `${(building.floors || []).length} طابق`, dot: '#6b7280' },
            { label: `${totals.rooms} غرفة`, dot: '#6b7280' },
            { label: `${totals.capacity} شخص`, dot: '#1d4ed8' },
          ].map(({ label, dot }) => (
            <span key={label} style={{ fontSize: '0.68rem', color: '#374151', fontWeight: 700, background: 'white', padding: '2px 8px', borderRadius: 8, border: '1px solid #dce4f0' }}>{label}</span>
          ))}
        </div>
        <button onClick={e => { e.stopPropagation(); handleDelete() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3, flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
          <Trash2 size={14} />
        </button>
        {open ? <ChevronUp size={15} color="#6b7280" /> : <ChevronDown size={15} color="#6b7280" />}
      </div>

      {open && (
        <div style={{ padding: '14px 16px' }}>
          {/* Maps URL */}
          <div style={{ marginBottom: 14 }}>
            {editMapsUrl ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  autoFocus
                  value={mapsUrlVal}
                  onChange={e => setMapsUrlVal(e.target.value)}
                  style={{ ...inputStyle, flex: 1, fontSize: '0.78rem', direction: 'ltr', textAlign: 'left' }}
                  placeholder="رابط Google Maps…"
                />
                <button onClick={handleSaveMapsUrl} disabled={savingUrl} className="btn btn-gold btn-sm">حفظ</button>
                <button onClick={() => { setEditMaps(false); setMapsUrlVal(building.maps_url || '') }} className="btn btn-ghost btn-sm">إلغاء</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {building.maps_url ? (
                  <a href={building.maps_url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}>
                    <MapPin size={13} /> عرض على الخريطة
                  </a>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: '#c5cdd8' }}>لا يوجد رابط خريطة</span>
                )}
                <button onClick={() => setEditMaps(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 2, display: 'flex' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#4a5568'} onMouseLeave={e => e.currentTarget.style.color = '#9ba5bc'}>
                  <Edit2 size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Floors */}
          {(building.floors || []).map((flr, i) => (
            <FloorSection
              key={flr.id}
              floor={flr}
              locId={locId}
              bldId={building.id}
              onRefresh={onRefresh}
              toast={toast}
              defaultOpen={i === 0}
            />
          ))}

          {/* Add floor */}
          {showAddFloor ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                autoFocus
                value={newFloorName}
                onChange={e => setFloorName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddFloor()}
                style={inputStyle}
                placeholder="اسم الطابق (مثال: الطابق الأرضي، الطابق الأول…)"
              />
              <button onClick={handleAddFloor} className="btn btn-gold btn-sm">إضافة</button>
              <button onClick={() => { setAddFloor(false); setFloorName('') }} className="btn btn-ghost btn-sm">إلغاء</button>
            </div>
          ) : (
            <button onClick={() => setAddFloor(true)} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: '0.78rem' }}>
              <Plus size={12} /> إضافة طابق
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Location card ─────────────────────────────────────────────────────────────

function LocationCard({ location, onRefresh, toast }) {
  const [open, setOpen]             = useState(false)
  const [showAddBld, setAddBld]     = useState(false)
  const [newBldName, setBldName]    = useState('')
  const [newBldMaps, setBldMaps]    = useState('')

  const totals = locationTotals(location)

  const handleRename = async (name) => {
    try {
      await api.updateCampLocation(location.id, { name })
      toast('تم الحفظ', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
  }

  const handleDelete = async () => {
    if (!window.confirm(`حذف الموقع "${location.name}" وجميع مبانيه وطوابقه وغرفه؟`)) return
    try {
      await api.deleteCampLocation(location.id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
  }

  const handleAddBuilding = async () => {
    if (!newBldName.trim()) { toast('اسم المبنى مطلوب', 'error'); return }
    try {
      await api.addCampBuilding(location.id, { name: newBldName.trim(), maps_url: newBldMaps.trim() })
      toast('تمت إضافة المبنى', 'success')
      setBldName(''); setBldMaps('')
      setAddBld(false)
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الإضافة', 'error') }
  }

  return (
    <div style={{ background: 'white', border: '1.5px solid #e2e6ef', borderRadius: 14, marginBottom: 18, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,39,68,0.05)' }}>
      {/* Location header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer', background: open ? '#f7f9ff' : 'white', borderBottom: open ? '1.5px solid #e2e6ef' : 'none' }}
        onClick={() => setOpen(v => !v)}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MapPin size={18} color="#0f2744" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineEdit
            value={location.name}
            onSave={handleRename}
            style={{ fontWeight: 800, color: '#0f2744', fontSize: '1rem' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {[
              { label: `${totals.buildings} مبنى` },
              { label: `${totals.rooms} غرفة` },
              { label: `${totals.capacity} شخص`, highlight: true },
            ].map(({ label, highlight }) => (
              <span key={label} style={{ fontSize: '0.68rem', fontWeight: 700, color: highlight ? '#1d4ed8' : '#6b7280', background: highlight ? '#eff6ff' : '#f1f5f9', padding: '2px 8px', borderRadius: 8, border: highlight ? '1px solid #bfdbfe' : 'none' }}>
                {label}
              </span>
            ))}
          </div>
        </div>
        <button onClick={e => { e.stopPropagation(); handleDelete() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 4, flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'} onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
          <Trash2 size={15} />
        </button>
        {open ? <ChevronUp size={16} color="#9ba5bc" /> : <ChevronDown size={16} color="#9ba5bc" />}
      </div>

      {open && (
        <div style={{ padding: '16px 18px' }}>
          {(location.buildings || []).map((bld, i) => (
            <BuildingSection
              key={bld.id}
              building={bld}
              locId={location.id}
              onRefresh={onRefresh}
              toast={toast}
              defaultOpen={i === 0}
            />
          ))}

          {location.buildings?.length === 0 && !showAddBld && (
            <div style={{ textAlign: 'center', padding: '24px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 10, marginBottom: 12, fontSize: '0.85rem' }}>
              لا توجد مبانٍ بعد — أضف مبنى للبدء
            </div>
          )}

          {/* Add building form */}
          {showAddBld ? (
            <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, padding: 14, background: '#f7f9ff', marginTop: 8 }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#4a5568', marginBottom: 10 }}>إضافة مبنى جديد</div>
              <div style={{ display: 'grid', gap: 10 }}>
                <input autoFocus value={newBldName} onChange={e => setBldName(e.target.value)}
                  style={inputStyle} placeholder="اسم المبنى (مثال: المبنى الرئيسي، الجناح B…) *" />
                <input value={newBldMaps} onChange={e => setBldMaps(e.target.value)}
                  style={{ ...inputStyle, direction: 'ltr', textAlign: 'left', fontSize: '0.78rem' }}
                  placeholder="رابط Google Maps (اختياري)" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleAddBuilding} className="btn btn-gold btn-sm">إضافة</button>
                  <button onClick={() => { setAddBld(false); setBldName(''); setBldMaps('') }} className="btn btn-ghost btn-sm">إلغاء</button>
                </div>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddBld(true)} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <Plus size={13} /> إضافة مبنى
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main CampLocations ─────────────────────────────────────────────────────────

export default function CampLocations({ toast }) {
  const [locations, setLocations] = useState([])
  const [loading, setLoading]     = useState(true)
  const [showAdd, setShowAdd]     = useState(false)
  const [newName, setNewName]     = useState('')
  const [adding, setAdding]       = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.listCampLocations()
      .then(d => { setLocations(d.locations || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Silent: updates data without showing the spinner, so components stay mounted
  // and their open/collapsed state is preserved.
  const refresh = useCallback(() => {
    api.listCampLocations()
      .then(d => setLocations(d.locations || []))
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!newName.trim()) { toast('الاسم مطلوب', 'error'); return }
    setAdding(true)
    try {
      await api.createCampLocation({ name: newName.trim() })
      toast('تمت الإضافة', 'success')
      setNewName('')
      setShowAdd(false)
      refresh()
    } catch (e) { toast(e?.message || 'تعذّر الإضافة', 'error') }
    finally { setAdding(false) }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.95rem' }}>مواقع التخييم</div>
          <div style={{ fontSize: '0.75rem', color: '#9ba5bc', marginTop: 2 }}>{locations.length} موقع مسجّل</div>
        </div>
        {showAdd ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ ...inputStyle, width: 240 }} placeholder="اسم الموقع *" />
            <button onClick={handleAdd} disabled={adding} className="btn btn-gold btn-sm">{adding ? 'جارٍ...' : 'إضافة'}</button>
            <button onClick={() => { setShowAdd(false); setNewName('') }} className="btn btn-ghost btn-sm">إلغاء</button>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} className="btn btn-gold btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={13} /> موقع جديد
          </button>
        )}
      </div>

      {/* Hint for inline rename */}
      {locations.length > 0 && (
        <div style={{ fontSize: '0.7rem', color: '#c5cdd8', marginBottom: 14 }}>
          انقر مرتين على أي اسم لتعديله مباشرةً
        </div>
      )}

      {locations.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <MapPin size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لا توجد مواقع مسجّلة بعد</div>
          <div style={{ fontSize: '0.76rem', marginTop: 6 }}>أضف موقع تخييم للبدء</div>
        </div>
      )}

      {locations.map(loc => (
        <LocationCard key={loc.id} location={loc} onRefresh={refresh} toast={toast} />
      ))}
    </div>
  )
}
