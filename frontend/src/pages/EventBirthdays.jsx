import { useMemo } from 'react'
import { Cake, Gift, PartyPopper, Users, UserCheck, Building2, UserPlus } from 'lucide-react'

// ── Constants ───────────────────────────────────────────────────────────────────

const AR_MONTHS = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
]

const ROLE_META = {
  members:      { label: 'مشارك',     bg: '#eff6ff', text: '#1d4ed8', icon: Users },
  supervisors:  { label: 'مسؤول',      bg: '#f5f3ff', text: '#7c3aed', icon: UserCheck },
  gs_committee: { label: 'أمانة/لجان', bg: '#fff7ed', text: '#c2410c', icon: Building2 },
  guests:       { label: 'ضيف',        bg: '#f0fdf4', text: '#15803d', icon: UserPlus },
}
const REG_TYPES = ['members', 'supervisors', 'gs_committee', 'guests']

const DAY   = 86400000
const MS_MIDNIGHT = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d) }

function dayWord(n) {
  return n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : `${n} أيام`
}

// Rank orders categories: during (0), after1 (1), before1 (2), after2 (3), before2 (4), …
function categoryLabel(cat) {
  if (cat.dir === 'during') return 'خلال فترة النشاط'
  if (cat.dir === 'after')  return `بعد انتهاء النشاط بـ${dayWord(cat.n)}`
  return `قبل بداية النشاط بـ${dayWord(cat.n)}`
}

// Find the closest birthday occurrence within ±7 days of the event window.
function birthdayProximity(month, day, startDate, endDate) {
  const years = new Set([
    startDate.getFullYear() - 1, startDate.getFullYear(),
    endDate.getFullYear(), endDate.getFullYear() + 1,
  ])
  let best = null
  for (const y of years) {
    const b = new Date(y, month - 1, day)
    if (b.getMonth() !== month - 1) continue // invalid date rolled over (e.g. Feb 29 non-leap)
    let cat = null
    if (b >= startDate && b <= endDate) {
      cat = { dir: 'during', n: 0, rank: 0 }
    } else if (b > endDate) {
      const n = Math.round((b - endDate) / DAY)
      if (n >= 1 && n <= 7) cat = { dir: 'after', n, rank: 2 * n - 1 }
    } else {
      const n = Math.round((startDate - b) / DAY)
      if (n >= 1 && n <= 7) cat = { dir: 'before', n, rank: 2 * n }
    }
    if (cat && (!best || cat.rank < best.rank)) best = { ...cat, date: b }
  }
  return best
}

// ── Component ────────────────────────────────────────────────────────────────────

