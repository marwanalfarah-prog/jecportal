const BASE = '/api'

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login:        (body)         => req('/auth/login', { method: 'POST', body }),
  logout:       ()             => req('/auth/logout', { method: 'POST' }),
  me:           ()             => req('/auth/me'),
  listUsers:    ()             => req('/auth/users'),
  listUsersBasic: ()           => req('/auth/users/basic'),
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
  chartGov:        ()           => req('/chart/governorate'),
  chartGender:     ()           => req('/chart/gender'),
  chartYG:         ()           => req('/chart/youth_group'),
  chartAge:        ()           => req('/chart/age_group'),

  personsEnriched: ()           => req('/persons/enriched'),
  persons:         (params)     => req('/persons?' + new URLSearchParams(params)),
  getPerson:       (id)         => req(`/person/${id}`),
  updatePerson:    (id, body)   => req(`/person/${id}`, { method: 'PUT', body }),
  addPerson:       (body)       => req('/person', { method: 'POST', body }),
  deletePerson:    (id)         => req(`/person/${id}`, { method: 'DELETE' }),
  archivePerson:   (id)         => req(`/person/${id}/archive`, { method: 'PATCH' }),
  unarchivePerson: (id)         => req(`/person/${id}/unarchive`, { method: 'PATCH' }),

  getTable:        (sheet)      => req(`/table/${sheet}`),
  putTable:        (sheet, rows)=> req(`/table/${sheet}`, { method: 'PUT', body: rows }),

  getOrgTree:      (group, periodId) =>
    periodId
      ? req(`/org-tree/${encodeURIComponent(group)}?period_id=${encodeURIComponent(periodId)}`)
      : req(`/org-tree/${encodeURIComponent(group)}`),

  getOrgTreePeriods: (group) => req(`/org-tree/${encodeURIComponent(group)}/periods`),

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
  markResponseRead:       (respId)   => req(`/questionnaires/responses/${respId}/read`, { method: 'PATCH' }),

  // ── Questionnaires (member) ─────────────────────────────────────────────────
  listMyQuestionnaires:  ()           => req('/questionnaires'),
  submitQuestionnaireResponse: (id, answers) =>
    req(`/questionnaires/${id}/respond`, { method: 'POST', body: { answers } }),

  // ── Notifications ───────────────────────────────────────────────────────────
  getNotifications:          ()       => req('/notifications'),
  markNotificationRead:      (id)     => req(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead:  ()       => req('/notifications/read-all', { method: 'PATCH' }),

  getUnregisteredPerson: (id)         => req(`/unregistered/${id}`),
  addUnregistered:       (body)       => req('/unregistered', { method: 'POST', body }),
  updateUnregistered:    (id, body)   => req(`/unregistered/${id}`, { method: 'PUT', body }),
  deleteUnregistered:    (id)         => req(`/unregistered/${id}`, { method: 'DELETE' }),
  archiveUnregistered:   (id)         => req(`/unregistered/${id}/archive`, { method: 'PATCH' }),
  unarchiveUnregistered: (id)         => req(`/unregistered/${id}/unarchive`, { method: 'PATCH' }),
  syncUnregistered:      (body)       => req('/unregistered/sync', { method: 'POST', body }),
  promoteUnregistered:   (id)         => req(`/unregistered/${id}/promote`, { method: 'POST' }),

  // Unregistered photo
  uploadUnregisteredPhoto: async (id, file) => {
    const form = new FormData()
    form.append('photo', file)
    const res = await fetch(`${BASE}/unregistered/${id}/photo`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) throw new Error(`API error ${res.status}`)
    return res.json()
  },
  unregisteredPhotoUrl: (id, bust) => `${BASE}/unregistered/${id}/photo${bust ? `?t=${bust}` : ''}`,

  // Photo — uses raw fetch (multipart)
  uploadPhoto: async (id, file) => {
    const form = new FormData()
    form.append('photo', file)
    const res = await fetch(`${BASE}/person/${id}/photo`, { method: 'POST', body: form, credentials: 'include' })
    if (!res.ok) throw new Error(`API error ${res.status}`)
    return res.json()
  },
  photoUrl: (id, bust) => `${BASE}/person/${id}/photo${bust ? `?t=${bust}` : ''}`,
}
