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

function HtmlBarChart({ data, colors, barHeight = 24, gap = 8, fontSize = 13, labelWidth = 160, animate = false }) {
  if (!data?.length) return null
  const max = Math.max(...data.map(d => d.value))
  return (
    <div style={{ width: '100%', fontFamily: 'Tajawal', direction: 'rtl' }}>
      {data.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: gap }}>
          <div style={{
            width: labelWidth, minWidth: labelWidth, fontSize, color: '#374151',
            textAlign: 'right', paddingLeft: 8, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {item.label}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              height: barHeight,
              width: animate ? `${(item.value / max) * 100}%` : '0%',
              background: colors[i % colors.length],
              borderRadius: '0 4px 4px 0',
              minWidth: 2,
              transition: 'width 900ms ease-out',
              transitionDelay: `${i * 35}ms`,
            }} />
            <span style={{ fontSize: fontSize - 1, color: '#6b7280', whiteSpace: 'nowrap' }}>
              {item.value.toLocaleString('ar-EG')}
            </span>
          </div>
        </div>
      ))}
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
          <div className="card-header"><span className="card-title">الأعضاء حسب المحافظة</span></div>
          <div className="card-body">
            <HtmlBarChart data={govData} colors={COLORS} labelWidth={160} animate={animateCharts} />
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
            <span className="card-title">أعلى فرق الشبيبة (أعضاءً)</span>
            <span style={{ fontSize: 12, color: '#9ba5bc', fontFamily: 'Tajawal' }}>
              {ygData.length} فرقة
            </span>
          </div>
          <div className="card-body" style={{ maxHeight: 480, overflowY: 'auto', paddingLeft: 4 }}>
            <HtmlBarChart data={ygData} colors={Array(ygData.length).fill('#c9963c')} labelWidth={230} fontSize={12} barHeight={22} gap={6} animate={animateCharts} />
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
