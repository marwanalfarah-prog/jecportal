import { useEffect, useState, useMemo, useCallback } from 'react'
import { ArrowUpCircle, CheckCircle, XCircle, RefreshCw, Clock, ChevronLeft, Trash2 } from 'lucide-react'
import { api } from '../api.js'
import { ErrorState, LoadingState } from '../pageStates.jsx'

// ── Age group config ──────────────────────────────────────────────────────────
const AGE_GROUPS = ['البراعم', 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
const CURRENT_YEAR = new Date().getFullYear()

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

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
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

// ── Adult data modal (ثانوي → جامعيّة) ──────────────────────────────────────
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
  const [jobStart,       setJobStart]       = useState('')
  const [isEmployed,     setIsEmployed]     = useState(false)
  const [hobbies,        setHobbies]        = useState([])
  const [hobbiesOther,   setHobbiesOther]   = useState('')

  const toggleHobby = (h) => setHobbies(prev => prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h])

  const handleConfirm = () => {
    const uni = university === 'other' ? universityOther.trim() : university
    const allHobbies = [...hobbies, ...(hobbiesOther.trim() ? [hobbiesOther.trim()] : [])]
    onConfirm({
      university: uni,
      major: major.trim(),
      job_title: isEmployed ? jobTitle.trim() : '',
      company:   isEmployed ? company.trim() : '',
      job_start: isEmployed ? sanitizeDateInput(jobStart) : '',
      hobbies:   allHobbies,
    })
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{
        background:'white', borderRadius:16, width:'100%', maxWidth:560, maxHeight:'90vh',
        overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,0.2)', direction:'rtl',
      }}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid #e2e6ef', position:'sticky', top:0, background:'white', zIndex:1 }}>
          <div style={{ fontWeight:800, fontSize:'1.05rem', color:'#0f2744', marginBottom:4 }}>
            بيانات الترفيع إلى الجامعيّة
          </div>
          <div style={{ fontSize:'0.8rem', color:'#6b778f' }}>
            يرجى تعبئة البيانات الإضافية قبل الموافقة على الترفيع
            {youthGroup ? ` في ${youthGroup}` : ''}
          </div>
        </div>

        <div style={{ padding:'20px 24px', display:'grid', gap:18 }}>
          {/* University */}
          <div>
            <label style={{ display:'block', fontWeight:700, fontSize:'0.82rem', color:'#374151', marginBottom:6 }}>
              الجامعة / الكليّة
            </label>
            <select value={university} onChange={e => setUniversity(e.target.value)}
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none' }}>
              <option value="">— اختر —</option>
              {UNIVERSITY_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              <option value="other">جامعة أخرى (أكتبها أدناه)</option>
            </select>
            {university === 'other' && (
              <input value={universityOther} onChange={e => setUniversityOther(e.target.value)} placeholder="اسم الجامعة"
                style={{ width:'100%', marginTop:6, padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none', boxSizing:'border-box' }}/>
            )}
          </div>

          {/* Major */}
          <div>
            <label style={{ display:'block', fontWeight:700, fontSize:'0.82rem', color:'#374151', marginBottom:6 }}>التخصص</label>
            <input value={major} onChange={e => setMajor(e.target.value)} placeholder="مثال: هندسة حاسوب، طب، محاسبة…"
              style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none', boxSizing:'border-box' }}/>
          </div>

          {/* Employment */}
          <div>
            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontWeight:700, fontSize:'0.82rem', color:'#374151' }}>
              <input type="checkbox" checked={isEmployed} onChange={e => setIsEmployed(e.target.checked)} style={{ accentColor:'#0f2744', width:16, height:16 }}/>
              يعمل حالياً
            </label>
            {isEmployed && (
              <div style={{ marginTop:10, display:'grid', gap:10 }}>
                <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="المسمى الوظيفي"
                  style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none', boxSizing:'border-box' }}/>
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="الشركة / المؤسسة"
                  style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none', boxSizing:'border-box' }}/>
                <input type="date" value={jobStart} onChange={e => setJobStart(e.target.value)}
                  style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none', boxSizing:'border-box' }}/>
              </div>
            )}
          </div>

          {/* Hobbies */}
          <div>
            <label style={{ display:'block', fontWeight:700, fontSize:'0.82rem', color:'#374151', marginBottom:8 }}>
              الهوايات والمهارات
            </label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {HOBBIES_ADULT.map(h => (
                <button key={h} type="button" onClick={() => toggleHobby(h)} style={{
                  padding:'4px 12px', borderRadius:20, border:`1.5px solid ${hobbies.includes(h) ? '#0f2744' : '#e2e6ef'}`,
                  background: hobbies.includes(h) ? '#0f2744' : 'white',
                  color: hobbies.includes(h) ? 'white' : '#374151',
                  fontSize:'0.78rem', fontFamily:'var(--font-body)', cursor:'pointer', transition:'0.15s',
                }}>{h}</button>
              ))}
            </div>
            <input value={hobbiesOther} onChange={e => setHobbiesOther(e.target.value)}
              placeholder="هوايات أخرى (افصل بفاصلة)"
              style={{ width:'100%', marginTop:8, padding:'9px 12px', border:'1.5px solid #e2e6ef', borderRadius:8, fontFamily:'var(--font-body)', fontSize:'0.88rem', direction:'rtl', outline:'none', boxSizing:'border-box' }}/>
          </div>
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e6ef', display:'flex', gap:8, justifyContent:'flex-end', position:'sticky', bottom:0, background:'white' }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
          <button className="btn btn-gold btn-sm" onClick={handleConfirm}
            disabled={!university || (university !== 'لم أدرس في الجامعة أو الكليّة' && !major.trim())}>
            تأكيد الترفيع
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Promotions({ currentUser, onSelectPerson, toast, isAdmin = true }) {
  const [promotions,   setPromotions] = useState([])
  const [loading,      setLoading]    = useState(true)
  const [loadError,    setLoadError]  = useState('')
  const [promoLoading, setPromoLoad]  = useState(false)
  const [scanning,     setScanning]   = useState(false)
  const [promoFilter,  setPromoFilter]= useState('pending')
  const [adultDataModal, setAdultDataModal] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError('')
    api.listPromotions()
      .then(pd => {
        setPromotions(pd.promotions || [])
        setLoading(false)
      })
      .catch(() => {
        setLoadError('تعذر تحميل الترفيعات حالياً. حاول مرة أخرى.')
        setLoading(false)
      })
  }, [])

  useEffect(() => { load() }, [load])

  const resolveGroupLabel = useCallback((groupRef) => {
    const text = String(groupRef || '').trim()
    if (!text) return '—'
    return api.formatYouthGroupLabel(text) || api.genericYouthGroupLabel
  }, [])

  const reloadPromotions = useCallback(() => {
    setPromoLoad(true)
    api.listPromotions().then(pd => { setPromotions(pd.promotions || []); setPromoLoad(false) })
  }, [])

  const filteredPromos = useMemo(() =>
    promotions.filter(pr => promoFilter === 'all' || pr.status === promoFilter)
  , [promotions, promoFilter])

  const pendingCount = promotions.filter(p => p.status === 'pending').length

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await api.scanPromotions()
      toast(`تم اكتشاف ${res.created} ترفيع جديد`, res.created > 0 ? 'success' : 'info')
      reloadPromotions()
    } catch { toast('حدث خطأ أثناء الفحص', 'error') }
    finally { setScanning(false) }
  }

  const handleApprove = async (id, extraData) => {
    try {
      await api.approvePromotion(id, extraData)
      toast('تمّ الترفيع بنجاح', 'success')
      reloadPromotions()
    } catch { toast('حدث خطأ', 'error') }
  }

  const handleApproveClick = (pr) => {
    if (pr.from_age_group === 'الثانوي' && pr.to_age_group === 'الجامعيّة') {
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

  if (loading) return (
    <LoadingState title="جارٍ تحميل الترفيعات" description="يتم تجهيز سجلات الترفيعات الآن." minHeight={320}/>
  )
  if (loadError) return (
    <ErrorState title="تعذر تحميل الترفيعات" description={loadError} onRetry={load} minHeight={320}/>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* Header — pending count */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {pendingCount > 0 && (
          <div style={{
            background:'#fffbeb', borderRadius:12, padding:'14px 20px',
            border:'1px solid #fde68a', boxShadow:'0 1px 4px rgba(15,39,68,0.06)',
            flex:'0 0 auto', minWidth:130,
          }}>
            <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#92400e' }}>{pendingCount}</div>
            <div style={{ fontSize:'0.78rem', color:'#b45309', marginTop:2 }}>ترفيعات بانتظار الموافقة</div>
          </div>
        )}
      </div>

      {/* Age group ranges reference */}
      <div style={{ background:'#f8f9fb', border:'1px solid #e2e6ef', borderRadius:12, padding:'14px 20px', marginBottom:16 }}>
        <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#4a5568', marginBottom:10 }}>
          نطاقات الفئات العمرية (حسب سنة الميلاد)
        </div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          {Object.entries(AG_RANGES).map(([ag, range]) => (
            <div key={ag} style={{ display:'flex', alignItems:'center', gap:8 }}>
              <AgeBadge group={ag}/>
              <span style={{ fontSize:'0.78rem', color:'#6b778f', fontFamily:'monospace' }}>{range}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Controls: status filter + scan */}
      <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:4, background:'#f0f2f7', borderRadius:8, padding:3 }}>
          {[
            { id:'pending',  label:'بانتظار الموافقة' },
            { id:'approved', label:'تمّ الترفيع' },
            { id:'rejected', label:'مرفوضة' },
            { id:'all',      label:'الكل' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setPromoFilter(opt.id)} style={{
              padding:'6px 14px', border:'none', borderRadius:6, cursor:'pointer',
              fontFamily:'var(--font-body)', fontSize:'0.8rem',
              fontWeight: promoFilter === opt.id ? 700 : 500,
              background: promoFilter === opt.id ? 'white' : 'transparent',
              color: promoFilter === opt.id ? '#0f2744' : '#6b778f',
              boxShadow: promoFilter === opt.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition:'0.15s',
            }}>{opt.label}</button>
          ))}
        </div>
        <div style={{ flex:1 }}/>
        <button
          onClick={handleScan}
          disabled={scanning || promoLoading}
          className="btn btn-ghost btn-sm"
          style={{ gap:7, color:'#0f2744' }}>
          <RefreshCw size={14} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }}/>
          {scanning ? 'جارٍ الفحص…' : 'فحص الأعضاء'}
        </button>
        <span style={{ fontSize:'0.82rem', color:'#9ba5bc' }}>{filteredPromos.length} سجل</span>
      </div>

      {/* Promotions list */}
      {filteredPromos.length === 0 ? (
        <div className="card" style={{ padding:'48px 32px', textAlign:'center', color:'#9ba5bc' }}>
          <ArrowUpCircle size={40} style={{ marginBottom:12, opacity:0.3 }}/>
          <div style={{ fontWeight:600, marginBottom:6 }}>
            {promoFilter === 'pending' ? 'لا توجد ترفيعات بانتظار الموافقة' : 'لا توجد سجلات'}
          </div>
          {promoFilter === 'pending' && (
            <div style={{ fontSize:'0.85rem', color:'#b0bac9', marginTop:4 }}>
              اضغط «فحص الأعضاء» لاكتشاف الأعضاء الذين تجاوزوا نطاق فئتهم العمرية
            </div>
          )}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filteredPromos.map(pr => (
            <div key={pr.id} style={{
              background:'white',
              border:`1px solid ${pr.status === 'pending' ? '#fde68a' : pr.status === 'approved' ? '#a7f3d0' : '#ef9a9a'}`,
              borderRadius:12, padding:'16px 20px',
              boxShadow:'0 1px 4px rgba(15,39,68,0.06)',
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:14, flexWrap:'wrap' }}>

                {/* Avatar + name */}
                <div style={{ display:'flex', alignItems:'center', gap:10, flex:'2 1 200px' }}>
                  <Avatar pid={pr.person_id} isUnreg={pr.person_type === 'unregistered'} name={pr.display_name}/>
                  <div>
                    <div style={{ fontWeight:700, color:'#1a2a3a', fontSize:'0.95rem' }}>
                      {pr.display_name || '—'}
                    </div>
                    <div style={{ fontSize:'0.76rem', color:'#9ba5bc', marginTop:2 }}>
                      سنة الميلاد: <span style={{ fontFamily:'monospace', fontWeight:600 }}>{pr.birth_year || '—'}</span>
                      {pr.person_type === 'unregistered' && (
                        <span style={{ marginRight:8, color:'#e8b55a', fontWeight:600 }}>غير مسجّل</span>
                      )}
                    </div>
                    {onSelectPerson && pr.person_type !== 'unregistered' && (
                      <button
                        onClick={() => onSelectPerson(pr.person_id)}
                        style={{ marginTop:4, background:'none', border:'none', color:'#3b82f6', fontSize:'0.72rem', fontFamily:'var(--font-body)', cursor:'pointer', padding:0, display:'flex', alignItems:'center', gap:3 }}>
                        عرض الملف الشخصي ←
                      </button>
                    )}
                  </div>
                </div>

                {/* Transfer arrow */}
                <div style={{ display:'flex', alignItems:'center', gap:10, flex:'3 1 280px' }}>
                  <AgeBadge group={pr.from_age_group} size="lg"/>
                  <div style={{ display:'flex', alignItems:'center', gap:4, color:'#9ba5bc' }}>
                    <ChevronLeft size={16}/>
                    <span style={{ fontSize:'0.75rem', color:'#b0bac9', fontWeight:600 }}>ترفيع إلى</span>
                    <ChevronLeft size={16}/>
                  </div>
                  <AgeBadge group={pr.to_age_group} size="lg"/>
                </div>

                {/* Youth group */}
                <div style={{ flex:'1 1 140px', fontSize:'0.8rem', color:'#6b778f' }}>
                  <div style={{ fontWeight:700, color:'#4a5568', marginBottom:2 }}>فرقة الشبيبة</div>
                  {resolveGroupLabel(pr.youth_group)}
                </div>

                {/* Status */}
                <div style={{ flex:'1 1 120px' }}>
                  <StatusBadge status={pr.status}/>
                  {pr.approved_by && (
                    <div style={{ fontSize:'0.72rem', color:'#9ba5bc', marginTop:4 }}>
                      بواسطة: {pr.approved_by}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display:'flex', gap:8, alignItems:'center', flex:'0 0 auto' }}>
                  {pr.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleApproveClick(pr)}
                        style={{
                          display:'flex', alignItems:'center', gap:6,
                          padding:'7px 16px', border:'none', borderRadius:8, cursor:'pointer',
                          background:'#0f2744', color:'white',
                          fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:700,
                          transition:'0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#1a3a5c'}
                        onMouseLeave={e => e.currentTarget.style.background = '#0f2744'}
                      >
                        <CheckCircle size={14}/> موافقة
                      </button>
                      <button
                        onClick={() => handleReject(pr.id)}
                        style={{
                          display:'flex', alignItems:'center', gap:6,
                          padding:'7px 14px', border:'1.5px solid #ef9a9a', borderRadius:8, cursor:'pointer',
                          background:'white', color:'#c62828',
                          fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:700,
                          transition:'0.15s',
                        }}
                      >
                        <XCircle size={14}/> رفض
                      </button>
                    </>
                  )}
                  {pr.status !== 'pending' && (
                    <button
                      onClick={() => handleDelete(pr.id)}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'#c8cfe0', padding:4, display:'flex' }}
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
