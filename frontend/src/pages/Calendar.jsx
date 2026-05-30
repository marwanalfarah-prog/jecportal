import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Gift } from 'lucide-react'
import { api } from '../api.js'
import { LoadingState, ErrorState } from '../pageStates.jsx'

// ── Arabic locale ─────────────────────────────────────────────────────────────
const AR_MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
]
const AR_DAYS_SHORT = ['أح','إث','ثل','أر','خم','جم','سب']

// ── Extensible event-type registry ───────────────────────────────────────────
// To add a new event type later: add an entry here and adapt normalizeEvents().
export const CALENDAR_EVENT_TYPES = {
  birthday: {
    color:   '#c9963c',
    bgLight: 'rgba(201,150,60,0.11)',
    label:   'عيد ميلاد',
    Icon:    Gift,
  },
  // future:
  // event:        { color: '#0f2744', bgLight: 'rgba(15,39,68,0.07)',  label: 'حدث',      Icon: ... },
  // announcement: { color: '#1a7a45', bgLight: 'rgba(26,122,69,0.08)', label: 'إعلان',    Icon: ... },
}

// ── Data normalization ────────────────────────────────────────────────────────
function normalizeBirthdays(raw = []) {
  return raw.map(b => ({
    id:       `bday-${b.person_id}`,
    type:     'birthday',
    month:    b.birth_month,   // 1-12
    day:      b.birth_day,     // 1-31
    label:    b.name || '—',
    personId: String(b.person_id),
    canView:  Boolean(b.can_view),
  }))
}

// ── Calendar grid ─────────────────────────────────────────────────────────────
function buildGrid(year, month) {
  const firstDow    = new Date(year, month - 1, 1).getDay()   // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysInPrev  = new Date(year, month - 1, 0).getDate()
  const prevM = month === 1  ? 12 : month - 1
  const nextM = month === 12 ? 1  : month + 1
  const prevY = month === 1  ? year - 1 : year
  const nextY = month === 12 ? year + 1 : year

  const cells = []
  for (let i = firstDow - 1; i >= 0; i--)
    cells.push({ day: daysInPrev - i, month: prevM, year: prevY, current: false })
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, month, year, current: true })
  const trailing = 42 - cells.length
  for (let d = 1; d <= trailing; d++)
    cells.push({ day: d, month: nextM, year: nextY, current: false })
  return cells
}

// ── Upcoming (next N calendar days, recurring annually) ───────────────────────
function getUpcoming(events, days = 30) {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return events
    .map(ev => {
      const thisYear = now.getFullYear()
      let next = new Date(thisYear, ev.month - 1, ev.day)
      if (next < now) next = new Date(thisYear + 1, ev.month - 1, ev.day)
      const offset = Math.round((next - now) / 86_400_000)
      return { ...ev, offset }
    })
    .filter(ev => ev.offset >= 0 && ev.offset < days)
    .sort((a, b) => a.offset - b.offset)
}

