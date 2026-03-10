import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Save, RotateCcw } from 'lucide-react'
import { api } from '../api.js'

function cleanText(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text
}

function normalizeMap(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  Object.entries(raw).forEach(([baseRaw, varsRaw]) => {
    const base = cleanText(baseRaw)
    if (!base) return

    const source = Array.isArray(varsRaw) ? varsRaw : (typeof varsRaw === 'string' ? [varsRaw] : [])
    const seen = new Set()
    const values = []
    for (const item of source) {
      const v = cleanText(item)
      if (!v || v === base || seen.has(v)) continue
      seen.add(v)
      values.push(v)
    }
    out[base] = values
  })

  return out
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid #e2e6ef',
  borderRadius: 8,
  fontFamily: 'var(--font-body)',
  fontSize: '0.9rem',
  direction: 'rtl',
  textAlign: 'right',
  outline: 'none',
  background: 'white',
}

export default function Config({ toast }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState([])

  const [baseName, setBaseName] = useState('')
  const [variationsInput, setVariationsInput] = useState('')

  function parseVariations(value) {
    const values = String(value || '')
      .split(/[\n,،]/)
      .map(cleanText)
      .filter(Boolean)
    return [...new Set(values)]
  }

  const hasRows = rows.length > 0

  const variationCount = useMemo(() => rows.reduce((sum, row) => sum + parseVariations(row.variationsText).length, 0), [rows])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const response = await api.getConfig()
      const nameVariations = normalizeMap(response?.config?.name_variations || {})
      const parsedRows = Object.entries(nameVariations).map(([base, variations]) => ({
        base,
        variationsText: variations.join('، '),
      }))
      setRows(parsedRows)
    } catch {
      toast?.('تعذر تحميل الإعدادات', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateRow = (index, key, value) => {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  }

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  const addRow = () => {
    const base = cleanText(baseName)
    const vars = parseVariations(variationsInput)

    if (!base) {
      toast?.('يرجى إدخال الاسم الأساسي', 'error')
      return
    }
    if (!vars.length) {
      toast?.('يرجى إدخال اختلاف واحد على الأقل', 'error')
      return
    }

    setRows(prev => {
      const existingIdx = prev.findIndex(r => cleanText(r.base) === base)
      if (existingIdx >= 0) {
        const current = parseVariations(prev[existingIdx].variationsText)
        const merged = [...new Set([...current, ...vars].filter(v => v !== base))]
        return prev.map((row, i) => (i === existingIdx ? { ...row, variationsText: merged.join('، ') } : row))
      }
      return [...prev, { base, variationsText: vars.filter(v => v !== base).join('، ') }]
    })

    setBaseName('')
    setVariationsInput('')
  }

  const buildPayloadMap = () => {
    const out = {}
    rows.forEach((row) => {
      const base = cleanText(row.base)
      if (!base) return

      const vars = parseVariations(row.variationsText).filter(v => v !== base)
      out[base] = vars
    })
    return out
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = { name_variations: buildPayloadMap() }
      await api.putConfig(payload)
      toast?.('تم حفظ اختلافات الأسماء', 'success')
      await loadConfig()
    } catch {
      toast?.('تعذر حفظ الإعدادات', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!confirm('سيتم حذف كل اختلافات الأسماء. هل تريد المتابعة؟')) return
    setSaving(true)
    try {
      await api.resetConfig()
      toast?.('تمت إعادة الضبط', 'success')
      await loadConfig()
    } catch {
      toast?.('تعذر إعادة الضبط', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="card-title">اختلافات الأسماء للبحث</span>
          <span style={{ fontSize: '0.78rem', color: '#9ba5bc' }}>
            {rows.length} اسم اساسي / {variationCount} اختلاف
          </span>
        </div>

        <div className="card-body" style={{ display: 'grid', gap: 14 }}>
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e6ef',
            borderRadius: 10,
            padding: 12,
            fontSize: '0.83rem',
            color: '#4a5568',
            lineHeight: 1.7,
          }}>
            أدخل اسما اساسيا واختلافاته. مثال: العودة {'->'} معايعة. عند البحث عن اي اسم، سيبحث النظام ايضا في الاختلافات المعرفة له.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                الاسم الاساسي
              </label>
              <input
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                placeholder="مثال: العودة"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4a5568', marginBottom: 5, display: 'block' }}>
                الاختلافات (افصل بفاصلة)
              </label>
              <input
                value={variationsInput}
                onChange={(e) => setVariationsInput(e.target.value)}
                placeholder="مثال: معايعة، عوده"
                style={inputStyle}
              />
            </div>
            <button className="btn btn-gold btn-sm" onClick={addRow} style={{ gap: 6, whiteSpace: 'nowrap' }}>
              <Plus size={14} /> إضافة
            </button>
          </div>

          {hasRows ? (
            <div style={{ border: '1px solid #e2e6ef', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ background: '#f8f9fb', borderBottom: '1px solid #e2e6ef' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الاسم الاساسي</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: '#4a5568', fontWeight: 700 }}>الاختلافات</th>
                    <th style={{ padding: '10px 12px', width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`row-${index}`} style={{ borderBottom: index < rows.length - 1 ? '1px solid #f1f4f9' : 'none' }}>
                      <td style={{ padding: 10 }}>
                        <input
                          value={row.base}
                          onChange={(e) => updateRow(index, 'base', e.target.value)}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <input
                          value={row.variationsText}
                          onChange={(e) => updateRow(index, 'variationsText', e.target.value)}
                          placeholder="افصل بفاصلة"
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: 10 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red)' }}
                          onClick={() => removeRow(index)}
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
          ) : (
            <div style={{ textAlign: 'center', color: '#9ba5bc', padding: '18px 0', fontSize: '0.86rem' }}>
              لا توجد اختلافات أسماء مضافة بعد.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleReset} disabled={saving} style={{ gap: 6 }}>
              <RotateCcw size={14} /> إعادة ضبط
            </button>
            <button className="btn btn-gold btn-sm" onClick={handleSave} disabled={saving} style={{ gap: 6 }}>
              <Save size={14} /> {saving ? 'جار الحفظ...' : 'حفظ التغييرات'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
