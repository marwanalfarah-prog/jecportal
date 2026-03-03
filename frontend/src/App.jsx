import { useState, useEffect } from 'react'
import { LayoutDashboard, Users, GitBranch, UserPlus, LogOut, ShieldCheck, User as UserIcon, Eye, X, Search, ClipboardList } from 'lucide-react'
import Dashboard from './pages/Dashboard.jsx'
import Members from './pages/Members.jsx'
import Profile from './pages/Profile.jsx'
import AddMemberModal from './pages/AddMember.jsx'
import OrgTree from './pages/OrgTree.jsx'
import GeneralSecretariatTree from './pages/GeneralSecretariatTree.jsx'
import UserManagement from './pages/UserManagement.jsx'
import Login from './pages/Login.jsx'
import CouncilMembers from './pages/CouncilMembers.jsx'
import { useToast, ToastContainer } from './useToast.jsx'
import NotificationBell from './NotificationBell.jsx'
import Questionnaire from './pages/Questionnaire.jsx'
import MyQuestions from './pages/MyQuestions.jsx'
import { api } from './api.js'

// ── ViewAsPicker Modal ────────────────────────────────────────────────────────
function ViewAsPicker({ currentAdminUser, onSelect, onClose }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

  useEffect(() => {
    api.listUsers()
      .then(d => { setUsers(d.users || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Only show member users (not other admins, not the admin themselves)
  const filtered = users.filter(u => {
    if (u.username === currentAdminUser.username) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      (u.username || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q)
    )
  })

  const roleLabel = u => {
    if (u.role === 'admin') return { label: 'مدير', color: '#c9963c' }
    return { label: 'عضو', color: '#0f2744' }
  }

  const handleSelect = async (u) => {
    // We need to enrich the user with youth_groups and council_access
    // Reuse /auth/me logic by fetching enriched user data from listUsers
    // The listUsers endpoint strips passwords but keeps person_id, person_type, role etc.
    // We need youth_groups — fetch from personsEnriched or construct from the user record
    // The simplest approach: call a dedicated endpoint. Instead, we build the user object
    // from what we have (listUsers already returns person_id, person_type, role, display_name)
    // and fetch enrichment via a workaround: read /auth/me won't work since we're admin.
    // So we pass the raw user and let App.jsx fetch youth_groups & council_access via
    // the already-existing api.councilMembers or by calling api.me impersonation.
    // Best approach: the backend already computes council_access in /auth/me.
    // Since we can't change sessions, we'll compute council_access client-side
    // by fetching persons enriched and matching. For now pass u as-is and use
    // a lightweight enrichment call.

    // Fetch the full user object enriched with youth_groups/council_access
    // by calling a new backend endpoint — but we don't want to change the backend.
    // The listUsers endpoint returns the raw user record. We add youth_groups
    // by matching person_id in personsEnriched. council_access is complex.
    // Simplest correct solution: call the enriched endpoint.
    onSelect({ ...u, council_access: u.council_access || {}, youth_groups: u.youth_groups || [] })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'white', borderRadius: 16, width: '100%', maxWidth: 500,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)', direction: 'rtl',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #e2e6ef' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(201,150,60,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid rgba(201,150,60,0.4)' }}>
                <Eye size={16} color="#c9963c"/>
              </div>
              <div>
                <div style={{ fontWeight: 800, color: '#0f2744', fontSize: '0.98rem' }}>عرض بصفة مستخدم</div>
                <div style={{ fontSize: '0.75rem', color: '#9ba5bc', marginTop: 1 }}>اختر مستخدماً لعرض النظام من منظوره</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', fontSize: 20, padding: 4 }}>✕</button>
          </div>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc', pointerEvents: 'none' }}/>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث باسم المستخدم أو الاسم الكامل…"
              style={{ width: '100%', padding: '8px 34px 8px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.87rem', direction: 'rtl', outline: 'none' }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}><div className="spinner"/></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#9ba5bc' }}>
              <UserIcon size={32} style={{ marginBottom: 10, opacity: 0.4 }}/>
              <div>لا توجد نتائج</div>
            </div>
          ) : (
            filtered.map(u => {
              const rl = roleLabel(u)
              return (
                <button
                  key={u.username}
                  onClick={() => handleSelect(u)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 22px', border: 'none', background: 'none',
                    cursor: 'pointer', textAlign: 'right', transition: '0.12s',
                    borderBottom: '1px solid #f5f6fa',
                    fontFamily: 'var(--font-body)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f7f9ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {/* Avatar */}
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    background: u.role === 'admin' ? 'rgba(201,150,60,0.15)' : '#eef4ff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1.5px solid ${u.role === 'admin' ? 'rgba(201,150,60,0.4)' : '#c5d8f8'}`,
                  }}>
                    {u.role === 'admin'
                      ? <ShieldCheck size={16} color="#c9963c"/>
                      : <UserIcon size={16} color="#0f2744"/>
                    }
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#1a2a3a', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.display_name || u.username}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9ba5bc', marginTop: 1 }}>
                      @{u.username}
                      {u.person_id && <span style={{ marginRight: 8, color: '#b0bac9' }}>· ID: {u.person_id}</span>}
                    </div>
                  </div>
                  {/* Role badge */}
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                    background: u.role === 'admin' ? '#fffbeb' : '#eef4ff',
                    color: rl.color,
                    border: `1px solid ${u.role === 'admin' ? '#fde68a' : '#c5d8f8'}`,
                    whiteSpace: 'nowrap',
                  }}>{rl.label}</span>
                  {/* Arrow */}
                  <Eye size={14} color="#c8cfe0"/>
                </button>
              )
            })
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid #e2e6ef', fontSize: '0.76rem', color: '#9ba5bc', textAlign: 'center' }}>
          هذا الوضع للمعاينة فقط — لن يتم تغيير أي بيانات
        </div>
      </div>
    </div>
  )
}

const PAGE_TITLES = {
  dashboard:           'لوحة المعلومات',
  members:             'الأعضاء',
  profile:             'ملف العضو',
  orgtree:             'الهيكل التنظيمي',
  users:               'إدارة المستخدمين',
  council_members:     'أعضاء فئتي',
  general_secretariat: 'الأمانة العامة للشبيبة المسيحيّة',
}

export default function App() {
  const [authUser, setAuthUser]         = useState(undefined) // undefined = loading
  const [page, setPage]                 = useState('dashboard')
  const [selectedPid, setSelected]      = useState(null)
  const [isUnregistered, setIsUnreg]    = useState(false)
  const [orgContext, setOrgContext]      = useState(null)
  const [showAdd, setShowAdd]           = useState(false)
  const [prefillName, setPrefill]       = useState('')
  const [profileReturnPage, setProfileReturnPage] = useState('members')
  const [viewAsUser, setViewAsUser]       = useState(null)   // { username, display_name, role, person_id, person_type, youth_groups, council_access, ... }
  const [showViewAsPicker, setShowViewAsPicker] = useState(false)
  const { toasts, toast }               = useToast()

  useEffect(() => {
    api.me().then(d => {
      const user = d.user || null
      setAuthUser(user)
      if (user?.role === 'member') {
        setSelected(user.person_id)
        setIsUnreg(user.person_type === 'unregistered')
        setPage('profile')
        setProfileReturnPage('orgtree')
      }
    }).catch(() => setAuthUser(null))
  }, [])

  const handleLogin = (user) => {
    setAuthUser(user)
    setViewAsUser(null)
    if (user.role === 'member') {
      setSelected(user.person_id)
      setIsUnreg(user.person_type === 'unregistered')
      setPage('profile')
      setProfileReturnPage('orgtree')
    } else {
      setPage('dashboard')
    }
  }

  const handleLogout = async () => {
    await api.logout()
    setAuthUser(null)
    setPage('dashboard')
    setSelected(null)
  }

  // When impersonating, use the viewAsUser as effective context (read-only for everything)
  const effectiveUser  = viewAsUser || authUser
  const isAdmin        = authUser?.role === 'admin' && !viewAsUser
  const isMember       = effectiveUser?.role === 'member'
  // council_access: { youth_group_name: [age_group, ...] }
  const councilAccess  = effectiveUser?.council_access || {}
  const isCouncil      = isMember && Object.keys(councilAccess).length > 0
  const memberYouthGroups = effectiveUser?.youth_groups || []

  // ── Navigation ──────────────────────────────────────────────────────────────
  const NAV = isAdmin ? [
    { id: 'dashboard',           label: 'لوحة المعلومات',              icon: LayoutDashboard },
    { id: 'members',             label: 'الأعضاء',                      icon: Users },
    { id: 'orgtree',             label: 'الهيكل التنظيمي',             icon: GitBranch },
    { id: 'general_secretariat', label: 'الأمانة العامة',              icon: GitBranch },
    { id: 'users',               label: 'إدارة المستخدمين',            icon: ShieldCheck },
    { id: 'questionnaires',       label: 'إدارة الاستبيانات',           icon: ClipboardList },
  ] : [
    { id: 'profile',         label: 'ملفي الشخصي',       icon: UserIcon },
    { id: 'orgtree',         label: 'الهيكل التنظيمي',   icon: GitBranch },
    ...(isCouncil ? [{ id: 'council_members', label: 'أعضاء فئتي', icon: Users }] : []),
    { id: 'my_questions', label: 'استبياناتي', icon: ClipboardList },
  ]

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const canViewProfile = (pid, unreg = false) => {
    if (authUser?.role === 'admin' && !viewAsUser) return true
    if (!isMember) return false
    // Own profile always
    if (String(pid) === String(effectiveUser.person_id) &&
        unreg === (effectiveUser.person_type === 'unregistered')) return true
    // Council member can view profiles in their age groups
    if (isCouncil) return true  // fine-grained check done in CouncilMembers
    return false
  }

  const goProfile = (pid, ctx = null, unreg = false, returnPage = 'members') => {
    if (!canViewProfile(pid, unreg)) return
    setSelected(pid)
    setOrgContext(ctx)
    setIsUnreg(unreg)
    setProfileReturnPage(returnPage)
    setPage('profile')
  }

  const goBack = () => {
    setSelected(null)
    setOrgContext(null)
    setIsUnreg(false)
    if (isMember) {
      setPage(profileReturnPage === 'council_members' ? 'council_members' : 'orgtree')
    } else {
      setPage(profileReturnPage)
    }
  }

  const navigate = (p) => {
    const allowed = isAdmin
      ? ['dashboard', 'members', 'orgtree', 'general_secretariat', 'users', 'questionnaires']
      : ['profile', 'orgtree', 'council_members', 'my_questions']
    if (!allowed.includes(p)) return
    setPage(p)
    if (p !== 'profile') { setSelected(null); setOrgContext(null); setIsUnreg(false) }
  }

  const handleNavClick = (id) => {
    if (isMember && id === 'profile') {
      setSelected(effectiveUser.person_id)
      setIsUnreg(effectiveUser.person_type === 'unregistered')
      setPage('profile')
      setProfileReturnPage('orgtree')
    } else {
      navigate(id)
    }
  }

  // When entering/exiting impersonation mode, reset page state
  useEffect(() => {
    if (viewAsUser) {
      // Enter impersonation: go to what the member would see first
      if (viewAsUser.role === 'member') {
        setSelected(viewAsUser.person_id)
        setIsUnreg(viewAsUser.person_type === 'unregistered')
        setPage('profile')
        setProfileReturnPage('orgtree')
      }
    } else if (authUser?.role === 'admin') {
      // Exit impersonation: go back to admin dashboard
      setPage('dashboard')
      setSelected(null)
      setIsUnreg(false)
      setOrgContext(null)
    }
  }, [viewAsUser])

  const handleRegisterPerson = (name) => {
    if (!isAdmin) return
    setPrefill(name || '')
    setShowAdd(true)
  }

  const handleViewProfile = (pid, ctx) => {
    if (!canViewProfile(pid, false)) return
    goProfile(pid, ctx, false, 'orgtree')
  }

  const handlePromoted = (newPid) => {
    goProfile(newPid, null, false, 'members')
    toast('تم تسجيل العضو بنجاح ✓', 'success')
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (authUser === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)' }}>
        <div className="spinner"/>
      </div>
    )
  }

  if (!authUser) return <Login onLogin={handleLogin}/>

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>JEC</h1>
          <span>نظام إدارة الأعضاء</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">القائمة الرئيسية</div>
          {NAV.map(n => {
            const isActive = page === n.id
              || (page === 'profile' && n.id === 'profile')
              || (page === 'profile' && profileReturnPage === n.id && n.id !== 'profile' && !isMember)
            return (
              <button key={n.id} className={`nav-item${isActive ? ' active' : ''}`} onClick={() => handleNavClick(n.id)}>
                <n.icon size={18} className="icon"/>
                {n.label}
              </button>
            )
          })}

          {isAdmin && (
            <>
              <div className="nav-section-label" style={{ marginTop: 16 }}>إجراءات</div>
              <button className="nav-item" onClick={() => { navigate('members'); setShowAdd(true) }}>
                <UserPlus size={18} className="icon"/>
                إضافة عضو جديد
              </button>
              <button className="nav-item" onClick={() => setShowViewAsPicker(true)}>
                <Eye size={18} className="icon"/>
                عرض بصفة مستخدم
              </button>
            </>
          )}

          {/* Council access badge */}
          {isCouncil && (
            <div style={{
              margin: '16px 8px 0', padding: '10px 12px',
              background: 'rgba(201,150,60,0.15)', borderRadius: 10,
              border: '1px solid rgba(201,150,60,0.3)',
            }}>
              <div style={{ color: '#e8b55a', fontSize: '0.72rem', fontWeight: 700, marginBottom: 4 }}>
                صلاحية مجلس الفئة
              </div>
              {Object.entries(councilAccess).map(([grp, info]) => (
                <div key={grp} style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.8 }}>
                  {info.full_group
                    ? <span style={{ color: '#e8b55a', fontWeight: 700 }}>جميع الأعضاء</span>
                    : (info.age_groups || []).join(' · ')
                  }
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* User info + logout */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'rgba(201,150,60,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              border: '1.5px solid rgba(201,150,60,0.5)',
            }}>
              <ShieldCheck size={16} color="#c9963c"/>
            </div>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ color: 'white', fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {authUser.display_name || authUser.username}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem' }}>مدير النظام</div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, padding: '7px 12px', color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem', transition: '0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
          >
            <LogOut size={14}/> تسجيل الخروج
          </button>
        </div>
        <div className="sidebar-footer">JEC Member Manager © 2025</div>
      </aside>

      <div className="main-content">
        {/* ── Impersonation banner ── */}
        {viewAsUser && (
          <div style={{
            background: 'linear-gradient(90deg, #c9963c, #e8b55a)',
            padding: '10px 24px',
            display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 2px 8px rgba(201,150,60,0.35)',
            zIndex: 50, position: 'relative',
          }}>
            <Eye size={16} color="#0f2744"/>
            <span style={{ fontWeight: 700, color: '#0f2744', fontSize: '0.88rem' }}>
              أنت تعرض النظام بصفة:
            </span>
            <span style={{
              background: 'rgba(15,39,68,0.15)', borderRadius: 8,
              padding: '2px 12px', fontWeight: 800, color: '#0f2744', fontSize: '0.88rem',
            }}>
              {viewAsUser.display_name || viewAsUser.username}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'rgba(15,39,68,0.6)', marginRight: 4 }}>
              ({viewAsUser.username})
            </span>
            <div style={{ flex: 1 }}/>
            <button
              onClick={() => setViewAsUser(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#0f2744', color: 'white', border: 'none',
                borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700,
              }}
            >
              <X size={13}/> الخروج من وضع العرض
            </button>
          </div>
        )}
        <header className="topbar">
          <span className="topbar-title">{PAGE_TITLES[page] || ''}</span>
          <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isAdmin && page === 'members' && (
              <button className="btn btn-gold btn-sm" onClick={() => setShowAdd(true)}>
                <UserPlus size={15}/> إضافة عضو
              </button>
            )}
            {!viewAsUser && (
              <NotificationBell
                onOpenQuestionnaire={(qid) => { navigate(authUser?.role === 'admin' ? 'questionnaires' : 'my_questions') }}
              />
            )}
          </div>
        </header>

        <main className="page-body">
          {isAdmin && page === 'dashboard' && <Dashboard/>}

          {isAdmin && page === 'members' && (
            <Members
              onSelectPerson={pid => goProfile(pid, null, false, 'members')}
              onSelectUnregistered={uid => goProfile(uid, null, true, 'members')}
              onAdd={() => setShowAdd(true)}
              toast={toast}
            />
          )}

          {page === 'profile' && (
            <Profile
              personId={selectedPid}
              isUnregistered={isUnregistered}
              onBack={goBack}
              toast={toast}
              orgContext={orgContext}
              onViewProfile={(pid, unreg) => goProfile(pid, null, !!unreg, page)}
              onPromoted={handlePromoted}
              currentUser={effectiveUser}
              // Council members or impersonating admin viewing others → read-only
              readOnly={!!(viewAsUser) || (isMember && String(selectedPid) !== String(effectiveUser?.person_id))}
            />
          )}

          {page === 'orgtree' && (
            <OrgTree
              toast={toast}
              onRegisterPerson={isAdmin ? handleRegisterPerson : undefined}
              onViewProfile={(pid, ctx) => handleViewProfile(pid, ctx)}
              onViewUnregisteredProfile={uid => {
                if (isMember && !canViewProfile(uid, true)) return
                goProfile(uid, null, true, 'orgtree')
              }}
              viewOnly={isMember}
              allowedGroups={isMember ? memberYouthGroups : null}
            />
          )}

          {isCouncil && page === 'council_members' && (
            <CouncilMembers
              councilAccess={councilAccess}
              currentUser={effectiveUser}
              onSelectPerson={pid => goProfile(pid, null, false, 'council_members')}
              onSelectUnregistered={uid => goProfile(uid, null, true, 'council_members')}
              toast={toast}
            />
          )}

          {isAdmin && page === 'general_secretariat' && (
            <GeneralSecretariatTree
              toast={toast}
              onRegisterPerson={isAdmin ? handleRegisterPerson : undefined}
              onViewProfile={(pid, ctx) => handleViewProfile(pid, ctx)}
              onViewUnregisteredProfile={uid => {
                goProfile(uid, null, true, 'general_secretariat')
              }}
              viewOnly={false}
            />
          )}

          {isAdmin && page === 'users' && <UserManagement toast={toast}/>}

          {isAdmin && page === 'questionnaires' && (
            <Questionnaire toast={toast} />
          )}

          {isMember && page === 'my_questions' && (
            <MyQuestions
              toast={toast}
              onNavigate={(p) => navigate(p)}
            />
          )}
        </main>
      </div>

      {authUser?.role === 'admin' && showAdd && (
        <AddMemberModal
          onClose={() => { setShowAdd(false); setPrefill('') }}
          onAdded={(pid) => { setShowAdd(false); setPrefill(''); goProfile(pid, null, false, 'members') }}
          toast={toast}
          prefillName={prefillName}
        />
      )}

      {/* ── View As Picker Modal ── */}
      {showViewAsPicker && (
        <ViewAsPicker
          currentAdminUser={authUser}
          onSelect={user => {
            setViewAsUser(user)
            setShowViewAsPicker(false)
          }}
          onClose={() => setShowViewAsPicker(false)}
        />
      )}

      <ToastContainer toasts={toasts}/>
    </div>
  )
}
