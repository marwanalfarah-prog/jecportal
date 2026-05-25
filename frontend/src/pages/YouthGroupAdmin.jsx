import { useEffect, useMemo, useState } from 'react'
import { Upload, Users, CalendarDays, ShieldEllipsis, UserRound, Globe, Facebook, Instagram, Linkedin } from 'lucide-react'
import { api } from '../api.js'
import { ErrorState, LoadingState } from '../pageStates.jsx'

const AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

function googleMapsLink(lat, lng) {
  const latNum = Number(lat)
  const lngNum = Number(lng)
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latNum},${lngNum}`)}`
}

function normalizeUrlInput(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  return `https://${text}`
}

function socialMediaItemId(item) {
  return String(item?.youth_group_social_media_id || item?.id || '').trim()
}

function socialPlatformLabel(platform) {
  if (platform === 'facebook') return 'Facebook'
  if (platform === 'instagram') return 'Instagram'
  if (platform === 'linkedin') return 'LinkedIn'
  return 'Social'
}

function socialPlatformColor(platform) {
  if (platform === 'facebook') return '#1877F2'
  if (platform === 'instagram') return '#E1306C'
  if (platform === 'linkedin') return '#0A66C2'
  return 'var(--gray-600)'
}

function SocialIcon({ platform, size = 14 }) {
  if (platform === 'facebook') return <Facebook size={size} />
  if (platform === 'instagram') return <Instagram size={size} />
  if (platform === 'linkedin') return <Linkedin size={size} />
  return <Globe size={size} />
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color="var(--navy)" />
      </div>
      <div>
        <div style={{ color: 'var(--gray-500)', fontSize: '0.78rem' }}>{label}</div>
        <div style={{ color: 'var(--navy)', fontWeight: 800, fontSize: '1.02rem' }}>{value ?? '—'}</div>
      </div>
    </div>
  )
}

