import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, Trash2, Plus, X, ChevronDown, ChevronUp, Shield, User, TrendingUp, CheckCircle, Users, GitBranch, UserCheck, FolderOpen } from 'lucide-react'
import { api } from '../api.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIV_LABELS = {
  profile_access:          'الوصول للملفات الشخصية',
  promotion_access:        'صلاحية الترفيع',
  yg_registration_approval:'الموافقة على تسجيل الشبيبة',
  yg_file_access:          'الوصول لملف الفرقة',
}

const PRIV_ICONS = {
  profile_access:          UserCheck,
  promotion_access:        TrendingUp,
  yg_registration_approval:CheckCircle,
  yg_file_access:          FolderOpen,
}

const PRIV_COLORS = {
  profile_access:          { bg: '#eef4ff', border: '#c5d8f8', text: '#1a56db' },
  promotion_access:        { bg: '#f0fdf4', border: '#86efac', text: '#16a34a' },
  yg_registration_approval:{ bg: '#fffbeb', border: '#fde68a', text: '#b45309' },
  yg_file_access:          { bg: '#fdf4ff', border: '#e9d5ff', text: '#7c3aed' },
}

const ALL_PRIV_TYPES = ['profile_access', 'promotion_access', 'yg_registration_approval', 'yg_file_access']

const GRANTEE_TYPE_LABELS = {
  org_tree_position: 'موقع في الهيكل التنظيمي',
  gen_sec_position:  'موقع في الأمانة العامة',
  specific_person:   'شخص محدد',
}

const SELECTION_MODE_LABELS = {
  all:       'جميع المواقع',
  positions: 'مواقع محددة',
  hull:      'هيكل (Hull) محدد',
}

