import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, RefreshCw, ClipboardList, User, Users, Shield, ExternalLink } from 'lucide-react'
import { api, getApiErrorMessage } from '../api.js'

const STATUS_COLORS = {
  pending:  { bg: '#fffbeb', border: '#fde68a', text: '#92400e', icon: Clock,        label: 'قيد الانتظار' },
  approved: { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: CheckCircle,  label: 'تمت الموافقة' },
  rejected: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: XCircle,      label: 'مرفوض' },
}

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.pending
  const Icon = s.icon
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.bg, border: `1px solid ${s.border}`, color: s.text,
      borderRadius: 20, padding: '3px 10px', fontSize: '0.76rem', fontWeight: 700,
    }}>
      <Icon size={12} /> {s.label}
    </span>
  )
}

function ApproveRejectButtons({ onApprove, onReject, loading }) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [reason, setReason] = useState('')

  if (showRejectInput) {
    return (
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="سبب الرفض (اختياري)…"
          style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1.5px solid #fca5a5', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.83rem', direction: 'rtl', outline: 'none' }}
        />
        <button onClick={() => onReject(reason)} disabled={loading} style={{ padding: '7px 14px', background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#991b1b', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700 }}>
          تأكيد الرفض
        </button>
        <button onClick={() => { setShowRejectInput(false); setReason('') }} style={{ padding: '7px 10px', background: 'none', border: '1px solid #e2e6ef', borderRadius: 8, cursor: 'pointer', color: '#9ba5bc', fontFamily: 'var(--font-body)', fontSize: '0.82rem' }}>
          إلغاء
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
      <button onClick={onApprove} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: 8, color: '#166534', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700 }}>
        <CheckCircle size={14} /> موافقة
      </button>
      <button onClick={() => setShowRejectInput(true)} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 8, color: '#991b1b', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700 }}>
        <XCircle size={14} /> رفض
      </button>
    </div>
  )
}