function AgeBreakdownChart({ items }) {
  // Order by AGE_GROUPS
  const ageOrder = AGE_GROUPS
  const byLabel = Object.fromEntries(items.map(item => [item.label, item]))
  const sortedItems = ageOrder.map(label => byLabel[label] || { label, count: 0 })
  const maxValue = Math.max(1, ...sortedItems.map((item) => Number(item?.count || 0)))

  if (!sortedItems.length) {
    return <div style={{ color: 'var(--gray-500)', fontSize: '0.82rem' }}>لا توجد بيانات فئات عمرية لعرضها.</div>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {sortedItems.map((item) => {
        const label = item?.label || '—'
        const count = Number(item?.count || 0)
        const widthPercent = Math.max(0, Math.min(100, (count / maxValue) * 100))
        return (
          <div key={label} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--gray-600)' }}>
              <span>{label}</span>
              <span style={{ color: 'var(--navy)', fontWeight: 700 }}>{count}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--gray-100)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${widthPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--navy), var(--gold))',
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RegistrationDonutChart({ registered, unregistered, archived }) {
  const registeredCount = Math.max(0, Number(registered || 0))
  const unregisteredCount = Math.max(0, Number(unregistered || 0))
  const archivedCount = Math.max(0, Number(archived || 0))
  const total = registeredCount + unregisteredCount + archivedCount

  if (!total) {
    return <div style={{ color: 'var(--gray-500)', fontSize: '0.82rem' }}>لا توجد بيانات تسجيل لعرضها.</div>
  }

  const registeredRatio = registeredCount / total
  const unregisteredRatio = unregisteredCount / total
  const registeredPercent = Math.round(registeredRatio * 100)
  const firstStop = Math.round(registeredRatio * 100)
  const secondStop = Math.round((registeredRatio + unregisteredRatio) * 100)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'center' }}>
      <div
        style={{
          width: 120,
          height: 120,
          position: 'relative',
          borderRadius: '50%',
          background: `conic-gradient(var(--gold) 0% ${firstStop}%, var(--navy) ${firstStop}% ${secondStop}%, var(--gray-300) ${secondStop}% 100%)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 16,
            borderRadius: '50%',
            background: 'white',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--navy)',
            fontWeight: 800,
          }}
        >
          {registeredPercent}%
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-700)', fontSize: '0.84rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--gold)', display: 'inline-block' }} />
          مسجلون: <strong>{registeredCount}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-700)', fontSize: '0.84rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--gray-300)', display: 'inline-block' }} />
          مؤرشفون: <strong>{archivedCount}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-700)', fontSize: '0.84rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--navy)', display: 'inline-block' }} />
          غير مسجلين: <strong>{unregisteredCount}</strong>
        </div>
      </div>
    </div>
  )
}

export default function YouthGroupAdmin({ toast }) {
  const [groups, setGroups] = useState([])
  const [parishes, setParishes] = useState([])
  const [selected, setSelected] = useState('')
  const [details, setDetails] = useState(null)
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [groupsLoadError, setGroupsLoadError] = useState('')
  const [detailsLoadError, setDetailsLoadError] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [specialLogoUploading, setSpecialLogoUploading] = useState(false)
  const [logoBust, setLogoBust] = useState(Date.now())
  const [ageRules, setAgeRules] = useState([])
  const [defaultAgeRules, setDefaultAgeRules] = useState([])
  const [savingAgeRules, setSavingAgeRules] = useState(false)
  const [selectedParishId, setSelectedParishId] = useState('')
  const [savingParish, setSavingParish] = useState(false)
  const [useParishLogo, setUseParishLogo] = useState(false)
  const [specialLogoOccasion, setSpecialLogoOccasion] = useState('')
  const [specialLogoStartDate, setSpecialLogoStartDate] = useState('')
  const [specialLogoEndDate, setSpecialLogoEndDate] = useState('')
  const [specialLogoIsCurrent, setSpecialLogoIsCurrent] = useState(true)
  const [savingSpecialLogoSettings, setSavingSpecialLogoSettings] = useState(false)
  const [savingSpecialLogoId, setSavingSpecialLogoId] = useState('')
  const [socialMediaEntries, setSocialMediaEntries] = useState([])
  const [inheritParishSocialMedia, setInheritParishSocialMedia] = useState(false)
  const [savingSocialMedia, setSavingSocialMedia] = useState(false)
  const [socialPlatform, setSocialPlatform] = useState('facebook')
  const [socialUrl, setSocialUrl] = useState('')
  const [socialAgeGroups, setSocialAgeGroups] = useState([])
  const [activeTab, setActiveTab] = useState('dashboard')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoadingGroups(true)
    setGroupsLoadError('')
    api.listYouthGroupProfiles()
      .then(res => {
        const list = res.groups || []
        setGroups(list)
        if (list[0]?.group_id) setSelected(list[0].group_id)
      })
      .catch(() => {
        setGroups([])
        setGroupsLoadError('تعذر تحميل فرق الشبيبة حالياً. حاول مرة أخرى.')
        toast?.('فشل تحميل فرق الشبيبة', 'error')
      })
      .finally(() => setLoadingGroups(false))

    api.listParishes()
      .then((res) => setParishes(res?.parishes || []))
      .catch(() => {
        setParishes([])
        toast?.('تعذر تحميل قائمة الرعايا', 'error')
      })
  }, [reloadKey, toast])

  useEffect(() => {
    if (!selected) return
    setActiveTab('dashboard')
    setLoadingDetails(true)
    setDetailsLoadError('')
    api.getYouthGroupDetails(selected)
      .then(res => {
        setDetails(res)
        setAgeRules(res?.promotion_settings?.age_rules || [])
        setDefaultAgeRules(res?.promotion_settings?.default_age_rules || [])
        setSelectedParishId(String(res?.group?.parish_id || ''))
        setUseParishLogo(Boolean(res?.group?.use_parish_logo))
        setSocialMediaEntries(Array.isArray(res?.group?.social_media) ? res.group.social_media : [])
        setInheritParishSocialMedia(Boolean(res?.group?.inherit_parish_social_media))
        setSocialPlatform('facebook')
        setSocialUrl('')
        setSocialAgeGroups([])
        setSpecialLogoOccasion('')
        setSpecialLogoStartDate('')
        setSpecialLogoEndDate('')
        setSpecialLogoIsCurrent(true)
      })
      .catch(() => {
        setDetails(null)
        setAgeRules([])
        setDefaultAgeRules([])
        setSelectedParishId('')
        setUseParishLogo(false)
        setSocialMediaEntries([])
        setInheritParishSocialMedia(false)
        setSocialPlatform('facebook')
        setSocialUrl('')
        setSocialAgeGroups([])
        setSpecialLogoOccasion('')
        setSpecialLogoStartDate('')
        setSpecialLogoEndDate('')
        setSpecialLogoIsCurrent(true)
          setDetailsLoadError('تعذر تحميل تفاصيل الفرقة المحددة. حاول مرة أخرى.')
        toast?.('تعذر تحميل تفاصيل الفرقة', 'error')
      })
      .finally(() => setLoadingDetails(false))
        }, [selected, logoBust, toast])

  const group = details?.group || null
  const stats = details?.stats || {}
  const members = details?.members || []
  const periods = details?.periods || []
  const problematic = details?.problematic_data?.members || []
  const parishChurches = group?.parish_churches || []
  const linkedParishId = String(group?.parish_id || selectedParishId || '')
  const linkedParish = parishes.find((p) => String(p.id || '') === linkedParishId) || null
  const currentParishName = group?.parish_name || linkedParish?.name || linkedParish?.patron_saint || null
  const currentUseParishLogo = Boolean(group?.use_parish_logo)
  const effectiveSocialMedia = Array.isArray(group?.effective_social_media) ? group.effective_social_media : socialMediaEntries
  const specialLogos = Array.isArray(group?.special_logos)
    ? [...group.special_logos].sort((a, b) => {
      const aDate = String(a?.start_date || '')
      const bDate = String(b?.start_date || '')
      if (aDate === bDate) return 0
      return aDate < bDate ? 1 : -1
    })
    : []

  const ageBreakdown = useMemo(() => stats.age_group_breakdown || [], [stats])
  const registrationChartCounts = useMemo(() => {
    const archived = members.filter((m) => Boolean(m?.archived)).length
    const registered = members.filter((m) => !m?.archived && m?.person_type === 'registered').length
    const unregistered = members.filter((m) => !m?.archived && m?.person_type === 'unregistered').length
    return { registered, unregistered, archived }
  }, [members])

  const uiAgeRules = useMemo(() => {
    const byGroup = Object.fromEntries((ageRules || []).map(r => [r.age_group, r]))
    const byDefault = Object.fromEntries((defaultAgeRules || []).map(r => [r.age_group, r]))
    return AGE_GROUPS.map((group) => ({
      ...(byDefault[group] || { age_group: group, min_birth_year: null, max_birth_year: null, promotion_to: null }),
      ...(byGroup[group] || { age_group: group }),
      age_group: group,
    }))
  }, [ageRules, defaultAgeRules])

  const onUploadLogo = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selected) return
    if (useParishLogo && !selectedParishId) {
      toast?.('يرجى اختيار الرعية أولاً ثم إعادة المحاولة', 'error')
      return
    }

    setLogoUploading(true)
    try {
      const bust = Date.now()
      if (useParishLogo) {
        await api.uploadParishLogo(selectedParishId, file)
        setDetails((prev) => {
          if (!prev?.group) return prev
          return {
            ...prev,
            group: {
              ...prev.group,
              parish_logo_url: api.parishLogoUrl(selectedParishId, bust),
            },
          }
        })
        toast?.('تم رفع شعار الرعية بنجاح', 'success')
      } else {
        await api.uploadYouthGroupLogo(selected, file)
        toast?.('تم رفع شعار الفرقة بنجاح', 'success')
      }
      setLogoBust(bust)
    } catch {
      toast?.(useParishLogo ? 'فشل رفع شعار الرعية' : 'فشل رفع شعار الفرقة', 'error')
    } finally {
      setLogoUploading(false)
    }
  }

  const onUploadSpecialLogo = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selected) return

    const occasion = String(specialLogoOccasion || '').trim()
    if (!occasion) {
      toast?.('يرجى إدخال اسم المناسبة قبل رفع الشعار', 'error')
      return
    }

    const startDate = String(specialLogoStartDate || '').trim()
    const endDate = String(specialLogoEndDate || '').trim()
    if (!startDate) {
      toast?.('يرجى تحديد تاريخ بداية استخدام الشعار', 'error')
      return
    }
    if (!specialLogoIsCurrent && !endDate) {
      toast?.('يرجى تحديد تاريخ نهاية الاستخدام إذا كانت المناسبة غير حالية', 'error')
      return
    }
    if (!specialLogoIsCurrent && endDate < startDate) {
      toast?.('تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية', 'error')
      return
    }

    setSpecialLogoUploading(true)
    try {
      const res = await api.uploadYouthGroupSpecialLogo(selected, file, {
        occasion,
        start_date: startDate,
        end_date: specialLogoIsCurrent ? '' : endDate,
        is_active: specialLogoIsCurrent,
      })
      const nextSpecialLogos = res?.special_logos || []
      setDetails((prev) => {
        if (!prev?.group) return prev
        return {
          ...prev,
          group: {
            ...prev.group,
            special_logo_occasion: String(res?.special_logo_occasion || prev.group.special_logo_occasion || ''),
            special_logo_active: Boolean(res?.active_special_logo_url),
            special_logo_url: res?.special_logo_url || prev.group.special_logo_url || null,
            active_special_logo_url: res?.active_special_logo_url || null,
            special_logos: nextSpecialLogos,
            has_special_logo: nextSpecialLogos.length > 0,
          },
        }
      })
      setSpecialLogoOccasion('')
      setSpecialLogoStartDate('')
      setSpecialLogoEndDate('')
      setSpecialLogoIsCurrent(true)
      setLogoBust(Date.now())
      toast?.('تم رفع الشعار الخاص بالمناسبة بنجاح', 'success')
    } catch {
      toast?.('فشل رفع الشعار الخاص بالمناسبة', 'error')
    } finally {
      setSpecialLogoUploading(false)
    }
  }

  const updateRule = (ageGroup, key, value) => {
    setAgeRules((prev) => {
      const list = [...(prev || [])]
      const idx = list.findIndex(r => r.age_group === ageGroup)
      const next = idx >= 0 ? { ...list[idx], [key]: value } : { age_group: ageGroup, [key]: value }
      if (idx >= 0) list[idx] = next
      else list.push(next)
      return list
    })
  }

  const onResetAgeRules = () => {
    setAgeRules((defaultAgeRules || []).map(r => ({ ...r })))
  }

  const onSaveAgeRules = async () => {
    if (!selected) return
    setSavingAgeRules(true)
    try {
      const payload = { age_rules: uiAgeRules.map(r => ({
        age_group: r.age_group,
        min_birth_year: r.min_birth_year ?? null,
        max_birth_year: r.max_birth_year ?? null,
        promotion_to: r.promotion_to || null,
      })) }
      const res = await api.updateYouthGroupPromotionLimits(selected, payload)
      setAgeRules(res?.age_rules || payload.age_rules)
      toast?.('تم حفظ حدود الترفيع الخاصة بالفرقة', 'success')
    } catch {
      toast?.('فشل حفظ حدود الترفيع', 'error')
    } finally {
      setSavingAgeRules(false)
    }
  }

  const onSaveParish = async () => {
    if (!selected) return
    if (!selectedParishId) {
      toast?.('يرجى اختيار الرعية', 'error')
      return
    }

    setSavingParish(true)
    try {
      const res = await api.updateYouthGroupParish(selected, {
        parish_id: selectedParishId,
        use_parish_logo: useParishLogo,
      })
      const savedParishId = String(res?.parish_id || selectedParishId)
      setSelectedParishId(savedParishId)
      setUseParishLogo(Boolean(res?.use_parish_logo))
      setDetails((prev) => {
        if (!prev?.group) return prev
        return {
          ...prev,
          group: {
            ...prev.group,
            parish_id: savedParishId,
            parish_name: res?.parish_name || prev.group.parish_name || null,
            parish_logo_url: res?.parish_logo_url || null,
            parish_lpj_url: res?.parish_lpj_url || null,
            parish_facebook_url: res?.parish_facebook_url || null,
            parish_instagram_url: res?.parish_instagram_url || null,
            parish_linkedin_url: res?.parish_linkedin_url || null,
            region: res?.region || null,
            governorate: res?.governorate || null,
            parish_churches: res?.parish_churches || [],
            use_parish_logo: Boolean(res?.use_parish_logo),
          },
        }
      })
      setLogoBust(Date.now())
      toast?.('تم حفظ الرعية التابعة للفرقة', 'success')
    } catch {
      toast?.('فشل حفظ الرعية التابعة للفرقة', 'error')
    } finally {
      setSavingParish(false)
    }
  }

  const onToggleUseParishLogo = async (nextValue) => {
    if (!selected) return

    const parishId = String(selectedParishId || group?.parish_id || '')
    if (!parishId) {
      toast?.('يرجى اختيار الرعية أولاً', 'error')
      return
    }

    setSavingParish(true)
    try {
      const res = await api.updateYouthGroupParish(selected, {
        parish_id: parishId,
        use_parish_logo: nextValue,
      })

      const savedParishId = String(res?.parish_id || parishId)
      const savedUseParishLogo = Boolean(res?.use_parish_logo)
      setSelectedParishId(savedParishId)
      setUseParishLogo(savedUseParishLogo)
      setDetails((prev) => {
        if (!prev?.group) return prev
        return {
          ...prev,
          group: {
            ...prev.group,
            parish_id: savedParishId,
            parish_name: res?.parish_name || prev.group.parish_name || null,
            parish_logo_url: res?.parish_logo_url || null,
            parish_lpj_url: res?.parish_lpj_url || null,
            parish_facebook_url: res?.parish_facebook_url || null,
            parish_instagram_url: res?.parish_instagram_url || null,
            parish_linkedin_url: res?.parish_linkedin_url || null,
            region: res?.region || null,
            governorate: res?.governorate || null,
            parish_churches: res?.parish_churches || [],
            use_parish_logo: savedUseParishLogo,
          },
        }
      })
      setLogoBust(Date.now())
      toast?.(savedUseParishLogo ? 'تم تفعيل توريث شعار الرعية مباشرة' : 'تم إيقاف توريث شعار الرعية', 'success')
    } catch {
      toast?.('تعذر تحديث إعداد الشعار', 'error')
    } finally {
      setSavingParish(false)
    }
  }

  const onSetSpecialLogoActive = async (specialLogoId, nextValue) => {
    if (!selected || !specialLogoId) return

    setSavingSpecialLogoSettings(true)
    setSavingSpecialLogoId(String(specialLogoId))
    try {
      const res = await api.updateYouthGroupSpecialLogoSettings(selected, {
        special_logo_active: nextValue,
        special_logo_id: specialLogoId,
      })

      const nextSpecialLogos = res?.special_logos || []
      setDetails((prev) => {
        if (!prev?.group) return prev
        return {
          ...prev,
          group: {
            ...prev.group,
            special_logo_active: Boolean(res?.special_logo_active),
            special_logo_url: res?.special_logo_url || null,
            active_special_logo_url: res?.active_special_logo_url || null,
            special_logo_occasion: String(res?.special_logo_occasion || ''),
            has_special_logo: Boolean(res?.has_special_logo),
            special_logos: nextSpecialLogos,
          },
        }
      })
      setLogoBust(Date.now())
      toast?.(nextValue ? 'تم تفعيل شعار المناسبة' : 'تم إيقاف تفعيل شعار المناسبة', 'success')
    } catch {
      toast?.('تعذر تحديث حالة شعار المناسبة', 'error')
    } finally {
      setSavingSpecialLogoSettings(false)
      setSavingSpecialLogoId('')
    }
  }

  const persistSocialMedia = async (entries, inheritFlag, successToast) => {
    if (!selected) return

    setSavingSocialMedia(true)
    try {
      const res = await api.updateYouthGroupSocialMedia(selected, {
        social_media: entries,
        inherit_parish_social_media: inheritFlag,
      })
      const nextSocial = Array.isArray(res?.social_media) ? res.social_media : entries
      const nextInherit = Boolean(res?.inherit_parish_social_media)
      setSocialMediaEntries(nextSocial)
      setInheritParishSocialMedia(nextInherit)
      setDetails((prev) => {
        if (!prev?.group) return prev
        return {
          ...prev,
          group: {
            ...prev.group,
            social_media: nextSocial,
            parish_social_media: Array.isArray(res?.parish_social_media) ? res.parish_social_media : (prev.group.parish_social_media || []),
            effective_social_media: Array.isArray(res?.effective_social_media) ? res.effective_social_media : nextSocial,
            inherit_parish_social_media: nextInherit,
          },
        }
      })
      if (successToast) toast?.(successToast, 'success')
    } catch {
      toast?.('تعذر حفظ روابط التواصل الخاصة بالفرقة', 'error')
    } finally {
      setSavingSocialMedia(false)
    }
  }

  const onAddSocialMedia = async () => {
    const normalizedUrl = normalizeUrlInput(socialUrl)
    if (!normalizedUrl) {
      toast?.('يرجى إدخال رابط منصة التواصل', 'error')
      return
    }

    const nextEntries = [
      ...socialMediaEntries,
      {
        platform: socialPlatform,
        url: normalizedUrl,
        age_groups: socialAgeGroups,
      },
    ]

    await persistSocialMedia(nextEntries, inheritParishSocialMedia, 'تمت إضافة رابط التواصل')
    setSocialPlatform('facebook')
    setSocialUrl('')
    setSocialAgeGroups([])
  }

  const onRemoveSocialMedia = async (entryId) => {
    const nextEntries = socialMediaEntries.filter((row) => socialMediaItemId(row) !== String(entryId || ''))
    await persistSocialMedia(nextEntries, inheritParishSocialMedia, 'تم حذف رابط التواصل')
  }

  const onToggleInheritParishSocialMedia = async (nextValue) => {
    await persistSocialMedia(socialMediaEntries, nextValue, nextValue ? 'تم تفعيل توريث روابط الرعية' : 'تم إيقاف توريث روابط الرعية')
  }

  const onToggleSocialAgeGroup = (ageGroup, checked) => {
    setSocialAgeGroups((prev) => {
      const set = new Set(prev)
      if (checked) set.add(ageGroup)
      else set.delete(ageGroup)
      return AGE_GROUPS.filter((g) => set.has(g))
    })
  }

  if (loadingGroups) {
    return (
      <LoadingState
        title="جارٍ تحميل فرق الشبيبة"
        description="يتم تجهيز ملفات الفرق وبياناتها الآن."
        minHeight={320}
      />
    )
  }

  if (groupsLoadError) {
    return (
      <ErrorState
        title="تعذر تحميل فرق الشبيبة"
        description={groupsLoadError}
        onRetry={() => setReloadKey((value) => value + 1)}
        minHeight={320}
      />
    )
  }

  const shouldShowGroupLogo = useParishLogo ? Boolean(group?.parish_logo_url) : Boolean(group?.has_logo)
  const shouldShowActiveSpecialLogo = Boolean(group?.special_logo_active && group?.active_special_logo_url)
  const tabs = [
    { id: 'dashboard', label: 'لوحة التحكم' },
    { id: 'social', label: 'وسائل التواصل' },
    { id: 'logos', label: 'الشعارات' },
    { id: 'members', label: 'الأعضاء والبيانات' },
  ]

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1rem' }}>ملف فرقة الشبيبة</div>
        <div style={{ color: 'var(--gray-500)', fontSize: '0.86rem' }}>
          يعرض كل المعلومات الخاصة بالفرقة المختارة، مع إمكانية رفع شعار خاص بها ليظهر لأعضائها عند تسجيل الدخول.
        </div>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            border: '1.5px solid var(--gray-200)',
            borderRadius: 10,
            padding: '10px 12px',
            fontFamily: 'var(--font-body)',
            fontSize: '0.9rem',
            background: 'white',
          }}
        >
          {groups.map(g => (
            <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
          ))}
        </select>
      </div>

      {loadingDetails ? (
        <LoadingState
          title="جارٍ تحميل تفاصيل الفرقة"
          description="يتم تجهيز بيانات الفرقة المختارة الآن."
          minHeight={260}
        />
      ) : detailsLoadError ? (
        <ErrorState
          title="تعذر تحميل تفاصيل الفرقة"
          description={detailsLoadError}
          onRetry={() => setReloadKey((value) => value + 1)}
          minHeight={260}
        />
      ) : !group ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-500)' }}>
          لا توجد بيانات متاحة لهذه الفرقة.
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`btn btn-sm ${isActive ? 'btn-gold' : 'btn-light'}`}
                    onClick={() => setActiveTab(tab.id)}
                    style={{ minWidth: 140 }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>

          {activeTab === 'dashboard' ? (
            <>
          <div className="card" style={{ padding: 16, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              {shouldShowGroupLogo ? (
                <img
                  src={api.youthGroupLogoUrl(group.group_id, logoBust)}
                  alt={group.group_name || 'Youth Group Logo'}
                  style={{ width: 112, height: 112, borderRadius: 14, objectFit: 'contain', border: '1px solid var(--gray-200)', background: 'var(--gray-50)' }}
                  onError={(e) => {
                    // In case the image was removed, hide broken image and keep neutral placeholder behavior.
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: 14,
                    border: '1px dashed var(--gray-300)',
                    background: 'var(--gray-50)',
                    color: 'var(--gray-500)',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: 8,
                  }}
                >
                  لا يوجد شعار
                </div>
              )}

              {shouldShowActiveSpecialLogo ? (
                <img
                  src={api.youthGroupSpecialLogoUrl(group.group_id, logoBust)}
                  alt={group.group_name ? `Special Logo - ${group.group_name}` : 'Special Occasion Logo'}
                  style={{ width: 112, height: 112, borderRadius: 14, objectFit: 'contain', border: '1px solid var(--gray-200)', background: 'var(--gray-50)' }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : null}
            </div>
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: '1.02rem', color: 'var(--navy)', fontWeight: 800 }}>{group.group_name}</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem' }}>الشفيع: {group.patron || '—'}</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem' }}>الاسم المختصر: {group.short_name || '—'}</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem' }}>الإقليم: {group.region || '—'}</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem' }}>المحافظة: {group.governorate || '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  {effectiveSocialMedia.map((item) => {
                    const platform = String(item?.platform || '').toLowerCase()
                    const url = String(item?.url || '').trim()
                    if (!url) return null
                    const groupsText = Array.isArray(item?.age_groups) && item.age_groups.length > 0
                      ? item.age_groups.join('، ')
                      : 'جميع الفئات'
                    const sourceText = item?.source === 'parish' ? ' (موروث من الرعية)' : ''
                    const title = `${socialPlatformLabel(platform)}${sourceText} - ${groupsText}`
                    const itemId = socialMediaItemId(item)
                    return (
                      <a
                        key={`${itemId || `${platform}-${url}`}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={title}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          border: '1px solid var(--gray-200)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: socialPlatformColor(platform),
                          textDecoration: 'none',
                          background: 'white',
                        }}
                      >
                        <SocialIcon platform={platform} size={14} />
                      </a>
                    )
                  })}
                </div>
                <label className="btn btn-gold btn-sm" style={{ width: 'fit-content', marginTop: 4, cursor: logoUploading ? 'wait' : 'pointer' }}>
                  <Upload size={14} /> {logoUploading ? 'جاري الرفع...' : useParishLogo ? 'رفع شعار الرعية' : 'رفع شعار الفرقة'}
                  <input type="file" accept="image/*" onChange={onUploadLogo} style={{ display: 'none' }} disabled={logoUploading} />
                </label>
                <label
                  style={{
                    width: 'fit-content',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--gray-600)',
                    fontSize: '0.82rem',
                    cursor: logoUploading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useParishLogo}
                    onChange={(e) => onToggleUseParishLogo(e.target.checked)}
                    disabled={logoUploading || savingParish}
                  />
                  استخدام شعار الرعية بدلاً من شعار الفرقة
                </label>
              </div>

              <div style={{ display: 'grid', gap: 8, border: '1px solid var(--gray-200)', borderRadius: 10, padding: 10, background: 'var(--gray-50)' }}>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem' }}>الرعية التابعة</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={selectedParishId}
                    onChange={(e) => setSelectedParishId(e.target.value)}
                    style={{
                      flex: 1,
                      border: '1px solid var(--gray-200)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontFamily: 'var(--font-body)',
                      background: 'white',
                    }}
                  >
                    <option value="">اختر الرعية</option>
                    {parishes.map((p) => (
                      <option key={p.id} value={p.id}>{p.name || p.patron_saint}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    onClick={onSaveParish}
                    disabled={
                      savingParish
                      || !selectedParishId
                      || (selectedParishId === String(group.parish_id || '') && useParishLogo === currentUseParishLogo)
                    }
                  >
                    {savingParish ? 'جاري الحفظ...' : 'حفظ'}
                  </button>
                </div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem', marginTop: 2 }}>معلومات الرعية</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {group.parish_logo_url ? (
                    <img
                      src={group.parish_logo_url}
                      alt={group.parish_name ? `Parish Logo - ${group.parish_name}` : 'Parish Logo'}
                      style={{ width: 42, height: 42, borderRadius: 10, objectFit: 'contain', border: '1px solid var(--gray-200)', background: 'white' }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 10,
                        border: '1px dashed var(--gray-300)',
                        background: 'white',
                        color: 'var(--gray-500)',
                        fontSize: '0.66rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        padding: 4,
                      }}
                      title="لا يوجد شعار للرعية"
                    >
                      بدون شعار
                    </div>
                  )}
                  {currentParishName ? (
                    <div style={{ color: 'var(--gray-600)', fontSize: '0.8rem' }}>{currentParishName}</div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {group.parish_lpj_url && (
                    <a href={group.parish_lpj_url} target="_blank" rel="noreferrer" className="btn btn-light btn-sm" style={{ textDecoration: 'none' }}>
                      <Globe size={14} /> LPJ
                    </a>
                  )}
                  {group.parish_facebook_url && (
                    <a href={group.parish_facebook_url} target="_blank" rel="noreferrer" className="btn btn-light btn-sm" style={{ textDecoration: 'none' }}>
                      <Facebook size={14} /> Facebook
                    </a>
                  )}
                  {group.parish_instagram_url && (
                    <a href={group.parish_instagram_url} target="_blank" rel="noreferrer" className="btn btn-light btn-sm" style={{ textDecoration: 'none' }}>
                      <Instagram size={14} /> Instagram
                    </a>
                  )}
                  {!group.parish_lpj_url && !group.parish_facebook_url && !group.parish_instagram_url && (
                    <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem' }}>لا توجد روابط تواصل اجتماعي للرعية.</div>
                  )}
                </div>

                <div style={{ color: 'var(--gray-500)', fontSize: '0.87rem', marginTop: 2 }}>كنائس الرعية ومواقعها</div>
                {parishChurches.length === 0 ? (
                  <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem' }}>لا توجد كنائس مرتبطة بهذه الرعية.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6, maxHeight: 170, overflowY: 'auto', paddingRight: 2 }}>
                    {parishChurches.map((church) => (
                      <div key={church.id || church.name} style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 10px', background: 'white' }}>
                        <div style={{ color: 'var(--gray-700)', fontWeight: 700, fontSize: '0.82rem' }}>
                          {church.name || '—'}
                        </div>
                        <div style={{ color: 'var(--gray-500)', fontSize: '0.77rem', marginTop: 2 }}>
                          الموقع: {church.area || '—'}
                          {googleMapsLink(church.lat, church.lng) ? (
                            <>
                              {' · '}
                              <a
                                href={googleMapsLink(church.lat, church.lng)}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: 'var(--navy)', textDecoration: 'underline' }}
                              >
                                Google Maps
                              </a>
                            </>
                          ) : (
                            ' · لا يوجد رابط Google Maps'
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
            </>
          ) : null}

          {activeTab === 'dashboard' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <Stat icon={Users} label="إجمالي الأعضاء" value={stats.members_total} />
                <Stat icon={ShieldEllipsis} label="أعضاء مسجلون" value={stats.registered_total} />
                <Stat icon={UserRound} label="أعضاء غير مسجلين" value={stats.unregistered_total} />
                <Stat icon={CalendarDays} label="عدد الفترات التنظيمية" value={stats.periods_total} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ color: 'var(--gray-700)', fontWeight: 800, marginBottom: 10, fontSize: '0.9rem' }}>توزيع الفئات العمرية</div>
                  <AgeBreakdownChart items={ageBreakdown} />
                </div>

                <div className="card" style={{ padding: 14 }}>
                  <div style={{ color: 'var(--gray-700)', fontWeight: 800, marginBottom: 10, fontSize: '0.9rem' }}>حالة التسجيل</div>
                  <RegistrationDonutChart
                    registered={registrationChartCounts.registered}
                    unregistered={registrationChartCounts.unregistered}
                    archived={registrationChartCounts.archived}
                  />
                </div>
              </div>
            </>
          ) : null}

          {activeTab === 'social' ? (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ color: 'var(--gray-700)', fontSize: '0.92rem', fontWeight: 800, marginBottom: 10 }}>وسائل تواصل الفرقة</div>
            <div style={{ display: 'grid', gap: 10, maxWidth: 860 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gray-600)', fontSize: '0.84rem' }}>
                <input
                  type="checkbox"
                  checked={inheritParishSocialMedia}
                  onChange={(e) => onToggleInheritParishSocialMedia(e.target.checked)}
                  disabled={savingSocialMedia || !linkedParishId}
                />
                توريث وسائل تواصل الرعية المرتبطة ({linkedParishId || 'بدون رعية'})
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 8 }}>
                <select
                  value={socialPlatform}
                  onChange={(e) => setSocialPlatform(e.target.value)}
                  style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', background: 'white' }}
                  disabled={savingSocialMedia}
                >
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
                <input
                  type="text"
                  value={socialUrl}
                  onChange={(e) => setSocialUrl(e.target.value)}
                  placeholder="https://..."
                  style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', background: 'white' }}
                  disabled={savingSocialMedia}
                />
              </div>

              <div style={{ color: 'var(--gray-600)', fontSize: '0.78rem' }}>الفئات العمرية: اتركها بدون اختيار ليظهر الرابط لكل الفئات.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {AGE_GROUPS.map((ageGroup) => (
                  <label key={ageGroup} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--gray-600)' }}>
                    <input
                      type="checkbox"
                      checked={socialAgeGroups.includes(ageGroup)}
                      onChange={(e) => onToggleSocialAgeGroup(ageGroup, e.target.checked)}
                      disabled={savingSocialMedia}
                    />
                    {ageGroup}
                  </label>
                ))}
              </div>

              <div>
                <button
                  type="button"
                  className="btn btn-light btn-sm"
                  onClick={onAddSocialMedia}
                  disabled={savingSocialMedia}
                >
                  {savingSocialMedia ? 'جاري الحفظ...' : 'إضافة رابط'}
                </button>
              </div>

              {socialMediaEntries.length === 0 ? (
                <div style={{ color: 'var(--gray-500)', fontSize: '0.82rem' }}>لا توجد روابط خاصة بالفرقة حالياً.</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {socialMediaEntries.map((item) => {
                    const platform = String(item?.platform || '').toLowerCase()
                    const ageLabel = Array.isArray(item?.age_groups) && item.age_groups.length > 0
                      ? item.age_groups.join('، ')
                      : 'كل الفئات'
                    const itemId = socialMediaItemId(item)
                    return (
                      <div key={itemId || `${platform}-${item?.url || ''}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '6px 8px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 8, background: 'white' }}>
                        <span style={{ color: socialPlatformColor(platform), display: 'inline-flex', alignItems: 'center' }}>
                          <SocialIcon platform={platform} size={14} />
                        </span>
                        <div style={{ display: 'grid', gap: 2 }}>
                          <a href={item?.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontSize: '0.8rem', textDecoration: 'underline', wordBreak: 'break-all' }}>
                            {socialPlatformLabel(platform)}
                          </a>
                          <div style={{ color: 'var(--gray-500)', fontSize: '0.74rem' }}>{ageLabel}</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onRemoveSocialMedia(itemId)}
                          disabled={savingSocialMedia}
                        >
                          حذف
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          ) : null}

          {activeTab === 'logos' ? (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>شعارات المناسبات الخاصة</div>
            <div style={{ color: 'var(--gray-500)', fontSize: '0.82rem', marginBottom: 12 }}>
              يمكن رفع أكثر من شعار مناسبة لنفس الفرقة. يسمح النظام بتفعيل شعار واحد فقط في نفس الوقت.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 10, background: 'var(--gray-50)', display: 'grid', gap: 8, alignContent: 'start' }}>
                <div style={{ color: 'var(--gray-700)', fontWeight: 700, fontSize: '0.86rem' }}>رفع شعار مناسبة جديدة</div>
                <input
                  type="text"
                  value={specialLogoOccasion}
                  onChange={(e) => setSpecialLogoOccasion(e.target.value)}
                  placeholder="اسم المناسبة"
                  style={{
                    border: '1px solid var(--gray-200)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontFamily: 'var(--font-body)',
                    background: 'white',
                  }}
                  disabled={specialLogoUploading}
                />
                <input
                  type="date"
                  value={specialLogoStartDate}
                  onChange={(e) => setSpecialLogoStartDate(e.target.value)}
                  style={{
                    border: '1px solid var(--gray-200)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontFamily: 'var(--font-body)',
                    background: 'white',
                  }}
                  disabled={specialLogoUploading}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gray-600)', fontSize: '0.82rem' }}>
                  <input
                    type="checkbox"
                    checked={specialLogoIsCurrent}
                    onChange={(e) => {
                      const nextValue = e.target.checked
                      setSpecialLogoIsCurrent(nextValue)
                      if (nextValue) setSpecialLogoEndDate('')
                    }}
                    disabled={specialLogoUploading}
                  />
                  مناسبة حالية (يتم تفعيل الشعار مباشرة)
                </label>
                {!specialLogoIsCurrent ? (
                  <input
                    type="date"
                    value={specialLogoEndDate}
                    onChange={(e) => setSpecialLogoEndDate(e.target.value)}
                    style={{
                      border: '1px solid var(--gray-200)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontFamily: 'var(--font-body)',
                      background: 'white',
                    }}
                    disabled={specialLogoUploading}
                  />
                ) : null}
                <label className="btn btn-light btn-sm" style={{ width: 'fit-content', marginTop: 2, cursor: specialLogoUploading ? 'wait' : 'pointer' }}>
                  <Upload size={14} /> {specialLogoUploading ? 'جاري رفع شعار المناسبة...' : 'رفع شعار المناسبة'}
                  <input type="file" accept="image/*" onChange={onUploadSpecialLogo} style={{ display: 'none' }} disabled={specialLogoUploading} />
                </label>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.76rem' }}>
                  تاريخ البداية مطلوب. تاريخ النهاية مطلوب فقط عندما لا تكون المناسبة حالية.
                </div>
              </div>

              <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 10, background: 'white' }}>
                <div style={{ color: 'var(--gray-700)', fontWeight: 700, fontSize: '0.86rem', marginBottom: 8 }}>سجل شعارات المناسبات</div>
                {specialLogos.length === 0 ? (
                  <div style={{ color: 'var(--gray-500)', fontSize: '0.82rem' }}>لا توجد شعارات مناسبات مرفوعة بعد.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto', paddingRight: 2 }}>
                    {specialLogos.map((item) => {
                      const isActive = Boolean(item?.is_active)
                      const itemId = String(item?.id || '')
                      const itemOccasion = String(item?.occasion || 'مناسبة بدون اسم')
                      const fromDate = String(item?.start_date || '—')
                      const toDate = String(item?.end_date || 'مستمر')
                      const isSavingThisItem = savingSpecialLogoSettings && savingSpecialLogoId === itemId
                      return (
                        <div key={itemId || `${itemOccasion}-${fromDate}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 8, display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 10, alignItems: 'center', background: isActive ? 'var(--gray-50)' : 'white' }}>
                          <img
                            src={api.youthGroupSpecialLogoByIdUrl(group.group_id, itemId, logoBust)}
                            alt={itemOccasion}
                            style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'contain', border: '1px solid var(--gray-200)', background: 'white' }}
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                          />
                          <div style={{ display: 'grid', gap: 3 }}>
                            <div style={{ color: 'var(--gray-700)', fontWeight: 700, fontSize: '0.84rem' }}>{itemOccasion}</div>
                            <div style={{ color: 'var(--gray-500)', fontSize: '0.76rem' }}>من {fromDate} إلى {toDate}</div>
                            <div style={{ color: isActive ? '#166534' : 'var(--gray-500)', fontSize: '0.74rem' }}>
                              {isActive ? 'مفعل حاليا' : 'غير مفعل'}
                            </div>
                          </div>
                          <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                            {!isActive ? (
                              <button
                                type="button"
                                className="btn btn-light btn-sm"
                                onClick={() => onSetSpecialLogoActive(itemId, true)}
                                disabled={savingSpecialLogoSettings || specialLogoUploading}
                              >
                                {isSavingThisItem ? 'جاري التفعيل...' : 'تفعيل'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-light btn-sm"
                                onClick={() => onSetSpecialLogoActive(itemId, false)}
                                disabled={savingSpecialLogoSettings || specialLogoUploading}
                              >
                                {isSavingThisItem ? 'جاري الإيقاف...' : 'إيقاف'}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : null}

          {activeTab === 'members' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 10 }}>أعضاء الفرقة</div>
              <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--gray-200)', borderRadius: 10 }}>
                {members.length === 0 ? (
                  <div style={{ padding: 16, color: 'var(--gray-500)' }}>لا يوجد أعضاء حالياً.</div>
                ) : (
                  members.map((m) => (
                    <div key={`${m.person_type}:${m.person_id}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--gray-100)' }}>
                      <div>
                        <div style={{ color: 'var(--gray-700)', fontWeight: 700 }}>{m.full_name}</div>
                        <div style={{ color: 'var(--gray-500)', fontSize: '0.77rem' }}>{m.person_type === 'registered' ? 'مسجل' : 'غير مسجل'} · {m.gender || '—'}</div>
                      </div>
                      <div style={{ color: 'var(--gray-600)', fontSize: '0.82rem' }}>{m.age_group || '—'}</div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.82rem' }}>{m.youth_join_year || '—'}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 10 }}>توزيع الفئات العمرية</div>
                {ageBreakdown.length === 0 ? (
                  <div style={{ color: 'var(--gray-500)' }}>لا توجد بيانات.</div>
                ) : (
                  ageBreakdown.map((item) => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <span style={{ color: 'var(--gray-700)' }}>{item.label}</span>
                      <span style={{ color: 'var(--navy)', fontWeight: 800 }}>{item.count}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>بيانات قد تكون بحاجة مراجعة</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem', marginBottom: 10 }}>
                  يتم عرض الأعضاء الذين لديهم أجزاء اسم ناقصة، أو مدرسة مفقودة لفئات البراعم/الإعدادي/الثانوي.
                </div>
                {problematic.length === 0 ? (
                  <div style={{ color: 'var(--gray-500)' }}>لا توجد ملاحظات حالياً.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                    {problematic.map((row) => (
                      <div key={`${row.person_type}:${row.person_id}`} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 10 }}>
                        <div style={{ color: 'var(--gray-700)', fontWeight: 700 }}>
                          {row.full_name || row.person_id}
                        </div>
                        <div style={{ color: 'var(--gray-500)', fontSize: '0.78rem', marginTop: 2 }}>
                          {row.person_type === 'registered' ? 'مسجل' : 'غير مسجل'} · {row.age_group || '—'}
                        </div>
                        <div style={{ color: '#b45309', fontSize: '0.8rem', marginTop: 6 }}>
                          {(row.issues || []).join(' | ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>حدود الترفيع حسب الفرقة</div>
                <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem', marginBottom: 10 }}>
                  يتم فحص كل عضو حسب سنة الميلاد والفئة الحالية. هذه الحدود تخص الفرقة الحالية فقط.
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {uiAgeRules.map((rule) => {
                    const defaultRule = (defaultAgeRules || []).find(r => r.age_group === rule.age_group) || {}
                    return (
                      <div key={rule.age_group} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <div style={{ color: 'var(--gray-700)', fontWeight: 700 }}>{rule.age_group}</div>
                          <div style={{ color: 'var(--gray-500)', fontSize: '0.75rem' }}>
                            الافتراضي: {defaultRule.min_birth_year ?? '—'} / {defaultRule.max_birth_year ?? '—'}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <input
                            type="number"
                            placeholder="أصغر سنة"
                            value={rule.min_birth_year ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value.trim()
                              updateRule(rule.age_group, 'min_birth_year', raw === '' ? null : Number(raw))
                            }}
                            style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)' }}
                          />
                          <input
                            type="number"
                            placeholder="أكبر سنة"
                            value={rule.max_birth_year ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value.trim()
                              updateRule(rule.age_group, 'max_birth_year', raw === '' ? null : Number(raw))
                            }}
                            style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)' }}
                          />
                        </div>
                        <select
                          value={rule.promotion_to || ''}
                          onChange={(e) => updateRule(rule.age_group, 'promotion_to', e.target.value || null)}
                          style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font-body)', background: 'white' }}
                        >
                          <option value="">بدون ترفيع تلقائي</option>
                          {AGE_GROUPS.filter(g => g !== rule.age_group).map((g) => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn btn-light btn-sm" onClick={onResetAgeRules} disabled={savingAgeRules}>
                    إعادة القيم الافتراضية
                  </button>
                  <button type="button" className="btn btn-gold btn-sm" onClick={onSaveAgeRules} disabled={savingAgeRules}>
                    {savingAgeRules ? 'جاري الحفظ...' : 'حفظ الحدود'}
                  </button>
                </div>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 10 }}>الفترات التنظيمية</div>
                {periods.length === 0 ? (
                  <div style={{ color: 'var(--gray-500)' }}>لا توجد فترات بعد.</div>
                ) : (
                  periods.map((p) => (
                    <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ color: 'var(--gray-700)', fontWeight: 700 }}>{p.jec_year || '—'}</div>
                      <div style={{ color: 'var(--gray-500)', fontSize: '0.8rem' }}>{p.from_date || '—'} → {p.to_date || 'مستمرة'}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          ) : null}
        </>
      )}
    </div>
  )
}
