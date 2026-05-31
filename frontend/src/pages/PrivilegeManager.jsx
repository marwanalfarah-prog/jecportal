import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Key, Shield, Users, ChevronDown, ChevronUp, Plus, Trash2,
  Edit3, Search, Filter, CheckCircle2, XCircle, AlertCircle,
  GitBranch, UserCheck, ShieldOff, Eye, RefreshCw, X,
  Lock, Globe, FileText, Settings2, ClipboardCheck,
} from 'lucide-react'
import { api } from '../api.js'

// ── Constants ────────────────────────────────────────────────────────────────

const AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

const PRIVILEGE_LABELS = {
  council_full:      'مجلس كامل (جميع الأعضاء)',
  council_age_group: 'مجلس فئة عمرية',
}

const PRIVILEGE_OPTIONS = [
  { value: 'council_full',      label: 'مجلس كامل (جميع الأعضاء)' },
  { value: 'council_age_group', label: 'مجلس فئة عمرية محددة' },
]

const OVERRIDE_TYPE_LABELS = { grant: 'منح', revoke: 'سحب' }

// ── Color helpers ────────────────────────────────────────────────────────────

const clr = {
  navy:       '#0f2744',
  gold:       '#c9963c',
  goldLight:  '#fef3c7',
  green:      '#059669',
  greenLight: 'rgba(5,150,105,0.1)',
  red:        '#dc2626',
  redLight:   'rgba(220,38,38,0.1)',
  blue:       '#2563eb',
  blueLight:  'rgba(37,99,235,0.1)',
  gray:       '#6b7280',
  grayLight:  '#f8fafc',
  border:     '#e2e6ef',
  white:      '#ffffff',
  textDark:   '#1a2a3a',
  textMuted:  '#6b7280',
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function PrivilegeBadge({ label, source, onRevoke, onDelete, small }) {
  const isOverride   = source === 'override_grant'
  const isRevoked    = source === 'override_revoke'
  const isComputed   = source === 'computed'

  const bg    = isRevoked ? clr.redLight   : isOverride ? clr.greenLight : clr.blueLight
  const color = isRevoked ? clr.red        : isOverride ? clr.green      : clr.blue
  const icon  = isRevoked ? <XCircle size={11}/>
              : isOverride ? <CheckCircle2 size={11}/>
              : <GitBranch size={11}/>
  const tip   = isRevoked ? 'مسحوبة يدوياً'
              : isOverride ? 'ممنوحة يدوياً'
              : 'مكتسبة من المنصب'

  return (
    <span
      title={tip}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: small ? '2px 8px' : '3px 10px',
        borderRadius: 20,
        background: bg, color, fontSize: small ? '0.71rem' : '0.77rem',
        fontWeight: 700, border: `1px solid ${color}33`,
        textDecoration: isRevoked ? 'line-through' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
      {(onRevoke || onDelete) && (
        <button
          onClick={e => { e.stopPropagation(); (onRevoke || onDelete)() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color, opacity: 0.7 }}
          title={onRevoke ? 'سحب الصلاحية' : 'حذف التجاوز'}
        >
          <X size={11}/>
        </button>
      )}
    </span>
  )
}

function StatCard({ icon: Icon, value, label, color }) {
  return (
    <div style={{
      background: clr.white, borderRadius: 14, padding: '18px 22px',
      border: `1px solid ${clr.border}`,
      boxShadow: '0 2px 8px rgba(15,39,68,0.06)',
      display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 130,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={20} color={color}/>
      </div>
      <div>
        <div style={{ fontSize: '1.6rem', fontWeight: 900, color: clr.navy, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: '0.77rem', color: clr.textMuted, marginTop: 3 }}>{label}</div>
      </div>
    </div>
  )
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 800, fontSize: '1rem', color: clr.navy }}>{title}</div>
      {subtitle && <div style={{ fontSize: '0.78rem', color: clr.textMuted, marginTop: 3 }}>{subtitle}</div>}
    </div>
  )
}

// ── Override Add/Edit Modal ───────────────────────────────────────────────────

