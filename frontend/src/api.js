const BASE = '/api'

class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

async function readResponsePayload(res) {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('application/json')) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  try {
    const text = await res.text()
    return text || null
  } catch {
    return null
  }
}

function extractErrorMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    const message = payload.error || payload.message || payload.detail
    if (message) return String(message)
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim()
  }

  return `API error ${status}`
}

async function throwResponseError(res) {
  const payload = await readResponsePayload(res)
  throw new ApiError(extractErrorMessage(payload, res.status), {
    status: res.status,
    data: payload,
  })
}

export function getApiErrorMessage(error, fallback = 'حدث خطأ غير متوقع') {
  if (!error) return fallback
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error instanceof Error && error.message && error.message.trim()) return error.message.trim()
  return fallback
}

function formatYouthGroupLabel(raw) {
  const text = (raw ?? '').toString().trim()
  if (!text) return ''
  if (/^YG\d{3,}$/i.test(text) || text === 'GS') return text
  if (text.startsWith('شبيبة')) return text
  return `شبيبة ${text}`
}

function buildArchiveMembershipBody(youthGroupId) {
  if (Array.isArray(youthGroupId)) {
    const youthGroupIds = youthGroupId
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    return { youth_group_ids: youthGroupIds }
  }
  return { youth_group_id: youthGroupId }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) await throwResponseError(res)
  return readResponsePayload(res)
}

