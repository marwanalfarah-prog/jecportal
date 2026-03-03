import { useState, useEffect } from 'react'
import { CheckCircle, ChevronLeft, ChevronRight, Send, ExternalLink, FileText, Star } from 'lucide-react'
import { api } from '../api.js'

const S = {
  input: {
    width: '100%', padding: '10px 14px', border: '1.5px solid #e2e6ef',
    borderRadius: 10, fontFamily: 'var(--font-body)', fontSize: '0.92rem',
    direction: 'rtl', outline: 'none', background: '#fafbfc', boxSizing: 'border-box',
  },
  btn: (v = 'navy', sm = false) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: sm ? '7px 14px' : '10px 20px',
    borderRadius: 10, border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-body)', fontSize: sm ? '0.82rem' : '0.9rem', fontWeight: 700,
    ...(v === 'navy'  ? { background: '#0f2744', color: 'white' } :
        v === 'gold'  ? { background: '#c9963c', color: 'white' } :
        v === 'green' ? { background: '#38a169', color: 'white' } :
        { background: '#f0f4ff', color: '#0f2744', border: '1.5px solid #c5d8f8' }),
  }),
}

const REDIRECT_LABELS = { promotions: 'الترفيعات', orgtree: 'الهيكل التنظيمي', profile: 'ملفي الشخصي' }

// ─── Question Field — renders correct input for every Google-Forms-style type ─
function QuestionField({ question, value, onChange, onNavigate }) {
  // short text
  if (question.type === 'short_text' || question.type === 'text') {
    return (
      <input value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder="اكتب إجابتك هنا…" style={S.input}
        onFocus={e => e.target.style.borderColor='#0f2744'}
        onBlur={e => e.target.style.borderColor='#e2e6ef'} />
    )
  }

  // paragraph (multi-line)
  if (question.type === 'paragraph') {
    return (
      <textarea value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder="اكتب إجابتك هنا…" rows={5}
        style={{ ...S.input, resize: 'vertical', fontFamily: 'var(--font-body)', minHeight: 110 }}
        onFocus={e => e.target.style.borderColor='#0f2744'}
        onBlur={e => e.target.style.borderColor='#e2e6ef'} />
    )
  }

  // yes / no
  if (question.type === 'yes_no') {
    return (
      <div style={{ display: 'flex', gap: 12 }}>
        {['نعم', 'لا'].map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            style={{
              flex: 1, padding: '14px', borderRadius: 12, cursor: 'pointer',
              border: `2px solid ${value === opt ? '#0f2744' : '#e2e6ef'}`,
              background: value === opt ? '#eef4ff' : 'white',
              fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: 700,
              color: value === opt ? '#0f2744' : '#4a5568',
            }}>
            {opt === 'نعم' ? '✓ ' : '✗ '}{opt}
          </button>
        ))}
      </div>
    )
  }

  // choice (radio — single select)
  if (question.type === 'choice') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(question.options || []).map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            style={{
              padding: '12px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'right',
              border: `2px solid ${value === opt ? '#0f2744' : '#e2e6ef'}`,
              background: value === opt ? '#eef4ff' : 'white',
              fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: value === opt ? 700 : 500,
              color: value === opt ? '#0f2744' : '#4a5568', display: 'flex', alignItems: 'center', gap: 10,
            }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${value === opt ? '#0f2744' : '#c8d0e0'}`, background: value === opt ? '#0f2744' : 'white', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {value === opt && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'white', display: 'block' }} />}
            </span>
            {opt}
          </button>
        ))}
      </div>
    )
  }

  // checkbox (multi-select)
  if (question.type === 'checkbox' || question.type === 'multi_choice') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(question.options || []).map(opt => {
          const checked = selected.includes(opt)
          return (
            <button key={opt} onClick={() => onChange(checked ? selected.filter(x=>x!==opt) : [...selected, opt])}
              style={{
                padding: '12px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'right',
                border: `2px solid ${checked ? '#0f2744' : '#e2e6ef'}`,
                background: checked ? '#eef4ff' : 'white',
                fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: checked ? 700 : 500,
                color: checked ? '#0f2744' : '#4a5568', display: 'flex', alignItems: 'center', gap: 10,
              }}>
              <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? '#0f2744' : '#c8d0e0'}`, background: checked ? '#0f2744' : 'white', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: 'white' }}>
                {checked ? '✓' : ''}
              </span>
              {opt}
            </button>
          )
        })}
      </div>
    )
  }

  // dropdown (native select)
  if (question.type === 'dropdown') {
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ ...S.input, cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ba5bc' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'left 12px center', paddingLeft: 30 }}>
        <option value="">— اختر —</option>
        {(question.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    )
  }

  // linear scale
  if (question.type === 'scale') {
    const min = question.scale_min ?? 1
    const max = question.scale_max ?? 5
    const steps = Array.from({ length: max - min + 1 }, (_, i) => i + min)
    const num = Number(value)
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
          {question.scale_label_min && <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>{question.scale_label_min}</span>}
          {question.scale_label_max && <span style={{ fontSize: '0.78rem', color: '#9ba5bc', marginRight: 'auto' }}>{question.scale_label_max}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {steps.map(n => (
            <button key={n} onClick={() => onChange(String(n))}
              style={{
                width: 48, height: 48, borderRadius: '50%', cursor: 'pointer',
                border: `2px solid ${num === n ? '#0f2744' : '#e2e6ef'}`,
                background: num === n ? '#0f2744' : 'white',
                fontFamily: 'var(--font-body)', fontSize: '0.95rem', fontWeight: 700,
                color: num === n ? 'white' : '#4a5568', transition: '0.15s',
              }}>
              {n}
            </button>
          ))}
        </div>
        {question.scale_label_min || question.scale_label_max ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.75rem', color: '#9ba5bc' }}>
            <span>{min} = {question.scale_label_min || ''}</span>
            <span>{max} = {question.scale_label_max || ''}</span>
          </div>
        ) : null}
      </div>
    )
  }

  // date
  if (question.type === 'date') {
    return (
      <input type="date" value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ ...S.input, direction: 'ltr', textAlign: 'right' }} />
    )
  }

  // time
  if (question.type === 'time') {
    return (
      <input type="time" value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ ...S.input, direction: 'ltr', textAlign: 'right' }} />
    )
  }

  // redirect / link
  if (question.type === 'redirect') {
    const label = question.redirect_label || (REDIRECT_LABELS[question.redirect_page] ? `افتح ${REDIRECT_LABELS[question.redirect_page]}` : 'انتقل')
    return (
      <div style={{ textAlign: 'center' }}>
        <button onClick={() => { onChange('done'); onNavigate && onNavigate(question.redirect_page) }}
          style={{ ...S.btn('gold'), padding: '14px 28px', fontSize: '1rem', borderRadius: 12 }}>
          <ExternalLink size={17} /> {label}
        </button>
        {value === 'done' && <div style={{ marginTop: 10, color: '#38a169', fontWeight: 700, fontSize: '0.88rem' }}>✓ تم الانتقال</div>}
      </div>
    )
  }

  return <div style={{ color: '#9ba5bc', fontSize: '0.85rem' }}>نوع سؤال غير معروف</div>
}