function PipelineCard({ pipeline, canAdminApprove, onAction, loading, currentUser, onViewProfile }) {
  const [expanded, setExpanded] = useState(true)
  const adminStatus = pipeline.admin_approval_status || 'pending'
  const isMyOwnRequest = currentUser?.person_id !== undefined && String(currentUser.person_id) === String(pipeline.person_id)
  const isPendingUser = currentUser?.is_pending
  const canOpenProfile = !isPendingUser || isMyOwnRequest

  return (
    <div style={{ border: '1.5px solid #e2e6ef', borderRadius: 12, marginBottom: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: '#fafbfc', borderBottom: expanded ? '1px solid #e2e6ef' : 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right', fontFamily: 'var(--font-body)' }}
        >
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <User size={16} color="#0f2744" />
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.92rem' }}>
              {pipeline.display_name || `شخص #${pipeline.person_id}`}
              {isMyOwnRequest && <span style={{ fontSize: '0.72rem', color: '#9ba5bc', marginRight: 8 }}>(طلبي)</span>}
            </div>
            <div style={{ fontSize: '0.73rem', color: '#9ba5bc', marginTop: 1 }}>طلب تسجيل · ID: {pipeline.person_id}</div>
          </div>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={adminStatus === 'approved' ? (pipeline.yg_memberships?.every(m => m.yg_approval_status === 'approved') ? 'approved' : pipeline.yg_memberships?.every(m => m.yg_approval_status === 'rejected') ? 'rejected' : 'pending') : adminStatus} />
          {canOpenProfile && onViewProfile && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewProfile(pipeline.person_id) }}
              title="عرض الملف الشخصي"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', background: '#eef4ff',
                border: '1px solid #c5d8f8', borderRadius: 8,
                cursor: 'pointer', color: '#0f2744', fontSize: '0.78rem',
                fontFamily: 'var(--font-body)', fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              <ExternalLink size={12} /> الملف الشخصي
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4 }}
          >
            {expanded ? <ChevronUp size={16} color="#9ba5bc" /> : <ChevronDown size={16} color="#9ba5bc" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '16px 18px' }}>
          {/* Admin approval step */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: adminStatus === 'approved' ? '#f0fdf4' : adminStatus === 'rejected' ? '#fef2f2' : '#fffbeb', flexShrink: 0 }}>
                <Shield size={14} color={adminStatus === 'approved' ? '#166534' : adminStatus === 'rejected' ? '#991b1b' : '#92400e'} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f2744' }}>موافقة الإدارة على البيانات الشخصية</div>
                {pipeline.admin_approval_by && (
                  <div style={{ fontSize: '0.73rem', color: '#9ba5bc' }}>
                    {adminStatus === 'approved' ? 'وافق' : 'رفض'}: {pipeline.admin_approval_by}
                    {pipeline.admin_approval_date && ` · ${pipeline.admin_approval_date.slice(0,10)}`}
                  </div>
                )}
                {!pipeline.admin_approval_by && adminStatus === 'pending' && (
                  <div style={{ fontSize: '0.73rem', color: '#92400e' }}>بانتظار مراجعة الإدارة…</div>
                )}
                {pipeline.admin_approval_notes && (
                  <div style={{ fontSize: '0.73rem', color: '#991b1b', marginTop: 2 }}>السبب: {pipeline.admin_approval_notes}</div>
                )}
              </div>
              <StatusBadge status={adminStatus} />
            </div>

            {canAdminApprove && adminStatus === 'pending' && !isPendingUser && (
              <div style={{ marginRight: 36 }}>
                <ApproveRejectButtons
                  loading={loading}
                  onApprove={() => onAction('admin_approve', { personId: pipeline.person_id })}
                  onReject={(reason) => onAction('admin_reject', { personId: pipeline.person_id, reason })}
                />
              </div>
            )}
          </div>

          {/* YG memberships */}
          {(adminStatus === 'approved' || pipeline.yg_memberships?.length > 0) && (
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={13} /> عضويات الشبيبة
              </div>
              {(pipeline.yg_memberships || []).map((yg, i) => {
                const ygStatus = yg.yg_approval_status || 'pending'
                const canApproveThisYG = !isPendingUser && !isMyOwnRequest && (
                  currentUser?.role === 'admin' ||
                  (() => {
                    const ca = currentUser?.council_access || {}
                    const info = ca[yg.youth_group_id]
                    if (!info) return false
                    if (info.full_group) return true
                    if (!yg.age_group) return (info.age_groups || []).length > 0
                    return (info.age_groups || []).includes(yg.age_group)
                  })()
                )

                return (
                  <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: '12px', marginBottom: 8, border: '1px solid #e2e6ef' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f2744' }}>{yg.youth_group_name || yg.youth_group_id}</div>
                        {yg.age_group && <div style={{ fontSize: '0.75rem', color: '#9ba5bc', marginTop: 2 }}>الفئة: {yg.age_group}</div>}
                        {yg.yg_approved_by && (
                          <div style={{ fontSize: '0.73rem', color: '#9ba5bc', marginTop: 2 }}>
                            {ygStatus === 'approved' ? 'وافق' : 'رفض'}: {yg.yg_approved_by}
                            {yg.yg_approval_date && ` · ${yg.yg_approval_date.slice(0,10)}`}
                          </div>
                        )}
                        {!yg.yg_approved_by && ygStatus === 'pending' && adminStatus === 'approved' && (
                          <div style={{ fontSize: '0.73rem', color: '#92400e', marginTop: 2 }}>
                            بانتظار الموافقة
                            {yg.approvers?.length > 0 && (
                              <span style={{ marginRight: 6 }}>
                                ({yg.approvers.map(a => a.role).join('، ')})
                              </span>
                            )}
                          </div>
                        )}
                        {!yg.yg_approved_by && ygStatus === 'pending' && adminStatus === 'pending' && (
                          <div style={{ fontSize: '0.73rem', color: '#9ba5bc', marginTop: 2 }}>في انتظار موافقة الإدارة أولاً</div>
                        )}
                        {yg.yg_approval_notes && (
                          <div style={{ fontSize: '0.73rem', color: '#991b1b', marginTop: 2 }}>السبب: {yg.yg_approval_notes}</div>
                        )}
                      </div>
                      <StatusBadge status={ygStatus} />
                    </div>
                    {canApproveThisYG && ygStatus === 'pending' && adminStatus === 'approved' && (
                      <ApproveRejectButtons
                        loading={loading}
                        onApprove={() => onAction('yg_approve', { recordId: yg.record_id })}
                        onReject={(reason) => onAction('yg_reject', { recordId: yg.record_id, reason })}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Requests({ currentUser, toast, onViewProfile }) {
  const [requests, setRequests] = useState([])
  const [view, setView] = useState('pending')
  const [activeTab, setActiveTab] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  const isAdmin = currentUser?.role === 'admin'
  const isPending = currentUser?.is_pending
  const isCouncil = !isAdmin && Object.keys(currentUser?.council_access || {}).length > 0

  const loadRequests = async () => {
    setLoading(true); setError('')
    try {
      if (activeTab === 'pending') {
        const d = await api.getRequests()
        setRequests(d.requests || [])
        setView(d.view || 'none')
      } else {
        const d = await api.getRequestsHistory()
        setRequests(d.history || [])
        setView('history')
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'تعذّر تحميل الطلبات'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRequests() }, [activeTab])

  const handleAction = async (actionType, params) => {
    setActionLoading(true)
    try {
      if (actionType === 'admin_approve') {
        await api.adminApproveRequest(params.personId, '')
        toast?.('تمت الموافقة على البيانات الشخصية ✓', 'success')
      } else if (actionType === 'admin_reject') {
        await api.adminRejectRequest(params.personId, params.reason)
        toast?.('تم رفض الطلب', 'info')
      } else if (actionType === 'yg_approve') {
        await api.ygApproveRequest(params.recordId, '')
        toast?.('تمت الموافقة على عضوية الشبيبة ✓', 'success')
      } else if (actionType === 'yg_reject') {
        await api.ygRejectRequest(params.recordId, params.reason)
        toast?.('تم رفض عضوية الشبيبة', 'info')
      }
      await loadRequests()
    } catch (err) {
      toast?.(getApiErrorMessage(err, 'حدث خطأ'), 'error')
    } finally {
      setActionLoading(false)
    }
  }

  // Backend already filters correctly:
  //   GET /api/requests        → only requests needing action (pending tab)
  //   GET /api/requests/history → all requests regardless of status (history tab)
  const displayRequests = requests

  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-body)', direction: 'rtl', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #0f2744, #2d5986)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardList size={20} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f2744', margin: 0 }}>الطلبات</h1>
            <p style={{ fontSize: '0.78rem', color: '#9ba5bc', margin: 0 }}>
              {isPending ? 'حالة طلب تسجيلك' : isAdmin ? 'إدارة طلبات التسجيل' : 'طلبات الانضمام لشبيبتك'}
            </p>
          </div>
        </div>
        <button onClick={loadRequests} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#f0f4ff', border: '1px solid #c5d8f8', borderRadius: 8, cursor: 'pointer', color: '#0f2744', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> تحديث
        </button>
      </div>

      {/* Tabs (only for admin/council) */}
      {!isPending && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f5f6fa', borderRadius: 10, padding: 4 }}>
          {[
            { id: 'pending', label: 'قيد الانتظار' },
            { id: 'history', label: 'السجل الكامل' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '8px', background: activeTab === tab.id ? 'white' : 'none',
                border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)',
                fontSize: '0.85rem', fontWeight: activeTab === tab.id ? 700 : 400,
                color: activeTab === tab.id ? '#0f2744' : '#9ba5bc',
                boxShadow: activeTab === tab.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ background: '#fdecea', border: '1px solid #ef9a9a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', color: '#c62828' }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#9ba5bc' }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          جارٍ التحميل…
        </div>
      ) : displayRequests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#9ba5bc' }}>
          <ClipboardList size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div style={{ fontSize: '0.9rem' }}>
            {activeTab === 'pending' ? 'لا توجد طلبات معلّقة حالياً' : 'لا يوجد سجل طلبات'}
          </div>
        </div>
      ) : (
        <div>
          {displayRequests.map((req, i) => (
            <PipelineCard
              key={i}
              pipeline={req.pipeline}
              canAdminApprove={isAdmin}
              onAction={handleAction}
              loading={actionLoading}
              currentUser={currentUser}
              onViewProfile={onViewProfile}
            />
          ))}
        </div>
      )}

      <style>{`.spin { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
