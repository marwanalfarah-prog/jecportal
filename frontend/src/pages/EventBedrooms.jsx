import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  BedDouble, Settings, BarChart2, Moon, RotateCcw, Trash2,
  GripVertical, ChevronDown, ChevronUp, Users, UserCheck,
  Building2, UserPlus, AlertTriangle, Lock, Unlock, Download,
} from 'lucide-react'
import { api } from '../api.js'
import { downloadBedroomsDocx } from '../docxExport.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const REG_TYPE_LABELS = {
  members:      'المشاركون',
  supervisors:  'المسؤولون',
  gs_committee: 'الأمانة العامة واللجان',
  guests:       'الضيوف',
}
const REG_TYPE_COLORS = {
  members:      { bg: '#eff6ff', text: '#1d4ed8', dot: '#93c5fd' },
  supervisors:  { bg: '#f5f3ff', text: '#7c3aed', dot: '#c4b5fd' },
  gs_committee: { bg: '#fff7ed', text: '#c2410c', dot: '#fdba74' },
  guests:       { bg: '#f0fdf4', text: '#15803d', dot: '#86efac' },
}
const GENDER_COLORS = {
  'ذكر':  { bg: '#eff6ff', text: '#1d4ed8' },
  'أنثى': { bg: '#fdf4ff', text: '#9333ea' },
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const chip = (bg, text, extra = {}) => ({
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '2px 7px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 700,
  background: bg, color: text, ...extra,
})

// ── Small helpers ─────────────────────────────────────────────────────────────

function genderKey(g) {
  return g === 'ذكر' ? 'male' : g === 'أنثى' ? 'female' : null
}

function ygShortLabel(label) {
  if (!label) return null
  const dash = label.lastIndexOf(' - ')
  if (dash >= 0) return label.slice(dash + 3).trim()
  return label.replace(/^شبيبة\s+/, '').trim() || label
}

function resolveFloorGender(floorId, bldId, floorGen, bldGen) {
  return floorGen[floorId] || bldGen[bldId] || null
}

function roomOccupancyByNight(assignments, rooms) {
  // Returns {room_id: {night: count}}
  const map = {}
  for (const r of rooms) { map[r.room.id] = {} }
  for (const a of assignments) {
    if (!map[a.room_id]) map[a.room_id] = {}
    for (const n of (a.nights || [])) {
      map[a.room_id][n] = (map[a.room_id][n] || 0) + 1
    }
  }
  return map
}

// ── PersonCard (draggable) ────────────────────────────────────────────────────

function PersonCard({ asgn, person, regType, onDragStart, isDragging, isSaving, compact }) {
  const typeColor = REG_TYPE_COLORS[regType] || REG_TYPE_COLORS.members
  const gColor    = GENDER_COLORS[person?.gender]
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, asgn)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: compact ? '5px 8px' : '7px 10px',
        background: isSaving ? '#f0f4ff' : 'white',
        borderRadius: 8, border: '1px solid #edf0f7',
        opacity: isDragging ? 0.45 : isSaving ? 0.7 : 1,
        cursor: 'grab', userSelect: 'none', marginBottom: 3,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <GripVertical size={11} color="#c5cdd8" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? '0.78rem' : '0.82rem', fontWeight: 700, color: '#0f2744', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {person?.name || '—'}
        </div>
        {ygShortLabel(person?.youth_group_label) && (
          <div style={{ fontSize: '0.65rem', color: '#9ba5bc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ygShortLabel(person?.youth_group_label)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
        {gColor && <span style={chip(gColor.bg, gColor.text)}>{person.gender === 'ذكر' ? 'ذ' : 'أ'}</span>}
        <span style={chip(typeColor.bg, typeColor.text)}>{regType === 'members' ? 'م' : regType === 'supervisors' ? 'مس' : regType === 'gs_committee' ? 'أ' : 'ض'}</span>
      </div>
    </div>
  )
}

// ── RoomCard (drop zone) ──────────────────────────────────────────────────────

function RoomCard({ roomEntry, assignments, people, nights, filterNight, config,
                    dragOver, onDragOver, onDragLeave, onDrop,
                    onDragStart, dragItem, saving,
                    onToggleOccupied, onSetRoomGender }) {
  const room   = roomEntry.room
  const rid    = room.id
  const cfg    = config || {}
  const isOcc  = (cfg.occupied_rooms || []).includes(rid)
  const isOver = dragOver === rid

  const floorGen = cfg.floor_gender || {}
  const bldGen   = cfg.building_gender || {}
  const lockedGender = resolveFloorGender(roomEntry.floor_id, roomEntry.building_id, floorGen, bldGen)

  const roomAsgns = assignments.filter(a => a.room_id === rid)
  const nightAsgns = filterNight
    ? roomAsgns.filter(a => (a.nights || []).includes(filterNight))
    : roomAsgns

  // Per-night max occupancy for capacity display
  const maxOccNight = nights.reduce((best, n) => {
    const cnt = roomAsgns.filter(a => (a.nights || []).includes(n)).length
    return Math.max(best, cnt)
  }, 0)

  const capacity = room.capacity || 0
  const pct = capacity ? Math.min(1, maxOccNight / capacity) : 0
  const isFull = maxOccNight >= capacity
  const genderInRoom = (() => {
    const genders = [...new Set(nightAsgns.map(a => people[a.person_id]?.gender).filter(Boolean))]
    return genders.length === 1 ? genders[0] : genders.length > 1 ? 'mixed' : null
  })()

  return (
    <div
      style={{
        background: isOcc ? '#f8fafc' : 'white',
        border: `1.5px solid ${isOver ? '#93c5fd' : isOcc ? '#e2e6ef' : '#edf0f7'}`,
        borderRadius: 12, overflow: 'hidden',
        boxShadow: isOver ? '0 0 0 3px rgba(147,197,253,0.3)' : '0 1px 3px rgba(15,39,68,0.05)',
        transition: '0.15s', opacity: isOcc ? 0.65 : 1,
      }}
      onDragOver={e => { e.preventDefault(); if (!isOcc) onDragOver(rid) }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); if (!isOcc) onDrop(rid) }}
    >
      {/* Room header */}
      <div style={{ background: isOcc ? '#e9ecf3' : room.is_vip ? '#0f2744' : '#1e3a5f', padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 800, color: 'white', fontSize: '0.88rem', flex: 1 }}>
            {room.is_vip && <span style={{ fontSize: '0.6rem', background: '#f59e0b', color: '#0f2744', padding: '1px 5px', borderRadius: 6, marginLeft: 5, fontWeight: 800 }}>VIP</span>}
            غرفة {room.name}
          </span>
          {lockedGender && (
            <span style={{ fontSize: '0.62rem', background: lockedGender === 'male' ? '#eff6ff' : '#fdf4ff',
                          color: lockedGender === 'male' ? '#1d4ed8' : '#9333ea', padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>
              <Lock size={9} style={{ marginLeft: 3 }} />{lockedGender === 'male' ? 'ذكور' : 'إناث'}
            </span>
          )}
          <button
            onClick={() => onToggleOccupied(rid, !isOcc)}
            title={isOcc ? 'إلغاء وضع مشغول' : 'تعيين كمشغول'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isOcc ? '#fcd34d' : 'rgba(255,255,255,0.5)', padding: 2 }}
          >
            {isOcc ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>
        {/* Capacity bar */}
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct * 100}%`, background: isFull ? '#ef4444' : pct > 0.7 ? '#f59e0b' : '#86efac', transition: '0.3s' }} />
          </div>
          <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.8)', fontWeight: 700, flexShrink: 0 }}>
            {maxOccNight}/{capacity}
          </span>
        </div>
        {/* Features */}
        {(room.features || []).length > 0 && (
          <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {(room.features || []).map(f => (
              <span key={f} style={{ fontSize: '0.58rem', background: 'rgba(255,255,255,0.15)', color: 'white', padding: '1px 5px', borderRadius: 6, fontWeight: 600 }}>{f}</span>
            ))}
          </div>
        )}
      </div>

      {/* Drop zone body */}
      <div
        style={{
          minHeight: 48, padding: '8px 10px',
          background: isOver ? '#f0f7ff' : 'transparent',
          border: isOver ? '2px dashed #93c5fd' : '2px dashed transparent',
          transition: '0.15s',
        }}
      >
        {nightAsgns.map(a => (
          <PersonCard
            key={a.id} asgn={a} person={people[a.person_id]}
            regType={a.reg_type}
            onDragStart={onDragStart} isDragging={dragItem?.id === a.id}
            isSaving={saving === a.id} compact
          />
        ))}
        {isOver && (
          <div style={{ textAlign: 'center', padding: '6px', fontSize: '0.72rem', color: '#3b82f6', fontWeight: 600 }}>
            إفلت هنا
          </div>
        )}
        {isOcc && (
          <div style={{ textAlign: 'center', padding: '8px', fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 600 }}>
            مشغول
          </div>
        )}
      </div>

      {/* Gender indicator */}
      {genderInRoom && genderInRoom !== 'mixed' && !lockedGender && (
        <div style={{ padding: '3px 10px', borderTop: '1px solid #f1f5f9', fontSize: '0.62rem',
                     color: genderInRoom === 'ذكر' ? '#1d4ed8' : '#9333ea',
                     background: genderInRoom === 'ذكر' ? '#eff6ff' : '#fdf4ff', fontWeight: 700 }}>
          {genderInRoom === 'ذكر' ? 'ذكور' : 'إناث'}
        </div>
      )}
      {genderInRoom === 'mixed' && (
        <div style={{ padding: '3px 10px', borderTop: '1px solid #f1f5f9', fontSize: '0.62rem',
                     color: '#dc2626', background: '#fef2f2', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={10} /> تحذير: ذكور وإناث
        </div>
      )}
    </div>
  )
}

// ── SetupTab ──────────────────────────────────────────────────────────────────

function SetupTab({ eventId, rooms_flat, config, registration, onConfigChange, toast }) {
  const [saving, setSaving] = useState(false)
  const [localConfig, setLocalConfig] = useState(() => ({
    hull_priority: [],
    multi_hull_overrides: {},
    floor_gender: {},
    building_gender: {},
    occupied_rooms: [],
    distribution_options: { yg_cohesion: 'none', leader_placement: 'none', compactness: 'compact' },
    ...config,
  }))

  useEffect(() => {
    setLocalConfig({
      hull_priority: [],
      multi_hull_overrides: {},
      floor_gender: {},
      building_gender: {},
      occupied_rooms: [],
      distribution_options: { yg_cohesion: 'none', leader_placement: 'none', compactness: 'compact' },
      ...config,
    })
  }, [config])

  // Extract unique hulls from gs_committee registrations
  const allHulls = useMemo(() => {
    const hullSet = new Set()
    for (const e of (registration?.gs_committee || [])) {
      for (const h of (e.hulls || [])) hullSet.add(h)
    }
    return [...hullSet]
  }, [registration])

  // gs_committee members with multiple hulls
  const multiHullMembers = useMemo(() => {
    return (registration?.gs_committee || []).filter(e => (e.hulls || []).length > 1)
  }, [registration])

  // Group rooms by building > floor
  const buildingMap = useMemo(() => {
    const bMap = {}
    for (const r of rooms_flat) {
      const bk = r.building_id
      if (!bMap[bk]) bMap[bk] = { name: r.building_name, floors: {} }
      if (!bMap[bk].floors[r.floor_id]) bMap[bk].floors[r.floor_id] = { name: r.floor_name, rooms: [] }
      bMap[bk].floors[r.floor_id].rooms.push(r)
    }
    return bMap
  }, [rooms_flat])

  const upd = (key, val) => setLocalConfig(prev => ({ ...prev, [key]: val }))
  const updOpts = (key, val) => setLocalConfig(prev => ({
    ...prev,
    distribution_options: { ...(prev.distribution_options || {}), [key]: val },
  }))

  const save = async () => {
    setSaving(true)
    try {
      await api.updateBedroomConfig(eventId, localConfig)
      onConfigChange(localConfig)
      toast('تم الحفظ', 'success')
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
    finally { setSaving(false) }
  }

  const opts = localConfig.distribution_options || {}

  // Hull priority management
  const hullPriority = localConfig.hull_priority || []

  const getHullRank = (hull) => {
    for (const g of hullPriority) {
      if ((g.hulls || []).includes(hull)) return g.rank
    }
    return null
  }

  const setHullRank = (hull, rank) => {
    let newPrio = hullPriority.map(g => ({
      ...g, hulls: (g.hulls || []).filter(h => h !== hull),
    })).filter(g => (g.hulls || []).length > 0)

    if (rank !== null) {
      const existing = newPrio.find(g => g.rank === rank)
      if (existing) {
        existing.hulls = [...existing.hulls, hull]
      } else {
        newPrio = [...newPrio, { rank, hulls: [hull] }]
        newPrio.sort((a, b) => a.rank - b.rank)
      }
    }
    upd('hull_priority', newPrio)
  }

  const maxRank = hullPriority.length ? Math.max(...hullPriority.map(g => g.rank)) : 0

  return (
    <div style={{ direction: 'rtl' }}>

      {/* Hull Priority */}
      {allHulls.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.9rem', marginBottom: 14 }}>
            أولويات الأفواج (الأمانة العامة واللجان)
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 12 }}>
            الأولوية 1 = أفضل الغرف. يمكن أن تحتوي أكثر من فوج على نفس الأولوية.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 700, padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>الفوج</th>
                <th style={{ textAlign: 'center', fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 700, padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>الأولوية</th>
              </tr>
            </thead>
            <tbody>
              {allHulls.map(hull => (
                <tr key={hull}>
                  <td style={{ padding: '6px 8px', fontSize: '0.82rem', color: '#0f2744', fontWeight: 600 }}>{hull}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <select
                        value={getHullRank(hull) ?? ''}
                        onChange={e => setHullRank(hull, e.target.value === '' ? null : Number(e.target.value))}
                        style={{ padding: '4px 8px', borderRadius: 7, border: '1.5px solid #e2e6ef', fontFamily: 'var(--font-body)', fontSize: '0.8rem', outline: 'none', background: 'white' }}
                      >
                        <option value="">بلا أولوية</option>
                        {Array.from({ length: maxRank + 2 }, (_, i) => i + 1).map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-hull overrides */}
      {multiHullMembers.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.9rem', marginBottom: 14 }}>
            أعضاء في أكثر من فوج — تحديد الفوج الحاكم للغرفة
          </div>
          {multiHullMembers.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8 }}>
              <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 700, color: '#0f2744' }}>{e.name || e.person_id}</span>
              <span style={{ fontSize: '0.67rem', color: '#9ba5bc' }}>{(e.hulls || []).join(' · ')}</span>
              <select
                value={(localConfig.multi_hull_overrides || {})[e.id] || ''}
                onChange={ev => upd('multi_hull_overrides', { ...(localConfig.multi_hull_overrides || {}), [e.id]: ev.target.value || null })}
                style={{ padding: '4px 8px', borderRadius: 7, border: '1.5px solid #e2e6ef', fontFamily: 'var(--font-body)', fontSize: '0.78rem', outline: 'none', background: 'white' }}
              >
                <option value="">تلقائي (الأول)</option>
                {(e.hulls || []).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Floor/Building gender locks */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.9rem', marginBottom: 4 }}>تحديد جنس الأدوار والمباني</div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 14 }}>يمنع التوزيع التلقائي من وضع الجنس الآخر في الدور/المبنى. يمكن تجاوزه يدوياً.</div>
        {Object.entries(buildingMap).map(([bldId, bld]) => (
          <div key={bldId} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.85rem' }}>{bld.name}</span>
              <GenderSelect
                value={(localConfig.building_gender || {})[bldId] || ''}
                onChange={v => upd('building_gender', { ...(localConfig.building_gender || {}), [bldId]: v || null })}
                label="المبنى كاملاً"
              />
            </div>
            {Object.entries(bld.floors).map(([flrId, flr]) => (
              <div key={flrId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, paddingRight: 16 }}>
                <span style={{ fontSize: '0.8rem', color: '#4b5563', fontWeight: 600 }}>{flr.name}</span>
                <GenderSelect
                  value={(localConfig.floor_gender || {})[flrId] || ''}
                  onChange={v => upd('floor_gender', { ...(localConfig.floor_gender || {}), [flrId]: v || null })}
                  label="الدور"
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Occupied rooms */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.9rem', marginBottom: 14 }}>الغرف المشغولة (تُستثنى من التوزيع التلقائي)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
          {rooms_flat.map(r => {
            const isOcc = (localConfig.occupied_rooms || []).includes(r.room.id)
            return (
              <label key={r.room.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                                              background: isOcc ? '#fff7ed' : '#f8fafc', border: `1px solid ${isOcc ? '#fdba74' : '#e9ecf3'}`,
                                              borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>
                <input
                  type="checkbox" checked={isOcc}
                  onChange={e => {
                    const occ = localConfig.occupied_rooms || []
                    upd('occupied_rooms', e.target.checked ? [...occ, r.room.id] : occ.filter(x => x !== r.room.id))
                  }}
                />
                {r.building_name} › {r.floor_name} › {r.room.name}
                {r.room.is_vip && <span style={{ fontSize: '0.58rem', background: '#f59e0b', color: '#0f2744', padding: '1px 5px', borderRadius: 5, fontWeight: 800 }}>VIP</span>}
              </label>
            )
          })}
        </div>
      </div>

      {/* Distribution options */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px', marginBottom: 20 }}>
        <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.9rem', marginBottom: 16 }}>خيارات التوزيع التلقائي</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>

          <RadioGroup label="تجميع أعضاء الشبيبة"
            value={opts.yg_cohesion || 'none'}
            onChange={v => updOpts('yg_cohesion', v)}
            options={[
              { value: 'none',     label: 'بلا تفضيل' },
              { value: 'together', label: 'نفس الشبيبة في نفس الغرفة' },
              { value: 'split',    label: 'توزيع نفس الشبيبة على غرف مختلفة' },
            ]}
          />

          <RadioGroup label="موضع المسؤولين"
            value={opts.leader_placement || 'none'}
            onChange={v => updOpts('leader_placement', v)}
            options={[
              { value: 'none',         label: 'بلا تفضيل' },
              { value: 'with_members', label: 'مع أعضاء شبيبتهم' },
              { value: 'alone',        label: 'المسؤولون معاً فقط' },
            ]}
          />

          <RadioGroup label="أسلوب التوزيع"
            value={opts.compactness || 'compact'}
            onChange={v => updOpts('compactness', v)}
            options={[
              { value: 'compact', label: 'تعبئة الغرف (تقليل عدد الغرف)' },
              { value: 'comfort', label: 'توزيع متراحي (أكبر مساحة لكل شخص)' },
            ]}
          />
        </div>
      </div>

      <button onClick={save} disabled={saving}
        className="btn btn-gold"
        style={{ padding: '9px 24px', fontWeight: 700, fontSize: '0.88rem' }}>
        {saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}
      </button>
    </div>
  )
}

function GenderSelect({ value, onChange, label }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '4px 10px', borderRadius: 7, border: '1.5px solid #e2e6ef',
               fontFamily: 'var(--font-body)', fontSize: '0.78rem', outline: 'none', background: 'white' }}>
      <option value="">بلا تقييد</option>
      <option value="male">ذكور فقط</option>
      <option value="female">إناث فقط</option>
    </select>
  )
}

function RadioGroup({ label, value, onChange, options }) {
  return (
    <div>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {options.map(o => (
          <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: value === o.value ? '#0f2744' : '#6b7280', fontWeight: value === o.value ? 700 : 400 }}>
            <input type="radio" name={label} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

// ── NightDropModal ────────────────────────────────────────────────────────────

function NightDropModal({ person, nights, personNights, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(personNights)
  const toggle = (n) => setSelected(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: 14, padding: '22px 26px', minWidth: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', direction: 'rtl' }}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f2744', marginBottom: 6 }}>نقل إلى الغرفة</div>
        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 14 }}>
          حدد الليالي التي سيُنقل فيها <strong>{person?.name}</strong>:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
          {nights.filter(n => personNights.includes(n)).map(n => (
            <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem', color: '#374151', fontWeight: 600 }}>
              <input type="checkbox" checked={selected.includes(n)} onChange={() => toggle(n)} />
              {n}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '7px 16px', borderRadius: 8, border: '1.5px solid #e2e6ef', background: 'white', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem' }}>إلغاء</button>
          <button onClick={() => selected.length && onConfirm(selected)} disabled={!selected.length}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#0f2744', color: 'white', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700 }}>
            نقل
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DistributionTab ───────────────────────────────────────────────────────────

function DistributionTab({ eventId, rooms_flat, config, assignments, registration, nights,
                           onAssignmentsChange, onToggleOccupied, onReload, toast }) {
  const [filterNight, setFilterNight]   = useState(null)
  const [distributing, setDistributing] = useState(false)
  const [clearing,     setClearing]     = useState(false)
  const [dragItem,     setDragItem]     = useState(null)
  const [dragOver,     setDragOver]     = useState(null)
  const [saving,       setSaving]       = useState(null)
  const [pendingDrop,  setPendingDrop]  = useState(null) // {toRoomId, asgn}

  // Build person lookup from registration
  const people = useMemo(() => {
    const map = {}
    for (const rt of ['members', 'supervisors', 'gs_committee', 'guests']) {
      for (const e of (registration?.[rt] || [])) {
        map[String(e.person_id)] = { ...e, reg_type: rt }
      }
    }
    return map
  }, [registration])

  // Group rooms by building > floor
  const buildingGroups = useMemo(() => {
    const bMap = {}
    for (const r of rooms_flat) {
      if (!bMap[r.building_id]) bMap[r.building_id] = { name: r.building_name, id: r.building_id, floors: {} }
      if (!bMap[r.building_id].floors[r.floor_id])
        bMap[r.building_id].floors[r.floor_id] = { name: r.floor_name, id: r.floor_id, rooms: [] }
      bMap[r.building_id].floors[r.floor_id].rooms.push(r)
    }
    return Object.values(bMap).map(b => ({ ...b, floors: Object.values(b.floors) }))
  }, [rooms_flat])

  // Unassigned: has nights but no assignment at all (one reg_id → one assignment)
  const unassigned = useMemo(() => {
    const assignedRegIds = new Set(assignments.map(a => a.reg_id))
    const result = []
    for (const rt of ['guests', 'gs_committee', 'supervisors', 'members']) {
      for (const e of (registration?.[rt] || [])) {
        if (e.attendance_status === 'apologized') continue
        const ns = (e.nights_staying || []).filter(n => nights.includes(n))
        if (!ns.length) continue
        if (!assignedRegIds.has(e.id)) {
          result.push({ ...e, reg_type: rt, effective_nights: ns })
        }
      }
    }
    return result
  }, [assignments, registration, nights])

  const handleDistribute = async (reset) => {
    if (reset && !window.confirm('إعادة التوزيع الكامل؟ سيتم مسح التوزيع الحالي.')) return
    setDistributing(true)
    try {
      const res = await api.autoDistributeBedrooms(eventId, { reset })
      onAssignmentsChange(res.assignments)
      toast(`تم توزيع ${res.count} شخص`, 'success')
    } catch (e) { toast(e?.message || 'تعذّر التوزيع', 'error') }
    finally { setDistributing(false) }
  }

  const handleClear = async () => {
    if (!window.confirm('مسح جميع تعيينات الغرف؟')) return
    setClearing(true)
    try {
      await api.clearBedroomAssignments(eventId)
      onAssignmentsChange([])
      toast('تم المسح', 'success')
    } catch (e) { toast(e?.message || 'تعذّر المسح', 'error') }
    finally { setClearing(false) }
  }

  const handleDragStart = useCallback((e, asgn) => {
    setDragItem(asgn)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  // isNew: person came from the unassigned sidebar (no real backend assignment yet)
  const isNewDrag = (asgn) => !asgn || asgn.room_id === null

  const handleDrop = useCallback((toRoomId) => {
    if (!dragItem) return
    // Same room — no-op
    if (!isNewDrag(dragItem) && dragItem.room_id === toRoomId) {
      setDragItem(null); setDragOver(null); return
    }
    if (filterNight) {
      // Night filter active: move only that night
      if (!isNewDrag(dragItem) && !(dragItem.nights || []).includes(filterNight)) {
        setDragItem(null); setDragOver(null); return
      }
      const nightsToMove = isNewDrag(dragItem)
        ? (dragItem.nights || []).includes(filterNight) ? [filterNight] : dragItem.nights
        : [filterNight]
      doMove(dragItem, toRoomId, nightsToMove)
    } else {
      // No filter: show modal to pick nights (pre-select all)
      setPendingDrop({ toRoomId, asgn: dragItem })
    }
    setDragItem(null)
    setDragOver(null)
  }, [dragItem, filterNight])

  // Moves person to toRoomId for the specified movingNights.
  // Handles three cases:
  //   A) New drag (unassigned) → CREATE assignment
  //   B) All nights → UPDATE room_id only
  //   C) Subset of nights → UPDATE existing (keep remainNights in old room), CREATE new for movingNights
  const doMove = async (asgn, toRoomId, movingNights) => {
    setSaving(asgn.id)
    try {
      if (isNewDrag(asgn)) {
        // Case A: person has no room yet → create
        const res = await api.createBedroomAssignment(eventId, {
          reg_id:      asgn.reg_id,
          person_id:   asgn.person_id,
          reg_type:    asgn.reg_type,
          room_id:     toRoomId,
          nights:      movingNights,
          active_hull: asgn.active_hull || null,
        })
        onAssignmentsChange([...assignments, res.assignment])
      } else if (movingNights.length === (asgn.nights || []).length) {
        // Case B: moving all nights → simple room change
        await api.updateBedroomAssignment(eventId, asgn.id, { room_id: toRoomId })
        onAssignmentsChange(assignments.map(a => a.id === asgn.id ? { ...a, room_id: toRoomId } : a))
      } else {
        // Case C: split nights — update existing to remainNights, create new for movingNights
        const remainNights = (asgn.nights || []).filter(n => !movingNights.includes(n))
        await api.updateBedroomAssignment(eventId, asgn.id, { nights: remainNights })
        const res = await api.createBedroomAssignment(eventId, {
          reg_id:      asgn.reg_id,
          person_id:   asgn.person_id,
          reg_type:    asgn.reg_type,
          room_id:     toRoomId,
          nights:      movingNights,
          active_hull: asgn.active_hull || null,
        })
        onAssignmentsChange(
          assignments.map(a => a.id === asgn.id ? { ...a, nights: remainNights } : a)
                     .concat([res.assignment])
        )
      }
    } catch (e) { toast(e?.message || 'تعذّر النقل', 'error') }
    finally { setSaving(null) }
  }

  // Remove assignment from backend.  Only call for real assignments (not ua_ fake ones).
  const handleUnassign = async (asgn) => {
    if (isNewDrag(asgn)) return   // already unassigned, nothing to delete
    setSaving(asgn.id)
    try {
      await api.deleteBedroomAssignment(eventId, asgn.id)
      onAssignmentsChange(assignments.filter(a => a.id !== asgn.id))
    } catch (e) { toast(e?.message || 'تعذّر إلغاء التعيين', 'error') }
    finally { setSaving(null) }
  }

  const totalAssigned   = assignments.length
  const malesAssigned   = assignments.filter(a => people[a.person_id]?.gender === 'ذكر').length
  const femalesAssigned = assignments.filter(a => people[a.person_id]?.gender === 'أنثى').length

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Top controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => handleDistribute(true)} disabled={distributing || clearing}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#0f2744', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700 }}>
            <RotateCcw size={13} /> {distributing ? 'جارٍ التوزيع...' : 'توزيع تلقائي (الكل)'}
          </button>
          <button onClick={() => handleDistribute(false)} disabled={distributing || clearing}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#f0f4ff', color: '#0f2744', border: '1px solid #c5d8f8', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700 }}>
            <RotateCcw size={13} /> توزيع غير المعيّنين ({unassigned.length})
          </button>
        </div>

        {/* Night filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1px solid #e9ecf3', borderRadius: 8, padding: '5px 10px' }}>
          <Moon size={13} color="#6b7280" />
          <select value={filterNight || ''} onChange={e => setFilterNight(e.target.value || null)}
            style={{ border: 'none', background: 'transparent', fontFamily: 'var(--font-body)', fontSize: '0.8rem', outline: 'none', color: '#374151' }}>
            <option value="">كل الليالي (الافتراضي)</option>
            {nights.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        {filterNight && (
          <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#92400e', padding: '4px 10px', borderRadius: 8, fontWeight: 700 }}>
            السحب يؤثر على «{filterNight}» فقط
          </span>
        )}
        <button onClick={handleClear} disabled={clearing || distributing}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#fff1f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700 }}>
          <Trash2 size={13} /> مسح الكل
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'معيّنون',     value: totalAssigned,   dot: '#86efac' },
          { label: 'غير معيّنين', value: unassigned.length, dot: unassigned.length ? '#fcd34d' : '#d1d5db' },
          { label: 'ذكور',       value: malesAssigned,   dot: '#93c5fd' },
          { label: 'إناث',       value: femalesAssigned, dot: '#c4b5fd' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f8fafc', border: '1px solid #e9ecf3', borderRadius: 8, padding: '5px 12px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600 }}>{s.label}</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f2744' }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Unassigned sidebar — drop here to remove assignment */}
        <div style={{ background: 'white', border: '1.5px dashed #e9ecf3', borderRadius: 12, padding: '12px', minHeight: 80 }}>
          <div style={{ fontWeight: 700, color: '#9ba5bc', fontSize: '0.8rem', marginBottom: 10 }}>
            غير معيّنون ({unassigned.length})
          </div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver('unassigned') }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => {
              e.preventDefault()
              if (dragItem && !isNewDrag(dragItem)) {
                handleUnassign(dragItem)
              }
              setDragItem(null); setDragOver(null)
            }}
            style={{
              minHeight: 40, borderRadius: 8, padding: 4,
              background: dragOver === 'unassigned' ? '#f0f7ff' : 'transparent',
              border: dragOver === 'unassigned' ? '2px dashed #93c5fd' : '2px dashed transparent',
            }}
          >
            {unassigned.map(p => {
              // Fake asgn for dragging: room_id=null signals "new drag" to doMove
              const fakeAsgn = {
                id: `ua_${p.id}`, reg_id: p.id, person_id: String(p.person_id),
                reg_type: p.reg_type, nights: p.effective_nights, room_id: null,
                active_hull: null,
              }
              return (
                <PersonCard key={p.id} asgn={fakeAsgn} person={p} regType={p.reg_type}
                  onDragStart={handleDragStart} isDragging={dragItem?.id === fakeAsgn.id}
                  isSaving={false} compact />
              )
            })}
            {dragOver === 'unassigned' && !isNewDrag(dragItem) && (
              <div style={{ textAlign: 'center', padding: 6, fontSize: '0.72rem', color: '#ef4444', fontWeight: 600 }}>
                إفلت لإلغاء التعيين
              </div>
            )}
          </div>
        </div>

        {/* Rooms grid */}
        <div>
          {buildingGroups.map(bld => (
            <div key={bld.id} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f2744', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Building2 size={14} /> {bld.name}
              </div>
              {bld.floors.map(flr => (
                <div key={flr.id} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 700, marginBottom: 8, paddingRight: 4 }}>{flr.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                    {flr.rooms.map(r => (
                      <RoomCard key={r.room.id}
                        roomEntry={r}
                        assignments={assignments}
                        people={people}
                        nights={nights}
                        filterNight={filterNight}
                        config={config}
                        dragOver={dragOver}
                        onDragOver={setDragOver}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={handleDrop}
                        onDragStart={handleDragStart}
                        dragItem={dragItem}
                        saving={saving}
                        onToggleOccupied={(rid, isOcc) => {
                          const occ = config.occupied_rooms || []
                          const newOcc = isOcc ? [...occ, rid] : occ.filter(x => x !== rid)
                          api.updateBedroomConfig(eventId, { occupied_rooms: newOcc })
                            .then(() => onToggleOccupied(newOcc))
                            .catch(e => toast(e?.message || 'تعذّر', 'error'))
                        }}
                        onSetRoomGender={() => {}}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Night selection modal — shown when no night filter is active */}
      {pendingDrop && (
        <NightDropModal
          person={people[pendingDrop.asgn.person_id]}
          nights={nights}
          personNights={pendingDrop.asgn.nights || []}
          onConfirm={(selectedNights) => {
            const { asgn, toRoomId } = pendingDrop
            setPendingDrop(null)
            doMove(asgn, toRoomId, selectedNights)
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}
    </div>
  )
}

// ── SleepingStatsTab ──────────────────────────────────────────────────────────

function SleepingStatsTab({ assignments, registration, rooms_flat, nights, config }) {
  const people = useMemo(() => {
    const map = {}
    for (const rt of ['members', 'supervisors', 'gs_committee', 'guests']) {
      for (const e of (registration?.[rt] || [])) {
        map[String(e.person_id)] = { ...e, reg_type: rt }
      }
    }
    return map
  }, [registration])

  // Who sleeps which nights
  const nightSleepers = useMemo(() => {
    const map = {}
    for (const n of nights) map[n] = []
    for (const a of assignments) {
      for (const n of (a.nights || [])) {
        if (map[n]) map[n].push(a)
      }
    }
    return map
  }, [assignments, nights])

  // Floor occupancy per night
  const floorNightOcc = useMemo(() => {
    const floorMap = {}
    for (const r of rooms_flat) {
      if (!floorMap[r.floor_id]) floorMap[r.floor_id] = { name: `${r.building_name} › ${r.floor_name}`, nights: {} }
      for (const n of nights) floorMap[r.floor_id].nights[n] = 0
    }
    const roomToFloor = {}
    for (const r of rooms_flat) roomToFloor[r.room.id] = r.floor_id

    for (const a of assignments) {
      const fid = roomToFloor[a.room_id]
      if (!fid || !floorMap[fid]) continue
      for (const n of (a.nights || [])) {
        if (floorMap[fid].nights[n] !== undefined)
          floorMap[fid].nights[n]++
      }
    }
    return Object.entries(floorMap).map(([id, v]) => ({ id, ...v }))
  }, [assignments, rooms_flat, nights])

  // All people who should sleep (have nights_staying) - to find who didn't get assigned
  const allSleepers = useMemo(() => {
    const res = []
    for (const rt of ['members', 'supervisors', 'gs_committee', 'guests']) {
      for (const e of (registration?.[rt] || [])) {
        if (e.attendance_status === 'apologized') continue
        const ns = (e.nights_staying || []).filter(n => nights.includes(n))
        if (ns.length) res.push({ ...e, reg_type: rt, expected_nights: ns })
      }
    }
    return res
  }, [registration, nights])

  const assignedRegIds = useMemo(() => new Set(assignments.map(a => a.reg_id)), [assignments])

  const notAssigned = useMemo(() => allSleepers.filter(p => !assignedRegIds.has(p.id)), [allSleepers, assignedRegIds])

  // YG distribution
  const ygNightMap = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      const p = people[a.person_id]
      if (!p?.youth_group_label) continue
      if (!map[p.youth_group_label]) map[p.youth_group_label] = {}
      for (const n of (a.nights || [])) {
        map[p.youth_group_label][n] = (map[p.youth_group_label][n] || 0) + 1
      }
    }
    return Object.entries(map).map(([yg, nts]) => ({ yg, nights: nts })).sort((a, b) => a.yg.localeCompare(b.yg))
  }, [assignments, people])

  // الأمانة العامة distribution
  const gsNightMap = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (a.reg_type !== 'gs_committee') continue
      const p = people[a.person_id]
      const hull = a.active_hull || (p?.hulls?.[0]) || 'أخرى'
      if (!map[hull]) map[hull] = {}
      for (const n of (a.nights || [])) {
        map[hull][n] = (map[hull][n] || 0) + 1
      }
    }
    return Object.entries(map).map(([hull, nts]) => ({ hull, nights: nts })).sort((a, b) => a.hull.localeCompare(b.hull))
  }, [assignments, people])

  const cellStyle = { padding: '6px 10px', fontSize: '0.78rem', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }
  const hStyle = { padding: '6px 10px', fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 700, background: '#f8fafc', textAlign: 'center' }

  return (
    <div style={{ direction: 'rtl', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Per-night count */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 14 }}>النائمون في كل ليلة</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {nights.map(n => (
            <div key={n} style={{ background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '1.1rem' }}>{nightSleepers[n]?.length || 0}</div>
              <div style={{ fontSize: '0.72rem', color: '#4a6fa5', fontWeight: 600, marginTop: 2 }}>{n}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Floor breakdown */}
      {floorNightOcc.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 14 }}>توزيع الأدوار</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...hStyle, textAlign: 'right' }}>الدور</th>
                {nights.map(n => <th key={n} style={hStyle}>{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {floorNightOcc.map(f => (
                <tr key={f.id}>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: '#0f2744' }}>{f.name}</td>
                  {nights.map(n => (
                    <td key={n} style={cellStyle}>
                      <span style={{ fontWeight: 700, color: f.nights[n] ? '#0f2744' : '#d1d5db' }}>{f.nights[n] || 0}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* YG distribution */}
      {ygNightMap.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 14 }}>توزيع الشبيبات (ليلة بليلة)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...hStyle, textAlign: 'right' }}>الشبيبة</th>
                {nights.map(n => <th key={n} style={hStyle}>{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {ygNightMap.map(({ yg, nights: nts }) => (
                <tr key={yg}>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: '#0f2744' }}>{yg}</td>
                  {nights.map(n => (
                    <td key={n} style={cellStyle}>
                      <span style={{ fontWeight: 700, color: nts[n] ? '#0f2744' : '#d1d5db' }}>{nts[n] || 0}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GS committee distribution */}
      {gsNightMap.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 14 }}>توزيع الأمانة العامة واللجان</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...hStyle, textAlign: 'right' }}>الفوج</th>
                {nights.map(n => <th key={n} style={hStyle}>{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {gsNightMap.map(({ hull, nights: nts }) => (
                <tr key={hull}>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600, color: '#0f2744' }}>{hull}</td>
                  {nights.map(n => (
                    <td key={n} style={cellStyle}>
                      <span style={{ fontWeight: 700, color: nts[n] ? '#0f2744' : '#d1d5db' }}>{nts[n] || 0}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Not assigned */}
      {notAssigned.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #fecaca', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontWeight: 800, color: '#dc2626', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={16} /> غير معيّنون ({notAssigned.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {notAssigned.map(p => (
              <div key={p.id} style={{ padding: '7px 10px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f2744' }}>{p.name || p.person_id}</div>
                <div style={{ fontSize: '0.67rem', color: '#9ba5bc' }}>
                  {REG_TYPE_LABELS[p.reg_type]} · {p.expected_nights.join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CampStatsTab ──────────────────────────────────────────────────────────────

function CampStatsTab({ registration, nights, assignments }) {
  const REG_TYPES = ['members', 'supervisors', 'gs_committee', 'guests']

  const stats = useMemo(() => {
    const assignedRegIds = new Set(assignments.map(a => a.reg_id))
    return REG_TYPES.map(rt => {
      const all = (registration?.[rt] || []).filter(e => e.attendance_status !== 'apologized')
      const sleeping = all.filter(e => (e.nights_staying || []).some(n => nights.includes(n)))
      const males   = all.filter(e => e.gender === 'ذكر')
      const females = all.filter(e => e.gender === 'أنثى')
      const slpMale = sleeping.filter(e => e.gender === 'ذكر')
      const slpFem  = sleeping.filter(e => e.gender === 'أنثى')
      const assigned = sleeping.filter(e => assignedRegIds.has(e.id))
      return { rt, total: all.length, sleeping: sleeping.length, males: males.length, females: females.length,
               slpMale: slpMale.length, slpFem: slpFem.length, assigned: assigned.length }
    })
  }, [registration, nights, assignments])

  const totals = useMemo(() => stats.reduce((acc, s) => ({
    total: acc.total + s.total, sleeping: acc.sleeping + s.sleeping,
    males: acc.males + s.males, females: acc.females + s.females,
    slpMale: acc.slpMale + s.slpMale, slpFem: acc.slpFem + s.slpFem,
    assigned: acc.assigned + s.assigned,
  }), { total: 0, sleeping: 0, males: 0, females: 0, slpMale: 0, slpFem: 0, assigned: 0 }), [stats])

  const hStyle = { padding: '8px 12px', fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 700, background: '#f8fafc', textAlign: 'center', borderBottom: '1px solid #e9ecf3' }
  const cStyle = { padding: '8px 12px', fontSize: '0.8rem', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }

  return (
    <div style={{ direction: 'rtl', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Category breakdown */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 14 }}>توزيع الفئات</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...hStyle, textAlign: 'right' }}>الفئة</th>
              <th style={hStyle}>الإجمالي</th>
              <th style={hStyle}>ذكور</th>
              <th style={hStyle}>إناث</th>
              <th style={hStyle}>نائمون</th>
              <th style={hStyle}>ذكور ن.</th>
              <th style={hStyle}>إناث ن.</th>
              <th style={hStyle}>معيّنون</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.rt}>
                <td style={{ ...cStyle, textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, color: REG_TYPE_COLORS[s.rt]?.text || '#0f2744',
                                background: REG_TYPE_COLORS[s.rt]?.bg || '#f1f5f9',
                                padding: '2px 8px', borderRadius: 8, fontSize: '0.75rem' }}>
                    {REG_TYPE_LABELS[s.rt]}
                  </span>
                </td>
                <td style={{ ...cStyle, fontWeight: 800, color: '#0f2744' }}>{s.total}</td>
                <td style={{ ...cStyle, color: '#1d4ed8' }}>{s.males}</td>
                <td style={{ ...cStyle, color: '#9333ea' }}>{s.females}</td>
                <td style={{ ...cStyle, fontWeight: 700 }}>{s.sleeping}</td>
                <td style={{ ...cStyle, color: '#1d4ed8' }}>{s.slpMale}</td>
                <td style={{ ...cStyle, color: '#9333ea' }}>{s.slpFem}</td>
                <td style={{ ...cStyle, color: s.assigned === s.sleeping ? '#15803d' : '#dc2626', fontWeight: 700 }}>
                  {s.assigned}/{s.sleeping}
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f8fafc' }}>
              <td style={{ ...cStyle, textAlign: 'right', fontWeight: 800, color: '#0f2744' }}>المجموع</td>
              <td style={{ ...cStyle, fontWeight: 800, color: '#0f2744' }}>{totals.total}</td>
              <td style={{ ...cStyle, fontWeight: 700, color: '#1d4ed8' }}>{totals.males}</td>
              <td style={{ ...cStyle, fontWeight: 700, color: '#9333ea' }}>{totals.females}</td>
              <td style={{ ...cStyle, fontWeight: 800 }}>{totals.sleeping}</td>
              <td style={{ ...cStyle, fontWeight: 700, color: '#1d4ed8' }}>{totals.slpMale}</td>
              <td style={{ ...cStyle, fontWeight: 700, color: '#9333ea' }}>{totals.slpFem}</td>
              <td style={{ ...cStyle, fontWeight: 800, color: totals.assigned === totals.sleeping ? '#15803d' : '#dc2626' }}>
                {totals.assigned}/{totals.sleeping}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Night attendance */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 14 }}>حضور الليالي بالفئة</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...hStyle, textAlign: 'right' }}>الفئة</th>
              {nights.map(n => <th key={n} style={hStyle}>{n}</th>)}
            </tr>
          </thead>
          <tbody>
            {REG_TYPES.map(rt => {
              const entries = (registration?.[rt] || []).filter(e => e.attendance_status !== 'apologized')
              return (
                <tr key={rt}>
                  <td style={{ ...cStyle, textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: REG_TYPE_COLORS[rt]?.text || '#0f2744',
                                  background: REG_TYPE_COLORS[rt]?.bg || '#f1f5f9',
                                  padding: '2px 8px', borderRadius: 8, fontSize: '0.75rem' }}>
                      {REG_TYPE_LABELS[rt]}
                    </span>
                  </td>
                  {nights.map(n => {
                    const cnt = entries.filter(e => (e.nights_staying || []).includes(n)).length
                    return <td key={n} style={{ ...cStyle, fontWeight: 700, color: cnt ? '#0f2744' : '#d1d5db' }}>{cnt}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main EventBedrooms ────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: 'setup',          label: 'الإعداد',           icon: Settings },
  { id: 'distribution',   label: 'التوزيع',           icon: BedDouble },
  { id: 'sleeping_stats', label: 'إحصائيات النوم',    icon: Moon },
  { id: 'camp_stats',     label: 'إحصائيات المخيم',  icon: BarChart2 },
]

export default function EventBedrooms({ eventId, event, onRefresh, toast }) {
  const [subTab,         setSubTab]         = useState('setup')
  const [loading,        setLoading]        = useState(true)
  const [data,           setData]           = useState(null)  // {config, assignments, rooms_flat, nights, registration}
  const [downloadingDocx, setDownloadingDocx] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getEventBedroom(eventId)
      setData(res)
    } catch (e) { toast(e?.message || 'تعذّر تحميل بيانات المنامات', 'error') }
    finally { setLoading(false) }
  }, [eventId])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
  if (!data) return <div style={{ padding: 40, color: '#e53e3e' }}>تعذّر تحميل بيانات المنامات.</div>

  const { config, assignments, rooms_flat, nights, registration } = data

  if (!rooms_flat.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12, direction: 'rtl' }}>
      <BedDouble size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
      <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لم يتم ربط موقع تخييم بهذا المخيم</div>
      <div style={{ fontSize: '0.76rem', marginTop: 6 }}>اضف موقعاً من تبويب المعلومات ثم تأكد من أن الموقع يحتوي على مبانٍ وغرف.</div>
    </div>
  )

  if (!nights.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12, direction: 'rtl' }}>
      <Moon size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
      <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لا توجد ليالٍ محددة لهذا المخيم</div>
    </div>
  )

  const handleDownloadBedrooms = async () => {
    if (!data) return
    setDownloadingDocx(true)
    try {
      await downloadBedroomsDocx(data.rooms_flat, data.assignments, data.registration)
    } catch (e) { toast(e?.message || 'تعذّر إنشاء الملف', 'error') }
    finally { setDownloadingDocx(false) }
  }

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid #e2e6ef', marginBottom: 20, overflowX: 'auto', alignItems: 'center' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '7px 14px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
              fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
              background: 'none', color: subTab === t.id ? '#0f2744' : '#9ba5bc',
              borderBottom: `2px solid ${subTab === t.id ? '#0f2744' : 'transparent'}`, marginBottom: -2, transition: '0.15s',
            }}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleDownloadBedrooms}
          disabled={downloadingDocx || !data?.assignments?.length}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', border: '1px solid #c5d8f8', borderRadius: 8,
            background: '#f0f4ff', color: '#1d4ed8', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700,
            opacity: !data?.assignments?.length ? 0.45 : 1,
            marginBottom: 2,
          }}
        >
          <Download size={13} />
          {downloadingDocx ? 'جارٍ...' : 'تنزيل توزيع المنامات'}
        </button>
      </div>

      {subTab === 'setup' && (
        <SetupTab
          eventId={eventId}
          rooms_flat={rooms_flat}
          config={config}
          registration={registration}
          onConfigChange={newCfg => setData(d => ({ ...d, config: newCfg }))}
          toast={toast}
        />
      )}

      {subTab === 'distribution' && (
        <DistributionTab
          eventId={eventId}
          rooms_flat={rooms_flat}
          config={config}
          assignments={assignments}
          registration={registration}
          nights={nights}
          onAssignmentsChange={newAsgns => setData(d => ({ ...d, assignments: newAsgns }))}
          onToggleOccupied={newOcc => setData(d => ({ ...d, config: { ...d.config, occupied_rooms: newOcc } }))}
          onReload={load}
          toast={toast}
        />
      )}

      {subTab === 'sleeping_stats' && (
        <SleepingStatsTab
          assignments={assignments}
          registration={registration}
          rooms_flat={rooms_flat}
          nights={nights}
          config={config}
        />
      )}

      {subTab === 'camp_stats' && (
        <CampStatsTab
          registration={registration}
          nights={nights}
          assignments={assignments}
        />
      )}
    </div>
  )
}
