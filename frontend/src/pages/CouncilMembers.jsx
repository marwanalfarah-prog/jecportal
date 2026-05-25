import { useEffect, useState, useMemo, useCallback } from 'react'
import { Search, Users, UserCheck, ArrowUpCircle, CheckCircle, XCircle, RefreshCw, Clock, ChevronLeft, ChevronRight, Trash2, Archive } from 'lucide-react'
import { api } from '../api.js'
import { ErrorState, LoadingState } from '../pageStates.jsx'

// ── Arabic helpers ────────────────────────────────────────────────────────────
function normalizeWord(w) {
  return String(w)
    .replace(/[\u0617-\u061A\u064B-\u0652]/g,'').replace(/\u0640/g,'')
    .replace(/[إأآا]/g,'ا').replace(/[يى]/g,'ي').replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/^ال/,'')
    .toLowerCase().trim()
}
function normalizeArabic(t) {
  if (!t) return ''
  return String(t).replace(/\s+/g,' ').trim().split(' ').map(normalizeWord).join(' ')
}

function normalizeNameVariations(raw) {
  const out = {}
  if (!raw) return out

  const entries = []
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      entries.push([row.name, row.variations])
    }
  } else if (typeof raw === 'object') {
    for (const [base, variations] of Object.entries(raw)) entries.push([base, variations])
  }

  for (const [baseRaw, variationsRaw] of entries) {
    const base = normalizeArabic(baseRaw)
    if (!base) continue
    const source = Array.isArray(variationsRaw) ? variationsRaw : (typeof variationsRaw === 'string' ? [variationsRaw] : [])
    const values = [...new Set(source.map(v => normalizeArabic(v)).filter(v => v && v !== base))]
    out[base] = values
  }

  return out
}

function buildNameAliasLookup(variationMap) {
  const map = new Map()
  const ensure = (word) => {
    if (!map.has(word)) map.set(word, new Set([word]))
    return map.get(word)
  }

  for (const [base, vars] of Object.entries(variationMap || {})) {
    if (!base) continue
    const baseSet = ensure(base)
    for (const v of vars || []) {
      if (!v) continue
      baseSet.add(v)
      const vSet = ensure(v)
      vSet.add(base)
      for (const sibling of vars || []) {
        if (sibling) vSet.add(sibling)
      }
    }
  }
  return map
}

function expandQueryWords(words, aliasLookup) {
  return words.map((w) => {
    const expanded = new Set([w])

    const exact = aliasLookup.get(w)
    if (exact && exact.size) {
      exact.forEach(v => expanded.add(v))
    }

    for (const [key, values] of aliasLookup.entries()) {
      if (!key || !values?.size) continue
      if (key.includes(w) || w.includes(key)) {
        values.forEach(v => expanded.add(v))
      }
    }

    return [...expanded]
  })
}

function nameMatches(parts, qWordGroups) {
  if (!qWordGroups.length) return true
  const partMatches = (part, alternatives) => alternatives.some(alt => part.includes(alt))

  if (qWordGroups.every(group => parts.some(p => partMatches(p, group)))) return true
  let pi=0,qi=0
  while(pi<parts.length&&qi<qWordGroups.length){if(partMatches(parts[pi],qWordGroups[qi]))qi++;pi++}
  return qi===qWordGroups.length
}
function getNameParts(p) {
  return [p.ar_first_name,p.ar_second_name,p.ar_third_name,p.ar_last_name].filter(Boolean).map(normalizeArabic)
}
function fullName(p) {
  return [p.ar_first_name,p.ar_second_name,p.ar_third_name,p.ar_last_name].filter(Boolean).join(' ')
}

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
}

// ── Age group config ──────────────────────────────────────────────────────────
const AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

const CURRENT_YEAR = new Date().getFullYear()

// Returns the age group a birth year SHOULD be in (pass currentAg for context)
function expectedAgeGroup(birthYear, currentAg) {
  if (!birthYear) return null
  const by = parseInt(birthYear)
  if (isNaN(by)) return null
  if (by >= 2015)         return 'البراعم'
  if (by >= 2012)         return 'الإعدادي'
  if (by >= 2008)         return 'الثانوي'
  if (by <= 2007) {
    // If currently in الثانوي, they've aged out → promote to الجامعيّة
    if (currentAg === 'الثانوي') return 'الجامعيّة'
    return null  // جامعيّة or عاملة — both valid, no forced promotion
  }
  return null
}

// Human-readable birth year range for each age group
const AG_RANGES = {
  'البراعم':  `2015 – ${CURRENT_YEAR}`,
  'الإعدادي': '2012 – 2014',
  'الثانوي':  '2008 – 2011',
  'الجامعيّة':'2007 وما قبل',
  'العاملة':  '2007 وما قبل',
}

