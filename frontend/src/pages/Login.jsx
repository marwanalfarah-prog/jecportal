import { useState } from 'react'
import { LogIn, Eye, EyeOff, Lock, User } from 'lucide-react'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async () => {
    if (!username.trim() || !password) { setError('يرجى إدخال اسم المستخدم وكلمة المرور'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'خطأ في تسجيل الدخول'); return }
      onLogin(data.user)
    } catch {
      setError('تعذّر الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f2744 0%, #1a3a5c 50%, #2d5986 100%)',
      fontFamily: 'var(--font-body)', direction: 'rtl',
    }}>
      {/* Decorative circles */}
      <div style={{ position: 'fixed', top: -100, right: -100, width: 400, height: 400,
        borderRadius: '50%', background: 'rgba(201,150,60,0.08)', pointerEvents: 'none' }}/>
      <div style={{ position: 'fixed', bottom: -120, left: -80, width: 350, height: 350,
        borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }}/>

      <div style={{
        background: 'white', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        width: '100%', maxWidth: 420, overflow: 'hidden', position: 'relative', zIndex: 1,
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #0f2744, #2d5986)',
          padding: '36px 32px 28px', textAlign: 'center',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(201,150,60,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Lock size={28} color="#c9963c"/>
          </div>
          <h1 style={{
            fontFamily: 'var(--font-head)', fontSize: '1.6rem', fontWeight: 900,
            color: 'white', letterSpacing: '-0.5px', marginBottom: 4,
          }}>JEC</h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', fontWeight: 400 }}>
            نظام إدارة الأعضاء
          </p>
        </div>

        {/* Form */}
        <div style={{ padding: '32px 32px 28px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f2744', marginBottom: 24, textAlign: 'center' }}>
            تسجيل الدخول
          </h2>

          {error && (
            <div style={{
              background: '#fdecea', border: '1px solid #ef9a9a', borderRadius: 10,
              padding: '10px 14px', marginBottom: 18, fontSize: '0.86rem', color: '#c62828',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* Username */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 6 }}>
              اسم المستخدم
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}>
                <User size={16}/>
              </div>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="أدخل اسم المستخدم"
                autoComplete="username"
                style={{
                  width: '100%', padding: '11px 40px 11px 14px',
                  border: '1.5px solid #e2e6ef', borderRadius: 10,
                  fontFamily: 'var(--font-body)', fontSize: '0.95rem',
                  direction: 'rtl', textAlign: 'right',
                  outline: 'none', transition: '0.2s',
                  background: '#fafbfc',
                }}
                onFocus={e => e.target.style.borderColor = '#0f2744'}
                onBlur={e => e.target.style.borderColor = '#e2e6ef'}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 6 }}>
              كلمة المرور
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}>
                <Lock size={16}/>
              </div>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder="أدخل كلمة المرور"
                autoComplete="current-password"
                style={{
                  width: '100%', padding: '11px 40px 11px 40px',
                  border: '1.5px solid #e2e6ef', borderRadius: 10,
                  fontFamily: 'var(--font-body)', fontSize: '0.95rem',
                  direction: 'rtl', textAlign: 'right',
                  outline: 'none', transition: '0.2s',
                  background: '#fafbfc',
                }}
                onFocus={e => e.target.style.borderColor = '#0f2744'}
                onBlur={e => e.target.style.borderColor = '#e2e6ef'}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc',
                  padding: 2, display: 'flex',
                }}
              >
                {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%', padding: '12px',
              background: loading ? '#9ba5bc' : 'linear-gradient(135deg, #0f2744, #2d5986)',
              color: 'white', border: 'none', borderRadius: 10,
              fontFamily: 'var(--font-head)', fontSize: '1rem', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: '0.2s', boxShadow: '0 4px 16px rgba(15,39,68,0.25)',
            }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white', borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite', display: 'inline-block',
                }}/>
                جارٍ التحقق…
              </span>
            ) : (
              <>
                <LogIn size={18}/> دخول
              </>
            )}
          </button>
        </div>

        <div style={{
          textAlign: 'center', padding: '0 32px 20px',
          fontSize: '0.75rem', color: '#9ba5bc',
        }}>
          JEC Member Manager © 2025
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: #c8cfe0 !important; }
      `}</style>
    </div>
  )
}
