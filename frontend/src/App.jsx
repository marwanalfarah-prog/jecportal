import { useState, useEffect } from 'react'
import { LayoutDashboard, Users, GitBranch, UserPlus, LogOut, ShieldCheck, User as UserIcon, Eye, X, Search, ClipboardList, Settings, Building2, ImageOff, Key, MapPin, Map, BookOpenText } from 'lucide-react'
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
import Config from './pages/Config.jsx'
import YouthGroupAdmin from './pages/YouthGroupAdmin.jsx'
import ChurchesAdmin from './pages/ChurchesAdmin.jsx'
import ChurchesMap from './pages/ChurchesMap.jsx'
import PeopleLocationsMap from './pages/PeopleLocationsMap.jsx'
import BibleReader from './pages/BibleReader.jsx'
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

function MemberYouthGroupLogoTile({ groupId, label }) {
  const [missing, setMissing] = useState(false)
  const [specialMissing, setSpecialMissing] = useState(false)

  useEffect(() => {
    setMissing(false)
    setSpecialMissing(false)
  }, [groupId])

  return (
    <div
      style={{
        minWidth: 142,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--gray-200)',
        borderRadius: 10,
        background: 'white',
      }}
      title={label}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {missing ? (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: '1px dashed var(--gray-300)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--gray-400)',
              background: 'var(--gray-50)',
              flexShrink: 0,
            }}
          >
            <ImageOff size={14} />
          </div>
        ) : (
          <img
            src={api.youthGroupLogoUrl(groupId)}
            alt={label || groupId}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              objectFit: 'contain',
              border: '1px solid var(--gray-200)',
              background: 'var(--gray-50)',
              flexShrink: 0,
            }}
            onError={() => setMissing(true)}
          />
        )}

        {!specialMissing ? (
          <img
            src={api.youthGroupActiveSpecialLogoUrl(groupId)}
            alt={label ? `Special Logo - ${label}` : 'Special Occasion Logo'}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              objectFit: 'contain',
              border: '1px solid var(--gray-200)',
              background: 'var(--gray-50)',
              flexShrink: 0,
            }}
            onError={() => setSpecialMissing(true)}
          />
        ) : null}

      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.76rem',
            color: 'var(--gray-400)',
            lineHeight: 1.1,
            marginBottom: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          فرقة الشبيبة
        </div>
        <div
          style={{
            fontSize: '0.84rem',
            color: 'var(--navy)',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label || groupId}
        </div>
      </div>
    </div>
  )
}

function MemberMottoTile({ logoUrl, verseText, scopeLabel }) {
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    setMissing(false)
  }, [logoUrl, verseText, scopeLabel])

  return (
    <div
      style={{
        minWidth: 142,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--gray-200)',
        borderRadius: 10,
        background: '#fffdf7',
      }}
      title={verseText || scopeLabel}
    >
      {missing ? (
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            border: '1px dashed var(--gray-300)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gray-400)',
            background: 'var(--gray-50)',
            flexShrink: 0,
          }}
        >
          <ImageOff size={14} />
        </div>
      ) : (
        <img
          src={logoUrl}
          alt={verseText || scopeLabel}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            objectFit: 'contain',
            border: '1px solid var(--gray-200)',
            background: 'var(--gray-50)',
            flexShrink: 0,
          }}
          onError={() => setMissing(true)}
        />
      )}

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.78rem',
            color: 'var(--navy)',
            lineHeight: 1.25,
            marginBottom: 2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {verseText || '—'}
        </div>
        <div
          style={{
            fontSize: '0.84rem',
            color: 'var(--gold)',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {scopeLabel}
        </div>
      </div>
    </div>
  )
}

function formatMottoSource(ref) {
  if (!ref || typeof ref !== 'object') return ''
  const abbr = String(ref?.book?.book_abbr || ref?.book?.abbr || ref?.book?.book_name || '').trim()
  const verseObj = ref?.verse && typeof ref.verse === 'object' ? ref.verse : {}
  let verseRaw = String(verseObj?.raw || '').trim()
  if (!verseRaw) {
    const segments = Array.isArray(verseObj?.segments) ? verseObj.segments : []
    const rendered = segments.map((seg) => {
      const start = seg?.start || {}
      const end = seg?.end || {}
      const sc = Number(start?.chapter)
      const sv = Number(start?.verse)
      const ec = Number(end?.chapter)
      const ev = Number(end?.verse)
      if (!sc || !sv || !ec || !ev) return ''
      if (sc === ec && sv === ev) return `${sc}: ${sv}`
      if (sc === ec) return `${sc}: ${sv}-${ev}`
      return `${sc}: ${sv}-${ec}: ${ev}`
    }).filter(Boolean)
    verseRaw = rendered.join(', ')
  }
  verseRaw = verseRaw.replace(/:\s*/g, ': ')
  if (!abbr || !verseRaw) return ''
  return `(${abbr} ${verseRaw})`
}

