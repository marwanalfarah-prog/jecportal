import { useCallback, useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Users, Building2, GraduationCap, Briefcase, Globe, MapPin } from 'lucide-react'
import { api } from '../api.js'
import { buildMottoBibleReaderTarget, formatMottoTextWithSource } from '../mottoBibleReference.js'
import { ErrorState, LoadingState } from '../pageStates.jsx'

const COLORS = ['#0f2744','#1a3a5c','#2d5986','#c9963c','#e8b55a','#4a7fb5','#3d6a99','#9ba5bc','#6b778f','#4a5568']

function buildScopeLabel(targets, yearLabel) {
  const groups = Array.isArray(targets?.youth_groups) ? targets.youth_groups : []
  const base = targets?.jec_jordan
    ? 'شعار شبيبة الأردن'
    : (groups.length ? `شعار شبيبة ${groups.join('، ')}` : 'شعار الشبيبة')
  const year = String(yearLabel || '').trim()
  return year ? `${base} لعام ${year}` : base
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className="val">{value?.toLocaleString('ar-EG') ?? '—'}</div>
      <div className="lbl">{label}</div>
      <div className="icon-bg"><Icon size={48} /></div>
    </div>
  )
}

const REGION_STYLES = {
  'الشمال': { color: '#3d7ab8', tint: 'rgba(61,122,184,0.07)' },
  'الوسط':  { color: '#b8862f', tint: 'rgba(184,134,47,0.07)' },
  'الجنوب': { color: '#a8447e', tint: 'rgba(168,68,126,0.07)' },
}
const UNGROUPED_STYLE = { color: '#6b778f', tint: 'rgba(107,119,143,0.07)' }
const UNGROUPED_REGION_LABEL = 'بدون منطقة'

const ar = (n) => n.toLocaleString('ar-EG')

/** Arabic singular / dual / plural agreement for a counted noun. */
function arabicCount(n, one, two, few, many) {
  if (n === 1) return one
  if (n === 2) return two
  const remainder = n % 100
  if (remainder >= 3 && remainder <= 10) return `${ar(n)} ${few}`
  return `${ar(n)} ${many}`
}

const membersCount     = (n) => arabicCount(n, 'عضو واحد', 'عضوان', 'أعضاء', 'عضواً')
const groupsCount      = (n) => arabicCount(n, 'فرقة واحدة', 'فرقتان', 'فرق', 'فرقة')
const governoratesCount = (n) => arabicCount(n, 'محافظة واحدة', 'محافظتان', 'محافظات', 'محافظة')

/** Split rows into consecutive buckets by key, preserving the order the API sent. */
function groupRows(rows, keyOf) {
  const buckets = []
  const seen = new Map()
  rows.forEach(row => {
    const key = (keyOf(row) || '').trim()
    if (!seen.has(key)) {
      seen.set(key, buckets.length)
      buckets.push({ key, rows: [] })
    }
    buckets[seen.get(key)].rows.push(row)
  })
  return buckets
}

const sumValues = (rows) => rows.reduce((total, row) => total + (row.value || 0), 0)

