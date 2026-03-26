import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  GitBranch, Search, X, Plus, Save, Trash2, UserPlus,
  Camera, AlertCircle, Link, Link2Off, ArrowRight, Sparkles, CheckCircle, ExternalLink,
  Calendar, ChevronDown, Clock, FileDown
} from 'lucide-react'
import { api } from '../api.js'

// ── Arabic normalization ───────────────────────────────────────────────────────
function normalizeWord(w) {
  w = String(w)
    .replace(/[\u0617-\u061A\u064B-\u0652]/g,'').replace(/\u0640/g,'')
    .replace(/[إأآا]/g,'ا').replace(/[يى]/g,'ي').replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/^ال/,'')
  return w.toLowerCase().trim()
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

function normalizePersonTitles(raw) {
  const entries = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const titles = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const arabicTitle = String(entry.arabic_title || entry.arabic || entry.title || entry.name || '').replace(/\s+/g, ' ').trim()
    const englishTitle = String(entry.english_title || entry.english || '').replace(/\s+/g, ' ').trim()
    if (!arabicTitle || seen.has(arabicTitle)) continue
    seen.add(arabicTitle)
    titles.push({ arabic_title: arabicTitle, english_title: englishTitle })
  }
  return titles
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

function nameMatchesQuery(parts, qWordGroups) {
  if (!qWordGroups.length) return true
  const partMatches = (part, alternatives) => alternatives.some(alt => part.includes(alt))

  if (qWordGroups.every(group => parts.some(p => partMatches(p, group)))) return true
  let pi=0,qi=0
  while(pi<parts.length&&qi<qWordGroups.length){if(partMatches(parts[pi],qWordGroups[qi]))qi++;pi++}
  return qi===qWordGroups.length
}

// ── ID gen ────────────────────────────────────────────────────────────────────
let _id = 1
const uid = () => `n${Date.now()}_${_id++}`

// ── Node dimensions ───────────────────────────────────────────────────────────
const NODE_MIN_W  = 160
const NODE_MAX_W  = 220
const NODE_BASE_H = 100
const NODE_EXTRA_H = 15
const H_GAP  = 22
const V_GAP  = 84

function estimateTextW(text, fontSize, bold = false) {
  if (!text) return 0
  const charW = bold ? fontSize * 0.62 : fontSize * 0.56
  return text.length * charW
}

function wrapText(text, fontSize, maxW, bold = false) {
  if (!text) return ['']
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (estimateTextW(test, fontSize, bold) > maxW && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function nodeSize(node) {
  const displayName = nodeDisplayName(node) || 'بدون اسم'
  const role = node.role || 'بدون دور'
  const TEXT_PAD = 16
  const nameW = estimateTextW(displayName, 12, true) + TEXT_PAD * 2
  const candidateW = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, nameW))
  const roleLines = wrapText(role, 10, candidateW - TEXT_PAD * 2, false)
  const roleLineMaxW = Math.max(...roleLines.map(l => estimateTextW(l, 10, false)))
  const w = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, nameW, roleLineMaxW + TEXT_PAD * 2))
  const h = NODE_BASE_H + Math.max(0, roleLines.length - 1) * NODE_EXTRA_H
  return { w, h, roleLines }
}

function isDeputyRole(role) {
  return typeof role === 'string' && role.includes('نائب')
}
function shortName(fullName) {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 2) return fullName
  return parts[0] + ' ' + parts[parts.length - 1]
}

function nodeDisplayName(node) {
  const base = node.baseName || node.name || ''
  const parts = base.trim().split(/\s+/).filter(Boolean)
  let firstName = '', lastName = ''
  if (parts.length === 1) { firstName = parts[0] }
  else if (parts.length >= 2) { firstName = parts[0]; lastName = parts[parts.length - 1] }
  const namePart = [firstName, lastName].filter(Boolean).join(' ')
  if (node.personType === 'مكرّس' && node.laqab) {
    return `${node.laqab.trim()} ${namePart}`.trim()
  }
  return namePart || shortName(node.name || '')
}

function firstNameInitial(value) {
  const firstToken = String(value ?? '').trim().split(/\s+/).find(Boolean)
  return firstToken?.[0] || '؟'
}

function today() { return new Date().toISOString().slice(0, 10) }
function formatDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return d }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIDY LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
function computeTidyLayout(nodes, edges) {
  if (!nodes.length) return {}
  const nW = {}, nH = {}
  nodes.forEach(n => { const s = nodeSize(n); nW[n.id] = s.w; nH[n.id] = s.h })

  const hierarchyEdges = edges.filter(e => e.type === 'hierarchy')
  const peerEdges      = edges.filter(e => e.type === 'peer')

  const childrenOf = {}, parentsOf = {}
  nodes.forEach(n => { childrenOf[n.id] = []; parentsOf[n.id] = [] })
  hierarchyEdges.forEach(e => {
    if (childrenOf[e.from] !== undefined && parentsOf[e.to] !== undefined) {
      childrenOf[e.from].push(e.to)
      parentsOf[e.to].push(e.from)
    }
  })

  // Sort each node's children by insertion order in the nodes array,
  // so newly added nodes always appear on the right of existing siblings.
  const nodeIndex = Object.fromEntries(nodes.map((n, i) => [n.id, i]))
  Object.keys(childrenOf).forEach(id => {
    childrenOf[id].sort((a, b) => (nodeIndex[a] ?? 0) - (nodeIndex[b] ?? 0))
  })

  const rootIds = nodes.filter(n => parentsOf[n.id].length === 0).map(n => n.id)
  rootIds.sort((a, b) => (nodeIndex[a] ?? 0) - (nodeIndex[b] ?? 0))
  const depthOf = {}
  nodes.forEach(n => { depthOf[n.id] = 0 })

  const inDeg = {}
  nodes.forEach(n => { inDeg[n.id] = parentsOf[n.id].length })
  const bfsQueue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id)
  const bfsVisited = new Set(bfsQueue)
  while (bfsQueue.length) {
    const id = bfsQueue.shift()
    ;(childrenOf[id] || []).forEach(cid => {
      depthOf[cid] = Math.max(depthOf[cid], depthOf[id] + 1)
      inDeg[cid]--
      if (inDeg[cid] <= 0 && !bfsVisited.has(cid)) { bfsVisited.add(cid); bfsQueue.push(cid) }
    })
  }

  const TREE_GAP = 60
  const layoutChildrenOf = {}
  nodes.forEach(n => { layoutChildrenOf[n.id] = [...(childrenOf[n.id] || [])] })

  const subtreeW = {}, wMeasured = new Set()
  function measureWidth(id) {
    if (wMeasured.has(id)) return subtreeW[id] ?? nW[id] ?? NODE_MIN_W
    wMeasured.add(id)
    const myW = nW[id] ?? NODE_MIN_W
    const kids = layoutChildrenOf[id] || []
    if (kids.length === 0) { subtreeW[id] = myW; return myW }
    let total = 0
    kids.forEach((kid, i) => { total += measureWidth(kid); if (i < kids.length - 1) total += H_GAP })
    subtreeW[id] = Math.max(myW, total)
    return subtreeW[id]
  }
  rootIds.forEach(id => measureWidth(id))
  nodes.forEach(n => { if (!wMeasured.has(n.id)) measureWidth(n.id) })

  const posX = {}, xPlaced = new Set()
  function assignX(id, leftEdge) {
    if (xPlaced.has(id)) return
    xPlaced.add(id)
    const sw = subtreeW[id] ?? (nW[id] ?? NODE_MIN_W)
    posX[id] = leftEdge + sw / 2
    const kids = layoutChildrenOf[id] || []
    if (!kids.length) return
    const kidsTotal = kids.reduce((s, k, i) => s + (subtreeW[k] ?? (nW[k] ?? NODE_MIN_W)) + (i < kids.length - 1 ? H_GAP : 0), 0)
    let cur = posX[id] - kidsTotal / 2
    kids.forEach(kid => { assignX(kid, cur); cur += (subtreeW[kid] ?? (nW[kid] ?? NODE_MIN_W)) + H_GAP })
  }

  let cursor = 0
  rootIds.forEach(id => { assignX(id, cursor); cursor += (subtreeW[id] ?? (nW[id] ?? NODE_MIN_W)) + TREE_GAP })
  nodes.forEach(n => {
    if (!xPlaced.has(n.id)) { assignX(n.id, cursor); cursor += (nW[n.id] ?? NODE_MIN_W) + TREE_GAP }
  })

  const TOP_OFFSET = 80
  const maxHAtDepth = {}
  nodes.forEach(n => {
    const d = Math.floor(depthOf[n.id] ?? 0)
    const h = nH[n.id] ?? NODE_BASE_H
    maxHAtDepth[d] = Math.max(maxHAtDepth[d] ?? NODE_BASE_H, h)
  })
  const depthY = {}
  let yOff = TOP_OFFSET
  const maxDepth = Math.max(0, ...Object.keys(maxHAtDepth).map(Number))
  for (let d = 0; d <= maxDepth; d++) {
    depthY[d] = yOff + (maxHAtDepth[d] ?? NODE_BASE_H) / 2
    yOff += (maxHAtDepth[d] ?? NODE_BASE_H) + V_GAP
  }

  const positions = {}
  nodes.forEach(n => {
    const depth = depthOf[n.id] ?? 0
    const depthFloor = Math.floor(depth)
    const depthFrac  = depth - depthFloor
    const baseY = depthY[depthFloor] ?? (TOP_OFFSET + depthFloor * (NODE_BASE_H + V_GAP))
    const nextY = depthY[depthFloor + 1] ?? (baseY + NODE_BASE_H + V_GAP)
    positions[n.id] = { x: posX[n.id] ?? 0, y: baseY + depthFrac * (nextY - baseY) }
  })
  return positions
}

function edgePath(fromNode, toNode, edgeType) {
  const fx = fromNode.x, fy = fromNode.y
  const tx = toNode.x,   ty = toNode.y
  const fromH = nodeSize(fromNode).h
  const toH   = nodeSize(toNode).h
  if (edgeType === 'peer') {
    const mx = (fx + tx) / 2
    return `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`
  }
  const fromBottom = fy + fromH / 2
  const toTop      = ty - toH / 2
  const my = (fromBottom + toTop) / 2
  return `M ${fx} ${fromBottom} C ${fx} ${my}, ${tx} ${my}, ${tx} ${toTop}`
}

// ── Period badge ──────────────────────────────────────────────────────────────
function getPeriodLabel(period, isActive) {
  if (!period) return isActive ? 'الفترة الحالية' : 'فترة سابقة'
  if (period.label) return period.label
  if (period.jec_year && period.from_date) return `${period.jec_year} — فترة ${period.from_date}`
  if (period.from_date) return `فترة ${period.from_date}`
  if (period.jec_year) return `${period.jec_year} — فترة`
  return isActive ? 'الفترة الحالية' : 'فترة سابقة'
}

function PeriodBadge({ period, periods, onClick }) {
  if (!period && !periods?.length) return null
  const isActive = period && !period.to_date
  const year = period?.jec_year ? `${period.jec_year} ·` : ''
  return (
    <button onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:20,
      background: isActive ? '#e8f5e9' : '#f5f5f5',
      border: `1.5px solid ${isActive ? '#4caf50' : '#bdbdbd'}`,
      color: isActive ? '#2e7d32' : '#616161',
      fontSize:'0.8rem', fontWeight:700, cursor:'pointer', fontFamily:'var(--font-body)',
    }}>
      <Clock size={13}/>
      {year} {getPeriodLabel(period, isActive)}
      {' · '}{period?.from_date ? formatDate(period.from_date) : 'غير محدد'}
      {' — '}{isActive ? 'الآن' : formatDate(period?.to_date)}
      <ChevronDown size={13}/>
    </button>
  )
}

