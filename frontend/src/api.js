const BASE = '/api'

function formatYouthGroupLabel(raw) {
  const text = (raw ?? '').toString().trim()
  if (!text) return ''
  if (/^YG\d{3,}$/i.test(text) || text === 'GS') return text
  if (text.startsWith('شبيبة')) return text
  return `شبيبة ${text}`
}

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
  formatYouthGroupLabel,

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
  archivePerson:   (id, youthGroupId)         => req(`/person/${id}/archive`, { method: 'PATCH', body: { youth_group_id: youthGroupId } }),
  unarchivePerson: (id, youthGroupId)         => req(`/person/${id}/unarchive`, { method: 'PATCH', body: { youth_group_id: youthGroupId } }),

  getTable:        (sheet)      => req(`/table/${sheet}`),
  putTable:        (sheet, rows)=> req(`/table/${sheet}`, { method: 'PUT', body: rows }),

  getOrgTree:      (group, periodId) =>
    periodId
      ? req(`/org-tree/${encodeURIComponent(group)}?period_id=${encodeURIComponent(periodId)}`)
      : req(`/org-tree/${encodeURIComponent(group)}`),

  getOrgTreePeriods: (group) => req(`/org-tree/${encodeURIComponent(group)}/periods`),

  // Lean single-period endpoint (without embedding all periods metadata)
  getOrgTreePeriod: (group, periodId) =>
    req(`/org-tree/${encodeURIComponent(group)}/${encodeURIComponent(periodId)}`),

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
  markNotificationUnread:    (id)     => req(`/notifications/${id}/unread`, { method: 'PATCH' }),
  deleteNotification:        (id)     => req(`/notifications/${id}`, { method: 'DELETE' }),
  markAllNotificationsRead:  ()       => req('/notifications/read-all', { method: 'PATCH' }),

  getUnregisteredPerson: (id)         => req(`/unregistered/${id}`),
  addUnregistered:       (body)       => req('/unregistered', { method: 'POST', body }),
  updateUnregistered:    (id, body)   => req(`/unregistered/${id}`, { method: 'PUT', body }),
  deleteUnregistered:    (id)         => req(`/unregistered/${id}`, { method: 'DELETE' }),
  archiveUnregistered:   (id, youthGroupId)         => req(`/unregistered/${id}/archive`, { method: 'PATCH', body: { youth_group_id: youthGroupId } }),
  unarchiveUnregistered: (id, youthGroupId)         => req(`/unregistered/${id}/unarchive`, { method: 'PATCH', body: { youth_group_id: youthGroupId } }),
  syncUnregistered:      (body)       => req('/unregistered/sync', { method: 'POST', body }),
  promoteUnregistered:   (id)         => req(`/unregistered/${id}/promote`, { method: 'POST' }),

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig:          ()           => req('/config'),
  putConfig:          (body)       => req('/config', { method: 'PUT', body }),
  resetConfig:        ()           => req('/config/reset', { method: 'PUT' }),

  // ── Youth Groups (config) ───────────────────────────────────────────────────
  listYouthGroups:    ()           => req('/config/youth-groups'),
  createYouthGroup:   (body)       => req('/config/youth-groups', { method: 'POST', body }),
  updateYouthGroup:   (gid, body)  => req(`/config/youth-groups/${encodeURIComponent(gid)}`, { method: 'PUT', body }),
  deleteYouthGroup:   (gid)        => req(`/config/youth-groups/${encodeURIComponent(gid)}`, { method: 'DELETE' }),

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
    if (!res.ok) throw new Error(`API error ${res.status}`)
    return res.json()
  },
  parishLogoUrl: (id, bust) => `${BASE}/parishes/${encodeURIComponent(id)}/logo${bust ? `?t=${bust}` : ''}`,

  // ── Maintenance ─────────────────────────────────────────────────────────────
  clearNotifications: ()           => req('/config/maintenance/notifications', { method: 'DELETE' }),
  clearPromotions:    ()           => req('/config/maintenance/promotions', { method: 'DELETE' }),
  reloadData:         ()           => req('/config/maintenance/reload', { method: 'POST' }),

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
    if (!res.ok) throw new Error(`API error ${res.status}`)
    return res.json()
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
    if (!res.ok) throw new Error(`API error ${res.status}`)
    return res.json()
  },
  youthGroupSpecialLogoUrl: (groupRef, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo${bust ? `?t=${bust}` : ''}`,
  youthGroupSpecialLogoByIdUrl: (groupRef, logoId, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo/${encodeURIComponent(logoId)}${bust ? `?t=${bust}` : ''}`,
  youthGroupActiveSpecialLogoUrl: (groupRef, bust) => `${BASE}/youth-groups/${encodeURIComponent(groupRef)}/special-logo-active${bust ? `?t=${bust}` : ''}`,
}