function nameInitial(name) {
  return String(name || '').trim().split(/\s+/).find(Boolean)?.[0] || '؟'
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const NAV_BTN = {
  width: 32, height: 32, borderRadius: '50%',
  border: '1.5px solid var(--gray-200)', background: 'white',
  cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: 'var(--navy)', flexShrink: 0,
}

// ── Sub-components ────────────────────────────────────────────────────────────
function EventRow({ ev, onViewProfile, compact = false }) {
  const type = CALENDAR_EVENT_TYPES[ev.type] || CALENDAR_EVENT_TYPES.birthday
  const { Icon } = type
  const clickable = ev.canView && onViewProfile
  return (
    <div
      onClick={clickable ? () => onViewProfile(ev.personId) : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: compact ? '7px 10px' : '9px 12px',
        borderRadius: 10,
        background: type.bgLight,
        border: `1px solid ${type.color}38`,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'filter 0.12s',
      }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.filter = 'brightness(0.96)' }}
      onMouseLeave={e => { e.currentTarget.style.filter = '' }}
    >
      <div style={{
        width: compact ? 28 : 34, height: compact ? 28 : 34,
        borderRadius: '50%', background: type.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span style={{ color: 'white', fontSize: compact ? '0.72rem' : '0.82rem', fontWeight: 700 }}>
          {nameInitial(ev.label)}
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 700, color: 'var(--navy)',
          fontSize: compact ? '0.82rem' : '0.88rem',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{ev.label}</div>
        <div style={{ fontSize: '0.7rem', color: type.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon size={10} />
          {type.label}
        </div>
      </div>
      {clickable && (
        <span style={{ fontSize: '0.68rem', color: 'var(--gray-400)', flexShrink: 0 }}>←</span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Calendar({ onViewProfile }) {
  const now = new Date()
  const [events,      setEvents]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(null)
  const [year,        setYear]        = useState(now.getFullYear())
  const [month,       setMonth]       = useState(now.getMonth() + 1)
  const [selDay,      setSelDay]      = useState(now.getDate())
  const [selMonth,    setSelMonth]    = useState(now.getMonth() + 1)

  const load = useCallback(() => {
    setLoading(true); setLoadError(null)
    api.getCalendarBirthdays()
      .then(d => setEvents(normalizeBirthdays(d.birthdays)))
      .catch(() => setLoadError('تعذر تحميل بيانات التقويم. تحقق من الاتصال وأعد المحاولة.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const eventsForDay = (m, d) => events.filter(e => e.month === m && e.day === d)
  const selectedEvents = eventsForDay(selMonth, selDay)
  const upcoming = getUpcoming(events, 30)

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }
  const goToday = () => {
    const t = new Date()
    setYear(t.getFullYear()); setMonth(t.getMonth() + 1)
    setSelDay(t.getDate()); setSelMonth(t.getMonth() + 1)
  }
  const selectCell = (cell) => {
    setSelDay(cell.day); setSelMonth(cell.month)
    if (!cell.current) { setMonth(cell.month); setYear(cell.year) }
  }

  const cells  = buildGrid(year, month)
  const todayD = now.getDate()
  const todayM = now.getMonth() + 1
  const todayY = now.getFullYear()

  if (loading) return <LoadingState />
  if (loadError) return <ErrorState title="تعذر تحميل التقويم" description={loadError} onRetry={load} minHeight={300} />

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      fontFamily: 'var(--font-body)', direction: 'rtl',
    }}>

      {/* ── Top toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
        background: 'white', borderBottom: '1px solid var(--gray-200)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <CalendarIcon size={17} style={{ color: 'var(--gold)' }} />
        <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--navy)', fontFamily: 'var(--font-head)' }}>
          التقويم
        </span>
        <div style={{ flex: 1 }} />
        {/* Event-type legend */}
        {Object.values(CALENDAR_EVENT_TYPES).map(t => (
          <span key={t.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: '0.75rem', fontWeight: 600, color: t.color,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, display: 'inline-block' }} />
            {t.label}
          </span>
        ))}
        <button
          onClick={goToday}
          style={{
            padding: '5px 14px', borderRadius: 20,
            border: '1.5px solid var(--gray-200)', background: 'white',
            fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 600,
            cursor: 'pointer', color: 'var(--navy)',
          }}>
          اليوم
        </button>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* ── Calendar grid (main) ── */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 16px 24px' }}>

          {/* Month navigation (direction: ltr so chevrons are intuitive) */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 16, marginBottom: 14, direction: 'ltr',
          }}>
            <button onClick={prevMonth} style={NAV_BTN}><ChevronLeft size={16} /></button>
            <span style={{
              fontWeight: 800, fontSize: '1rem', color: 'var(--navy)',
              fontFamily: 'var(--font-head)', minWidth: 150, textAlign: 'center', direction: 'rtl',
            }}>
              {AR_MONTHS[month - 1]} {year}
            </span>
            <button onClick={nextMonth} style={NAV_BTN}><ChevronRight size={16} /></button>
          </div>

          {/* Day-of-week header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 3 }}>
            {AR_DAYS_SHORT.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: '0.7rem', fontWeight: 700,
                color: 'var(--gray-400)', padding: '4px 2px',
              }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
            {cells.map((cell, i) => {
              const dayEvs  = eventsForDay(cell.month, cell.day)
              const isToday = cell.current && cell.day === todayD && cell.month === todayM && cell.year === todayY
              const isSel   = cell.day === selDay && cell.month === selMonth

              let bg = 'white', borderStyle = '1px solid var(--gray-100)'
              if (isToday)       { bg = 'var(--navy)';              borderStyle = 'none' }
              else if (isSel)    { bg = 'rgba(201,150,60,0.12)';    borderStyle = '1.5px solid var(--gold)' }

              return (
                <div
                  key={i}
                  onClick={() => selectCell(cell)}
                  style={{
                    minHeight: 58, borderRadius: 10, padding: '6px 4px 4px',
                    background: bg, border: borderStyle,
                    cursor: 'pointer', opacity: cell.current ? 1 : 0.3,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    transition: 'background 0.12s, border 0.12s',
                  }}>
                  <span style={{
                    fontSize: '0.82rem', fontWeight: isToday ? 800 : 600, lineHeight: 1,
                    color: isToday ? 'white' : cell.current ? 'var(--navy)' : 'var(--gray-500)',
                  }}>
                    {cell.day}
                  </span>
                  {dayEvs.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
                      {dayEvs.slice(0, 4).map((ev, ei) => {
                        const t = CALENDAR_EVENT_TYPES[ev.type] || CALENDAR_EVENT_TYPES.birthday
                        return (
                          <div key={ei} style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: isToday ? 'rgba(255,255,255,0.75)' : t.color,
                          }} />
                        )
                      })}
                      {dayEvs.length > 4 && (
                        <span style={{
                          fontSize: '0.5rem', lineHeight: 1.3, fontWeight: 700,
                          color: isToday ? 'rgba(255,255,255,0.65)' : 'var(--gray-400)',
                        }}>
                          +{dayEvs.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Upcoming strip ── */}
          {upcoming.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{
                fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-400)',
                letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 10,
              }}>
                قادماً خلال 30 يوماً
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {upcoming.map(ev => {
                  const type   = CALENDAR_EVENT_TYPES[ev.type] || CALENDAR_EVENT_TYPES.birthday
                  const dayTag = ev.offset === 0 ? 'اليوم' : ev.offset === 1 ? 'غداً' : `${ev.offset} يوم`
                  const clickable = ev.canView && onViewProfile
                  return (
                    <div
                      key={ev.id}
                      onClick={clickable ? () => onViewProfile(ev.personId) : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 10px', borderRadius: 8,
                        background: ev.offset === 0 ? 'rgba(201,150,60,0.08)' : 'var(--gray-50)',
                        border: `1px solid ${ev.offset === 0 ? 'rgba(201,150,60,0.22)' : 'var(--gray-100)'}`,
                        cursor: clickable ? 'pointer' : 'default',
                      }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: type.color, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <span style={{ color: 'white', fontSize: '0.68rem', fontWeight: 700 }}>
                          {nameInitial(ev.label)}
                        </span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: '0.83rem', color: 'var(--navy)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{ev.label}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--gray-400)' }}>
                          {ev.day} {AR_MONTHS[ev.month - 1]}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: type.color, flexShrink: 0 }}>
                        {dayTag}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {events.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--gray-400)', fontSize: '0.9rem' }}>
              لا توجد بيانات للعرض في التقويم
            </div>
          )}
        </div>

        {/* ── Right panel: selected day ── */}
        <div style={{
          width: 260, flexShrink: 0,
          borderRight: '1px solid var(--gray-200)',
          background: 'var(--gray-50)', overflowY: 'auto', padding: 14,
        }}>
          <div style={{
            fontWeight: 800, fontSize: '0.95rem', color: 'var(--navy)',
            fontFamily: 'var(--font-head)', marginBottom: 12,
          }}>
            {selDay} {AR_MONTHS[selMonth - 1]}
          </div>

          {selectedEvents.length === 0 ? (
            <div style={{ color: 'var(--gray-400)', fontSize: '0.82rem', textAlign: 'center', paddingTop: 32 }}>
              لا توجد أحداث في هذا اليوم
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedEvents.map(ev => (
                <EventRow key={ev.id} ev={ev} onViewProfile={onViewProfile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