function GroupedBar({ item, color, max, index, barHeight, gap, fontSize, labelWidth, animate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: gap }}>
      <div title={item.label} style={{
        width: labelWidth, minWidth: labelWidth, fontSize, color: 'var(--gray-600)',
        textAlign: 'right', paddingLeft: 8, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {item.label}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{
          height: barHeight,
          width: animate ? `${(item.value / max) * 100}%` : '0%',
          background: color,
          borderRadius: '0 4px 4px 0',
          minWidth: item.value > 0 ? 2 : 0,
          transition: 'width 900ms ease-out',
          transitionDelay: `${index * 30}ms`,
        }} />
        <span style={{ fontSize: fontSize - 1, color: 'var(--gray-500)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {ar(item.value)}
        </span>
      </div>
    </div>
  )
}

/**
 * Bars boxed by region (and optionally by governorate inside it), each box
 * headed by its name and its own totals. All bars share one scale so lengths
 * stay comparable across boxes.
 */
function RegionGroupedBarChart({
  data, subGroup = false, barHeight = 22, gap = 6, fontSize = 12, labelWidth = 150, animate = false,
}) {
  if (!data?.length) return null
  const max = Math.max(...data.map(d => d.value), 0) || 1
  const regions = groupRows(data, row => row.region)
  let barIndex = -1

  return (
    <div style={{ width: '100%', fontFamily: 'Tajawal', direction: 'rtl' }}>
      {regions.map(region => {
        const style = REGION_STYLES[region.key] || UNGROUPED_STYLE
        const governorates = subGroup
          ? groupRows(region.rows, row => row.governorate)
          : [{ key: null, rows: region.rows }]
        const regionSummary = subGroup
          ? `${membersCount(sumValues(region.rows))} · ${groupsCount(region.rows.length)}`
          : `${membersCount(sumValues(region.rows))} · ${governoratesCount(region.rows.length)}`

        return (
          <section key={region.key || UNGROUPED_REGION_LABEL} style={{
            borderRight: `3px solid ${style.color}`,
            background: style.tint,
            borderRadius: '4px 10px 10px 4px',
            padding: '10px 12px 8px',
            marginBottom: 10,
          }}>
            <header style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 8, marginBottom: 8,
            }}>
              <span style={{ fontFamily: 'Cairo', fontSize: 13, fontWeight: 700, color: style.color }}>
                {region.key || UNGROUPED_REGION_LABEL}
              </span>
              <span style={{ fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                {regionSummary}
              </span>
            </header>

            {governorates.map((governorate, gi) => (
              <div key={governorate.key || `g${gi}`} style={{ marginBottom: gi === governorates.length - 1 ? 0 : 10 }}>
                {subGroup && governorate.key && (
                  <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: 8, padding: '0 0 4px', marginBottom: 6,
                    borderBottom: '1px dashed var(--gray-200)',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--gray-600)' }}>
                      {governorate.key}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
                      {membersCount(sumValues(governorate.rows))} · {groupsCount(governorate.rows.length)}
                    </span>
                  </div>
                )}
                {governorate.rows.map(row => {
                  barIndex += 1
                  return (
                    <GroupedBar
                      key={row.group_id || row.label}
                      item={row}
                      color={style.color}
                      max={max}
                      index={barIndex}
                      barHeight={barHeight}
                      gap={gap}
                      fontSize={fontSize}
                      labelWidth={labelWidth}
                      animate={animate}
                    />
                  )
                })}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export default function Dashboard({ onOpenBibleReference }) {
  const [stats, setStats]       = useState(null)
  const [govData, setGovData]   = useState([])
  const [genderData, setGender] = useState([])
  const [ygData, setYg]         = useState([])
  const [ageData, setAge]       = useState([])
  const [mottoData, setMottoData] = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [animateCharts, setAnimateCharts] = useState(false)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setAnimateCharts(false)
    try {
      const [s, g, ge, y, a, m] = await Promise.all([
        api.stats(),
        api.chartGov(),
        api.chartGender(),
        api.chartYG(),
        api.chartAge(),
        api.listActiveMottos({ includeJecJordan: true }),
      ])
      setStats(s)
      setGovData(g)
      setGender(ge)
      setYg(y)
      setAge(a)
      setMottoData(Array.isArray(m?.mottos) ? m.mottos : [])
      requestAnimationFrame(() => setAnimateCharts(true))
    } catch {
      setLoadError('تعذر تحميل لوحة المعلومات حالياً. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  if (loading) {
    return (
      <LoadingState
        title="جارٍ تحميل لوحة المعلومات"
        description="يتم جمع الإحصاءات والرسوم البيانية الآن."
        minHeight={320}
      />
    )
  }

  if (loadError) {
    return (
      <ErrorState
        title="تعذر تحميل لوحة المعلومات"
        description={loadError}
        onRetry={loadDashboard}
        minHeight={320}
      />
    )
  }

  return (
    <div>
      {mottoData.length > 0 && (
        <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
          <div
            className="card-body"
            style={{
              display: 'grid',
              gap: 10,
              background: 'linear-gradient(180deg, #fffdf8 0%, #ffffff 100%)',
            }}
          >
            {mottoData.map((motto) => {
              const targets = motto?.targets && typeof motto.targets === 'object' ? motto.targets : {}
              const isJecJordanMotto = Boolean(targets?.jec_jordan)
              const scopeLabel = buildScopeLabel(targets, motto?.year_label)
              const bibleTarget = buildMottoBibleReaderTarget(motto)
              const verseText = formatMottoTextWithSource(motto)
              const leftLogoUrl = String(motto?.logo_url || '').trim()
              const rightLogoUrl = isJecJordanMotto ? '/api/logo' : ''

              return (
                <div
                  key={motto.id || `${motto.title}-${motto.year_label}`}
                  style={{
                    border: '1px solid rgba(201, 150, 60, 0.22)',
                    borderRadius: 16,
                    padding: '14px 16px',
                    background: 'radial-gradient(circle at top right, rgba(201, 150, 60, 0.12), transparent 34%), #fff',
                    boxShadow: '0 10px 28px rgba(15, 39, 68, 0.06)',
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: leftLogoUrl || rightLogoUrl ? 120 : undefined,
                      paddingLeft: leftLogoUrl ? 'clamp(104px, 18vw, 168px)' : 0,
                      paddingRight: rightLogoUrl ? 'clamp(104px, 18vw, 168px)' : 0,
                    }}
                  >
                    <div
                      style={{
                        minWidth: 0,
                        display: 'grid',
                        justifyItems: 'center',
                        gap: 10,
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: 'rgba(201, 150, 60, 0.12)',
                          color: '#9c6a17',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                        }}
                      >
                        {scopeLabel}
                      </div>

                      {bibleTarget ? (
                        <button
                          type="button"
                          onClick={() => onOpenBibleReference?.(bibleTarget)}
                          style={{
                            fontFamily: 'inherit',
                            fontWeight: 800,
                            fontSize: '1.3rem',
                            color: '#0f2744',
                            lineHeight: 1.75,
                            border: 'none',
                            background: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'center',
                            textDecoration: 'none',
                          }}
                          title="افتح المرجع في قارئ الكتاب المقدس"
                        >
                          {verseText}
                        </button>
                      ) : (
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: '1.3rem',
                            color: '#0f2744',
                            lineHeight: 1.75,
                            textAlign: 'center',
                          }}
                        >
                          {verseText}
                        </div>
                      )}
                    </div>

                    {leftLogoUrl ? (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          width: 'clamp(88px, 14vw, 140px)',
                        }}
                      >
                        <img
                          src={leftLogoUrl}
                          alt={`${scopeLabel} logo`}
                          style={{
                            width: '100%',
                            maxWidth: 140,
                            maxHeight: 140,
                            objectFit: 'contain',
                            display: 'block',
                          }}
                        />
                      </div>
                    ) : null}

                    {rightLogoUrl ? (
                      <div
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          width: 'clamp(80px, 12vw, 124px)',
                        }}
                      >
                        <img
                          src={rightLogoUrl}
                          alt={scopeLabel}
                          style={{
                            width: '100%',
                            maxWidth: 124,
                            maxHeight: 124,
                            objectFit: 'contain',
                            display: 'block',
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="إجمالي الأعضاء"      value={stats.total_members} icon={Users} />
        <StatCard label="فرق الشبيبة"          value={stats.youth_groups}  icon={Building2} />
        <StatCard label="سجلات التعليم العالي" value={stats.higher_ed}     icon={GraduationCap} />
        <StatCard label="سجلات التوظيف"        value={stats.employed}      icon={Briefcase} />
        <StatCard label="المحافظات"             value={stats.governorates}  icon={MapPin} />
        <StatCard label="الجنسيات"              value={stats.nationalities} icon={Globe} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">الأعضاء حسب المحافظة</span>
            <span style={{ fontSize: 12, color: 'var(--gray-400)', fontFamily: 'Tajawal' }}>
              مرتّبة حسب المنطقة
            </span>
          </div>
          <div className="card-body" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <RegionGroupedBarChart data={govData} labelWidth={110} fontSize={13} barHeight={24} animate={animateCharts} />
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">الأعضاء حسب الجنس</span></div>
          <div className="card-body chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={genderData} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={100}
                  isAnimationActive={animateCharts}
                  animationBegin={150}
                  animationDuration={900}
                  animationEasing="ease-out"
                  label={({ label, percent }) => `${label} ${(percent * 100).toFixed(0)}%`}>
                  {genderData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => v.toLocaleString('ar-EG')} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">الأعضاء حسب فرقة الشبيبة</span>
            <span style={{ fontSize: 12, color: 'var(--gray-400)', fontFamily: 'Tajawal' }}>
              {groupsCount(ygData.length)}
            </span>
          </div>
          <div className="card-body" style={{ maxHeight: 560, overflowY: 'auto', paddingLeft: 4 }}>
            <RegionGroupedBarChart data={ygData} subGroup labelWidth={215} fontSize={12} barHeight={22} gap={6} animate={animateCharts} />
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">توزيع الفئات العمرية</span></div>
          <div className="card-body chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={ageData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                  isAnimationActive={animateCharts}
                  animationBegin={220}
                  animationDuration={950}
                  animationEasing="ease-out">
                  {ageData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => v.toLocaleString('ar-EG')} />
                <Legend wrapperStyle={{ fontFamily: 'Tajawal', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
