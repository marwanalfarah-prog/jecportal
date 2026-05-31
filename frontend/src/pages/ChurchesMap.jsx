import { useEffect, useMemo, useRef, useState } from 'react'
import { Map, MapPin, Instagram } from 'lucide-react'
import { api } from '../api.js'
import { EmptyState, ErrorState, LoadingState } from '../pageStates.jsx'

const REGIONS = ['الشمال', 'الوسط', 'الجنوب']
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const DEFAULT_CENTER = [31.9539, 35.9106]

let leafletScriptPromise = null

function ensureLeafletAssets() {
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = LEAFLET_CSS
    document.head.appendChild(link)
  }

  if (window.L) return Promise.resolve(window.L)

  if (!leafletScriptPromise) {
    leafletScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = LEAFLET_JS
      script.async = true
      script.onload = () => resolve(window.L)
      script.onerror = () => reject(new Error('failed to load leaflet'))
      document.body.appendChild(script)
    })
  }

  return leafletScriptPromise
}

function toGoogleMapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
}

function normalizeText(value) {
  return String(value || '').trim()
}

function regionRank(region) {
  const idx = REGIONS.indexOf(normalizeText(region))
  return idx === -1 ? REGIONS.length : idx
}

function parishNameOf(item) {
  return normalizeText(item?.parish_name || item?.name || item?.parish_id)
}

function compareByRegionGovernorateParishPatron(a, b) {
  const regionDiff = regionRank(a?.region) - regionRank(b?.region)
  if (regionDiff !== 0) return regionDiff

  const governorateDiff = normalizeText(a?.governorate).localeCompare(normalizeText(b?.governorate), 'ar', { sensitivity: 'base' })
  if (governorateDiff !== 0) return governorateDiff

  const parishNameDiff = parishNameOf(a).localeCompare(parishNameOf(b), 'ar', { sensitivity: 'base' })
  if (parishNameDiff !== 0) return parishNameDiff

  return normalizeText(a?.patron_saint).localeCompare(normalizeText(b?.patron_saint), 'ar', { sensitivity: 'base' })
}

function churchDisplayName(church) {
  return `كنيسة ${String(church?.patron_saint || '').trim()} - ${String(church?.area || '').trim()}`
}

function youthGroupNames(church) {
  const groups = Array.isArray(church?.parish_youth_groups) ? church.parish_youth_groups : []
  return groups
    .map((g) => {
      const name = String(g?.group_name || '').trim()
      return normalizeText(name && !api.isRawYouthGroupIdentifier(name) ? name : api.formatYouthGroupLabel(g?.group_id))
    })
    .filter(Boolean)
}