function formatMottoTextWithSource(motto) {
  const title = String(motto?.title || '').trim()
  if (!title) return '—'
  const references = Array.isArray(motto?.bible_references) ? motto.bible_references : []
  const source = formatMottoSource(references[0])
  return source ? `${title} ${source}` : title
}

const PAGE_TITLES = {
  dashboard:           'لوحة المعلومات',
  members:             'الأعضاء',
  profile:             'ملف العضو',
  orgtree:             'الهيكل التنظيمي',
  users:               'إدارة المستخدمين',
  council_members:     'أعضاء فئتي',
  general_secretariat: 'الأمانة العامة للشبيبة المسيحيّة',
  config:              'الإعدادات والتهيئة',
  youth_groups:        'ملف فرق الشبيبة',
  churches:            'الكنائس',
  churches_map:        'خريطة الكنائس',
  people_locations_map:'خريطة مواقع الأشخاص',
  bible_reader:        'قارئ الكتاب المقدس',
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
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [credUsername, setCredUsername] = useState('')
  const [credPassword, setCredPassword] = useState('')
  const [credPasswordConfirm, setCredPasswordConfirm] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [youthGroupLabels, setYouthGroupLabels] = useState({})
  const [memberMottoByGroup, setMemberMottoByGroup] = useState({})
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

  const openCredentialsModal = () => {
    setCredUsername((authUser?.username || '').toLowerCase())
    setCredPassword('')
    setCredPasswordConfirm('')
    setShowCredentialsModal(true)
  }

  const handleSaveMyCredentials = async () => {
    const currentUsername = (authUser?.username || '').toLowerCase()
    const nextUsername = (credUsername || '').trim().toLowerCase()
    const nextPassword = credPassword || ''
    const nextPasswordConfirm = credPasswordConfirm || ''

    if (!nextUsername) {
      toast('اسم المستخدم مطلوب', 'error')
      return
    }

    const body = {}
    if (nextUsername !== currentUsername) body.username = nextUsername
    if (nextPassword && nextPassword !== nextPasswordConfirm) {
      toast('تأكيد كلمة المرور غير مطابق', 'error')
      return
    }
    if (nextPassword) body.password = nextPassword
    if (!Object.keys(body).length) {
      setShowCredentialsModal(false)
      return
    }

    setSavingCreds(true)
    try {
      const res = await api.updateUser(currentUsername, body)
      if (res?.user) setAuthUser(prev => ({ ...(prev || {}), ...res.user }))
      toast('تم حفظ بيانات الدخول', 'success')
      setShowCredentialsModal(false)
      setCredPassword('')
      setCredPasswordConfirm('')
    } catch (e) {
      if ((e?.message || '').includes('409')) toast('اسم المستخدم موجود مسبقاً', 'error')
      else toast('تعذّر حفظ بيانات الدخول', 'error')
    } finally {
      setSavingCreds(false)
    }
  }

  // When impersonating, use the viewAsUser as effective context (read-only for everything)
  const effectiveUser  = viewAsUser || authUser
  const isAdmin        = authUser?.role === 'admin' && !viewAsUser
  const isMember       = effectiveUser?.role === 'member'
  // council_access: { youth_group_name: [age_group, ...] }
  const councilAccess  = effectiveUser?.council_access || {}
  const isCouncil      = isMember && Object.keys(councilAccess).length > 0
  const memberYouthGroups = [...new Set((effectiveUser?.youth_groups || []).filter(Boolean))]
  const memberYouthGroupsKey = memberYouthGroups.join('|')

  const buildMemberMottoLabel = (groupLabel, sameAsJecJordan, yearLabel) => {
    const buildWithYear = (base) => {
      const year = String(yearLabel || '').trim()
      return year ? `${base} لعام ${year}` : base
    }

    if (sameAsJecJordan) return buildWithYear('شعار شبيبة الأردن')
    const raw = String(groupLabel || '').trim()
    const withoutPrefix = raw.replace(/^\s*شبيبة\s*/u, '').trim()
    const suffix = withoutPrefix || raw || '—'
    return buildWithYear(`شعار شبيبة ${suffix}`)
  }

  const memberYouthGroupCards = memberYouthGroups.map(gid => ({
    id: gid,
    label: youthGroupLabels[gid] || api.formatYouthGroupLabel(gid) || gid,
    mottoLogoUrl: memberMottoByGroup[gid]?.logoUrl || '',
    mottoScopeLabel: buildMemberMottoLabel(
      youthGroupLabels[gid] || api.formatYouthGroupLabel(gid) || gid,
      !!memberMottoByGroup[gid]?.sameAsJecJordan,
      memberMottoByGroup[gid]?.yearLabel,
    ),
    mottoVerseText: memberMottoByGroup[gid]?.mottoText || '',
  }))

  useEffect(() => {
    api.filters()
      .then((f) => {
        const map = {}
        for (const yg of (f?.youth_group || [])) {
          const gid = String(yg?.value || '').trim()
          if (!gid) continue
          map[gid] = api.formatYouthGroupLabel(yg?.label || gid) || gid
        }
        setYouthGroupLabels(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isMember) {
      setMemberMottoByGroup({})
      return
    }

    const groupIds = memberYouthGroups
      .map((gid) => String(gid || '').trim())
      .filter(Boolean)

    let cancelled = false
    api.listActiveMottos({ youthGroupIds: groupIds, includeJecJordan: true })
      .then((res) => {
        if (cancelled) return
        const rows = Array.isArray(res?.mottos) ? res.mottos : []
        const globalRow = rows.find((row) => row?.targets?.jec_jordan && row?.logo_url)
        const globalLogo = String(globalRow?.logo_url || '').trim()
        const globalId = String(globalRow?.id || '').trim()

        const byGroup = {}
        for (const gid of groupIds) {
          const directRow = rows.find((row) => {
            const logoUrl = String(row?.logo_url || '').trim()
            if (!logoUrl) return false
            const targets = row?.targets && typeof row.targets === 'object' ? row.targets : {}
            const targetGroups = Array.isArray(targets.youth_groups) ? targets.youth_groups : []
            return targetGroups.map((x) => String(x || '').trim()).includes(gid)
          })

          const directLogo = String(directRow?.logo_url || '').trim()
          const logoUrl = directLogo || globalLogo
          if (!logoUrl) continue

          const sourceRow = directLogo ? directRow : globalRow
          const yearLabel = String(sourceRow?.year_label || '').trim()
          const mottoText = formatMottoTextWithSource(sourceRow)

          const sameAsJecJordan = !!globalLogo && (
            !directRow
            || (String(directRow?.id || '').trim() && String(directRow?.id || '').trim() === globalId)
            || directLogo === globalLogo
          )

          byGroup[gid] = { logoUrl, sameAsJecJordan, yearLabel, mottoText }
        }

        setMemberMottoByGroup(byGroup)
      })
      .catch(() => {
        if (cancelled) return
        setMemberMottoByGroup({})
      })

    return () => {
      cancelled = true
    }
  }, [isMember, memberYouthGroupsKey])

  // ── Navigation ──────────────────────────────────────────────────────────────
  const NAV = isAdmin ? [
    { id: 'dashboard',           label: 'لوحة المعلومات',              icon: LayoutDashboard },
    { id: 'members',             label: 'الأعضاء',                      icon: Users },
    { id: 'orgtree',             label: 'الهيكل التنظيمي',             icon: GitBranch },
    { id: 'general_secretariat', label: 'الأمانة العامة',              icon: GitBranch },
    { id: 'users',               label: 'إدارة المستخدمين',            icon: ShieldCheck },
    { id: 'questionnaires',       label: 'إدارة الاستبيانات',           icon: ClipboardList },
    { id: 'youth_groups',         label: 'ملف فرق الشبيبة',              icon: Building2 },
    { id: 'churches',             label: 'الكنائس',                       icon: MapPin },
    { id: 'churches_map',         label: 'خريطة الكنائس',                 icon: MapPin },
    { id: 'people_locations_map', label: 'خريطة مواقع الأشخاص',           icon: Map },
    { id: 'bible_reader',         label: 'قارئ الكتاب المقدس',            icon: BookOpenText },
    { id: 'config',               label: 'الإعدادات',                    icon: Settings },
  ] : [
    { id: 'profile',         label: 'ملفي الشخصي',       icon: UserIcon },
    { id: 'orgtree',         label: 'الهيكل التنظيمي',   icon: GitBranch },
    ...(isCouncil ? [{ id: 'council_members', label: 'أعضاء فئتي', icon: Users }] : []),
    { id: 'bible_reader', label: 'قارئ الكتاب المقدس', icon: BookOpenText },
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
    const normalizedReturnPage = returnPage === 'profile'
      ? (profileReturnPage === 'profile' ? 'members' : profileReturnPage)
      : returnPage
    setSelected(pid)
    setOrgContext(ctx)
    setIsUnreg(unreg)
    setProfileReturnPage(normalizedReturnPage)
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
      ? ['dashboard', 'members', 'orgtree', 'general_secretariat', 'users', 'questionnaires', 'youth_groups', 'churches', 'churches_map', 'people_locations_map', 'bible_reader', 'config']
      : ['profile', 'orgtree', 'council_members', 'bible_reader', 'my_questions']
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
          <img
            src="/api/logo"
            alt="JEC Logo"
            className="sidebar-logo-image"
            onError={(e) => {
              e.currentTarget.onerror = null
              e.currentTarget.src = '/api/logo'
            }}
          />
          <div className="sidebar-logo-text">
            <h1>JEC</h1>
            <span>نظام إدارة الأعضاء</span>
          </div>
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
                  <span style={{ color: '#ffffff', opacity: 0.9 }}>{info.group_name || grp}: </span>
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
            {!viewAsUser && (
              <button className="btn btn-ghost btn-sm" onClick={openCredentialsModal}>
                <Key size={14}/> بيانات الدخول
              </button>
            )}
          </div>
        </header>

        {isMember && memberYouthGroupCards.length > 0 && (
          <div
            style={{
              background: 'var(--gray-50)',
              borderBottom: '1px solid var(--gray-200)',
              padding: '10px 20px',
            }}
          >
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {memberYouthGroupCards.map((g) => (
                <div key={g.id} style={{ display: 'flex', gap: 8 }}>
                  <MemberYouthGroupLogoTile groupId={g.id} label={g.label} />
                  {g.mottoLogoUrl ? (
                    <MemberMottoTile
                      logoUrl={g.mottoLogoUrl}
                      verseText={g.mottoVerseText}
                      scopeLabel={g.mottoScopeLabel}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

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
              onViewProfile={(pid, ctx) => goProfile(pid, ctx, false, 'general_secretariat')}
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

          {isAdmin && page === 'youth_groups' && (
            <YouthGroupAdmin toast={toast} />
          )}

          {isAdmin && page === 'churches' && (
            <ChurchesAdmin toast={toast} />
          )}

          {isAdmin && page === 'churches_map' && (
            <ChurchesMap toast={toast} />
          )}

          {isAdmin && page === 'people_locations_map' && (
            <PeopleLocationsMap toast={toast} />
          )}

          {page === 'bible_reader' && (
            <BibleReader toast={toast} />
          )}

          {isAdmin && page === 'config' && (
            <Config toast={toast} />
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

      {showCredentialsModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={(e) => e.target === e.currentTarget && !savingCreds && setShowCredentialsModal(false)}
        >
          <div
            style={{
              background: 'white', borderRadius: 14, width: '100%', maxWidth: 420,
              boxShadow: '0 24px 64px rgba(0,0,0,0.2)', direction: 'rtl',
            }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e6ef', fontWeight: 800, color: '#0f2744' }}>
              تعديل بيانات الدخول
            </div>
            <div style={{ padding: 18, display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#4a5568', fontWeight: 700, display: 'block', marginBottom: 5 }}>
                  اسم المستخدم
                </label>
                <input
                  value={credUsername}
                  onChange={(e) => setCredUsername(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
                    fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'rtl', textAlign: 'right', outline: 'none',
                  }}
                  placeholder="username"
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#4a5568', fontWeight: 700, display: 'block', marginBottom: 5 }}>
                  كلمة المرور الجديدة (اختياري)
                </label>
                <input
                  type="password"
                  value={credPassword}
                  onChange={(e) => setCredPassword(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
                    fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'rtl', textAlign: 'right', outline: 'none',
                  }}
                  placeholder="اتركها فارغة إذا لا تريد تغييرها"
                />
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#4a5568', fontWeight: 700, display: 'block', marginBottom: 5 }}>
                  تأكيد كلمة المرور الجديدة
                </label>
                <input
                  type="password"
                  value={credPasswordConfirm}
                  onChange={(e) => setCredPasswordConfirm(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8,
                    fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'rtl', textAlign: 'right', outline: 'none',
                  }}
                  placeholder="أعد إدخال كلمة المرور الجديدة"
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCredentialsModal(false)} disabled={savingCreds}>إلغاء</button>
                <button className="btn btn-gold btn-sm" onClick={handleSaveMyCredentials} disabled={savingCreds}>
                  {savingCreds ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts}/>
    </div>
  )
}