// ─── Questionnaire Taker ──────────────────────────────────────────────────────
function QuestionnaireTaker({ questionnaire, onDone, onNavigate, toast }) {
  const [step, setStep]       = useState(0)
  const [answers, setAnswers] = useState({})
  const [submitting, setSub]  = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const qs = questionnaire.questions || []
  const q  = qs[step]
  if (!q) return null

  const ans    = answers[q.id]
  const hasAns = Array.isArray(ans) ? ans.length > 0 : (ans !== undefined && ans !== '' && ans !== null)
  const canNext = !q.required || hasAns

  const next = () => {
    if (!canNext) { toast && toast('هذا السؤال إلزامي','error'); return }
    if (step < qs.length - 1) setStep(s => s + 1)
  }
  const prev = () => { if (step > 0) setStep(s => s - 1) }

  const submit = async () => {
    // validate all required
    for (const q of qs) {
      const a = answers[q.id]
      const filled = Array.isArray(a) ? a.length > 0 : (a !== undefined && a !== '' && a !== null)
      if (q.required && !filled) {
        toast && toast(`السؤال "${q.text}" إلزامي`, 'error')
        setStep(qs.indexOf(q))
        return
      }
    }
    setSub(true)
    try {
      await api.submitQuestionnaireResponse(questionnaire.id, Object.entries(answers).map(([qid, answer]) => ({ question_id: qid, answer })))
      setSubmitted(true)
      toast && toast('تم إرسال إجاباتك بنجاح', 'success')
    } catch {
      toast && toast('حدث خطأ أثناء الإرسال', 'error')
    }
    setSub(false)
  }

  if (submitted) return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <CheckCircle size={56} color="#38a169" style={{ marginBottom: 16 }} />
      <h3 style={{ fontFamily: 'var(--font-head)', color: '#0f2744', marginBottom: 8 }}>شكراً! تم إرسال إجاباتك</h3>
      <p style={{ color: '#9ba5bc', marginBottom: 24 }}>تم تسجيل ردودك بنجاح.</p>
      <button onClick={onDone} style={S.btn('navy')}>العودة</button>
    </div>
  )

  const progress = qs.filter(q => {
    const a = answers[q.id]
    return Array.isArray(a) ? a.length > 0 : (a !== undefined && a !== '' && a !== null)
  }).length

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', color: '#0f2744', margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>{questionnaire.title}</h3>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc', fontWeight: 600 }}>{step + 1} / {qs.length}</span>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: '#e2e6ef', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${((step + 1) / qs.length) * 100}%`, background: '#0f2744', borderRadius: 4, transition: '0.3s' }} />
        </div>
        {/* Dot indicators */}
        <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          {qs.map((qq, i) => {
            const a = answers[qq.id]
            const done = Array.isArray(a) ? a.length > 0 : (a !== undefined && a !== '' && a !== null)
            return (
              <button key={qq.id} onClick={() => setStep(i)}
                style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                  background: i === step ? '#0f2744' : done ? '#c9963c' : '#e2e6ef' }} />
            )
          })}
        </div>
      </div>

      {/* Question card */}
      <div style={{ background: 'white', borderRadius: 16, border: '1.5px solid #e2e6ef', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', marginBottom: 16 }}>
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9ba5bc', letterSpacing: '0.05em' }}>السؤال {step + 1}</span>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f2744', marginTop: 6, lineHeight: 1.5 }}>
            {q.text}
            {q.required && <span style={{ color: '#e53e3e', marginRight: 4 }}>*</span>}
          </div>
        </div>
        <QuestionField
          question={q}
          value={answers[q.id]}
          onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))}
          onNavigate={onNavigate}
        />
        {q.required && !hasAns && (
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#9ba5bc' }}>• هذا السؤال إلزامي</div>
        )}
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <button onClick={prev} disabled={step === 0}
          style={{ ...S.btn('outline', true), opacity: step === 0 ? 0.4 : 1 }}>
          <ChevronRight size={16} /> السابق
        </button>
        {step < qs.length - 1 ? (
          <button onClick={next} style={S.btn('navy', true)}>
            التالي <ChevronLeft size={16} />
          </button>
        ) : (
          <button onClick={submit} disabled={submitting} style={S.btn('green')}>
            {submitting ? 'جارٍ الإرسال…' : <><Send size={15} /> إرسال الإجابات</>}
          </button>
        )}
      </div>

      <div style={{ marginTop: 14, textAlign: 'center', fontSize: '0.75rem', color: '#b0bac9' }}>
        {progress} من {qs.length} سؤال مُجاب
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MyQuestions({ toast, onNavigate }) {
  const [questionnaires, setQs] = useState([])
  const [loading, setLoading]   = useState(true)
  const [active, setActive]     = useState(null)

  useEffect(() => {
    api.listMyQuestionnaires()
      .then(d => { setQs(d.questionnaires || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (active) return (
    <QuestionnaireTaker
      questionnaire={active}
      onDone={() => { setActive(null); api.listMyQuestionnaires().then(d => setQs(d.questionnaires||[])) }}
      onNavigate={onNavigate}
      toast={toast}
    />
  )

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', color: '#0f2744', margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>استبياناتي</h2>
        <p style={{ color: '#9ba5bc', fontSize: '0.82rem', margin: '4px 0 0' }}>الاستبيانات الموجّهة إليك من الإدارة</p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : questionnaires.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', background: 'white', borderRadius: 12, border: '1px solid #e2e6ef', color: '#9ba5bc' }}>
          <FileText size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontWeight: 700, marginBottom: 6 }}>لا توجد استبيانات الآن</div>
          <div style={{ fontSize: '0.85rem' }}>ستظهر هنا الاستبيانات الموجّهة إليك</div>
        </div>
      ) : questionnaires.map(q => (
        <div key={q.id}
          style={{ background: 'white', borderRadius: 12, border: '1.5px solid #e2e6ef', marginBottom: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', transition: '0.15s' }}
          onClick={() => setActive(q)}
          onMouseEnter={e => e.currentTarget.style.borderColor='#0f2744'}
          onMouseLeave={e => e.currentTarget.style.borderColor='#e2e6ef'}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <FileText size={20} color="#0f2744" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: '#0f2744', marginBottom: 3 }}>{q.title}</div>
            {q.description && <div style={{ color: '#9ba5bc', fontSize: '0.82rem', marginBottom: 4 }}>{q.description}</div>}
            <div style={{ fontSize: '0.75rem', color: '#b0bac9' }}>{(q.questions||[]).length} سؤال</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {q.my_response ? (
              <span style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 8, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700 }}>✓ أُجيب</span>
            ) : (
              <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 8, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700 }}>جديد</span>
            )}
            <ChevronLeft size={16} color="#9ba5bc" />
          </div>
        </div>
      ))}
    </div>
  )
}