export default function ChurchesMap({ toast }) {
  const [churches, setChurches] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mapError, setMapError] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [governorateFilter, setGovernorateFilter] = useState('')
  const [parishFilter, setParishFilter] = useState('')
  const [search, setSearch] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersLayerRef = useRef(null)

  const sortedChurches = useMemo(
    () => [...churches].sort(compareByRegionGovernorateParishPatron),
    [churches],
  )

  const churchesForRegionOptions = useMemo(() => {
    const q = normalizeText(search).toLowerCase()
    return sortedChurches.filter((c) => {
      if (governorateFilter && normalizeText(c.governorate) !== governorateFilter) return false
      if (parishFilter && normalizeText(c.parish_name || c.parish_id) !== parishFilter) return false
      if (!q) return true
      const haystack = [churchDisplayName(c), c.parish_name, c.parish_id, c.region, c.governorate]
        .concat(youthGroupNames(c))
        .map((v) => normalizeText(v).toLowerCase()).join(' ')
      return haystack.includes(q)
    })
  }, [sortedChurches, governorateFilter, parishFilter, search])

  const churchesForGovernorateOptions = useMemo(() => {
    const q = normalizeText(search).toLowerCase()
    return sortedChurches.filter((c) => {
      if (regionFilter && normalizeText(c.region) !== regionFilter) return false
      if (parishFilter && normalizeText(c.parish_name || c.parish_id) !== parishFilter) return false
      if (!q) return true
      const haystack = [churchDisplayName(c), c.parish_name, c.parish_id, c.region, c.governorate]
        .concat(youthGroupNames(c))
        .map((v) => normalizeText(v).toLowerCase()).join(' ')
      return haystack.includes(q)
    })
  }, [sortedChurches, regionFilter, parishFilter, search])

  const churchesForParishOptions = useMemo(() => {
    const q = normalizeText(search).toLowerCase()
    return sortedChurches.filter((c) => {
      if (regionFilter && normalizeText(c.region) !== regionFilter) return false
      if (governorateFilter && normalizeText(c.governorate) !== governorateFilter) return false
      if (!q) return true
      const haystack = [churchDisplayName(c), c.parish_name, c.parish_id, c.region, c.governorate]
        .concat(youthGroupNames(c))
        .map((v) => normalizeText(v).toLowerCase()).join(' ')
      return haystack.includes(q)
    })
  }, [sortedChurches, regionFilter, governorateFilter, search])

  const regionOptions = useMemo(
    () => Array.from(new Set(churchesForRegionOptions.map((c) => normalizeText(c.region)).filter(Boolean))),
    [churchesForRegionOptions],
  )

  const governorateOptions = useMemo(
    () => Array.from(new Set(churchesForGovernorateOptions.map((c) => normalizeText(c.governorate)).filter(Boolean))),
    [churchesForGovernorateOptions],
  )

  const parishOptions = useMemo(
    () => Array.from(new Set(churchesForParishOptions.map((c) => normalizeText(c.parish_name || c.parish_id)).filter(Boolean))),
    [churchesForParishOptions],
  )

  useEffect(() => {
    if (regionFilter && !regionOptions.includes(regionFilter)) setRegionFilter('')
  }, [regionFilter, regionOptions])

  useEffect(() => {
    if (governorateFilter && !governorateOptions.includes(governorateFilter)) setGovernorateFilter('')
  }, [governorateFilter, governorateOptions])

  useEffect(() => {
    if (parishFilter && !parishOptions.includes(parishFilter)) setParishFilter('')
  }, [parishFilter, parishOptions])

  const filteredChurches = useMemo(() => {
    const q = normalizeText(search).toLowerCase()
    return sortedChurches.filter((c) => {
      if (regionFilter && normalizeText(c.region) !== regionFilter) return false
      if (governorateFilter && normalizeText(c.governorate) !== governorateFilter) return false
      if (parishFilter && normalizeText(c.parish_name || c.parish_id) !== parishFilter) return false
      if (!q) return true

      const haystack = [
        churchDisplayName(c),
        c.parish_name,
        c.parish_id,
        c.region,
        c.governorate,
        ...youthGroupNames(c),
      ].map((v) => normalizeText(v).toLowerCase()).join(' ')
      return haystack.includes(q)
    })
  }, [sortedChurches, regionFilter, governorateFilter, parishFilter, search])

  const mapRows = useMemo(
    () => filteredChurches.filter((c) => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))),
    [filteredChurches],
  )

  useEffect(() => {
    setLoading(true)
    setLoadError('')
    api.listChurches()
      .then((res) => setChurches(res?.churches || []))
      .catch(() => {
        setChurches([])
        setLoadError('تعذّر تحميل بيانات الكنائس حالياً. حاول مرة أخرى.')
        toast?.('تعذّر تحميل بيانات الكنائس', 'error')
      })
      .finally(() => setLoading(false))
  }, [reloadKey, toast])

  useEffect(() => {
    let cancelled = false
    setMapError('')

    ensureLeafletAssets()
      .then((L) => {
        if (cancelled || !mapRef.current) return

        if (!mapInstanceRef.current) {
          const map = L.map(mapRef.current).setView(DEFAULT_CENTER, 8)
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
          }).addTo(map)
          mapInstanceRef.current = map
          markersLayerRef.current = L.layerGroup().addTo(map)
        }

        const map = mapInstanceRef.current
        const layer = markersLayerRef.current
        layer.clearLayers()

        const bounds = []
        for (const church of mapRows) {
          const lat = Number(church.lat)
          const lng = Number(church.lng)
          const marker = L.marker([lat, lng]).addTo(layer)
          marker.bindPopup(
            `<div style="direction:rtl;min-width:180px">`
              + `<div style="font-weight:700;margin-bottom:4px">${churchDisplayName(church)}</div>`
              + `</div>`,
          )
          bounds.push([lat, lng])
        }

        if (bounds.length === 1) map.setView(bounds[0], 13)
        else if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30] })
        else map.setView(DEFAULT_CENTER, 8)
      })
      .catch(() => {
        if (!cancelled) {
          setMapError('تعذّر تحميل الخريطة حالياً. حاول إعادة المحاولة.')
          toast?.('تعذّر تحميل الخريطة', 'error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [mapRows, reloadKey, toast])

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Map size={18} color="var(--gold)" />
          <h3 style={{ margin: 0, color: 'var(--navy)' }}>خريطة الكنائس</h3>
        </div>
        {mapError ? (
          <ErrorState
            title="تعذر تحميل الخريطة"
            description={mapError}
            onRetry={() => setReloadKey((value) => value + 1)}
            minHeight={260}
          />
        ) : (
          <div
            ref={mapRef}
            style={{
              width: '100%',
              height: 430,
              borderRadius: 12,
              border: '1px solid var(--gray-200)',
              overflow: 'hidden',
              background: '#f1f5f9',
            }}
          />
        )}
      </section>

      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))', gap: 8 }}>
            <select
              className="form-control"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              <option value="">كل الأقاليم</option>
              {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

            <select
              className="form-control"
              value={governorateFilter}
              onChange={(e) => setGovernorateFilter(e.target.value)}
            >
              <option value="">كل المحافظات</option>
              {governorateOptions.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>

            <select
              className="form-control"
              value={parishFilter}
              onChange={(e) => setParishFilter(e.target.value)}
            >
              <option value="">كل الرعايا</option>
              {parishOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <input
              className="form-control"
              placeholder="بحث (كنيسة/رعية/محافظة)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setRegionFilter('')
                setGovernorateFilter('')
                setParishFilter('')
                setSearch('')
              }}
            >
              مسح الفلاتر
            </button>
          </div>
        </div>

        <h3 style={{ margin: '0 0 10px', color: 'var(--navy)' }}>الكنائس على الخريطة</h3>
        {loading ? (
          <LoadingState
            title="جارٍ تحميل الكنائس"
            description="يتم تجهيز بيانات الكنائس ومواقعها الآن."
            minHeight={220}
          />
        ) : loadError ? (
          <ErrorState
            title="تعذر تحميل الكنائس"
            description={loadError}
            onRetry={() => setReloadKey((value) => value + 1)}
            minHeight={220}
          />
        ) : mapRows.length === 0 ? (
          <EmptyState
            title="لا توجد مواقع كنائس صالحة للعرض"
            description="لم يتم العثور على كنائس مطابقة للفلاتر الحالية مع إحداثيات صالحة."
            icon={MapPin}
            minHeight={220}
          />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {mapRows.map((church) => {
              const groupNames = youthGroupNames(church)
              return (
              <div
                key={church.id}
                style={{
                  border: '1px solid var(--gray-200)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                    {church.parish_logo_url ? (
                      <img
                        src={church.parish_logo_url}
                        alt={church.parish_name || 'Parish Logo'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', border: '1px solid var(--gray-200)', borderRadius: 10 }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : null}
                  </div>
                  <div>
                    <div style={{ color: 'var(--navy)', fontWeight: 700 }}>{churchDisplayName(church)}</div>
                    <div style={{ color: 'var(--gray-500)', fontSize: '0.78rem' }}>
                      {church.parish_name || church.parish_id || '—'}
                    </div>
                    {groupNames.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {groupNames.map((name) => (
                          <span
                            key={name}
                            style={{
                              fontSize: '0.72rem',
                              color: 'var(--navy)',
                              background: '#eef3ff',
                              border: '1px solid #d8e2ff',
                              borderRadius: 999,
                              padding: '2px 8px',
                            }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ color: 'var(--gray-500)', fontSize: '0.78rem', marginTop: groupNames.length > 0 ? 4 : 0 }}>
                      {(church.region || '—')} · {(church.governorate || '—')}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {church.parish_instagram_url ? (
                    <a
                      href={church.parish_instagram_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="فتح صفحة Instagram للرعية"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        border: '1px solid var(--gray-200)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#E1306C',
                        textDecoration: 'none',
                        background: 'white',
                      }}
                    >
                      <Instagram size={14} />
                    </a>
                  ) : null}
                  {church.parish_facebook_url ? (
                    <a
                      href={church.parish_facebook_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="فتح صفحة Facebook للرعية"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        border: '1px solid var(--gray-200)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#1877F2',
                        textDecoration: 'none',
                        background: 'white',
                      }}
                    >
                      <span
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: '50%',
                          background: '#1877F2',
                          color: 'white',
                          fontSize: '0.66rem',
                          fontWeight: 800,
                          lineHeight: '15px',
                          textAlign: 'center',
                          fontFamily: 'Arial, sans-serif',
                        }}
                      >
                        f
                      </span>
                    </a>
                  ) : null}
                  {church.parish_lpj_url ? (
                    <a
                      href={church.parish_lpj_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="فتح صفحة معلومات الكنيسة (LPJ)"
                      style={{
                        minWidth: 34,
                        height: 30,
                        borderRadius: 8,
                        border: '1px solid var(--gray-200)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textDecoration: 'none',
                        background: 'white',
                        padding: '0 4px',
                      }}
                    >
                      <img
                        src="/api/logo/lpj"
                        alt="LPJ"
                        style={{ maxWidth: 22, maxHeight: 18, objectFit: 'contain' }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                          const fallback = e.currentTarget.nextElementSibling
                          if (fallback) fallback.style.display = 'inline'
                        }}
                      />
                      <span style={{ display: 'none', fontSize: '0.67rem', fontWeight: 700, color: 'var(--navy)' }}>LPJ</span>
                    </a>
                  ) : null}
                  <a
                    href={toGoogleMapsUrl(church.lat, church.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="فتح في Google Maps"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      border: '1px solid var(--gray-200)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--navy)',
                      textDecoration: 'none',
                      background: 'white',
                    }}
                  >
                    <MapPin size={14} />
                    </a>
                  
                </div>
              </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
