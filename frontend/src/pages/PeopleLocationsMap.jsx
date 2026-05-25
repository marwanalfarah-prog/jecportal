import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapIcon, MapPin, Users, LocateFixed, Building2 } from 'lucide-react'
import { api } from '../api.js'
import { EmptyState, ErrorState, LoadingState } from '../pageStates.jsx'

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

function normalizeText(value) {
  return String(value || '').trim()
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toGoogleMapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
}

function churchDisplayName(church) {
  const patron = normalizeText(church?.patron_saint)
  const area = normalizeText(church?.area)
  if (patron && area) return `كنيسة ${patron} - ${area}`
  if (patron) return `كنيسة ${patron}`
  return normalizeText(church?.parish_name || church?.parish_id || church?.id) || 'كنيسة'
}

function buildChurchPopupHtml(church) {
  return (
    '<div style="direction:rtl;min-width:220px;line-height:1.55">'
      + `<div style="font-weight:700;color:#7c2d12;margin-bottom:6px">${escapeHtml(churchDisplayName(church))}</div>`
      + `<div style="font-size:12px;color:#7c2d12"><strong>الرعية:</strong> ${escapeHtml(normalizeText(church?.parish_name || church?.parish_id) || '—')}</div>`
      + `<div style="font-size:12px;color:#7c2d12"><strong>المحافظة:</strong> ${escapeHtml(normalizeText(church?.governorate) || '—')}</div>`
      + '</div>'
  )
}

function createChurchMarkerIcon(L) {
  return L.divIcon({
    className: 'people-map-church-pin',
    html: `
      <div style="width:30px;height:42px;filter:drop-shadow(0 8px 14px rgba(127,29,29,0.26));display:flex;align-items:flex-start;justify-content:center;">
        <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M15 1C7.82 1 2 6.82 2 14c0 10.44 11.22 21.3 12.12 22.15a1.25 1.25 0 0 0 1.76 0C16.78 35.3 28 24.44 28 14 28 6.82 22.18 1 15 1Z" fill="#C2410C"/>
          <path d="M15 4.5c-5.16 0-9.5 4.1-9.5 9.22 0 3.53 2.1 7.24 6.24 11.02 1.18 1.08 2.38 2.07 3.26 2.78.88-.71 2.08-1.7 3.26-2.78 4.14-3.78 6.24-7.49 6.24-11.02 0-5.12-4.34-9.22-9.5-9.22Z" fill="#DC2626"/>
          <path d="M10.2 18.2h9.6v5.6H10.2z" fill="#FFF7ED"/>
          <path d="M9.2 18.4 15 13l5.8 5.4" fill="#FED7AA"/>
          <path d="M9.2 18.4 15 13l5.8 5.4" stroke="#FFF7ED" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12.4 23.8v-3.2h5.2v3.2" stroke="#C2410C" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <path d="M15 9.1v3.4" stroke="#FFF7ED" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M13 10.8h4" stroke="#FFF7ED" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>`,
    iconSize: [30, 42],
    iconAnchor: [15, 40],
    popupAnchor: [0, -34],
  })
}

function joinLabels(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean)))
}

function metersToLatitudeDelta(meters) {
  return meters / 111320
}

function metersToLongitudeDelta(meters, latitude) {
  const latitudeRadians = (Number(latitude) * Math.PI) / 180
  const scale = Math.cos(latitudeRadians)
  if (!Number.isFinite(scale) || Math.abs(scale) < 0.000001) return metersToLatitudeDelta(meters)
  return meters / (111320 * scale)
}

function coordinateGroupKey(lat, lng) {
  return `${Number(lat).toFixed(6)}:${Number(lng).toFixed(6)}`
}

function buildSpreadMarkerPositions(rows) {
  const grouped = new Map()

  for (const row of rows) {
    const lat = Number(row?.lat)
    const lng = Number(row?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const key = coordinateGroupKey(lat, lng)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }

  const positions = new Map()
  for (const group of grouped.values()) {
    if (group.length === 1) {
      const only = group[0]
      positions.set(only.location_key, { lat: Number(only.lat), lng: Number(only.lng), sharedCount: 1 })
      continue
    }

    const count = group.length
    const baseLat = Number(group[0].lat)
    const baseLng = Number(group[0].lng)
    const radiusMeters = Math.min(10 + count * 2.5, 28)

    group.forEach((row, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count)
      const latOffset = metersToLatitudeDelta(Math.sin(angle) * radiusMeters)
      const lngOffset = metersToLongitudeDelta(Math.cos(angle) * radiusMeters, baseLat)
      positions.set(row.location_key, {
        lat: baseLat + latOffset,
        lng: baseLng + lngOffset,
        sharedCount: count,
      })
    })
  }

  return positions
}

