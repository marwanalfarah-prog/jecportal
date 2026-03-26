function normalizeUrlText(value) {
  return String(value ?? '').trim()
}

function toFiniteCoordinate(value, min, max) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num < min || num > max) return null
  return num
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extractCoordinatePair(text) {
  const source = String(text || '')
  const patterns = [
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /!4d(-?\d{1,3}(?:\.\d+)?)!3d(-?\d{1,3}(?:\.\d+)?)/,
    /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /(-?\d{1,3}(?:\.\d+)?),\+(-?\d{1,3}(?:\.\d+)?)/,
    /(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
  ]

  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (!match) continue
    const isReversed = pattern.source.startsWith('!4d')
    const lat = toFiniteCoordinate(isReversed ? match[2] : match[1], -90, 90)
    const lng = toFiniteCoordinate(isReversed ? match[1] : match[2], -180, 180)
    if (lat != null && lng != null) {
      return { lat, lng }
    }
  }

  return { lat: null, lng: null }
}

export function normalizeGoogleMapsUrl(value) {
  return normalizeUrlText(value)
}

export function sanitizeStoredCoordinate(value, axis) {
  return axis === 'lat'
    ? toFiniteCoordinate(value, -90, 90)
    : toFiniteCoordinate(value, -180, 180)
}

function hasPlaceholderCoordinatePair(lat, lng) {
  return lat === 0 && lng === 0
}

export function parseGoogleMapsUrl(value) {
  const rawUrl = normalizeUrlText(value)
  if (!rawUrl) {
    return {
      lat: null,
      lng: null,
      isGoogleMapsUrl: false,
      hasCoordinates: false,
    }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return {
      lat: null,
      lng: null,
      isGoogleMapsUrl: false,
      hasCoordinates: false,
    }
  }

  const hostname = parsedUrl.hostname.toLowerCase()
  const isGoogleMapsUrl = hostname.includes('google.') || hostname === 'goo.gl' || hostname.endsWith('.goo.gl')

  const candidates = [
    parsedUrl.href,
    safeDecode(parsedUrl.href),
    parsedUrl.pathname,
    safeDecode(parsedUrl.pathname),
  ]

  for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr']) {
    const paramValue = parsedUrl.searchParams.get(key)
    if (paramValue) {
      candidates.push(paramValue)
      candidates.push(safeDecode(paramValue))
    }
  }

  let lat = null
  let lng = null
  for (const candidate of candidates) {
    const result = extractCoordinatePair(candidate)
    if (result.lat != null && result.lng != null) {
      lat = result.lat
      lng = result.lng
      break
    }
  }

  return {
    lat,
    lng,
    isGoogleMapsUrl,
    hasCoordinates: lat != null && lng != null,
  }
}

export function applyGoogleMapsUrlToAddress(addressRow, value) {
  const parsed = parseGoogleMapsUrl(value)
  return {
    ...addressRow,
    lat: parsed.lat,
    lng: parsed.lng,
  }
}

export function buildGoogleMapsOpenUrl(location) {
  const lat = sanitizeStoredCoordinate(location?.lat, 'lat')
  const lng = sanitizeStoredCoordinate(location?.lng, 'lng')
  if (lat == null || lng == null) return ''
  if (hasPlaceholderCoordinatePair(lat, lng)) return ''

  return `https://www.google.com/maps?q=${lat},${lng}`
}