export const api = {
  formatYouthGroupLabel,

  // ── Auth ──────────────────────────────────────────────────────────────────
  logout:       ()             => req('/auth/logout', { method: 'POST' }),
  me:           ()             => req('/auth/me'),
  listUsers:    ()             => req('/auth/users'),
  listUsersBasic: ()           => req('/auth/users/basic'),
  exportUsers:  ()             => req('/auth/users/export'),
  createUser:   (body)         => req('/auth/users', { method: 'POST', body }),
  updateUser:   (username, body) => req(`/auth/users/${encodeURIComponent(username)}`, { method: 'PUT', body }),
  deleteUser:   (username)     => req(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  generateAll:  ()             => req('/auth/generate-all', { method: 'POST' }),
  councilMembers: ()           => req('/auth/council-members'),

  // ── Promotions ────────────────────────────────────────────────────────────
  listPromotions:   ()         => req('/promotions'),
  scanPromotions:   ()         => req('/promotions/scan', { method: 'POST' }),
  approvePromotion: (id, extraData)  => req(`/promotions/${id}`, { method: 'PATCH', body: { action: 'approve', ...(extraData ? { extra_data: extraData } : {}) } }),
  rejectPromotion:  (id)       => req(`/promotions/${id}`, { method: 'PATCH', body: { action: 'reject' } }),
  deletePromotion:  (id)       => req(`/promotions/${id}`, { method: 'DELETE' }),
  stats:           ()           => req('/stats'),
  filters:         ()           => req('/filters'),
  listNationalityIsoCodes: ()   => req('/nationality-iso-codes'),
  chartGov:        ()           => req('/chart/governorate'),
  chartGender:     ()           => req('/chart/gender'),
  chartYG:         ()           => req('/chart/youth_group'),
  chartAge:        ()           => req('/chart/age_group'),

  personsEnriched: ()           => req('/persons/enriched'),
  membersIndex:    ()           => req('/persons/members-index'),
  getPerson:       (id)         => req(`/person/${id}`),
  updatePerson:    (id, body)   => req(`/person/${id}`, { method: 'PUT', body }),
  addPerson:       (body)       => req('/person', { method: 'POST', body }),
  resolveGoogleMapsLocation: (url) => req('/location/resolve-google-maps', { method: 'POST', body: { url } }),
  deletePerson:    (id)         => req(`/person/${id}`, { method: 'DELETE' }),
  archivePerson:   (id, youthGroupId)         => req(`/person/${id}/archive`, { method: 'PATCH', body: buildArchiveMembershipBody(youthGroupId) }),
  unarchivePerson: (id, youthGroupId)         => req(`/person/${id}/unarchive`, { method: 'PATCH', body: buildArchiveMembershipBody(youthGroupId) }),

  getOrgTree:      (group, periodId) =>
    periodId
      ? req(`/org-tree/${encodeURIComponent(group)}?period_id=${encodeURIComponent(periodId)}`)
      : req(`/org-tree/${encodeURIComponent(group)}`),

  getOrgTreeHistory: ({ personId, unregisteredId, groupIds } = {}) => {
    const qs = new URLSearchParams()
    if (personId !== undefined && personId !== null && String(personId).trim()) qs.set('person_id', String(personId).trim())
    if (unregisteredId !== undefined && unregisteredId !== null && String(unregisteredId).trim()) qs.set('unregistered_id', String(unregisteredId).trim())
    if (Array.isArray(groupIds) && groupIds.length) qs.set('group_ids', groupIds.map(v => String(v || '').trim()).filter(Boolean).join(','))
    return req(`/org-tree/history?${qs.toString()}`)
  },

  putOrgTree: (group, body) =>
    req(`/org-tree/${encodeURIComponent(group)}`, { method: 'PUT', body }),

  updatePeriod: (group, periodId, body) =>
    req(`/org-tree/${encodeURIComponent(group)}/period/${encodeURIComponent(periodId)}`, { method: 'PATCH', body }),

  deletePeriod: (group, periodId) =>
    req(`/org-tree/${encodeURIComponent(group)}/period/${encodeURIComponent(periodId)}`, { method: 'DELETE' }),

  // Unregistered persons — full profile CRUD
  getUnregistered:       ()           => req('/unregistered'),
  // ── Questionnaires (admin) ──────────────────────────────────────────────────
  adminListQuestionnaires: ()        => req('/questionnaires'),
  createQuestionnaire:    (body)     => req('/questionnaires', { method: 'POST', body }),
  updateQuestionnaire:    (id, body) => req(`/questionnaires/${id}`, { method: 'PUT', body }),
  deleteQuestionnaire:    (id)       => req(`/questionnaires/${id}`, { method: 'DELETE' }),
  getQuestionnaireResponses: (id)    => req(`/questionnaires/${id}/responses`),

  // ── Questionnaires (member) ─────────────────────────────────────────────────
  listMyQuestionnaires:  ()           => req('/questionnaires'),
  submitQuestionnaireResponse: (id, answers) =>
    req(`/questionnaires/${id}/respond`, { method: 'POST', body: { answers } }),

  // ── Notifications ───────────────────────────────────────────────────────────
  getNotifications:          ()       => req('/notifications'),
  markNotificationRead:      (id)     => req(`/notifications/${id}/read`, { method: 'PATCH' }),
  markNotificationUnread:    (id)     => req(`/notifications/${id}/unread`, { method: 'PATCH' }),
  deleteNotification:        (id)     => req(`/notifications/${id}`, { method: 'DELETE' }),
  markAllNotificationsRead:  ()       => req('/notifications/read-all', { method: 'PATCH' }),

  getUnregisteredPerson: (id)         => req(`/unregistered/${id}`),
  addUnregistered:       (body)       => req('/unregistered', { method: 'POST', body }),
  updateUnregistered:    (id, body)   => req(`/unregistered/${id}`, { method: 'PUT', body }),
  deleteUnregistered:    (id)         => req(`/unregistered/${id}`, { method: 'DELETE' }),
  archiveUnregistered:   (id, youthGroupId)         => req(`/unregistered/${id}/archive`, { method: 'PATCH', body: buildArchiveMembershipBody(youthGroupId) }),
  unarchiveUnregistered: (id, youthGroupId)         => req(`/unregistered/${id}/unarchive`, { method: 'PATCH', body: buildArchiveMembershipBody(youthGroupId) }),
  syncUnregistered:      (body)       => req('/unregistered/sync', { method: 'POST', body }),
  promoteUnregistered:   (id)         => req(`/unregistered/${id}/promote`, { method: 'POST' }),

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig:          ()           => req('/config'),
  putConfig:          (body)       => req('/config', { method: 'PUT', body }),
  getMottosMeta:      ()           => req('/config/mottos/meta'),
  listMottos:         ()           => req('/config/mottos'),
  listActiveMottos:   ({ youthGroupIds = [], includeJecJordan = true } = {}) => {
    const qs = new URLSearchParams()
    if (Array.isArray(youthGroupIds) && youthGroupIds.length) qs.set('youth_group_ids', youthGroupIds.join(','))
    qs.set('include_jec_jordan', includeJecJordan ? 'true' : 'false')
    return req(`/config/mottos/active?${qs.toString()}`)
  },
  createMotto:        (body)       => req('/config/mottos', { method: 'POST', body }),
  updateMotto:        (id, body)   => req(`/config/mottos/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteMotto:        (id)         => req(`/config/mottos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadMottoLogo: async (id, file) => {
    const form = new FormData()
    form.append('logo', file)
    const res = await fetch(`${BASE}/config/mottos/${encodeURIComponent(id)}/logo`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  mottoLogoUrl: (id, bust) => `${BASE}/config/mottos/${encodeURIComponent(id)}/logo${bust ? `?t=${bust}` : ''}`,


  // ── School / University Logos ────────────────────────────────────────────────
  listSchoolLogos:         ()           => req('/config/school-logos'),
  createSchoolLogoEntry:   (body)       => req('/config/school-logos', { method: 'POST', body }),
  deleteSchoolLogoEntry:   (id)         => req(`/config/school-logos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadSchoolLogo: async (id, file) => {
    const form = new FormData()
    form.append('logo', file)
    const res = await fetch(`${BASE}/config/school-logos/${encodeURIComponent(id)}/logo`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  schoolLogoUrl: (id, bust) => `${BASE}/config/school-logos/${encodeURIComponent(id)}/logo${bust ? `?t=${bust}` : ''}`,

  // ── Churches ─────────────────────────────────────────────────────────────────
  listChurches:       ()           => req('/churches'),
  createChurch:       (body)       => req('/churches', { method: 'POST', body }),
  updateChurch:       (id, body)   => req(`/churches/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteChurch:       (id)         => req(`/churches/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Backward compatibility aliases
  listParishes:       ()           => req('/parishes'),
  createParish:       (body)       => req('/parishes', { method: 'POST', body }),
  updateParish:       (id, body)   => req(`/parishes/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteParish:       (id)         => req(`/parishes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadParishLogo: async (id, file) => {
    const form = new FormData()
    form.append('logo', file)
    const res = await fetch(`${BASE}/parishes/${encodeURIComponent(id)}/logo`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  parishLogoUrl: (id, bust) => `${BASE}/parishes/${encodeURIComponent(id)}/logo${bust ? `?t=${bust}` : ''}`,

  // Unregistered photo
  uploadUnregisteredPhoto: async (id, file) => {
    const form = new FormData()
    form.append('photo', file)
    const res = await fetch(`${BASE}/unregistered/${id}/photo`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  unregisteredPhotoUrl: (id, bust) => `${BASE}/unregistered/${id}/photo${bust ? `?t=${bust}` : ''}`,

  // Photo — uses raw fetch (multipart)
  uploadPhoto: async (id, file) => {
    const form = new FormData()
    form.append('photo', file)
    const res = await fetch(`${BASE}/person/${id}/photo`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  photoUrl: (id, bust) => `${BASE}/person/${id}/photo${bust ? `?t=${bust}` : ''}`,

  // Youth group profile + logo
  listYouthGroupProfiles: () => req('/youth-groups'),
  getYouthGroupDetails: (groupRef) => req(`/youth-groups/${encodeURIComponent(groupRef)}/details`),
  updateYouthGroupPromotionLimits: (groupRef, body) => req(`/youth-groups/${encodeURIComponent(groupRef)}/promotion-limits`, { method: 'PUT', body }),
  updateYouthGroupParish: (groupRef, body) => req(`/youth-groups/${encodeURIComponent(groupRef)}/parish`, { method: 'PUT', body }),
  updateYouthGroupSocialMedia: (groupRef, body) => req(`/youth-groups/${encodeURIComponent(groupRef)}/social-media`, { method: 'PUT', body }),
  uploadYouthGroupLogo: async (groupRef, file) => {
    const form = new FormData()
    form.append('logo', file)
    const res = await fetch(`${BASE}/youth-groups/${encodeURIComponent(groupRef)}/logo`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  youthGroupLogoUrl: (groupRef, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/logo${bust ? `?t=${bust}` : ''}`,
  updateYouthGroupSpecialLogoSettings: (groupRef, body) => req(`/youth-groups/${encodeURIComponent(groupRef)}/special-logo-settings`, { method: 'PUT', body }),
  uploadYouthGroupSpecialLogo: async (groupRef, file, payload) => {
    const form = new FormData()
    form.append('logo', file)
    form.append('occasion', payload?.occasion || '')
    form.append('start_date', payload?.start_date || '')
    form.append('end_date', payload?.end_date || '')
    form.append('is_active', payload?.is_active ? 'true' : 'false')
    const res = await fetch(`${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  youthGroupSpecialLogoUrl: (groupRef, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo${bust ? `?t=${bust}` : ''}`,
  youthGroupSpecialLogoByIdUrl: (groupRef, logoId, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo/${encodeURIComponent(logoId)}${bust ? `?t=${bust}` : ''}`,
  youthGroupActiveSpecialLogoUrl: (groupRef, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo-active${bust ? `?t=${bust}` : ''}`,

  // ── Bible Reader ───────────────────────────────────────────────────────────
  listBibleReaderBooks: () => req('/bible-reader/books'),
  getBibleReaderBook: (bookId) => req(`/bible-reader/books/${encodeURIComponent(bookId)}`),
  getBibleSongLyrics: () => req('/bible-reader/books-song-lyrics'),
}