function buildVisibleMarkerPositions(peopleRows, churchRows) {
  const grouped = new Map()

  for (const row of peopleRows) {
    const lat = Number(row?.lat)
    const lng = Number(row?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const key = coordinateGroupKey(lat, lng)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push({ key: `person:${row.location_key}`, lat, lng })
  }

  for (const church of churchRows) {
    const lat = Number(church?.lat)
    const lng = Number(church?.lng)
    const churchId = normalizeText(church?.id || church?.parish_id || churchDisplayName(church))
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !churchId) continue

    const key = coordinateGroupKey(lat, lng)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push({ key: `church:${churchId}`, lat, lng })
  }

  const positions = new Map()
  for (const group of grouped.values()) {
    if (group.length === 1) {
      const only = group[0]
      positions.set(only.key, { lat: only.lat, lng: only.lng })
      continue
    }

    const count = group.length
    const baseLat = Number(group[0].lat)
    const radiusMeters = Math.min(10 + count * 2.5, 28)

    group.forEach((entry, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / count)
      const latOffset = metersToLatitudeDelta(Math.sin(angle) * radiusMeters)
      const lngOffset = metersToLongitudeDelta(Math.cos(angle) * radiusMeters, baseLat)
      positions.set(entry.key, {
        lat: baseLat + latOffset,
        lng: Number(entry.lng) + lngOffset,
      })
    })
  }

  return positions
}

