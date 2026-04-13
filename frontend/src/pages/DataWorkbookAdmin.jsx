import { useEffect, useState } from 'react'
import { AlertTriangle, Database, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'

import { api } from '../api.js'


function toCellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}


function parseCellValue(rawValue, sampleValue) {
  const text = typeof rawValue === 'string' ? rawValue : toCellText(rawValue)
  const trimmed = text.trim()

  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return null

  const sampleType = sampleValue === null || sampleValue === undefined ? null : typeof sampleValue
  if (sampleType === 'boolean' || /^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true'
  }

  if (sampleType === 'number') {
    const asNumber = Number(trimmed)
    return Number.isNaN(asNumber) ? text : asNumber
  }

  if (sampleType === 'object') {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}


function buildEmptyRow(columns) {
  const nextRow = {}
  for (const column of columns) nextRow[column] = ''
  return nextRow
}


function rowMatchesQuery(row, columns, query) {
  const text = String(query || '').trim().toLowerCase()
  if (!text) return true

  for (const column of columns) {
    if (String(column || '').toLowerCase().includes(text)) return true
    if (toCellText(row?.[column]).toLowerCase().includes(text)) return true
  }
  return false
}


const panelStyle = {
  background: 'white',
  border: '1px solid var(--gray-200)',
  borderRadius: 18,
  boxShadow: 'var(--shadow-sm)',
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid var(--gray-200)',
  borderRadius: 10,
  fontFamily: 'var(--font-body)',
  fontSize: '0.9rem',
  direction: 'rtl',
  textAlign: 'right',
  outline: 'none',
  background: 'white',
}


export default function DataWorkbookAdmin({ toast }) {
  const [tables, setTables] = useState([])
  const [tablesLoading, setTablesLoading] = useState(true)
  const [tablesError, setTablesError] = useState('')
  const [selectedSheet, setSelectedSheet] = useState('')
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [originalRows, setOriginalRows] = useState([])
  const [sheetLoading, setSheetLoading] = useState(false)
  const [sheetError, setSheetError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [sheetSearch, setSheetSearch] = useState('')
  const [rowSearch, setRowSearch] = useState('')
  const [globalSearch, setGlobalSearch] = useState('')
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalResults, setGlobalResults] = useState([])
  const [globalTotal, setGlobalTotal] = useState(0)
  const [highlightedRowIndex, setHighlightedRowIndex] = useState(null)

  const loadTables = async (preferredSheet = null) => {
    setTablesLoading(true)
    setTablesError('')
    try {
      const data = await api.listDataTables()
      const nextTables = Array.isArray(data?.tables) ? data.tables : []
      setTables(nextTables)

      const preferred = preferredSheet || selectedSheet
      if (preferred && nextTables.some((table) => table.sheet === preferred)) {
        setSelectedSheet(preferred)
      } else if (!selectedSheet && nextTables.length > 0) {
        setSelectedSheet(nextTables[0].sheet)
      } else if (nextTables.length === 0) {
        setSelectedSheet('')
      }
    } catch (error) {
      setTablesError('تعذر تحميل جداول المصنف')
    } finally {
      setTablesLoading(false)
    }
  }

  const loadSheet = async (sheetName) => {
    if (!sheetName) return
    setSheetLoading(true)
    setSheetError('')
    try {
      const data = await api.getDataTable(sheetName)
      const nextColumns = Array.isArray(data?.columns) ? data.columns : []
      const nextRows = Array.isArray(data?.rows) ? data.rows : []
      setColumns(nextColumns)
      setRows(nextRows)
      setOriginalRows(nextRows)
      setDirty(false)
    } catch (error) {
      setColumns([])
      setRows([])
      setOriginalRows([])
      setSheetError('تعذر تحميل بيانات الورقة المحددة')
    } finally {
      setSheetLoading(false)
    }
  }

  useEffect(() => {
    loadTables()
  }, [])

  useEffect(() => {
    loadSheet(selectedSheet)
  }, [selectedSheet])

  useEffect(() => {
    const query = String(globalSearch || '').trim()
    if (query.length < 2) {
      setGlobalResults([])
      setGlobalTotal(0)
      setGlobalSearchLoading(false)
      return undefined
    }

    const timer = window.setTimeout(async () => {
      setGlobalSearchLoading(true)
      try {
        const data = await api.searchDataTables(query, 120)
        setGlobalResults(Array.isArray(data?.results) ? data.results : [])
        setGlobalTotal(Number(data?.total_matches || 0))
      } catch {
        setGlobalResults([])
        setGlobalTotal(0)
      } finally {
        setGlobalSearchLoading(false)
      }
    }, 250)

    return () => window.clearTimeout(timer)
  }, [globalSearch])

  useEffect(() => {
    if (highlightedRowIndex === null || !selectedSheet) return
    const element = document.getElementById(`data-row-${selectedSheet}-${highlightedRowIndex}`)
    if (element) element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selectedSheet, rows, highlightedRowIndex])

  const filteredTables = tables.filter((table) => {
    const query = String(sheetSearch || '').trim().toLowerCase()
    if (!query) return true
    if (String(table?.sheet || '').toLowerCase().includes(query)) return true
    return (Array.isArray(table?.columns) ? table.columns : []).some((column) => String(column || '').toLowerCase().includes(query))
  })

  const filteredRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => rowMatchesQuery(row, columns, rowSearch))

  const selectedTableMeta = tables.find((table) => table.sheet === selectedSheet) || null

  const getColumnSampleValue = (column) => {
    for (const row of originalRows) {
      const value = row?.[column]
      if (value !== null && value !== undefined && value !== '') return value
    }
    return null
  }

  const handleCellChange = (rowIndex, column, value) => {
    setRows((currentRows) => {
      const nextRows = currentRows.slice()
      nextRows[rowIndex] = { ...(nextRows[rowIndex] || {}), [column]: value }
      return nextRows
    })
    setDirty(true)
  }

  const handleAddRow = () => {
    if (!columns.length) return
    setRows((currentRows) => [buildEmptyRow(columns), ...currentRows])
    setDirty(true)
    setHighlightedRowIndex(0)
  }

  const handleDeleteRow = (rowIndex) => {
    setRows((currentRows) => currentRows.filter((_, index) => index !== rowIndex))
    setDirty(true)
  }

  const handleReset = () => {
    setRows(originalRows)
    setDirty(false)
    setHighlightedRowIndex(null)
    toast?.('تمت إعادة الورقة إلى آخر نسخة محفوظة', 'success')
  }

  const handleRefresh = async () => {
    await Promise.all([loadTables(selectedSheet), loadSheet(selectedSheet)])
    toast?.('تم تحديث البيانات', 'success')
  }

  const handleSave = async () => {
    if (!selectedSheet) return
    setSaving(true)
    try {
      const payload = rows.map((row, rowIndex) => {
        const nextRow = {}
        for (const column of columns) {
          nextRow[column] = parseCellValue(row?.[column], originalRows?.[rowIndex]?.[column] ?? getColumnSampleValue(column))
        }
        return nextRow
      })

      await api.updateDataTable(selectedSheet, payload)
      await Promise.all([loadTables(selectedSheet), loadSheet(selectedSheet)])
      toast?.('تم حفظ الورقة بنجاح', 'success')
    } catch {
      toast?.('تعذر حفظ التعديلات', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openGlobalSearchResult = async (result) => {
    const sheetName = String(result?.sheet || '').trim()
    if (!sheetName) return
    setSelectedSheet(sheetName)
    setRowSearch('')
    setHighlightedRowIndex(Number(result?.row_index))
    await loadSheet(sheetName)
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={{ ...panelStyle, padding: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 42, height: 42, borderRadius: 14, background: 'rgba(15,39,68,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Database size={18} color="var(--navy)" />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--navy)' }}>JECJordanData</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--gray-500)' }}>تصفح أوراق المصنف، وابحث عبرها، وعدّل الصفوف مباشرة من الواجهة</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240, position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
              <input
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="بحث شامل داخل جميع الأوراق..."
                style={{ ...inputStyle, paddingRight: 36 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ padding: '8px 12px', borderRadius: 999, background: 'var(--gray-50)', border: '1px solid var(--gray-200)', fontSize: '0.8rem', color: 'var(--gray-600)' }}>
                {tables.length} ورقة
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 999, background: 'var(--gray-50)', border: '1px solid var(--gray-200)', fontSize: '0.8rem', color: 'var(--gray-600)' }}>
                {selectedTableMeta?.row_count ?? rows.length} صف
              </div>
            </div>
          </div>
        </div>

        {String(globalSearch || '').trim().length >= 2 ? (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--gray-100)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--navy)' }}>نتائج البحث الشامل</div>
              <div style={{ fontSize: '0.77rem', color: 'var(--gray-500)' }}>
                {globalSearchLoading ? 'جارٍ البحث...' : `${globalTotal} نتيجة`}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {!globalSearchLoading && globalResults.length === 0 ? (
                <div style={{ color: 'var(--gray-500)', fontSize: '0.84rem', padding: '8px 0' }}>لا توجد نتائج مطابقة</div>
              ) : null}

              {globalResults.map((result, index) => (
                <button
                  key={`${result.sheet}-${result.row_index}-${index}`}
                  type="button"
                  onClick={() => openGlobalSearchResult(result)}
                  style={{
                    textAlign: 'right',
                    border: '1px solid var(--gray-200)',
                    background: 'white',
                    borderRadius: 12,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontWeight: 800, color: 'var(--navy)' }}>{result.sheet}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>صف #{Number(result.row_index) + 1}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--gray-600)' }}>{result.preview || 'بدون معاينة متاحة'}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--gold)' }}>{(result.matching_columns || []).join(' - ')}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="data-workbook-layout" style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <aside className="data-workbook-sidebar" style={{ ...panelStyle, padding: 18, position: 'sticky', top: 92 }}>
          <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 12 }}>الأوراق</div>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
            <input
              value={sheetSearch}
              onChange={(event) => setSheetSearch(event.target.value)}
              placeholder="ابحث باسم الورقة أو الأعمدة"
              style={{ ...inputStyle, paddingRight: 36 }}
            />
          </div>

          {tablesLoading ? <div className="spinner" style={{ margin: '22px auto' }} /> : null}
          {tablesError ? <div style={{ color: 'var(--red)', fontSize: '0.82rem' }}>{tablesError}</div> : null}

          <div style={{ display: 'grid', gap: 8, maxHeight: '70vh', overflowY: 'auto' }}>
            {filteredTables.map((table) => {
              const active = table.sheet === selectedSheet
              return (
                <button
                  key={table.sheet}
                  type="button"
                  onClick={() => {
                    setSelectedSheet(table.sheet)
                    setHighlightedRowIndex(null)
                  }}
                  style={{
                    textAlign: 'right',
                    border: active ? '1px solid rgba(201,150,60,0.45)' : '1px solid var(--gray-200)',
                    background: active ? 'linear-gradient(135deg, rgba(201,150,60,0.14), rgba(255,255,255,0.98))' : 'white',
                    borderRadius: 14,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 800, color: 'var(--navy)' }}>{table.sheet}</span>
                    <span style={{ fontSize: '0.74rem', color: active ? 'var(--gold)' : 'var(--gray-500)' }}>{table.row_count} صف</span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--gray-500)' }}>{(table.columns || []).length} عمود</div>
                </button>
              )
            })}
          </div>
        </aside>

        <section style={{ ...panelStyle, overflow: 'hidden' }}>
          <div style={{ padding: 18, borderBottom: '1px solid var(--gray-100)', display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--navy)' }}>
                    {selectedSheet || 'اختر ورقة'}
                  </div>
                  {dirty ? (
                    <span style={{ padding: '4px 10px', borderRadius: 999, background: '#fff7e8', color: '#9c6b14', border: '1px solid #f0d39a', fontSize: '0.75rem', fontWeight: 700 }}>
                      غير محفوظ
                    </span>
                  ) : null}
                </div>
                <div style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--gray-500)' }}>
                  {columns.length} عمود • {rows.length} صف
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={!selectedSheet || sheetLoading || saving}>
                  <RefreshCw size={14} /> تحديث
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleReset} disabled={!dirty || saving}>
                  <X size={14} /> تراجع
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAddRow} disabled={!selectedSheet || sheetLoading || saving || columns.length === 0}>
                  <Plus size={14} /> صف جديد
                </button>
                <button type="button" className="btn btn-gold btn-sm" onClick={handleSave} disabled={!selectedSheet || !dirty || sheetLoading || saving}>
                  <Save size={14} /> {saving ? 'جارٍ الحفظ...' : 'حفظ'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 280px' }}>
                <Search size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
                <input
                  value={rowSearch}
                  onChange={(event) => setRowSearch(event.target.value)}
                  placeholder="بحث داخل الصفوف الحالية"
                  style={{ ...inputStyle, paddingRight: 36 }}
                />
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{filteredRows.length} نتيجة ظاهرة</div>
            </div>
          </div>

          {sheetError ? (
            <div style={{ padding: 22, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={16} />
              {sheetError}
            </div>
          ) : null}

          {sheetLoading ? (
            <div style={{ padding: 28, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
          ) : null}

          {!sheetLoading && !sheetError && selectedSheet ? (
            <div style={{ overflow: 'auto', maxHeight: '75vh' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: Math.max(880, columns.length * 180) }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--gray-50)', padding: '12px 10px', borderBottom: '1px solid var(--gray-200)', textAlign: 'center', fontSize: '0.8rem', color: 'var(--navy)', minWidth: 64 }}>#</th>
                    <th style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--gray-50)', padding: '12px 10px', borderBottom: '1px solid var(--gray-200)', textAlign: 'center', fontSize: '0.8rem', color: 'var(--navy)', minWidth: 84 }}>إجراء</th>
                    {columns.map((column) => (
                      <th key={column} style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--gray-50)', padding: '12px 10px', borderBottom: '1px solid var(--gray-200)', textAlign: 'right', fontSize: '0.8rem', color: 'var(--navy)', minWidth: 180 }}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} style={{ padding: 28, textAlign: 'center', color: 'var(--gray-500)' }}>
                        لا توجد صفوف مطابقة
                      </td>
                    </tr>
                  ) : null}

                  {filteredRows.map(({ row, index }) => {
                    const isHighlighted = highlightedRowIndex === index
                    return (
                      <tr key={`${selectedSheet}-${index}`} id={`data-row-${selectedSheet}-${index}`} style={{ background: isHighlighted ? 'rgba(201,150,60,0.12)' : 'white' }}>
                        <td style={{ padding: 10, borderBottom: '1px solid var(--gray-100)', textAlign: 'center', color: 'var(--gray-500)', fontSize: '0.8rem', verticalAlign: 'top' }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: 10, borderBottom: '1px solid var(--gray-100)', textAlign: 'center', verticalAlign: 'top' }}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            style={{ paddingInline: 10 }}
                            onClick={() => handleDeleteRow(index)}
                          >
                            <Trash2 size={13} /> حذف
                          </button>
                        </td>
                        {columns.map((column) => {
                          const sampleValue = originalRows?.[index]?.[column] ?? getColumnSampleValue(column)
                          const currentValue = row?.[column]
                          const isBooleanField = typeof sampleValue === 'boolean' || typeof currentValue === 'boolean'
                          const isLongTextField = !isBooleanField && toCellText(currentValue).length > 60
                          const commonFieldStyle = {
                            ...inputStyle,
                            minWidth: 150,
                            fontSize: '0.82rem',
                            padding: '8px 10px',
                            borderRadius: 8,
                          }

                          return (
                            <td key={`${selectedSheet}-${index}-${column}`} style={{ padding: 10, borderBottom: '1px solid var(--gray-100)', verticalAlign: 'top' }}>
                              {isBooleanField ? (
                                <select
                                  value={currentValue === true ? 'true' : currentValue === false ? 'false' : toCellText(currentValue)}
                                  onChange={(event) => handleCellChange(index, column, event.target.value)}
                                  style={commonFieldStyle}
                                >
                                  <option value="">فارغ</option>
                                  <option value="true">true</option>
                                  <option value="false">false</option>
                                </select>
                              ) : isLongTextField ? (
                                <textarea
                                  value={toCellText(currentValue)}
                                  onChange={(event) => handleCellChange(index, column, event.target.value)}
                                  rows={3}
                                  style={{ ...commonFieldStyle, resize: 'vertical' }}
                                />
                              ) : (
                                <input
                                  value={toCellText(currentValue)}
                                  onChange={(event) => handleCellChange(index, column, event.target.value)}
                                  style={commonFieldStyle}
                                />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}