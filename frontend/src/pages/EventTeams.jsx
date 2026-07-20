import { useState, useMemo, useRef, useCallback } from 'react'
import { Plus, Trash2, Edit2, Users, UserCheck, RotateCcw, ChevronDown, X, GripVertical, Download } from 'lucide-react'
import { api } from '../api.js'
import { downloadTeamsDocx } from '../docxExport.js'

const inputStyle = {
  width: '100%', padding: '7px 11px', border: '1.5px solid #e2e6ef', borderRadius: 8,
  fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', textAlign: 'right',
  outline: 'none', boxSizing: 'border-box',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function teamName(teams, teamId) {
  if (!teamId) return null
  return teams.find(t => t.team_id === teamId)?.name || teamId
}

function isAttendanceApologized(entry) {
  return entry?.attendance_status === 'apologized'
}

function shortYgName(label) {
  if (!label || label === '—') return label
  const idx = label.lastIndexOf(' - ')
  return idx !== -1 ? label.slice(idx + 3) : label.replace(/^شبيبة\s+/, '')
}

// ── TeamsManager ──────────────────────────────────────────────────────────────

function TeamsManager({ eventId, event, onRefresh, toast }) {
  const teams   = event.teams || []
  const members = (event.registration?.members || []).filter(m => (m.confirmation_status || 'confirmed') === 'confirmed' && !isAttendanceApologized(m))
  const supers  = (event.registration?.supervisors || []).filter(s => !isAttendanceApologized(s))

  const [generatingCount, setGeneratingCount]   = useState(event.num_teams || 4)
  const [generating,      setGenerating]         = useState(false)
  const [renameId,        setRenameId]           = useState(null)
  const [renameVal,       setRenameVal]          = useState('')
  const [renameSaving,    setRenameSaving]       = useState(false)
  const [distributing,    setDistributing]       = useState(false)
  const [unassignOpen,    setUnassignOpen]       = useState(false)
  const [deleting,        setDeleting]           = useState(null)

  const handleGenerate = async () => {
    if (!window.confirm(`سيتم إنشاء ${generatingCount} فرق. متابعة؟`)) return
    setGenerating(true)
    try {
      await api.createEventTeams(eventId, { count: generatingCount })
      toast('تم إنشاء الفرق', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر إنشاء الفرق', 'error') }
    finally { setGenerating(false) }
  }

  const startRename = (t) => { setRenameId(t.team_id); setRenameVal(t.name) }

  const saveRename = async (teamId) => {
    if (!renameVal.trim()) return
    setRenameSaving(true)
    try {
      await api.updateEventTeam(eventId, teamId, { name: renameVal.trim() })
      toast('تم الحفظ', 'success')
      onRefresh()
      setRenameId(null)
    } catch (e) { toast(e?.message || 'تعذّر الحفظ', 'error') }
    finally { setRenameSaving(false) }
  }

  const handleDelete = async (t) => {
    const assigned = members.filter(m => m.team_id === t.team_id).length
      + supers.filter(s => s.team_id === t.team_id).length
    const msg = assigned > 0
      ? `سيتم حذف "${t.name}" وإلغاء تعيين ${assigned} شخص. متابعة؟`
      : `حذف "${t.name}"؟`
    if (!window.confirm(msg)) return
    setDeleting(t.team_id)
    try {
      await api.deleteEventTeam(eventId, t.team_id)
      toast('تم الحذف', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر الحذف', 'error') }
    finally { setDeleting(null) }
  }

  const handleDistribute = async (mode) => {
    const label = mode === 'reset' ? 'إعادة توزيع جميع المشاركين المؤكّدين' : 'توزيع المشاركين غير المعيّنين فقط'
    if (!window.confirm(`${label}؟`)) return
    setDistributing(true)
    try {
      const res = await api.autoDistributeTeams(eventId, mode)
      toast(`تم توزيع ${res.assigned_count} مشارك`, 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر التوزيع', 'error') }
    finally { setDistributing(false) }
  }

  const handleUnassign = async (scope) => {
    const labels = {
      all_members:    'إلغاء تعيين جميع المشاركين',
      all_supervisors:'إلغاء تعيين جميع المسؤولين',
      all_main:       'إلغاء تعيين جميع المسؤولين الرئيسيين',
      all_assistant:  'إلغاء تعيين جميع المسؤولين المساعدين',
    }
    if (!window.confirm(`${labels[scope]}؟`)) return
    setUnassignOpen(false)
    try {
      await api.unassignEventTeams(eventId, scope)
      toast('تم إلغاء التعيين', 'success')
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر إلغاء التعيين', 'error') }
  }

  const unassigned  = members.filter(m => !m.team_id).length
  const assignedSup = supers.filter(s => s.team_id).length

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Top action bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Generate section */}
        {teams.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 10, padding: '8px 14px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0f2744' }}>توليد</span>
            <input type="number" min="2" max="30" value={generatingCount}
              onChange={e => setGeneratingCount(Number(e.target.value))}
              style={{ width: 54, padding: '4px 8px', border: '1.5px solid #c5d8f8', borderRadius: 7, fontFamily: 'var(--font-body)', fontSize: '0.88rem', textAlign: 'center', outline: 'none' }} />
            <span style={{ fontSize: '0.82rem', color: '#4a6fa5' }}>فريق</span>
            <button onClick={handleGenerate} disabled={generating} className="btn btn-gold btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Plus size={13} /> {generating ? 'جارٍ...' : 'توليد'}
            </button>
          </div>
        )}

        {/* Auto-distribute */}
        {teams.length > 0 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => handleDistribute('reset')} disabled={distributing}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#0f2744', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700 }}>
              <RotateCcw size={13} /> {distributing ? 'جارٍ التوزيع...' : 'توزيع تلقائي (الكل)'}
            </button>
            <button onClick={() => handleDistribute('unassigned')} disabled={distributing}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#f0f4ff', color: '#0f2744', border: '1px solid #c5d8f8', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700 }}>
              <RotateCcw size={13} /> توزيع غير المعيّنين ({unassigned})
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Unassign dropdown */}
        {teams.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setUnassignOpen(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#fff1f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 700 }}>
              إلغاء التعيين <ChevronDown size={13} />
            </button>
            {unassignOpen && (
              <div style={{ position: 'absolute', left: 0, top: '110%', background: 'white', border: '1px solid #e2e6ef', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 220 }}>
                {[
                  { scope: 'all_members',     label: 'إلغاء تعيين جميع المشاركين' },
                  { scope: 'all_supervisors', label: 'إلغاء تعيين جميع المسؤولين' },
                  { scope: 'all_main',        label: 'إلغاء تعيين المسؤولين الرئيسيين' },
                  { scope: 'all_assistant',   label: 'إلغاء تعيين المسؤولين المساعدين' },
                ].map(({ scope, label }) => (
                  <button key={scope} onClick={() => handleUnassign(scope)}
                    style={{ width: '100%', display: 'block', padding: '9px 16px', background: 'none', border: 'none', borderBottom: '1px solid #f5f6fa', cursor: 'pointer', textAlign: 'right', fontSize: '0.82rem', color: '#374151', fontFamily: 'var(--font-body)' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats row */}
      {teams.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'فرق', value: teams.length, dot: '#93c5fd' },
            { label: 'مشاركون مؤكّدون', value: members.length, dot: '#86efac' },
            { label: 'غير معيّنين', value: unassigned, dot: unassigned > 0 ? '#fcd34d' : '#d1d5db' },
            { label: 'مسؤولون معيّنون', value: assignedSup, dot: '#c4b5fd' },
          ].map(({ label, value, dot }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f8fafc', border: '1px solid #e9ecf3', borderRadius: 8, padding: '6px 12px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
              <span style={{ fontSize: '0.72rem', color: '#6b7280', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0f2744' }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Team cards */}
      {teams.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <Users size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لم يتم إنشاء فرق بعد</div>
          <div style={{ fontSize: '0.76rem', marginTop: 6 }}>استخدم زر التوليد أعلاه لإنشاء الفرق</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {teams.map(t => {
          const teamMembers = members.filter(m => m.team_id === t.team_id)
          const teamSups    = supers.filter(s => s.team_id === t.team_id)
          const males   = teamMembers.filter(m => m.gender === 'ذكر').length
          const females = teamMembers.filter(m => m.gender === 'أنثى').length
          const isRenaming = renameId === t.team_id

          return (
            <div key={t.team_id} style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(15,39,68,0.05)' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                {isRenaming ? (
                  <>
                    <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveRename(t.team_id); if (e.key === 'Escape') setRenameId(null) }}
                      style={{ ...inputStyle, flex: 1, fontSize: '0.9rem', fontWeight: 700 }} />
                    <button onClick={() => saveRename(t.team_id)} disabled={renameSaving}
                      style={{ padding: '4px 10px', background: '#0f2744', color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'var(--font-body)', fontWeight: 700 }}>
                      {renameSaving ? '...' : 'حفظ'}
                    </button>
                    <button onClick={() => setRenameId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 3 }}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.95rem', flex: 1 }}>{t.name}</span>
                    <button onClick={() => startRename(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#6b7280'}
                      onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(t)} disabled={deleting === t.team_id} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c5cdd8', padding: 3 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = '#c5cdd8'}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#374151', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>
                  {teamMembers.length} مشارك
                </span>
                {males > 0 && <span style={{ fontSize: '0.72rem', background: '#eff6ff', color: '#1d4ed8', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{males} ذ</span>}
                {females > 0 && <span style={{ fontSize: '0.72rem', background: '#fdf4ff', color: '#9333ea', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{females} أ</span>}
                {teamSups.length > 0 && (
                  <span style={{ fontSize: '0.72rem', background: '#f5f3ff', color: '#7c3aed', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>
                    <UserCheck size={10} style={{ marginLeft: 3 }} />{teamSups.length} مسؤول
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── TeamsLineup ───────────────────────────────────────────────────────────────

function TeamsLineup({ eventId, event, onRefresh, toast }) {
  const teams    = event.teams || []
  const members  = (event.registration?.members  || []).filter(m => (m.confirmation_status || 'confirmed') === 'confirmed' && !isAttendanceApologized(m))
  const supers   = (event.registration?.supervisors || []).filter(s => !isAttendanceApologized(s))

  const [dragItem,    setDragItem]    = useState(null) // {id, type: 'member'|'supervisor', fromTeamId}
  const [dragOver,    setDragOver]    = useState(null) // teamId or 'unassigned'
  const [saving,      setSaving]      = useState(null)

  const handleDragStart = useCallback((e, id, type, fromTeamId) => {
    setDragItem({ id, type, fromTeamId })
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDrop = useCallback(async (toTeamId) => {
    if (!dragItem) return
    if (dragItem.fromTeamId === toTeamId) { setDragItem(null); setDragOver(null); return }

    setSaving(dragItem.id)
    try {
      const regType = dragItem.type === 'member' ? 'members' : 'supervisors'
      const body = { team_id: toTeamId === 'unassigned' ? null : toTeamId }
      await api.updateEventRegistration(eventId, regType, dragItem.id, body)
      onRefresh()
    } catch (e) { toast(e?.message || 'تعذّر النقل', 'error') }
    finally { setSaving(null); setDragItem(null); setDragOver(null) }
  }, [dragItem, eventId, onRefresh, toast])

  const unassignedMembers = members.filter(m => !m.team_id || !teams.find(t => t.team_id === m.team_id))
  const unassignedSupers  = supers.filter(s  => !s.team_id || !teams.find(t => t.team_id === s.team_id))

  const renderPerson = (person, type) => {
    const isBeingMoved = saving === person.id
    const isDragging   = dragItem?.id === person.id
    const roleLabel = type === 'supervisor'
      ? person.team_role === 'main' ? 'رئيسي' : person.team_role === 'assistant' ? 'مساعد' : ''
      : ''

    return (
      <div key={person.id}
        draggable
        onDragStart={e => handleDragStart(e, person.id, type === 'supervisor' ? 'supervisor' : 'member', person.team_id || 'unassigned')}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
          background: isBeingMoved ? '#f0f4ff' : 'white',
          borderRadius: 8, border: '1px solid #edf0f7',
          opacity: isDragging ? 0.5 : isBeingMoved ? 0.7 : 1,
          cursor: 'grab', userSelect: 'none', transition: '0.1s',
          marginBottom: 4,
        }}>
        <GripVertical size={12} color="#c5cdd8" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f2744', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.name}</div>
          {person.youth_group_label && (
            <div style={{ fontSize: '0.67rem', color: '#9ba5bc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.youth_group_label}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {person.gender === 'ذكر' && <span style={{ fontSize: '0.62rem', background: '#eff6ff', color: '#1d4ed8', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>ذ</span>}
          {person.gender === 'أنثى' && <span style={{ fontSize: '0.62rem', background: '#fdf4ff', color: '#9333ea', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>أ</span>}
          {roleLabel && (
            <span style={{ fontSize: '0.62rem', background: person.team_role === 'main' ? '#f5f3ff' : '#f0fdf4', color: person.team_role === 'main' ? '#7c3aed' : '#16a34a', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>{roleLabel}</span>
          )}
        </div>
      </div>
    )
  }

  const renderDropZone = (teamId, label, children) => {
    const isOver = dragOver === teamId
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(teamId) }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => { e.preventDefault(); handleDrop(teamId) }}
        style={{
          minHeight: 60, borderRadius: 8, padding: '8px',
          background: isOver ? '#f0f7ff' : 'transparent',
          border: isOver ? '2px dashed #93c5fd' : '2px dashed transparent',
          transition: '0.15s',
        }}>
        {children}
        {isOver && (
          <div style={{ textAlign: 'center', padding: '8px', fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600 }}>
            إفلت هنا
          </div>
        )}
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
        <div style={{ fontSize: '0.88rem' }}>أنشئ الفرق أولاً من تبويب "إدارة الفرق"</div>
      </div>
    )
  }

  return (
    <div style={{ direction: 'rtl' }}>
      <div style={{ fontSize: '0.75rem', color: '#9ba5bc', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <GripVertical size={13} />
        اسحب وأفلت للنقل بين الفرق
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {teams.map(team => {
          const teamSups    = supers.filter(s => s.team_id === team.team_id)
          const mainSups    = teamSups.filter(s => s.team_role === 'main')
          const assistSups  = teamSups.filter(s => s.team_role === 'assistant')
          const otherSups   = teamSups.filter(s => !s.team_role)
          const teamMembers = members.filter(m => m.team_id === team.team_id)

          return (
            <div key={team.team_id} style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,39,68,0.05)' }}>
              {/* Team header */}
              <div style={{ background: '#0f2744', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: 'white', fontSize: '0.9rem' }}>{team.name}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.15)', color: 'white', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{teamMembers.length} عضو</span>
                  {teamSups.length > 0 && <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.15)', color: 'white', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{teamSups.length} مسؤول</span>}
                </div>
              </div>

              <div style={{ padding: '10px 12px' }}>
                {/* Main supervisors */}
                {mainSups.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#7c3aed', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} /> المسؤول الرئيسي
                    </div>
                    {mainSups.map(s => renderPerson(s, 'supervisor'))}
                  </div>
                )}
                {/* Assistant supervisors */}
                {assistSups.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#16a34a', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} /> المسؤول المساعد
                    </div>
                    {assistSups.map(s => renderPerson(s, 'supervisor'))}
                  </div>
                )}
                {/* Other supervisors (unroled) */}
                {otherSups.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>مسؤولون</div>
                    {otherSups.map(s => renderPerson(s, 'supervisor'))}
                  </div>
                )}

                {/* Members drop zone */}
                <div style={{ borderTop: teamSups.length > 0 ? '1px solid #f1f5f9' : 'none', paddingTop: teamSups.length > 0 ? 8 : 0 }}>
                  {teamMembers.length > 0 && (
                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>الأعضاء</div>
                  )}
                  {renderDropZone(team.team_id, team.name, teamMembers.map(m => renderPerson(m, 'member')))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Unassigned */}
      {(unassignedMembers.length > 0 || unassignedSupers.length > 0) && (
        <div style={{ marginTop: 20, border: '1.5px dashed #e9ecf3', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontWeight: 700, color: '#9ba5bc', fontSize: '0.82rem', marginBottom: 12 }}>
            غير معيّنون ({unassignedMembers.length + unassignedSupers.length})
          </div>
          {unassignedSupers.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>مسؤولون</div>
              {renderDropZone('unassigned', 'unassigned', unassignedSupers.map(s => renderPerson(s, 'supervisor')))}
            </div>
          )}
          {unassignedMembers.length > 0 && (
            <div>
              <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>مشاركون</div>
              {renderDropZone('unassigned', 'unassigned', unassignedMembers.map(m => renderPerson(m, 'member')))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── TeamsDashboard ─────────────────────────────────────────────────────────────

function TeamsDashboard({ event }) {
  const teams   = event.teams || []
  const members = (event.registration?.members || []).filter(m => (m.confirmation_status || 'confirmed') === 'confirmed' && !isAttendanceApologized(m))
  const supers  = (event.registration?.supervisors || []).filter(s => !isAttendanceApologized(s))

  const stats = useMemo(() => {
    return teams.map(t => {
      const tm    = members.filter(m => m.team_id === t.team_id)
      const ts    = supers.filter(s => s.team_id === t.team_id)
      const males   = tm.filter(m => m.gender === 'ذكر').length
      const females = tm.filter(m => m.gender === 'أنثى').length
      const unknown = tm.length - males - females
      const ygCountMap = {}
      tm.forEach(m => {
        const lbl = m.youth_group_label || m.youth_group_id || '—'
        ygCountMap[lbl] = (ygCountMap[lbl] || 0) + 1
      })
      const ygCounts = Object.entries(ygCountMap)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
      return {
        team: t,
        total: tm.length,
        males, females, unknown,
        ygCounts,
        mainSup:   ts.filter(s => s.team_role === 'main').length,
        assistSup: ts.filter(s => s.team_role === 'assistant').length,
        otherSup:  ts.filter(s => !s.team_role).length,
        totalSup:  ts.length,
      }
    })
  }, [teams, members, supers])

  const unassigned = members.filter(m => !m.team_id || !teams.find(t => t.team_id === m.team_id))
  const sizes = stats.map(s => s.total)
  const maxSize = Math.max(...sizes, 0)
  const minSize = sizes.length ? Math.min(...sizes) : 0
  const totalMales   = members.filter(m => m.gender === 'ذكر').length
  const totalFemales = members.filter(m => m.gender === 'أنثى').length

  if (teams.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
        <div style={{ fontSize: '0.88rem' }}>أنشئ الفرق أولاً لعرض الإحصائيات</div>
      </div>
    )
  }

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'إجمالي الفرق',      value: teams.length,      dot: '#93c5fd' },
          { label: 'إجمالي المشاركين',  value: members.length,    dot: '#86efac' },
          { label: 'ذكور',              value: totalMales,         dot: '#60a5fa' },
          { label: 'إناث',              value: totalFemales,       dot: '#d946ef' },
          { label: 'غير معيّنين',       value: unassigned.length, dot: unassigned.length > 0 ? '#fcd34d' : '#d1d5db' },
          { label: 'فارق الحجم',        value: maxSize - minSize <= 1 ? '✓ متوازن' : `${maxSize - minSize}±`, dot: maxSize - minSize <= 1 ? '#86efac' : '#fca5a5' },
        ].map(({ label, value, dot }) => (
          <div key={label} style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 10, padding: '12px 14px', textAlign: 'center', boxShadow: '0 1px 4px rgba(15,39,68,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} />
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f2744', marginBottom: 2 }}>{value}</div>
            <div style={{ fontSize: '0.67rem', color: '#9ba5bc', fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Per-team table */}
      <div style={{ background: 'white', border: '1px solid #edf0f7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,39,68,0.04)' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.6fr 0.6fr 0.8fr 0.8fr 1.6fr', gap: 0, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #edf0f7' }}>
          {['الفريق', 'الأعضاء', 'ذكور', 'إناث', 'رئيسي', 'مساعد', 'الشبيبات'].map(h => (
            <div key={h} style={{ fontSize: '0.67rem', fontWeight: 700, color: '#9ba5bc', textAlign: 'center' }}>{h}</div>
          ))}
        </div>

        {stats.map((s, i) => {
          const maleRatio   = s.total ? s.males   / s.total : 0
          const femaleRatio = s.total ? s.females / s.total : 0
          const isOdd = i % 2 === 1
          return (
            <div key={s.team.team_id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.6fr 0.6fr 0.8fr 0.8fr 1.6fr', gap: 0, padding: '10px 16px', background: isOdd ? '#f8fafc' : 'white', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.team.name}</div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: '#0f2744' }}>{s.total}</span>
                {/* Mini bar */}
                <div style={{ height: 4, borderRadius: 2, background: '#f1f5f9', marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${maxSize ? (s.total / maxSize) * 100 : 0}%`, background: '#86efac', transition: '0.3s' }} />
                </div>
              </div>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.88rem', color: '#1d4ed8' }}>{s.males}</div>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.88rem', color: '#9333ea' }}>{s.females}</div>
              <div style={{ textAlign: 'center' }}>
                {s.mainSup > 0
                  ? <span style={{ fontSize: '0.72rem', background: '#f5f3ff', color: '#7c3aed', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{s.mainSup}</span>
                  : <span style={{ color: '#d1d5db', fontSize: '0.72rem' }}>—</span>}
              </div>
              <div style={{ textAlign: 'center' }}>
                {s.assistSup > 0
                  ? <span style={{ fontSize: '0.72rem', background: '#f0fdf4', color: '#16a34a', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{s.assistSup}</span>
                  : <span style={{ color: '#d1d5db', fontSize: '0.72rem' }}>—</span>}
              </div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {s.ygCounts.map(({ label, count }) => {
                  const multi = count > 1
                  return (
                    <span key={label} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: '0.6rem', padding: '1px 5px', borderRadius: 6,
                      background: multi ? '#fef3c7' : '#f1f5f9',
                      color:      multi ? '#92400e' : '#4a5568',
                      border:     multi ? '1px solid #fde68a' : '1px solid transparent',
                      whiteSpace: 'nowrap',
                    }}>
                      <span>{shortYgName(label)}</span>
                      <span style={{ fontWeight: 800, flexShrink: 0 }}>{count}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Gender balance bars per team */}
      <div style={{ marginTop: 20, background: 'white', border: '1px solid #edf0f7', borderRadius: 12, padding: '16px', boxShadow: '0 1px 4px rgba(15,39,68,0.04)' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#374151', marginBottom: 14 }}>توزيع الجنس لكل فريق</div>
        {stats.map(s => {
          const mPct = s.total ? Math.round((s.males   / s.total) * 100) : 0
          const fPct = s.total ? Math.round((s.females / s.total) * 100) : 0
          return (
            <div key={s.team.team_id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0f2744' }}>{s.team.name}</span>
                <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{s.males}ذ · {s.females}أ{s.unknown > 0 ? ` · ${s.unknown}?` : ''}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${mPct}%`, background: '#60a5fa', transition: '0.3s' }} />
                <div style={{ width: `${fPct}%`, background: '#d946ef', transition: '0.3s' }} />
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#60a5fa', display: 'inline-block' }} />
            <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>ذكور</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#d946ef', display: 'inline-block' }} />
            <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>إناث</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main EventTeams ────────────────────────────────────────────────────────────

export default function EventTeams({ eventId, event, onRefresh, toast }) {
  const [activeTab,      setActiveTab]      = useState('manage')
  const [downloadingDocx, setDownloadingDocx] = useState(false)

  const SUB_TABS = [
    { id: 'manage',  label: 'إدارة الفرق',    icon: Edit2 },
    { id: 'lineup',  label: 'عرض الفرق',       icon: Users },
    { id: 'stats',   label: 'الإحصائيات',      icon: UserCheck },
  ]

  const handleDownloadTeams = async () => {
    setDownloadingDocx(true)
    try {
      const teams   = event.teams || []
      const members = (event.registration?.members || []).filter(m =>
        (m.confirmation_status || 'confirmed') === 'confirmed' && !isAttendanceApologized(m)
      )
      const supers  = (event.registration?.supervisors || []).filter(s => !isAttendanceApologized(s))
      await downloadTeamsDocx(teams, members, supers)
    } catch (e) { toast(e?.message || 'تعذّر إنشاء الملف', 'error') }
    finally { setDownloadingDocx(false) }
  }

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1.5px solid #e2e6ef', marginBottom: 18, overflowX: 'auto', alignItems: 'center' }}>
        {SUB_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '7px 14px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
              fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap',
              background: 'none', color: activeTab === tab.id ? '#0f2744' : '#9ba5bc',
              borderBottom: `2px solid ${activeTab === tab.id ? '#0f2744' : 'transparent'}`,
              marginBottom: -2, transition: '0.15s', display: 'flex', alignItems: 'center', gap: 5,
            }}>
            <tab.icon size={13} /> {tab.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleDownloadTeams}
          disabled={downloadingDocx || !(event.teams?.length > 0)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', border: '1px solid #c5d8f8', borderRadius: 8,
            background: '#f0f4ff', color: '#1d4ed8', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 700,
            opacity: !(event.teams?.length > 0) ? 0.45 : 1,
            marginBottom: 2,
          }}
        >
          <Download size={13} />
          {downloadingDocx ? 'جارٍ...' : 'تنزيل توزيع الفرق'}
        </button>
      </div>

      {activeTab === 'manage'  && <TeamsManager  eventId={eventId} event={event} onRefresh={onRefresh} toast={toast} />}
      {activeTab === 'lineup'  && <TeamsLineup   eventId={eventId} event={event} onRefresh={onRefresh} toast={toast} />}
      {activeTab === 'stats'   && <TeamsDashboard event={event} />}
    </div>
  )
}