function buildSharedLocationGroups(rows) {
  const grouped = new Map()

  for (const row of rows) {
    const lat = Number(row?.lat)
    const lng = Number(row?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const key = coordinateGroupKey(lat, lng)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }

  for (const [key, entries] of grouped.entries()) {
    grouped.set(
      key,
      [...entries].sort((a, b) => normalizeText(a?.full_name).localeCompare(normalizeText(b?.full_name), 'ar', { sensitivity: 'base' })),
    )
  }

  return grouped
}

function locationSearchText(location) {
  return [
    location?.full_name,
    ...(location?.youth_groups || []),
    ...(location?.age_groups || []),
    location?.country,
    location?.governorate,
    location?.city,
    location?.address,
    location?.full_address,
  ].map((value) => normalizeText(value).toLowerCase()).join(' ')
}

function buildPopupEntryHtml(location) {
  const youthGroups = joinLabels(location?.youth_groups)
  const ageGroups = joinLabels(location?.age_groups)

  return (
    '<div style="direction:rtl;min-width:220px;line-height:1.55">'
      + `<div style="font-weight:700;color:#0f2744;margin-bottom:6px">${escapeHtml(location?.full_name || '—')}</div>`
      + `<div style="font-size:12px;color:#475569"><strong>فرقة الشبيبة:</strong> ${escapeHtml(youthGroups.join('، ') || '—')}</div>`
      + `<div style="font-size:12px;color:#475569"><strong>الفئة العمرية:</strong> ${escapeHtml(ageGroups.join('، ') || '—')}</div>`
      + `<div style="font-size:12px;color:#475569"><strong>العنوان:</strong> ${escapeHtml(location?.full_address || '—')}</div>`
      + `<div style="font-size:12px;color:${location?.is_primary ? '#0f766e' : '#b45309'}"><strong>الحالة:</strong> ${location?.is_primary ? 'عنوان أساسي' : 'عنوان إضافي'}</div>`
      + '</div>'
  )
}

function buildSharedPopupShellHtml(count) {
  return (
    '<div style="direction:rtl;min-width:240px;line-height:1.55">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">'
      + '<button type="button" data-popup-nav="next" style="border:1px solid #dbe4f0;background:#fff;border-radius:8px;padding:3px 8px;cursor:pointer;color:#0f2744;font-weight:700">→</button>'
      + '<div data-popup-counter style="font-size:12px;color:#64748b;font-weight:700"></div>'
      + '<button type="button" data-popup-nav="prev" style="border:1px solid #dbe4f0;background:#fff;border-radius:8px;padding:3px 8px;cursor:pointer;color:#0f2744;font-weight:700">←</button>'
      + '</div>'
      + '<div data-popup-entry></div>'
      + `<div style="margin-top:8px;font-size:12px;color:#1d4ed8"><strong>موقع مشترك:</strong> يوجد ${count} أشخاص في هذا الموقع</div>`
      + '</div>'
  )
}

function renderSharedPopupEntry(container, entries, index) {
  const safeIndex = ((index % entries.length) + entries.length) % entries.length
  const entryHost = container.querySelector('[data-popup-entry]')
  const counterHost = container.querySelector('[data-popup-counter]')
  if (!entryHost || !counterHost) return safeIndex

  entryHost.innerHTML = buildPopupEntryHtml(entries[safeIndex])
  counterHost.textContent = `${safeIndex + 1} / ${entries.length}`
  return safeIndex
}

export default function PeopleLocationsMap({ toast }) {
  const [locations, setLocations] = useState([])
  const [churches, setChurches] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [mapError, setMapError] = useState('')
  const [search, setSearch] = useState('')
  const [governorateFilter, setGovernorateFilter] = useState('')
  const [youthGroupFilter, setYouthGroupFilter] = useState('')
  const [primaryFilter, setPrimaryFilter] = useState('all')
  const [showChurches, setShowChurches] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersLayerRef = useRef(null)
  const markerLookupRef = useRef(new Map())

  useEffect(() => {
    setLoading(true)
    setLoadError('')
    api.listPeopleLocations()
      .then((res) => setLocations(Array.isArray(res?.locations) ? res.locations : []))
      .catch(() => {
        setLocations([])
        setLoadError('تعذّر تحميل مواقع الأشخاص حالياً. حاول مرة أخرى.')
        toast?.('تعذّر تحميل مواقع الأشخاص', 'error')
      })
      .finally(() => setLoading(false))
  }, [reloadKey, toast])

  useEffect(() => {
    api.listChurches()
      .then((res) => setChurches(Array.isArray(res?.churches) ? res.churches : []))
      .catch(() => toast?.('تعذّر تحميل بيانات الكنائس', 'error'))
  }, [reloadKey, toast])

  const governorateOptions = useMemo(
    () => Array.from(new Set(locations.map((row) => normalizeText(row.governorate)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar', { sensitivity: 'base' })),
    [locations],
  )

  const youthGroupOptions = useMemo(() => {
    const values = new Set()
    for (const row of locations) {
      for (const group of joinLabels(row?.youth_groups)) values.add(group)
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'ar', { sensitivity: 'base' }))
  }, [locations])

  const filteredLocations = useMemo(() => {
    const query = normalizeText(search).toLowerCase()
    return locations.filter((row) => {
      if (governorateFilter && normalizeText(row.governorate) !== governorateFilter) return false
      if (youthGroupFilter && !joinLabels(row?.youth_groups).includes(youthGroupFilter)) return false
      if (primaryFilter === 'primary' && !row?.is_primary) return false
      if (primaryFilter === 'secondary' && row?.is_primary) return false
      if (!query) return true
      return locationSearchText(row).includes(query)
    })
  }, [locations, governorateFilter, youthGroupFilter, primaryFilter, search])

  const stats = useMemo(() => {
    const people = new Set(filteredLocations.map((row) => `${row.person_type}:${row.person_id}`)).size
    const primary = filteredLocations.filter((row) => row.is_primary).length
    const secondary = filteredLocations.length - primary
    return { people, primary, secondary }
  }, [filteredLocations])

  const sharedPersonPositions = useMemo(() => buildSpreadMarkerPositions(filteredLocations), [filteredLocations])
  const sharedLocationGroups = useMemo(() => buildSharedLocationGroups(filteredLocations), [filteredLocations])

  const mapChurches = useMemo(() => {
    return churches.filter((church) => {
      if (!showChurches) return false
      if (governorateFilter && normalizeText(church.governorate) !== governorateFilter) return false
      return Number.isFinite(Number(church.lat)) && Number.isFinite(Number(church.lng))
    })
  }, [churches, showChurches, governorateFilter])

  const visibleMarkerPositions = useMemo(
    () => buildVisibleMarkerPositions(filteredLocations, mapChurches),
    [filteredLocations, mapChurches],
  )

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
        markerLookupRef.current = new Map()
        const churchMarkerIcon = createChurchMarkerIcon(L)

        const bounds = []
        for (const location of filteredLocations) {
          const originalLat = Number(location.lat)
          const originalLng = Number(location.lng)
          const position = visibleMarkerPositions.get(`person:${location.location_key}`)
          const groupKey = coordinateGroupKey(originalLat, originalLng)
          const sharedEntries = sharedLocationGroups.get(groupKey) || [location]
          const initialIndex = Math.max(0, sharedEntries.findIndex((entry) => entry.location_key === location.location_key))
          const lat = Number(position?.lat)
          const lng = Number(position?.lng)
          if (!Number.isFinite(originalLat) || !Number.isFinite(originalLng) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue

          const marker = L.marker([lat, lng]).addTo(layer)
          if (sharedEntries.length > 1) {
            marker.bindPopup(buildSharedPopupShellHtml(sharedEntries.length))
            marker.on('popupopen', (event) => {
              const popupRoot = event.popup.getElement()
              if (!popupRoot) return
              const container = popupRoot.querySelector('.leaflet-popup-content') || popupRoot
              let currentIndex = renderSharedPopupEntry(container, sharedEntries, initialIndex)
              const prevButton = container.querySelector('[data-popup-nav="prev"]')
              const nextButton = container.querySelector('[data-popup-nav="next"]')
              if (prevButton) {
                prevButton.onclick = () => {
                  currentIndex = renderSharedPopupEntry(container, sharedEntries, currentIndex - 1)
                }
              }
              if (nextButton) {
                nextButton.onclick = () => {
                  currentIndex = renderSharedPopupEntry(container, sharedEntries, currentIndex + 1)
                }
              }
            })
          } else {
            marker.bindPopup(buildPopupEntryHtml(location))
          }
          marker.on('click', () => setSelectedKey(location.location_key))
          markerLookupRef.current.set(location.location_key, marker)
          bounds.push([lat, lng])
        }

        for (const church of mapChurches) {
          const churchId = normalizeText(church?.id || church?.parish_id || churchDisplayName(church))
          const position = visibleMarkerPositions.get(`church:${churchId}`)
          const lat = Number(position?.lat)
          const lng = Number(position?.lng)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
          const marker = L.marker([lat, lng], { icon: churchMarkerIcon }).addTo(layer)
          marker.bindPopup(buildChurchPopupHtml(church))
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
  }, [filteredLocations, mapChurches, reloadKey, sharedLocationGroups, sharedPersonPositions, toast, visibleMarkerPositions])

  const focusLocation = (location) => {
    const map = mapInstanceRef.current
    const marker = markerLookupRef.current.get(location.location_key)
    const lat = Number(location.lat)
    const lng = Number(location.lng)
    setSelectedKey(location.location_key)
    if (map && Number.isFinite(lat) && Number.isFinite(lng)) {
      map.setView([lat, lng], Math.max(map.getZoom(), 14))
    }
    if (marker) marker.openPopup()
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <MapIcon size={18} color="var(--gold)" />
          <h3 style={{ margin: 0, color: 'var(--navy)' }}>خريطة مواقع الأشخاص</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: '10px 12px', background: 'var(--gray-50)' }}>
            <div style={{ color: 'var(--gray-500)', fontSize: '0.75rem' }}>المواقع المعروضة</div>
            <div style={{ color: 'var(--navy)', fontWeight: 800, fontSize: '1.15rem' }}>{filteredLocations.length}</div>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: '10px 12px', background: 'var(--gray-50)' }}>
            <div style={{ color: 'var(--gray-500)', fontSize: '0.75rem' }}>الأشخاص</div>
            <div style={{ color: 'var(--navy)', fontWeight: 800, fontSize: '1.15rem' }}>{stats.people}</div>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: '10px 12px', background: 'var(--gray-50)' }}>
            <div style={{ color: 'var(--gray-500)', fontSize: '0.75rem' }}>العناوين الأساسية</div>
            <div style={{ color: '#0f766e', fontWeight: 800, fontSize: '1.15rem' }}>{stats.primary}</div>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: '10px 12px', background: 'var(--gray-50)' }}>
            <div style={{ color: 'var(--gray-500)', fontSize: '0.75rem' }}>العناوين الإضافية</div>
            <div style={{ color: '#b45309', fontWeight: 800, fontSize: '1.15rem' }}>{stats.secondary}</div>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 12, padding: '10px 12px', background: 'var(--gray-50)' }}>
            <div style={{ color: 'var(--gray-500)', fontSize: '0.75rem' }}>الكنائس على الخريطة</div>
            <div style={{ color: '#b91c1c', fontWeight: 800, fontSize: '1.15rem' }}>{showChurches ? mapChurches.length : 0}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
          <input
            className="form-control"
            placeholder="بحث بالاسم أو الشبيبة أو العنوان"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select className="form-control" value={governorateFilter} onChange={(e) => setGovernorateFilter(e.target.value)}>
            <option value="">كل المحافظات</option>
            {governorateOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>

          <select className="form-control" value={youthGroupFilter} onChange={(e) => setYouthGroupFilter(e.target.value)}>
            <option value="">كل فرق الشبيبة</option>
            {youthGroupOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>

          <select className="form-control" value={primaryFilter} onChange={(e) => setPrimaryFilter(e.target.value)}>
            <option value="all">كل العناوين</option>
            <option value="primary">العناوين الأساسية فقط</option>
            <option value="secondary">العناوين الإضافية فقط</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--navy)', fontWeight: 600, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showChurches}
              onChange={(e) => setShowChurches(e.target.checked)}
            />
            إظهار الكنائس على الخريطة
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', color: 'var(--gray-600)', fontSize: '0.82rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: '#2563eb', boxShadow: '0 0 0 2px #dbeafe inset' }} />
              مواقع الأشخاص
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: '#fff1f2', border: '1px solid #fecdd3' }}>
                <Building2 size={11} color="#c2410c" />
              </span>
              الكنائس
            </span>
          </div>
        </div>

        <div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSearch('')
              setGovernorateFilter('')
              setYouthGroupFilter('')
              setPrimaryFilter('all')
              setShowChurches(false)
            }}
          >
            مسح الفلاتر
          </button>
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
              marginTop: 14,
            }}
          />
        )}
      </section>

      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Users size={18} color="var(--gold)" />
          <h3 style={{ margin: 0, color: 'var(--navy)' }}>تفاصيل المواقع</h3>
        </div>

        {loading ? (
            <LoadingState
              title="جارٍ تحميل المواقع"
              description="يتم تجهيز مواقع الأشخاص والعناوين الآن."
              minHeight={220}
            />
          ) : loadError ? (
            <ErrorState
              title="تعذر تحميل المواقع"
              description={loadError}
              onRetry={() => setReloadKey((value) => value + 1)}
              minHeight={220}
            />
        ) : filteredLocations.length === 0 ? (
            <EmptyState
              title="لا توجد مواقع مطابقة للعرض"
              description="لم يتم العثور على مواقع توافق الفلاتر الحالية."
              icon={LocateFixed}
              minHeight={220}
            />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {filteredLocations.map((location) => {
              const youthGroups = joinLabels(location.youth_groups)
              const ageGroups = joinLabels(location.age_groups)
              const active = selectedKey === location.location_key

              return (
                <div
                  key={location.location_key}
                  role="button"
                  tabIndex={0}
                  onClick={() => focusLocation(location)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      focusLocation(location)
                    }
                  }}
                  style={{
                    border: active ? '1px solid rgba(201,150,60,0.7)' : '1px solid var(--gray-200)',
                    boxShadow: active ? '0 12px 30px rgba(201,150,60,0.12)' : 'none',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'grid',
                    gap: 10,
                    cursor: 'pointer',
                    background: active ? '#fffdf7' : 'white',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ color: 'var(--navy)', fontWeight: 800 }}>{location.full_name || '—'}</div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem', marginTop: 2 }}>
                        {location.is_primary ? 'عنوان أساسي' : 'عنوان إضافي'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 999,
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: location.is_primary ? '#0f766e' : '#b45309',
                          background: location.is_primary ? '#ecfdf5' : '#fff7ed',
                          border: `1px solid ${location.is_primary ? '#a7f3d0' : '#fed7aa'}`,
                        }}
                      >
                        {location.is_primary ? 'أساسي' : 'إضافي'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.74rem', marginBottom: 4 }}>فرقة الشبيبة</div>
                      <div style={{ color: 'var(--navy)', fontWeight: 600 }}>{youthGroups.join('، ') || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.74rem', marginBottom: 4 }}>الفئة العمرية</div>
                      <div style={{ color: 'var(--navy)', fontWeight: 600 }}>{ageGroups.join('، ') || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.74rem', marginBottom: 4 }}>العنوان الكامل</div>
                      <div style={{ color: 'var(--navy)', fontWeight: 600 }}>{location.full_address || '—'}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.72rem' }}>الدولة</div>
                      <div>{location.country || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.72rem' }}>المحافظة</div>
                      <div>{location.governorate || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.72rem' }}>المدينة</div>
                      <div>{location.city || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.72rem' }}>خطوط الطول والعرض</div>
                      <div>{`${location.lat}, ${location.lng}`}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); focusLocation(location) }}>
                      <LocateFixed size={14} />
                      تحديد على الخريطة
                    </button>
                    <a
                      href={toGoogleMapsUrl(location.lat, location.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      onClick={(event) => event.stopPropagation()}
                      style={{ textDecoration: 'none' }}
                    >
                      <MapPin size={14} />
                      فتح في Google Maps
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