import { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { CheckCheck, Check, MessageSquare, FileText, X, Bell, Mail, Trash2, UserPlus, ShieldCheck } from 'lucide-react'
import { api } from './api.js'

export default function NotificationBell({ onOpenQuestionnaire }) {
  const [open, setOpen]     = useState(false)
  const [notifs, setNotifs] = useState([])
  const [unread, setUnread] = useState(0)
  const [busy, setBusy]     = useState(false)
  const [filter, setFilter] = useState('all')
  const [rect, setRect]     = useState(null)
  const btnRef              = useRef(null)
  const dropRef             = useRef(null)

  const load = () =>
    api.getNotifications()
      .then(d => { setNotifs(d.notifications || []); setUnread(d.unread_count || 0) })
      .catch(() => {})

  useEffect(() => {
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const upd = () => { if (btnRef.current) setRect(btnRef.current.getBoundingClientRect()) }
    upd()
    window.addEventListener('resize', upd)
    window.addEventListener('scroll', upd, true)
    return () => { window.removeEventListener('resize', upd); window.removeEventListener('scroll', upd, true) }
  }, [])

  useEffect(() => {
    if (!open) return
    const h = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (dropRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen(v => !v)
  }

  const markRead = async (n) => {
    if (!n.read) { await api.markNotificationRead(n.id); load() }
    if (n.type === 'new_questionnaire' && onOpenQuestionnaire) onOpenQuestionnaire(n.questionnaire_id)
    setOpen(false)
  }

  const toggleRead = async (n, e) => {
    e.stopPropagation()
    if (n.read) {
      await api.markNotificationUnread(n.id)
    } else {
      await api.markNotificationRead(n.id)
    }
    load()
  }

  const deleteNotification = async (n, e) => {
    e.stopPropagation()
    await api.deleteNotification(n.id)
    load()
  }

  const markAll = async () => {
    setBusy(true)
    await api.markAllNotificationsRead()
    load()
    setBusy(false)
  }

  const displayed = filter === 'unread' ? notifs.filter(n => !n.read) : notifs
  const readCount = Math.max(0, notifs.length - unread)

  function notifMeta(n) {
    switch (n.type) {
      case 'new_questionnaire':
        return {
          iconBg: '#eef4ff', iconBorder: '#c5d8f8',
          icon: <FileText size={18} color="#0f2744" />,
          text: `استبيان جديد: ${n.questionnaire_title || ''}`,
        }
      case 'questionnaire_response':
        return {
          iconBg: '#fffbeb', iconBorder: '#fde68a',
          icon: <MessageSquare size={18} color="#c9963c" />,
          text: n.message || `${n.respondent_name || ''} أجاب على "${n.questionnaire_title || ''}"`,
        }
      case 'registration_pending_admin':
        return {
          iconBg: '#eef4ff', iconBorder: '#c5d8f8',
          icon: <UserPlus size={18} color="#0f2744" />,
          text: n.message || `طلب تسجيل جديد بانتظار مراجعتك`,
        }
      case 'registration_admin_approved':
        return {
          iconBg: '#f0fdf4', iconBorder: '#86efac',
          icon: <ShieldCheck size={18} color="#166534" />,
          text: n.message || `تمت الموافقة على بياناتك الشخصية`,
        }
      case 'registration_admin_rejected':
        return {
          iconBg: '#fef2f2', iconBorder: '#fca5a5',
          icon: <ShieldCheck size={18} color="#991b1b" />,
          text: n.message || `تم رفض طلب تسجيلك`,
        }
      default:
        return {
          iconBg: '#fffbeb', iconBorder: '#fde68a',
          icon: <MessageSquare size={18} color="#c9963c" />,
          text: n.message || n.questionnaire_title || 'إشعار جديد',
        }
    }
  }

  const panel = open && ReactDOM.createPortal(
    <div ref={dropRef} style={{
      position: 'fixed',
      top: rect ? rect.bottom + 10 : 70,
      left: rect ? Math.max(8, rect.right - 390) : 8,
      width: 390,
      maxHeight: 'calc(100vh - 120px)',
      background: 'white',
      borderRadius: 18,
      boxShadow: '0 24px 64px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.07)',
      zIndex: 99999,
      direction: 'rtl',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: 'var(--font-body)',
    }}>

      {/* Header */}
      <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg,#0f2744,#1e4080)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={20} color="white" />
          <span style={{ fontWeight: 800, color: 'white', fontSize: '1rem' }}>الإشعارات</span>
          {unread > 0 && (
            <span style={{ background: '#c9963c', color: 'white', borderRadius: 20, padding: '2px 10px', fontSize: '0.75rem', fontWeight: 800 }}>
              {unread} جديد
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {unread > 0 && (
            <button onClick={markAll} disabled={busy}
              style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontFamily: 'var(--font-body)', padding: '5px 12px', borderRadius: 8, fontWeight: 700 }}>
              <CheckCheck size={14} /> قراءة الكل
            </button>
          )}
          <button onClick={() => setOpen(false)}
            style={{ background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', padding: 6, borderRadius: 8 }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      {notifs.length > 0 && (
        <div style={{ display: 'flex', borderBottom: '2px solid #f0f2f7', background: '#fafbfd', flexShrink: 0 }}>
          {[['all', 'الكل', notifs.length], ['unread', 'غير مقروءة', unread]].map(([key, label, count]) => (
            <button key={key} onClick={() => setFilter(key)}
              style={{
                flex: 1, padding: '10px', background: 'none', border: 'none',
                cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem',
                fontWeight: filter === key ? 800 : 500,
                color: filter === key ? '#0f2744' : '#9ba5bc',
                borderBottom: `2px solid ${filter === key ? '#0f2744' : 'transparent'}`,
                marginBottom: -2, transition: '0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              {label}
              <span style={{ background: filter === key ? '#0f2744' : '#e2e6ef', color: filter === key ? 'white' : '#9ba5bc', borderRadius: 10, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 700 }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {displayed.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '52px 32px', gap: 14 }}>
            <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'linear-gradient(135deg,#eef4ff,#f8f9fd)', border: '2px solid #e2e6ef', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell size={36} color="#c8d0e0" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '0.96rem', color: '#4a5568', marginBottom: 6 }}>
                {filter === 'unread' ? 'لا توجد إشعارات غير مقروءة' : 'لا توجد إشعارات'}
              </div>
              <div style={{ fontSize: '0.83rem', color: '#9ba5bc', lineHeight: 1.6 }}>
                {filter === 'unread'
                  ? ''
                  : 'ستظهر إشعاراتك هنا فور وصولها'}
              </div>
            </div>
          </div>
        ) : displayed.map(n => {
          const meta = notifMeta(n)
          return (
          <div key={n.id}
            style={{ width: '100%', background: n.read ? 'white' : '#f0f7ff', borderBottom: '1px solid #f3f4f8', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'stretch', gap: 0, transition: 'background 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.background = n.read ? '#f8f9fd' : '#e4effe'}
            onMouseLeave={e => e.currentTarget.style.background = n.read ? 'white' : '#f0f7ff'}>
            <button onClick={() => markRead(n)}
              style={{ flex: 1, width: '100%', padding: '14px 12px 14px 8px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'right', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: meta.iconBg, border: `2px solid ${meta.iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {meta.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: n.read ? 500 : 800, color: '#0f2744', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 3 }}>
                {meta.text}
              </div>
              {n.response_summary && (
                <div style={{ fontSize: '0.78rem', color: '#6b7a99', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{n.response_summary}</div>
              )}
              <div style={{ fontSize: '0.72rem', color: '#b0bac9' }}>
                {new Date(n.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            {!n.read && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#c9963c', flexShrink: 0, marginTop: 6 }} />}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', flexShrink: 0 }}>
              <button
                onClick={(e) => toggleRead(n, e)}
                aria-label={n.read ? 'تمييز كغير مقروء' : 'تمييز كمقروء'}
                title={n.read ? 'تمييز كغير مقروء' : 'تمييز كمقروء'}
                style={{
                  width: 30,
                  height: 30,
                  background: n.read ? 'white' : '#eef4ff',
                  border: '1px solid #d7deea',
                  borderRadius: '50%',
                  color: n.read ? '#9ba5bc' : '#0f2744',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                {n.read ? <Mail size={14} /> : <Check size={14} strokeWidth={2.6} />}
              </button>
              <button
                onClick={(e) => deleteNotification(n, e)}
                aria-label="حذف الإشعار"
                title="حذف الإشعار"
                style={{
                  width: 30,
                  height: 30,
                  background: 'white',
                  border: '1px solid #efd6d6',
                  borderRadius: '50%',
                  color: '#b65b5b',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )})}
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 20px', borderTop: '1px solid #e2e6ef', background: '#f8f9fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: '0.76rem', color: '#9ba5bc' }}>{readCount} مقروء · {unread} غير مقروء</span>
      </div>
    </div>,
    document.body
  )

  return (
    <>
      <style>{`
        @keyframes bellRing {
          0%,100% { transform: rotate(0deg); }
          10%      { transform: rotate(18deg); }
          25%      { transform: rotate(-15deg); }
          40%      { transform: rotate(10deg); }
          55%      { transform: rotate(-6deg); }
          70%      { transform: rotate(3deg); }
          85%      { transform: rotate(0deg); }
        }
        .bell-btn { transition: all 0.18s; }
        .bell-btn:hover { background: #dde6fb !important; }
      `}</style>

      <button
        ref={btnRef}
        onClick={toggle}
        title="الإشعارات"
        className="bell-btn"
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 44, height: 44, borderRadius: '50%',
          background: open
            ? '#e8f0fe'
            : unread > 0
              ? 'rgba(201,150,60,0.12)'
              : '#f0f4ff',
          border: `2px solid ${unread > 0 ? 'rgba(201,150,60,0.6)' : '#d0d9f0'}`,
          cursor: 'pointer',
          flexShrink: 0,
          boxShadow: unread > 0
            ? '0 0 0 4px rgba(201,150,60,0.12)'
            : 'none',
        }}>

        {/* Bell icon with ring animation when unread */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: unread > 0 ? 'bellRing 2s ease 0s infinite' : 'none',
          transformOrigin: '50% 30%',
        }}>
          <Bell size={22} color={unread > 0 ? '#c9963c' : '#0f2744'} strokeWidth={2.2} />
        </div>

        {/* Unread badge */}
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#c9963c',
            color: 'white',
            borderRadius: '50%',
            minWidth: 20, height: 20,
            fontSize: '0.68rem', fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2.5px solid white',
            padding: '0 3px',
            fontFamily: 'var(--font-body)',
            lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {panel}
    </>
  )
}
