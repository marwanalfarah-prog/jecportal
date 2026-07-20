import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx-js-style'
import { Bus, Users, UserCheck, Download, Save, Coins } from 'lucide-react'
import { api } from '../api.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAttendanceApologized(entry) {
  return entry?.attendance_status === 'apologized'
}

const UNKNOWN_GOV = 'غير محددة'

function shortYgName(label) {
  if (!label || label === '—') return label
  const idx = label.lastIndexOf(' - ')
  return idx !== -1 ? label.slice(idx + 3) : label.replace(/^شبيبة\s+/, '')
}

const amountInputStyle = {
  width: 90, padding: '6px 10px', border: '1.5px solid #e2e6ef', borderRadius: 8,
  fontFamily: 'var(--font-body)', fontSize: '0.85rem', textAlign: 'center',
  outline: 'none', boxSizing: 'border-box', direction: 'ltr',
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function EventTransportSupport({ eventId, event, onRefresh, toast }) {
  const [youthGroups, setYouthGroups] = useState([])
  const [loadingYgs,  setLoadingYgs]  = useState(true)
  const [saving,      setSaving]      = useState(false)

  const initial = event.transport_support || {}
  const [includeParticipants, setIncludeParticipants] = useState(initial.include_participants ?? true)
  const [includeSupervisors,  setIncludeSupervisors]  = useState(initial.include_supervisors  ?? false)
  const [amounts, setAmounts] = useState(() =>
    Object.fromEntries(Object.entries(initial.amounts || {}).map(([k, v]) => [k, String(v)]))
  )

  useEffect(() => {
    api.listYouthGroupProfiles()
      .then(d => { setYouthGroups(d.groups || d.youth_groups || []); setLoadingYgs(false) })
      .catch(() => setLoadingYgs(false))
  }, [])

  // Re-sync when the event's saved config changes (e.g. after refresh)
  useEffect(() => {
    const ts = event.transport_support || {}
    setIncludeParticipants(ts.include_participants ?? true)
    setIncludeSupervisors(ts.include_supervisors ?? false)
    setAmounts(Object.fromEntries(Object.entries(ts.amounts || {}).map(([k, v]) => [k, String(v)])))
  }, [event.transport_support])

  // group_id → { governorate, group_name }
  const ygMeta = useMemo(() => {
    const map = {}
    for (const yg of youthGroups) {
      map[yg.group_id] = {
        governorate: yg.governorate || UNKNOWN_GOV,
        group_name:  yg.group_name || yg.group_id,
      }
    }
    return map
  }, [youthGroups])

  // Confirmed, non-apologized participants and non-apologized supervisors
  const members = useMemo(
    () => (event.registration?.members || [])
      .filter(m => (m.confirmation_status || 'confirmed') === 'confirmed' && !isAttendanceApologized(m)),
    [event.registration]
  )
  const supers = useMemo(
    () => (event.registration?.supervisors || []).filter(s => !isAttendanceApologized(s)),
    [event.registration]
  )

  // Per youth group: participant + supervisor counts, governorate, name
  const groupRows = useMemo(() => {
    const rows = {}
    const ensure = (ygId, label) => {
      if (!rows[ygId]) {
        const meta = ygMeta[ygId] || {}
        rows[ygId] = {
          group_id:    ygId,
          group_name:  meta.group_name || label || ygId || UNKNOWN_GOV,
          governorate: meta.governorate || UNKNOWN_GOV,
          participants: 0,
          supervisors:  0,
        }
      }
      return rows[ygId]
    }
    for (const m of members) {
      const ygId = m.youth_group_id || `__label__${m.youth_group_label || 'غير محددة'}`
      ensure(ygId, m.youth_group_label).participants += 1
    }
    for (const s of supers) {
      const ygId = s.youth_group_id || `__label__${s.youth_group_label || 'غير محددة'}`
      ensure(ygId, s.youth_group_label).supervisors += 1
    }
    return Object.values(rows)
      .filter(r => r.participants > 0 || r.supervisors > 0)
      .sort((a, b) =>
        a.governorate.localeCompare(b.governorate, 'ar') ||
        a.group_name.localeCompare(b.group_name, 'ar'))
  }, [members, supers, ygMeta])

  // Governorates present among participating youth groups
  const governorates = useMemo(() => {
    const set = new Set(groupRows.map(r => r.governorate))
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'))
  }, [groupRows])

  const amountFor = useCallback((gov) => {
    const n = parseFloat(amounts[gov])
    return isNaN(n) ? 0 : n
  }, [amounts])

  const countedFor = useCallback((row) =>
    (includeParticipants ? row.participants : 0) + (includeSupervisors ? row.supervisors : 0),
    [includeParticipants, includeSupervisors]
  )

  // Enrich rows with computed totals
  const computed = useMemo(() => groupRows.map(r => {
    const perPerson = amountFor(r.governorate)
    const counted   = countedFor(r)
    return { ...r, perPerson, counted, total: counted * perPerson }
  }), [groupRows, amountFor, countedFor])

  const totals = useMemo(() => ({
    participants: computed.reduce((s, r) => s + r.participants, 0),
    supervisors:  computed.reduce((s, r) => s + r.supervisors, 0),
    counted:      computed.reduce((s, r) => s + r.counted, 0),
    grand:        computed.reduce((s, r) => s + r.total, 0),
  }), [computed])

  const handleSave = async () => {
    setSaving(true)
    try {
      const cleanAmounts = {}
      for (const gov of governorates) {
        const n = parseFloat(amounts[gov])
        if (!isNaN(n) && n >= 0) cleanAmounts[gov] = n
      }
      await api.updateEvent(eventId, {
        transport_support: {
          include_participants: includeParticipants,
          include_supervisors:  includeSupervisors,
          amounts: cleanAmounts,
        },
      })
      toast('تم حفظ دعم المواصلات', 'success')
      onRefresh()
    } catch (e) {
      toast(e?.message || 'تعذّر الحفظ', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDownloadXlsx = () => {
    const headers = ['الشبيبة', 'المحافظة', 'المشاركون', 'المسؤولون', 'العدد المحتسب', 'الدعم للفرد (د.أ)', 'الإجمالي (د.أ)']
    const rows = computed.map(r => ({
      'الشبيبة':          r.group_name,
      'المحافظة':         r.governorate,
      'المشاركون':        r.participants,
      'المسؤولون':        r.supervisors,
      'العدد المحتسب':    r.counted,
      'الدعم للفرد (د.أ)': r.perPerson,
      'الإجمالي (د.أ)':    r.total,
    }))
    rows.push({
      'الشبيبة': 'الإجمالي العام', 'المحافظة': '', 'المشاركون': totals.participants,
      'المسؤولون': totals.supervisors, 'العدد المحتسب': totals.counted,
      'الدعم للفرد (د.أ)': '', 'الإجمالي (د.أ)': totals.grand,
    })

    const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
    ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 16 }, { wch: 15 }]
    const numCols = headers.length
    const numRows = rows.length + 1

    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: '' }
      ws[addr].s = {
        fill: { patternType: 'solid', fgColor: { rgb: '0F2744' } },
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        alignment: { horizontal: 'center' },
      }
    }
    // Total row bold
    for (let c = 0; c < numCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: numRows - 1, c })
      if (!ws[addr]) ws[addr] = { t: 's', v: '' }
      ws[addr].s = {
        fill: { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } },
        font: { bold: true, color: { rgb: '92400E' } },
        alignment: { horizontal: c === 0 ? 'right' : 'center' },
      }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Transport Support')
    XLSX.writeFile(wb, `event-transport-support-${eventId}.xlsx`)
  }

  if (loadingYgs) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>

  const noneSelected = !includeParticipants && !includeSupervisors

  return (
    <div style={{ direction: 'rtl' }}>

      {/* ── Controls row ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 10, padding: '8px 14px' }}>
          <Bus size={15} color="#1d4ed8" />
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f2744' }}>احتساب الدعم لـ:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.82rem', color: '#0f2744', fontWeight: 600 }}>
            <input type="checkbox" checked={includeParticipants} onChange={e => setIncludeParticipants(e.target.checked)} />
            <Users size={13} /> المشاركون
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.82rem', color: '#0f2744', fontWeight: 600 }}>
            <input type="checkbox" checked={includeSupervisors} onChange={e => setIncludeSupervisors(e.target.checked)} />
            <UserCheck size={13} /> المسؤولون
          </label>
        </div>

        <div style={{ flex: 1 }} />

        <button onClick={handleDownloadXlsx} disabled={computed.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', border: '1px solid #c5d8f8', borderRadius: 8, background: '#f0f4ff', color: '#1d4ed8', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700, opacity: computed.length === 0 ? 0.45 : 1 }}>
          <Download size={13} /> تنزيل الجدول
        </button>
        <button onClick={handleSave} disabled={saving} className="btn btn-gold"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 18px', fontWeight: 700, fontSize: '0.82rem' }}>
          <Save size={14} /> {saving ? 'جارٍ الحفظ...' : 'حفظ'}
        </button>
      </div>

      {noneSelected && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.8rem', color: '#92400e', fontWeight: 600 }}>
          اختر المشاركين و/أو المسؤولين لاحتساب الدعم.
        </div>
      )}

      {/* ── Summary stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          { label: 'الشبيبات', value: computed.length, dot: '#93c5fd' },
          { label: 'المشاركون', value: totals.participants, dot: '#86efac' },
          { label: 'المسؤولون', value: totals.supervisors, dot: '#c4b5fd' },
          { label: 'العدد المحتسب', value: totals.counted, dot: '#fcd34d' },
          { label: 'إجمالي الدعم (د.أ)', value: totals.grand.toLocaleString('en-US', { maximumFractionDigits: 2 }), dot: '#c9963c', wide: true },
        ].map(({ label, value, dot }) => (
          <div key={label} style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 10, padding: '12px 14px', textAlign: 'center', boxShadow: '0 1px 4px rgba(15,39,68,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f2744', marginBottom: 2, direction: 'ltr' }}>{value}</div>
            <div style={{ fontSize: '0.67rem', color: '#9ba5bc', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Per-governorate amounts ── */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <Coins size={16} color="#c9963c" />
          <span style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.9rem' }}>مبلغ الدعم لكل محافظة (دينار أردني للفرد)</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 14 }}>
          يُطبَّق نفس المبلغ لكل مشارك ومسؤول من شبيبة تقع ضمن المحافظة.
        </div>
        {governorates.length === 0 ? (
          <div style={{ color: '#9ba5bc', fontSize: '0.82rem' }}>لا توجد شبيبات مشاركة في هذا النشاط بعد.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {governorates.map(gov => (
              <div key={gov} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e9ecf3', borderRadius: 9 }}>
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 700, color: gov === UNKNOWN_GOV ? '#9ba5bc' : '#0f2744' }}>{gov}</span>
                <input
                  type="number" min="0" step="0.5"
                  value={amounts[gov] ?? ''}
                  placeholder="0"
                  onChange={e => setAmounts(prev => ({ ...prev, [gov]: e.target.value }))}
                  style={amountInputStyle}
                />
                <span style={{ fontSize: '0.72rem', color: '#9ba5bc', fontWeight: 600 }}>د.أ</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Results table ── */}
      {computed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <Bus size={30} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لا توجد شبيبات مشاركة بعد</div>
        </div>
      ) : (
        <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,39,68,0.04)' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.7fr 0.7fr 0.9fr 1fr', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #edf0f7' }}>
            {[
              { label: 'الشبيبة', align: 'right' },
              { label: 'المحافظة', align: 'right' },
              { label: 'مشاركون', align: 'center' },
              { label: 'مسؤولون', align: 'center' },
              { label: 'للفرد (د.أ)', align: 'center' },
              { label: 'الإجمالي (د.أ)', align: 'center' },
            ].map(({ label, align }) => (
              <div key={label} style={{ fontSize: '0.66rem', fontWeight: 700, color: '#94a3b8', textAlign: align }}>{label}</div>
            ))}
          </div>

          {computed.map((r, i) => (
            <div key={r.group_id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.7fr 0.7fr 0.9fr 1fr', padding: '10px 16px', background: i % 2 ? '#f8fafc' : 'white', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortYgName(r.group_name)}</div>
              <div style={{ fontSize: '0.8rem', color: r.governorate === UNKNOWN_GOV ? '#c5cdd8' : '#4a5568' }}>{r.governorate}</div>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', color: includeParticipants ? '#15803d' : '#c5cdd8' }}>{r.participants}</div>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', color: includeSupervisors ? '#7c3aed' : '#c5cdd8' }}>{r.supervisors}</div>
              <div style={{ textAlign: 'center', fontSize: '0.82rem', color: r.perPerson > 0 ? '#0f2744' : '#c5cdd8', direction: 'ltr' }}>{r.perPerson || '—'}</div>
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.88rem', color: r.total > 0 ? '#c9963c' : '#c5cdd8', direction: 'ltr' }}>
                {r.total ? r.total.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.7fr 0.7fr 0.9fr 1fr', padding: '11px 16px', background: '#fffbeb', borderTop: '2px solid #fde68a', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, color: '#92400e', fontSize: '0.85rem' }}>الإجمالي العام</div>
            <div />
            <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.85rem', color: '#92400e' }}>{totals.participants}</div>
            <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '0.85rem', color: '#92400e' }}>{totals.supervisors}</div>
            <div />
            <div style={{ textAlign: 'center', fontWeight: 900, fontSize: '0.95rem', color: '#92400e', direction: 'ltr' }}>
              {totals.grand.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
