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

const GENERIC_YOUTH_GROUP_LABEL = 'الشبيبة'
const GENERAL_SECRETARIAT_LABEL = 'الأمانة العامة'
const YOUTH_GROUP_CODE_RE = /^YG\d{3,}$/i

function isYouthGroupCode(raw) {
  const text = (raw ?? '').toString().trim()
  return YOUTH_GROUP_CODE_RE.test(text)
}

function isRawYouthGroupIdentifier(raw) {
  const text = (raw ?? '').toString().trim()
  return text === 'GS' || isYouthGroupCode(text)
}

function formatYouthGroupLabel(raw, { fallback = GENERIC_YOUTH_GROUP_LABEL } = {}) {
  const text = (raw ?? '').toString().trim()
  if (!text) return ''
  if (text === 'GS') return GENERAL_SECRETARIAT_LABEL
  if (isYouthGroupCode(text)) return fallback
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

const SESSION_CHECK_PATHS = new Set(['/auth/me', '/auth/logout'])

let _controller = new AbortController()

async function req(path, opts = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...opts,
      signal: _controller.signal,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    if (err?.name === 'AbortError') return null
    throw err
  }
  if (!res.ok) {
    if (res.status === 401 && !SESSION_CHECK_PATHS.has(path)) {
      window.dispatchEvent(new CustomEvent('api:session-expired'))
    }
    await throwResponseError(res)
  }
  return readResponsePayload(res)
}