const AG_COLORS = {
  'البراعم':   { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  'الإعدادي':  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  'الثانوي':   { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  'الجامعيّة': { bg: '#fdf4ff', text: '#7e22ce', border: '#e9d5ff' },
  'العاملة':   { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
}

function AgeBadge({ group, size = 'sm' }) {
  const c = AG_COLORS[group] || { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' }
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'lg' ? '4px 14px' : '2px 10px',
      borderRadius: 20,
      fontSize: size === 'lg' ? '0.82rem' : '0.74rem',
      fontWeight: 700,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>{group}</span>
  )
}

function StatusBadge({ status }) {
  const cfg = {
    pending:  { bg: '#fffbeb', text: '#92400e', border: '#fde68a', label: 'بانتظار الموافقة', icon: <Clock size={11}/> },
    approved: { bg: '#e8f8f0', text: '#1a7a45', border: '#a7f3d0', label: 'تمّ الترفيع',      icon: <CheckCircle size={11}/> },
    rejected: { bg: '#fdecea', text: '#c62828', border: '#ef9a9a', label: 'مرفوض',              icon: <XCircle size={11}/> },
  }
  const c = cfg[status] || cfg.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20, fontSize: '0.74rem', fontWeight: 700,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>{c.icon}{c.label}</span>
  )
}

// ── Reusable avatar cell ──────────────────────────────────────────────────────
function Avatar({ pid, isUnreg, name }) {
  const [err, setErr] = useState(false)
  const photo = isUnreg ? api.unregisteredPhotoUrl(pid) : api.photoUrl(pid)
  const initials = firstNameInitial(name)
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: '#0f2744', display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: isUnreg ? '2px dashed #e8b55a' : '2px solid #e2e6ef',
    }}>
      {!err
        ? <img src={photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={() => setErr(true)}/>
        : <span style={{ color:'white', fontSize:'0.7rem', fontWeight:700 }}>{initials}</span>
      }
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
function TabBar({ active, onChange, tabs }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e6ef', marginBottom: 20 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: '10px 18px', border: 'none', background: 'none',
          fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: active === t.id ? 700 : 500,
          color: active === t.id ? '#0f2744' : '#6b778f',
          borderBottom: active === t.id ? '2px solid #0f2744' : '2px solid transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, transition: '0.15s',
          marginBottom: -1,
        }}>
          {t.icon}
          {t.label}
          {t.count != null && (
            <span style={{
              background: active === t.id ? '#0f2744' : '#e2e6ef',
              color: active === t.id ? 'white' : '#6b778f',
              borderRadius: 20, padding: '1px 8px', fontSize: '0.72rem', fontWeight: 700,
            }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Adult data modal — shown when approving ثانوي→جامعيّة ────────────────────
const UNIVERSITY_OPTIONS = [
  'لم أدرس في الجامعة أو الكليّة',
  'الجامعة الأردنيّة','جامعة اليرموك','جامعة مؤتة',
  'جامعة العلوم والتكنولوجيا الأردنيّة','جامعة آل البيت',
  'الجامعة الهاشميّة','جامعة البلقاء التطبيقيّة',
  'جامعة الحسين بن طلال','جامعة الطفيلة التقنيّة',
  'الجامعة الألمانيّة الأردنيّة','الجامعة الأردنيّة - فرع العقبة',
  'جامعة عمان الأهليّة','جامعة فيلادلفيا',
  'جامعة الأميرة سميّة للتكنولوجيا','جامعة الإسراء','جامعة البترا',
  'جامعة العلوم التطبيقيّة الخاصة','جامعة جرش',
  'جامعة الزيتونة الأردنيّة','جامعة الزرقاء','جامعة إربد الأهليّة',
  'جامعة عمان العربيّة','الجامعة العربيّة المفتوحة - فرع الأردن',
  'الجامعة الأمريكيّة في مادبا','جامعة جدارا','جامعة الشّرق الأوسط',
  'جامعة عجلون الوطنيّة','جامعة العقبة للتكنولوجيا',
  'جامعة الحسين التقنيّة','كلية عمون الجامعيّة التطبيقيّة',
  'الأكاديميّة الأردنيّة للموسيقى',
]

const HOBBIES_ADULT = [
  'العزف','الغناء','الترتيل','الرياضة','التصوير الفوتوغرافي',
  'التصميم الجرافيكي','التمثيل','الإخراج (السينمائي/ المسرحي)',
  'تصوير فيديو','كتابة نصوص','التصميم الداخلي/ ديكور','مونتاج فيديو',
  'رسوم متحركة Animation','الرسم','القراءة','مهارات التواصل',
  'مهارات إداريّة','مهارات العمل الجماعي','مهارات التخطيط',
  'تحضير الألعاب','التنظيم لأعمال تطوعيّة',
  'أجهزة الصوت (صوتيّات ومِكسرات)','أشغال يدويّة',
  'الدبكة والرقصات الفولكلوريّة','تأدية حركات التراتيل',
]

function AdultDataModal({ onConfirm, onCancel, youthGroup }) {
  const sanitizeDateInput = (value) => {
    const text = String(value || '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
  }
  const [university,     setUniversity]     = useState('')
  const [universityOther,setUniversityOther]= useState('')
  const [major,          setMajor]          = useState('')
  const [jobTitle,       setJobTitle]       = useState('')
  const [company,        setCompany]        = useState('')
  const [hasResp,        setHasResp]        = useState('')
  const [respText,       setRespText]       = useState('')
  const [respJecYear,    setRespJecYear]    = useState('')
  const [respIsCurrent,  setRespIsCurrent]  = useState('حاليًّا')
  const [respStartDate,  setRespStartDate]  = useState('')
  const [respEndDate,    setRespEndDate]    = useState('')
  const [hobbies,        setHobbies]        = useState([])
  const [hobbiesOther,   setHobbiesOther]   = useState('')
  const [errors,         setErrors]         = useState({})
  const [uniSearch,      setUniSearch]      = useState('')
  const [uniOpen,        setUniOpen]        = useState(false)
  const uniRef = useState(null)[0]

  const toggleHobby = h => setHobbies(prev => prev.includes(h) ? prev.filter(x=>x!==h) : [...prev,h])

  const validate = () => {
    const e = {}
    const uni = university === 'أخرى' ? universityOther : university
    if (!uni.trim())           e.university = 'هذا الحقل مطلوب'
    if (!jobTitle.trim())      e.job_title  = 'هذا الحقل مطلوب'
    if (!company.trim())       e.company    = 'هذا الحقل مطلوب'
    if (!hasResp)              e.has_resp   = 'هذا الحقل مطلوب'
    if (hasResp === 'نعم' && !respText.trim()) e.resp_text = 'هذا الحقل مطلوب'
    if (hasResp === 'نعم' && !/^\d{4}$/.test(respJecYear.trim())) e.resp_jec_year = 'أدخل سنة JEC صحيحة'
    const startDate = sanitizeDateInput(respStartDate)
    const endDate = sanitizeDateInput(respEndDate)
    if (startDate && endDate && endDate < startDate) e.resp_end_date = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
    const allH = [...hobbies, ...(hobbiesOther.trim() ? [hobbiesOther.trim()] : [])]
    if (!allH.length)          e.hobbies    = 'يرجى اختيار هواية واحدة على الأقل'
    return e
  }

  const handleConfirm = () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }

    const uni = university === 'أخرى' ? universityOther : university
    const allH = [...hobbies, ...(hobbiesOther.trim() ? [hobbiesOther.trim()] : [])]
    const responsibilities = hasResp === 'نعم'
      ? [{ youth_group_id: youthGroup, responsibility: respText, jec_year: /^\d{4}$/.test(respJecYear.trim()) ? parseInt(respJecYear.trim(), 10) : null, is_current: respIsCurrent === 'حاليًّا', start_date: sanitizeDateInput(respStartDate) || null, end_date: sanitizeDateInput(respEndDate) || null }]
      : []

    const extraData = {
      higher_education: (uni && uni !== 'لم أدرس في الجامعة أو الكليّة')
        ? [{ university_college: uni, major: major.trim() || null, degree: null }] : [],
      jobs: (jobTitle.trim() && jobTitle.trim() !== 'لا يوجد')
        ? [{ job_title: jobTitle.trim(), company: company.trim() || null }] : [],
      responsibilities,
      hobbies_skills: allH.map(h => ({ hobby_skill: h })),
    }
    onConfirm(extraData)
  }

  const filteredUnis = UNIVERSITY_OPTIONS.filter(o => o.includes(uniSearch))

  const fieldStyle = { marginBottom: 18 }
  const labelStyle = { fontSize: '0.82rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }
  const inputStyle = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'rtl', outline: 'none' }
  const errorStyle = { fontSize: '0.78rem', color: '#c62828', marginTop: 4 }
  const optBtn = (val, cur, onClick) => (
    <button type="button" key={val} onClick={onClick}
      style={{
        padding: '7px 14px', border: `1.5px solid ${cur === val ? '#0f2744' : '#e2e6ef'}`,
        borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.84rem',
        background: cur === val ? '#0f2744' : 'white', color: cur === val ? 'white' : '#4a5568',
        marginLeft: 6, marginBottom: 6,
      }}>{val}</button>
  )
  const checkBtn = (val) => (
    <button type="button" key={val} onClick={() => toggleHobby(val)}
      style={{
        padding: '6px 12px', border: `1.5px solid ${hobbies.includes(val) ? '#0f2744' : '#e2e6ef'}`,
        borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.82rem',
        background: hobbies.includes(val) ? '#0f2744' : 'white', color: hobbies.includes(val) ? 'white' : '#4a5568',
        marginLeft: 5, marginBottom: 5,
      }}>{val}</button>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={{
        background: 'white', borderRadius: 16, width: '100%', maxWidth: 560,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.25)', direction: 'rtl',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e2e6ef' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f2744' }}>
                بيانات الترفيع إلى الجامعيّة
              </div>
              <div style={{ fontSize: '0.82rem', color: '#6b778f', marginTop: 3 }}>
                يرجى تعبئة البيانات المطلوبة لفئة الجامعيّة قبل تأكيد الترفيع
              </div>
            </div>
            <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 4, fontSize: 20 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>

          {/* University */}
          <div style={fieldStyle}>
            <label style={labelStyle}>الجامعة / الكليّة <span style={{color:'#c62828'}}>*</span></label>
            <div style={{ position: 'relative' }}>
              <button type="button"
                onClick={() => setUniOpen(o => !o)}
                style={{ ...inputStyle, textAlign: 'right', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: university ? '#1a2a3a' : '#b0bac9' }}>{university || 'اختر الجامعة أو الكليّة…'}</span>
                <span style={{ fontSize: 12 }}>▾</span>
              </button>
              {uniOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: 'white', border: '1.5px solid #e2e6ef', borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 240, display: 'flex', flexDirection: 'column' }}>
                  <input autoFocus value={uniSearch} onChange={e => setUniSearch(e.target.value)}
                    placeholder="بحث…" style={{ ...inputStyle, margin: 8, width: 'calc(100% - 16px)', border: '1px solid #e2e6ef' }}/>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {filteredUnis.map(o => (
                      <button key={o} type="button" onClick={() => { setUniversity(o); setUniOpen(false); setUniSearch('') }}
                        style={{ width: '100%', textAlign: 'right', padding: '8px 14px', border: 'none', background: university===o?'#f0f5ff':'white', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', color: '#1a2a3a' }}>{o}</button>
                    ))}
                    <button type="button" onClick={() => { setUniversity('أخرى'); setUniOpen(false); setUniSearch('') }}
                      style={{ width: '100%', textAlign: 'right', padding: '8px 14px', border: 'none', background: 'white', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.87rem', color: '#c9963c', borderTop: '1px solid #e2e6ef' }}>＋ أخرى…</button>
                  </div>
                </div>
              )}
            </div>
            {university === 'أخرى' && (
              <input autoFocus value={universityOther} onChange={e => setUniversityOther(e.target.value)}
                placeholder="اكتب اسم الجامعة…" style={{ ...inputStyle, marginTop: 8 }}/>
            )}
            {errors.university && <div style={errorStyle}>⚠ {errors.university}</div>}
          </div>

          {/* Major — only if not "didn't study" */}
          {university && university !== 'لم أدرس في الجامعة أو الكليّة' && university !== 'أخرى' && (
            <div style={fieldStyle}>
              <label style={labelStyle}>التخصّص</label>
              <input value={major} onChange={e => setMajor(e.target.value)}
                placeholder="مثال: هندسة حاسوب" style={inputStyle}/>
            </div>
          )}

          {/* Job title */}
          <div style={fieldStyle}>
            <label style={labelStyle}>الوظيفة <span style={{color:'#c62828'}}>*</span></label>
            <div style={{ fontSize: '0.76rem', color: '#9ba5bc', marginBottom: 5 }}>
              كتابة «لا يوجد» في حال عدم وجود عمل
            </div>
            <input value={jobTitle} onChange={e => setJobTitle(e.target.value)}
              placeholder="مثال: مهندس، طالب، لا يوجد…" style={inputStyle}/>
            {errors.job_title && <div style={errorStyle}>⚠ {errors.job_title}</div>}
          </div>

          {/* Company */}
          <div style={fieldStyle}>
            <label style={labelStyle}>الشركة / المؤسسة <span style={{color:'#c62828'}}>*</span></label>
            <div style={{ fontSize: '0.76rem', color: '#9ba5bc', marginBottom: 5 }}>
              كتابة «لا يوجد» في حال عدم وجود عمل
            </div>
            <input value={company} onChange={e => setCompany(e.target.value)}
              placeholder="مثال: شركة X، جامعة Y، لا يوجد…" style={inputStyle}/>
            {errors.company && <div style={errorStyle}>⚠ {errors.company}</div>}
          </div>

          {/* Responsibilities */}
          <div style={fieldStyle}>
            <label style={labelStyle}>هل لديك أي مسؤوليات في الشبيبة؟ <span style={{color:'#c62828'}}>*</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {['لا','نعم'].map(v => optBtn(v, hasResp, () => setHasResp(v)))}
            </div>
            {hasResp === 'نعم' && (
              <>
                <input value={respText} onChange={e => setRespText(e.target.value)}
                  placeholder="اكتب مسؤولياتك…" style={{ ...inputStyle, marginTop: 8 }}/>
                {errors.resp_text && <div style={errorStyle}>⚠ {errors.resp_text}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: '0.76rem', color: '#6b778f', fontWeight: 700 }}>سنة JEC</span>
                    <input value={respJecYear} onChange={e => setRespJecYear(String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 4))}
                      placeholder="2026" style={inputStyle} />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: '0.76rem', color: '#6b778f', fontWeight: 700 }}>الحالة</span>
                    <select value={respIsCurrent} onChange={e => setRespIsCurrent(e.target.value)} style={inputStyle}>
                      <option value="حاليًّا">حاليًّا</option>
                      <option value="سابقًا">سابقًا</option>
                    </select>
                  </label>
                </div>
                {errors.resp_jec_year && <div style={errorStyle}>⚠ {errors.resp_jec_year}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 8 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: '0.76rem', color: '#6b778f', fontWeight: 700 }}>تاريخ البداية</span>
                    <input type="date" value={respStartDate} onChange={e => setRespStartDate(sanitizeDateInput(e.target.value))}
                      style={inputStyle} />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: '0.76rem', color: '#6b778f', fontWeight: 700 }}>تاريخ النهاية</span>
                    <input type="date" value={respEndDate} onChange={e => setRespEndDate(sanitizeDateInput(e.target.value))}
                      style={inputStyle} />
                  </label>
                </div>
                {errors.resp_end_date && <div style={errorStyle}>⚠ {errors.resp_end_date}</div>}
              </>
            )}
            {errors.has_resp && <div style={errorStyle}>⚠ {errors.has_resp}</div>}
          </div>

          {/* Hobbies */}
          <div style={fieldStyle}>
            <label style={labelStyle}>الهوايات والمهارات <span style={{color:'#c62828'}}>*</span></label>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {HOBBIES_ADULT.map(h => checkBtn(h))}
            </div>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.82rem', color: '#6b778f' }}>أخرى:</span>
              <input value={hobbiesOther} onChange={e => setHobbiesOther(e.target.value)}
                placeholder="اكتب هنا…" style={{ ...inputStyle, flex: 1 }}/>
            </div>
            {errors.hobbies && <div style={errorStyle}>⚠ {errors.hobbies}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #e2e6ef', display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
          <button onClick={handleConfirm}
            style={{ padding: '10px 24px', background: '#0f2744', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: 700 }}>
            تأكيد الترفيع
          </button>
          <button onClick={onCancel}
            style={{ padding: '10px 20px', background: 'white', color: '#6b778f', border: '1.5px solid #e2e6ef', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CouncilMembers({ councilAccess, currentUser, onSelectPerson, onSelectUnregistered, toast }) {
  const [tab,          setTab]        = useState('members')
  const [allEnriched,  setEnriched]   = useState([])
  const [allUnreg,     setUnreg]      = useState([])
  const [promotions,   setPromotions] = useState([])
  const [loading,      setLoading]    = useState(true)
  const [loadError,    setLoadError]  = useState('')
  const [promoLoading, setPromoLoad]  = useState(false)
  const [scanning,     setScanning]   = useState(false)
  const [groupLabels,  setGroupLabels]= useState({})

  // Members tab filters
  const [search,       setSearch]     = useState('')
  const [filterGroup,  setFGroup]     = useState('all')
  const [filterAge,    setFAge]       = useState('all')

  // Promotions tab filters
  const [promoFilter,  setPromoFilter]= useState('pending')   // pending|approved|rejected|all
  const [nameVariations, setNameVariations] = useState({})

  const nameAliasLookup = useMemo(() => buildNameAliasLookup(nameVariations), [nameVariations])

  const load = useCallback(() => {
    setLoading(true)
    setLoadError('')
    Promise.all([api.personsEnriched(), api.getUnregistered(), api.listPromotions(), api.filters(), api.getConfig()])
      .then(([enriched, unreg, pd, fd, cfg]) => {
        setEnriched(enriched)
        setUnreg(unreg)
        setPromotions(pd.promotions || [])
        setNameVariations(normalizeNameVariations(cfg?.config?.name_variations || {}))
        const labels = {}
        ;(fd?.youth_group || []).forEach(g => {
          if (g?.value) labels[g.value] = api.formatYouthGroupLabel(g.label || g.value)
        })
        setGroupLabels(labels)
        setLoading(false)
      })
      .catch(() => {
        setLoadError('تعذر تحميل بيانات مجلس الفرقة حالياً. حاول مرة أخرى.')
        setLoading(false)
      })
  }, [])

  useEffect(() => { load() }, [load])

  const groupNameById = useMemo(() => {
    const map = { ...groupLabels }
    Object.entries(councilAccess || {}).forEach(([gid, info]) => {
      const label = String(info?.group_name || '').trim()
      if (label) map[gid] = label
    })
    return map
  }, [groupLabels, councilAccess])

  const resolveGroupLabel = useCallback((groupRef) => {
    const text = String(groupRef || '').trim()
    if (!text) return '—'

    const mapped = groupNameById[text]
    if (mapped) return api.formatYouthGroupLabel(mapped)

    // If it is already a readable name, keep it formatted; if it is a raw ID with no
    // known mapping, avoid showing the raw technical identifier in UI.
    if (/^YG\d{3,}$/i.test(text) || text === 'GS') return 'فرقة غير معرّفة'
    return api.formatYouthGroupLabel(text)
  }, [groupNameById])

  const scopedMemberships = useCallback((person) => {
    const ids = Array.isArray(person?._youth_group_ids) ? person._youth_group_ids : []
    const ages = Array.isArray(person?._age_groups) ? person._age_groups : []

    const rows = []
    for (let i = 0; i < ids.length; i += 1) {
      const groupId = ids[i]
      const info = councilAccess?.[groupId]
      if (!info) continue

      const age = ages[i] || null
      const allowedAges = Array.isArray(info?.age_groups) ? info.age_groups : []
      const allowed = info?.full_group || !age || allowedAges.includes(age)
      if (!allowed) continue

      rows.push({
        groupId,
        age,
        groupLabel: resolveGroupLabel(groupId),
      })
    }
    return rows
  }, [councilAccess, resolveGroupLabel])

  const [adultDataModal, setAdultDataModal] = useState(null) // { promoId } | null

  const reloadPromotions = useCallback(() => {
    setPromoLoad(true)
    api.listPromotions().then(pd => { setPromotions(pd.promotions || []); setPromoLoad(false) })
  }, [])

  // ── Accessible members ────────────────────────────────────────────────────
  const { accessibleReg, accessibleUnreg, youthGroups, ageGroups } = useMemo(() => {
    const ygs = Object.keys(councilAccess)
    const allAgs = [...new Set(
      Object.values(councilAccess).flatMap(info => info.age_groups || [])
    )].sort((a, b) => AGE_GROUPS.indexOf(a) - AGE_GROUPS.indexOf(b))

    const passes = (p) => {
      for (const [yg, info] of Object.entries(councilAccess)) {
        if (!(p._youth_group_ids || []).includes(yg)) continue
        if (info.full_group) return true
        if ((p._age_groups || []).some(ag => (info.age_groups || []).includes(ag))) return true
      }
      return false
    }

    return {
      accessibleReg:   allEnriched.filter(passes),
      accessibleUnreg: allUnreg.filter(passes),
      youthGroups:     ygs,
      ageGroups:       allAgs,
    }
  }, [allEnriched, allUnreg, councilAccess])

  // ── Filtered members list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const qWords = normalizeArabic(search).split(/\s+/).filter(Boolean)
    const qWordGroups = expandQueryWords(qWords, nameAliasLookup)
    const ok = (p) => {
      const scoped = scopedMemberships(p)
      if (!scoped.length) return false
      if (!nameMatches(getNameParts(p), qWordGroups)) return false
      if (filterGroup !== 'all' && !scoped.some(m => m.groupId === filterGroup)) return false
      if (filterAge !== 'all' && !scoped.some(m => m.age === filterAge)) return false
      return true
    }
    return [
      ...accessibleReg.filter(ok).map(p => ({ ...p, _isUnreg: false, _scopedMemberships: scopedMemberships(p) })),
      ...accessibleUnreg.filter(ok).map(p => ({ ...p, _isUnreg: true, _scopedMemberships: scopedMemberships(p) })),
    ]
  }, [accessibleReg, accessibleUnreg, search, filterGroup, filterAge, scopedMemberships, nameAliasLookup])

  // ── Filtered promotions ───────────────────────────────────────────────────
  const filteredPromos = useMemo(() => {
    return promotions.filter(pr => promoFilter === 'all' || pr.status === promoFilter)
  }, [promotions, promoFilter])

  const pendingCount = promotions.filter(p => p.status === 'pending').length

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await api.scanPromotions()
      toast(`تم اكتشاف ${res.created} ترفيع جديد`, res.created > 0 ? 'success' : 'info')
      reloadPromotions()
      if (res.created > 0) setTab('promotions')
    } catch { toast('حدث خطأ أثناء الفحص', 'error') }
    finally { setScanning(false) }
  }

  const handleApprove = async (id, extraData) => {
    try {
      await api.approvePromotion(id, extraData)
      toast('تمّ الترفيع بنجاح', 'success')
      reloadPromotions()
      // Reload members to reflect the change
      api.personsEnriched().then(setEnriched)
      api.getUnregistered().then(setUnreg)
    } catch { toast('حدث خطأ', 'error') }
  }

  const handleApproveClick = (pr) => {
    if (pr.from_age_group === 'الثانوي' && pr.to_age_group === 'الجامعيّة') {
      // Need extra adult-profile data before approving
      setAdultDataModal({ promoId: pr.id })
    } else {
      handleApprove(pr.id)
    }
  }

  const handleReject = async (id) => {
    try {
      await api.rejectPromotion(id)
      toast('تم رفض الترفيع', 'info')
      reloadPromotions()
    } catch { toast('حدث خطأ', 'error') }
  }

  const handleDelete = async (id) => {
    if (!confirm('حذف هذا السجل نهائياً؟')) return
    try {
      await api.deletePromotion(id)
      reloadPromotions()
    } catch { toast('حدث خطأ', 'error') }
  }

  const handleArchiveMember = async (e, row) => {
    e.stopPropagation()

    const targetMembership = (row?._scopedMemberships || [])[0] || null
    const youthGroupId = String(targetMembership?.groupId || '').trim()
    if (!youthGroupId) {
      toast('لا توجد عضوية شبيبة نشطة لأرشفتها', 'error')
      return
    }

    const name = fullName(row) || 'هذا العضو'
    if (!confirm(`هل تريد أرشفة "${name}" ضمن فرقة ${resolveGroupLabel(youthGroupId)}؟`)) return

    try {
      if (row?._isUnreg) {
        await api.archiveUnregistered(row.person_id, youthGroupId)
      } else {
        await api.archivePerson(row.person_id, youthGroupId)
      }
      toast('تمت الأرشفة بنجاح', 'success')
      load()
    } catch {
      toast('خطأ في الأرشفة', 'error')
    }
  }

  if (loading) {
    return (
      <LoadingState
        title="جارٍ تحميل بيانات المجلس"
        description="يتم تجهيز الأعضاء والترفيعات الخاصة بالمجلس الآن."
        minHeight={320}
      />
    )
  }

  if (loadError) {
    return (
      <ErrorState
        title="تعذر تحميل بيانات المجلس"
        description={loadError}
        onRetry={load}
        minHeight={320}
      />
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* Header stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{
          background: 'white', borderRadius: 12, padding: '14px 20px',
          border: '1px solid #e2e6ef', boxShadow: '0 1px 4px rgba(15,39,68,0.06)',
          flex: 1, minWidth: 130,
        }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f2744' }}>
            {accessibleReg.length + accessibleUnreg.length}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#6b778f', marginTop: 2 }}>إجمالي أعضاء فئتك</div>
        </div>

        {pendingCount > 0 && (
          <div style={{
            background: '#fffbeb', borderRadius: 12, padding: '14px 20px',
            border: '1px solid #fde68a', boxShadow: '0 1px 4px rgba(15,39,68,0.06)',
            flex: 1, minWidth: 130, cursor: 'pointer',
          }} onClick={() => setTab('promotions')}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#92400e' }}>{pendingCount}</div>
            <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: 2 }}>ترفيعات بانتظار الموافقة</div>
          </div>
        )}

        {Object.entries(councilAccess).map(([yg, info]) => (
          <div key={yg} style={{
            background: 'white', borderRadius: 12, padding: '14px 20px',
            border: `1px solid ${info.full_group ? '#fde68a' : '#e2e6ef'}`,
            boxShadow: '0 1px 4px rgba(15,39,68,0.06)',
            flex: 2, minWidth: 200,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f2744' }}>{resolveGroupLabel(info.group_name || yg)}</div>
              {info.full_group && (
                <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '1px 8px', borderRadius: 20,
                  background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
                  صلاحية كاملة
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(info.age_groups || []).map(ag => <AgeBadge key={ag} group={ag}/>)}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <TabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'members',    label: 'الأعضاء',        icon: <Users size={15}/>,         count: accessibleReg.length + accessibleUnreg.length },
          { id: 'promotions', label: 'ترفيعات الأعضاء', icon: <ArrowUpCircle size={15}/>, count: pendingCount > 0 ? pendingCount : null },
        ]}
      />

      {/* ── MEMBERS TAB ────────────────────────────────────────────────────── */}
      {tab === 'members' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم…"
                style={{ width: '100%', padding: '9px 36px 9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.88rem', direction: 'rtl', outline: 'none' }}/>
            </div>
            {youthGroups.length > 1 && (
              <select value={filterGroup} onChange={e => setFGroup(e.target.value)}
                style={{ padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.88rem', direction: 'rtl', outline: 'none', background: 'white' }}>
                <option value="all">كل المجموعات</option>
                {youthGroups.map(yg => <option key={yg} value={yg}>{resolveGroupLabel(councilAccess[yg]?.group_name || yg)}</option>)}
              </select>
            )}
            <select value={filterAge} onChange={e => setFAge(e.target.value)}
              style={{ padding: '9px 12px', border: '1.5px solid #e2e6ef', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.88rem', direction: 'rtl', outline: 'none', background: 'white' }}>
              <option value="all">كل الفئات</option>
              {ageGroups.map(ag => <option key={ag} value={ag}>{ag}</option>)}
            </select>
            <span style={{ fontSize: '0.82rem', color: '#9ba5bc', whiteSpace: 'nowrap' }}>{filtered.length} عضو</span>
          </div>

          <div className="card">
            {filtered.length === 0 ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#9ba5bc' }}>
                <Users size={40} style={{ marginBottom: 12, opacity: 0.4 }}/><div>لا توجد نتائج</div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                    {['الاسم الكامل','سنة الميلاد','الجنس','الفئة الحالية','فرقة الشبيبة','المحافظة',''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#4a5568', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const pid   = p.person_id
                    const isUn  = p._isUnreg
                    const name  = fullName(p)
                    const by    = p.birth_year
                    const curAgs = [...new Set((p._scopedMemberships || []).map(m => m.age).filter(Boolean))]
                    const scopedGroups = [...new Set((p._scopedMemberships || []).map(m => m.groupLabel).filter(Boolean))]
                    // Highlight if any current age group is out of range
                    const outOfRange = curAgs.some(ag => {
                      const exp = expectedAgeGroup(by, ag)
                      return exp && ag !== exp
                    })

                    return (
                      <tr key={`${isUn?'u':'r'}-${pid}`}
                        style={{ borderBottom: '1px solid #f0f2f7', cursor: 'pointer', background: outOfRange ? '#fffbf0' : '' }}
                        onClick={() => isUn ? onSelectUnregistered(pid) : onSelectPerson(pid)}
                        onMouseEnter={e => e.currentTarget.style.background = outOfRange ? '#fff8e8' : '#fafbff'}
                        onMouseLeave={e => e.currentTarget.style.background = outOfRange ? '#fffbf0' : ''}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar pid={pid} isUnreg={isUn} name={name}/>
                            <div>
                              <div style={{ fontWeight: 600, color: '#1a2a3a' }}>{name || '—'}</div>
                              {isUn && <div style={{ fontSize: '0.72rem', color: '#e8b55a', fontWeight: 600 }}>غير مسجّل</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#6b778f', fontFamily: 'monospace' }}>{by || '—'}</td>
                        <td style={{ padding: '10px 14px', color: '#6b778f' }}>{p.gender || '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {curAgs.map(ag => <AgeBadge key={ag} group={ag}/>)}
                            {curAgs.some(ag => { const e = expectedAgeGroup(by, ag); return e && ag !== e }) && (
                              <span title={`خارج النطاق العمري`} style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 700, marginRight: 4 }}>
                                ⚠ خارج النطاق
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#6b778f', fontSize: '0.83rem' }}>
                          {scopedGroups.join('، ') || '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#6b778f' }}>{p.governorate || '—'}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, background: '#eef4ff', color: '#0f2744', border: '1px solid #c5d8f8', cursor: 'pointer' }}>
                              <UserCheck size={12}/> عرض الملف
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleArchiveMember(e, p)}
                              title="أرشفة"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '4px 10px',
                                borderRadius: 20,
                                fontSize: '0.76rem',
                                fontWeight: 700,
                                background: '#fff7ed',
                                color: '#9a3412',
                                border: '1px solid #fed7aa',
                                cursor: 'pointer',
                                fontFamily: 'var(--font-body)',
                              }}
                            >
                              <Archive size={12} /> أرشفة
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── PROMOTIONS TAB ─────────────────────────────────────────────────── */}
      {tab === 'promotions' && (
        <>
          {/* Age group ranges reference */}
          <div style={{ background: '#f8f9fb', border: '1px solid #e2e6ef', borderRadius: 12, padding: '14px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 10 }}>نطاقات الفئات العمرية (حسب سنة الميلاد)</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(AG_RANGES).map(([ag, range]) => (
                <div key={ag} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AgeBadge group={ag}/>
                  <span style={{ fontSize: '0.78rem', color: '#6b778f', fontFamily: 'monospace' }}>{range}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Status filter */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2f7', borderRadius: 8, padding: 3 }}>
              {[
                { id: 'pending',  label: 'بانتظار الموافقة' },
                { id: 'approved', label: 'تمّ الترفيع' },
                { id: 'rejected', label: 'مرفوضة' },
                { id: 'all',      label: 'الكل' },
              ].map(opt => (
                <button key={opt.id} onClick={() => setPromoFilter(opt.id)} style={{
                  padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: promoFilter === opt.id ? 700 : 500,
                  background: promoFilter === opt.id ? 'white' : 'transparent',
                  color: promoFilter === opt.id ? '#0f2744' : '#6b778f',
                  boxShadow: promoFilter === opt.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  transition: '0.15s',
                }}>{opt.label}</button>
              ))}
            </div>

            <div style={{ flex: 1 }}/>

            <button
              onClick={handleScan}
              disabled={scanning || promoLoading}
              className="btn btn-ghost btn-sm"
              style={{ gap: 7, color: '#0f2744' }}>
              <RefreshCw size={14} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }}/>
              {scanning ? 'جارٍ الفحص…' : 'فحص الأعضاء'}
            </button>

            <span style={{ fontSize: '0.82rem', color: '#9ba5bc' }}>{filteredPromos.length} سجل</span>
          </div>

          {/* Promotions list */}
          {filteredPromos.length === 0 ? (
            <div className="card" style={{ padding: '48px 32px', textAlign: 'center', color: '#9ba5bc' }}>
              <ArrowUpCircle size={40} style={{ marginBottom: 12, opacity: 0.3 }}/>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {promoFilter === 'pending' ? 'لا توجد ترفيعات بانتظار الموافقة' : 'لا توجد سجلات'}
              </div>
              {promoFilter === 'pending' && (
                <div style={{ fontSize: '0.85rem', color: '#b0bac9', marginTop: 4 }}>
                  اضغط «فحص الأعضاء» لاكتشاف الأعضاء الذين تجاوزوا نطاق فئتهم العمرية
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredPromos.map(pr => (
                <div key={pr.id} style={{
                  background: 'white', border: `1px solid ${pr.status === 'pending' ? '#fde68a' : pr.status === 'approved' ? '#a7f3d0' : '#ef9a9a'}`,
                  borderRadius: 12, padding: '16px 20px',
                  boxShadow: '0 1px 4px rgba(15,39,68,0.06)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>

                    {/* Avatar + name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '2 1 200px' }}>
                      <Avatar
                        pid={pr.person_id}
                        isUnreg={pr.person_type === 'unregistered'}
                        name={pr.display_name}
                      />
                      <div>
                        <div style={{ fontWeight: 700, color: '#1a2a3a', fontSize: '0.95rem' }}>
                          {pr.display_name || `#${pr.person_id}`}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#9ba5bc', marginTop: 2 }}>
                          سنة الميلاد: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{pr.birth_year || '—'}</span>
                          {pr.person_type === 'unregistered' && (
                            <span style={{ marginRight: 8, color: '#e8b55a', fontWeight: 600 }}>غير مسجّل</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Transfer arrow */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '3 1 280px' }}>
                      <AgeBadge group={pr.from_age_group} size="lg"/>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9ba5bc' }}>
                        <ChevronLeft size={16}/>
                        <span style={{ fontSize: '0.75rem', color: '#b0bac9', fontWeight: 600 }}>ترفيع إلى</span>
                        <ChevronLeft size={16}/>
                      </div>
                      <AgeBadge group={pr.to_age_group} size="lg"/>
                    </div>

                    {/* Youth group */}
                    <div style={{ flex: '1 1 140px', fontSize: '0.8rem', color: '#6b778f' }}>
                      <div style={{ fontWeight: 700, color: '#4a5568', marginBottom: 2 }}>فرقة الشبيبة</div>
                      {resolveGroupLabel(pr.youth_group)}
                    </div>

                    {/* Status */}
                    <div style={{ flex: '1 1 120px' }}>
                      <StatusBadge status={pr.status}/>
                      {pr.approved_by && (
                        <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginTop: 4 }}>
                          بواسطة: {pr.approved_by}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto' }}>
                      {pr.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApproveClick(pr)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer',
                              background: '#0f2744', color: 'white',
                              fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700,
                              transition: '0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#1a3a5c'}
                            onMouseLeave={e => e.currentTarget.style.background = '#0f2744'}
                          >
                            <CheckCircle size={14}/> موافقة
                          </button>
                          <button
                            onClick={() => handleReject(pr.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              padding: '7px 14px', border: '1.5px solid #ef9a9a', borderRadius: 8, cursor: 'pointer',
                              background: 'white', color: '#c62828',
                              fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700,
                              transition: '0.15s',
                            }}
                          >
                            <XCircle size={14}/> رفض
                          </button>
                        </>
                      )}
                      {pr.status !== 'pending' && (
                        <button
                          onClick={() => handleDelete(pr.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c8cfe0', padding: 4, display: 'flex' }}
                          title="حذف السجل">
                          <Trash2 size={15}/>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {adultDataModal && (
        <AdultDataModal
          youthGroup={promotions.find(p => p.id === adultDataModal.promoId)?.youth_group || ''}
          onConfirm={extraData => {
            handleApprove(adultDataModal.promoId, extraData)
            setAdultDataModal(null)
          }}
          onCancel={() => setAdultDataModal(null)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