// ── Unified save modal ────────────────────────────────────────────────────────
function UnifiedSaveModal({ currentPeriod, periods, onSaveToPeriod, onConfirmNewPeriod, onCancel }) {
  const todayStr = today()
  // 'same' | 'active' | 'new'
  const [mode, setMode]           = useState(null)
  const [jecYear, setJecYear]     = useState(currentPeriod?.jec_year ? String(currentPeriod.jec_year) : new Date().getFullYear().toString())
  const [fromDate, setFromDate]   = useState(todayStr)
  const [toDate, setToDate]       = useState('')
  const [toPresentDay, setToPresent] = useState(true)
  const [error, setError]         = useState('')

  const hasActivePeriod = periods.some(p => !p.to_date)

  const validateForm = () => {
    if (!jecYear || !/^\d{4}$/.test(jecYear.trim())) {
      setError('يرجى إدخال سنة JEC صحيحة (4 أرقام)'); return false
    }
    if (!fromDate) { setError('يرجى تحديد تاريخ البداية'); return false }
    if (fromDate > todayStr) { setError('لا يمكن تحديد تاريخ بداية في المستقبل'); return false }
    if (!toPresentDay) {
      if (!toDate) { setError('يرجى تحديد تاريخ النهاية أو اختيار "حتى الآن"'); return false }
      if (toDate > todayStr) { setError('لا يمكن تحديد تاريخ نهاية في المستقبل'); return false }
      if (toDate < fromDate) { setError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية'); return false }
    }
    // Overlap check — skip the current period (being replaced if active, or irrelevant if closed)
    const endToCheck = toPresentDay ? todayStr : toDate
    for (const p of (periods || [])) {
      if (p.id === currentPeriod?.id) continue
      if (!p.to_date) continue  // active period being closed — not a conflict
      const s = p.from_date || '0000-01-01'
      const overlaps = fromDate <= p.to_date && endToCheck >= s
      if (overlaps) { setError('هذه الفترة تتداخل مع فترة موجودة، يرجى تعديل التواريخ'); return false }
    }
    setError(''); return true
  }

  const handleConfirm = () => {
    if (mode === 'same') { onSaveToPeriod(); return }
    if (!validateForm()) return
    const isActive = mode === 'active'
    onConfirmNewPeriod({
      jec_year:  parseInt(jecYear.trim(), 10),
      from_date: fromDate,
      to_date:   isActive ? null : (toPresentDay ? null : toDate),
    }, isActive)
  }

  const inputStyle = {
    width:'100%', padding:'8px 10px', border:'1.5px solid var(--gray-200)',
    borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.9rem',
    direction:'rtl', textAlign:'right', boxSizing:'border-box',
  }

  const optionBtn = (id, title, sub, accent) => {
    const selected = mode === id
    const colors = {
      navy:  { border:'var(--navy)', bg:'#eef4ff', titleColor:'var(--navy)',  subColor:'#3b5998' },
      gold:  { border:'var(--gold)', bg:'#fffbeb', titleColor:'#92400e',     subColor:'#a16207' },
      green: { border:'#4caf50',     bg:'#f1faf1', titleColor:'#1b5e20',     subColor:'#388e3c' },
    }
    const c = colors[accent] || colors.navy
    return (
      <button type="button" onClick={() => { setMode(id); setError('') }} style={{
        padding:'12px 16px', borderRadius:'var(--radius-md)', textAlign:'right', width:'100%',
        border: `1.5px solid ${selected ? c.border : 'var(--gray-200)'}`,
        background: selected ? c.bg : 'white',
        cursor:'pointer', fontFamily:'var(--font-body)', transition:'all 0.15s',
        display:'flex', alignItems:'center', gap:12,
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.borderColor = c.border; e.currentTarget.style.background = c.bg } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.borderColor = 'var(--gray-200)'; e.currentTarget.style.background = 'white' } }}>
        <span style={{
          width:18, height:18, borderRadius:'50%', border:`2px solid ${selected ? c.border : 'var(--gray-300)'}`,
          background: selected ? c.border : 'white', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          {selected && <span style={{ width:7, height:7, borderRadius:'50%', background:'white', display:'block' }}/>}
        </span>
        <div>
          <div style={{ fontWeight:700, fontSize:'0.88rem', color: selected ? c.titleColor : 'var(--gray-700)' }}>{title}</div>
          <div style={{ fontSize:'0.77rem', color: selected ? c.subColor : 'var(--gray-400)', marginTop:2 }}>{sub}</div>
        </div>
      </button>
    )
  }

  const showForm = mode === 'active' || mode === 'new'
  const isNewActive = mode === 'active'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={{ background:'white', borderRadius:'var(--radius-lg)', boxShadow:'var(--shadow-lg)', width:460, overflow:'hidden', fontFamily:'var(--font-body)', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ background:'var(--navy)', padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:1 }}>
          <span style={{ color:'white', fontWeight:700, fontSize:'1rem', display:'flex', alignItems:'center', gap:8 }}>
            <Save size={16}/> حفظ التغييرات
          </span>
          <button onClick={onCancel} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer' }}><X size={18}/></button>
        </div>

        <div style={{ padding:20 }}>
          {/* Three options */}
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom: showForm ? 18 : 0 }}>
            {optionBtn('same',
              'حفظ في نفس الفترة',
              currentPeriod ? `${formatDate(currentPeriod.from_date)} — ${currentPeriod.to_date ? formatDate(currentPeriod.to_date) : 'الآن'}` : '—',
              'navy'
            )}
            {!hasActivePeriod && optionBtn('active',
              'حفظ كالفترة الجارية',
              'تحديد تواريخ جديدة وجعلها الفترة الحالية',
              'green'
            )}
            {optionBtn('new',
              'حفظ كفترة جديدة',
              'إنشاء فترة منفصلة بتواريخ مختلفة',
              'gold'
            )}
          </div>

          {/* Date/year form — shown for active or new */}
          {showForm && (
            <div style={{ borderTop:'1px solid var(--gray-100)', paddingTop:16 }}>
              {error && (
                <div style={{ background:'#fdecea', border:'1px solid #ef9a9a', borderRadius:'var(--radius-md)', padding:'8px 12px', marginBottom:12, fontSize:'0.82rem', color:'#c62828' }}>
                  {error}
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>سنة JEC *</label>
                  <input value={jecYear} onChange={e => setJecYear(e.target.value)} placeholder="2026" style={inputStyle}/>
                </div>
                <div>
                  <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>تاريخ البداية *</label>
                  <input type="date" value={fromDate} max={todayStr} onChange={e => setFromDate(e.target.value)} style={inputStyle}/>
                </div>
              </div>
              {!isNewActive && (
                <div style={{ marginBottom:12 }}>
                  <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:6 }}>تاريخ النهاية</label>
                  <button type="button" onClick={() => setToPresent(v => !v)} style={{
                    display:'flex', alignItems:'center', gap:8, marginBottom: toPresentDay ? 0 : 8,
                    padding:'7px 12px', borderRadius:'var(--radius-md)', cursor:'pointer',
                    border:`1.5px solid ${toPresentDay ? 'var(--navy)' : 'var(--gray-200)'}`,
                    background: toPresentDay ? '#eef4ff' : 'white',
                    color: toPresentDay ? 'var(--navy)' : 'var(--gray-500)',
                    fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:600, width:'100%',
                  }}>
                    <span style={{ width:16, height:16, borderRadius:4, border:`2px solid ${toPresentDay ? 'var(--navy)' : 'var(--gray-300)'}`, background: toPresentDay ? 'var(--navy)' : 'white', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {toPresentDay && <span style={{ color:'white', fontSize:'0.65rem' }}>✓</span>}
                    </span>
                    حتى الآن
                  </button>
                  {!toPresentDay && (
                    <input type="date" value={toDate} max={todayStr} min={fromDate || undefined} onChange={e => setToDate(e.target.value)} style={inputStyle}/>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {mode && (
            <div style={{ display:'flex', gap:10, marginTop: showForm ? 4 : 16 }}>
              <button onClick={handleConfirm} style={{ flex:1, padding:'11px', borderRadius:'var(--radius-md)', background:'var(--navy)', border:'none', color:'white', fontFamily:'var(--font-body)', fontSize:'0.9rem', fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                <Save size={15}/> حفظ
              </button>
              <button onClick={onCancel} style={{ padding:'11px 18px', borderRadius:'var(--radius-md)', background:'white', border:'1.5px solid var(--gray-200)', color:'var(--gray-600)', fontFamily:'var(--font-body)', fontSize:'0.9rem', cursor:'pointer' }}>
                إلغاء
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE SYSTEM FOR الأمانة العامة
// ─────────────────────────────────────────────────────────────────────────────

// Extra fixed positions (not committee/project)
const GS_EXTRA_LEADERSHIP = [
  'منسق الشرق الأوسط',
  'نائب منسق الشرق الأوسط',
  'مدير مكتب الأمانة',
]

// Committees of the General Secretariat
const GS_COMMITTEES = [
  'لجنة الخدمة',
  'لجنة الإعلام',
  'لجنة الابتكار',
  'لجنة العلاقات العامة',
  'لجنة التدريب والتطوير',
  'لجنة تطوير شبيبات الشمال',
  'لجنة تطوير شبيبات الوسط',
  'لجنة تطوير شبيبات الجنوب',
  'لجنة النشاطات',
]

// Projects
const GS_PROJECTS = [
  'شبيبة ستور',
  'الفرقة الموسيقيّة JEC Band',
  'عائلات الشبيبة',
  'الاستشارات',
  'المسرح',
]

const ACTING_PREFIX = 'قائم بأعمال '

// Build committee head/member role string
function buildCommitteeTitle(committees, memberType) {
  if (!committees || !committees.length) return ''
  const name = committees.length === 1 ? committees[0] : committees.join(' و ')
  if (memberType === 'مسؤول') return `مسؤول ${name}`
  if (memberType === 'عضو لجنة') return `عضو ${name}`
  return name
}

// Build project role string
function buildProjectTitle(project, memberType) {
  if (!project) return ''
  if (project === 'شبيبة ستور') {
    // special roles
    if (memberType === 'مسؤول') return `مسؤول ${project}`
    if (memberType === 'مدير')  return `مدير ${project}`
    if (memberType === 'موظف')  return `موظف ${project}`
  }
  if (memberType === 'مسؤول') return `مسؤول ${project}`
  if (memberType === 'عضو')   return `عضو ${project}`
  return ''
}

// Parse role back to structured form
function parseGSRole(role) {
  if (!role) return { type: null }
  const isActing = role.startsWith(ACTING_PREFIX)
  if (isActing) role = role.slice(ACTING_PREFIX.length)
  const base = parseGSRoleBase(role)
  return { ...base, isActing }
}

function parseGSRoleBase(role) {
  if (!role) return { type: null }

  // Tab 1 — leadership
  if (role === 'الأمين العام' || role === 'نائب الأمين العام' || role === 'المرشد الروحيّ العام' || role === 'مساعد المرشد الروحي' || role === 'منسق الشرق الأوسط' || role === 'مدير مكتب الأمانة')
    return { type: 'leadership', value: role }

  // Tab 2 — committee
  const tryParseComs = (str) => {
    const parts = str.split(/\s+و\s*|\s*و\s+/).map(s => s.trim()).filter(Boolean)
    if (parts.length && parts.every(p => GS_COMMITTEES.includes(p))) return parts
    return null
  }
  // head: مسؤول <name>
  if (role.startsWith('مسؤول ')) {
    const rest = role.slice('مسؤول '.length)
    const headParts = tryParseComs(rest)
    if (headParts) return { type: 'committee', committees: headParts, memberType: 'مسؤول' }
  }
  // member: عضو <name>
  if (role.startsWith('عضو ')) {
    const rest = role.slice('عضو '.length)
    const memParts = tryParseComs(rest)
    if (memParts) return { type: 'committee', committees: memParts, memberType: 'عضو لجنة' }
  }

  // Tab 3 — project
  for (const proj of GS_PROJECTS) {
    if (role === `مسؤول ${proj}`) return { type: 'project', project: proj, memberType: 'مسؤول' }
    if (role === `مدير ${proj}`)  return { type: 'project', project: proj, memberType: 'مدير' }
    if (role === `موظف ${proj}`)  return { type: 'project', project: proj, memberType: 'موظف' }
    if (role === `عضو ${proj}`)   return { type: 'project', project: proj, memberType: 'عضو' }
  }

  return { type: null, unknownValue: role }
}

const GS_ROLE_TABS = [
  { id: 'leadership', label: 'القيادة' },
  { id: 'committee',  label: 'اللجان' },
  { id: 'project',    label: 'المشاريع' },
]

function GSRolePicker({ role, currentReportsToHeadId, allNodes, onChange }) {
  const parsed = parseGSRole(role)

  const [tab, setTab]                         = useState(parsed.type || null)
  const [leaderValue, setLeaderValue]         = useState(parsed.type === 'leadership' ? parsed.value : '')
  const [selectedCommittees, setSelComm]      = useState(parsed.type === 'committee' ? (parsed.committees || []) : [])
  const [committeeMemberType, setCommMT]      = useState(parsed.memberType || 'مسؤول')
  const [selectedProject, setSelProj]         = useState(parsed.type === 'project' ? (parsed.project || '') : '')
  const [projectMemberType, setProjMT]        = useState(parsed.type === 'project' ? (parsed.memberType || 'مسؤول') : 'مسؤول')
  const [isActing, setIsActing]               = useState(parsed.isActing || false)
  // Which specific head this member follows (node id), null = auto-pick
  const [reportsToHeadId, setReportsToHeadId] = useState(currentReportsToHeadId || null)

  // Compute potential heads for the currently selected committees
  const baseRole = (r) => r?.startsWith(ACTING_PREFIX) ? r.slice(ACTING_PREFIX.length) : (r || '')
  const potentialHeads = (allNodes || []).filter(n => {
    const nc = classifyGSRole(n.role)
    if (!nc || nc.tier !== 'committee_head') return false
    const headComs = nc.committeeKey.split(/ و /).map(s => s.trim())
    return selectedCommittees.some(c => headComs.includes(c))
  })
  // Only show the head picker when there are 2+ heads for the same committees
  const showHeadPicker = committeeMemberType === 'عضو لجنة' && potentialHeads.length >= 2

  // When committees/memberType change, reset reportsToHeadId if it no longer applies
  useEffect(() => {
    if (!showHeadPicker) {
      // If only 1 or 0 heads, clear the pinned head — auto-wiring handles it
      setReportsToHeadId(null)
    }
  }, [showHeadPicker]) // eslint-disable-line react-hooks/exhaustive-deps

  const computeRole = useCallback((
    t = tab, lv = leaderValue, coms = selectedCommittees, cmt = committeeMemberType,
    proj = selectedProject, pmt = projectMemberType, acting = isActing
  ) => {
    let base = ''
    if (t === 'leadership') base = lv
    else if (t === 'committee') base = buildCommitteeTitle(coms, cmt)
    else if (t === 'project') base = buildProjectTitle(proj, pmt)
    if (!base) return ''
    return acting ? `${ACTING_PREFIX}${base}` : base
  }, [tab, leaderValue, selectedCommittees, committeeMemberType, selectedProject, projectMemberType, isActing])

  useEffect(() => {
    const r = computeRole()
    if (r) onChange(r, reportsToHeadId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, leaderValue, selectedCommittees, committeeMemberType, selectedProject, projectMemberType, isActing, reportsToHeadId])

  const preview = computeRole()

  const sectionStyle = { marginBottom:10, padding:'10px 12px', background:'var(--gray-50)', borderRadius:'var(--radius-md)', border:'1px solid var(--gray-200)' }
  const labelStyle   = { fontSize:'0.72rem', fontWeight:700, color:'var(--gray-400)', marginBottom:6, display:'block', letterSpacing:'0.04em' }
  const chipBase     = { display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:20, fontSize:'0.78rem', fontWeight:600, cursor:'pointer', border:'1.5px solid', transition:'all 0.15s', fontFamily:'var(--font-body)' }
  const chipActive   = { ...chipBase, background:'var(--navy)', borderColor:'var(--navy)', color:'white' }
  const chipInactive = { ...chipBase, background:'white', borderColor:'var(--gray-200)', color:'var(--gray-600)' }
  const checkBase    = { display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:6, fontSize:'0.8rem', fontWeight:600, cursor:'pointer', border:'1.5px solid', transition:'all 0.15s', fontFamily:'var(--font-body)' }
  const checkActive  = { ...checkBase, background:'#eef4ff', borderColor:'var(--navy)', color:'var(--navy)' }
  const checkInactive= { ...checkBase, background:'white', borderColor:'var(--gray-200)', color:'var(--gray-500)' }
  const rowBtn = (active) => ({ ...chipBase, borderRadius:6, width:'100%', justifyContent:'flex-start', padding:'6px 12px', ...(active ? { background:'var(--navy)', borderColor:'var(--navy)', color:'white' } : { background:'white', borderColor:'var(--gray-200)', color:'var(--gray-700)' }) })

  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:6 }}>المسؤولية / الدور</label>

      {/* Tabs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:3, marginBottom:10 }}>
        {GS_ROLE_TABS.map(({ id, label }) => (
          <button key={id} type="button"
            style={{ padding:'5px 4px', borderRadius:8, fontSize:'0.72rem', fontWeight:700, cursor:'pointer', border:'1.5px solid', transition:'all 0.15s', fontFamily:'var(--font-body)', textAlign:'center', lineHeight:1.3, ...(tab===id ? { background:'var(--navy)', borderColor:'var(--navy)', color:'white' } : { background:'white', borderColor:'var(--gray-200)', color:'var(--gray-600)' }) }}
            onClick={() => setTab(id === tab ? null : id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1 — Leadership */}
      {tab === 'leadership' && (
        <div style={sectionStyle}>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {['الأمين العام','نائب الأمين العام','المرشد الروحيّ العام','مساعد المرشد الروحي','منسق الشرق الأوسط','نائب منسق الشرق الأوسط','مدير مكتب الأمانة'].map(r => (
              <button key={r} type="button" style={rowBtn(leaderValue===r)} onClick={()=>setLeaderValue(r)}>{r}</button>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2 — Committee */}
      {tab === 'committee' && (
        <div style={sectionStyle}>
          <span style={labelStyle}>اللجان (يمكن اختيار أكثر من واحدة)</span>
          <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:10 }}>
            {GS_COMMITTEES.map(c => {
              const checked = selectedCommittees.includes(c)
              return (
                <button key={c} type="button"
                  style={{ ...rowBtn(checked), justifyContent:'space-between' }}
                  onClick={() => setSelComm(prev => prev.includes(c) ? prev.filter(x=>x!==c) : [...prev,c])}>
                  <span>{c}</span>
                  <span style={{ width:16, height:16, borderRadius:4, flexShrink:0, border:`2px solid ${checked?'white':'var(--gray-300)'}`, background:checked?'rgba(255,255,255,0.3)':'white', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'0.65rem', color:checked?'white':'transparent' }}>✓</span>
                </button>
              )
            })}
          </div>
          <span style={labelStyle}>الصفة</span>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom: showHeadPicker ? 10 : 0 }}>
            {['مسؤول','عضو لجنة'].map(mt => (
              <button key={mt} type="button" style={committeeMemberType===mt ? checkActive : checkInactive} onClick={()=>setCommMT(mt)}>{mt}</button>
            ))}
          </div>

          {/* ── Head picker: shown only when 2+ heads share the same committee ── */}
          {showHeadPicker && (
            <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--gray-200)' }}>
              <span style={{ ...labelStyle, color:'#c9963c', display:'flex', alignItems:'center', gap:5 }}>
                <span>⚠</span> يوجد أكثر من مسؤول لهذه اللجنة — اختر من يتبعه هذا العضو:
              </span>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {potentialHeads.map(head => {
                  const isSelected = reportsToHeadId === head.id
                  const displayName = nodeDisplayName(head) || head.name || 'بدون اسم'
                  const headRole = head.role || ''
                  return (
                    <button key={head.id} type="button"
                      onClick={() => setReportsToHeadId(isSelected ? null : head.id)}
                      style={{
                        display:'flex', alignItems:'center', gap:10,
                        padding:'8px 12px', borderRadius:8, cursor:'pointer',
                        border: `2px solid ${isSelected ? 'var(--navy)' : 'var(--gray-200)'}`,
                        background: isSelected ? '#eef4ff' : 'white',
                        fontFamily:'var(--font-body)', textAlign:'right', transition:'all 0.15s',
                      }}>
                      {/* Mini avatar */}
                      <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--navy)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, overflow:'hidden' }}>
                        {head.photo
                          ? <img src={head.photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                          : <span style={{ color:'white', fontSize:'0.65rem', fontWeight:700 }}>{firstNameInitial(head.baseName || head.name || displayName)}</span>
                        }
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:'0.85rem', color: isSelected ? 'var(--navy)' : 'var(--gray-800)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {displayName}
                        </div>
                        <div style={{ fontSize:'0.72rem', color:'var(--gold)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {headRole}
                        </div>
                      </div>
                      <div style={{ width:18, height:18, borderRadius:4, border:`2px solid ${isSelected ? 'var(--navy)' : 'var(--gray-300)'}`, background: isSelected ? 'var(--navy)' : 'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        {isSelected && <span style={{ color:'white', fontSize:'0.6rem', fontWeight:800 }}>✓</span>}
                      </div>
                    </button>
                  )
                })}
                {reportsToHeadId && (
                  <button type="button" onClick={() => setReportsToHeadId(null)}
                    style={{ fontSize:'0.75rem', color:'var(--gray-400)', background:'none', border:'none', cursor:'pointer', textAlign:'right', padding:'2px 4px', fontFamily:'var(--font-body)' }}>
                    ✕ إلغاء التحديد (تحديد تلقائي)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3 — Project */}
      {tab === 'project' && (
        <div style={sectionStyle}>
          <span style={labelStyle}>المشاريع</span>
          <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:10 }}>
            {GS_PROJECTS.map(p => (
              <button key={p} type="button" style={rowBtn(selectedProject===p)} onClick={()=>setSelProj(p)}>{p}</button>
            ))}
          </div>
          {selectedProject && (
            <>
              <span style={labelStyle}>الصفة</span>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {selectedProject === 'شبيبة ستور'
                  ? ['مسؤول','مدير','موظف'].map(mt => (
                      <button key={mt} type="button" style={projectMemberType===mt ? checkActive : checkInactive} onClick={()=>setProjMT(mt)}>{mt}</button>
                    ))
                  : ['مسؤول','عضو'].map(mt => (
                      <button key={mt} type="button" style={projectMemberType===mt ? checkActive : checkInactive} onClick={()=>setProjMT(mt)}>{mt}</button>
                    ))
                }
              </div>
            </>
          )}
        </div>
      )}

      {/* قائم بأعمال */}
      {tab && (
        <button type="button"
          style={isActing
            ? { ...checkBase, background:'#fff8e1', borderColor:'#e8b55a', color:'#92400e', marginBottom:6, width:'100%', justifyContent:'space-between' }
            : { ...checkBase, background:'white', borderColor:'var(--gray-200)', color:'var(--gray-500)', marginBottom:6, width:'100%', justifyContent:'space-between' }
          }
          onClick={()=>setIsActing(v=>!v)}>
          <span>قائم بأعمال</span>
          <span style={{ width:16, height:16, borderRadius:4, flexShrink:0, border:`2px solid ${isActing?'#c9963c':'var(--gray-300)'}`, background:isActing?'#c9963c':'white', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'0.65rem', color:isActing?'white':'transparent' }}>✓</span>
        </button>
      )}

      {/* Preview */}
      {preview && (
        <div style={{ marginTop:8, padding:'6px 12px', background:'#eef4ff', borderRadius:'var(--radius-md)', border:'1px solid #c3d9ff', fontSize:'0.83rem', fontWeight:700, color:'var(--navy)', display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ fontSize:'0.7rem', color:'var(--gray-400)', fontWeight:400, flexShrink:0 }}>سيظهر كـ:</span>
          {preview}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE CLASSIFICATION (for auto-wiring and hull grouping)
// ─────────────────────────────────────────────────────────────────────────────
function classifyGSRole(role) {
  if (!role) return null
  if (role.startsWith(ACTING_PREFIX)) role = role.slice(ACTING_PREFIX.length)

  if (role === 'الأمين العام')        return { tier: 'secretary_general' }
  if (role === 'المرشد الروحيّ العام') return { tier: 'spiritual_guide' }
  if (role === 'مساعد المرشد الروحي') return { tier: 'spiritual_guide_assistant' }
  if (role === 'نائب الأمين العام')   return { tier: 'reports_to_sg' }
  if (role === 'منسق الشرق الأوسط')  return { tier: 'middle_east_coordinator' }
  if (role === 'نائب منسق الشرق الأوسط') return { tier: 'deputy_me_coordinator' }
  if (role === 'مدير مكتب الأمانة')  return { tier: 'office_director' }
  // شبيبة ستور — manager/responsible/director all in the store hull (not in الأمانة العامة)
  if (role === 'مسؤول شبيبة ستور' || role === 'مدير شبيبة ستور') return { tier: 'store_manager', project: 'شبيبة ستور' }
  if (role === 'موظف شبيبة ستور') return { tier: 'store_employee', project: 'شبيبة ستور' }

  // Committee head
  if (role.startsWith('مسؤول ')) {
    const rest = role.slice('مسؤول '.length)
    if (isGSCompositeCommittee(rest)) return { tier: 'committee_head', committeeKey: rest }
  }
  // Committee member
  if (role.startsWith('عضو ')) {
    const rest = role.slice('عضو '.length)
    if (isGSCompositeCommittee(rest)) return { tier: 'committee_member', committeeKey: rest }
  }

  // Project head
  for (const proj of GS_PROJECTS) {
    if (role === `مسؤول ${proj}`) return { tier: 'project_head', project: proj }
    if (role === `مدير ${proj}`)  return { tier: 'project_director', project: proj }
    if (role === `موظف ${proj}`)  return { tier: 'project_employee', project: proj }
    if (role === `عضو ${proj}`)   return { tier: 'project_member', project: proj }
  }

  return null
}

function isGSCompositeCommittee(str) {
  if (!str) return false
  if (GS_COMMITTEES.includes(str)) return true
  const parts = str.split(/ و /).map(s => s.trim())
  return parts.length > 1 && parts.every(p => GS_COMMITTEES.includes(p))
}

function isDefaultGSGroupMember(role) {
  if (!role) return false
  const c = classifyGSRole(role)
  if (!c) return false
  if (c.tier === 'committee_head')    return true
  if (c.tier === 'committee_member')  return true
  if (c.tier === 'project_head')      return true
  if (c.tier === 'project_director')  return true
  if (c.tier === 'project_employee')  return true
  if (c.tier === 'project_member')    return true
  // شبيبة ستور — both manager/responsible AND employees go in the store hull
  if (c.tier === 'store_manager')     return true
  if (c.tier === 'store_employee')    return true
  return false
}

function effectiveGSInGroup(node) {
  if (node.inGroup !== undefined && node.inGroup !== null) return node.inGroup
  return isDefaultGSGroupMember(node.role || '')
}

// Keys for hull grouping
// Rules:
//   - Each committee head gets its own hull keyed by nodeId: "committee_head:<nodeId>"
//   - Committee members join the hull of their specific head (if pinned) or all matching heads
//   - Project nodes share a hull per project
//   - الأمانة العامة hull is controlled by node.inAmanah (checkbox) — separate from committee hulls
function nodeGSGroupKeys(node) {
  const role = node.role || ''
  const c = classifyGSRole(role)

  const keys = []

  // ── الأمانة العامة hull ─────────────────────────────────────────────────────
  // Eligible: SG, spiritual guides, deputy, committee heads, منسق الشرق الأوسط
  // NOT eligible: نائب منسق, committee members, project/store roles
  if (c) {
    const defaultInAmanah = ['secretary_general','spiritual_guide','spiritual_guide_assistant',
      'reports_to_sg','committee_head','middle_east_coordinator'].includes(c.tier)
    const effectiveInAmanah = node.inAmanah !== undefined && node.inAmanah !== null
      ? node.inAmanah
      : defaultInAmanah
    if (effectiveInAmanah) keys.push('amanah:الأمانة العامة')
  }

  if (!c) return keys
  if (!effectiveGSInGroup(node)) return keys

  // ── Committee hulls — each head is its own hull keyed by nodeId ─────────────
  if (c.tier === 'committee_head') {
    return [...keys, `committee_head:${node.id}`]
  }
  if (c.tier === 'committee_member') {
    if (node.reportsToHeadId) {
      return [...keys, `committee_head:${node.reportsToHeadId}`]
    }
    return [...keys, `committee:${c.committeeKey}`]
  }
  if (['project_head','project_director','project_employee','project_member'].includes(c.tier)) {
    return [...keys, `project:${c.project}`]
  }
  // شبيبة ستور — ALL store roles share one hull (manager/responsible AND employees)
  if (c.tier === 'store_manager' || c.tier === 'store_employee') {
    return [...keys, `project:شبيبة ستور`]
  }
  return keys
}

function computeGSAutoEdges(nodes) {
  const autoEdges = []
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const push = (from, to, type) => {
    if (!from || !to || from === to) return
    autoEdges.push({ id: `auto_${from}_${to}_${type}`, from, to, type, auto: true })
  }
  const baseRole = (role) => role?.startsWith(ACTING_PREFIX) ? role.slice(ACTING_PREFIX.length) : (role || '')
  const byRole = (r) => nodes.filter(n => baseRole(n.role) === r)
  const byTier = (t) => nodes.filter(n => classifyGSRole(n.role)?.tier === t)

  const sg = byRole('الأمين العام')[0]
  const srg = byRole('المرشد الروحيّ العام')[0]
  const srga = byRole('مساعد المرشد الروحي')[0]

  // Spiritual guide chain
  if (sg && srg)  push(sg.id, srg.id, 'peer')
  if (srg && srga) push(srg.id, srga.id, 'hierarchy')

  // Deputy + committee heads → Secretary General
  if (sg) {
    byTier('reports_to_sg').forEach(n => push(sg.id, n.id, 'hierarchy'))
    byTier('committee_head').forEach(n => push(sg.id, n.id, 'hierarchy'))
    // Project heads report to SG
    byTier('project_head').forEach(n => push(sg.id, n.id, 'hierarchy'))
    // منسق الشرق الأوسط → SG (hierarchy, directly under)
    byTier('middle_east_coordinator').forEach(n => push(sg.id, n.id, 'hierarchy'))
    // مدير مكتب الأمانة → SG
    byTier('office_director').forEach(n => push(sg.id, n.id, 'hierarchy'))
    // شبيبة ستور مسؤول/مدير → SG directly
    byTier('store_manager').forEach(n => push(sg.id, n.id, 'hierarchy'))
  }

  // نائب منسق الشرق الأوسط → منسق الشرق الأوسط
  const coordinator = byTier('middle_east_coordinator')[0]
  if (coordinator) {
    byTier('deputy_me_coordinator').forEach(n => push(coordinator.id, n.id, 'hierarchy'))
  } else {
    // no coordinator → wire deputy to SG as fallback
    if (sg) byTier('deputy_me_coordinator').forEach(n => push(sg.id, n.id, 'hierarchy'))
  }

  // Committee members → their committee head (or SG if head missing)
  nodes.forEach(member => {
    const mc = classifyGSRole(member.role)
    if (!mc || mc.tier !== 'committee_member') return
    const memberBase = baseRole(member.role).slice('عضو '.length) // strip 'عضو '
    const memberComs = memberBase.split(/ و /).map(s => s.trim()).filter(s => GS_COMMITTEES.includes(s))

    // If the member is pinned to a specific head, only wire to that head
    if (member.reportsToHeadId) {
      const pinnedHead = nodes.find(n => n.id === member.reportsToHeadId)
      if (pinnedHead) {
        push(pinnedHead.id, member.id, 'hierarchy')
        return
      }
    }

    const matchingHeads = nodes.filter(n => {
      const nc = classifyGSRole(n.role)
      if (!nc || nc.tier !== 'committee_head') return false
      const headComs = nc.committeeKey.split(/ و /).map(s => s.trim())
      return memberComs.some(c => headComs.includes(c))
    })
    if (matchingHeads.length > 0) {
      matchingHeads.forEach(head => push(head.id, member.id, 'hierarchy'))
    } else if (sg) {
      push(sg.id, member.id, 'hierarchy')
    }
  })

  // For شبيبة ستور: مسؤول|مدير report to SG (handled above via store_manager tier)
  // موظف شبيبة ستور reports directly to مسؤول|مدير شبيبة ستور
  GS_PROJECTS.forEach(proj => {
    const projHead = byRole(`مسؤول ${proj}`)[0] || byRole(`مدير ${proj}`)[0]
    if (proj === 'شبيبة ستور') {
      // If both مسؤول and مدير exist, مدير reports to مسؤول
      const storeResp = byRole(`مسؤول ${proj}`)[0]
      const storeMgr  = byRole(`مدير ${proj}`)[0]
      const employees = byRole(`موظف ${proj}`)
      if (storeResp && storeMgr) push(storeResp.id, storeMgr.id, 'hierarchy')
      employees.forEach(emp => {
        if (storeMgr)  push(storeMgr.id, emp.id, 'hierarchy')
        else if (storeResp) push(storeResp.id, emp.id, 'hierarchy')
        else if (sg) push(sg.id, emp.id, 'hierarchy')
      })
    } else {
      const members = byRole(`عضو ${proj}`)
      members.forEach(mem => {
        if (projHead) push(projHead.id, mem.id, 'hierarchy')
        else if (sg) push(sg.id, mem.id, 'hierarchy')
      })
    }
  })

  return autoEdges
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE EDITOR
// ─────────────────────────────────────────────────────────────────────────────
function GSNodeEditor({ node, allNodes, allEdges, allPersons, allUnregistered, onUpdate, onDelete, onClose, onRegisterClick, onViewProfile, onViewUnregisteredProfile }) {
  const [nameQ, setNameQ]       = useState('')
  const [results, setRes]       = useState([])
  const [photoErr, setPhotoErr] = useState(false)
  const [personType, setPersonType] = useState(node.personType || 'علماني')
  const [laqab, setLaqab]       = useState(node.laqab || '')
  const [baseName, setBaseName] = useState(node.baseName || node.name || '')
  const [nameVariations, setNameVariations] = useState({})
  const [personTitles, setPersonTitles] = useState([])
  const fileRef = useRef(null)

  const nameAliasLookup = useMemo(() => buildNameAliasLookup(nameVariations), [nameVariations])
  const personTitleOptions = useMemo(() => {
    const options = personTitles.map((row) => ({ value: row.arabic_title, label: row.arabic_title }))
    const current = String(laqab || '').trim()
    if (current && !options.some((option) => option.value === current)) {
      options.push({ value: current, label: current })
    }
    return options
  }, [personTitles, laqab])
  const unregisteredNodeId = node.unregisteredId || (node.unregistered ? node.personId : null)
  const isUnregisteredNode = Boolean(node.unregistered || unregisteredNodeId)
  const hasLinkedIdentity = Boolean(node.personId || unregisteredNodeId)

  useEffect(() => { setPhotoErr(false) }, [node.photo])

  useEffect(() => {
    const combined = (personType === 'مكرّس' && laqab.trim()) ? `${laqab.trim()} ${baseName}` : baseName
    if (combined !== node.name || laqab !== node.laqab || personType !== node.personType || baseName !== node.baseName) {
      onUpdate({ name: combined, personType, laqab, baseName })
    }
  }, [laqab, baseName, personType]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    api.getConfig()
      .then((cfg) => {
        if (!cancelled) {
          setNameVariations(normalizeNameVariations(cfg?.config?.name_variations || {}))
          setPersonTitles(normalizePersonTitles(cfg?.config?.person_titles || []))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNameVariations({})
          setPersonTitles([])
        }
      })
    return () => { cancelled = true }
  }, [])

  const switchType = (type) => { setPersonType(type); if (type === 'علماني') setLaqab('') }

  const reportsToIds   = allEdges.filter(e => e.type === 'hierarchy' && e.to === node.id).map(e => e.from)
  const reportsToNodes = allNodes.filter(n => reportsToIds.includes(n.id))

  const search = (q) => {
    setNameQ(q)
    if (!q.trim()) { setRes([]); return }
    const qWords = normalizeArabic(q).split(/\s+/).filter(Boolean)
    const qWordGroups = expandQueryWords(qWords, nameAliasLookup)
    const regResults = allPersons.filter(p => {
      const parts = [p.first_name, p.second_name, p.third_name, p.last_name].filter(Boolean).map(normalizeArabic)
      return nameMatchesQuery(parts, qWordGroups)
    }).slice(0, 6).map(p => ({ ...p, _source: 'registered' }))
    const unregResults = (allUnregistered || []).filter(u => {
      const parts = [u.first_name, u.second_name, u.third_name, u.last_name].filter(Boolean).map(normalizeArabic)
      return nameMatchesQuery(parts, qWordGroups)
    }).slice(0, 4).map(u => ({ ...u, _source: 'unregistered' }))
    setRes([...regResults, ...unregResults])
  }

  const pickPerson = (p) => {
    const base = [p.first_name, p.second_name, p.third_name, p.last_name].filter(Boolean).join(' ')
    const combined = (personType === 'مكرّس' && laqab.trim()) ? `${laqab.trim()} ${base}` : base
    setBaseName(base)
    onUpdate({ personId: p.person_id, unregisteredId: null, name: combined, photo: p._photo || null, unregistered: false, personType, laqab, baseName: base })
    setNameQ(''); setRes([])
  }

  const pickUnregistered = (u) => {
    const base = [u.first_name, u.second_name, u.third_name, u.last_name].filter(Boolean).join(' ')
    const uLaqab = u.title || ''
    setBaseName(base); setPersonType('علماني'); setLaqab(uLaqab)
    const combined = uLaqab ? `${uLaqab} ${base}` : base
    onUpdate({ name: combined, baseName: base, laqab: uLaqab, personType: 'علماني', photo: u._photo || null, unregistered: true, personId: String(u.person_id), unregisteredId: String(u.person_id) })
    setNameQ(''); setRes([])
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (node.personId && !node.unregistered) {
      try { await api.uploadPhoto(node.personId, file); onUpdate({ photo: api.photoUrl(node.personId, Date.now()) }) } catch {}
    } else if (isUnregisteredNode && unregisteredNodeId) {
      try { await api.uploadUnregisteredPhoto(unregisteredNodeId, file); onUpdate({ photo: api.unregisteredPhotoUrl(unregisteredNodeId, Date.now()) }) } catch {}
    } else {
      const reader = new FileReader()
      reader.onload = ev => onUpdate({ photo: ev.target.result })
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const hasPhoto = node.photo && !photoErr

  return (
    <div style={{ position:'absolute', top:16, left:16, bottom:16, zIndex:400, background:'white', borderRadius:'var(--radius-lg)', boxShadow:'var(--shadow-lg)', border:'1px solid var(--gray-200)', width:320, overflow:'hidden', animation:'slideUp 0.18s ease', display:'flex', flexDirection:'column' }}>
      <div style={{ background:'var(--navy)', padding:'14px 18px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ color:'white', fontFamily:'var(--font-head)', fontWeight:700, fontSize:'0.95rem' }}>تعديل العقدة</span>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', cursor:'pointer' }}><X size={18}/></button>
      </div>

      <div style={{ padding:18, overflowY:'auto', flex:1, minHeight:0 }}>
        {reportsToNodes.length > 0 && (
          <div style={{ background:'#eef4ff', border:'1px solid #c3d9ff', borderRadius:'var(--radius-md)', padding:'9px 12px', marginBottom:14, fontSize:'0.82rem', color:'#1a3a5c', display:'flex', flexDirection:'column', gap:4 }}>
            <span style={{ fontWeight:700, color:'var(--navy)', fontSize:'0.78rem', marginBottom:2 }}>يرفع تقاريره إلى:</span>
            {reportsToNodes.map(rn => (
              <div key={rn.id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--navy)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.65rem', fontWeight:700, color:'white', flexShrink:0 }}>
                  {firstNameInitial(rn.baseName || rn.name)}
                </div>
                <div>
                  <div style={{ fontWeight:600 }}>{rn.name||'بدون اسم'}</div>
                  {rn.role && <div style={{ fontSize:'0.72rem', color:'var(--gold)' }}>{rn.role}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Avatar */}
        <div style={{ display:'flex', gap:14, alignItems:'flex-start', marginBottom:16 }}>
          <div style={{ width:58, height:58, borderRadius:'50%', background:node.unregistered?'#fef3cd':'var(--navy)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', cursor:'pointer', position:'relative', border:node.unregistered?'2px dashed #e8b55a':'none' }} onClick={()=>fileRef.current?.click()}>
            {hasPhoto ? <img src={node.photo} alt="" onError={()=>setPhotoErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : <span style={{ color:node.unregistered?'#c9963c':'white', fontSize:'1.2rem', fontWeight:700 }}>{firstNameInitial(node.baseName || node.name)}</span>}
            <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', opacity:0, transition:'0.15s' }} className="photo-hover-ov"><Camera size={16} color="white"/></div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handlePhotoUpload}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:'0.9rem', fontWeight:700, color:'var(--gray-800)', marginBottom:3 }}>{node.name||'بدون اسم'}</div>
            {node.role && <div style={{ fontSize:'0.8rem', color:'var(--gold)', marginBottom:3 }}>{node.role}</div>}
            {node.unregistered ? <div style={{ display:'flex', alignItems:'center', gap:5, background:'#fef3cd', borderRadius:6, padding:'4px 8px', fontSize:'0.73rem', color:'#b45309', width:'fit-content' }}><AlertCircle size={12}/> غير مسجّل</div> : node.personId && <div style={{ fontSize:'0.73rem', color:'var(--gray-400)' }}>#{node.personId}</div>}
          </div>
        </div>
        <style>{`.photo-hover-ov:hover{opacity:1!important}`}</style>

        {node.personId && !isUnregisteredNode && (
          <button onClick={() => { onViewProfile(node.personId); onClose() }} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'9px', marginBottom:14, borderRadius:'var(--radius-md)', background:'#eef4ff', border:'1.5px solid #b3ccff', color:'#1a3a5c', fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer' }}>
            <ExternalLink size={14}/> عرض الملف الشخصي
          </button>
        )}
        {isUnregisteredNode && unregisteredNodeId && (
          <button onClick={() => { onViewUnregisteredProfile && onViewUnregisteredProfile(unregisteredNodeId); onClose() }} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'9px', marginBottom:14, borderRadius:'var(--radius-md)', background:'#fffbeb', border:'1.5px solid #e8b55a', color:'#92400e', fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer' }}>
            <ExternalLink size={14}/> عرض ملف غير المسجّل
          </button>
        )}

        {/* Person type */}
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:6 }}>نوع الشخص</label>
          <div style={{ display:'flex', gap:6 }}>
            {['علماني','مكرّس'].map(type => (
              <button key={type} type="button" onClick={() => switchType(type)} style={{ flex:1, padding:'7px 0', borderRadius:'var(--radius-md)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', transition:'all 0.15s', fontFamily:'var(--font-body)', border:personType===type?'2px solid var(--navy)':'2px solid var(--gray-200)', background:personType===type?'var(--navy)':'white', color:personType===type?'white':'var(--gray-500)' }}>{type}</button>
            ))}
          </div>
        </div>

        {personType === 'مكرّس' && (
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>اللقب</label>
            <select value={laqab} onChange={e=>setLaqab(e.target.value)} style={{ width:'100%', padding:'7px 10px', border:'1.5px solid var(--navy)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.85rem', direction:'rtl', textAlign:'right', color:'var(--gray-700)', boxSizing:'border-box', background:'#f8f9ff' }}>
              <option value="">اختر لقبًا</option>
              {personTitleOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>
            {hasLinkedIdentity ? 'تغيير الشخص المرتبط' : 'ربط بشخص مسجّل أو غير مسجّل'}
          </label>
          <div style={{ position:'relative' }}>
            <input value={nameQ} onChange={e=>search(e.target.value)} placeholder="ابحث بالاسم…" style={{ width:'100%', padding:'7px 10px 7px 32px', border:'1.5px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.85rem', direction:'rtl', textAlign:'right', color:'var(--gray-700)', boxSizing:'border-box' }}/>
            <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)' }}/>
          </div>
          {results.length > 0 && (
            <div style={{ border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', marginTop:4, maxHeight:220, overflowY:'auto', background:'white', boxShadow:'var(--shadow-md)' }}>
              {results.map((p) => {
                const isUnreg = p._source === 'unregistered'
                const name = [p.first_name, p.second_name, p.third_name, p.last_name].filter(Boolean).join(' ') || 'بدون اسم'
                const photo = p._photo || null
                return (
                  <div key={isUnreg ? `u-${p.person_id}` : p.person_id}
                    onClick={() => isUnreg ? pickUnregistered(p) : pickPerson(p)}
                    style={{ padding:'8px 12px', cursor:'pointer', fontSize:'0.85rem', borderBottom:'1px solid var(--gray-100)', display:'flex', gap:8, alignItems:'center', background:'white' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'}
                    onMouseLeave={e=>e.currentTarget.style.background='white'}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--navy)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, overflow:'hidden' }}>
                      {photo ? <img src={photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : <span style={{ color:'white', fontSize:'0.65rem', fontWeight:700 }}>{firstNameInitial(p.first_name || name)}</span>}
                    </div>
                    <div style={{ flex:1 }}><div style={{ fontWeight:600 }}>{name}</div><div style={{ fontSize:'0.72rem', color:'var(--gray-400)' }}>{p.governorate||''}</div></div>
                    {isUnreg && <span style={{ fontSize:'0.65rem', background:'#fde68a', color:'#92400e', borderRadius:8, padding:'1px 6px', flexShrink:0 }}>غير مسجّل</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Manual name */}
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>الاسم (يدوي)</label>
          <input value={baseName} onChange={e => {
            const newBase = e.target.value
            setBaseName(newBase)
            const norm = normalizeArabic(newBase.trim())
            const existing = norm ? (allUnregistered||[]).find(u => {
              const uBase = [u.first_name, u.second_name, u.third_name, u.last_name].filter(Boolean).join(' ')
              return normalizeArabic(uBase.trim()) === norm
            }) : null
            if (existing) {
              onUpdate({ unregistered:true, baseName:newBase, personId:String(existing.person_id), unregisteredId:String(existing.person_id), laqab:existing.title||laqab })
            } else {
              onUpdate({ unregistered:isUnregisteredNode || !hasLinkedIdentity, baseName:newBase })
            }
          }} placeholder="أدخل الاسم يدوياً…" style={{ width:'100%', padding:'7px 10px', border:'1.5px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.85rem', direction:'rtl', textAlign:'right', color:'var(--gray-700)', boxSizing:'border-box' }}/>
          {personType === 'مكرّس' && laqab.trim() && baseName.trim() && (
            <div style={{ marginTop:5, fontSize:'0.75rem', color:'var(--gray-400)', padding:'3px 6px' }}>
              سيُعرض كـ: <strong style={{ color:'var(--navy)' }}>{laqab.trim()} {baseName.trim()}</strong>
            </div>
          )}
        </div>

        {/* Role picker */}
        <GSRolePicker
          role={node.role||''}
          currentReportsToHeadId={node.reportsToHeadId || null}
          allNodes={allNodes}
          onChange={(role, reportsToHeadId) => {
            const c = classifyGSRole(role)
            // inAmanah default: SG, deputy, spiritual guides, committee heads, منسق — NOT نائب منسق or members
            const defaultInAmanah = c && ['secretary_general','spiritual_guide','spiritual_guide_assistant',
              'reports_to_sg','committee_head','middle_east_coordinator'].includes(c.tier)
            const prevDefaultInAmanah = (() => {
              const pc = classifyGSRole(node.role||'')
              return pc && ['secretary_general','spiritual_guide','spiritual_guide_assistant',
                'reports_to_sg','committee_head','middle_east_coordinator'].includes(pc.tier)
            })()
            const amanahIsDefault = node.inAmanah === prevDefaultInAmanah || node.inAmanah === undefined || node.inAmanah === null
            const shouldBeGroup = isDefaultGSGroupMember(role)
            const prevGroupDefault = isDefaultGSGroupMember(node.role||'')
            const groupIsDefault = node.inGroup === prevGroupDefault || node.inGroup === undefined
            onUpdate({
              role,
              reportsToHeadId: reportsToHeadId ?? null,
              inAmanah: amanahIsDefault ? defaultInAmanah : node.inAmanah,
              inGroup: groupIsDefault ? shouldBeGroup : node.inGroup,
            })
          }}/>

        {/* ضمن إطار الأمانة العامة checkbox — always visible for relevant roles */}
        {(() => {
          const c = classifyGSRole(node.role||'')
          const eligibleForAmanah = c && ['secretary_general','spiritual_guide','spiritual_guide_assistant',
            'reports_to_sg','committee_head','middle_east_coordinator'].includes(c.tier)
          if (!eligibleForAmanah) return null
          const defaultInAmanah = true
          const effectiveInAmanah = node.inAmanah !== undefined && node.inAmanah !== null ? node.inAmanah : defaultInAmanah
          return (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', marginBottom:8, background:effectiveInAmanah?'#fffbeb':'var(--gray-50)', border:`1.5px solid ${effectiveInAmanah?'#e8b55a':'var(--gray-200)'}`, borderRadius:'var(--radius-md)', cursor:'pointer', transition:'all 0.15s' }}
              onClick={()=>onUpdate({ inAmanah: !effectiveInAmanah })}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:'1rem' }}>🏛️</span>
                <div>
                  <div style={{ fontSize:'0.83rem', fontWeight:700, color:effectiveInAmanah?'#92400e':'var(--gray-600)' }}>ضمن إطار الأمانة العامة</div>
                  {effectiveInAmanah && <div style={{ fontSize:'0.7rem', color:'#b45309', marginTop:1 }}>سيظهر ضمن إطار الأمانة العامة</div>}
                </div>
              </div>
              <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${effectiveInAmanah?'#c9963c':'var(--gray-300)'}`, background:effectiveInAmanah?'#c9963c':'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all 0.15s' }}>
                {effectiveInAmanah && <span style={{ color:'white', fontSize:'0.7rem', fontWeight:800 }}>✓</span>}
              </div>
            </div>
          )
        })()}

        {/* ضمن إطار اللجنة/المشروع checkbox */}
        {nodeGSGroupKeys(node).some(k => !k.startsWith('amanah:')) && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', marginBottom:14, background:effectiveGSInGroup(node)?'#eef4ff':'var(--gray-50)', border:`1.5px solid ${effectiveGSInGroup(node)?'#93c5fd':'var(--gray-200)'}`, borderRadius:'var(--radius-md)', cursor:'pointer', transition:'all 0.15s' }} onClick={()=>onUpdate({ inGroup:!effectiveGSInGroup(node) })}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:'1rem' }}>🫧</span>
              <div>
                <div style={{ fontSize:'0.83rem', fontWeight:700, color:effectiveGSInGroup(node)?'#1e40af':'var(--gray-600)' }}>ضمن إطار اللجنة / المشروع</div>
                {effectiveGSInGroup(node) && (
                  <div style={{ fontSize:'0.7rem', color:'#1d4ed8', marginTop:1 }}>
                    {nodeGSGroupKeys(node).filter(k=>!k.startsWith('amanah:')).map(k => {
                      if (k.startsWith('committee_head:')) {
                        const headId = k.slice('committee_head:'.length)
                        const headNode = allNodes.find(n => n.id === headId)
                        if (headNode) { const hc = classifyGSRole(headNode.role); return hc?.committeeKey || headNode.role || k }
                        return k
                      }
                      if (k.startsWith('committee:')) return k.slice('committee:'.length)
                      if (k.startsWith('project:')) return k.slice('project:'.length)
                      return k
                    }).join(' · ')}
                  </div>
                )}
              </div>
            </div>
            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${effectiveGSInGroup(node)?'#3b82f6':'var(--gray-300)'}`, background:effectiveGSInGroup(node)?'#3b82f6':'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all 0.15s' }}>
              {effectiveGSInGroup(node) && <span style={{ color:'white', fontSize:'0.7rem', fontWeight:800 }}>✓</span>}
            </div>
          </div>
        )}

        {node.unregistered && (
          <button onClick={()=>onRegisterClick(node)} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'9px', marginBottom:12, borderRadius:'var(--radius-md)', background:'#fef3cd', border:'1.5px solid #e8b55a', color:'#92400e', fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer' }}>
            <UserPlus size={15}/> تسجيل هذا الشخص
          </button>
        )}

        <button onClick={onDelete} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'8px', marginBottom:10, borderRadius:'var(--radius-md)', background:'transparent', border:'1.5px solid rgba(192,57,43,0.25)', color:'var(--red)', fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:600, cursor:'pointer' }}>
          <Trash2 size={14}/> حذف العقدة
        </button>
        <button onClick={onClose} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'10px', borderRadius:'var(--radius-md)', background:'var(--navy)', border:'none', color:'white', fontFamily:'var(--font-body)', fontSize:'0.9rem', fontWeight:700, cursor:'pointer' }}>
          <CheckCircle size={16}/> تم
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG NODE
// ─────────────────────────────────────────────────────────────────────────────
function GSNode({ node, selected, connectMode, connectSource, onSelect, onDragStart, onAddChild, onToggleConnect, animating, viewOnly=false }) {
  const [photoErr, setPhotoErr] = useState(false)
  useEffect(() => { setPhotoErr(false) }, [node.photo])

  const isConnectSrc = connectSource === node.id
  const hasPhoto     = node.photo && !photoErr
  const initials     = firstNameInitial(node.baseName || node.name)
  const borderColor  = isConnectSrc ? '#c9963c' : selected ? '#0f2744' : node.unregistered ? '#e8b55a' : '#d1d9e6'

  const { w:W, h:H, roleLines } = nodeSize(node)
  const ACCENT_H   = 4
  const AV_R       = 18
  const AV_CX      = W / 2
  const AV_CY      = ACCENT_H + 8 + AV_R
  const NAME_Y     = AV_CY + AV_R + 13
  const ROLE_Y_START = NAME_Y + 16
  const LINE_H     = 14

  const displayName = nodeDisplayName(node) || 'بدون اسم'

  return (
    <g transform={`translate(${node.x - W/2}, ${node.y - H/2})`}
      style={{ cursor:'move', userSelect:'none', transition:animating?'transform 0.55s cubic-bezier(0.4,0,0.2,1)':'none' }}
      onMouseDown={e => { e.stopPropagation(); onDragStart(e, node.id) }}
      onClick={e => { e.stopPropagation(); if (connectMode) onToggleConnect(node.id); else onSelect(node.id) }}>
      <rect x={2} y={4} width={W} height={H} rx={12} fill="rgba(15,39,68,0.08)"/>
      <rect x={0} y={0} width={W} height={H} rx={12} fill={selected?'#eef4ff':node.unregistered?'#fffbeb':'white'} stroke={borderColor} strokeWidth={selected||isConnectSrc?2.5:1.5} strokeDasharray={node.unregistered?'5,3':'none'}/>
      <rect x={0} y={0} width={W} height={ACCENT_H} rx={12} fill={node.unregistered?'#e8b55a':'#c9963c'}/>
      <rect x={0} y={ACCENT_H/2} width={W} height={ACCENT_H/2} fill={node.unregistered?'#e8b55a':'#c9963c'}/>

      <clipPath id={`gsclip-${node.id}`}><circle cx={AV_CX} cy={AV_CY} r={AV_R}/></clipPath>
      <circle cx={AV_CX} cy={AV_CY} r={AV_R} fill={node.unregistered?'#fde68a':'#0f2744'}/>
      {hasPhoto
        ? <image href={node.photo} x={AV_CX-AV_R} y={AV_CY-AV_R} width={AV_R*2} height={AV_R*2} clipPath={`url(#gsclip-${node.id})`} preserveAspectRatio="xMidYMid slice" onError={()=>setPhotoErr(true)}/>
        : <text x={AV_CX} y={AV_CY} textAnchor="middle" dominantBaseline="middle" fill={node.unregistered?'#92400e':'white'} fontSize={12} fontWeight="700" fontFamily="Tajawal">{initials}</text>
      }
      {node.unregistered && (
        <><circle cx={AV_CX+AV_R-3} cy={AV_CY-AV_R+3} r={6} fill="#ef4444"/>
        <text x={AV_CX+AV_R-3} y={AV_CY-AV_R+3} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={7} fontWeight="800">!</text></>
      )}

      <text x={W/2} y={NAME_Y} textAnchor="middle" dominantBaseline="middle" fill="#1a2a3a" fontSize={12} fontWeight="700" fontFamily="Cairo">{displayName}</text>
      {roleLines.map((line, i) => (
        <text key={i} x={W/2} y={ROLE_Y_START+i*LINE_H} textAnchor="middle" dominantBaseline="middle" fill={node.unregistered?'#b45309':'#c9963c'} fontSize={10} fontFamily="Tajawal">{line}</text>
      ))}

      {!connectMode && !viewOnly && (
        <g transform={`translate(${W/2-10}, ${H-1})`} onClick={e=>{e.stopPropagation();onAddChild(node.id)}} style={{ cursor:'pointer' }}>
          <circle cx={10} cy={10} r={10} fill="#0f2744" opacity={0.85}/>
          <text x={10} y={10} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={16} fontWeight="800">+</text>
        </g>
      )}
    </g>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HULL RENDERING
// ─────────────────────────────────────────────────────────────────────────────
const GS_GROUP_PALETTE = [
  { fill:'rgba(59,130,246,0.08)',  stroke:'#3b82f6' },
  { fill:'rgba(16,185,129,0.08)', stroke:'#10b981' },
  { fill:'rgba(239,68,68,0.08)',  stroke:'#ef4444' },
  { fill:'rgba(139,92,246,0.08)', stroke:'#8b5cf6' },
  { fill:'rgba(236,72,153,0.08)', stroke:'#ec4899' },
  { fill:'rgba(20,184,166,0.08)', stroke:'#14b8a6' },
  { fill:'rgba(245,158,11,0.08)', stroke:'#f59e0b' },
  { fill:'rgba(99,102,241,0.08)', stroke:'#6366f1' },
  { fill:'rgba(168,85,247,0.08)', stroke:'#a855f7' },
  { fill:'rgba(34,197,94,0.08)',  stroke:'#22c55e' },
]

function buildHullPath(pts) {
  if (pts.length < 3) return null
  const cross = (O,A,B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0])
  const p = pts.slice().sort((a,b) => a[0]-b[0] || a[1]-b[1])
  const lower=[], upper=[]
  for (const pt of p) { while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],pt)<=0)lower.pop(); lower.push(pt) }
  for (let i=p.length-1;i>=0;i--) { const pt=p[i]; while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],pt)<=0)upper.pop(); upper.push(pt) }
  upper.pop(); lower.pop()
  const hull = lower.concat(upper)
  if (hull.length < 3) return null
  const R = 20
  const smooth = hull.map((pt,i) => {
    const prev=hull[(i-1+hull.length)%hull.length], next=hull[(i+1)%hull.length]
    const d1=Math.hypot(pt[0]-prev[0],pt[1]-prev[1]), d2=Math.hypot(pt[0]-next[0],pt[1]-next[1])
    const t1=Math.min(R/(d1||1),0.45), t2=Math.min(R/(d2||1),0.45)
    return { in:[pt[0]+(prev[0]-pt[0])*t1,pt[1]+(prev[1]-pt[1])*t1], pt, out:[pt[0]+(next[0]-pt[0])*t2,pt[1]+(next[1]-pt[1])*t2] }
  })
  const d = smooth.map((s,i) => {
    const cmd = i===0 ? `M ${s.in[0]} ${s.in[1]}` : `L ${s.in[0]} ${s.in[1]}`
    return `${cmd} Q ${s.pt[0]} ${s.pt[1]} ${s.out[0]} ${s.out[1]}`
  }).join(' ') + ' Z'
  const top = hull.reduce((a,b)=>b[1]<a[1]?b:a)
  return { d, top }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD BROWSER MODAL
// ─────────────────────────────────────────────────────────────────────────────
function PeriodBrowserModal({ periods, currentPeriod, groupKey, onSelect, onPeriodsUpdated, onClose }) {
  const todayStr = today()
  const [editingId, setEditingId]   = useState(null)
  const [editForm, setEditForm]     = useState({})
  const [editError, setEditError]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting]     = useState(false)

  const byYear = {}
  ;(periods || []).forEach(p => {
    const y = p.jec_year || '—'
    if (!byYear[y]) byYear[y] = []
    byYear[y].push(p)
  })
  const sortedYears = Object.keys(byYear).sort((a, b) => b.localeCompare(a))

  const startEdit = (p, e) => {
    e.stopPropagation()
    setEditingId(p.id)
    setEditForm({
      jec_year:  p.jec_year  ? String(p.jec_year) : '',
      from_date: p.from_date || '',
      to_date:   p.to_date   || '',
      toPresent: !p.to_date,
    })
    setEditError('')
  }

  const cancelEdit = (e) => { e?.stopPropagation(); setEditingId(null); setEditError('') }

  const validateEdit = (form, periodId) => {
    if (!form.jec_year || !/^\d{4}$/.test(form.jec_year.trim()))
      return 'يرجى إدخال سنة JEC صحيحة (4 أرقام)'
    if (!form.from_date)
      return 'يرجى تحديد تاريخ البداية'
    if (form.from_date > todayStr)
      return 'لا يمكن تحديد تاريخ بداية في المستقبل'
    if (!form.toPresent) {
      if (!form.to_date) return 'يرجى تحديد تاريخ النهاية أو اختيار "حتى الآن"'
      if (form.to_date > todayStr) return 'لا يمكن تحديد تاريخ نهاية في المستقبل'
      if (form.to_date < form.from_date) return 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
    }
    // Overlap check against all OTHER closed periods
    const newEnd = form.toPresent ? todayStr : form.to_date
    for (const p of (periods || [])) {
      if (p.id === periodId) continue
      if (!p.to_date) continue
      const s = p.from_date || '0000-01-01'
      const e = p.to_date
      if (form.from_date <= e && newEnd >= s)
        return 'هذه الفترة تتداخل مع فترة أخرى، يرجى تعديل التواريخ'
    }
    return null
  }

  const saveEdit = async (e) => {
    e.stopPropagation()
    const err = validateEdit(editForm, editingId)
    if (err) { setEditError(err); return }
    setSaving(true)
    try {
      const body = {
        jec_year:  parseInt(editForm.jec_year.trim(), 10),
        from_date: editForm.from_date,
        to_date:   editForm.toPresent ? null : editForm.to_date,
      }
      await api.updatePeriod(groupKey, editingId, body)
      setEditingId(null)
      setEditError('')
      onPeriodsUpdated()
    } catch {
      setEditError('حدث خطأ أثناء الحفظ')
    }
    setSaving(false)
  }

  const setF = (k) => (ev) => setEditForm(f => ({ ...f, [k]: ev.target.value }))

  const handleDelete = async (periodId) => {
    setDeleting(true)
    try {
      await api.deletePeriod(groupKey, periodId)
      setConfirmDeleteId(null)
      onPeriodsUpdated()
    } catch {}
    setDeleting(false)
  }

  const inputSm = {
    padding:'6px 8px', border:'1.5px solid var(--gray-200)', borderRadius:'var(--radius-md)',
    fontFamily:'var(--font-body)', fontSize:'0.82rem', direction:'rtl', textAlign:'right',
    boxSizing:'border-box', width:'100%',
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'white', borderRadius:'var(--radius-lg)', boxShadow:'var(--shadow-lg)', width:500, overflow:'hidden', fontFamily:'var(--font-body)' }}>
        <div style={{ background:'var(--navy)', padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ color:'white', fontWeight:700, fontSize:'1rem', display:'flex', alignItems:'center', gap:8 }}>
            <Calendar size={16}/> الفترات الزمنية
          </span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer' }}><X size={18}/></button>
        </div>

        <div style={{ padding:20, maxHeight:520, overflowY:'auto' }}>
          {sortedYears.length === 0 && (
            <div style={{ color:'var(--gray-400)', textAlign:'center', padding:'32px 0' }}>لا توجد فترات بعد</div>
          )}
          {sortedYears.map((year, yi) => (
            <div key={year} style={{
              marginBottom: 16,
              border: '1.5px solid var(--gray-200)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              <div style={{ background:'var(--navy)', padding:'9px 16px', display:'flex', alignItems:'center', gap:8 }}>
                <Calendar size={13} style={{ color:'rgba(255,255,255,0.6)', flexShrink:0 }}/>
                <span style={{ color:'white', fontWeight:800, fontSize:'0.9rem', fontFamily:'var(--font-head)' }}>
                  سنة JEC {year}
                </span>
                <span style={{ marginRight:'auto', fontSize:'0.72rem', color:'rgba(255,255,255,0.5)', fontWeight:500 }}>
                  {byYear[year].length} {byYear[year].length === 1 ? 'فترة' : 'فترات'}
                </span>
              </div>

              <div style={{ padding:'10px 10px 4px' }}>
              {byYear[year].slice().sort((a,b) => (b.from_date||'').localeCompare(a.from_date||'')).map(p => {
                const isActive  = !p.to_date
                const isCurrent = currentPeriod?.id === p.id
                const isEditing = editingId === p.id

                return (
                  <div key={p.id} style={{
                    borderRadius:'var(--radius-md)',
                    border:`1.5px solid ${isCurrent ? 'var(--navy)' : 'var(--gray-200)'}`,
                    background: isCurrent ? '#eef4ff' : 'white',
                    marginBottom:8, overflow:'hidden', transition:'border-color 0.15s',
                  }}>
                    {!isEditing && (
                      <div onClick={() => { if (!isEditing && confirmDeleteId !== p.id) { onSelect(p); onClose() } }}
                        style={{ padding:'11px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}
                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background='var(--gray-50)' }}
                        onMouseLeave={e => { e.currentTarget.style.background='' }}>
                        <span style={{ fontSize:'0.7rem', fontWeight:800, padding:'2px 8px', borderRadius:20, flexShrink:0, background: isActive ? '#e8f5e9' : '#f5f5f5', color: isActive ? '#2e7d32' : '#616161' }}>
                          {isActive ? '● جارية' : '○ منتهية'}
                        </span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, color:'var(--navy)', fontSize:'0.88rem' }}>
                            {formatDate(p.from_date)} — {isActive ? 'الآن' : formatDate(p.to_date)}
                          </div>
                        </div>
                        {isCurrent && <span style={{ fontSize:'0.7rem', color:'var(--navy)', background:'#dbeafe', padding:'1px 7px', borderRadius:20, flexShrink:0 }}>محددة</span>}

                        {confirmDeleteId === p.id ? (
                          <div onClick={e => e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                            <span style={{ fontSize:'0.75rem', color:'#c62828', fontWeight:600 }}>حذف؟</span>
                            <button onClick={() => handleDelete(p.id)} disabled={deleting} style={{ padding:'3px 10px', borderRadius:6, border:'none', background:'#c62828', color:'white', fontFamily:'var(--font-body)', fontSize:'0.75rem', fontWeight:700, cursor:'pointer' }}>
                              {deleting ? '…' : 'نعم'}
                            </button>
                            <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }} style={{ padding:'3px 8px', borderRadius:6, border:'1.5px solid var(--gray-200)', background:'white', color:'var(--gray-600)', fontFamily:'var(--font-body)', fontSize:'0.75rem', cursor:'pointer' }}>
                              لا
                            </button>
                          </div>
                        ) : (
                          <div onClick={e => e.stopPropagation()} style={{ display:'flex', gap:5, flexShrink:0 }}>
                            <button onClick={(e) => startEdit(p, e)} title="تعديل" style={{ background:'none', border:'1px solid var(--gray-200)', borderRadius:6, padding:'4px 7px', cursor:'pointer', color:'var(--gray-400)', display:'flex', alignItems:'center', fontSize:'0.75rem', gap:3, transition:'all 0.15s' }}
                              onMouseEnter={e => { e.currentTarget.style.background='var(--gray-100)'; e.currentTarget.style.color='var(--navy)' }}
                              onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.color='var(--gray-400)' }}>
                              ✏️
                            </button>
                            <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(p.id) }} title="حذف" style={{ background:'none', border:'1px solid var(--gray-200)', borderRadius:6, padding:'4px 7px', cursor:'pointer', color:'var(--gray-400)', display:'flex', alignItems:'center', fontSize:'0.75rem', transition:'all 0.15s' }}
                              onMouseEnter={e => { e.currentTarget.style.background='#fdecea'; e.currentTarget.style.color='#c62828'; e.currentTarget.style.borderColor='#ef9a9a' }}
                              onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.color='var(--gray-400)'; e.currentTarget.style.borderColor='var(--gray-200)' }}>
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {isEditing && (
                      <div onClick={e => e.stopPropagation()} style={{ padding:'14px 16px' }}>
                        {editError && (
                          <div style={{ background:'#fdecea', border:'1px solid #ef9a9a', borderRadius:'var(--radius-md)', padding:'7px 10px', marginBottom:10, fontSize:'0.8rem', color:'#c62828' }}>
                            {editError}
                          </div>
                        )}
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
                          <div>
                            <label style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:3 }}>سنة JEC *</label>
                            <input value={editForm.jec_year} onChange={setF('jec_year')} placeholder="2026" style={inputSm}/>
                          </div>
                          <div>
                            <label style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:3 }}>تاريخ البداية *</label>
                            <input type="date" value={editForm.from_date} max={todayStr} onChange={setF('from_date')} style={inputSm}/>
                          </div>
                          <div>
                            <label style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:3 }}>تاريخ النهاية</label>
                            {editForm.toPresent
                              ? <div style={{ padding:'6px 8px', fontSize:'0.82rem', color:'var(--gray-500)', background:'var(--gray-50)', borderRadius:'var(--radius-md)', border:'1.5px solid var(--gray-200)' }}>حتى الآن</div>
                              : <input type="date" value={editForm.to_date} max={todayStr} min={editForm.from_date || undefined} onChange={setF('to_date')} style={inputSm}/>
                            }
                          </div>
                        </div>
                        <button type="button" onClick={() => setEditForm(f => ({ ...f, toPresent: !f.toPresent, to_date: '' }))}
                          style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12, padding:'5px 10px', borderRadius:6, cursor:'pointer', border:`1.5px solid ${editForm.toPresent ? 'var(--navy)' : 'var(--gray-200)'}`, background: editForm.toPresent ? '#eef4ff' : 'white', color: editForm.toPresent ? 'var(--navy)' : 'var(--gray-500)', fontFamily:'var(--font-body)', fontSize:'0.8rem', fontWeight:600 }}>
                          <span style={{ width:14, height:14, borderRadius:3, border:`2px solid ${editForm.toPresent ? 'var(--navy)' : 'var(--gray-300)'}`, background: editForm.toPresent ? 'var(--navy)' : 'white', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            {editForm.toPresent && <span style={{ color:'white', fontSize:'0.6rem' }}>✓</span>}
                          </span>
                          حتى الآن (فترة جارية)
                        </button>
                        <div style={{ display:'flex', gap:8 }}>
                          <button onClick={saveEdit} disabled={saving} style={{ flex:1, padding:'7px', borderRadius:'var(--radius-md)', background:'var(--navy)', border:'none', color:'white', fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer' }}>
                            {saving ? 'جارٍ الحفظ…' : '✓ حفظ التعديلات'}
                          </button>
                          <button onClick={cancelEdit} style={{ padding:'7px 14px', borderRadius:'var(--radius-md)', background:'white', border:'1.5px solid var(--gray-200)', color:'var(--gray-600)', fontFamily:'var(--font-body)', fontSize:'0.85rem', cursor:'pointer' }}>
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const GS_GROUP_KEY = 'GS'

export default function GeneralSecretariatTree({ toast, onRegisterPerson, onViewProfile, onViewUnregisteredProfile, viewOnly = false }) {
  const [nodes, setNodes]             = useState([])
  const [edges, setEdges]             = useState([])
  const [selectedNode, setSelected]   = useState(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnSrc]   = useState(null)
  const [allPersons, setAllPersons]   = useState([])
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [dirty, setDirty]             = useState(false)
  const [animating, setAnimating]     = useState(false)
  const [allUnregistered, setAllUnregistered] = useState([])

  // Period state
  const [periods, setPeriods]                 = useState([])
  const [currentPeriod, setCurrentPeriod]     = useState(null)
  const [showPeriodModal, setShowPeriodModal] = useState(false)
  const [showSaveModal, setShowSaveModal]     = useState(false)
  const [structuralDirty, setStructuralDirty] = useState(false)

  const svgRef   = useRef(null)
  const [pan, setPan]   = useState({ x:0, y:0 })
  const [zoom, setZoom] = useState(1)
  const panRef   = useRef(null)
  const dragRef  = useRef(null)
  const canvasRef = useRef(null)

  const [suppressedAutoEdges, setSuppressed] = useState(new Set())

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    api.personsEnriched().then(p => setAllPersons(p))
    api.getUnregistered().then(u => setAllUnregistered(u))
  }, [])

  useEffect(() => {
    setLoading(true)
    setSuppressed(new Set())
    api.getOrgTree(GS_GROUP_KEY)
      .then(data => {
        loadTreeIntoView(data, null, data.periods || [])
      })
      .catch(() => { setNodes([]); setEdges([]); setCurrentPeriod(null); setPeriods([]); setDirty(false); setStructuralDirty(false) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onWindowFocus = () => {
      if (dirty) return
      const periodId = currentPeriod?.id
      api.getOrgTree(GS_GROUP_KEY, periodId)
        .then(data => {
          const refreshedNodes = data.nodes || []
          setNodes(refreshedNodes)
          setEdges(data.edges || [])
          setCurrentPeriod(data.period || currentPeriod)
          setPeriods(data.periods || periods)
        })
        .catch(() => {})
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [currentPeriod, periods, dirty])

  const loadPeriod = (period) => {
    setLoading(true)
    setSuppressed(new Set())
    api.getOrgTree(GS_GROUP_KEY, period.id)
      .then(data => {
        loadTreeIntoView(data, period, periods)
      })
      .catch(() => { setNodes([]); setEdges([]) })
      .finally(() => setLoading(false))
  }

  // ── Sync unregistered nodes → create/link records on save ─────────────────
  const syncUnregisteredNodes = useCallback(async (currentNodes) => {
    const nodesNeedingLink = currentNodes.filter(
      n => n.unregistered && !n.personId && !n.unregisteredId && (n.name || n.baseName)
    )
    if (!nodesNeedingLink.length) return currentNodes

    let latestUnreg = allUnregistered
    try { latestUnreg = await api.getUnregistered() } catch { /* use cached */ }

    const autoLinked = {}
    const newNodes   = []
    nodesNeedingLink.forEach(n => {
      const rawName = (n.baseName || n.name || '').trim()
      const norm = normalizeArabic(rawName)
      if (!norm) return
      const match = latestUnreg.find(u => {
        const uBase = [u.first_name, u.second_name, u.third_name, u.last_name].filter(Boolean).join(' ')
        return normalizeArabic(uBase.trim()) === norm
      })
      if (match) autoLinked[n.id] = String(match.person_id)
      else newNodes.push(n)
    })

    let linkedNodes = currentNodes
    if (Object.keys(autoLinked).length) {
      linkedNodes = linkedNodes.map(n => {
        const uid = autoLinked[n.id]
        return uid ? { ...n, unregisteredId: uid } : n
      })
    }

    if (!newNodes.length) {
      setNodes(linkedNodes)
      return linkedNodes
    }
    try {
      const res = await api.syncUnregistered({ nodes: newNodes })
      const created = res.created || {}
      if (Object.keys(created).length) {
        linkedNodes = linkedNodes.map(n => {
          const newUid = created[n.id]
          return newUid ? { ...n, unregisteredId: newUid } : n
        })
      }
      api.getUnregistered().then(u => setAllUnregistered(u)).catch(() => {})
    } catch { /* non-critical */ }
    setNodes(linkedNodes)
    return linkedNodes
  }, [allUnregistered])

  // ── Auto-wiring ────────────────────────────────────────────────────────────
  const autoWireRef = useRef(false)
  useEffect(() => {
    const newAuto = computeGSAutoEdges(nodes)
    setEdges(prev => {
      const manual = prev.filter(e => !e.auto)
      const manualPairs = new Set(manual.map(e => `${e.from}|${e.to}|${e.type}`))
      const filtered = newAuto.filter(ae => {
        const key = `${ae.from}|${ae.to}|${ae.type}`
        return !manualPairs.has(key) && !suppressedAutoEdges.has(key)
      })
      const prevAutoIds = new Set(prev.filter(e=>e.auto).map(e=>e.id))
      const nextAutoIds = new Set(filtered.map(e=>e.id))
      const same = prevAutoIds.size===nextAutoIds.size && [...nextAutoIds].every(id=>prevAutoIds.has(id))
      if (same) return prev
      autoWireRef.current = true
      return [...manual, ...filtered]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, suppressedAutoEdges])

  useEffect(() => {
    if (autoWireRef.current) { autoWireRef.current = false; setDirty(true); setStructuralDirty(true) }
  }, [edges])

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSaveClick = () => { if (!dirty) return; setShowSaveModal(true) }

  const handleSaveToPeriod = () => { setShowSaveModal(false); doSave(currentPeriod) }

  const handleSaveWithPeriod = async (periodMeta, isBecomingActive) => {
    setShowSaveModal(false); setSaving(true)
    try {
      const linkedNodes = await syncUnregisteredNodes(nodes)
      const hasActivePeriod = currentPeriod && !currentPeriod.to_date
      const res = await api.putOrgTree(GS_GROUP_KEY, { nodes: linkedNodes, edges, period_id: hasActivePeriod ? currentPeriod?.id : undefined, new_period: periodMeta, close_current: hasActivePeriod })
      const data = await api.getOrgTree(GS_GROUP_KEY)
      setNodes(data.nodes || [])
      setEdges(data.edges || [])
      setCurrentPeriod(data.period || res.period || currentPeriod)
      setPeriods(data.periods || res.periods || periods)
      setDirty(false); setStructuralDirty(false)
      toast('تم الحفظ ✓', 'success')
      applyTidy(data.nodes || linkedNodes, data.edges || edges)
    } catch (err) {
      if (err.message?.includes('409')) toast('تتداخل الفترة مع فترة موجودة', 'error')
      else toast('خطأ في الحفظ', 'error')
    }
    setSaving(false)
  }

  const doSave = async (period) => {
    setSaving(true)
    try {
      const linkedNodes = await syncUnregisteredNodes(nodes)
      const res = await api.putOrgTree(GS_GROUP_KEY, { nodes: linkedNodes, edges, period_id: period?.id })
      setCurrentPeriod(res.period || period)
      setPeriods(res.periods || periods)
      setDirty(false); setStructuralDirty(false)
      toast('تم الحفظ ✓', 'success')
      applyTidy(linkedNodes, edges)
    } catch { toast('خطأ في الحفظ', 'error') }
    setSaving(false)
  }

  // ── Tidy layout ────────────────────────────────────────────────────────────
  const tidyLayout = useCallback((currentNodes, currentEdges) => {
    if (!currentNodes.length) return null
    const positions = computeTidyLayout(currentNodes, currentEdges)
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity
    currentNodes.forEach(n => {
      const { w, h } = nodeSize(n)
      const px = positions[n.id]?.x ?? n.x
      const py = positions[n.id]?.y ?? n.y
      minX=Math.min(minX,px-w/2); maxX=Math.max(maxX,px+w/2)
      minY=Math.min(minY,py-h/2); maxY=Math.max(maxY,py+h/2)
    })
    const treeW=maxX-minX, treeH=maxY-minY
    const svgEl=svgRef.current
    const vpW=svgEl?svgEl.clientWidth:900, vpH=svgEl?svgEl.clientHeight:600
    const fitZoom=Math.min((vpW-80)/(treeW||1),(vpH-80)/(treeH||1),1.5)
    const newZoom=Math.max(0.25,fitZoom)
    const newPan={ x:(vpW-treeW*newZoom)/2-minX*newZoom, y:(vpH-treeH*newZoom)/2-minY*newZoom }
    const tidied=currentNodes.map(n=>({ ...n, x:positions[n.id]?.x??n.x, y:positions[n.id]?.y??n.y }))
    return { tidied, newZoom, newPan }
  }, [])

  const applyTidy = (currentNodes, currentEdges) => {
    if (!currentNodes.length) return
    const result = tidyLayout(currentNodes, currentEdges)
    if (!result) return
    const { tidied, newZoom, newPan } = result
    setAnimating(true); setNodes(tidied); setZoom(newZoom); setPan(newPan)
    setTimeout(() => setAnimating(false), 620)
  }

  function loadTreeIntoView(data, fallbackPeriod = null, nextPeriods = null) {
    const nextNodes = data?.nodes || []
    const nextEdges = data?.edges || []

    if (!nextNodes.length) {
      setNodes([])
      setEdges(nextEdges)
      setCurrentPeriod(data?.period || fallbackPeriod || null)
      if (nextPeriods) setPeriods(nextPeriods)
      else if (data?.periods) setPeriods(data.periods)
      setSelected(null)
      setConnSrc(null)
      setConnectMode(false)
      setZoom(1)
      setPan({ x: 0, y: 0 })
      setDirty(false)
      setStructuralDirty(false)
      return
    }

    const layoutResult = tidyLayout(nextNodes, nextEdges)
    const fittedNodes = nextNodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))
      ? nextNodes
      : (layoutResult?.tidied || nextNodes)
    const nextZoom = layoutResult?.newZoom ?? 1
    const nextPan = layoutResult?.newPan ?? { x: 0, y: 0 }

    setNodes(fittedNodes)
    setEdges(nextEdges)
    setCurrentPeriod(data?.period || fallbackPeriod || null)
    if (nextPeriods) setPeriods(nextPeriods)
    else if (data?.periods) setPeriods(data.periods)
    setSelected(null)
    setConnSrc(null)
    setConnectMode(false)
    setZoom(nextZoom)
    setPan(nextPan)
    setDirty(false)
    setStructuralDirty(false)
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const markDirty = (structural = false) => { setDirty(true); if (structural) setStructuralDirty(true) }

  const updateNode = (id, changes) => {
    setNodes(ns => ns.map(n => n.id===id ? { ...n, ...changes } : n))
    const isPositionOnly = Object.keys(changes).every(k=>k==='x'||k==='y')
    markDirty(!isPositionOnly)
  }

  const deleteNode = (id) => {
    setNodes(ns => ns.filter(n => n.id!==id))
    setEdges(es => es.filter(e => e.from!==id && e.to!==id))
    setSelected(null); markDirty(true)
  }

  const addNode = (parentId = null) => {
    const newId = uid()
    let x=400, y=200
    if (parentId) {
      const parent = nodes.find(n=>n.id===parentId)
      if (parent) {
        const { w:pW, h:pH } = nodeSize(parent)
        const siblings = edges.filter(e=>e.from===parentId&&e.type==='hierarchy').length
        x=parent.x+(siblings-1)*(pW+H_GAP); y=parent.y+pH+V_GAP
      }
    }
    const newNode = { id:newId, x, y, name:'', role:'', personId:null, unregistered:true, photo:null }
    setNodes(ns => [...ns, newNode])
    if (parentId) setEdges(es => [...es, { id:uid(), from:parentId, to:newId, type:'hierarchy' }])
    setSelected(newId); markDirty(true)
  }

  const toggleConnect = (nodeId) => {
    if (!connectSource) { setConnSrc(nodeId); return }
    if (connectSource === nodeId) { setConnSrc(null); return }
    const exists = edges.find(e => (e.from===connectSource&&e.to===nodeId)||(e.from===nodeId&&e.to===connectSource))
    if (!exists) { setEdges(es => [...es, { id:uid(), from:connectSource, to:nodeId, type:connectMode }]); markDirty(true) }
    setConnSrc(null)
  }

  const removeEdge = (edgeId) => {
    setEdges(es => {
      const edge = es.find(e=>e.id===edgeId)
      if (edge?.auto) setSuppressed(prev => new Set([...prev, `${edge.from}|${edge.to}|${edge.type}`]))
      return es.filter(e=>e.id!==edgeId)
    })
    markDirty(true)
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onNodeDragStart = useCallback((e, nodeId) => {
    if (connectMode) return
    const node = nodes.find(n=>n.id===nodeId)
    if (!node) return
    panRef.current = null
    dragRef.current = { nodeId, startX:e.clientX, startY:e.clientY, origX:node.x, origY:node.y }
    e.preventDefault(); e.stopPropagation()
  }, [nodes, connectMode])

  const onSvgMouseDown = (e) => {
    const tag = e.target.tagName.toLowerCase()
    if (tag==='button'||tag==='input') return
    if (e.button!==0) return
    if (!dragRef.current) panRef.current = { startX:e.clientX, startY:e.clientY, origPan:{...pan} }
  }

  const onMouseMove = useCallback((e) => {
    if (dragRef.current) {
      const dx=(e.clientX-dragRef.current.startX)/zoom, dy=(e.clientY-dragRef.current.startY)/zoom
      setNodes(ns => ns.map(n => n.id===dragRef.current.nodeId ? { ...n, x:dragRef.current.origX+dx, y:dragRef.current.origY+dy } : n))
    } else if (panRef.current) {
      setPan({ x:panRef.current.origPan.x+(e.clientX-panRef.current.startX), y:panRef.current.origPan.y+(e.clientY-panRef.current.startY) })
    }
  }, [zoom])

  const onMouseUp = useCallback(() => {
    if (dragRef.current) { markDirty(false); dragRef.current=null }
    panRef.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [onMouseMove, onMouseUp])

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx=e.clientX-rect.left, my=e.clientY-rect.top
        setZoom(z => {
          const delta=-e.deltaY*0.001*(e.deltaMode===1?20:1)
          const next=Math.min(2.5,Math.max(0.15,z+delta*z))
          setPan(p => ({ x:mx-(mx-p.x)*(next/z), y:my-(my-p.y)*(next/z) }))
          return next
        })
      } else {
        const speed=e.deltaMode===1?20:1
        setPan(p => ({ x:p.x-e.deltaX*speed, y:p.y-e.deltaY*speed }))
      }
    }
    el.addEventListener('wheel', handler, { passive:false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ── All nodes/edges visible (no tab separation) ───────────────────────────
  const visibleNodes = nodes
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id))
  const visibleEdges = edges.filter(e => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to))

  const selectedNodeObj = nodes.find(n => n.id === selectedNode)
  const showEditor = selectedNode && !viewOnly && selectedNodeObj

  // ── Hull rendering ─────────────────────────────────────────────────────────
  const renderHulls = () => {
    // Step 1: collect hull key → nodes mapping
    const keySet = new Map() // finalKey → Set<node>

    // First pass: register all committee heads with their nodeId-based key
    visibleNodes.forEach(n => {
      const c = classifyGSRole(n.role)
      if (c?.tier === 'committee_head' && effectiveGSInGroup(n)) {
        const k = `committee_head:${n.id}`
        if (!keySet.has(k)) keySet.set(k, new Set())
        keySet.get(k).add(n)
      }
    })

    // Second pass: assign all other nodes
    visibleNodes.forEach(n => {
      const rawKeys = nodeGSGroupKeys(n)
      rawKeys.forEach(k => {
        if (k.startsWith('committee_head:') && classifyGSRole(n.role)?.tier === 'committee_head') {
          return // already handled above
        }
        if (k.startsWith('committee:')) {
          // Unpinned committee member — find matching head(s) by committeeKey
          const committeeKey = k.slice('committee:'.length)
          let assigned = false
          visibleNodes.forEach(head => {
            const hc = classifyGSRole(head.role)
            if (hc?.tier !== 'committee_head' || !effectiveGSInGroup(head)) return
            const headComs = hc.committeeKey.split(/ و /).map(s => s.trim())
            const memberComs = committeeKey.split(/ و /).map(s => s.trim())
            if (memberComs.some(c => headComs.includes(c))) {
              const hk = `committee_head:${head.id}`
              if (!keySet.has(hk)) keySet.set(hk, new Set())
              keySet.get(hk).add(n)
              assigned = true
            }
          })
          // If no matching head found, create a standalone committee hull
          if (!assigned) {
            if (!keySet.has(k)) keySet.set(k, new Set())
            keySet.get(k).add(n)
          }
          return
        }
        // amanah, project, etc.
        if (!keySet.has(k)) keySet.set(k, new Set())
        keySet.get(k).add(n)
      })
    })

    const PAD = 10
    // Sort: amanah first (rendered under everything), then others
    const sortedKeys = [...keySet.keys()].sort((a, b) => {
      if (a === 'amanah:الأمانة العامة') return -1
      if (b === 'amanah:الأمانة العامة') return 1
      return a.localeCompare(b)
    })

    const labelForKey = (key) => {
      if (key === 'amanah:الأمانة العامة') return 'الأمانة العامة'
      if (key.startsWith('committee_head:')) {
        const headId = key.slice('committee_head:'.length)
        const headNode = visibleNodes.find(n => n.id === headId)
        if (headNode) {
          const c = classifyGSRole(headNode.role)
          return c?.committeeKey || headNode.role || key
        }
        return key
      }
      if (key.startsWith('committee:')) return key.slice('committee:'.length)
      if (key.startsWith('project:')) return key.slice('project:'.length)
      return key
    }

    return sortedKeys.map((key, idx) => {
      const members = [...keySet.get(key)]
      if (members.length < 1) return null

      const isAmanah = key === 'amanah:الأمانة العامة'
      const colorIdx = isAmanah ? 0 : idx
      const color = isAmanah
        ? { fill: 'rgba(201,150,60,0.06)', stroke: '#c9963c', strokeWidth: 2, dash: '8,5' }
        : { fill: GS_GROUP_PALETTE[colorIdx % GS_GROUP_PALETTE.length].fill, stroke: GS_GROUP_PALETTE[colorIdx % GS_GROUP_PALETTE.length].stroke, strokeWidth: 1.5, dash: '5,4' }
      const label = labelForKey(key)
      const lw = Math.max(label.length * 7.5 + 20, 60)
      const apadding = isAmanah ? 14 : PAD

      const pts = []
      members.forEach(n => {
        const { w, h } = nodeSize(n)
        const W2=w/2+apadding, H2=h/2+apadding
        pts.push([n.x-W2, n.y-H2])
        pts.push([n.x+W2, n.y-H2])
        pts.push([n.x-W2, n.y+H2])
        pts.push([n.x+W2, n.y+H2])
      })

      if (members.length === 1 && !isAmanah) {
        const n=members[0], { w:nw, h:nh }=nodeSize(n)
        const rx=n.x-nw/2-PAD, ry=n.y-nh/2-PAD, rw=nw+PAD*2, rh=nh+PAD*2
        return (
          <g key={key} style={{ pointerEvents:'none' }}>
            <rect x={rx} y={ry} width={rw} height={rh} rx={14} fill={color.fill} stroke={color.stroke} strokeWidth={color.strokeWidth} strokeDasharray={color.dash} strokeOpacity={0.65}/>
            <g transform={`translate(${n.x}, ${ry-11})`}>
              <rect x={-lw/2} y={-10} width={lw} height={20} rx={10} fill={color.stroke} opacity={0.9}/>
              <text x={0} y={1} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={10} fontWeight="700" fontFamily="Cairo" style={{ userSelect:'none' }}>{label}</text>
            </g>
          </g>
        )
      }

      const hull = buildHullPath(pts)
      if (!hull) return null
      return (
        <g key={key} style={{ pointerEvents:'none' }}>
          <path d={hull.d} fill={color.fill} stroke={color.stroke} strokeWidth={color.strokeWidth} strokeDasharray={color.dash} strokeOpacity={isAmanah ? 0.55 : 0.65}/>
          <g transform={`translate(${hull.top[0]}, ${hull.top[1]-14})`}>
            <rect x={-lw/2} y={-10} width={lw} height={20} rx={10} fill={color.stroke} opacity={0.92}/>
            <text x={0} y={1} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={isAmanah?11:10} fontWeight="700" fontFamily="Cairo" style={{ userSelect:'none' }}>{label}</text>
          </g>
        </g>
      )
    })
  }

  const [exporting, setExporting] = useState(false)

  const exportToPdf = useCallback(async () => {
    if (!svgRef.current || !nodes.length) return
    setExporting(true)
    try {
      const svgEl = svgRef.current
      const svgClone = svgEl.cloneNode(true)
      const PAD = 50
      let bMinX=Infinity, bMaxX=-Infinity, bMinY=Infinity, bMaxY=-Infinity
      nodes.forEach(n => {
        const { w, h } = nodeSize(n)
        bMinX=Math.min(bMinX,n.x-w/2); bMaxX=Math.max(bMaxX,n.x+w/2)
        bMinY=Math.min(bMinY,n.y-h/2); bMaxY=Math.max(bMaxY,n.y+h/2)
      })
      const treeW=bMaxX-bMinX+PAD*2, treeH=bMaxY-bMinY+PAD*2
      const gEl=svgClone.querySelector('g[transform]')
      if (gEl) gEl.setAttribute('transform', `translate(${-bMinX+PAD},${-bMinY+PAD})`)
      svgClone.setAttribute('width', String(treeW))
      svgClone.setAttribute('height', String(treeH))
      svgClone.setAttribute('viewBox', `0 0 ${treeW} ${treeH}`)
      const bgRect=svgClone.querySelector('rect[fill="var(--cream)"]')
      if (bgRect) bgRect.setAttribute('fill','white')
      const styleEl=document.createElementNS('http://www.w3.org/2000/svg','style')
      styleEl.textContent=`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&family=Cairo:wght@600;700;900&display=swap');`
      svgClone.insertBefore(styleEl,svgClone.firstChild)
      const SCALE=2
      const serializer=new XMLSerializer()
      const svgStr=serializer.serializeToString(svgClone)
      const blob=new Blob([svgStr],{type:'image/svg+xml;charset=utf-8'})
      const svgUrl=URL.createObjectURL(blob)
      const treeCanvas=document.createElement('canvas')
      treeCanvas.width=treeW*SCALE; treeCanvas.height=treeH*SCALE
      const treeCtx=treeCanvas.getContext('2d')
      treeCtx.scale(SCALE,SCALE); treeCtx.fillStyle='white'; treeCtx.fillRect(0,0,treeW,treeH)
      await new Promise((resolve,reject) => {
        const img=new Image(); img.onload=()=>{treeCtx.drawImage(img,0,0,treeW,treeH);resolve()}; img.onerror=reject; img.src=svgUrl
      })
      URL.revokeObjectURL(svgUrl)
      const HEADER_H=44*SCALE, FOOTER_H=28*SCALE
      const fullW=treeCanvas.width, fullH=treeCanvas.height+HEADER_H+FOOTER_H
      const full=document.createElement('canvas')
      full.width=fullW; full.height=fullH
      const ctx=full.getContext('2d')
      ctx.fillStyle='white'; ctx.fillRect(0,0,fullW,fullH)
      ctx.fillStyle='#0f2744'; ctx.fillRect(0,0,fullW,HEADER_H)
      const periodLabel=currentPeriod?`  •  ${currentPeriod.from_date||''}${currentPeriod.to_date?' ← '+currentPeriod.to_date:' ← الآن'}`:''
      ctx.fillStyle='white'; ctx.font=`bold ${18*SCALE}px Cairo,Tajawal,sans-serif`
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.direction='rtl'
      ctx.fillText('الأمانة العامة'+periodLabel,fullW/2,HEADER_H/2)
      ctx.drawImage(treeCanvas,0,HEADER_H)
      ctx.fillStyle='#f8f9fc'; ctx.fillRect(0,HEADER_H+treeCanvas.height,fullW,FOOTER_H)
      ctx.fillStyle='#888'; ctx.font=`${11*SCALE}px Tajawal,sans-serif`
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.direction='rtl'
      ctx.fillText(new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}),fullW/2,HEADER_H+treeCanvas.height+FOOTER_H/2)
      const isLandscape=fullW>fullH
      const [pageW_mm,pageH_mm]=isLandscape?[297,210]:[210,297]
      const scaleToFit=Math.min(pageW_mm/(fullW/SCALE),pageH_mm/(fullH/SCALE))
      const imgW_mm=(fullW/SCALE)*scaleToFit, imgH_mm=(fullH/SCALE)*scaleToFit
      const offX_mm=(pageW_mm-imgW_mm)/2, offY_mm=(pageH_mm-imgH_mm)/2
      const loadJsPDF=()=>new Promise((resolve,reject)=>{
        if(window.jspdf?.jsPDF){resolve(window.jspdf.jsPDF);return}
        const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
        s.onload=()=>resolve(window.jspdf.jsPDF); s.onerror=reject; document.head.appendChild(s)
      })
      const jsPDF=await loadJsPDF()
      const doc=new jsPDF({orientation:isLandscape?'l':'p',unit:'mm',format:[pageW_mm,pageH_mm]})
      doc.addImage(full.toDataURL('image/png'),'PNG',offX_mm,offY_mm,imgW_mm,imgH_mm)
      doc.save('general-secretariat-tree.pdf')
    } catch(err) { console.error('PDF export failed:',err) }
    setExporting(false)
  }, [nodes, currentPeriod])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0, fontFamily:'var(--font-body)', direction:'rtl' }}>
      {/* ── Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background:'white', borderBottom:'1px solid var(--gray-200)', flexShrink:0, flexWrap:'wrap' }}>

        {/* Period badge */}
        <PeriodBadge period={currentPeriod} periods={periods} onClick={()=>setShowPeriodModal(true)}/>

        {!viewOnly && (
          <>
            <button
              onClick={() => { setConnectMode(m => m === 'hierarchy' ? false : 'hierarchy'); setConnSrc(null) }}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:'var(--radius-md)', border:'1.5px solid', fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:600, cursor:'pointer', transition:'all 0.15s', ...(connectMode==='hierarchy' ? { background:'#0f2744', borderColor:'#0f2744', color:'white' } : { background:'white', borderColor:'var(--gray-200)', color:'var(--gray-600)' }) }}>
              <Link size={13}/> ربط هرمي
            </button>
            <button
              onClick={() => { setConnectMode(m => m === 'peer' ? false : 'peer'); setConnSrc(null) }}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:'var(--radius-md)', border:'1.5px solid', fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:600, cursor:'pointer', transition:'all 0.15s', ...(connectMode==='peer' ? { background:'#c9963c', borderColor:'#c9963c', color:'white' } : { background:'white', borderColor:'var(--gray-200)', color:'var(--gray-600)' }) }}>
              <Link size={13}/> ربط أفقي
            </button>
            <button onClick={()=>addNode()} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:'var(--radius-md)', background:'white', border:'1.5px solid var(--gray-200)', color:'var(--gray-700)', fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:600, cursor:'pointer' }}>
              <Plus size={13}/> إضافة عقدة
            </button>
            <button onClick={()=>applyTidy(nodes,edges)} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:'var(--radius-md)', background:'white', border:'1.5px solid var(--gray-200)', color:'var(--gray-700)', fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:600, cursor:'pointer' }}>
              <Sparkles size={13}/> ترتيب
            </button>
          </>
        )}

        <div style={{ flex:1 }}/>

        {/* Zoom controls */}
        <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:'0.82rem', color:'var(--gray-500)' }}>
          <button style={{ padding:'4px 8px', borderRadius:'var(--radius-md)', border:'1.5px solid var(--gray-200)', background:'white', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:'0.82rem' }} onClick={()=>setZoom(z=>Math.min(2.5,z+0.15))}>+</button>
          <span style={{ minWidth:40, textAlign:'center' }}>{Math.round(zoom*100)}%</span>
          <button style={{ padding:'4px 8px', borderRadius:'var(--radius-md)', border:'1.5px solid var(--gray-200)', background:'white', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:'0.82rem' }} onClick={()=>setZoom(z=>Math.max(0.15,z-0.15))}>−</button>
          <button style={{ padding:'4px 8px', borderRadius:'var(--radius-md)', border:'1.5px solid var(--gray-200)', background:'white', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:'0.82rem' }} onClick={()=>{setZoom(1);setPan({x:0,y:0})}}>⌖</button>
        </div>

        {/* Export PDF */}
        {nodes.length > 0 && (
          <button onClick={exportToPdf} disabled={exporting}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:'var(--radius-md)', background:'white', border:'1.5px solid var(--gray-200)', color:'var(--gray-600)', fontFamily:'var(--font-body)', fontSize:'0.82rem', fontWeight:600, cursor:exporting?'not-allowed':'pointer' }}>
            <FileDown size={13}/> {exporting ? 'جارٍ…' : 'PDF'}
          </button>
        )}

        {!viewOnly && (
          <button
            onClick={handleSaveClick}
            disabled={!dirty || saving}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:'var(--radius-md)', border:'none', fontFamily:'var(--font-body)', fontSize:'0.88rem', fontWeight:700, cursor:(!dirty||saving)?'not-allowed':'pointer', transition:'all 0.15s', ...(dirty&&!saving ? { background:'var(--navy)', color:'white', boxShadow:'0 3px 10px rgba(15,39,68,0.25)' } : { background:'var(--gray-200)', color:'var(--gray-400)' }) }}>
            <Save size={14}/> {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
        )}
      </div>

      {/* ── Canvas ── */}
      <div ref={canvasRef} style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', background:'var(--cream)', cursor:connectMode?'crosshair':'default' }}
        onMouseDown={onSvgMouseDown}>

        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(255,255,255,0.85)', zIndex:50 }}>
            <div className="spinner"/>
          </div>
        )}

        {/* Node editor */}
        {showEditor && (
          <GSNodeEditor
            node={selectedNodeObj}
            allNodes={nodes}
            allEdges={edges}
            allPersons={allPersons}
            allUnregistered={allUnregistered}
            onUpdate={(changes) => updateNode(selectedNode, changes)}
            onDelete={() => deleteNode(selectedNode)}
            onClose={() => setSelected(null)}
            onRegisterClick={(node) => { onRegisterPerson && onRegisterPerson(node.baseName || node.name || '') }}
            onViewProfile={(pid) => { onViewProfile && onViewProfile(pid) }}
            onViewUnregisteredProfile={(uid) => { onViewUnregisteredProfile && onViewUnregisteredProfile(uid) }}
          />
        )}

        <svg ref={svgRef} style={{ width:'100%', height:'100%' }}>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {visibleEdges.map(edge => {
              const fromNode = visibleNodes.find(n=>n.id===edge.from)
              const toNode   = visibleNodes.find(n=>n.id===edge.to)
              if (!fromNode || !toNode) return null
              const d = edgePath(fromNode, toNode, edge.type)
              return (
                <g key={edge.id}>
                  <path d={d} fill="none" stroke={edge.auto?'#4a7fb5':edge.type==='peer'?'var(--gold)':'var(--navy)'} strokeWidth={edge.auto?2.5:2} strokeOpacity={edge.auto?0.75:edge.type==='peer'?0.6:0.4} strokeDasharray={edge.type==='peer'?'6,4':'none'}/>
                  {!viewOnly && (
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor:'pointer' }} onClick={()=>removeEdge(edge.id)}/>
                  )}
                </g>
              )
            })}

            {/* Hulls */}
            {renderHulls()}

            {/* Nodes */}
            {visibleNodes.map(node => (
              <GSNode key={node.id} node={node}
                selected={selectedNode===node.id}
                connectMode={!!connectMode} connectSource={connectSource}
                onSelect={setSelected} onDragStart={viewOnly?()=>{}:onNodeDragStart}
                onAddChild={viewOnly?()=>{}:addNode}
                onToggleConnect={viewOnly?()=>{}:toggleConnect}
                animating={animating} viewOnly={viewOnly}
              />
            ))}
          </g>
        </svg>

        {!loading && visibleNodes.length === 0 && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
            <GitBranch size={52} style={{ color:'var(--gray-300)', marginBottom:16 }}/>
            <p style={{ color:'var(--gray-400)', fontSize:'1rem', fontWeight:600 }}>
              لا يوجد هيكل للأمانة العامة بعد
            </p>
            {!viewOnly && <p style={{ color:'var(--gray-400)', fontSize:'0.85rem', marginTop:4 }}>اضغط "إضافة عقدة" لبدء البناء</p>}
          </div>
        )}

      </div>

      {/* Modals */}
      {showPeriodModal && (
        <PeriodBrowserModal
          periods={periods}
          currentPeriod={currentPeriod}
          groupKey={GS_GROUP_KEY}
          onSelect={loadPeriod}
          onPeriodsUpdated={() => {
            api.getOrgTree(GS_GROUP_KEY).then(data => {
              setPeriods(data.periods || [])
              if (data.period) setCurrentPeriod(data.period)
            })
          }}
          onClose={() => setShowPeriodModal(false)}
        />
      )}
      {showSaveModal && (
        <UnifiedSaveModal
          currentPeriod={currentPeriod}
          periods={periods}
          onSaveToPeriod={handleSaveToPeriod}
          onConfirmNewPeriod={handleSaveWithPeriod}
          onCancel={() => setShowSaveModal(false)}
        />
      )}
    </div>
  )
}