export const api = {
  formatYouthGroupLabel,
  isYouthGroupCode,
  isRawYouthGroupIdentifier,
  genericYouthGroupLabel: GENERIC_YOUTH_GROUP_LABEL,
  generalSecretariatLabel: GENERAL_SECRETARIAT_LABEL,

  // ── Auth ──────────────────────────────────────────────────────────────────
  logout: () => {
    _controller.abort()
    _controller = new AbortController()
    return req('/auth/logout', { method: 'POST' })
  },
  me:           ()             => req('/auth/me'),
  listUsers:    ()             => req('/auth/users'),
  listUsersBasic: ()           => req('/auth/users/basic'),
  exportUsers:  ()             => req('/auth/users/export'),
  createUser:   (body)         => req('/auth/users', { method: 'POST', body }),
  updateUser:   (username, body) => req(`/auth/users/${encodeURIComponent(username)}`, { method: 'PUT', body }),
  deleteUser:   (username)     => req(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  generateAll:  ()             => req('/auth/generate-all', { method: 'POST' }),

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

  getCalendarBirthdays: ()      => req('/calendar/birthdays'),

  personsEnriched: ()           => req('/persons/enriched'),
  membersIndex:    ()           => req('/persons/members-index'),
  getPerson:       (id)         => req(`/person/${id}`),
  updatePerson:    (id, body)   => req(`/person/${id}`, { method: 'PUT', body }),
  addPerson:       (body)       => req('/person', { method: 'POST', body }),
  resolveGoogleMapsLocation: (url) => req('/location/resolve-google-maps', { method: 'POST', body: { url } }),
  deletePerson:    (id)         => req(`/person/${id}`, { method: 'DELETE' }),
  getSpouse:       (id)         => req(`/persons/${id}/spouse`),
  setSpouse:       (id, spouseId) => req(`/persons/${id}/spouse`, { method: 'POST', body: { spouse_person_id: spouseId } }),
  removeSpouse:    (id)         => req(`/persons/${id}/spouse`, { method: 'DELETE' }),
  getSpouseCandidates: (gender) => req(`/persons/spouse-candidates?gender=${encodeURIComponent(gender)}`),
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

  // ── Registration ────────────────────────────────────────────────────────────
  submitRegistration: (body) => req('/registration/submit', { method: 'POST', body }),
  checkUsername: (username) => req(`/registration/check-username?username=${encodeURIComponent(username)}`),
  myRegistrationStatus: () => req('/registration/my-status'),

  // ── Requests ────────────────────────────────────────────────────────────────
  getRequests: () => req('/requests'),
  getRequestsHistory: () => req('/requests/history'),
  adminApproveRequest: (personId, notes) => req(`/requests/${personId}/admin-approve`, { method: 'POST', body: { notes: notes || '' } }),
  adminRejectRequest: (personId, reason) => req(`/requests/${personId}/admin-reject`, { method: 'POST', body: { reason: reason || '' } }),
  ygApproveRequest: (recordId, notes) => req(`/requests/yg/${recordId}/approve`, { method: 'POST', body: { notes: notes || '' } }),
  ygRejectRequest: (recordId, reason) => req(`/requests/yg/${recordId}/reject`, { method: 'POST', body: { reason: reason || '' } }),

  // ── Events ───────────────────────────────────────────────────────────────────
  getEventsConstants:    ()                     => req('/events/constants'),
  listEvents:            ()                     => req('/events'),
  createEvent:           (body)                 => req('/events', { method: 'POST', body }),
  getEvent:              (id)                   => req(`/events/${encodeURIComponent(id)}`),
  updateEvent:           (id, body)             => req(`/events/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteEvent:           (id)                   => req(`/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  eventParticipantsExportUrl:  (id) => `${BASE}/events/${encodeURIComponent(id)}/registration/members/export.xlsx`,
  eventSupervisorsExportUrl:   (id) => `${BASE}/events/${encodeURIComponent(id)}/registration/supervisors/export.xlsx`,
  eventGsCommitteeExportUrl:   (id) => `${BASE}/events/${encodeURIComponent(id)}/registration/gs_committee/export.xlsx`,

  listEventTitlePresets: (organizer, ygId)      => {
    const qs = new URLSearchParams({ organizer: organizer || 'gs' })
    if (ygId) qs.set('yg_id', ygId)
    return req(`/events/title-presets?${qs}`)
  },
  createEventTitlePreset: (body)                => req('/events/title-presets', { method: 'POST', body }),
  deleteEventTitlePreset: (id)                  => req(`/events/title-presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  computeEventNights:    (start, end)           => req('/events/compute-nights', { method: 'POST', body: { start_datetime: start, end_datetime: end } }),
  getPersonRegContext:   (personId)             => req(`/events/persons/${encodeURIComponent(personId)}/reg-context`),

  addEventRegistration:    (eventId, type, body) => req(`/events/${encodeURIComponent(eventId)}/registration/${type}`, { method: 'POST', body }),
  actionMemberRegistration: (eventId, regId, action) => req(`/events/${encodeURIComponent(eventId)}/registration/members/${encodeURIComponent(regId)}/action`, { method: 'POST', body: { action } }),
  updateEventRegistration: (eventId, type, regId, body) => req(`/events/${encodeURIComponent(eventId)}/registration/${type}/${encodeURIComponent(regId)}`, { method: 'PUT', body }),
  deleteEventRegistration: (eventId, type, regId) => req(`/events/${encodeURIComponent(eventId)}/registration/${type}/${encodeURIComponent(regId)}`, { method: 'DELETE' }),

  // Custom registration fields (per event, per registration category)
  listEventRegistrationFields:  (eventId, type)            => req(`/events/${encodeURIComponent(eventId)}/registration/${type}/fields`),
  addEventRegistrationField:    (eventId, type, body)      => req(`/events/${encodeURIComponent(eventId)}/registration/${type}/fields`, { method: 'POST', body }),
  updateEventRegistrationField: (eventId, type, fieldId, body) => req(`/events/${encodeURIComponent(eventId)}/registration/${type}/fields/${encodeURIComponent(fieldId)}`, { method: 'PUT', body }),
  deleteEventRegistrationField: (eventId, type, fieldId)   => req(`/events/${encodeURIComponent(eventId)}/registration/${type}/fields/${encodeURIComponent(fieldId)}`, { method: 'DELETE' }),

  addEventYgApology:    (eventId, body)       => req(`/events/${encodeURIComponent(eventId)}/yg-apologies`, { method: 'POST', body }),
  deleteEventYgApology: (eventId, apologyId)  => req(`/events/${encodeURIComponent(eventId)}/yg-apologies/${encodeURIComponent(apologyId)}`, { method: 'DELETE' }),

  // Teams
  createEventTeams:      (eventId, body)              => req(`/events/${encodeURIComponent(eventId)}/teams`, { method: 'POST', body }),
  updateEventTeam:       (eventId, teamId, body)       => req(`/events/${encodeURIComponent(eventId)}/teams/${encodeURIComponent(teamId)}`, { method: 'PUT', body }),
  deleteEventTeam:       (eventId, teamId)             => req(`/events/${encodeURIComponent(eventId)}/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' }),
  autoDistributeTeams:   (eventId, mode)               => req(`/events/${encodeURIComponent(eventId)}/teams/auto-distribute`, { method: 'POST', body: { mode } }),
  unassignEventTeams:    (eventId, scope)              => req(`/events/${encodeURIComponent(eventId)}/teams/unassign`, { method: 'POST', body: { scope } }),

  uploadEventLogo: async (eventId, file) => {
    const form = new FormData()
    form.append('logo', file)
    const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}/logos`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  eventLogoUrl:    (eventId, imgId, bust) => `${BASE}/events/${encodeURIComponent(eventId)}/logos/${encodeURIComponent(imgId)}${bust ? `?t=${bust}` : ''}`,
  deleteEventLogo: (eventId, imgId)       => req(`/events/${encodeURIComponent(eventId)}/logos/${encodeURIComponent(imgId)}`, { method: 'DELETE' }),
  setMainEventLogo:(eventId, imgId)       => req(`/events/${encodeURIComponent(eventId)}/logos/${encodeURIComponent(imgId)}/set-main`, { method: 'PATCH' }),

  uploadEventPoster: async (eventId, file) => {
    const form = new FormData()
    form.append('poster', file)
    const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}/posters`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  eventPosterUrl:    (eventId, imgId, bust) => `${BASE}/events/${encodeURIComponent(eventId)}/posters/${encodeURIComponent(imgId)}${bust ? `?t=${bust}` : ''}`,
  deleteEventPoster: (eventId, imgId)       => req(`/events/${encodeURIComponent(eventId)}/posters/${encodeURIComponent(imgId)}`, { method: 'DELETE' }),
  setMainEventPoster:(eventId, imgId)       => req(`/events/${encodeURIComponent(eventId)}/posters/${encodeURIComponent(imgId)}/set-main`, { method: 'PATCH' }),

  uploadEventDocument: async (eventId, file) => {
    const form = new FormData()
    form.append('document', file)
    const res = await fetch(`${BASE}/events/${encodeURIComponent(eventId)}/documents`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  eventDocumentUrl:    (eventId, docId) => `${BASE}/events/${encodeURIComponent(eventId)}/documents/${encodeURIComponent(docId)}`,
  deleteEventDocument: (eventId, docId) => req(`/events/${encodeURIComponent(eventId)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' }),
  setMainEventDocument:(eventId, docId) => req(`/events/${encodeURIComponent(eventId)}/documents/${encodeURIComponent(docId)}/set-main`, { method: 'PATCH' }),

  // ── Camp Locations ────────────────────────────────────────────────────────────
  listCampLocations:    ()                               => req('/camp-locations'),
  createCampLocation:   (body)                           => req('/camp-locations', { method: 'POST', body }),
  updateCampLocation:   (locId, body)                    => req(`/camp-locations/${encodeURIComponent(locId)}`, { method: 'PUT', body }),
  deleteCampLocation:   (locId)                          => req(`/camp-locations/${encodeURIComponent(locId)}`, { method: 'DELETE' }),

  addCampBuilding:      (locId, body)                    => req(`/camp-locations/${encodeURIComponent(locId)}/buildings`, { method: 'POST', body }),
  updateCampBuilding:   (locId, bldId, body)             => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}`, { method: 'PUT', body }),
  deleteCampBuilding:   (locId, bldId)                   => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}`, { method: 'DELETE' }),

  addCampFloor:         (locId, bldId, body)             => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors`, { method: 'POST', body }),
  updateCampFloor:      (locId, bldId, flrId, body)      => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}`, { method: 'PUT', body }),
  deleteCampFloor:      (locId, bldId, flrId)            => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}`, { method: 'DELETE' }),

  uploadFloorPlan: async (locId, bldId, flrId, file) => {
    const form = new FormData()
    form.append('image', file)
    const res = await fetch(`${BASE}/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}/floor-plan`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) await throwResponseError(res)
    return readResponsePayload(res)
  },
  floorPlanUrl:         (flrId, bust)                    => `${BASE}/camp-locations/floor-plan/${encodeURIComponent(flrId)}${bust ? `?t=${bust}` : ''}`,
  deleteFloorPlan:      (locId, bldId, flrId)            => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}/floor-plan`, { method: 'DELETE' }),

  addCampRoom:          (locId, bldId, flrId, body)      => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}/rooms`, { method: 'POST', body }),
  updateCampRoom:       (locId, bldId, flrId, rmId, body)=> req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}/rooms/${encodeURIComponent(rmId)}`, { method: 'PUT', body }),
  deleteCampRoom:       (locId, bldId, flrId, rmId)      => req(`/camp-locations/${encodeURIComponent(locId)}/buildings/${encodeURIComponent(bldId)}/floors/${encodeURIComponent(flrId)}/rooms/${encodeURIComponent(rmId)}`, { method: 'DELETE' }),

  // ── Schedule Presets ─────────────────────────────────────────────────────────
  listSchedulePresets:   ()                   => req('/schedule-presets'),
  createSchedulePreset:  (body)               => req('/schedule-presets', { method: 'POST', body }),
  updateSchedulePreset:  (id, body)           => req(`/schedule-presets/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteSchedulePreset:  (id)                 => req(`/schedule-presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ── Event Schedule Entries ───────────────────────────────────────────────────
  addScheduleEntry:      (eventId, body)      => req(`/events/${encodeURIComponent(eventId)}/schedule/entries`, { method: 'POST', body }),
  updateScheduleEntry:   (eventId, id, body)  => req(`/events/${encodeURIComponent(eventId)}/schedule/entries/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteScheduleEntry:   (eventId, id)        => req(`/events/${encodeURIComponent(eventId)}/schedule/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorderScheduleEntries:(eventId, orderedIds)=> req(`/events/${encodeURIComponent(eventId)}/schedule/reorder`, { method: 'POST', body: { ordered_ids: orderedIds } }),

  // ── Event Schedule Exceptions ────────────────────────────────────────────────
  addScheduleException:  (eventId, body)      => req(`/events/${encodeURIComponent(eventId)}/schedule/exceptions`, { method: 'POST', body }),
  updateScheduleException:(eventId, id, body) => req(`/events/${encodeURIComponent(eventId)}/schedule/exceptions/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteScheduleException:(eventId, id)       => req(`/events/${encodeURIComponent(eventId)}/schedule/exceptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ── Event Bedrooms ───────────────────────────────────────────────────────────
  getEventBedroom:             (eventId)           => req(`/events/${encodeURIComponent(eventId)}/bedroom`),
  updateBedroomConfig:         (eventId, body)     => req(`/events/${encodeURIComponent(eventId)}/bedroom-config`, { method: 'PUT', body }),
  autoDistributeBedrooms:      (eventId, body)     => req(`/events/${encodeURIComponent(eventId)}/bedroom-assignments/auto-distribute`, { method: 'POST', body }),
  clearBedroomAssignments:     (eventId)           => req(`/events/${encodeURIComponent(eventId)}/bedroom-assignments`, { method: 'DELETE' }),
  createBedroomAssignment:     (eventId, body)     => req(`/events/${encodeURIComponent(eventId)}/bedroom-assignments`, { method: 'POST', body }),
  updateBedroomAssignment:     (eventId, id, body) => req(`/events/${encodeURIComponent(eventId)}/bedroom-assignments/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteBedroomAssignment:     (eventId, id)       => req(`/events/${encodeURIComponent(eventId)}/bedroom-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ── Privileges ───────────────────────────────────────────────────────────────
  getPrivilegeTypes:     ()             => req('/privileges/types'),
  getPrivilegeAgeGroups: ()             => req('/privileges/age-groups'),
  getPrivilegeYouthGroups: ()           => req('/privileges/youth-groups'),
  getPrivilegeOrgPositions: (groupId)   => req(`/privileges/org-positions/${encodeURIComponent(groupId)}`),
  searchPrivilegePersons: (q)           => req(`/privileges/persons/search?q=${encodeURIComponent(q)}`),
  listPrivilegeGrants:   (type)         => req(`/privileges/grants${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  createPrivilegeGrants: (grants)       => req('/privileges/grants', { method: 'POST', body: { grants } }),
  deletePrivilegeGrant:  (id)           => req(`/privileges/grants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  resolvePersonPrivileges: (personId)   => req(`/privileges/resolve?person_id=${encodeURIComponent(personId)}`),
  whoCanAccessPerson:    (personId)     => req(`/privileges/who-can-access?person_id=${encodeURIComponent(personId)}`),
  getMyAccess:           ()             => req('/privileges/my-access'),
  getAccessibleMembers:  ()             => req('/privileges/accessible-members'),
}