const SCOPE_TYPE_LABELS = {
  org_tree_descendants: 'وصول التابعين في الهيكل',
  all:         'جميع الأعضاء',
  youth_group: 'فرقة شبيبة محددة',
  age_group:   'فئة عمرية محددة',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scopeLabel(scope, youthGroups) {
  if (!scope) return '—'
  if (scope.type === 'all') return 'جميع الأعضاء'

  // Support legacy single-value and new array format
  const ygIds = scope.youth_group_ids?.length ? scope.youth_group_ids : (scope.youth_group_id ? [scope.youth_group_id] : [])
  const ygNames = ygIds.map(id => {
    const yg = youthGroups.find(g => g.id === id)
    return yg ? (yg.short_name || yg.name) : id
  })
  const ygStr = ygNames.join('، ') || '—'

  if (scope.type === 'youth_group') return ygStr
  if (scope.type === 'org_tree_descendants') return `${ygStr} - التابعون في الهيكل`

  const ags = scope.age_groups?.length ? scope.age_groups : (scope.age_group ? [scope.age_group] : [])
  return `${ygStr} — ${ags.join('، ') || '—'}`
}

function granteeLabel(grantee, youthGroups) {
  if (!grantee) return '—'
  const { type, youth_group_id, youth_group_ids, selection_mode, positions, hull_display, selected_hulls, person_name, person_id } = grantee
  const yg = youthGroups.find(g => g.id === youth_group_id)
  const ygName = yg ? (yg.short_name || yg.name) : youth_group_id

  if (type === 'specific_person') return person_name || '—'

  if (type === 'org_tree_descendants') {
    const ids = youth_group_ids?.length ? youth_group_ids : (youth_group_id ? [youth_group_id] : [])
    const names = ids.map(id => {
      const group = youthGroups.find(g => g.id === id)
      return group ? (group.short_name || group.name) : id
    })
    return `وصول التابعين في الهيكل - ${names.join('، ') || '-'}`
  }

  // hull_display is pre-computed on submission (comma-joined); selected_hulls is live UI state
  const hullLabel = hull_display
    || (selected_hulls?.length ? selected_hulls.map(h => h.hull_display || h.hull).join('، ') : 'هيكل محدد')

  const modeStr =
    selection_mode === 'all' ? 'جميع المواقع' :
    selection_mode === 'positions' ? (positions?.join('، ') || 'مواقع محددة') :
    selection_mode === 'hull' ? hullLabel : ''

  if (type === 'gen_sec_position') return `الأمانة العامة — ${modeStr}`
  return `${ygName || 'فرقة'} — ${modeStr}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ar-JO', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

function newGrantee() {
  return { _key: Math.random(), type: 'specific_person', person_id: null, person_name: '', youth_group_id: '', selection_mode: 'all', positions: [], selected_hulls: [] }
}

// Unique key for a hull instance (handles duplicate names)
function hullInstanceKey(h) {
  return h.instance_node_ids?.length ? h.instance_node_ids.join(',') : h.hull
}

// Display label for a hull instance (adds parent context when names collide)
function hullInstanceLabel(h) {
  return h.parent_info ? `${h.hull} — ${h.parent_info.display}` : h.hull
}

function uniqueHullMembers(members) {
  const seen = new Set()
  return (members || []).filter(m => {
    const key = m?.person_id || `${m?.person_name || ''}|${m?.role || ''}`
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hullSelectionPayload(h) {
  return {
    key: h.key || hullInstanceKey(h),
    hull: h.hull,
    instance_node_ids: h.instance_node_ids || [],
    hull_display: h.hull_display || hullInstanceLabel(h),
  }
}

function buildHullSelectionOptions(hulls = []) {
  const byHull = new Map()
  hulls.forEach(h => {
    const key = h.hull || ''
    if (!key) return
    if (!byHull.has(key)) byHull.set(key, [])
    byHull.get(key).push(h)
  })

  return Array.from(byHull.values()).map(group => {
    if (group.length === 1) {
      const h = group[0]
      return {
        ...hullSelectionPayload(h),
        members: h.members || [],
        head_count: h.parent_info ? 1 : 0,
      }
    }

    const nodeIds = Array.from(new Set(
      group.flatMap(h => h.instance_node_ids || [])
    )).sort()

    return {
      key: nodeIds.length ? nodeIds.join(',') : group.map(hullInstanceKey).join('|'),
      hull: group[0].hull,
      instance_node_ids: nodeIds,
      hull_display: group[0].hull,
      members: uniqueHullMembers(group.flatMap(h => h.members || [])),
      head_count: group.filter(h => h.parent_info).length || group.length,
    }
  })
}

// ── Multi-select header (select all / clear all / custom indicator) ───────────

function MultiSelectHeader({ total, selectedCount, onSelectAll, onClearAll }) {
  const allSel  = total > 0 && selectedCount === total
  const noneSel = selectedCount === 0
  const custom  = !allSel && !noneSel

  const btnBase = { fontSize: '0.75rem', padding: '3px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, transition: '0.12s' }

  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 7, alignItems: 'center' }}>
      <button onClick={onSelectAll}
        style={{ ...btnBase, border: `1px solid ${allSel ? '#0f2744' : '#e2e6ef'}`, background: allSel ? '#0f2744' : 'white', color: allSel ? 'white' : '#4a5568' }}>
        اختر الكل
      </button>
      <button onClick={onClearAll}
        style={{ ...btnBase, border: `1px solid ${noneSel ? '#e2e6ef' : '#e2e6ef'}`, background: 'white', color: noneSel ? '#9ba5bc' : '#6b7280' }}>
        مسح الكل
      </button>
      <span style={{ fontSize: '0.75rem', color: custom ? '#b45309' : '#9ba5bc', fontWeight: custom ? 700 : 400, marginRight: 2 }}>
        {custom ? `مخصص — ${selectedCount} / ${total}` : `${selectedCount} / ${total}`}
      </span>
    </div>
  )
}

// ── Person search autocomplete ────────────────────────────────────────────────

function PersonPicker({ value, onChange, placeholder = 'ابحث باسم الشخص…' }) {
  const [query, setQuery] = useState(value?.person_name || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (value?.person_name) setQuery(value.person_name)
  }, [value?.person_name])

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleInput = (e) => {
    const q = e.target.value
    setQuery(q)
    onChange({ person_id: null, person_name: q })
    clearTimeout(timerRef.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.searchPrivilegePersons(q)
        setResults(res.persons || [])
        setOpen(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
  }

  const select = (p) => {
    setQuery(p.name)
    onChange({ person_id: p.person_id, person_name: p.name })
    setOpen(false)
    setResults([])
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc', pointerEvents: 'none' }} />
        <input
          value={query}
          onChange={handleInput}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          style={{ width: '100%', padding: '8px 32px 8px 10px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', outline: 'none', boxSizing: 'border-box' }}
        />
        {loading && <div className="spinner" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14 }} />}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: 'white', border: '1.5px solid #e2e6ef', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 200, maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
          {results.map(p => (
            <button key={p.person_id} onClick={() => select(p)} style={{ width: '100%', padding: '9px 14px', textAlign: 'right', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', borderBottom: '1px solid #f5f6fa', display: 'flex', flexDirection: 'column', gap: 2 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f7f9ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <span style={{ fontWeight: 600, color: '#1a2a3a' }}>{p.name}</span>
              {p.en_name && <span style={{ fontSize: '0.75rem', color: '#9ba5bc' }}>{p.en_name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Grantee block ─────────────────────────────────────────────────────────────

function GranteeBlock({ grantee, index, onUpdate, onRemove, youthGroups, positionsCache, onLoadPositions }) {
  const { type, youth_group_id, selection_mode, positions, hull } = grantee
  const posKey = type === 'gen_sec_position' ? 'GS' : youth_group_id
  const posData = positionsCache[posKey] || null
  const loadingPos = positionsCache[posKey + '__loading']

  useEffect(() => {
    if (type === 'gen_sec_position' && !positionsCache['GS'] && !positionsCache['GS__loading']) {
      onLoadPositions('GS')
    }
  }, [type])

  useEffect(() => {
    if (type === 'org_tree_position' && youth_group_id && !positionsCache[youth_group_id] && !positionsCache[youth_group_id + '__loading']) {
      onLoadPositions(youth_group_id)
    }
  }, [type, youth_group_id])

  const update = (patch) => onUpdate(index, patch)

  return (
    <div style={{ border: '1.5px solid #e2e6ef', borderRadius: 10, padding: '14px 16px', background: '#fafbfd', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f2744' }}>مجموعة {index + 1}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2, display: 'flex' }} title="حذف المجموعة"><X size={15} /></button>
      </div>

      {/* Type selector */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>نوع المستفيد</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(GRANTEE_TYPE_LABELS).map(([val, lbl]) => (
            <button key={val} onClick={() => update({ type: val, positions: [], selected_hulls: [], youth_group_id: '', person_id: null, person_name: '' })}
              style={{ padding: '6px 12px', borderRadius: 20, border: `1.5px solid ${type === val ? '#0f2744' : '#e2e6ef'}`, background: type === val ? '#0f2744' : 'white', color: type === val ? 'white' : '#4a5568', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: type === val ? 700 : 400 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* specific_person */}
      {type === 'specific_person' && (
        <div>
          <label style={labelStyle}>الشخص</label>
          <PersonPicker
            value={{ person_id: grantee.person_id, person_name: grantee.person_name }}
            onChange={({ person_id, person_name }) => update({ person_id, person_name })}
          />
        </div>
      )}

      {/* org_tree_position */}
      {type === 'org_tree_position' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={labelStyle}>الفرقة</label>
            <select value={youth_group_id} onChange={e => update({ youth_group_id: e.target.value, positions: [], selected_hulls: [] })} style={selectStyle}>
              <option value="">-- اختر الفرقة --</option>
              {youthGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          {youth_group_id && <SelectionModeBlock grantee={grantee} posData={posData} loadingPos={loadingPos} update={update} />}
        </div>
      )}

      {/* gen_sec_position */}
      {type === 'gen_sec_position' && (
        <SelectionModeBlock grantee={grantee} posData={posData} loadingPos={loadingPos} update={update} />
      )}
    </div>
  )
}

function SelectionModeBlock({ grantee, posData, loadingPos, update }) {
  const { selection_mode, positions, selected_hulls = [] } = grantee
  const hullOptions = buildHullSelectionOptions(posData?.hulls || [])

  const toggleHull = (h) => {
    const payload = hullSelectionPayload(h)
    const key = payload.key
    const already = selected_hulls.find(sh => sh.key === key)
    if (already) {
      update({ selected_hulls: selected_hulls.filter(sh => sh.key !== key) })
    } else {
      update({ selected_hulls: [...selected_hulls, payload] })
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <label style={labelStyle}>نطاق الاختيار</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(SELECTION_MODE_LABELS).map(([val, lbl]) => (
            <button key={val} onClick={() => update({ selection_mode: val, positions: [], selected_hulls: [] })}
              style={{ padding: '6px 12px', borderRadius: 20, border: `1.5px solid ${selection_mode === val ? '#c9963c' : '#e2e6ef'}`, background: selection_mode === val ? '#fffbeb' : 'white', color: selection_mode === val ? '#b45309' : '#4a5568', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: selection_mode === val ? 700 : 400 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {selection_mode === 'positions' && (
        <div>
          <label style={labelStyle}>المواقع</label>
          {loadingPos ? <div className="spinner" style={{ width: 16, height: 16, margin: '4px 0' }} /> :
            !posData ? <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>لا توجد بيانات هيكل للفترة الحالية</p> :
            posData.positions.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>لا توجد مواقع</p> : <>
              <MultiSelectHeader
                total={posData.positions.length}
                selectedCount={positions.length}
                onSelectAll={() => update({ positions: posData.positions.map(p => p.role) })}
                onClearAll={() => update({ positions: [] })}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', border: '1px solid #e2e6ef', borderRadius: 8, padding: '8px 10px', background: 'white' }}>
                {posData.positions.map(p => (
                  <label key={p.role} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: '#1a2a3a' }}>
                    <input type="checkbox" checked={positions.includes(p.role)} onChange={e => {
                      const next = e.target.checked ? [...positions, p.role] : positions.filter(r => r !== p.role)
                      update({ positions: next })
                    }} style={{ width: 14, height: 14 }} />
                    <span>{p.role}</span>
                    <span style={{ fontSize: '0.75rem', color: '#9ba5bc', marginRight: 'auto' }}>{p.members?.length || 0} شخص</span>
                  </label>
                ))}
              </div>
            </>
          }
        </div>
      )}

      {selection_mode === 'hull' && (
        <div>
          <label style={labelStyle}>الهياكل (Hulls)</label>
          {loadingPos ? <div className="spinner" style={{ width: 16, height: 16, margin: '4px 0' }} /> :
            !posData ? <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>لا توجد بيانات</p> :
            hullOptions.length === 0 ? <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>لا توجد هياكل</p> : <>
              <MultiSelectHeader
                total={hullOptions.length}
                selectedCount={selected_hulls.length}
                onSelectAll={() => update({ selected_hulls: hullOptions.map(hullSelectionPayload) })}
                onClearAll={() => update({ selected_hulls: [] })}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e6ef', borderRadius: 8, padding: '8px 10px', background: 'white' }}>
                {hullOptions.map(h => {
                  const key = h.key
                  const label = h.hull_display || h.hull
                  const countLabel = h.head_count > 1
                    ? `${h.head_count} رؤساء، ${h.members?.length || 0} عضو`
                    : `${h.members?.length || 0} عضو`
                  const checked = selected_hulls.some(sh => sh.key === key)
                  return (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: '#1a2a3a' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleHull(h)} style={{ width: 14, height: 14 }} />
                      <span>{label}</span>
                      <span style={{ fontSize: '0.75rem', color: '#9ba5bc', marginRight: 'auto' }}>{countLabel}</span>
                    </label>
                  )
                })}
              </div>
            </>
          }
        </div>
      )}

      {selection_mode === 'all' && posData && (
        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
          سيتم منح الصلاحية لجميع أصحاب المواقع ({posData.all_nodes?.length || 0} شخص حالياً)
        </p>
      )}
    </div>
  )
}

// ── Scope form ────────────────────────────────────────────────────────────────

function ScopeForm({ privType, scope, onChange, youthGroups, ageGroups }) {
  const scopeOptions =
    privType === 'profile_access'
      ? ['all', 'youth_group', 'age_group', 'org_tree_descendants']
      : ['youth_group', 'age_group']

  const youth_group_ids = scope.youth_group_ids || []
  const age_groups = scope.age_groups || []
  const scopeNeedsYouthGroups = ['youth_group', 'age_group', 'org_tree_descendants'].includes(scope.type)

  const toggleYg = (id) => {
    const next = youth_group_ids.includes(id) ? youth_group_ids.filter(x => x !== id) : [...youth_group_ids, id]
    onChange({ ...scope, youth_group_ids: next })
  }

  const toggleAg = (ag) => {
    const next = age_groups.includes(ag) ? age_groups.filter(x => x !== ag) : [...age_groups, ag]
    onChange({ ...scope, age_groups: next })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={labelStyle}>نطاق الوصول (ما الذي تتيحه الصلاحية؟)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {scopeOptions.map(val => (
            <button key={val} onClick={() => onChange({ type: val, youth_group_ids: scope.youth_group_ids || [], age_groups: val === 'age_group' ? (scope.age_groups || []) : [] })}
              style={{ padding: '7px 14px', borderRadius: 20, border: `1.5px solid ${scope.type === val ? '#0f2744' : '#e2e6ef'}`, background: scope.type === val ? '#0f2744' : 'white', color: scope.type === val ? 'white' : '#4a5568', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: scope.type === val ? 700 : 400 }}>
              {SCOPE_TYPE_LABELS[val]}
            </button>
          ))}
        </div>
      </div>

      {scopeNeedsYouthGroups && (
        <div>
          <label style={labelStyle}>الفرق</label>
          <MultiSelectHeader
            total={youthGroups.length}
            selectedCount={youth_group_ids.length}
            onSelectAll={() => onChange({ ...scope, youth_group_ids: youthGroups.map(g => g.id) })}
            onClearAll={() => onChange({ ...scope, youth_group_ids: [] })}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto', border: '1px solid #e2e6ef', borderRadius: 8, padding: '8px 10px', background: 'white' }}>
            {youthGroups.map(g => (
              <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: '#1a2a3a' }}>
                <input type="checkbox" checked={youth_group_ids.includes(g.id)} onChange={() => toggleYg(g.id)} style={{ width: 14, height: 14 }} />
                <span>{g.short_name || g.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {scope.type === 'org_tree_descendants' && (
        <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>
          كل شخص في الهيكل الحالي للفرق المحددة يرى بيانات كل من تحته في الهيكل فقط، عبر جميع مسارات التبعية.
        </p>
      )}

      {scope.type === 'age_group' && (
        <div>
          <label style={labelStyle}>الفئات العمرية</label>
          <MultiSelectHeader
            total={ageGroups.length}
            selectedCount={age_groups.length}
            onSelectAll={() => onChange({ ...scope, age_groups: [...ageGroups] })}
            onClearAll={() => onChange({ ...scope, age_groups: [] })}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid #e2e6ef', borderRadius: 8, background: 'white' }}>
            {ageGroups.map(ag => (
              <label key={ag} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', padding: '4px 10px', borderRadius: 20, border: `1.5px solid ${age_groups.includes(ag) ? '#c9963c' : '#e2e6ef'}`, background: age_groups.includes(ag) ? '#fffbeb' : 'transparent' }}>
                <input type="checkbox" checked={age_groups.includes(ag)} onChange={() => toggleAg(ag)} style={{ display: 'none' }} />
                <span style={{ fontWeight: age_groups.includes(ag) ? 700 : 400, color: age_groups.includes(ag) ? '#b45309' : '#4a5568' }}>{ag}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Grant section ─────────────────────────────────────────────────────────────

function GrantSection({ youthGroups, ageGroups, toast, onCreated }) {
  const [activePriv, setActivePriv] = useState('profile_access')
  const [scope, setScope] = useState({ type: 'youth_group', youth_group_ids: [], age_groups: [] })
  const [grantees, setGrantees] = useState([newGrantee()])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [positionsCache, setPositionsCache] = useState({})
  const hierarchyScope = activePriv === 'profile_access' && scope.type === 'org_tree_descendants'

  const loadPositions = useCallback(async (groupId) => {
    if (!groupId) return
    setPositionsCache(prev => ({ ...prev, [groupId + '__loading']: true }))
    try {
      const data = await api.getPrivilegeOrgPositions(groupId)
      setPositionsCache(prev => { const next = { ...prev }; delete next[groupId + '__loading']; next[groupId] = data; return next })
    } catch {
      setPositionsCache(prev => { const next = { ...prev }; delete next[groupId + '__loading']; return next })
    }
  }, [])

  const updateGrantee = (i, patch) => {
    setGrantees(prev => prev.map((g, idx) => idx === i ? { ...g, ...patch } : g))
  }
  const removeGrantee = (i) => {
    setGrantees(prev => prev.filter((_, idx) => idx !== i))
  }

  const validate = () => {
    if ((scope.type === 'youth_group' || scope.type === 'age_group' || scope.type === 'org_tree_descendants') && !(scope.youth_group_ids?.length > 0)) {
      toast('يرجى اختيار فرقة واحدة على الأقل', 'error'); return false
    }
    if (scope.type === 'age_group' && !(scope.age_groups?.length > 0)) {
      toast('يرجى اختيار فئة عمرية واحدة على الأقل', 'error'); return false
    }
    if (hierarchyScope) return true
    if (grantees.length === 0) {
      toast('يرجى إضافة مجموعة مستفيدين على الأقل', 'error'); return false
    }
    for (const g of grantees) {
      if (g.type === 'specific_person' && !g.person_id) {
        toast('يرجى اختيار شخص محدد في كل مجموعة', 'error'); return false
      }
      if (g.type === 'org_tree_position' && !g.youth_group_id) {
        toast('يرجى اختيار الفرقة في كل مجموعة', 'error'); return false
      }
      if ((g.type === 'org_tree_position' || g.type === 'gen_sec_position') && g.selection_mode === 'positions' && g.positions.length === 0) {
        toast('يرجى اختيار موقع واحد على الأقل', 'error'); return false
      }
      if ((g.type === 'org_tree_position' || g.type === 'gen_sec_position') && g.selection_mode === 'hull' && !(g.selected_hulls?.length > 0)) {
        toast('يرجى اختيار هيكل واحد على الأقل', 'error'); return false
      }
    }
    return true
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const grants = hierarchyScope ? [{
        privilege_type: activePriv,
        scope: { type: 'org_tree_descendants', youth_group_ids: scope.youth_group_ids || [], age_groups: [] },
        grantee: { type: 'org_tree_descendants', youth_group_ids: scope.youth_group_ids || [] },
        notes,
      }] : grantees.map(g => ({
        privilege_type: activePriv,
        scope,
        grantee: {
          type: g.type,
          ...(g.type === 'specific_person' ? { person_id: g.person_id, person_name: g.person_name } : {}),
          ...(g.type === 'org_tree_position' ? { youth_group_id: g.youth_group_id } : {}),
          ...((g.type === 'org_tree_position' || g.type === 'gen_sec_position') ? (() => {
            const hulls = g.selected_hulls || []
            // Count how many selected instances share each hull name
            const counts = {}
            hulls.forEach(h => { counts[h.hull] = (counts[h.hull] || 0) + 1 })
            // Deduplicate by hull name for storage
            const seen = new Set()
            const uniqueHulls = hulls.filter(h => { if (seen.has(h.hull)) return false; seen.add(h.hull); return true })
            return {
              selection_mode: g.selection_mode,
              positions: g.positions,
              // hull field: unique names only
              hull: uniqueHulls.map(h => h.hull).join('، '),
              hull_nodes: hulls.flatMap(h => h.instance_node_ids || []),
              // hull_display: if a name appears for multiple instances (same hull, multiple heads),
              // show it once; otherwise show with disambiguation
              hull_display: uniqueHulls.map(h => counts[h.hull] > 1 ? h.hull : (h.hull_display || h.hull)).join('، '),
            }
          })() : {}),
        },
        notes,
      }))
      await api.createPrivilegeGrants(grants)
      toast('تم منح الصلاحية بنجاح', 'success')
      setGrantees([newGrantee()])
      setNotes('')
      setScope({ type: 'youth_group', youth_group_ids: [], age_groups: [] })
      onCreated()
    } catch (e) {
      toast(e?.message || 'تعذّر منح الصلاحية', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Privilege type sub-tabs */}
      <div className="card">
        <div className="card-header"><span className="card-title">نوع الصلاحية</span></div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ALL_PRIV_TYPES.map(pt => {
              const Icon = PRIV_ICONS[pt]
              const c = PRIV_COLORS[pt]
              const active = activePriv === pt
              return (
                <button key={pt} onClick={() => { setActivePriv(pt); setScope({ type: 'youth_group', youth_group_ids: [], age_groups: [] }) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: `2px solid ${active ? c.text : '#e2e6ef'}`, background: active ? c.bg : 'white', color: active ? c.text : '#6b7280', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', fontWeight: active ? 700 : 400, transition: '0.15s' }}>
                  <Icon size={16} />
                  {PRIV_LABELS[pt]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Scope */}
      <div className="card">
        <div className="card-header"><span className="card-title">نطاق الوصول</span></div>
        <div className="card-body">
          <ScopeForm privType={activePriv} scope={scope} onChange={setScope} youthGroups={youthGroups} ageGroups={ageGroups} />
        </div>
      </div>

      {/* Grantees */}
      {hierarchyScope ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">المستفيدون حسب الهيكل</span>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '0.85rem', color: '#4a5568', margin: 0 }}>
              يتم تحديد المستفيدين من الهياكل التنظيمية المحددة، وكل شخص يحصل على صلاحية للتابعين تحته فقط. إذا كان الشخص تابعاً لأكثر من مسؤول، يحصل كل مسؤول أعلى منه على الصلاحية.
            </p>
          </div>
        </div>
      ) : (
      <div className="card">
        <div className="card-header">
          <span className="card-title">مستفيدو الصلاحية</span>
          <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>أضف مجموعة أو أكثر من المستفيدين</p>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          {grantees.map((g, i) => (
            <GranteeBlock
              key={g._key}
              grantee={g}
              index={i}
              onUpdate={updateGrantee}
              onRemove={() => removeGrantee(i)}
              youthGroups={youthGroups}
              positionsCache={positionsCache}
              onLoadPositions={loadPositions}
            />
          ))}
          <button onClick={() => setGrantees(prev => [...prev, newGrantee()])}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', border: '1.5px dashed #c5d8f8', borderRadius: 8, background: '#f7faff', color: '#1a56db', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600 }}>
            <Plus size={15} /> إضافة مجموعة أخرى
          </button>
        </div>
      </div>
      )}

      {/* Notes + submit */}
      <div className="card">
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={labelStyle}>ملاحظات (اختياري)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="سبب منح الصلاحية أو أي ملاحظات…"
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSubmit} disabled={saving} className="btn btn-gold">
              {saving ? 'جارٍ الحفظ…' : 'منح الصلاحية'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── List section ──────────────────────────────────────────────────────────────

function ListSection({ youthGroups, toast, refreshKey }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listPrivilegeGrants(typeFilter || undefined)
      setGrants(res.grants || [])
    } catch { setGrants([]) }
    finally { setLoading(false) }
  }, [typeFilter, refreshKey])

  useEffect(() => { load() }, [load])

  const revoke = async (id) => {
    if (!window.confirm('هل تريد إلغاء هذه الصلاحية؟')) return
    setRevoking(id)
    try {
      await api.deletePrivilegeGrant(id)
      toast('تم إلغاء الصلاحية', 'success')
      load()
    } catch (e) {
      toast(e?.message || 'تعذّر إلغاء الصلاحية', 'error')
    } finally { setRevoking(null) }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['', 'الكل'], ...ALL_PRIV_TYPES.map(t => [t, PRIV_LABELS[t]])].map(([val, lbl]) => (
          <button key={val} onClick={() => setTypeFilter(val)}
            style={{ padding: '6px 14px', borderRadius: 20, border: `1.5px solid ${typeFilter === val ? '#0f2744' : '#e2e6ef'}`, background: typeFilter === val ? '#0f2744' : 'white', color: typeFilter === val ? 'white' : '#6b7280', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: typeFilter === val ? 700 : 400 }}>
            {lbl}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" /></div>
      ) : grants.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ba5bc' }}>
          <Shield size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ margin: 0 }}>لا توجد صلاحيات ممنوحة</p>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e6ef', background: '#f7f9ff' }}>
                  {['نوع الصلاحية', 'نطاق الوصول', 'المستفيد', 'تاريخ المنح', 'الملاحظات', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'right', color: '#4a5568', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grants.map(g => {
                  const c = PRIV_COLORS[g.privilege_type] || PRIV_COLORS.profile_access
                  const Icon = PRIV_ICONS[g.privilege_type] || Shield
                  return (
                    <tr key={g.id} style={{ borderBottom: '1px solid #f0f2f7' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f7f9ff'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontSize: '0.78rem', fontWeight: 700 }}>
                          <Icon size={12} /> {PRIV_LABELS[g.privilege_type] || g.privilege_type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#1a2a3a', fontWeight: 600 }}>{scopeLabel(g.scope, youthGroups)}</td>
                      <td style={{ padding: '10px 14px', color: '#4a5568' }}>{granteeLabel(g.grantee, youthGroups)}</td>
                      <td style={{ padding: '10px 14px', color: '#9ba5bc', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtDate(g.granted_at)}</td>
                      <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: '0.8rem', maxWidth: 200 }}>{g.notes || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <button onClick={() => revoke(g.id)} disabled={revoking === g.id}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                          {revoking === g.id ? <div className="spinner" style={{ width: 13, height: 13 }} /> : <Trash2 size={13} />}
                          إلغاء
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Search section ────────────────────────────────────────────────────────────

function SearchSection({ youthGroups }) {
  const [mode, setMode] = useState('resolve') // 'resolve' | 'who_can_access'
  const [personSearch, setPersonSearch] = useState('')
  const [personResults, setPersonResults] = useState([])
  const [personSearchOpen, setPersonSearchOpen] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setPersonSearchOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearchInput = (e) => {
    const q = e.target.value
    setPersonSearch(q)
    setSelectedPerson(null)
    setData(null)
    clearTimeout(timerRef.current)
    if (q.length < 2) { setPersonResults([]); setPersonSearchOpen(false); return }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await api.searchPrivilegePersons(q)
        setPersonResults(res.persons || [])
        setPersonSearchOpen(true)
      } catch { setPersonResults([]) }
    }, 300)
  }

  const selectPerson = async (p) => {
    setPersonSearch(p.name)
    setSelectedPerson(p)
    setPersonSearchOpen(false)
    setPersonResults([])
    setLoading(true)
    try {
      if (mode === 'resolve') {
        const res = await api.resolvePersonPrivileges(p.person_id)
        setData(res)
      } else {
        const res = await api.whoCanAccessPerson(p.person_id)
        setData(res)
      }
    } catch { setData(null) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (selectedPerson) { selectPerson(selectedPerson) }
  }, [mode])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => { setMode('resolve'); setData(null) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, border: `2px solid ${mode === 'resolve' ? '#0f2744' : '#e2e6ef'}`, background: mode === 'resolve' ? '#0f2744' : 'white', color: mode === 'resolve' ? 'white' : '#6b7280', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', fontWeight: mode === 'resolve' ? 700 : 400 }}>
          <Shield size={15} /> ما صلاحيات هذا الشخص؟
        </button>
        <button onClick={() => { setMode('who_can_access'); setData(null) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, border: `2px solid ${mode === 'who_can_access' ? '#0f2744' : '#e2e6ef'}`, background: mode === 'who_can_access' ? '#0f2744' : 'white', color: mode === 'who_can_access' ? 'white' : '#6b7280', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', fontWeight: mode === 'who_can_access' ? 700 : 400 }}>
          <Users size={15} /> من يمكنه الوصول لبيانات شخص؟
        </button>
      </div>

      {/* Person search */}
      <div className="card">
        <div className="card-body">
          <label style={labelStyle}>
            {mode === 'resolve' ? 'الشخص (من يملك الصلاحيات؟)' : 'الشخص (من يمكن الوصول لبياناته؟)'}
          </label>
          <div ref={wrapRef} style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc', pointerEvents: 'none' }} />
              <input value={personSearch} onChange={handleSearchInput} placeholder="ابحث باسم الشخص…"
                style={{ width: '100%', padding: '10px 34px 10px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'rtl', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {personSearchOpen && personResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: 'white', border: '1.5px solid #e2e6ef', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 200, maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
                {personResults.map(p => (
                  <button key={p.person_id} onClick={() => selectPerson(p)}
                    style={{ width: '100%', padding: '10px 14px', textAlign: 'right', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', borderBottom: '1px solid #f5f6fa', display: 'flex', flexDirection: 'column', gap: 2 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f7f9ff'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <span style={{ fontWeight: 600, color: '#1a2a3a' }}>{p.name}</span>
                    {p.en_name && <span style={{ fontSize: '0.75rem', color: '#9ba5bc' }}>{p.en_name}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {loading && <div style={{ textAlign: 'center', padding: 32 }}><div className="spinner" /></div>}

      {!loading && data && mode === 'resolve' && (
        <ResolveResults data={data} youthGroups={youthGroups} />
      )}

      {!loading && data && mode === 'who_can_access' && (
        <WhoCanAccessResults data={data} youthGroups={youthGroups} />
      )}
    </div>
  )
}

function ResolveResults({ data, youthGroups }) {
  const { grants = [], person_name } = data
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">صلاحيات {person_name || 'الشخص'}</span>
      </div>
      <div className="card-body">
        {grants.length === 0 ? (
          <p style={{ color: '#9ba5bc', margin: 0 }}>لا توجد صلاحيات ممنوحة لهذا الشخص</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {grants.map(g => {
              const c = PRIV_COLORS[g.privilege_type] || PRIV_COLORS.profile_access
              const Icon = PRIV_ICONS[g.privilege_type] || Shield
              return (
                <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', border: `1.5px solid ${c.border}`, borderRadius: 10, background: c.bg }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${c.border}` }}>
                    <Icon size={15} color={c.text} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: c.text, fontSize: '0.87rem', marginBottom: 4 }}>{PRIV_LABELS[g.privilege_type]}</div>
                    <div style={{ fontSize: '0.82rem', color: '#4a5568' }}>النطاق: {scopeLabel(g.scope, youthGroups)}</div>
                    {g.notes && <div style={{ fontSize: '0.78rem', color: '#9ba5bc', marginTop: 4 }}>{g.notes}</div>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9ba5bc', flexShrink: 0 }}>{fmtDate(g.granted_at)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function WhoCanAccessResults({ data, youthGroups }) {
  const { accessors = [], person_name, covering_grants = [] } = data
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">من يمكنه الوصول لبيانات {person_name || 'الشخص'}</span>
        </div>
        <div className="card-body">
          {accessors.length === 0 ? (
            <p style={{ color: '#9ba5bc', margin: 0 }}>لا أحد لديه صلاحية وصول لبيانات هذا الشخص</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {accessors.map(a => (
                <div key={a.person_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1.5px solid #e2e6ef', borderRadius: 10, background: '#f7f9ff' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #c5d8f8' }}>
                    <User size={14} color="#1a56db" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.87rem', color: '#1a2a3a' }}>{a.person_name || '—'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#9ba5bc' }}>
                      عبر {a.via_grants?.length || 0} صلاحية
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {covering_grants.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">الصلاحيات المانحة للوصول</span></div>
          <div className="card-body">
            <div style={{ display: 'grid', gap: 8 }}>
              {covering_grants.map(g => {
                const c = PRIV_COLORS[g.privilege_type] || PRIV_COLORS.profile_access
                return (
                  <div key={g.id} style={{ padding: '8px 12px', border: `1px solid ${c.border}`, borderRadius: 8, background: c.bg, fontSize: '0.82rem', color: c.text }}>
                    {granteeLabel(g.grantee, youthGroups)} ← {scopeLabel(g.scope, youthGroups)}
                    {g.notes && <span style={{ color: '#9ba5bc', marginRight: 8 }}>({g.notes})</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── YG File section ───────────────────────────────────────────────────────────

function YGFileSection({ youthGroups, ageGroups, toast, onCreated }) {
  const [subTab, setSubTab] = useState('grant') // 'grant' | 'list'
  const [refreshKey, setRefreshKey] = useState(0)

  const handleCreated = () => {
    setRefreshKey(r => r + 1)
    onCreated()
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[['grant', 'منح صلاحية', Plus], ['list', 'الصلاحيات الممنوحة', Shield]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSubTab(id)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, border: `1.5px solid ${subTab === id ? '#7c3aed' : '#e2e6ef'}`, background: subTab === id ? '#fdf4ff' : 'white', color: subTab === id ? '#7c3aed' : '#6b7280', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', fontWeight: subTab === id ? 700 : 400 }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {subTab === 'grant' && (
        <YGFileGrantForm youthGroups={youthGroups} ageGroups={ageGroups} toast={toast} onCreated={handleCreated} />
      )}
      {subTab === 'list' && (
        <YGFileList youthGroups={youthGroups} toast={toast} refreshKey={refreshKey} />
      )}
    </div>
  )
}

function YGFileGrantForm({ youthGroups, ageGroups, toast, onCreated }) {
  const [scope, setScope] = useState({ type: 'youth_group', youth_group_ids: [], age_groups: [] })
  const [grantees, setGrantees] = useState([newGrantee()])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [positionsCache, setPositionsCache] = useState({})

  const loadPositions = useCallback(async (groupId) => {
    if (!groupId) return
    setPositionsCache(prev => ({ ...prev, [groupId + '__loading']: true }))
    try {
      const data = await api.getPrivilegeOrgPositions(groupId)
      setPositionsCache(prev => { const next = { ...prev }; delete next[groupId + '__loading']; next[groupId] = data; return next })
    } catch {
      setPositionsCache(prev => { const next = { ...prev }; delete next[groupId + '__loading']; return next })
    }
  }, [])

  const updateGrantee = (i, patch) => setGrantees(prev => prev.map((g, idx) => idx === i ? { ...g, ...patch } : g))
  const removeGrantee = (i) => setGrantees(prev => prev.filter((_, idx) => idx !== i))

  const validate = () => {
    if (!(scope.youth_group_ids?.length > 0)) {
      toast('يرجى اختيار فرقة واحدة على الأقل', 'error'); return false
    }
    if (grantees.length === 0) {
      toast('يرجى إضافة مجموعة مستفيدين على الأقل', 'error'); return false
    }
    for (const g of grantees) {
      if (g.type === 'specific_person' && !g.person_id) {
        toast('يرجى اختيار شخص محدد في كل مجموعة', 'error'); return false
      }
      if (g.type === 'org_tree_position' && !g.youth_group_id) {
        toast('يرجى اختيار الفرقة في كل مجموعة', 'error'); return false
      }
      if ((g.type === 'org_tree_position' || g.type === 'gen_sec_position') && g.selection_mode === 'positions' && g.positions.length === 0) {
        toast('يرجى اختيار موقع واحد على الأقل', 'error'); return false
      }
      if ((g.type === 'org_tree_position' || g.type === 'gen_sec_position') && g.selection_mode === 'hull' && !(g.selected_hulls?.length > 0)) {
        toast('يرجى اختيار هيكل واحد على الأقل', 'error'); return false
      }
    }
    return true
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const grants = grantees.map(g => ({
        privilege_type: 'yg_file_access',
        scope,
        grantee: {
          type: g.type,
          ...(g.type === 'specific_person' ? { person_id: g.person_id, person_name: g.person_name } : {}),
          ...(g.type === 'org_tree_position' ? { youth_group_id: g.youth_group_id } : {}),
          ...((g.type === 'org_tree_position' || g.type === 'gen_sec_position') ? (() => {
            const hulls = g.selected_hulls || []
            const counts = {}
            hulls.forEach(h => { counts[h.hull] = (counts[h.hull] || 0) + 1 })
            const seen = new Set()
            const uniqueHulls = hulls.filter(h => { if (seen.has(h.hull)) return false; seen.add(h.hull); return true })
            return {
              selection_mode: g.selection_mode,
              positions: g.positions,
              hull: uniqueHulls.map(h => h.hull).join('، '),
              hull_nodes: hulls.flatMap(h => h.instance_node_ids || []),
              hull_display: uniqueHulls.map(h => counts[h.hull] > 1 ? h.hull : (h.hull_display || h.hull)).join('، '),
            }
          })() : {}),
        },
        notes,
      }))
      await api.createPrivilegeGrants(grants)
      toast('تم منح الصلاحية بنجاح', 'success')
      setGrantees([newGrantee()])
      setNotes('')
      setScope({ type: 'youth_group', youth_group_ids: [], age_groups: [] })
      onCreated()
    } catch (e) {
      toast(e?.message || 'تعذّر منح الصلاحية', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Scope */}
      <div className="card">
        <div className="card-header"><span className="card-title">الفرقة (نطاق الوصول)</span></div>
        <div className="card-body">
          <label style={labelStyle}>الفرق</label>
          <MultiSelectHeader
            total={youthGroups.length}
            selectedCount={scope.youth_group_ids.length}
            onSelectAll={() => setScope(s => ({ ...s, youth_group_ids: youthGroups.map(g => g.id) }))}
            onClearAll={() => setScope(s => ({ ...s, youth_group_ids: [] }))}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto', border: '1px solid #e2e6ef', borderRadius: 8, padding: '8px 10px', background: 'white' }}>
            {youthGroups.map(g => (
              <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: '#1a2a3a' }}>
                <input type="checkbox" checked={scope.youth_group_ids.includes(g.id)}
                  onChange={() => {
                    const next = scope.youth_group_ids.includes(g.id)
                      ? scope.youth_group_ids.filter(x => x !== g.id)
                      : [...scope.youth_group_ids, g.id]
                    setScope(s => ({ ...s, youth_group_ids: next }))
                  }} style={{ width: 14, height: 14 }} />
                <span>{g.short_name || g.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Grantees */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">مستفيدو الصلاحية</span>
          <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>أضف مجموعة أو أكثر من المستفيدين</p>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          {grantees.map((g, i) => (
            <GranteeBlock
              key={g._key}
              grantee={g}
              index={i}
              onUpdate={updateGrantee}
              onRemove={() => removeGrantee(i)}
              youthGroups={youthGroups}
              positionsCache={positionsCache}
              onLoadPositions={loadPositions}
            />
          ))}
          <button onClick={() => setGrantees(prev => [...prev, newGrantee()])}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', border: '1.5px dashed #e9d5ff', borderRadius: 8, background: '#fdf4ff', color: '#7c3aed', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600 }}>
            <Plus size={15} /> إضافة مجموعة أخرى
          </button>
        </div>
      </div>

      {/* Notes + submit */}
      <div className="card">
        <div className="card-body" style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={labelStyle}>ملاحظات (اختياري)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="سبب منح الصلاحية أو أي ملاحظات…"
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSubmit} disabled={saving}
              style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'جارٍ الحفظ…' : 'منح الصلاحية'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function YGFileList({ youthGroups, toast, refreshKey }) {
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.listPrivilegeGrants('yg_file_access')
      setGrants(res.grants || [])
    } catch { setGrants([]) }
    finally { setLoading(false) }
  }, [refreshKey])

  useEffect(() => { load() }, [load])

  const revoke = async (id) => {
    if (!window.confirm('هل تريد إلغاء هذه الصلاحية؟')) return
    setRevoking(id)
    try {
      await api.deletePrivilegeGrant(id)
      toast('تم إلغاء الصلاحية', 'success')
      load()
    } catch (e) {
      toast(e?.message || 'تعذّر إلغاء الصلاحية', 'error')
    } finally { setRevoking(null) }
  }

  const c = PRIV_COLORS.yg_file_access

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0' }}><div className="spinner" /></div>

  if (grants.length === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ba5bc' }}>
      <FolderOpen size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
      <p style={{ margin: 0 }}>لا توجد صلاحيات ممنوحة لملف الفرقة</p>
    </div>
  )

  return (
    <div className="card">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e6ef', background: '#fdf4ff' }}>
              {['نطاق الوصول', 'المستفيد', 'تاريخ المنح', 'الملاحظات', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'right', color: '#4a5568', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.id} style={{ borderBottom: '1px solid #f0f2f7' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fdf4ff'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '10px 14px', color: '#1a2a3a', fontWeight: 600 }}>{scopeLabel(g.scope, youthGroups)}</td>
                <td style={{ padding: '10px 14px', color: '#4a5568' }}>{granteeLabel(g.grantee, youthGroups)}</td>
                <td style={{ padding: '10px 14px', color: '#9ba5bc', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtDate(g.granted_at)}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: '0.8rem', maxWidth: 200 }}>{g.notes || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <button onClick={() => revoke(g.id)} disabled={revoking === g.id}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    {revoking === g.id ? <div className="spinner" style={{ width: 13, height: 13 }} /> : <Trash2 size={13} />}
                    إلغاء
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle = {
  display: 'block',
  fontSize: '0.8rem',
  color: '#4a5568',
  fontWeight: 700,
  marginBottom: 6,
}

const selectStyle = {
  width: '100%',
  padding: '8px 12px',
  border: '1.5px solid #e2e6ef',
  borderRadius: 8,
  fontFamily: 'var(--font-body)',
  fontSize: '0.87rem',
  direction: 'rtl',
  outline: 'none',
  background: 'white',
  boxSizing: 'border-box',
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PrivilegeManager({ toast }) {
  const [mainTab, setMainTab] = useState('grant') // 'grant' | 'list' | 'search' | 'yg_file'
  const [youthGroups, setYouthGroups] = useState([])
  const [ageGroups, setAgeGroups] = useState([])
  const [listRefresh, setListRefresh] = useState(0)

  useEffect(() => {
    api.getPrivilegeYouthGroups().then(r => setYouthGroups(r.youth_groups || [])).catch(() => {})
    api.getPrivilegeAgeGroups().then(r => setAgeGroups(r.age_groups || [])).catch(() => {})
  }, [])

  const TABS = [
    { id: 'grant',   label: 'منح صلاحية',         icon: Plus },
    { id: 'list',    label: 'الصلاحيات الممنوحة',  icon: Shield },
    { id: 'search',  label: 'البحث',               icon: Search },
    { id: 'yg_file', label: 'ملف الفرقة',          icon: FolderOpen },
  ]

  return (
    <div style={{ direction: 'rtl', padding: '0 0 40px' }}>
      {/* Page header */}
      <div style={{ padding: '20px 24px 0', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(201,150,60,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid rgba(201,150,60,0.3)' }}>
            <Shield size={20} color="#c9963c" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f2744' }}>إدارة الصلاحيات</h2>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#9ba5bc' }}>منح وإدارة صلاحيات الوصول للأعضاء</p>
          </div>
        </div>
      </div>

      {/* Main tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '0 24px', marginBottom: 24, borderBottom: '2px solid #e2e6ef' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setMainTab(id)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: mainTab === id ? 800 : 500, color: mainTab === id ? '#0f2744' : '#9ba5bc', borderBottom: `2.5px solid ${mainTab === id ? '#c9963c' : 'transparent'}`, marginBottom: -2, transition: '0.15s' }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '0 24px' }}>
        {mainTab === 'grant' && (
          <GrantSection
            youthGroups={youthGroups}
            ageGroups={ageGroups}
            toast={toast}
            onCreated={() => setListRefresh(r => r + 1)}
          />
        )}
        {mainTab === 'list' && (
          <ListSection
            youthGroups={youthGroups}
            toast={toast}
            refreshKey={listRefresh}
          />
        )}
        {mainTab === 'search' && (
          <SearchSection youthGroups={youthGroups} />
        )}
        {mainTab === 'yg_file' && (
          <YGFileSection
            youthGroups={youthGroups}
            ageGroups={ageGroups}
            toast={toast}
            onCreated={() => setListRefresh(r => r + 1)}
          />
        )}
      </div>
    </div>
  )
}
