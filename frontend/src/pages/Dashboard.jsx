import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Users, Building2, GraduationCap, Briefcase, Globe, MapPin } from 'lucide-react'
import { api } from '../api.js'

const COLORS = ['#0f2744','#1a3a5c','#2d5986','#c9963c','#e8b55a','#4a7fb5','#3d6a99','#9ba5bc','#6b778f','#4a5568']

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

export default function Dashboard() {
  const [stats, setStats]       = useState(null)
  const [govData, setGovData]   = useState([])
  const [genderData, setGender] = useState([])
  const [ygData, setYg]         = useState([])
  const [ageData, setAge]       = useState([])
  const [mottoData, setMottoData] = useState([])
  const [loading, setLoading]   = useState(true)
  const [animateCharts, setAnimateCharts] = useState(false)

  useEffect(() => {
    Promise.all([
      api.stats(), api.chartGov(), api.chartGender(), api.chartYG(), api.chartAge(), api.listActiveMottos({ includeJecJordan: true })
    ]).then(([s, g, ge, y, a, m]) => {
      setStats(s); setGovData(g); setGender(ge); setYg(y); setAge(a)
      setMottoData(Array.isArray(m?.mottos) ? m.mottos : [])
      setLoading(false)
      requestAnimationFrame(() => setAnimateCharts(true))
    })
  }, [])

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="إجمالي الأعضاء"      value={stats.total_members} icon={Users} />
        <StatCard label="فرق الشبيبة"          value={stats.youth_groups}  icon={Building2} />
        <StatCard label="سجلات التعليم العالي" value={stats.higher_ed}     icon={GraduationCap} />
        <StatCard label="سجلات التوظيف"        value={stats.employed}      icon={Briefcase} />
        <StatCard label="المحافظات"             value={stats.governorates}  icon={MapPin} />
        <StatCard label="الجنسيات"              value={stats.nationalities} icon={Globe} />
      </div>

      {mottoData.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <span className="card-title">الشعار النشط</span>
          </div>
          <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {mottoData.map((motto) => {
              const targets = motto?.targets && typeof motto.targets === 'object' ? motto.targets : {}
              const scopeLabel = buildScopeLabel(targets, motto?.year_label)

              return (
                <div
                  key={motto.id || `${motto.title}-${motto.year_label}`}
                  style={{
                    minWidth: 220,
                    maxWidth: 320,
                    border: '1px solid #e2e6ef',
                    borderRadius: 12,
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#fff',
                  }}
                >
                  {motto.logo_url ? (
                    <img
                      src={motto.logo_url}
                      alt={motto.title || 'Motto Logo'}
                      style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'contain', border: '1px solid #e2e6ef', background: '#f8f9fb', flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 8, border: '1px dashed #c8cfe0', background: '#f8f9fb', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.86rem', color: '#0f2744', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatMottoTextWithSource(motto)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {scopeLabel}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
