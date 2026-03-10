import { useEffect, useState } from 'react'
import { Users, Plus, Trash2, RefreshCw, X, Search, ShieldCheck, User, Download, Copy, Check, Pencil } from 'lucide-react'
import { api } from '../api.js'

function Badge({ children, color = 'navy' }) {
  const colors = {
    navy:  { bg: '#eef4ff', color: '#0f2744', border: '#c5d8f8' },
    gold:  { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
    green: { bg: '#e8f8f0', color: '#1a7a45', border: '#a7f3d0' },
    gray:  { bg: '#f0f2f7', color: '#4a5568', border: '#e2e6ef' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>{children}</span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
        width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#0f2744', padding: '14px 20px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}><X size={18}/></button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}

function InputRow({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#4a5568', display: 'block', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ef',
  borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: '0.9rem',
  direction: 'rtl', textAlign: 'right', outline: 'none',
}

export default function UserManagement({ toast }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCreds, setShowCreds] = useState(null) // { currentUsername, nextUsername }
  const [genResult, setGenResult] = useState(null)
  const [copied, setCopied] = useState(null)

  // Add user form
  const [form, setForm] = useState({ username: '', password: '', role: 'member', person_type: 'registered', person_id: '' })
  const [formErr, setFormErr] = useState('')

  // Credentials change form
  const [nextUsername, setNextUsername] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  const load = () => {
    setLoading(true)
    api.listUsersBasic().then(d => { setUsers(d.users || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return !q || u.username.toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q)
  })

  const handleAdd = async () => {
    if (!form.username.trim() || !form.password) { setFormErr('اسم المستخدم وكلمة المرور مطلوبان'); return }
    try {
      await api.createUser({
        username:    form.username.trim().toLowerCase(),
        password:    form.password,
        role:        form.role,
        person_type: form.role === 'admin' ? null : form.person_type,
        person_id:   form.role === 'admin' ? null : (form.person_id || null),
      })
      toast('تم إنشاء المستخدم', 'success')
      setShowAdd(false)
      setForm({ username: '', password: '', role: 'member', person_type: 'registered', person_id: '' })
      setFormErr('')
      load()
    } catch (e) {
      const msg = e.message?.includes('409') ? 'اسم المستخدم موجود مسبقاً' : 'حدث خطأ'
      setFormErr(msg)
    }
  }

  const handleDelete = async (username) => {
    if (!confirm(`حذف المستخدم "${username}"؟`)) return
    await api.deleteUser(username)
    toast('تم حذف المستخدم', 'success')
    load()
  }

  const openCredentialsModal = (username) => {
    setShowCreds({ currentUsername: username, nextUsername: username })
    setNextUsername(username)
    setNewPw('')
    setConfirmPw('')
  }

  const handleChangeCredentials = async () => {
    if (!showCreds?.currentUsername) return

    const currentUsername = (showCreds.currentUsername || '').toLowerCase()
    const desiredUsername = (nextUsername || '').trim().toLowerCase()
    if (!desiredUsername) {
      toast('اسم المستخدم مطلوب', 'error')
      return
    }

    const body = {}
    if (desiredUsername !== currentUsername) body.username = desiredUsername
    if (newPw && newPw !== confirmPw) {
      toast('تأكيد كلمة المرور غير مطابق', 'error')
      return
    }
    if (newPw) body.password = newPw
    if (!Object.keys(body).length) {
      setShowCreds(null)
      setNewPw('')
      return
    }

    try {
      await api.updateUser(currentUsername, body)
      toast('تم تحديث بيانات الدخول', 'success')
      setShowCreds(null)
      setNewPw('')
      setConfirmPw('')
      load()
    } catch (e) {
      if ((e.message || '').includes('409')) toast('اسم المستخدم موجود مسبقاً', 'error')
      else toast('تعذر تحديث بيانات الدخول', 'error')
    }
  }

  const handleGenerateAll = async () => {
    if (!confirm('إنشاء حسابات تلقائية لجميع الأعضاء الذين ليس لديهم حسابات؟')) return
    const res = await api.generateAll()
    setGenResult(res)
    load()
    toast(`تم إنشاء ${res.created} حساب جديد`, 'success')
  }

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const downloadCSV = (accounts) => {
    const header = 'الاسم,اسم المستخدم,كلمة المرور,نوع العضو,معرّف الشخص'
    const rows = accounts.map(a =>
      `"${a.display_name}","${a.username}","${a.password}","${a.person_type === 'registered' ? 'مسجّل' : 'غير مسجّل'}","${a.person_id}"`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'jec-accounts.csv'
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ba5bc' }}/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث عن مستخدم…"
            style={{ ...inputStyle, paddingRight: 36, width: '100%' }}/>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleGenerateAll} style={{ gap: 6, whiteSpace: 'nowrap' }}>
          <RefreshCw size={14}/> توليد تلقائي للكل
        </button>
        <button className="btn btn-gold btn-sm" onClick={() => setShowAdd(true)} style={{ gap: 6, whiteSpace: 'nowrap' }}>
          <Plus size={14}/> مستخدم جديد
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'إجمالي المستخدمين', val: users.length, color: '#0f2744' },
          { label: 'المدراء',            val: users.filter(u => u.role === 'admin').length, color: '#c9963c' },
          { label: 'الأعضاء',            val: users.filter(u => u.role === 'member').length, color: '#1a7a45' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'white', borderRadius: 12, padding: '12px 20px',
            border: '1px solid #e2e6ef', boxShadow: '0 1px 4px rgba(15,39,68,0.06)',
            flex: 1, minWidth: 120,
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: '0.78rem', color: '#6b778f', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner"/></div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
            <thead>
              <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                {['اسم المستخدم','الاسم الكامل','الدور','نوع العضو','معرّف الشخص',''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#4a5568', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.username} style={{ borderBottom: '1px solid #f0f2f7' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafbff'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#0f2744' }}>
                    {u.username}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{u.display_name || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {u.role === 'admin'
                      ? <Badge color="gold"><ShieldCheck size={11}/> مدير</Badge>
                      : <Badge color="green"><User size={11}/> عضو</Badge>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {u.person_type === 'registered'   && <Badge color="navy">مسجّل</Badge>}
                    {u.person_type === 'unregistered' && <Badge color="gray">غير مسجّل</Badge>}
                    {!u.person_type                   && <span style={{ color: '#9ba5bc' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.82rem', color: '#6b778f' }}>
                    {u.person_id ?? '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" style={{ gap: 5, fontSize: '0.78rem' }}
                        onClick={() => openCredentialsModal(u.username)}>
                        <Pencil size={12}/> تعديل اسم المستخدم/كلمة المرور
                      </button>
                      {u.username !== 'admin' && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', gap: 5, fontSize: '0.78rem' }}
                          onClick={() => handleDelete(u.username)}>
                          <Trash2 size={12}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9ba5bc' }}>لا توجد نتائج</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add user modal */}
      {showAdd && (
        <Modal title="إضافة مستخدم جديد" onClose={() => { setShowAdd(false); setFormErr('') }}>
          {formErr && <div style={{ background: '#fdecea', border: '1px solid #ef9a9a', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: '0.83rem', color: '#c62828' }}>{formErr}</div>}
          <InputRow label="اسم المستخدم *">
            <input style={inputStyle} value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="username"/>
          </InputRow>
          <InputRow label="كلمة المرور *">
            <input style={inputStyle} type="text" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••"/>
          </InputRow>
          <InputRow label="الدور">
            <select style={inputStyle} value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="member">عضو</option>
              <option value="admin">مدير</option>
            </select>
          </InputRow>
          {form.role === 'member' && (
            <>
              <InputRow label="نوع العضو">
                <select style={inputStyle} value={form.person_type}
                  onChange={e => setForm(f => ({ ...f, person_type: e.target.value }))}>
                  <option value="registered">مسجّل</option>
                  <option value="unregistered">غير مسجّل</option>
                </select>
              </InputRow>
              <InputRow label="معرّف الشخص (person_id)">
                <input style={inputStyle} value={form.person_id}
                  onChange={e => setForm(f => ({ ...f, person_id: e.target.value }))}
                  placeholder="123 أو uuid..."/>
              </InputRow>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(false)}>إلغاء</button>
            <button className="btn btn-gold btn-sm" onClick={handleAdd}>إنشاء</button>
          </div>
        </Modal>
      )}

      {/* Change credentials modal */}
      {showCreds && (
        <Modal title={`تعديل بيانات الدخول: ${showCreds.currentUsername}`} onClose={() => { setShowCreds(null); setNewPw(''); setConfirmPw('') }}>
          <InputRow label="اسم المستخدم الجديد">
            <input style={inputStyle} type="text" value={nextUsername}
              onChange={e => setNextUsername(e.target.value)} placeholder="username"/>
          </InputRow>
          <InputRow label="كلمة المرور الجديدة (اختياري)">
            <input style={inputStyle} type="text" value={newPw}
              onChange={e => setNewPw(e.target.value)} placeholder="أدخل كلمة المرور الجديدة"
              onKeyDown={e => e.key === 'Enter' && handleChangeCredentials()}/>
          </InputRow>
          <InputRow label="تأكيد كلمة المرور الجديدة">
            <input style={inputStyle} type="text" value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)} placeholder="أعد إدخال كلمة المرور الجديدة"
              onKeyDown={e => e.key === 'Enter' && handleChangeCredentials()}/>
          </InputRow>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowCreds(null); setConfirmPw('') }}>إلغاء</button>
            <button className="btn btn-gold btn-sm" onClick={handleChangeCredentials}>حفظ</button>
          </div>
        </Modal>
      )}

      {/* Generate-all results modal */}
      {genResult && (
        <Modal title={`تم إنشاء ${genResult.created} حساب جديد`} onClose={() => setGenResult(null)}>
          {genResult.created === 0 ? (
            <p style={{ color: '#6b778f', textAlign: 'center', padding: 16 }}>جميع الأعضاء لديهم حسابات مسبقاً</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button className="btn btn-ghost btn-sm" style={{ gap: 6 }}
                  onClick={() => downloadCSV(genResult.accounts)}>
                  <Download size={13}/> تنزيل CSV
                </button>
              </div>
              <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid #e2e6ef', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8f9fb', zIndex: 1 }}>
                    <tr>
                      {['الاسم','اسم المستخدم','كلمة المرور'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#4a5568', borderBottom: '1px solid #e2e6ef' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {genResult.accounts.map((a, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f2f7' }}>
                        <td style={{ padding: '7px 12px' }}>{a.display_name}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'monospace' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {a.username}
                            <button onClick={() => copyText(a.username, `u${i}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 2 }}>
                              {copied === `u${i}` ? <Check size={12} color="#1a7a45"/> : <Copy size={12}/>}
                            </button>
                          </span>
                        </td>
                        <td style={{ padding: '7px 12px', fontFamily: 'monospace' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {a.password}
                            <button onClick={() => copyText(a.password, `p${i}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ba5bc', padding: 2 }}>
                              {copied === `p${i}` ? <Check size={12} color="#1a7a45"/> : <Copy size={12}/>}
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setGenResult(null)}>إغلاق</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