function OverrideModal({ users, groups, initialData, onSave, onClose }) {
  const isEdit = !!initialData?.id

  const [type,      setType]      = useState(initialData?.type      || 'grant')
  const [username,  setUsername]  = useState(initialData?.username  || '')
  const [privilege, setPrivilege] = useState(initialData?.privilege || 'council_full')
  const [groupId,   setGroupId]   = useState(initialData?.group_id  || '')
  const [ageGroup,  setAgeGroup]  = useState(initialData?.age_group || '')
  const [notes,     setNotes]     = useState(initialData?.notes     || '')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [userSearch, setUserSearch] = useState('')

  const filteredUsers = useMemo(() =>
    users.filter(u => {
      const q = userSearch.trim().toLowerCase()
      if (!q) return true
      return (u.display_name || '').toLowerCase().includes(q) ||
             (u.username || '').toLowerCase().includes(q)
    }), [users, userSearch])

  const needsGroup    = privilege === 'council_full' || privilege === 'council_age_group'
  const needsAgeGroup = privilege === 'council_age_group'

  const handleSave = async () => {
    if (!username) { setError('اختر مستخدماً'); return }
    if (needsGroup && !groupId) { setError('اختر مجموعة الشبيبة'); return }
    if (needsAgeGroup && !ageGroup) { setError('اختر الفئة العمرية'); return }
    setSaving(true); setError('')
    try {
      const selectedUser = users.find(u => u.username === username)
      await onSave({
        id: initialData?.id,
        type, username,
        display_name: selectedUser?.display_name || username,
        privilege, group_id: needsGroup ? groupId : null,
        age_group: needsAgeGroup ? ageGroup : null,
        notes,
      })
      onClose()
    } catch (e) {
      setError(e?.message || 'حدث خطأ أثناء الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle = { fontSize: '0.8rem', color: clr.textDark, fontWeight: 700, display: 'block', marginBottom: 6 }
  const inputStyle = {
    width: '100%', padding: '9px 12px', border: `1.5px solid ${clr.border}`,
    borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.88rem',
    direction: 'rtl', outline: 'none', color: clr.textDark,
    boxSizing: 'border-box',
  }
  const selectStyle = { ...inputStyle, cursor: 'pointer', background: clr.white }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: clr.white, borderRadius: 18, width: '100%', maxWidth: 520,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)', direction: 'rtl', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${clr.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: `linear-gradient(135deg, ${clr.navy}, #1a3a5c)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(201,150,60,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Key size={18} color={clr.gold}/>
            </div>
            <div>
              <div style={{ fontWeight: 800, color: clr.white, fontSize: '0.95rem' }}>
                {isEdit ? 'تعديل تجاوز الصلاحية' : 'إضافة تجاوز صلاحية'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
                منح أو سحب صلاحية من مستخدم
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', borderRadius: 8, padding: 6, color: 'rgba(255,255,255,0.7)', display: 'flex' }}>
            <X size={16}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 22px', display: 'grid', gap: 16 }}>

          {/* Type toggle */}
          <div>
            <label style={labelStyle}>نوع التجاوز</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['grant', 'revoke'].map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontFamily: 'var(--font-body)',
                    fontWeight: 700, fontSize: '0.86rem', cursor: 'pointer',
                    border: `2px solid ${type === t ? (t === 'grant' ? clr.green : clr.red) : clr.border}`,
                    background: type === t ? (t === 'grant' ? clr.greenLight : clr.redLight) : clr.white,
                    color: type === t ? (t === 'grant' ? clr.green : clr.red) : clr.textMuted,
                    transition: '0.15s',
                  }}
                >
                  {t === 'grant' ? '✅ منح الصلاحية' : '🚫 سحب الصلاحية'}
                </button>
              ))}
            </div>
          </div>

          {/* User picker */}
          {!isEdit && (
            <div>
              <label style={labelStyle}>المستخدم</label>
              <div style={{ border: `1.5px solid ${clr.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', borderBottom: `1px solid ${clr.border}`, position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', color: clr.textMuted }}/>
                  <input
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    placeholder="بحث عن مستخدم..."
                    style={{ ...inputStyle, paddingRight: 34, border: 'none', padding: '0 28px 0 0', fontSize: '0.82rem' }}
                  />
                </div>
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {filteredUsers.slice(0, 50).map(u => (
                    <div
                      key={u.username}
                      onClick={() => setUsername(u.username)}
                      style={{
                        padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                        background: username === u.username ? clr.blueLight : 'none',
                        borderBottom: `1px solid ${clr.border}22`,
                        transition: '0.1s',
                      }}
                      onMouseEnter={e => { if (username !== u.username) e.currentTarget.style.background = clr.grayLight }}
                      onMouseLeave={e => { if (username !== u.username) e.currentTarget.style.background = 'none' }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: clr.blueLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <UserCheck size={13} color={clr.blue}/>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: clr.textDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.display_name || u.username}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: clr.textMuted }}>@{u.username}</div>
                      </div>
                      {username === u.username && <CheckCircle2 size={14} color={clr.blue}/>}
                    </div>
                  ))}
                  {filteredUsers.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: clr.textMuted, fontSize: '0.82rem' }}>لا توجد نتائج</div>}
                </div>
              </div>
            </div>
          )}

          {/* Privilege type */}
          <div>
            <label style={labelStyle}>نوع الصلاحية</label>
            <select value={privilege} onChange={e => setPrivilege(e.target.value)} style={selectStyle}>
              {PRIVILEGE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Group */}
          {needsGroup && (
            <div>
              <label style={labelStyle}>فرقة الشبيبة</label>
              <select value={groupId} onChange={e => setGroupId(e.target.value)} style={selectStyle}>
                <option value="">-- اختر فرقة --</option>
                {groups.map(g => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Age group */}
          {needsAgeGroup && (
            <div>
              <label style={labelStyle}>الفئة العمرية</label>
              <select value={ageGroup} onChange={e => setAgeGroup(e.target.value)} style={selectStyle}>
                <option value="">-- اختر فئة عمرية --</option>
                {AGE_GROUPS.map(ag => (
                  <option key={ag} value={ag}>{ag}</option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={labelStyle}>ملاحظات (اختياري)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="سبب التجاوز أو ملاحظة..."
              style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
            />
          </div>

          {error && (
            <div style={{ background: clr.redLight, color: clr.red, borderRadius: 8, padding: '10px 14px', fontSize: '0.83rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={14}/>{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: `1px solid ${clr.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>إلغاء</button>
          <button
            className="btn btn-gold btn-sm"
            onClick={handleSave}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {saving ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}/>جاري الحفظ</> : <><Key size={14}/>حفظ التجاوز</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete Confirmation Modal ─────────────────────────────────────────────────

function DeleteConfirm({ message, onConfirm, onClose }) {
  const [deleting, setDeleting] = useState(false)
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: clr.white, borderRadius: 14, width: '100%', maxWidth: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.2)', direction: 'rtl', overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px', background: clr.redLight, borderBottom: `1px solid ${clr.red}33` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <XCircle size={22} color={clr.red}/>
            <div style={{ fontWeight: 800, color: clr.red }}>تأكيد الحذف</div>
          </div>
        </div>
        <div style={{ padding: '18px 20px', fontSize: '0.87rem', color: clr.textDark }}>{message}</div>
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${clr.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={deleting}>إلغاء</button>
          <button
            className="btn btn-sm"
            onClick={async () => { setDeleting(true); await onConfirm(); setDeleting(false); onClose() }}
            disabled={deleting}
            style={{ background: clr.red, color: clr.white, border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {deleting ? 'جاري الحذف...' : <><Trash2 size={13}/>حذف</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Capabilities Panel ───────────────────────────────────────────────────────

const CATEGORY_ICONS = {
  'النظام':              Settings2,
  'إدارة الأعضاء':      Users,
  'الطلبات والموافقات': ClipboardCheck,
  'المحتوى':            FileText,
  'الوصول العام':        Globe,
}

const SOURCE_LABELS = {
  role:    { label: 'الدور',   color: '#b45309', bg: '#fffbeb' },
  council: { label: 'المنصب', color: '#2563eb', bg: '#eff6ff' },
}

const SCOPE_LABELS = {
  full:    { label: 'كامل',   color: '#059669' },
  partial: { label: 'جزئي',   color: '#d97706' },
  own:     { label: 'خاص به', color: '#6b7280' },
}

function CapabilitiesPanel({ capabilities }) {
  if (!capabilities || capabilities.length === 0) return null

  const grouped = {}
  for (const cap of capabilities) {
    if (!grouped[cap.category]) grouped[cap.category] = []
    grouped[cap.category].push(cap)
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${clr.border}` }}>
      <div style={{ fontSize: '0.77rem', fontWeight: 800, color: clr.navy, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lock size={13} color={clr.navy}/>الصلاحيات الوظيفية التفصيلية
        <span style={{ fontSize: '0.7rem', color: clr.textMuted, fontWeight: 400, marginRight: 4 }}>
          — ما يستطيع هذا المستخدم فعله في النظام
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: 10 }}>
        {Object.entries(grouped).map(([category, caps]) => {
          const Icon = CATEGORY_ICONS[category] || Globe
          const grantedCount = caps.filter(c => c.granted).length
          return (
            <div key={category} style={{
              background: clr.white, borderRadius: 10,
              border: `1px solid ${clr.border}`, overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 12px', background: '#f1f5f9',
                borderBottom: `1px solid ${clr.border}`,
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
                <Icon size={13} color={clr.navy}/>
                <span style={{ fontSize: '0.76rem', fontWeight: 800, color: clr.navy, flex: 1 }}>{category}</span>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 700,
                  background: grantedCount > 0 ? clr.greenLight : clr.grayLight,
                  color: grantedCount > 0 ? clr.green : clr.textMuted,
                  padding: '1px 7px', borderRadius: 20,
                }}>
                  {grantedCount}/{caps.length}
                </span>
              </div>
              <div>
                {caps.map((cap, ci) => {
                  const srcInfo   = cap.source ? SOURCE_LABELS[cap.source]  : null
                  const scopeInfo = cap.scope  ? SCOPE_LABELS[cap.scope]    : null
                  return (
                    <div
                      key={cap.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px',
                        background: cap.granted ? 'none' : `${clr.grayLight}88`,
                        borderBottom: ci < caps.length - 1 ? `1px solid ${clr.border}33` : 'none',
                      }}
                    >
                      <div style={{ flexShrink: 0, width: 16, display: 'flex', justifyContent: 'center' }}>
                        {cap.granted
                          ? <CheckCircle2 size={13} color={clr.green}/>
                          : <XCircle size={13} color="#d1d5db"/>
                        }
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '0.76rem',
                          color: cap.granted ? clr.textDark : '#9ca3af',
                          fontWeight: cap.granted ? 600 : 400,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {cap.label}
                        </div>
                        {cap.granted && cap.detail && (
                          <div style={{ fontSize: '0.65rem', color: clr.textMuted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cap.detail}
                          </div>
                        )}
                      </div>
                      {cap.granted && srcInfo && (
                        <span style={{ fontSize: '0.63rem', fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: srcInfo.bg, color: srcInfo.color, whiteSpace: 'nowrap', flexShrink: 0, border: `1px solid ${srcInfo.color}30` }}>
                          {srcInfo.label}
                        </span>
                      )}
                      {cap.granted && scopeInfo && (
                        <span style={{ fontSize: '0.61rem', fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: `${scopeInfo.color}15`, color: scopeInfo.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {scopeInfo.label}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: User Privileges ──────────────────────────────────────────────────────

function UserPrivilegesTab({ matrix, groups, onRefresh, toast }) {
  const [search,        setSearch]        = useState('')
  const [filterGroup,   setFilterGroup]   = useState('')
  const [filterPriv,    setFilterPriv]    = useState('')
  const [filterRole,    setFilterRole]    = useState('')
  const [expanded,      setExpanded]      = useState(new Set())
  const [showAddModal,  setShowAddModal]  = useState(false)
  const [addInitUser,   setAddInitUser]   = useState(null)
  const [deleteTarget,  setDeleteTarget]  = useState(null)

  const users = matrix?.users || []

  const filtered = useMemo(() => {
    return users.filter(u => {
      const q = search.trim().toLowerCase()
      if (q && !(u.display_name || '').toLowerCase().includes(q) && !(u.username || '').toLowerCase().includes(q)) return false
      if (filterRole && u.role !== filterRole) return false
      if (filterGroup) {
        const hasGroup = u.effective_council && u.effective_council[filterGroup]
        if (!hasGroup) return false
      }
      if (filterPriv === 'admin' && u.role !== 'admin') return false
      if (filterPriv === 'council' && (!u.effective_council || Object.keys(u.effective_council).length === 0)) return false
      if (filterPriv === 'override' && (!u.overrides || u.overrides.length === 0)) return false
      if (filterPriv === 'none' && (u.role === 'admin' || (u.effective_council && Object.keys(u.effective_council).length > 0))) return false
      return true
    })
  }, [users, search, filterGroup, filterPriv, filterRole])

  const toggleExpand = (username) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(username) ? next.delete(username) : next.add(username)
      return next
    })
  }

  const handleCreateOverride = async (data) => {
    await api.createPrivilegeOverride(data)
    toast('تم إضافة التجاوز بنجاح', 'success')
    onRefresh()
  }

  const handleDeleteOverride = async (overrideId) => {
    await api.deletePrivilegeOverride(overrideId)
    toast('تم حذف التجاوز', 'success')
    onRefresh()
  }

  const inputStyle = {
    padding: '8px 12px', border: `1.5px solid ${clr.border}`, borderRadius: 8,
    fontFamily: 'var(--font-body)', fontSize: '0.84rem', direction: 'rtl', outline: 'none',
    color: clr.textDark, background: clr.white,
  }
  const selectStyle = { ...inputStyle, cursor: 'pointer', paddingLeft: 28 }

  return (
    <div>
      {/* Filter bar */}
      <div style={{
        background: clr.white, borderRadius: 12, padding: '14px 16px',
        border: `1px solid ${clr.border}`, marginBottom: 16,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
          <Search size={13} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: clr.textMuted, pointerEvents: 'none' }}/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو المستخدم..."
            style={{ ...inputStyle, width: '100%', paddingRight: 32, boxSizing: 'border-box' }}
          />
        </div>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={selectStyle}>
          <option value="">جميع الأدوار</option>
          <option value="admin">مدير</option>
          <option value="member">عضو</option>
        </select>
        <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} style={selectStyle}>
          <option value="">جميع المجموعات</option>
          {groups.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <select value={filterPriv} onChange={e => setFilterPriv(e.target.value)} style={selectStyle}>
          <option value="">جميع الصلاحيات</option>
          <option value="admin">المديرون</option>
          <option value="council">أعضاء المجلس</option>
          <option value="override">يمتلكون تجاوزات</option>
          <option value="none">بلا صلاحيات خاصة</option>
        </select>
        <button
          className="btn btn-gold btn-sm"
          onClick={() => { setAddInitUser(null); setShowAddModal(true) }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <Plus size={14}/>إضافة تجاوز
        </button>
      </div>

      {/* Count */}
      <div style={{ fontSize: '0.78rem', color: clr.textMuted, marginBottom: 10, paddingRight: 4 }}>
        {filtered.length} من {users.length} مستخدم
      </div>

      {/* Table */}
      <div style={{ background: clr.white, borderRadius: 14, border: `1px solid ${clr.border}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,39,68,0.05)' }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 3fr 70px 80px 52px',
          padding: '11px 18px', background: '#f8f9fc',
          borderBottom: `1px solid ${clr.border}`,
          fontSize: '0.76rem', fontWeight: 800, color: clr.textMuted,
          gap: 8,
        }}>
          <div>المستخدم</div>
          <div>الدور</div>
          <div>صلاحيات المجلس</div>
          <div style={{ textAlign: 'center' }}>قدرات</div>
          <div style={{ textAlign: 'center' }}>تجاوزات</div>
          <div/>
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: clr.textMuted }}>
            <Filter size={32} style={{ opacity: 0.3, display: 'block', margin: '0 auto 12px' }}/>
            <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>لا توجد نتائج</div>
          </div>
        )}

        {filtered.map((u, idx) => {
          const isExp = expanded.has(u.username)
          const isAdmin = u.role === 'admin'
          const council = u.effective_council || {}
          const computedCouncil = u.computed_council || {}
          const overrides = u.overrides || []
          const hasPrivs = isAdmin || Object.keys(council).length > 0

          return (
            <div key={u.username} style={{ borderBottom: idx < filtered.length - 1 ? `1px solid ${clr.border}` : 'none' }}>
              {/* Main row */}
              <div
                style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 3fr 70px 80px 52px',
                  padding: '13px 18px', gap: 8, alignItems: 'center',
                  cursor: 'pointer', transition: '0.1s',
                  background: isExp ? '#f8f9fc' : 'none',
                }}
                onClick={() => toggleExpand(u.username)}
                onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = '#fafbfd' }}
                onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = 'none' }}
              >
                {/* Name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                    background: isAdmin ? 'rgba(201,150,60,0.15)' : clr.blueLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1.5px solid ${isAdmin ? 'rgba(201,150,60,0.4)' : clr.border}`,
                  }}>
                    {isAdmin
                      ? <Shield size={15} color={clr.gold}/>
                      : <UserCheck size={15} color={clr.blue}/>
                    }
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: clr.textDark, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.display_name || u.username}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: clr.textMuted }}>@{u.username}</div>
                  </div>
                </div>

                {/* Role */}
                <div>
                  <span style={{
                    fontSize: '0.74rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                    background: isAdmin ? clr.goldLight : clr.grayLight,
                    color: isAdmin ? '#92400e' : clr.textMuted,
                    border: `1px solid ${isAdmin ? '#fde68a' : clr.border}`,
                    whiteSpace: 'nowrap',
                  }}>
                    {isAdmin ? '👑 مدير' : '🙍 عضو'}
                  </span>
                </div>

                {/* Privileges summary */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {isAdmin && (
                    <PrivilegeBadge label="وصول المدير الكامل" source="computed" small/>
                  )}
                  {Object.entries(council).slice(0, 3).map(([gid, info]) => {
                    const isFromOverride = overrides.some(
                      o => o.privilege === 'council_full' && o.group_id === gid && o.type === 'grant'
                    )
                    const isComputed = !!computedCouncil[gid]
                    const source = isFromOverride && !isComputed ? 'override_grant' : 'computed'
                    const groupName = info.group_name && !api.isRawYouthGroupIdentifier(info.group_name)
                      ? info.group_name
                      : api.formatYouthGroupLabel(gid)
                    return (
                      <PrivilegeBadge
                        key={gid}
                        label={`${groupName}${info.full_group ? '' : ` · ${(info.age_groups || []).slice(0, 2).join('، ')}${(info.age_groups || []).length > 2 ? '...' : ''}`}`}
                        source={source}
                        small
                      />
                    )
                  })}
                  {Object.keys(council).length > 3 && (
                    <span style={{ fontSize: '0.72rem', color: clr.textMuted, padding: '3px 8px' }}>
                      +{Object.keys(council).length - 3} أخرى
                    </span>
                  )}
                  {!hasPrivs && (
                    <span style={{ fontSize: '0.75rem', color: clr.textMuted, fontStyle: 'italic' }}>لا توجد صلاحيات خاصة</span>
                  )}
                </div>

                {/* Capabilities count */}
                <div style={{ textAlign: 'center' }}>
                  {(() => {
                    const granted = (u.capabilities || []).filter(c => c.granted).length
                    const total   = (u.capabilities || []).length
                    return total > 0 ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        background: clr.blueLight, color: clr.blue,
                        fontSize: '0.74rem', fontWeight: 800,
                        padding: '3px 9px', borderRadius: 20, border: `1px solid ${clr.blue}33`,
                      }}>
                        <Lock size={10}/>{granted}/{total}
                      </span>
                    ) : <span style={{ fontSize: '0.75rem', color: clr.textMuted }}>—</span>
                  })()}
                </div>

                {/* Override count */}
                <div style={{ textAlign: 'center' }}>
                  {overrides.length > 0 ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: clr.greenLight, color: clr.green,
                      fontSize: '0.76rem', fontWeight: 800,
                      padding: '3px 10px', borderRadius: 20, border: `1px solid ${clr.green}33`,
                    }}>
                      <Key size={11}/>{overrides.length}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: clr.textMuted }}>—</span>
                  )}
                </div>

                {/* Expand arrow */}
                <div style={{ display: 'flex', justifyContent: 'center', color: clr.textMuted }}>
                  {isExp ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                </div>
              </div>

              {/* Expanded detail */}
              {isExp && (
                <div style={{ padding: '0 18px 18px', background: '#f8f9fc', borderTop: `1px solid ${clr.border}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, paddingTop: 14 }}>

                    {/* Effective privileges */}
                    <div>
                      <div style={{ fontSize: '0.77rem', fontWeight: 800, color: clr.navy, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle2 size={13} color={clr.blue}/>الصلاحيات الفعّالة
                      </div>
                      {isAdmin && (
                        <div style={{ marginBottom: 6 }}>
                          <PrivilegeBadge label="مدير النظام — وصول كامل" source="computed"/>
                        </div>
                      )}
                      {Object.entries(council).map(([gid, info]) => {
                        const fromGrant = overrides.find(o => o.privilege === 'council_full' && o.group_id === gid && o.type === 'grant')
                        const fromAgGrant = overrides.filter(o => o.privilege === 'council_age_group' && o.group_id === gid && o.type === 'grant')
                        const isOverrideSource = !!fromGrant && !computedCouncil[gid]
                        const groupName = info.group_name && !api.isRawYouthGroupIdentifier(info.group_name)
                          ? info.group_name
                          : api.formatYouthGroupLabel(gid)
                        return (
                          <div key={gid} style={{ marginBottom: 8, padding: '10px 12px', background: clr.white, borderRadius: 10, border: `1px solid ${clr.border}` }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: clr.navy, marginBottom: 6 }}>
                              {groupName}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {info.full_group ? (
                                <PrivilegeBadge label="جميع الأعضاء" source={isOverrideSource ? 'override_grant' : 'computed'} small/>
                              ) : (
                                (info.age_groups || []).map(ag => {
                                  const fromAg = fromAgGrant.find(o => o.age_group === ag)
                                  const agComputed = computedCouncil[gid]?.age_groups?.includes(ag)
                                  return (
                                    <PrivilegeBadge
                                      key={ag} label={ag}
                                      source={fromAg && !agComputed ? 'override_grant' : 'computed'}
                                      small
                                    />
                                  )
                                })
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {!isAdmin && Object.keys(council).length === 0 && (
                        <div style={{ fontSize: '0.8rem', color: clr.textMuted, fontStyle: 'italic' }}>لا توجد صلاحيات مجلس</div>
                      )}
                    </div>

                    {/* Overrides */}
                    <div>
                      <div style={{ fontSize: '0.77rem', fontWeight: 800, color: clr.navy, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Key size={13} color={clr.gold}/>التجاوزات اليدوية
                        <button
                          onClick={(e) => { e.stopPropagation(); setAddInitUser(u); setShowAddModal(true) }}
                          style={{ marginRight: 'auto', background: clr.navy, color: clr.white, border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Plus size={11}/>إضافة
                        </button>
                      </div>
                      {overrides.length === 0 && (
                        <div style={{ fontSize: '0.8rem', color: clr.textMuted, fontStyle: 'italic' }}>لا توجد تجاوزات يدوية</div>
                      )}
                      {overrides.map(o => (
                        <div key={o.id} style={{
                          padding: '9px 12px', background: clr.white, borderRadius: 10,
                          border: `1px solid ${o.type === 'grant' ? clr.green + '44' : clr.red + '44'}`,
                          marginBottom: 7, display: 'flex', alignItems: 'flex-start', gap: 10,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <span style={{
                                fontSize: '0.71rem', fontWeight: 800, padding: '1px 8px', borderRadius: 20,
                                background: o.type === 'grant' ? clr.greenLight : clr.redLight,
                                color: o.type === 'grant' ? clr.green : clr.red,
                              }}>
                                {o.type === 'grant' ? '✅ منح' : '🚫 سحب'}
                              </span>
                              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: clr.textDark }}>
                                {PRIVILEGE_LABELS[o.privilege] || o.privilege}
                              </span>
                            </div>
                            {o.group_name && (
                              <div style={{ fontSize: '0.73rem', color: clr.textMuted, marginRight: 4 }}>
                                {o.group_name}{o.age_group ? ` · ${o.age_group}` : ''}
                              </div>
                            )}
                            {o.notes && <div style={{ fontSize: '0.72rem', color: clr.textMuted, fontStyle: 'italic', marginTop: 4 }}>{o.notes}</div>}
                            <div style={{ fontSize: '0.7rem', color: clr.textMuted, marginTop: 3 }}>
                              بواسطة: {o.created_by}
                            </div>
                          </div>
                          <button
                            onClick={() => setDeleteTarget(o)}
                            style={{ background: clr.redLight, color: clr.red, border: 'none', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
                            title="حذف التجاوز"
                          >
                            <Trash2 size={13}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Capabilities */}
                  <CapabilitiesPanel capabilities={u.capabilities}/>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modals */}
      {showAddModal && (
        <OverrideModal
          users={users}
          groups={groups}
          initialData={addInitUser ? { username: addInitUser.username } : null}
          onSave={handleCreateOverride}
          onClose={() => { setShowAddModal(false); setAddInitUser(null) }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          message={`هل تريد حذف تجاوز "${PRIVILEGE_LABELS[deleteTarget.privilege] || deleteTarget.privilege}" من المستخدم @${deleteTarget.username}؟`}
          onConfirm={() => handleDeleteOverride(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── Tab: Positions Matrix ────────────────────────────────────────────────────

function PositionsTab({ positions }) {
  const [search,      setSearch]      = useState('')
  const [filterGroup, setFilterGroup] = useState('')

  const filtered = useMemo(() => {
    return (positions || []).filter(p => {
      if (filterGroup && p.group_id !== filterGroup) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const matchGroup = (p.group_name || '').toLowerCase().includes(q)
        const matchNode  = (p.nodes || []).some(n =>
          (n.display_name || '').toLowerCase().includes(q) ||
          (n.role_title   || '').toLowerCase().includes(q)
        )
        if (!matchGroup && !matchNode) return false
      }
      return true
    })
  }, [positions, search, filterGroup])

  const allGroups = useMemo(() =>
    (positions || []).map(p => ({
      value: p.group_id,
      label: p.group_name && !api.isRawYouthGroupIdentifier(p.group_name)
        ? p.group_name
        : api.formatYouthGroupLabel(p.group_id),
    }))
  , [positions])

  const TIER_LABELS = {
    general_manager:           'المسؤول العام',
    spiritual_guide:           'المرشد الروحي',
    spiritual_guide_assistant: 'مساعد المرشد الروحي',
    reports_to_gm:             'مسؤول فئة',
    council_head:              'مجلس فئة',
    spiritual_guide_agegroup:  'مرشد روحي فئة',
  }

  return (
    <div>
      {/* Filters */}
      <div style={{
        background: clr.white, borderRadius: 12, padding: '14px 16px',
        border: `1px solid ${clr.border}`, marginBottom: 16,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={13} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: clr.textMuted, pointerEvents: 'none' }}/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو المنصب..."
            style={{ padding: '8px 36px 8px 12px', border: `1.5px solid ${clr.border}`, borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.84rem', direction: 'rtl', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <select
          value={filterGroup}
          onChange={e => setFilterGroup(e.target.value)}
          style={{ padding: '8px 12px', border: `1.5px solid ${clr.border}`, borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.84rem', direction: 'rtl', outline: 'none', cursor: 'pointer', background: clr.white }}
        >
          <option value="">جميع المجموعات</option>
          {allGroups.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: clr.textMuted }}>
          <GitBranch size={36} style={{ opacity: 0.3, display: 'block', margin: '0 auto 12px' }}/>
          <div style={{ fontWeight: 700 }}>لا توجد مناصب مرتبطة بصلاحيات</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {filtered.map(group => (
          <div key={group.group_id} style={{ background: clr.white, borderRadius: 14, border: `1px solid ${clr.border}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,39,68,0.05)' }}>
            {/* Group header */}
            <div style={{
              padding: '13px 18px', background: `linear-gradient(135deg, ${clr.navy}f0, #1a3a5c)`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(201,150,60,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <GitBranch size={15} color={clr.gold}/>
              </div>
              <div>
                <div style={{ fontWeight: 800, color: clr.white, fontSize: '0.92rem' }}>
                  {group.group_name && !api.isRawYouthGroupIdentifier(group.group_name)
                    ? group.group_name
                    : api.formatYouthGroupLabel(group.group_id)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
                  {(group.nodes || []).length} منصب يمنح صلاحيات
                </div>
              </div>
            </div>

            {/* Nodes */}
            <div>
              {(group.nodes || []).map((node, ni) => (
                <div
                  key={ni}
                  style={{
                    padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14,
                    borderBottom: ni < group.nodes.length - 1 ? `1px solid ${clr.border}` : 'none',
                  }}
                >
                  {/* Position avatar */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: node.full_group ? 'rgba(201,150,60,0.12)' : clr.blueLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1.5px solid ${node.full_group ? 'rgba(201,150,60,0.4)' : clr.border}`,
                  }}>
                    {node.full_group
                      ? <Shield size={16} color={clr.gold}/>
                      : <UserCheck size={16} color={clr.blue}/>
                    }
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: clr.textDark, marginBottom: 2 }}>
                      {node.display_name || '(غير محدد)'}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: clr.textMuted }}>
                      {node.role_title}
                    </div>
                  </div>

                  {/* Privileges */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-start' }}>
                    {node.full_group ? (
                      <PrivilegeBadge label="مجلس كامل" source="computed" small/>
                    ) : (
                      (node.age_groups || []).map(ag => (
                        <PrivilegeBadge key={ag} label={ag} source="computed" small/>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tab: All Overrides ───────────────────────────────────────────────────────

function OverridesTab({ overrides: rawOverrides, users, groups, onRefresh, toast }) {
  const [search,       setSearch]       = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterPriv,   setFilterPriv]   = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editTarget,   setEditTarget]   = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const overrides = rawOverrides || []

  const filtered = useMemo(() => {
    return overrides.filter(o => {
      if (filterType && o.type !== filterType) return false
      if (filterPriv && o.privilege !== filterPriv) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        return (
          (o.username || '').toLowerCase().includes(q) ||
          (o.display_name || '').toLowerCase().includes(q) ||
          (o.group_name || '').toLowerCase().includes(q) ||
          (o.notes || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [overrides, search, filterType, filterPriv])

  const handleCreate = async (data) => {
    await api.createPrivilegeOverride(data)
    toast('تم إضافة التجاوز', 'success')
    onRefresh()
  }

  const handleEdit = async (data) => {
    await api.updatePrivilegeOverride(data.id, data)
    toast('تم تعديل التجاوز', 'success')
    onRefresh()
  }

  const handleDelete = async (id) => {
    await api.deletePrivilegeOverride(id)
    toast('تم حذف التجاوز', 'success')
    onRefresh()
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{
        background: clr.white, borderRadius: 12, padding: '14px 16px',
        border: `1px solid ${clr.border}`, marginBottom: 16,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={13} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: clr.textMuted, pointerEvents: 'none' }}/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث..."
            style={{ padding: '8px 36px 8px 12px', border: `1.5px solid ${clr.border}`, borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.84rem', direction: 'rtl', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '8px 12px', border: `1.5px solid ${clr.border}`, borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.84rem', direction: 'rtl', outline: 'none', cursor: 'pointer', background: clr.white }}>
          <option value="">جميع الأنواع</option>
          <option value="grant">منح</option>
          <option value="revoke">سحب</option>
        </select>
        <select value={filterPriv} onChange={e => setFilterPriv(e.target.value)}
          style={{ padding: '8px 12px', border: `1.5px solid ${clr.border}`, borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.84rem', direction: 'rtl', outline: 'none', cursor: 'pointer', background: clr.white }}>
          <option value="">جميع الصلاحيات</option>
          {PRIVILEGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          className="btn btn-gold btn-sm"
          onClick={() => setShowAddModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <Plus size={14}/>إضافة تجاوز
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: clr.textMuted, marginBottom: 10, paddingRight: 4 }}>
        {filtered.length} تجاوز
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: clr.textMuted, background: clr.white, borderRadius: 14, border: `1px solid ${clr.border}` }}>
          <Key size={36} style={{ opacity: 0.25, display: 'block', margin: '0 auto 12px' }}/>
          <div style={{ fontWeight: 700 }}>لا توجد تجاوزات</div>
          <div style={{ fontSize: '0.82rem', marginTop: 6 }}>أضف تجاوزاً لمنح أو سحب صلاحية من مستخدم</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {filtered.map(o => (
          <div key={o.id} style={{
            background: clr.white, borderRadius: 12,
            border: `1px solid ${o.type === 'grant' ? clr.green + '55' : clr.red + '55'}`,
            padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14,
            boxShadow: '0 1px 4px rgba(15,39,68,0.05)',
          }}>
            {/* Type icon */}
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: o.type === 'grant' ? clr.greenLight : clr.redLight,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1.5px solid ${o.type === 'grant' ? clr.green + '44' : clr.red + '44'}`,
            }}>
              {o.type === 'grant'
                ? <CheckCircle2 size={18} color={clr.green}/>
                : <ShieldOff size={18} color={clr.red}/>
              }
            </div>

            {/* Details */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{
                  fontSize: '0.72rem', fontWeight: 800, padding: '2px 9px', borderRadius: 20,
                  background: o.type === 'grant' ? clr.greenLight : clr.redLight,
                  color: o.type === 'grant' ? clr.green : clr.red,
                  border: `1px solid ${o.type === 'grant' ? clr.green + '44' : clr.red + '44'}`,
                }}>
                  {OVERRIDE_TYPE_LABELS[o.type] || o.type}
                </span>
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: clr.textDark }}>
                  {PRIVILEGE_LABELS[o.privilege] || o.privilege}
                </span>
                {o.group_name && (
                  <span style={{ fontSize: '0.78rem', color: clr.textMuted }}>
                    — {o.group_name}{o.age_group ? ` (${o.age_group})` : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: clr.navy, fontWeight: 700, marginBottom: 3 }}>
                {o.display_name || o.username}
                <span style={{ fontWeight: 400, color: clr.textMuted, marginRight: 6 }}>@{o.username}</span>
              </div>
              {o.notes && (
                <div style={{ fontSize: '0.75rem', color: clr.textMuted, fontStyle: 'italic', marginBottom: 3 }}>{o.notes}</div>
              )}
              <div style={{ fontSize: '0.7rem', color: clr.textMuted }}>
                أُضيف بواسطة {o.created_by} · {o.created_at ? new Date(o.created_at).toLocaleDateString('ar-SA') : ''}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => setEditTarget(o)}
                style={{ background: clr.grayLight, border: `1px solid ${clr.border}`, color: clr.textMuted, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', fontFamily: 'var(--font-body)' }}
                title="تعديل"
              >
                <Edit3 size={13}/>
              </button>
              <button
                onClick={() => setDeleteTarget(o)}
                style={{ background: clr.redLight, border: `1px solid ${clr.red}33`, color: clr.red, borderRadius: 7, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', fontFamily: 'var(--font-body)' }}
                title="حذف"
              >
                <Trash2 size={13}/>
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAddModal && (
        <OverrideModal users={users} groups={groups} initialData={null} onSave={handleCreate} onClose={() => setShowAddModal(false)}/>
      )}
      {editTarget && (
        <OverrideModal users={users} groups={groups} initialData={editTarget} onSave={handleEdit} onClose={() => setEditTarget(null)}/>
      )}
      {deleteTarget && (
        <DeleteConfirm
          message={`هل تريد حذف تجاوز "${PRIVILEGE_LABELS[deleteTarget.privilege] || deleteTarget.privilege}" من المستخدم @${deleteTarget.username}؟`}
          onConfirm={() => handleDelete(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PrivilegeManager({ toast }) {
  const [matrix,    setMatrix]    = useState(null)
  const [positions, setPositions] = useState(null)
  const [groups,    setGroups]    = useState([])
  const [tab,       setTab]       = useState('users')
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [matRes, posRes, filRes] = await Promise.all([
        api.getPrivilegeMatrix(),
        api.getPrivilegePositions(),
        api.filters(),
      ])
      setMatrix(matRes)
      setPositions(posRes.positions || [])
      const gList = (filRes?.youth_group || []).map(yg => ({
        value: String(yg?.value || ''),
        label: api.formatYouthGroupLabel(yg?.label || yg?.value || ''),
      })).filter(g => g.value)
      setGroups(gList)
    } catch (e) {
      setError(e?.message || 'تعذّر تحميل بيانات الصلاحيات')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Computed stats
  const users = matrix?.users || []
  const statsAdmins    = users.filter(u => u.role === 'admin').length
  const statsCouncil   = users.filter(u => u.role !== 'admin' && u.effective_council && Object.keys(u.effective_council).length > 0).length
  const statsOverrides = users.reduce((acc, u) => acc + (u.overrides?.length || 0), 0)
  const allOverrides   = users.flatMap(u => u.overrides || [])

  const TABS = [
    { id: 'users',     label: 'صلاحيات الأعضاء',     icon: Users },
    { id: 'positions', label: 'المناصب والصلاحيات',   icon: GitBranch },
    { id: 'overrides', label: 'التجاوزات اليدوية',    icon: Key },
  ]

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16 }}>
        <div className="spinner" style={{ width: 40, height: 40, borderWidth: 4 }}/>
        <div style={{ color: clr.textMuted, fontSize: '0.88rem' }}>جارٍ تحميل بيانات الصلاحيات...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ background: clr.redLight, color: clr.red, borderRadius: 12, padding: '20px 24px', display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: 500 }}>
          <AlertCircle size={22} style={{ flexShrink: 0, marginTop: 2 }}/>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>تعذّر التحميل</div>
            <div style={{ fontSize: '0.85rem' }}>{error}</div>
            <button className="btn btn-sm" onClick={load} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, background: clr.red, color: clr.white, border: 'none' }}>
              <RefreshCw size={13}/>إعادة المحاولة
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 28px', direction: 'rtl', maxWidth: 1100, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${clr.navy}, #1a3a5c)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Key size={22} color={clr.gold}/>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: clr.navy }}>
                مدير صلاحيات المناصب
              </h1>
              <p style={{ margin: 0, fontSize: '0.8rem', color: clr.textMuted, marginTop: 2 }}>
                عرض وإدارة الصلاحيات المكتسبة من المناصب والتجاوزات اليدوية
              </p>
            </div>
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={load}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14}/>تحديث
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatCard icon={Users}        value={users.length}   label="إجمالي المستخدمين" color={clr.blue}/>
        <StatCard icon={Shield}       value={statsAdmins}    label="مديرو النظام"        color={clr.gold}/>
        <StatCard icon={UserCheck}    value={statsCouncil}   label="أعضاء المجلس"       color={clr.green}/>
        <StatCard icon={Key}          value={statsOverrides} label="تجاوزات يدوية"       color={clr.red}/>
      </div>

      {/* Legend */}
      <div style={{
        background: clr.white, borderRadius: 10, padding: '10px 16px',
        border: `1px solid ${clr.border}`, marginBottom: 20,
        display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: clr.textMuted }}>مفتاح الألوان:</span>
        {[
          { color: clr.blue,  label: 'مكتسبة من المنصب', icon: <GitBranch size={11}/> },
          { color: clr.green, label: 'ممنوحة يدوياً',     icon: <CheckCircle2 size={11}/> },
          { color: clr.red,   label: 'مسحوبة يدوياً',    icon: <XCircle size={11}/> },
        ].map(({ color, label, icon }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: `${color}18`, color, fontSize: '0.72rem', fontWeight: 700, border: `1px solid ${color}33` }}>
              {icon}{label}
            </span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        background: clr.white, borderRadius: 12, padding: 5,
        border: `1px solid ${clr.border}`, width: 'fit-content',
      }}>
        {TABS.map(t => {
          const isActive = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 8,
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)',
                fontWeight: isActive ? 800 : 600, fontSize: '0.84rem',
                background: isActive ? clr.navy : 'none',
                color: isActive ? clr.white : clr.textMuted,
                transition: '0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = clr.grayLight }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none' }}
            >
              <t.icon size={15}/>
              {t.label}
              {t.id === 'overrides' && statsOverrides > 0 && (
                <span style={{ background: clr.gold, color: clr.white, fontSize: '0.68rem', fontWeight: 900, padding: '1px 7px', borderRadius: 20, marginRight: 2 }}>
                  {statsOverrides}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'users' && (
        <UserPrivilegesTab
          matrix={matrix}
          groups={groups}
          onRefresh={load}
          toast={toast}
        />
      )}
      {tab === 'positions' && (
        <PositionsTab positions={positions}/>
      )}
      {tab === 'overrides' && (
        <OverridesTab
          overrides={allOverrides}
          users={users}
          groups={groups}
          onRefresh={load}
          toast={toast}
        />
      )}
    </div>
  )
}