export default function EventBirthdays({ event }) {
  const window = useMemo(() => {
    const s = event.start_datetime, e = event.end_datetime
    if (!s || !e) return null
    try { return { start: MS_MIDNIGHT(s), end: MS_MIDNIGHT(e) } }
    catch { return null }
  }, [event.start_datetime, event.end_datetime])

  // Dedupe all registered people across reg types, collecting their roles
  const people = useMemo(() => {
    const byPid = new Map()
    for (const rt of REG_TYPES) {
      for (const entry of (event.registration?.[rt] || [])) {
        const pid = String(entry.person_id ?? '').trim()
        if (!pid) continue
        if (!byPid.has(pid)) {
          byPid.set(pid, {
            person_id: pid,
            name: entry.name,
            birth_day: entry.birth_day,
            birth_month: entry.birth_month,
            birth_year: entry.birth_year,
            gender: entry.gender,
            youth_group_label: entry.youth_group_label,
            roles: new Set([rt]),
            apologized: entry.attendance_status === 'apologized',
          })
        } else {
          const p = byPid.get(pid)
          p.roles.add(rt)
          if (entry.attendance_status !== 'apologized') p.apologized = false
        }
      }
    }
    return [...byPid.values()]
  }, [event.registration])

  // Compute proximity, keep only those within ±7 days
  const withBirthdays = useMemo(() => {
    if (!window) return []
    const out = []
    for (const p of people) {
      if (!p.birth_day || !p.birth_month) continue
      const prox = birthdayProximity(p.birth_month, p.birth_day, window.start, window.end)
      if (prox) out.push({ ...p, prox })
    }
    return out
  }, [people, window])

  // Group by category rank, ordered
  const sections = useMemo(() => {
    const groups = new Map()
    for (const p of withBirthdays) {
      const key = p.prox.rank
      if (!groups.has(key)) groups.set(key, { cat: p.prox, people: [] })
      groups.get(key).people.push(p)
    }
    const ordered = [...groups.values()].sort((a, b) => a.cat.rank - b.cat.rank)
    for (const g of ordered) {
      g.people.sort((a, b) =>
        (a.prox.date - b.prox.date) || (a.name || '').localeCompare(b.name || '', 'ar'))
    }
    return ordered
  }, [withBirthdays])

  if (!window) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
        <Cake size={30} style={{ marginBottom: 10, opacity: 0.3 }} />
        <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>حدّد تاريخ بداية ونهاية النشاط أولاً</div>
      </div>
    )
  }

  const duringCount = sections.find(s => s.cat.dir === 'during')?.people.length || 0

  return (
    <div style={{ direction: 'rtl' }}>
      {/* Intro / summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 14px' }}>
          <Gift size={16} color="#c9963c" />
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f2744' }}>
            أعياد الميلاد ضمن أسبوع من فترة النشاط
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {duringCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', fontWeight: 800, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 20, padding: '5px 14px' }}>
            <PartyPopper size={14} /> {duringCount} خلال النشاط
          </span>
        )}
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 20, padding: '5px 14px' }}>
          {withBirthdays.length} شخص إجمالاً
        </span>
      </div>

      {sections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: '#c5cdd8', border: '1.5px dashed #e9ecf3', borderRadius: 12 }}>
          <Cake size={30} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>لا يوجد أعياد ميلاد ضمن أسبوع من فترة النشاط</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sections.map(({ cat, people: grp }) => {
            const isDuring = cat.dir === 'during'
            return (
              <div key={cat.rank} style={{
                background: 'white',
                border: `1px solid ${isDuring ? '#fde68a' : '#edf0f7'}`,
                borderRadius: 12, overflow: 'hidden',
                boxShadow: isDuring ? '0 2px 10px rgba(201,150,60,0.18)' : '0 1px 4px rgba(15,39,68,0.04)',
              }}>
                {/* Section header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px',
                  background: isDuring ? 'linear-gradient(90deg, #b8860b, #c9963c)' : '#f8fafc',
                  borderBottom: '1px solid #edf0f7',
                }}>
                  {isDuring
                    ? <PartyPopper size={16} color="white" />
                    : <Cake size={14} color="#9ba5bc" />}
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: isDuring ? 'white' : '#0f2744' }}>
                    {categoryLabel(cat)}
                  </span>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 800,
                    color: isDuring ? '#b45309' : '#64748b',
                    background: isDuring ? 'white' : '#eef1f6',
                    borderRadius: 20, padding: '1px 9px',
                  }}>
                    {grp.length}
                  </span>
                </div>

                {/* People rows */}
                <div>
                  {grp.map((p, i) => (
                    <div key={p.person_id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
                      borderBottom: i < grp.length - 1 ? '1px solid #f5f6fa' : 'none',
                      background: isDuring ? '#fffdf7' : 'white',
                      opacity: p.apologized ? 0.55 : 1,
                    }}>
                      {/* Cake date badge */}
                      <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        minWidth: 46, padding: '4px 6px', borderRadius: 9,
                        background: isDuring ? '#fef3c7' : '#f1f5f9',
                        border: `1px solid ${isDuring ? '#fde68a' : '#e9ecf3'}`,
                      }}>
                        <span style={{ fontSize: '1rem', fontWeight: 900, color: '#0f2744', lineHeight: 1 }}>{p.birth_day}</span>
                        <span style={{ fontSize: '0.56rem', fontWeight: 700, color: '#6b7280', marginTop: 2, whiteSpace: 'nowrap' }}>
                          {AR_MONTHS[p.birth_month - 1] || ''}
                        </span>
                      </div>

                      {/* Name + youth group */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f2744', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name || p.person_id}
                          {p.apologized && <span style={{ fontSize: '0.6rem', color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0 5px', marginRight: 6, fontWeight: 700 }}>معتذر</span>}
                        </div>
                        {p.youth_group_label && (
                          <div style={{ fontSize: '0.68rem', color: '#9ba5bc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.youth_group_label}</div>
                        )}
                      </div>

                      {/* Age turning */}
                      {p.birth_year ? (
                        <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#0f2744', background: '#eef2ff', borderRadius: 8, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          {p.prox.date.getFullYear() - p.birth_year} سنة
                        </span>
                      ) : null}

                      {/* Role badges */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {[...p.roles].map(rt => {
                          const m = ROLE_META[rt]
                          if (!m) return null
                          return (
                            <span key={rt} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.62rem', fontWeight: 700, color: m.text, background: m.bg, borderRadius: 8, padding: '2px 7px' }}>
                              <m.icon size={10} /> {m.label}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
