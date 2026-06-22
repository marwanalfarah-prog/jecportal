import { Suspense, lazy, useState } from 'react'
import { Eye, EyeOff, Lock, User, UserPlus, Check } from 'lucide-react'
import { api, getApiErrorMessage } from '../api.js'

const Profile = lazy(() => import('./Profile.jsx'))

function Field({ label, required, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#4a5568', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#e53e3e', marginRight: 3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: '0.72rem', color: '#9ba5bc', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

export default function Registration({ onComplete, onBack, loggedInUser, toast }) {
  const [step, setStep] = useState(1)
  const [profilePayload, setProfilePayload] = useState(null)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState(null)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const checkUsername = async (u) => {
    if (!u || u.length < 3) { setUsernameAvailable(null); return }
    setCheckingUsername(true)
    try {
      const d = await api.checkUsername(u)
      setUsernameAvailable(d.available)
    } catch { setUsernameAvailable(null) }
    finally { setCheckingUsername(false) }
  }

  const handleUsernameChange = (val) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, '')
    setUsername(clean)
    setUsernameAvailable(null)
    clearTimeout(window.__usernameCheckTimer)
    window.__usernameCheckTimer = setTimeout(() => checkUsername(clean), 500)
  }

  const handleProfileNext = (payload) => {
    setProfilePayload(payload)
    setStep(2)
    setError('')
  }

  const handleSubmit = async () => {
    if (!username.trim()) { setError('اسم المستخدم مطلوب'); return }
    if (usernameAvailable === false) { setError('اسم المستخدم مستخدم مسبقاً'); return }
    if (!password) { setError('كلمة المرور مطلوبة'); return }
    if (password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return }
    if (password !== confirmPw) { setError('كلمات المرور غير متطابقة'); return }

    setLoading(true); setError('')
    try {
      const body = {
        ...profilePayload,
        username: username.trim().toLowerCase(),
        password,
      }
      const result = await api.submitRegistration(body)
      onComplete(result.user)
    } catch (err) {
      setError(getApiErrorMessage(err, 'حدث خطأ أثناء التسجيل'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f2744 0%, #1a3a5c 50%, #2d5986 100%)',
      fontFamily: 'var(--font-body)', direction: 'rtl',
    }}>
      {/* Step 1: Full Profile form */}
      {step === 1 && (
        <div>
          {/* Step indicator header */}
          <div style={{ padding: '20px 24px 0', textAlign: 'center' }}>
            <img src="/api/logo" alt="JEC" style={{ width: 48, height: 48, objectFit: 'contain', marginBottom: 8 }} />
            <h1 style={{ color: 'white', fontFamily: 'var(--font-head)', fontSize: '1.3rem', margin: '0 0 4px' }}>تسجيل عضو جديد</h1>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.82rem', margin: '0 0 16px' }}>الخطوة ١ من ٢ — البيانات الشخصية</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
              {[1, 2].map(s => (
                <div key={s} style={{
                  width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: s === 1 ? '#c9963c' : 'rgba(255,255,255,0.15)',
                  color: 'white', fontWeight: 700, fontSize: '0.82rem',
                }}>{s}</div>
              ))}
            </div>
          </div>

          {/* Profile component in registrationMode — render in a light container */}
          <div style={{ background: 'var(--cream, #f8f9fb)', minHeight: '60vh', padding: '0 0 40px' }}>
            <Suspense fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
                <div className="spinner" />
              </div>
            }>
              <div className="registration-step-one-shell">
                <Profile
                  registrationMode={true}
                  onRegistrationNext={handleProfileNext}
                  onBack={onBack}
                  toast={toast || ((msg, type) => { if (type === 'error') setError(msg) })}
                  currentUser={loggedInUser || null}
                />
              </div>
            </Suspense>
          </div>
        </div>
      )}

      {/* Step 2: Credentials */}
      {step === 2 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', minHeight: '100vh', padding: '24px 16px' }}>
          <div style={{ width: '100%', maxWidth: 440 }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <img src="/api/logo" alt="JEC" style={{ width: 52, height: 52, objectFit: 'contain', marginBottom: 10 }} />
              <h1 style={{ color: 'white', fontFamily: 'var(--font-head)', fontSize: '1.3rem', margin: '0 0 4px' }}>تسجيل عضو جديد</h1>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.82rem', margin: '0 0 16px' }}>الخطوة ٢ من ٢ — بيانات الدخول</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 0 }}>
                {[1, 2].map(s => (
                  <div key={s} style={{
                    width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: s <= 2 ? (s === 1 ? '#2d6a4f' : '#c9963c') : 'rgba(255,255,255,0.15)',
                    color: 'white', fontWeight: 700, fontSize: '0.82rem',
                  }}>
                    {s === 1 ? <Check size={14} /> : s}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ padding: '24px 28px 28px' }}>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#9ba5bc', fontSize: '0.83rem', fontFamily: 'var(--font-body)', marginBottom: 20 }}
                >
                  ← العودة لتعديل البيانات الشخصية
                </button>

                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#eef4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                    <UserPlus size={22} color="#0f2744" />
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f2744', margin: '0 0 4px' }}>أنشئ حسابك</h3>
                  <p style={{ fontSize: '0.8rem', color: '#9ba5bc', margin: 0 }}>ستستخدم هذه البيانات لتسجيل الدخول</p>
                </div>

                {error && (
                  <div style={{ background: '#fdecea', border: '1px solid #ef9a9a', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: '0.85rem', color: '#c62828' }}>
                    ⚠ {error}
                  </div>
                )}

                <Field label="اسم المستخدم" required hint="أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط (٣ أحرف على الأقل)">
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}>
                      <User size={15} />
                    </div>
                    <input
                      type="text"
                      value={username}
                      onChange={e => handleUsernameChange(e.target.value)}
                      placeholder="my_username"
                      dir="ltr"
                      style={{
                        width: '100%', padding: '10px 36px 10px 40px',
                        border: `1.5px solid ${usernameAvailable === false ? '#ef9a9a' : usernameAvailable === true ? '#68d391' : '#e2e6ef'}`,
                        borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'ltr',
                        background: '#fafbfc', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    {checkingUsername && (
                      <div style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid #c5d8f8', borderTopColor: '#0f2744', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    )}
                    {!checkingUsername && usernameAvailable === true && (
                      <div style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#38a169' }}><Check size={15} /></div>
                    )}
                    {!checkingUsername && usernameAvailable === false && (
                      <div style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#e53e3e', fontWeight: 700, fontSize: '0.9rem' }}>✗</div>
                    )}
                  </div>
                  {usernameAvailable === false && <div style={{ color: '#e53e3e', fontSize: '0.77rem', marginTop: 4 }}>هذا الاسم مستخدم مسبقاً</div>}
                  {usernameAvailable === true && <div style={{ color: '#38a169', fontSize: '0.77rem', marginTop: 4 }}>هذا الاسم متاح ✓</div>}
                </Field>

                <Field label="كلمة المرور" required>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}>
                      <Lock size={15} />
                    </div>
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="٦ أحرف على الأقل"
                      style={{
                        width: '100%', padding: '10px 36px 10px 40px',
                        border: '1.5px solid #e2e6ef', borderRadius: 8,
                        fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'ltr',
                        background: '#fafbfc', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', display: 'flex' }}>
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>

                <Field label="تأكيد كلمة المرور" required>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}>
                      <Lock size={15} />
                    </div>
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="أعد كتابة كلمة المرور"
                      style={{
                        width: '100%', padding: '10px 36px 10px 12px',
                        border: `1.5px solid ${confirmPw && password !== confirmPw ? '#ef9a9a' : '#e2e6ef'}`,
                        borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.9rem', direction: 'ltr',
                        background: '#fafbfc', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  {confirmPw && password !== confirmPw && <div style={{ color: '#e53e3e', fontSize: '0.77rem', marginTop: 4 }}>كلمات المرور غير متطابقة</div>}
                </Field>

                <div style={{ background: '#fffbf0', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginTop: 8, marginBottom: 20, fontSize: '0.82rem', color: '#92400e' }}>
                  <strong>ملاحظة:</strong> سيتم مراجعة طلبك من قِبَل الفريق قبل تفعيل حسابك. ستتمكن من متابعة حالة طلبك بعد تسجيل الدخول.
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || usernameAvailable === false}
                  style={{
                    width: '100%', padding: '13px',
                    background: loading || usernameAvailable === false ? '#9ba5bc' : 'linear-gradient(135deg, #0f2744, #2d5986)',
                    color: 'white', border: 'none', borderRadius: 10,
                    fontFamily: 'var(--font-head)', fontSize: '1rem', fontWeight: 700,
                    cursor: loading || usernameAvailable === false ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  {loading ? (
                    <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} /> جارٍ الإرسال…</>
                  ) : (
                    <><UserPlus size={18} /> إرسال طلب التسجيل</>
                  )}
                </button>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: 16, color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>
              JEC Member Manager © 2025
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
