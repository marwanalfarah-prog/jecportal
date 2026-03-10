import { useEffect, useState } from 'react'
import { MapPin, Plus, Trash2, ExternalLink, Pencil } from 'lucide-react'
import { api } from '../api.js'

const REGIONS = ['الشمال', 'الوسط', 'الجنوب']
const JORDAN_GOVERNORATES = [
  'عمان', 'إربد', 'الزرقاء', 'البلقاء', 'مادبا', 'الكرك',
  'الطفيلة', 'معان', 'العقبة', 'جرش', 'عجلون', 'المفرق',
]

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

function sortByRegionGovernorateParishPatron(items) {
  return [...(items || [])].sort(compareByRegionGovernorateParishPatron)
}

function toGoogleMapsUrl(lat, lng) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
}

function churchDisplayName(church) {
  return `كنيسة ${normalizeText(church?.patron_saint)} - ${normalizeText(church?.area)}`
}

function normalizeUrlInput(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  return `https://${text}`
}

export default function ChurchesAdmin({ toast }) {
  const [activeTab, setActiveTab] = useState('churches')
  const [churches, setChurches] = useState([])
  const [parishes, setParishes] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingChurch, setSavingChurch] = useState(false)
  const [savingParish, setSavingParish] = useState(false)
  const [uploadingParishLogoId, setUploadingParishLogoId] = useState('')
  const [parishLogoBust, setParishLogoBust] = useState(Date.now())
  const [editingChurchId, setEditingChurchId] = useState('')
  const [editingParishId, setEditingParishId] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [deletingParishId, setDeletingParishId] = useState('')
  const [churchForm, setChurchForm] = useState({
    parish_id: '', patron_saint: '', area: '', lat: '', lng: '',
  })
  const [parishForm, setParishForm] = useState({
    patron_saint: '', area: '', lpj_url: '', facebook_url: '', instagram_url: '', region: '', governorate: '',
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await api.listChurches()
      setChurches(sortByRegionGovernorateParishPatron(res?.churches || []))
      setParishes(sortByRegionGovernorateParishPatron(res?.parishes || []))
    } catch {
      toast?.('تعذّر تحميل بيانات الكنائس والرعايا', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateChurch = async (e) => {
    e.preventDefault()
    if (!churchForm.parish_id) {
      toast?.('يرجى اختيار الرعية', 'error')
      return
    }
    if (!churchForm.patron_saint.trim() || !churchForm.area.trim()) {
      toast?.('يرجى تعبئة شفيع الكنيسة والمنطقة', 'error')
      return
    }
    const lat = String(churchForm.lat || '').trim()
    const lng = String(churchForm.lng || '').trim()
    const latNum = Number(lat)
    const lngNum = Number(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      toast?.('الإحداثيات غير صالحة', 'error')
      return
    }

    setSavingChurch(true)
    try {
      const payload = {
        parish_id: churchForm.parish_id,
        patron_saint: churchForm.patron_saint.trim(),
        area: churchForm.area.trim(),
        lat,
        lng,
      }
      if (editingChurchId) {
        const res = await api.updateChurch(editingChurchId, payload)
        const updatedChurch = res?.church
        setChurches((prev) => sortByRegionGovernorateParishPatron(prev.map((c) => (c.id === editingChurchId ? updatedChurch : c))))
      } else {
        const res = await api.createChurch(payload)
        const newChurch = res?.church
        setChurches((prev) => sortByRegionGovernorateParishPatron([...prev, newChurch]))
      }
      setChurchForm({ parish_id: '', patron_saint: '', area: '', lat: '', lng: '' })
      setEditingChurchId('')
      toast?.(editingChurchId ? 'تم تعديل الكنيسة بنجاح' : 'تمت إضافة الكنيسة بنجاح', 'success')
    } catch (err) {
      if ((err?.message || '').includes('400')) toast?.('تحقق من البيانات المدخلة', 'error')
      else toast?.('تعذّرت إضافة الكنيسة', 'error')
    } finally {
      setSavingChurch(false)
    }
  }

  const handleCreateParish = async (e) => {
    e.preventDefault()
    if (!parishForm.patron_saint.trim() || !parishForm.area.trim()) {
      toast?.('يرجى تعبئة الشفيع والمنطقة', 'error')
      return
    }
    if (!parishForm.region || !parishForm.governorate) {
      toast?.('يرجى اختيار الإقليم والمحافظة', 'error')
      return
    }

    const lpjUrl = normalizeUrlInput(parishForm.lpj_url)
    const facebookUrl = normalizeUrlInput(parishForm.facebook_url)
    const instagramUrl = normalizeUrlInput(parishForm.instagram_url)

    setSavingParish(true)
    try {
      const payload = {
        patron_saint: parishForm.patron_saint.trim(),
        area: parishForm.area.trim(),
        lpj_url: lpjUrl,
        facebook_url: facebookUrl,
        instagram_url: instagramUrl,
        region: parishForm.region,
        governorate: parishForm.governorate,
      }
      if (editingParishId) {
        const res = await api.updateParish(editingParishId, payload)
        const updatedParish = res?.parish
        setParishes((prev) => sortByRegionGovernorateParishPatron(prev.map((p) => (p.id === editingParishId ? updatedParish : p))))
      } else {
        const res = await api.createParish(payload)
        const newParish = res?.parish
        setParishes((prev) => sortByRegionGovernorateParishPatron([...prev, newParish]))
      }
      setParishForm({ patron_saint: '', area: '', lpj_url: '', facebook_url: '', instagram_url: '', region: '', governorate: '' })
      setEditingParishId('')
      toast?.(editingParishId ? 'تم تعديل الرعية بنجاح' : 'تمت إضافة الرعية بنجاح', 'success')
    } catch (err) {
      if ((err?.message || '').includes('400')) toast?.('تحقق من بيانات الرعية', 'error')
      else toast?.('تعذّرت إضافة الرعية', 'error')
    } finally {
      setSavingParish(false)
    }
  }

  const handleDelete = async (id, label) => {
    if (!window.confirm(`حذف الكنيسة ${label || ''}؟`)) return
    setDeletingId(id)
    try {
      await api.deleteChurch(id)
      setChurches((prev) => prev.filter((c) => c.id !== id))
      toast?.('تم حذف الكنيسة', 'success')
    } catch {
      toast?.('تعذّر حذف الكنيسة', 'error')
    } finally {
      setDeletingId('')
    }
  }

  const handleDeleteParish = async (id, label) => {
    if (!window.confirm(`حذف الرعية ${label || ''}؟`)) return
    setDeletingParishId(id)
    try {
      await api.deleteParish(id)
      setParishes((prev) => prev.filter((p) => p.id !== id))
      toast?.('تم حذف الرعية', 'success')
    } catch {
      toast?.('تعذّر حذف الرعية. تأكد من عدم وجود كنائس مرتبطة بها.', 'error')
    } finally {
      setDeletingParishId('')
    }
  }

  const handleUploadParishLogo = async (parishId, event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingParishLogoId(parishId)
    try {
      await api.uploadParishLogo(parishId, file)
      setParishLogoBust(Date.now())
      setParishes((prev) => prev.map((p) => (p.id === parishId ? { ...p, logo_url: api.parishLogoUrl(parishId, Date.now()) } : p)))
      toast?.('تم رفع شعار الرعية بنجاح', 'success')
    } catch {
      toast?.('تعذّر رفع شعار الرعية', 'error')
    } finally {
      setUploadingParishLogoId('')
    }
  }

  const churchCountByParish = churches.reduce((acc, church) => {
    const pid = String(church.parish_id || '')
    acc[pid] = (acc[pid] || 0) + 1
    return acc
  }, {})

  const parishLabel = (parish) => `${parish.name || parish.patron_saint}`

  const startEditChurch = (church) => {
    setEditingChurchId(church.id)
    setChurchForm({
      parish_id: String(church.parish_id || ''),
      patron_saint: String(church.patron_saint || ''),
      area: String(church.area || ''),
      lat: String(church.lat ?? ''),
      lng: String(church.lng ?? ''),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEditChurch = () => {
    setEditingChurchId('')
    setChurchForm({ parish_id: '', patron_saint: '', area: '', lat: '', lng: '' })
  }

  const startEditParish = (parish) => {
    setEditingParishId(parish.id)
    setParishForm({
      patron_saint: String(parish.patron_saint || ''),
      area: String(parish.area || ''),
      lpj_url: String(parish.lpj_url || ''),
      facebook_url: String(parish.facebook_url || ''),
      instagram_url: String(parish.instagram_url || ''),
      region: String(parish.region || ''),
      governorate: String(parish.governorate || ''),
    })
    setActiveTab('parishes')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEditParish = () => {
    setEditingParishId('')
    setParishForm({ patron_saint: '', area: '', lpj_url: '', facebook_url: '', instagram_url: '', region: '', governorate: '' })
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${activeTab === 'churches' ? 'btn-gold' : 'btn-ghost'}`}
            onClick={() => setActiveTab('churches')}
            type="button"
          >
            الكنائس
          </button>
          <button
            className={`btn ${activeTab === 'parishes' ? 'btn-gold' : 'btn-ghost'}`}
            onClick={() => setActiveTab('parishes')}
            type="button"
          >
            الرعايا
          </button>
        </div>
      </section>

      {activeTab === 'churches' && (
        <>
      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <MapPin size={18} color="var(--gold)" />
          <h3 style={{ margin: 0, color: 'var(--navy)' }}>{editingChurchId ? 'تعديل كنيسة' : 'إضافة كنيسة'}</h3>
        </div>

        <form onSubmit={handleCreateChurch} style={{ display: 'grid', gap: 10 }}>
          <div>
            <select
              className="form-control"
              value={churchForm.parish_id}
              onChange={(e) => setChurchForm((f) => ({ ...f, parish_id: e.target.value }))}
            >
              <option value="">اختر الرعية</option>
              {parishes.map((p) => <option key={p.id} value={p.id}>{parishLabel(p)}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input
              className="form-control"
              placeholder="شفيع الكنيسة"
              value={churchForm.patron_saint}
              onChange={(e) => setChurchForm((f) => ({ ...f, patron_saint: e.target.value }))}
            />
            <input
              className="form-control"
              placeholder="المنطقة"
              value={churchForm.area}
              onChange={(e) => setChurchForm((f) => ({ ...f, area: e.target.value }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input
              className="form-control"
              type="text"
              inputMode="decimal"
              placeholder="خط العرض (Latitude)"
              value={churchForm.lat}
              onChange={(e) => setChurchForm((f) => ({ ...f, lat: e.target.value }))}
            />
            <input
              className="form-control"
              type="text"
              inputMode="decimal"
              placeholder="خط الطول (Longitude)"
              value={churchForm.lng}
              onChange={(e) => setChurchForm((f) => ({ ...f, lng: e.target.value }))}
            />
          </div>

          <div>
            <button className="btn btn-gold" type="submit" disabled={savingChurch}>
              <Plus size={15} /> {savingChurch ? 'جاري الحفظ...' : (editingChurchId ? 'حفظ التعديل' : 'إضافة كنيسة')}
            </button>
            {editingChurchId ? (
              <button className="btn btn-ghost" type="button" onClick={cancelEditChurch} style={{ marginInlineStart: 8 }}>
                إلغاء
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 10px', color: 'var(--navy)' }}>قائمة الكنائس</h3>

        {loading ? (
          <div className="spinner" />
        ) : churches.length === 0 ? (
          <div style={{ color: 'var(--gray-500)' }}>لا توجد كنائس بعد.</div>
        ) : (
          <div className="table-wrap">
            <table style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>الرعية</th>
                  <th>اسم الكنيسة</th>
                  <th>الإقليم</th>
                  <th>المحافظة</th>
                  <th style={{ width: 180 }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {churches.map((c) => (
                  <tr key={c.id}>
                    <td>{c.parish_name || c.parish_id || '—'}</td>
                    <td>{churchDisplayName(c)}</td>
                    <td>{c.region || '—'}</td>
                    <td>{c.governorate || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => window.open(toGoogleMapsUrl(c.lat, c.lng), '_blank', 'noopener,noreferrer')}
                          title="فتح في Google Maps"
                        >
                          <ExternalLink size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => startEditChurch(c)}
                          title="تعديل"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          onClick={() => handleDelete(c.id, churchDisplayName(c))}
                          disabled={deletingId === c.id}
                          title="حذف"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      )}

      {activeTab === 'parishes' && (
        <>
          <section className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <MapPin size={18} color="var(--gold)" />
              <h3 style={{ margin: 0, color: 'var(--navy)' }}>{editingParishId ? 'تعديل رعية' : 'إضافة رعية'}</h3>
            </div>

            <form onSubmit={handleCreateParish} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  className="form-control"
                  placeholder="شفيع الرعية"
                  value={parishForm.patron_saint}
                  onChange={(e) => setParishForm((f) => ({ ...f, patron_saint: e.target.value }))}
                />
                <input
                  className="form-control"
                  placeholder="المنطقة"
                  value={parishForm.area}
                  onChange={(e) => setParishForm((f) => ({ ...f, area: e.target.value }))}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select
                  className="form-control"
                  value={parishForm.region}
                  onChange={(e) => setParishForm((f) => ({ ...f, region: e.target.value }))}
                >
                  <option value="">اختر الإقليم</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>

                <select
                  className="form-control"
                  value={parishForm.governorate}
                  onChange={(e) => setParishForm((f) => ({ ...f, governorate: e.target.value }))}
                >
                  <option value="">اختر المحافظة</option>
                  {JORDAN_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>

              <input
                className="form-control"
                type="url"
                placeholder="رابط الرعية من موقع البطريركية اللاتينية (LPJ)"
                value={parishForm.lpj_url}
                onChange={(e) => setParishForm((f) => ({ ...f, lpj_url: e.target.value }))}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  className="form-control"
                  type="url"
                  placeholder="رابط صفحة Facebook"
                  value={parishForm.facebook_url}
                  onChange={(e) => setParishForm((f) => ({ ...f, facebook_url: e.target.value }))}
                />
                <input
                  className="form-control"
                  type="url"
                  placeholder="رابط صفحة Instagram"
                  value={parishForm.instagram_url}
                  onChange={(e) => setParishForm((f) => ({ ...f, instagram_url: e.target.value }))}
                />
              </div>

              <div>
                <button className="btn btn-gold" type="submit" disabled={savingParish}>
                  <Plus size={15} /> {savingParish ? 'جاري الحفظ...' : (editingParishId ? 'حفظ التعديل' : 'إضافة رعية')}
                </button>
                {editingParishId ? (
                  <button className="btn btn-ghost" type="button" onClick={cancelEditParish} style={{ marginInlineStart: 8 }}>
                    إلغاء
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="card" style={{ padding: 16 }}>
            <h3 style={{ margin: '0 0 10px', color: 'var(--navy)' }}>قائمة الرعايا</h3>

            {loading ? (
              <div className="spinner" />
            ) : parishes.length === 0 ? (
              <div style={{ color: 'var(--gray-500)' }}>لا توجد رعايا بعد.</div>
            ) : (
              <div className="table-wrap">
                <table style={{ minWidth: 1120 }}>
                  <thead>
                    <tr>
                      <th>الشعار</th>
                      <th>اسم الرعية</th>
                      <th>الشفيع</th>
                      <th>المنطقة</th>
                      <th>الإقليم</th>
                      <th>المحافظة</th>
                      <th>رابط LPJ</th>
                      <th>Facebook</th>
                      <th>Instagram</th>
                      <th>عدد الكنائس</th>
                      <th style={{ width: 180 }}>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parishes.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
                            {p.logo_url ? (
                              <img
                                src={api.parishLogoUrl(p.id, parishLogoBust)}
                                alt={p.name || p.patron_saint || 'Parish Logo'}
                                style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--gray-200)', background: 'var(--gray-50)' }}
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: 8,
                                  border: '1px dashed var(--gray-300)',
                                  background: 'var(--gray-50)',
                                  color: 'var(--gray-400)',
                                  fontSize: '0.72rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                                title="لا يوجد شعار"
                              >
                                —
                              </div>
                            )}
                            <label className="btn btn-ghost btn-sm" style={{ cursor: uploadingParishLogoId === p.id ? 'wait' : 'pointer' }}>
                              {uploadingParishLogoId === p.id ? 'جاري الرفع...' : 'رفع'}
                              <input
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                disabled={uploadingParishLogoId === p.id}
                                onChange={(e) => handleUploadParishLogo(p.id, e)}
                              />
                            </label>
                          </div>
                        </td>
                        <td>{p.name}</td>
                        <td>{p.patron_saint}</td>
                        <td>{p.area}</td>
                        <td>{p.region || '—'}</td>
                        <td>{p.governorate || '—'}</td>
                        <td>
                          {p.lpj_url ? (
                            <a href={p.lpj_url} target="_blank" rel="noreferrer" style={{ color: 'var(--navy)', textDecoration: 'underline' }}>
                              فتح الرابط
                            </a>
                          ) : (
                            <span style={{ color: 'var(--gray-400)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {p.facebook_url ? (
                            <a href={p.facebook_url} target="_blank" rel="noreferrer" style={{ color: 'var(--navy)', textDecoration: 'underline' }}>
                              Facebook
                            </a>
                          ) : (
                            <span style={{ color: 'var(--gray-400)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {p.instagram_url ? (
                            <a href={p.instagram_url} target="_blank" rel="noreferrer" style={{ color: 'var(--navy)', textDecoration: 'underline' }}>
                              Instagram
                            </a>
                          ) : (
                            <span style={{ color: 'var(--gray-400)' }}>—</span>
                          )}
                        </td>
                        <td>{churchCountByParish[p.id] || 0}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => startEditParish(p)}
                            title="تعديل"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => handleDeleteParish(p.id, p.name)}
                            disabled={deletingParishId === p.id}
                            title="حذف"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
