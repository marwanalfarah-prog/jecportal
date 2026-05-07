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
const NODE_BASE_H = 100   // height when role fits on 1 line
const NODE_EXTRA_H = 15  // added per extra role line
const H_GAP  = 22
const V_GAP  = 84

// Estimate pixel width of Arabic/Latin text at given font size
// Using ~7px per char for Cairo bold (name) and ~6.2px for Tajawal (role)
function estimateTextW(text, fontSize, bold = false) {
  if (!text) return 0
  const charW = bold ? fontSize * 0.62 : fontSize * 0.56
  return text.length * charW
}

// Wrap text into lines that fit within maxW pixels
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

// Compute dynamic node width and height for a given node
function nodeSize(node) {
  const displayName = nodeDisplayName(node) || 'بدون اسم'
  const role = node.role || 'بدون دور'
  const TEXT_PAD = 16

  // Name: Cairo bold 12px — one line, widen node if needed
  const nameW = estimateTextW(displayName, 12, true) + TEXT_PAD * 2
  // Role: Tajawal 10px — can wrap to 2 lines
  // Compute how many lines role needs given candidate width
  const candidateW = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, nameW))
  const roleLines = wrapText(role, 10, candidateW - TEXT_PAD * 2, false)
  // Final width
  const roleLineMaxW = Math.max(...roleLines.map(l => estimateTextW(l, 10, false)))
  const w = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, nameW, roleLineMaxW + TEXT_PAD * 2))
  const h = NODE_BASE_H + Math.max(0, roleLines.length - 1) * NODE_EXTRA_H
  return { w, h, roleLines }
}

// ── Deputy detection — purely from role text ──────────────────────────────────
function isDeputyRole(role) {
  return typeof role === 'string' && role.includes('نائب')
}
function shortName(fullName) {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 2) return fullName
  return parts[0] + ' ' + parts[parts.length - 1]
}

// For org-tree node display: laqab + first + last name from baseName
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

// ── Today as YYYY-MM-DD ───────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return d }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPACT TIDY LAYOUT  (Reingold–Tilford inspired, multi-root aware)
// ─────────────────────────────────────────────────────────────────────────────
function computeTidyLayout(nodes, edges) {
  if (!nodes.length) return {}

  // Pre-compute per-node widths for layout
  const nW = {}
  const nH = {}
  nodes.forEach(n => { const s = nodeSize(n); nW[n.id] = s.w; nH[n.id] = s.h })

  const hierarchyEdges = edges.filter(e => e.type === 'hierarchy')
  const peerEdges      = edges.filter(e => e.type === 'peer')

  const childrenOf = {}
  const parentsOf  = {}
  nodes.forEach(n => { childrenOf[n.id] = []; parentsOf[n.id] = [] })
  hierarchyEdges.forEach(e => {
    if (childrenOf[e.from] !== undefined && parentsOf[e.to] !== undefined) {
      childrenOf[e.from].push(e.to)
      parentsOf[e.to].push(e.from)
    }
  })

  const rootIds = nodes.filter(n => parentsOf[n.id].length === 0).map(n => n.id)

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
      if (inDeg[cid] <= 0 && !bfsVisited.has(cid)) {
        bfsVisited.add(cid)
        bfsQueue.push(cid)
      }
    })
  }

  peerEdges.forEach(e => {
    const fromNode = nodes.find(n => n.id === e.from)
    const toNode   = nodes.find(n => n.id === e.to)
    const fromTier = classifyRole(fromNode?.role)?.tier
    const toTier   = classifyRole(toNode?.role)?.tier
    const fromIsGuide = fromTier === 'spiritual_guide_agegroup'
    const toIsGuide   = toTier   === 'spiritual_guide_agegroup'

    if (fromIsGuide && !toIsGuide) {
      // مرشد روحي فئة adopts the depth of مسؤول فئة peer — never pulls it up
      depthOf[e.from] = depthOf[e.to] ?? 0
    } else if (toIsGuide && !fromIsGuide) {
      depthOf[e.to] = depthOf[e.from] ?? 0
    } else {
      // Default: both snap to the shallower depth
      const d = Math.min(depthOf[e.from] ?? 0, depthOf[e.to] ?? 0)
      depthOf[e.from] = d
      depthOf[e.to]   = d
    }
  })

  const TREE_GAP = 60

  // Build guide↔partner lookup
  const guidePeerOf = {}   // guideId → partnerId
  peerEdges.forEach(e => {
    const fromNode = nodes.find(n => n.id === e.from)
    const toNode   = nodes.find(n => n.id === e.to)
    const fromTier = classifyRole(fromNode?.role)?.tier
    const toTier   = classifyRole(toNode?.role)?.tier
    if (fromTier === 'spiritual_guide_agegroup' && toTier !== 'spiritual_guide_agegroup')
      guidePeerOf[e.from] = e.to
    if (toTier === 'spiritual_guide_agegroup' && fromTier !== 'spiritual_guide_agegroup')
      guidePeerOf[e.to] = e.from
  })
  const guideIds = new Set(Object.keys(guidePeerOf))
  // partnerOf[guideId] = partnerId
  const partnerOf = guidePeerOf  // alias for clarity

  // Place each guide as a sibling of its partner under the partner's parent,
  // so guide and partner are laid out side-by-side at the same depth row.
  // (Injecting the guide as a child of its partner caused them to share the
  //  same X coordinate and stack on top of each other.)
  const layoutChildrenOf = {}
  nodes.forEach(n => { layoutChildrenOf[n.id] = [...(childrenOf[n.id] || [])] })

  Object.entries(partnerOf).forEach(([guideId, partnerId]) => {
    layoutChildrenOf[guideId] = []  // guide has no layout children
    // Find the node whose children include the partner and inject the guide
    // right after it, making them horizontal siblings in the layout tree.
    for (const n of nodes) {
      const kids = layoutChildrenOf[n.id]
      const idx = kids.indexOf(partnerId)
      if (idx !== -1 && !kids.includes(guideId)) {
        kids.splice(idx + 1, 0, guideId)
        break
      }
    }
  })

  const subtreeW  = {}
  const wMeasured = new Set()

  function measureWidth(id) {
    if (wMeasured.has(id)) return subtreeW[id] ?? nW[id] ?? NODE_MIN_W
    wMeasured.add(id)
    const myW = nW[id] ?? NODE_MIN_W
    const kids = layoutChildrenOf[id] || []
    if (kids.length === 0) { subtreeW[id] = myW; return myW }
    let total = 0
    kids.forEach((kid, i) => {
      total += measureWidth(kid)
      if (i < kids.length - 1) total += H_GAP
    })
    subtreeW[id] = Math.max(myW, total)
    return subtreeW[id]
  }

  rootIds.forEach(id => { if (!guideIds.has(id)) measureWidth(id) })
  nodes.forEach(n => { if (!wMeasured.has(n.id)) measureWidth(n.id) })

  const posX    = {}
  const xPlaced = new Set()

  function assignX(id, leftEdge) {
    if (xPlaced.has(id)) return
    xPlaced.add(id)
    const sw  = subtreeW[id] ?? (nW[id] ?? NODE_MIN_W)
    const myW = nW[id] ?? NODE_MIN_W
    posX[id] = leftEdge + sw / 2
    const kids = layoutChildrenOf[id] || []
    if (!kids.length) return
    const kidsTotal = kids.reduce(
      (s, k, i) => s + (subtreeW[k] ?? (nW[k] ?? NODE_MIN_W)) + (i < kids.length - 1 ? H_GAP : 0), 0
    )
    let cur = posX[id] - kidsTotal / 2
    kids.forEach(kid => {
      assignX(kid, cur)
      cur += (subtreeW[kid] ?? (nW[kid] ?? NODE_MIN_W)) + H_GAP
    })
  }

  let cursor = 0
  rootIds.forEach(id => {
    if (guideIds.has(id)) return
    assignX(id, cursor)
    cursor += (subtreeW[id] ?? (nW[id] ?? NODE_MIN_W)) + TREE_GAP
  })
  nodes.forEach(n => {
    if (!xPlaced.has(n.id) && !guideIds.has(n.id)) {
      assignX(n.id, cursor)
      cursor += (nW[n.id] ?? NODE_MIN_W) + TREE_GAP
    }
  })
  // Fallback for any unplaced guides
  nodes.forEach(n => {
    if (!xPlaced.has(n.id)) {
      assignX(n.id, cursor)
      cursor += (nW[n.id] ?? NODE_MIN_W) + TREE_GAP
    }
  })

  const TOP_OFFSET = 80
  // Build per-depth max-height so each depth row accounts for tallest node
  const maxHAtDepth = {}
  nodes.forEach(n => {
    const d = Math.floor(depthOf[n.id] ?? 0)
    const h = nH[n.id] ?? NODE_BASE_H
    maxHAtDepth[d] = Math.max(maxHAtDepth[d] ?? NODE_BASE_H, h)
  })
  // Cumulative Y offsets per depth
  const depthY = {}
  let yOff = TOP_OFFSET
  const maxDepth = Math.max(0, ...Object.keys(maxHAtDepth).map(Number))
  for (let d = 0; d <= maxDepth; d++) {
    depthY[d] = yOff + (maxHAtDepth[d] ?? NODE_BASE_H) / 2
    yOff += (maxHAtDepth[d] ?? NODE_BASE_H) + V_GAP
  }

  const positions  = {}
  nodes.forEach(n => {
    let depth = depthOf[n.id] ?? 0
    const depthFloor = Math.floor(depth)
    const depthFrac  = depth - depthFloor  // 0 or 0.5 for deputies
    const baseY = depthY[depthFloor] ?? (TOP_OFFSET + depthFloor * (NODE_BASE_H + V_GAP))
    const nextY = depthY[depthFloor + 1] ?? (baseY + NODE_BASE_H + V_GAP)
    positions[n.id] = {
      x: posX[n.id] ?? 0,
      y: baseY + depthFrac * (nextY - baseY),
    }
  })
  return positions
}

// ── Edge path helpers ─────────────────────────────────────────────────────────
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
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 20,
      background: isActive ? '#e8f5e9' : '#f5f5f5',
      border: `1.5px solid ${isActive ? '#4caf50' : '#bdbdbd'}`,
      color: isActive ? '#2e7d32' : '#616161',
      fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
      fontFamily: 'var(--font-body)',
    }}>
      <Clock size={13}/>
      {year} {getPeriodLabel(period, isActive)}
      {' · '}
      {period?.from_date ? formatDate(period.from_date) : 'غير محدد'}
      {' — '}
      {isActive ? 'الآن' : formatDate(period?.to_date)}
      <ChevronDown size={13}/>
    </button>
  )
}

// ── Unified save modal — always shown on save, presents all three options ─────
function UnifiedSaveModal({ currentPeriod, periods, defaultJecYear = '', onSaveToPeriod, onConfirmNewPeriod, onCancel }) {
  const todayStr = today()
  // 'same' | 'active' | 'new'
  const [mode, setMode]           = useState(null)
  const [jecYear, setJecYear]     = useState(currentPeriod?.jec_year ? String(currentPeriod.jec_year) : (String(defaultJecYear || '').trim() || new Date().getFullYear().toString()))
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
      navy:   { border:'var(--navy)',  bg:'#eef4ff', titleColor:'var(--navy)',  subColor:'#3b5998' },
      gold:   { border:'var(--gold)',  bg:'#fffbeb', titleColor:'#92400e',     subColor:'#a16207' },
      green:  { border:'#4caf50',      bg:'#f1faf1', titleColor:'#1b5e20',     subColor:'#388e3c' },
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

// ── Period browser modal ──────────────────────────────────────────────────────
function PeriodBrowserModal({ periods, currentPeriod, selectedGroup, onSelect, onPeriodsUpdated, onClose }) {
  const todayStr = today()
  const [editingId, setEditingId]   = useState(null)   // period id being edited
  const [editForm, setEditForm]     = useState({})
  const [editError, setEditError]   = useState('')
  const [saving, setSaving]         = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting]     = useState(false)

  // Group by jec_year
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
      if (p.id === periodId) continue          // skip self
      if (!p.to_date) continue                 // skip other active period (only one can exist)
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
      await api.updatePeriod(selectedGroup, editingId, body)
      setEditingId(null)
      setEditError('')
      onPeriodsUpdated()   // reload periods from parent
    } catch {
      setEditError('حدث خطأ أثناء الحفظ')
    }
    setSaving(false)
  }

  const setF = (k) => (ev) => setEditForm(f => ({ ...f, [k]: ev.target.value }))

  const handleDelete = async (periodId) => {
    setDeleting(true)
    try {
      await api.deletePeriod(selectedGroup, periodId)
      setConfirmDeleteId(null)
      onPeriodsUpdated()
    } catch {
      // show nothing — parent will refresh anyway
    }
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
              {/* Year header */}
              <div style={{
                background: 'var(--navy)',
                padding: '9px 16px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Calendar size={13} style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}/>
                <span style={{ color: 'white', fontWeight: 800, fontSize: '0.9rem', fontFamily: 'var(--font-head)' }}>
                  سنة JEC {year}
                </span>
                <span style={{ marginRight: 'auto', fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
                  {byYear[year].length} {byYear[year].length === 1 ? 'فترة' : 'فترات'}
                </span>
              </div>

              {/* Periods inside the box */}
              <div style={{ padding: '10px 10px 4px' }}>
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
                    {/* Row header — click to select, pencil to edit, trash to delete */}
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

                        {/* Confirm delete inline */}
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

                    {/* Inline edit form */}
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
                        {/* حتى الآن toggle */}
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

// ── Role picker ───────────────────────────────────────────────────────────────
// Age groups ordered youngest → oldest
const BARAEM_GROUP = 'البراعم'
const BARAEM_BIG_GROUP = 'البراعم الكبرى'
const BARAEM_SMALL_GROUP = 'البراعم الصغرى'
const BARAEM_ROLE_GROUPS = [BARAEM_GROUP, BARAEM_BIG_GROUP, BARAEM_SMALL_GROUP]
const BARAEM_DETAIL_OPTIONS = [
  { value: BARAEM_GROUP, label: 'عام' },
  { value: BARAEM_BIG_GROUP, label: 'الكبرى' },
  { value: BARAEM_SMALL_GROUP, label: 'الصغرى' },
]
const AGE_GROUPS = [BARAEM_GROUP, 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']
const ROLE_AGE_GROUPS = [BARAEM_GROUP, BARAEM_BIG_GROUP, BARAEM_SMALL_GROUP, 'الإعدادي', 'الثانوي', 'الجامعيّة', 'العاملة']

// Committees
const COMMITTEES = ['اللجنة الإعلاميّة', 'اللجنة الفنيّة', 'اللجنة الاجتماعيّة', 'لجنة الخدمة', 'لجنة العلاقات العامة', 'اللجنة اللوجستية', 'الفرقة الموسيقيّة', 'لجنة التنظيم', 'اللجنة الروحيّة', 'لجنة عمل المحبة', 'لجنة المواضيع', 'لجنة النشاطات', 'لجنة التدريب والتطوير', 'لجنة المساندة العامة', 'اللجنة الترفيهيّة']

function hasBaraemSelection(groups) {
  const list = Array.isArray(groups) ? groups : []
  return BARAEM_ROLE_GROUPS.some(g => list.includes(g))
}

function selectedBaraemGroup(groups) {
  const list = Array.isArray(groups) ? groups : []
  return BARAEM_ROLE_GROUPS.find(g => list.includes(g)) || ''
}

function setBaraemGroup(groups, group) {
  const list = Array.isArray(groups) ? groups : []
  return [...list.filter(g => !BARAEM_ROLE_GROUPS.includes(g)), group]
}

function toggleAgeGroupSelection(groups, group) {
  const list = Array.isArray(groups) ? groups : []
  if (group === BARAEM_GROUP) {
    return hasBaraemSelection(list)
      ? list.filter(g => !BARAEM_ROLE_GROUPS.includes(g))
      : [...list, BARAEM_GROUP]
  }
  return list.includes(group) ? list.filter(x => x !== group) : [...list, group]
}

function extractAgeGroupsFromRole(role) {
  const text = role || ''
  const found = []
  if (text.includes(BARAEM_BIG_GROUP)) found.push(BARAEM_BIG_GROUP)
  if (text.includes(BARAEM_SMALL_GROUP)) found.push(BARAEM_SMALL_GROUP)
  if (!found.length && text.includes(BARAEM_GROUP)) found.push(BARAEM_GROUP)
  ROLE_AGE_GROUPS
    .filter(g => !BARAEM_ROLE_GROUPS.includes(g))
    .forEach(g => {
      if (text.includes(g)) found.push(g)
    })
  return found
}

function sortAgeGroupsForLabel(groups) {
  const set = new Set(Array.isArray(groups) ? groups : [])
  if (set.has(BARAEM_GROUP)) {
    set.delete(BARAEM_BIG_GROUP)
    set.delete(BARAEM_SMALL_GROUP)
  }
  return ROLE_AGE_GROUPS.filter(g => set.has(g))
}

function ageGroupsOverlap(aGroups, bGroups) {
  const aList = Array.isArray(aGroups) ? aGroups : []
  const bList = Array.isArray(bGroups) ? bGroups : []
  return aList.some(a => bList.some(b => {
    if (a === b) return true
    return BARAEM_ROLE_GROUPS.includes(a) && BARAEM_ROLE_GROUPS.includes(b) && (a === BARAEM_GROUP || b === BARAEM_GROUP)
  }))
}

// Build a shared age-group list label (e.g. "فئتيّ الجامعيّة والعاملة")
function buildGroupsLabel(selectedGroups) {
  const ordered = sortAgeGroupsForLabel(selectedGroups)
  if (!ordered.length) return ''
  const n = ordered.length
  const groupWord = n === 1 ? 'فئة' : n === 2 ? 'فئتيّ' : 'فئات'
  const groupList = n === 1 ? ordered[0]
    : n === 2 ? `${ordered[0]} و${ordered[1]}`
    : ordered.slice(0, -1).join(' و') + ' و' + ordered[ordered.length - 1]
  return `${groupWord} ${groupList}`
}

// Generate title for "مسؤول فئة" variant
function buildAgeGroupTitle(selectedGroups, memberType) {
  const gl = buildGroupsLabel(selectedGroups)
  if (!gl) return ''
  if (memberType === 'مسؤول')        return `مسؤول ${gl}`
  if (memberType === 'عضو مجلس')     return `مجلس ${gl}`
  if (memberType === 'مسؤول مساعد')  return `مسؤول مساعد في ${gl}`
  return ''
}

// Generate title for "مرشد روحي فئة" variant
function buildSpiritualGuideTitle(selectedGroups) {
  const gl = buildGroupsLabel(selectedGroups)
  if (!gl) return ''
  return `مرشد روحي ${gl}`
}

// Generate title for committee variant — committee is now an ordered array
function buildCommitteeTitle(committees, memberType) {
  if (!committees || !committees.length) return ''
  const name = committees.length === 1
    ? committees[0]
    : committees.join(' و ')
  if (memberType === 'مسؤول') return `مسؤول ${name}`
  return name
}

// Parse an existing role string back to structured form (best-effort)
const ACTING_PREFIX = 'قائم بأعمال '

function parseRole(role) {
  if (!role) return { type: null }
  const isActing = role.startsWith(ACTING_PREFIX)
  if (isActing) role = role.slice(ACTING_PREFIX.length)
  const base = parseRoleBase(role)
  return { ...base, isActing }
}

function parseRoleBase(role) {
  if (!role) return { type: null }

  // Tab 1 — GM / deputy
  if (role === 'المسؤول العام' || role === 'نائب المسؤول العام' || role === 'مستشار الشبيبة')
    return { type: 'gm', value: role }

  // Tab 2 — Spiritual guides (fixed + age-group variant)
  if (role === 'المرشد الروحي' || role === 'مساعد المرشد الروحي')
    return { type: 'spiritual', value: role }
  for (const gw of ['فئة', 'فئتيّ', 'فئات']) {
    const prefix = `مرشد روحي ${gw} `
    if (role.startsWith(prefix)) {
      const found = extractAgeGroupsFromRole(role)
      if (found.length) return { type: 'spiritual', value: 'مرشد روحي فئة', selectedGroups: found }
    }
  }

  // Tab 3 — Secretaries
  if (role === 'أمين الصندوق' || role === 'أمين السر' || role === 'أمين العهدة')
    return { type: 'secretaries', value: role, isAssistant: false }
  if (role === 'مساعد أمين الصندوق' || role === 'مساعد أمين السر' || role === 'مساعد أمين العهدة')
    return { type: 'secretaries', value: role.slice('مساعد '.length), isAssistant: true }

  // Committee — role may be a composite of multiple committees joined with و
  {
    const tryParse = (str) => {
      // Try splitting on و (with optional spaces) and see if all parts are known committees
      const parts = str.split(/\s+و\s*|\s*و\s+/).map(s => s.trim()).filter(Boolean)
      if (parts.length && parts.every(p => COMMITTEES.includes(p))) return parts
      return null
    }
    // Member: bare name
    const memberParts = tryParse(role)
    if (memberParts) return { type: 'committee', committees: memberParts, memberType: 'عضو' }
    // Head: مسؤول <name>
    if (role.startsWith('مسؤول ')) {
      const rest = role.slice('مسؤول '.length)
      const headParts = tryParse(rest)
      if (headParts) return { type: 'committee', committees: headParts, memberType: 'مسؤول' }
    }
  }

  // Age group
  const ageMemberTypes = ['مسؤول', 'عضو مجلس', 'مسؤول مساعد']
  for (const mt of ageMemberTypes) {
    for (const gw of ['فئة', 'فئتيّ', 'فئات']) {
      let prefix = ''
      if (mt === 'مسؤول') prefix = `مسؤول ${gw} `
      else if (mt === 'عضو مجلس') prefix = `مجلس ${gw} `
      else prefix = `مسؤول مساعد في ${gw} `
      if (role.startsWith(prefix)) {
        const found = extractAgeGroupsFromRole(role)
        if (found.length) return { type: 'agegroup', selectedGroups: found, memberType: mt }
      }
    }
  }

  return { type: null, unknownValue: role }
}

// The 5 tabs
const ROLE_TABS = [
  { id: 'gm',          label: 'مسؤول عام/نائب' },
  { id: 'spiritual',   label: 'المرشدون الروحيون' },
  { id: 'secretaries', label: 'الأمناء' },
  { id: 'agegroup',    label: 'مسؤول فئة' },
  { id: 'committee',   label: 'لجنة' },
]

function RolePicker({ role, onChange }) {
  const parsed = parseRole(role)

  const [tab, setTab]                         = useState(parsed.type || null)
  const [gmValue, setGmValue]                 = useState(parsed.type === 'gm' ? parsed.value : '')
  const [spiritualValue, setSpiritualValue]   = useState(parsed.type === 'spiritual' ? (parsed.value || '') : '')
  const [sgGroups, setSgGroups]               = useState(parsed.type === 'spiritual' && parsed.selectedGroups ? parsed.selectedGroups : [])
  const [secretaryValue, setSecretaryValue]   = useState(parsed.type === 'secretaries' ? parsed.value : '')
  const [secretaryAssistant, setSecretaryAssistant] = useState(parsed.type === 'secretaries' && parsed.isAssistant ? true : false)
  const [selectedGroups, setSelectedGroups]   = useState(parsed.selectedGroups || [])
  const [ageMemberType, setAgeMemberType]     = useState(parsed.memberType || 'مسؤول')
  const [selectedCommittees, setSelectedCommittees] = useState(parsed.type === 'committee' ? (parsed.committees || []) : [])
  const [committeeMemberType, setCommitteeMemberType] = useState(parsed.memberType || 'عضو')
  const [isActing, setIsActing] = useState(parsed.isActing || false)

  // Compute the emitted role from current tab state
  const computeRole = useCallback((
    t = tab, gv = gmValue, sv = spiritualValue, sg = sgGroups,
    secv = secretaryValue, seca = secretaryAssistant, selg = selectedGroups, amt = ageMemberType,
    coms = selectedCommittees, cmt = committeeMemberType, acting = isActing
  ) => {
    let base = ''
    if (t === 'gm')          base = gv
    else if (t === 'spiritual')   base = sv === 'مرشد روحي فئة' ? buildSpiritualGuideTitle(sg) : sv
    else if (t === 'secretaries') base = secv ? (seca ? `مساعد ${secv}` : secv) : ''
    else if (t === 'agegroup')    base = buildAgeGroupTitle(selg, amt)
    else if (t === 'committee')   base = buildCommitteeTitle(coms, cmt)
    if (!base) return ''
    return acting ? `${ACTING_PREFIX}${base}` : base
  }, [tab, gmValue, spiritualValue, sgGroups, secretaryValue, secretaryAssistant, selectedGroups, ageMemberType, selectedCommittees, committeeMemberType, isActing])

  useEffect(() => {
    const r = computeRole()
    if (r) onChange(r)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, gmValue, spiritualValue, sgGroups, secretaryValue, secretaryAssistant, selectedGroups, ageMemberType, selectedCommittees, committeeMemberType, isActing])

  const toggleGroup = (g) => setSelectedGroups(prev => toggleAgeGroupSelection(prev, g))
  const toggleSgGroup = (g) => setSgGroups(prev => toggleAgeGroupSelection(prev, g))

  const preview = computeRole()

  const sectionStyle = { marginBottom: 10, padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-200)' }
  const labelStyle   = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--gray-400)', marginBottom: 6, display: 'block', letterSpacing: '0.04em' }
  const chipBase     = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', transition: 'all 0.15s', fontFamily: 'var(--font-body)' }
  const chipActive   = { ...chipBase, background: 'var(--navy)', borderColor: 'var(--navy)', color: 'white' }
  const chipInactive = { ...chipBase, background: 'white', borderColor: 'var(--gray-200)', color: 'var(--gray-600)' }
  const checkBase    = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', transition: 'all 0.15s', fontFamily: 'var(--font-body)' }
  const checkActive  = { ...checkBase, background: '#eef4ff', borderColor: 'var(--navy)', color: 'var(--navy)' }
  const checkInactive= { ...checkBase, background: 'white', borderColor: 'var(--gray-200)', color: 'var(--gray-500)' }
  const rowBtn = (active) => ({ ...chipBase, borderRadius: 6, width: '100%', justifyContent: 'flex-start', padding: '6px 12px', ...(active ? { background: 'var(--navy)', borderColor: 'var(--navy)', color: 'white' } : { background: 'white', borderColor: 'var(--gray-200)', color: 'var(--gray-700)' }) })

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-500)', display: 'block', marginBottom: 6 }}>
        المسؤولية / الدور
      </label>

      {/* 5 tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3, marginBottom: 10 }}>
        {ROLE_TABS.map(({ id, label }) => (
          <button key={id} type="button"
            style={{
              padding: '5px 4px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 700,
              cursor: 'pointer', border: '1.5px solid', transition: 'all 0.15s',
              fontFamily: 'var(--font-body)', textAlign: 'center', lineHeight: 1.3,
              ...(tab === id
                ? { background: 'var(--navy)', borderColor: 'var(--navy)', color: 'white' }
                : { background: 'white', borderColor: 'var(--gray-200)', color: 'var(--gray-600)' })
            }}
            onClick={() => setTab(id === tab ? null : id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1 — GM / Deputy */}
      {tab === 'gm' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {['المسؤول العام', 'نائب المسؤول العام', 'مستشار الشبيبة'].map(r => (
              <button key={r} type="button" style={rowBtn(gmValue === r)} onClick={() => setGmValue(r)}>{r}</button>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2 — Spiritual guides */}
      {tab === 'spiritual' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {['المرشد الروحي', 'مساعد المرشد الروحي', 'مرشد روحي فئة'].map(r => (
              <button key={r} type="button" style={rowBtn(spiritualValue === r)} onClick={() => { setSpiritualValue(r); if (r !== 'مرشد روحي فئة') setSgGroups([]) }}>{r}</button>
            ))}
          </div>
          {spiritualValue === 'مرشد روحي فئة' && (
            <>
              <span style={labelStyle}>الفئات العمرية</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {AGE_GROUPS.map(g => {
                  const checked = g === BARAEM_GROUP ? hasBaraemSelection(sgGroups) : sgGroups.includes(g)
                  return (
                    <button key={g} type="button" style={checked ? checkActive : checkInactive} onClick={() => toggleSgGroup(g)}>
                      {checked && <span style={{ fontSize: '0.7rem' }}>✓</span>} {g}
                    </button>
                  )
                })}
              </div>
              {hasBaraemSelection(sgGroups) && (
                <div style={{ marginTop: 8 }}>
                  <span style={labelStyle}>تفصيل البراعم</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {BARAEM_DETAIL_OPTIONS.map(opt => {
                      const checked = selectedBaraemGroup(sgGroups) === opt.value
                      return (
                        <button key={opt.value} type="button" style={checked ? checkActive : checkInactive} onClick={() => setSgGroups(prev => setBaraemGroup(prev, opt.value))}>
                          {checked && <span style={{ fontSize: '0.7rem' }}>✓</span>} {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab 3 — Secretaries */}
      {tab === 'secretaries' && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {['أمين الصندوق', 'أمين السر', 'أمين العهدة'].map(r => (
              <button key={r} type="button" style={rowBtn(secretaryValue === r)} onClick={() => setSecretaryValue(r)}>{r}</button>
            ))}
          </div>
          {secretaryValue && (
            <button
              type="button"
              style={secretaryAssistant ? checkActive : checkInactive}
              onClick={() => setSecretaryAssistant(v => !v)}
            >
              {secretaryAssistant && <span style={{ fontSize: '0.7rem' }}>✓</span>}
              مساعد (مثال: مساعد {secretaryValue})
            </button>
          )}
        </div>
      )}

      {/* Tab 4 — Age group */}
      {tab === 'agegroup' && (
        <div style={sectionStyle}>
          <span style={labelStyle}>نوع المشاركة</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {['مسؤول', 'عضو مجلس', 'مسؤول مساعد'].map(mt => (
              <button key={mt} type="button" style={ageMemberType === mt ? checkActive : checkInactive} onClick={() => setAgeMemberType(mt)}>{mt}</button>
            ))}
          </div>
          <span style={labelStyle}>الفئات العمرية</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {AGE_GROUPS.map(g => {
              const checked = g === BARAEM_GROUP ? hasBaraemSelection(selectedGroups) : selectedGroups.includes(g)
              return (
                <button key={g} type="button" style={checked ? checkActive : checkInactive} onClick={() => toggleGroup(g)}>
                  {checked && <span style={{ fontSize: '0.7rem' }}>✓</span>} {g}
                </button>
              )
            })}
          </div>
          {hasBaraemSelection(selectedGroups) && (
            <div style={{ marginTop: 8 }}>
              <span style={labelStyle}>تفصيل البراعم</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {BARAEM_DETAIL_OPTIONS.map(opt => {
                  const checked = selectedBaraemGroup(selectedGroups) === opt.value
                  return (
                    <button key={opt.value} type="button" style={checked ? checkActive : checkInactive} onClick={() => setSelectedGroups(prev => setBaraemGroup(prev, opt.value))}>
                      {checked && <span style={{ fontSize: '0.7rem' }}>✓</span>} {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 5 — Committee */}
      {tab === 'committee' && (
        <div style={sectionStyle}>
          <span style={labelStyle}>اللجان (يمكن اختيار أكثر من واحدة)</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
            {COMMITTEES.map(c => {
              const checked = selectedCommittees.includes(c)
              return (
                <button key={c} type="button"
                  style={{ ...rowBtn(checked), justifyContent: 'space-between' }}
                  onClick={() => setSelectedCommittees(prev =>
                    prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
                  )}>
                  <span>{c}</span>
                  <span style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${checked ? 'white' : 'var(--gray-300)'}`,
                    background: checked ? 'rgba(255,255,255,0.3)' : 'white',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', color: checked ? 'white' : 'transparent',
                  }}>✓</span>
                </button>
              )
            })}
          </div>
          <span style={labelStyle}>الصفة</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['مسؤول', 'عضو'].map(mt => (
              <button key={mt} type="button" style={committeeMemberType === mt ? checkActive : checkInactive} onClick={() => setCommitteeMemberType(mt)}>{mt}</button>
            ))}
          </div>
        </div>
      )}

      {/* قائم بأعمال — applies to any role */}
      {tab && (
        <button
          type="button"
          style={isActing
            ? { ...checkBase, background: '#fff8e1', borderColor: '#e8b55a', color: '#92400e', marginBottom: 6, width: '100%', justifyContent: 'space-between' }
            : { ...checkBase, background: 'white', borderColor: 'var(--gray-200)', color: 'var(--gray-500)', marginBottom: 6, width: '100%', justifyContent: 'space-between' }
          }
          onClick={() => setIsActing(v => !v)}
        >
          <span>قائم بأعمال</span>
          <span style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            border: `2px solid ${isActing ? '#c9963c' : 'var(--gray-300)'}`,
            background: isActing ? '#c9963c' : 'white',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', color: isActing ? 'white' : 'transparent',
          }}>✓</span>
        </button>
      )}

      {/* Preview */}
      {preview && (
        <div style={{ marginTop: 8, padding: '6px 12px', background: '#eef4ff', borderRadius: 'var(--radius-md)', border: '1px solid #c3d9ff', fontSize: '0.83rem', fontWeight: 700, color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--gray-400)', fontWeight: 400, flexShrink: 0 }}>سيظهر كـ:</span>
          {preview}
        </div>
      )}
    </div>
  )
}

// ── Node editor panel ─────────────────────────────────────────────────────────
function NodeEditor({ node, allNodes, allEdges, allPersons, allUnregistered, selectedGroup, onUpdate, onDelete, onClose, onRegisterClick, onViewProfile, onViewUnregisteredProfile }) {
  const [nameQ, setNameQ]           = useState('')
  const [results, setRes]           = useState([])
  const [photoErr, setPhotoErr]     = useState(false)
  const [personType, setPersonType] = useState(node.personType || 'علماني')
  const [laqab, setLaqab]           = useState(node.laqab || '')
  const [baseName, setBaseName]     = useState(node.baseName || node.name || '')
  const [nameVariations, setNameVariations] = useState({})
  const fileRef = useRef(null)

  const nameAliasLookup = useMemo(() => buildNameAliasLookup(nameVariations), [nameVariations])

  useEffect(() => { setPhotoErr(false) }, [node.photo])

  // Whenever لقب or baseName changes, push the combined name + metadata to the node immediately
  useEffect(() => {
    const combined = (personType === 'مكرّس' && laqab.trim())
      ? `${laqab.trim()} ${baseName}`
      : baseName
    if (combined !== node.name || laqab !== node.laqab || personType !== node.personType || baseName !== node.baseName) {
      onUpdate({ name: combined, personType, laqab, baseName })
    }
  }, [laqab, baseName, personType])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    api.getConfig()
      .then((cfg) => {
        if (!cancelled) setNameVariations(normalizeNameVariations(cfg?.config?.name_variations || {}))
      })
      .catch(() => {
        if (!cancelled) setNameVariations({})
      })
    return () => { cancelled = true }
  }, [])

  const switchType = (type) => {
    setPersonType(type)
    if (type === 'علماني') setLaqab('')
  }

  const reportsToIds   = allEdges.filter(e => e.type === 'hierarchy' && e.to === node.id).map(e => e.from)
  const reportsToNodes = allNodes.filter(n => reportsToIds.includes(n.id))

  const search = (q) => {
    setNameQ(q)
    if (!q.trim()) { setRes([]); return }
    const qWords = normalizeArabic(q).split(/\s+/).filter(Boolean)
    const qWordGroups = expandQueryWords(qWords, nameAliasLookup)

    // Registered persons — filtered to youth group
    const pool = selectedGroup
      ? allPersons.filter(p => (p._youth_group_ids || []).includes(selectedGroup))
      : allPersons
    const regResults = pool.filter(p => {
      const parts = [p.ar_first_name, p.ar_second_name, p.ar_third_name, p.ar_last_name].filter(Boolean).map(normalizeArabic)
      return nameMatchesQuery(parts, qWordGroups)
    }).slice(0, 6).map(p => ({ ...p, _source: 'registered' }))

    // Unregistered persons — no youth_group filter: they may not have person_youth_group
    // rows yet (newly synced), and the list is always small
    const unregResults = (allUnregistered || []).filter(u => {
      const parts = [u.ar_first_name, u.ar_second_name, u.ar_third_name, u.ar_last_name].filter(Boolean).map(normalizeArabic)
      return nameMatchesQuery(parts, qWordGroups)
    }).slice(0, 4).map(u => ({ ...u, _source: 'unregistered' }))

    setRes([...regResults, ...unregResults])
  }

  const pickPerson = (p) => {
    const base = [p.ar_first_name, p.ar_second_name, p.ar_third_name, p.ar_last_name].filter(Boolean).join(' ')
    const combined = (personType === 'مكرّس' && laqab.trim()) ? `${laqab.trim()} ${base}` : base
    setBaseName(base)
    onUpdate({ personId: p.person_id, name: combined, photo: p._photo || null, unregistered: false, personType, laqab, baseName: base })
    setNameQ(''); setRes([])
  }

  const pickUnregistered = (u) => {
    // u is an enriched unregistered record: { person_id, ar_first_name, ar_last_name, title, _photo, ... }
    const base = [u.ar_first_name, u.ar_second_name, u.ar_third_name, u.ar_last_name].filter(Boolean).join(' ')
    const uType = 'علماني'  // personType is not stored in person record; treat all as علماني in tree
    const uLaqab = u.title || ''
    setBaseName(base); setPersonType(uType); setLaqab(uLaqab)
    const combined = uLaqab ? `${uLaqab} ${base}` : base
    onUpdate({ name: combined, baseName: base, laqab: uLaqab, personType: uType,
      photo: u._photo || null,
      unregistered: true, personId: String(u.person_id) })
    setNameQ(''); setRes([])
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (node.personId && !node.unregistered) {
      try {
        await api.uploadPhoto(node.personId, file)
        onUpdate({ photo: api.photoUrl(node.personId, Date.now()) })
      } catch { /* ignore */ }
    } else if (node.unregistered && node.personId) {
      try {
        await api.uploadUnregisteredPhoto(node.personId, file)
        onUpdate({ photo: api.unregisteredPhotoUrl(node.personId, Date.now()) })
      } catch { /* ignore */ }
    } else {
      // Node not yet saved — store as data URL temporarily
      const reader = new FileReader()
      reader.onload = ev => onUpdate({ photo: ev.target.result })
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const hasPhoto = node.photo && !photoErr

  return (
    <div style={{
      position: 'absolute', top: 16, left: 16, bottom: 16, zIndex: 400,
      background: 'white', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)', border: '1px solid var(--gray-200)',
      width: 320, overflow: 'hidden', animation: 'slideUp 0.18s ease',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ background: 'var(--navy)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'white', fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: '0.95rem' }}>تعديل العقدة</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}><X size={18}/></button>
      </div>

      <div style={{ padding: 18, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {/* Reports-to banner */}
        {reportsToNodes.length > 0 && (
          <div style={{ background: '#eef4ff', border: '1px solid #c3d9ff', borderRadius: 'var(--radius-md)', padding: '9px 12px', marginBottom: 14, fontSize: '0.82rem', color: '#1a3a5c', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.78rem', marginBottom: 2 }}>يرفع تقاريره إلى:</span>
            {reportsToNodes.map(rn => (
              <div key={rn.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--navy)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.65rem', fontWeight:700, color:'white', flexShrink:0 }}>
                  {firstNameInitial(rn.baseName || rn.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{rn.name || 'بدون اسم'}</div>
                  {rn.role && <div style={{ fontSize: '0.72rem', color: 'var(--gold)' }}>{rn.role}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Avatar + name row */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{
            width: 58, height: 58, borderRadius: '50%',
            background: node.unregistered ? '#fef3cd' : 'var(--navy)',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', cursor: 'pointer', position: 'relative',
            border: node.unregistered ? '2px dashed #e8b55a' : 'none',
          }} onClick={() => fileRef.current?.click()}>
            {hasPhoto
              ? <img src={node.photo} alt="" onError={() => setPhotoErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
              : <span style={{ color: node.unregistered ? '#c9963c' : 'white', fontSize: '1.2rem', fontWeight: 700 }}>
                  {firstNameInitial(node.baseName || node.name)}
                </span>
            }
            <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', opacity:0, transition:'0.15s' }} className="photo-hover-ov">
              <Camera size={16} color="white"/>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handlePhotoUpload} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--gray-800)', marginBottom: 3 }}>{node.name || 'بدون اسم'}</div>
            {node.role && <div style={{ fontSize: '0.8rem', color: 'var(--gold)', marginBottom: 3 }}>{node.role}</div>}
            {node.unregistered
              ? <div style={{ display:'flex', alignItems:'center', gap:5, background:'#fef3cd', borderRadius:6, padding:'4px 8px', fontSize:'0.73rem', color:'#b45309', width:'fit-content' }}>
                  <AlertCircle size={12}/> غير مسجّل
                </div>
              : node.personId && <div style={{ fontSize:'0.73rem', color:'var(--gray-400)' }}>#{node.personId}</div>
            }
          </div>
        </div>
        <style>{`.photo-hover-ov:hover{opacity:1!important}`}</style>

        {/* View Profile button — registered */}
        {node.personId && !node.unregistered && (
          <button onClick={() => { onViewProfile(node.personId); onClose() }} style={{
            width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            padding:'9px', marginBottom:14, borderRadius:'var(--radius-md)',
            background:'#eef4ff', border:'1.5px solid #b3ccff', color:'#1a3a5c',
            fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer',
          }}>
            <ExternalLink size={14}/> عرض الملف الشخصي
          </button>
        )}

        {/* View Profile button — unregistered */}
        {node.unregistered && node.personId && (
          <button onClick={() => { onViewUnregisteredProfile && onViewUnregisteredProfile(node.personId); onClose() }} style={{
            width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            padding:'9px', marginBottom:14, borderRadius:'var(--radius-md)',
            background:'#fffbeb', border:'1.5px solid #e8b55a', color:'#92400e',
            fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer',
          }}>
            <ExternalLink size={14}/> عرض ملف غير المسجّل
          </button>
        )}

        {/* مكرّس / علماني toggle */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:6 }}>نوع الشخص</label>
          <div style={{ display:'flex', gap:6 }}>
            {['علماني', 'مكرّس'].map(type => (
              <button key={type} type="button"
                onClick={() => switchType(type)}
                style={{
                  flex:1, padding:'7px 0', borderRadius:'var(--radius-md)', fontSize:'0.85rem', fontWeight:700,
                  cursor:'pointer', transition:'all 0.15s', fontFamily:'var(--font-body)',
                  border: personType === type ? '2px solid var(--navy)' : '2px solid var(--gray-200)',
                  background: personType === type ? 'var(--navy)' : 'white',
                  color: personType === type ? 'white' : 'var(--gray-500)',
                }}>
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* اللقب — only for مكرّس */}
        {personType === 'مكرّس' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>اللقب</label>
            <input
              value={laqab}
              onChange={e => setLaqab(e.target.value)}
              placeholder="مثال: الأخ، الأخت، الأب…"
              style={{ width:'100%', padding:'7px 10px', border:'1.5px solid var(--navy)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.85rem', direction:'rtl', textAlign:'right', color:'var(--gray-700)', boxSizing:'border-box', background:'#f8f9ff' }}
            />
          </div>
        )}

        {/* Person search */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>
            {node.personId ? 'تغيير الشخص المرتبط' : 'ربط بشخص مسجّل أو غير مسجّل'}
          </label>
          <div style={{ position: 'relative' }}>
            <input value={nameQ} onChange={e => search(e.target.value)} placeholder="ابحث بالاسم…"
              style={{ width:'100%', padding:'7px 10px 7px 32px', border:'1.5px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.85rem', direction:'rtl', textAlign:'right', color:'var(--gray-700)', boxSizing:'border-box' }}
            />
            <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)' }}/>
          </div>
          {results.length > 0 && (
            <div style={{ border:'1px solid var(--gray-200)', borderRadius:'var(--radius-md)', marginTop:4, maxHeight:220, overflowY:'auto', background:'white', boxShadow:'var(--shadow-md)' }}>
              {results.map((p, idx) => {
                const isUnreg = p._source === 'unregistered'
                // Both registered and unregistered now use same name fields
                const name = [p.ar_first_name, p.ar_second_name, p.ar_third_name, p.ar_last_name].filter(Boolean).join(' ') || 'بدون اسم'
                const photo = p._photo || null
                return (
                  <div key={isUnreg ? `u-${p.person_id}` : p.person_id}
                    onClick={() => isUnreg ? pickUnregistered(p) : pickPerson(p)}
                    style={{ padding:'8px 12px', cursor:'pointer', fontSize:'0.85rem', borderBottom:'1px solid var(--gray-100)', display:'flex', gap:8, alignItems:'center', background:'white' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'}
                    onMouseLeave={e=>e.currentTarget.style.background='white'}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--navy)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, overflow:'hidden' }}>
                      {photo
                        ? <img src={photo} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                        : <span style={{ color:'white', fontSize:'0.65rem', fontWeight:700 }}>{firstNameInitial(p.ar_first_name || name)}</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight:600 }}>{name}</div>
                      <div style={{ fontSize:'0.72rem', color:'var(--gray-400)' }}>
                        {p.governorate || ''}
                      </div>
                    </div>
                    {isUnreg && (
                      <span style={{ fontSize:'0.65rem', background:'#fde68a', color:'#92400e', borderRadius:8, padding:'1px 6px', flexShrink:0 }}>
                        غير مسجّل
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Manual name */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>الاسم (يدوي)</label>
          <input value={baseName} onChange={e => {
            const newBase = e.target.value
            setBaseName(newBase)
            // Check if an unregistered person with this name already exists
            const norm = normalizeArabic(newBase.trim())
            const existing = norm ? (allUnregistered || []).find(u => {
              const uBase = [u.ar_first_name, u.ar_second_name, u.ar_third_name, u.ar_last_name].filter(Boolean).join(' ')
              return normalizeArabic(uBase.trim()) === norm
            }) : null
            if (existing) {
              onUpdate({
                unregistered: true, baseName: newBase,
                unregisteredId: existing.person_id,
                laqab: existing.title || laqab,
              })
            } else {
              onUpdate({ unregistered: !node.personId, baseName: newBase })
            }
          }} placeholder="أدخل الاسم يدوياً…"
            style={{ width:'100%', padding:'7px 10px', border:'1.5px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.85rem', direction:'rtl', textAlign:'right', color:'var(--gray-700)', boxSizing:'border-box' }}
          />
          {personType === 'مكرّس' && laqab.trim() && baseName.trim() && (
            <div style={{ marginTop:5, fontSize:'0.75rem', color:'var(--gray-400)', padding:'3px 6px' }}>
              سيُعرض كـ: <strong style={{ color:'var(--navy)' }}>{laqab.trim()} {baseName.trim()}</strong>
            </div>
          )}
        </div>

        {/* Role */}
        <RolePicker role={node.role || ''} onChange={role => {
          const shouldBeCouncil = isDefaultCouncilMember(role)
          const prevDefault = isDefaultCouncilMember(node.role || '')
          const currentIsDefault = node.inCouncil === prevDefault || node.inCouncil === undefined
          const shouldBeGroup = isDefaultGroupMember(role)
          const prevGroupDefault = isDefaultGroupMember(node.role || '')
          const groupIsDefault = node.inGroup === prevGroupDefault || node.inGroup === undefined
          onUpdate({
            role,
            inCouncil: currentIsDefault ? shouldBeCouncil : node.inCouncil,
            inGroup: groupIsDefault ? shouldBeGroup : node.inGroup,
          })
        }} />

        {/* مجلس الشبيبة checkbox */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', marginBottom: 8,
          background: node.inCouncil ? '#fffbeb' : 'var(--gray-50)',
          border: `1.5px solid ${node.inCouncil ? '#e8b55a' : 'var(--gray-200)'}`,
          borderRadius: 'var(--radius-md)', cursor: 'pointer',
          transition: 'all 0.15s',
        }} onClick={() => onUpdate({ inCouncil: !node.inCouncil })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontSize: '0.83rem', fontWeight: 700, color: node.inCouncil ? '#92400e' : 'var(--gray-600)' }}>
                عضو في مجلس الشبيبة
              </div>
              {node.inCouncil && (
                <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: 1 }}>سيظهر ضمن إطار المجلس</div>
              )}
            </div>
          </div>
          <div style={{
            width: 20, height: 20, borderRadius: 5, border: `2px solid ${node.inCouncil ? '#c9963c' : 'var(--gray-300)'}`,
            background: node.inCouncil ? '#c9963c' : 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
          }}>
            {node.inCouncil && <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 800 }}>✓</span>}
          </div>
        </div>

        {/* ضمن إطار الفئة/اللجنة checkbox — only shown when role belongs to a group */}
        {nodeGroupKeys(node).length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', marginBottom: 14,
            background: effectiveInGroup(node) ? '#eef4ff' : 'var(--gray-50)',
            border: `1.5px solid ${effectiveInGroup(node) ? '#93c5fd' : 'var(--gray-200)'}`,
            borderRadius: 'var(--radius-md)', cursor: 'pointer',
            transition: 'all 0.15s',
          }} onClick={() => onUpdate({ inGroup: !effectiveInGroup(node) })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1rem' }}>🫧</span>
              <div>
                <div style={{ fontSize: '0.83rem', fontWeight: 700, color: effectiveInGroup(node) ? '#1e40af' : 'var(--gray-600)' }}>
                  ضمن إطار الفئة / اللجنة
                </div>
                {effectiveInGroup(node) && (
                  <div style={{ fontSize: '0.7rem', color: '#1d4ed8', marginTop: 1 }}>
                    {nodeGroupKeys(node).map(groupKeyLabel).join(' · ')}
                  </div>
                )}
              </div>
            </div>
            <div style={{
              width: 20, height: 20, borderRadius: 5, border: `2px solid ${effectiveInGroup(node) ? '#3b82f6' : 'var(--gray-300)'}`,
              background: effectiveInGroup(node) ? '#3b82f6' : 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
            }}>
              {effectiveInGroup(node) && <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 800 }}>✓</span>}
            </div>
          </div>
        )}

        {/* Register unregistered person */}
        {node.unregistered && (
          <button onClick={() => onRegisterClick(node)} style={{
            width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            padding:'9px', marginBottom:12, borderRadius:'var(--radius-md)',
            background:'#fef3cd', border:'1.5px solid #e8b55a', color:'#92400e',
            fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:700, cursor:'pointer',
          }}>
            <UserPlus size={15}/> تسجيل هذا الشخص
          </button>
        )}

        {/* Delete */}
        <button onClick={onDelete} style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7,
          padding:'8px', marginBottom:10, borderRadius:'var(--radius-md)',
          background:'transparent', border:'1.5px solid rgba(192,57,43,0.25)', color:'var(--red)',
          fontFamily:'var(--font-body)', fontSize:'0.85rem', fontWeight:600, cursor:'pointer',
        }}>
          <Trash2 size={14}/> حذف العقدة
        </button>

        {/* Done */}
        <button onClick={onClose} style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:7,
          padding:'10px', borderRadius:'var(--radius-md)',
          background:'var(--navy)', border:'none', color:'white',
          fontFamily:'var(--font-body)', fontSize:'0.9rem', fontWeight:700, cursor:'pointer',
        }}>
          <CheckCircle size={16}/> تم
        </button>
      </div>
    </div>
  )
}

// ── OrgNode SVG component ─────────────────────────────────────────────────────
function OrgNode({ node, selected, connectMode, connectSource, onSelect, onDragStart, onAddChild, onToggleConnect, animating, viewOnly = false }) {
  const [photoErr, setPhotoErr] = useState(false)
  useEffect(() => { setPhotoErr(false) }, [node.photo])

  const isConnectSrc = connectSource === node.id
  const hasPhoto     = node.photo && !photoErr
  const initials     = firstNameInitial(node.baseName || node.name)
  const borderColor  = isConnectSrc ? '#c9963c' : selected ? '#0f2744' : node.unregistered ? '#e8b55a' : '#d1d9e6'

  const { w: W, h: H, roleLines } = nodeSize(node)
  const ACCENT_H   = 4
  const AV_R       = 18
  const AV_CX      = W / 2
  const AV_CY      = ACCENT_H + 8 + AV_R
  const NAME_Y     = AV_CY + AV_R + 13
  const ROLE_Y_START = NAME_Y + 16
  const LINE_H     = 14   // px between role lines
  const TEXT_PAD   = 8

  const displayName = nodeDisplayName(node) || 'بدون اسم'

  return (
    <g
      transform={`translate(${node.x - W / 2}, ${node.y - H / 2})`}
      style={{ cursor: 'move', userSelect: 'none',
        transition: animating ? 'transform 0.55s cubic-bezier(0.4,0,0.2,1)' : 'none' }}
      onMouseDown={e => { e.stopPropagation(); onDragStart(e, node.id) }}
      onClick={e => { e.stopPropagation(); if (connectMode) onToggleConnect(node.id); else onSelect(node.id) }}
    >
      {/* Shadow */}
      <rect x={2} y={4} width={W} height={H} rx={12} fill="rgba(15,39,68,0.08)" />
      {/* Card background */}
      <rect x={0} y={0} width={W} height={H} rx={12}
        fill={selected ? '#eef4ff' : node.unregistered ? '#fffbeb' : 'white'}
        stroke={borderColor} strokeWidth={selected || isConnectSrc ? 2.5 : 1.5}
        strokeDasharray={node.unregistered ? '5,3' : 'none'}
      />
      {/* Accent bar */}
      <rect x={0} y={0} width={W} height={ACCENT_H} rx={12} fill={node.unregistered ? '#e8b55a' : '#c9963c'} />
      <rect x={0} y={ACCENT_H / 2} width={W} height={ACCENT_H / 2} fill={node.unregistered ? '#e8b55a' : '#c9963c'} />

      {/* Avatar */}
      <clipPath id={`clip-${node.id}`}>
        <circle cx={AV_CX} cy={AV_CY} r={AV_R} />
      </clipPath>
      <circle cx={AV_CX} cy={AV_CY} r={AV_R} fill={node.unregistered ? '#fde68a' : '#0f2744'} />
      {hasPhoto ? (
        <image href={node.photo}
          x={AV_CX - AV_R} y={AV_CY - AV_R}
          width={AV_R * 2} height={AV_R * 2}
          clipPath={`url(#clip-${node.id})`}
          preserveAspectRatio="xMidYMid slice"
          onError={() => setPhotoErr(true)} />
      ) : (
        <text x={AV_CX} y={AV_CY} textAnchor="middle" dominantBaseline="middle"
          fill={node.unregistered ? '#92400e' : 'white'}
          fontSize={12} fontWeight="700" fontFamily="Tajawal">{initials}</text>
      )}

      {/* Unregistered badge */}
      {node.unregistered && (
        <>
          <circle cx={AV_CX + AV_R - 3} cy={AV_CY - AV_R + 3} r={6} fill="#ef4444" />
          <text x={AV_CX + AV_R - 3} y={AV_CY - AV_R + 3}
            textAnchor="middle" dominantBaseline="middle"
            fill="white" fontSize={7} fontWeight="800">!</text>
        </>
      )}

      {/* Name — full, no truncation */}
      <text x={W / 2} y={NAME_Y} textAnchor="middle" dominantBaseline="middle"
        fill="#1a2a3a" fontSize={12} fontWeight="700" fontFamily="Cairo"
      >{displayName}</text>

      {/* Role — wrapped lines */}
      {roleLines.map((line, i) => (
        <text key={i}
          x={W / 2} y={ROLE_Y_START + i * LINE_H}
          textAnchor="middle" dominantBaseline="middle"
          fill={node.unregistered ? '#b45309' : '#c9963c'}
          fontSize={10} fontFamily="Tajawal"
        >{line}</text>
      ))}

      {/* Add-child button */}
      {!connectMode && !viewOnly && (
        <g transform={`translate(${W / 2 - 10}, ${H - 1})`}
          onClick={e => { e.stopPropagation(); onAddChild(node.id) }}
          style={{ cursor: 'pointer' }}>
          <circle cx={10} cy={10} r={10} fill="#0f2744" opacity={0.85} />
          <text x={10} y={10} textAnchor="middle" dominantBaseline="middle"
            fill="white" fontSize={16} fontWeight="800">+</text>
        </g>
      )}
    </g>
  )
}

// ── Auto-wiring helpers ───────────────────────────────────────────────────────
// Classify a role string for auto-connect purposes
function classifyRole(role) {
  if (!role) return null
  if (role.startsWith(ACTING_PREFIX)) role = role.slice(ACTING_PREFIX.length)

  if (role === 'المسؤول العام')         return { tier: 'general_manager' }
  if (role === 'المرشد الروحي')         return { tier: 'spiritual_guide' }
  if (role === 'مساعد المرشد الروحي')   return { tier: 'spiritual_guide_assistant' }

  // مرشد روحي فئة X — peer-linked to matching مسؤول فئة
  if (/^مرشد روحي (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'spiritual_guide_agegroup' }

  // Direct reports to GM (hierarchy): deputy, secretary, treasurer
  if (role === 'نائب المسؤول العام')    return { tier: 'reports_to_gm' }
  if (role === 'مستشار الشبيبة')        return { tier: 'reports_to_gm' }
  if (role === 'أمين السر')             return { tier: 'reports_to_gm' }
  if (role === 'أمين الصندوق')          return { tier: 'reports_to_gm' }
  if (role === 'أمين العهدة')           return { tier: 'reports_to_gm' }

  // مساعد أمين X — reports to its secretary, NOT a default council member
  if (role === 'مساعد أمين السر' || role === 'مساعد أمين الصندوق' || role === 'مساعد أمين العهدة')
    return { tier: 'secretary_assistant', parentRole: role.slice('مساعد '.length) }

  // مسؤول [أي لجنة/فرقة — possibly composite] = committee HEAD → reports to GM
  if (role.startsWith('مسؤول ') && isCompositeCommittee(role.slice('مسؤول '.length)))
    return { tier: 'reports_to_gm', committeeHead: true }

  // عضو لجنة (bare committee name, possibly composite) → reports to its committee head
  if (isCompositeCommittee(role))
    return { tier: 'committee_member', committee: role }

  // مسؤول فئة → reports to GM (they are primary group leads)
  if (/^مسؤول (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'reports_to_gm', councilHead: true }

  // مجلس فئة → does NOT connect to GM; reports to مسؤول فئة if present, else standalone
  if (/^مجلس (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'council_head', councilHead: true }

  // مسؤول مساعد في فئة → reports to مسؤول فئة / مجلس فئة
  if (/^مسؤول مساعد في (فئة|فئتيّ|فئات)/.test(role))
    return { tier: 'council_assistant' }

  return null
}

// Returns true when the role should default to being in مجلس الشبيبة
function isDefaultCouncilMember(role) {
  if (!role) return false
  const c = classifyRole(role)
  if (!c) return false
  if (c.tier === 'general_manager')           return true
  if (c.tier === 'spiritual_guide')           return true
  if (c.tier === 'spiritual_guide_assistant') return true
  if (c.tier === 'spiritual_guide_agegroup')  return true
  if (c.tier === 'reports_to_gm')             return true  // نائب، أمين، مسؤول لجنة، مسؤول فئة
  if (c.tier === 'secretary_assistant')       return false  // مساعد أمين — not a default council member
  return false
}


// Returns true if a string is a known committee or a و-joined composite of known committees
function isCompositeCommittee(str) {
  if (!str) return false
  if (COMMITTEES.includes(str)) return true
  const parts = str.split(/ و /).map(s => s.trim())
  return parts.length > 1 && parts.every(p => COMMITTEES.includes(p))
}

function committeeHeadRoleFor(memberRole) {
  if (isCompositeCommittee(memberRole)) return `مسؤول ${memberRole}`
  return null
}

// Extract age groups mentioned in a role string
function extractGroups(role) {
  return extractAgeGroupsFromRole(role)
}

// Compute the full set of auto-edges from a snapshot of nodes.
// Auto-edges have { auto: true }.
function computeAutoEdges(nodes) {
  const autoEdges = []
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]))
  const push = (from, to, type) => {
    if (!from || !to || from === to) return
    // Never create a hierarchy edge involving a مرشد روحي فئة node
    if (type === 'hierarchy') {
      const ft = classifyRole(nodeById[from]?.role)?.tier
      const tt = classifyRole(nodeById[to]?.role)?.tier
      if (ft === 'spiritual_guide_agegroup' || tt === 'spiritual_guide_agegroup') return
    }
    autoEdges.push({ id: `auto_${from}_${to}_${type}`, from, to, type, auto: true })
  }

  // Strip قائم بأعمال prefix for matching purposes
  const baseRole = (role) => role?.startsWith(ACTING_PREFIX) ? role.slice(ACTING_PREFIX.length) : (role || '')

  const byRole  = (role) => nodes.filter(n => baseRole(n.role) === role)
  const byTier  = (tier) => nodes.filter(n => classifyRole(n.role)?.tier === tier)

  const gm  = byRole('المسؤول العام')[0]
  const sg  = byRole('المرشد الروحي')[0]
  const sga = byRole('مساعد المرشد الروحي')[0]

  // ── Spiritual guide chain ─────────────────────────────────────────────────
  if (gm && sg) push(gm.id, sg.id, 'peer')
  if (sg && sga) push(sg.id, sga.id, 'hierarchy')

  // ── GM direct reports ─────────────────────────────────────────────────────
  if (gm) {
    byTier('reports_to_gm').forEach(n => push(gm.id, n.id, 'hierarchy'))
  }

  // ── Secretary assistants → their parent secretary (or GM if secretary missing) ─
  byTier('secretary_assistant').forEach(assistant => {
    const c = classifyRole(assistant.role)
    if (!c?.parentRole) return
    const parent = nodes.find(n => baseRole(n.role) === c.parentRole)
    if (parent) {
      push(parent.id, assistant.id, 'hierarchy')
    } else if (gm) {
      // الأمين missing → report directly to GM
      push(gm.id, assistant.id, 'hierarchy')
    }
  })

  // ── Committee members → their committee head (or GM if head is missing) ───
  // A composite member (e.g. اللجنة الاجتماعيّة ولجنة الخدمة) connects to any head
  // whose committee set overlaps with the member's committee set.
  nodes.forEach(member => {
    const mc = classifyRole(member.role)
    if (!mc || mc.tier !== 'committee_member') return
    const memberBase = baseRole(member.role)
    const memberComs = memberBase.split(/ و /).map(s => s.trim()).filter(s => COMMITTEES.includes(s))
    if (!memberComs.length) return
    // Find all heads that cover any of the member's committees
    const matchingHeads = nodes.filter(n => {
      const nc = classifyRole(n.role)
      if (!nc || nc.tier !== 'reports_to_gm' || !nc.committeeHead) return false
      const headBase = baseRole(n.role)
      const headComs = headBase.slice('مسؤول '.length).split(/ و /).map(s => s.trim())
      return memberComs.some(c => headComs.includes(c))
    })
    if (matchingHeads.length > 0) {
      matchingHeads.forEach(head => push(head.id, member.id, 'hierarchy'))
    } else if (gm) {
      // مسؤول اللجنة missing → report directly to GM
      push(gm.id, member.id, 'hierarchy')
    }
  })

  // ── مسؤول مساعد / مجلس فئة → ALL مسؤول فئة with any group overlap ─────────
  const ageGroupHeads = nodes.filter(n => {
    const c = classifyRole(n.role)
    return (c?.tier === 'reports_to_gm' && c?.councilHead) || c?.tier === 'council_head'
  })

  const findAllOverlappingHeads = (role) => {
    const groups = extractGroups(role)
    return ageGroupHeads.filter(h =>
      ageGroupsOverlap(extractGroups(h.role), groups)
    )
  }

  // مجلس فئة → ALL مسؤول فئة with any overlapping groups (or GM if none exist)
  byTier('council_head').forEach(council => {
    const overlapping = findAllOverlappingHeads(council.role).filter(head => {
      return classifyRole(head.role)?.councilHead && classifyRole(head.role)?.tier === 'reports_to_gm'
    })
    if (overlapping.length > 0) {
      overlapping.forEach(head => push(head.id, council.id, 'hierarchy'))
    } else if (gm) {
      // مسؤول الفئة missing → report directly to GM
      push(gm.id, council.id, 'hierarchy')
    }
  })

  // مسؤول مساعد → reports to ALL مجلس فئة members (مسؤول فئة + عضو مجلس فئة) with any overlapping groups
  // If no head exists, report directly to GM
  byTier('council_assistant').forEach(assistant => {
    const heads = findAllOverlappingHeads(assistant.role)
    if (heads.length > 0) {
      heads.forEach(head => push(head.id, assistant.id, 'hierarchy'))
    } else if (gm) {
      push(gm.id, assistant.id, 'hierarchy')
    }
  })

  // ── مرشد روحي فئة ↔ مسؤول فئة with any overlapping groups (peer / horizontal) ──
  byTier('spiritual_guide_agegroup').forEach(sg => {
    const sgGroups = extractGroups(sg.role)
    // Find all مسؤول فئة nodes with any overlapping group
    nodes.filter(n => {
      const c = classifyRole(n.role)
      return c?.tier === 'reports_to_gm' && c?.councilHead
    }).forEach(head => {
      if (ageGroupsOverlap(extractGroups(head.role), sgGroups)) {
        push(sg.id, head.id, 'peer')
      }
    })
  })

  return autoEdges
}


// Strip any edges that violate role constraints.
// مرشد روحي فئة must never be connected via hierarchy — in either direction.
function sanitizeEdges(nodes, edges) {
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]))
  return edges.filter(e => {
    if (e.type !== 'hierarchy') return true
    const srcTier = classifyRole(nodeMap[e.from]?.role)?.tier
    const tgtTier = classifyRole(nodeMap[e.to]?.role)?.tier
    if (srcTier === 'spiritual_guide_agegroup' || tgtTier === 'spiritual_guide_agegroup') return false
    return true
  })
}
// Effective council membership — if not explicitly set, derive from role default
function effectiveInCouncil(node) {
  if (node.inCouncil !== undefined && node.inCouncil !== null) return node.inCouncil
  return isDefaultCouncilMember(node.role || '')
}

// Returns true when a node should default to being inside its group/committee hull
function isDefaultGroupMember(role) {
  if (!role) return false
  const c = classifyRole(role)
  if (!c) return false
  if (c.tier === 'reports_to_gm' && c.councilHead)   return true  // مسؤول فئة
  if (c.tier === 'council_head')                      return true  // مجلس فئة
  if (c.tier === 'spiritual_guide_agegroup')          return true  // مرشد روحي فئة
  if (c.tier === 'reports_to_gm' && c.committeeHead) return true  // مسؤول لجنة
  if (c.tier === 'committee_member')                  return true  // عضو لجنة
  return false
}

function effectiveInGroup(node) {
  if (node.inGroup !== undefined && node.inGroup !== null) return node.inGroup
  return isDefaultGroupMember(node.role || '')
}

// Returns the set of group keys this node belongs to.
// Age-group nodes emit ONE composite key (sorted by AGE_GROUPS order) so that
// nodes covering the same combination share a single bubble.
// e.g. مجلس فئتيّ الجامعيّة والعاملة → ["agegroup:الجامعيّة|العاملة"]
function nodeGroupKeys(node) {
  const role = node.role || ''
  const c = classifyRole(role)
  if (!c) return []

  // council_assistant (مسؤول مساعد) should NOT appear inside the مجلس الفئة bubble
  if (c.tier === 'council_assistant') return []

  if (!effectiveInGroup(node)) return []

  // Committee head — emit ONE key using the full compound name
  if (c.tier === 'reports_to_gm' && c.committeeHead) {
    const name = role.slice('مسؤول '.length)
    return [`committee:${name}`]
  }
  // Committee member — emit ONE key using the full compound name
  if (c.tier === 'committee_member') {
    return [`committee:${role}`]
  }
  // Age-group head, council member, or spiritual guide for age group → single composite key (sorted)
  if ((c.tier === 'reports_to_gm' && c.councilHead) || c.tier === 'council_head' || c.tier === 'spiritual_guide_agegroup') {
    const groups = sortAgeGroupsForLabel(extractGroups(role))
    if (groups.length) return [`agegroup:${groups.join('|')}`]
  }
  return []
}

// Palette for group hulls
const GROUP_PALETTE = [
  { fill: 'rgba(59,130,246,0.08)',  stroke: '#3b82f6', text: '#1d4ed8' },
  { fill: 'rgba(16,185,129,0.08)', stroke: '#10b981', text: '#065f46' },
  { fill: 'rgba(239,68,68,0.08)',  stroke: '#ef4444', text: '#991b1b' },
  { fill: 'rgba(139,92,246,0.08)', stroke: '#8b5cf6', text: '#5b21b6' },
  { fill: 'rgba(236,72,153,0.08)', stroke: '#ec4899', text: '#9d174d' },
  { fill: 'rgba(20,184,166,0.08)', stroke: '#14b8a6', text: '#134e4a' },
  { fill: 'rgba(245,158,11,0.08)', stroke: '#f59e0b', text: '#78350f' },
  { fill: 'rgba(99,102,241,0.08)', stroke: '#6366f1', text: '#3730a3' },
]

// Build Arabic label for a composite agegroup key like "agegroup:الجامعيّة|العاملة"
function agegroupKeyToLabel(key) {
  const groups = key.slice('agegroup:'.length).split('|')
  const n = groups.length
  const groupWord = n === 1 ? 'فئة' : n === 2 ? 'فئتيّ' : 'فئات'
  const groupList = n === 1 ? groups[0]
    : n === 2 ? `${groups[0]} و${groups[1]}`
    : groups.slice(0, -1).join(' و') + ' و' + groups[groups.length - 1]
  return `مجلس ${groupWord} ${groupList}`
}

function groupKeyLabel(key) {
  if (key.startsWith('committee:')) return key.slice('committee:'.length)
  if (key.startsWith('agegroup:'))  return agegroupKeyToLabel(key)
  return key
}

// Build a rounded convex hull SVG path from a set of [x,y] points
function buildHullPath(pts) {
  if (pts.length < 3) return null
  const cross = (O, A, B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0])
  const p = pts.slice().sort((a,b) => a[0]-b[0] || a[1]-b[1])
  const lower = [], upper = []
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], pt) <= 0) lower.pop()
    lower.push(pt)
  }
  for (let i = p.length-1; i >= 0; i--) {
    const pt = p[i]
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], pt) <= 0) upper.pop()
    upper.push(pt)
  }
  upper.pop(); lower.pop()
  const hull = lower.concat(upper)
  if (hull.length < 3) return null
  const R = 20
  const smooth = hull.map((pt, i) => {
    const prev = hull[(i - 1 + hull.length) % hull.length]
    const next = hull[(i + 1) % hull.length]
    const d1 = Math.hypot(pt[0]-prev[0], pt[1]-prev[1])
    const d2 = Math.hypot(pt[0]-next[0], pt[1]-next[1])
    const t1 = Math.min(R / (d1 || 1), 0.45)
    const t2 = Math.min(R / (d2 || 1), 0.45)
    return {
      in:  [pt[0] + (prev[0]-pt[0])*t1, pt[1] + (prev[1]-pt[1])*t1],
      pt,
      out: [pt[0] + (next[0]-pt[0])*t2, pt[1] + (next[1]-pt[1])*t2],
    }
  })
  const d = smooth.map((s, i) => {
    const cmd = i === 0 ? `M ${s.in[0]} ${s.in[1]}` : `L ${s.in[0]} ${s.in[1]}`
    return `${cmd} Q ${s.pt[0]} ${s.pt[1]} ${s.out[0]} ${s.out[1]}`
  }).join(' ') + ' Z'
  const top = hull.reduce((a, b) => b[1] < a[1] ? b : a)
  return { d, top }
}

export default function OrgTree({ toast, onRegisterPerson, onViewProfile, onViewUnregisteredProfile, viewOnly = false, allowedGroups = null }) {
  const [groups, setGroups]           = useState([])
  const [selectedGroup, setGroup]     = useState('')
  const [nodes, setNodes]             = useState([])
  const [edges, setEdges]             = useState([])
  const [selectedNode, setSelected]   = useState(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnSrc]   = useState(null)
  const [allPersons, setAllPersons]   = useState([])
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [dirty, setDirty]             = useState(false)
  const [groupSearch, setGSearch]     = useState('')
  const [animating, setAnimating]     = useState(false)

  // Period state
  const [periods, setPeriods]         = useState([])          // all periods for this group
  const [currentPeriod, setCurrentPeriod] = useState(null)   // the period we're viewing/editing
  const [showPeriodModal, setShowPeriodModal] = useState(false)  // period browser
  const [showSaveModal, setShowSaveModal]     = useState(false)  // unified save modal
  const [structuralDirty, setStructuralDirty] = useState(false) // true when nodes/edges changed (not just positions)

  const svgRef  = useRef(null)
  const [pan, setPan]   = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const panRef  = useRef(null)
  const dragRef = useRef(null)

  const [allUnregistered, setAllUnregistered] = useState([])
  const [defaultJecYear, setDefaultJecYear] = useState('')
  const groupLabelById = useMemo(() => {
    const out = {}
    for (const g of (groups || [])) {
      if (g?.value) out[g.value] = g.label || g.value
    }
    return out
  }, [groups])

  // ── Load groups + persons ──────────────────────────────────────────────────
  useEffect(() => {
    api.filters().then(f => {
      const ys = (f.youth_group || []).map(g => ({
        ...g,
        label: api.formatYouthGroupLabel(g?.label || g?.value),
      }))
      setGroups(ys)
    })
    api.personsEnriched().then(p => setAllPersons(p))
    api.getUnregistered().then(u => setAllUnregistered(u))
    api.getConfig()
      .then((cfg) => setDefaultJecYear(String(cfg?.config?.active_jec_year || '').trim()))
      .catch(() => setDefaultJecYear(''))
  }, [])

  // ── Load tree for selected group (always load active/latest period) ──────────
  useEffect(() => {
    if (!selectedGroup) return
    setLoading(true)
    setSuppressed(new Set())
    // No period_id → backend returns the active (open) period, or latest if all closed
    api.getOrgTree(selectedGroup)
      .then(data => {
        const _ln = data.nodes || []; setNodes(_ln)
        setEdges(sanitizeEdges(_ln, data.edges || []))
        setCurrentPeriod(data.period || null)
        setPeriods(data.periods || [])
        
        setDirty(false)
        setStructuralDirty(false)
      })
      .catch(() => { setNodes([]); setEdges([]); setCurrentPeriod(null); setPeriods([]); setDirty(false); setStructuralDirty(false) })
      .finally(() => setLoading(false))
  }, [selectedGroup])

  useEffect(() => {
    const onWindowFocus = () => {
      if (!selectedGroup || dirty) return
      const periodId = currentPeriod?.id
      api.getOrgTree(selectedGroup, periodId)
        .then(data => {
          const refreshedNodes = data.nodes || []
          setNodes(refreshedNodes)
          setEdges(sanitizeEdges(refreshedNodes, data.edges || []))
          setCurrentPeriod(data.period || currentPeriod)
          setPeriods(data.periods || periods)
        })
        .catch(() => {})
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [selectedGroup, currentPeriod, periods, dirty])

  // ── Load a specific period ─────────────────────────────────────────────────
  const loadPeriod = (period) => {
    setLoading(true)
    setSuppressed(new Set())
    api.getOrgTree(selectedGroup, period.id)
      .then(data => {
        const _ln2 = data.nodes || []; setNodes(_ln2)
        setEdges(sanitizeEdges(_ln2, data.edges || []))
        setCurrentPeriod(period)
        
        setDirty(false)
        setStructuralDirty(false)
      })
      .catch(() => { setNodes([]); setEdges([]) })
      .finally(() => setLoading(false))
  }

  // ── Save flow ──────────────────────────────────────────────────────────────
  const handleSaveClick = () => {
    if (!dirty) return
    setShowSaveModal(true)
  }

  // Called from UnifiedSaveModal — user chose "save to same period"
  const handleSaveToPeriod = () => {
    setShowSaveModal(false)
    doSave(currentPeriod)
  }

  // Called from UnifiedSaveModal — user chose "new active period" or "new period"
  const handleSaveWithPeriod = async (periodMeta, isBecomingActive) => {
    setShowSaveModal(false)
    setSaving(true)
    try {
      const linkedNodes = await syncUnregisteredNodes(nodes, selectedGroup)
      const hasActivePeriod = currentPeriod && !currentPeriod.to_date
      const res = await api.putOrgTree(selectedGroup, {
        nodes: linkedNodes,
        edges,
        period_id: hasActivePeriod ? currentPeriod?.id : undefined,
        new_period: periodMeta,
        close_current: hasActivePeriod,
      })
      const data = await api.getOrgTree(selectedGroup)
      setNodes(data.nodes || [])
      setEdges(sanitizeEdges(data.nodes || [], data.edges || []))
      setCurrentPeriod(data.period || res.period || currentPeriod)
      setPeriods(data.periods || res.periods || periods)
      setDirty(false)
      setStructuralDirty(false)
      toast('تم الحفظ ✓', 'success')
      applyTidy(data.nodes || linkedNodes, data.edges || edges)
    } catch (err) {
      if (err.message?.includes('409')) {
        toast('تتداخل الفترة مع فترة موجودة', 'error')
      } else {
        toast('خطأ في الحفظ', 'error')
      }
    }
    setSaving(false)
  }

  // ── Sync unregistered nodes to the unregistered persons store ────────────────
  // Brand-new unregistered nodes (no unregisteredId yet) get a new UUID profile.
  // If an unregistered person with the same normalized name already exists, we
  // link the node to that existing record instead of creating a duplicate.
  // The backend returns { created: { nodeId → uuid } } so we update the tree nodes.
  const syncUnregisteredNodes = useCallback(async (currentNodes, group) => {
    if (!group) return currentNodes

    // Pre-link: nodes whose baseName/name matches an existing unregistered person
    // but haven't been linked yet (unregisteredId is missing).
    const nodesNeedingLink = currentNodes.filter(
      n => n.unregistered && !n.personId && !n.unregisteredId && (n.name || n.baseName)
    )
    if (!nodesNeedingLink.length) return currentNodes

    // Re-fetch latest unregistered list (may have changed since page load)
    let latestUnreg = allUnregistered
    try { latestUnreg = await api.getUnregistered() } catch { /* use cached */ }

    // Separate: nodes we can auto-link by name vs. nodes that need a new record
    const autoLinked = {}   // nodeId → existing unregisteredId
    const newNodes   = []

    nodesNeedingLink.forEach(n => {
      const rawName = (n.baseName || n.name || '').trim()
      const norm = normalizeArabic(rawName)
      if (!norm) return
      const match = latestUnreg.find(u => {
        const uBase = [u.ar_first_name, u.ar_second_name, u.ar_third_name, u.ar_last_name].filter(Boolean).join(' ')
        return normalizeArabic(uBase.trim()) === norm
      })
      if (match) {
        autoLinked[n.id] = String(match.person_id)
      } else {
        newNodes.push(n)
      }
    })

    // Apply auto-links immediately without hitting sync endpoint
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
      // Refresh the unregistered list so newly created/linked people appear in search
      api.getUnregistered().then(u => setAllUnregistered(u)).catch(() => {})
    } catch { /* non-critical */ }
    setNodes(linkedNodes)
    return linkedNodes
  }, [allUnregistered])

  // Save directly into the given period (no period manipulation)
  const doSave = async (period) => {
    setSaving(true)
    try {
      const linkedNodes = await syncUnregisteredNodes(nodes, selectedGroup)
      const res = await api.putOrgTree(selectedGroup, { nodes: linkedNodes, edges, period_id: period?.id })
      setCurrentPeriod(res.period || period)
      setPeriods(res.periods || periods)
      setDirty(false)
      setStructuralDirty(false)
      toast('تم الحفظ ✓', 'success')
      applyTidy(linkedNodes, edges)
    } catch { toast('خطأ في الحفظ', 'error') }
    setSaving(false)
  }

  // ── Tidy layout ────────────────────────────────────────────────────────────
  const tidyLayout = useCallback((currentNodes, currentEdges) => {
    if (!currentNodes.length) return currentNodes
    const positions = computeTidyLayout(currentNodes, currentEdges)

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    currentNodes.forEach(n => {
      const { w, h } = nodeSize(n)
      const px = positions[n.id]?.x ?? n.x
      const py = positions[n.id]?.y ?? n.y
      minX = Math.min(minX, px - w / 2)
      maxX = Math.max(maxX, px + w / 2)
      minY = Math.min(minY, py - h / 2)
      maxY = Math.max(maxY, py + h / 2)
    })
    const treeW = maxX - minX
    const treeH = maxY - minY

    const svgEl = svgRef.current
    const vpW = svgEl ? svgEl.clientWidth  : 900
    const vpH = svgEl ? svgEl.clientHeight : 600

    const fitZoom = Math.min(
      (vpW - 80) / (treeW  || 1),
      (vpH - 80) / (treeH  || 1),
      1.5
    )
    const newZoom = Math.max(0.25, fitZoom)
    const newPan = {
      x: (vpW  - treeW  * newZoom) / 2 - minX * newZoom,
      y: (vpH  - treeH  * newZoom) / 2 - minY * newZoom,
    }

    const tidied = currentNodes.map(n => ({
      ...n,
      x: positions[n.id]?.x ?? n.x,
      y: positions[n.id]?.y ?? n.y,
    }))

    return { tidied, newZoom, newPan }
  }, [])

  const applyTidy = (currentNodes, currentEdges) => {
    if (!currentNodes.length) return
    const result = tidyLayout(currentNodes, currentEdges)
    if (!result) return
    const { tidied, newZoom, newPan } = result
    setAnimating(true)
    setNodes(tidied)
    setZoom(newZoom)
    setPan(newPan)
    setTimeout(() => setAnimating(false), 620)
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const markDirty = (structural = false) => {
    setDirty(true)
    if (structural) setStructuralDirty(true)
  }

  const [suppressedAutoEdges, setSuppressed] = useState(new Set())

  // ── Auto-wiring: recompute auto-edges whenever node roles change ───────────
  // Strategy: keep manual edges (auto !== true) intact, rebuild auto ones from scratch.
  const autoWireRef = useRef(false)
  useEffect(() => {
    // past periods are now editable
    // Derive new auto-edges
    const newAuto = computeAutoEdges(nodes)
    setEdges(prev => {
      // Keep all manual edges
      const manual = prev.filter(e => !e.auto)
      // Deduplicate against manual edges and suppressed pairs
      const manualPairs = new Set(manual.map(e => `${e.from}|${e.to}|${e.type}`))
      const filtered = newAuto.filter(ae => {
        const key = `${ae.from}|${ae.to}|${ae.type}`
        return !manualPairs.has(key) && !suppressedAutoEdges.has(key)
      })
      // Only trigger a state update if something actually changed
      const prevAutoIds = new Set(prev.filter(e => e.auto).map(e => e.id))
      const nextAutoIds = new Set(filtered.map(e => e.id))
      const same = prevAutoIds.size === nextAutoIds.size && [...nextAutoIds].every(id => prevAutoIds.has(id))
      if (same) return prev
      autoWireRef.current = true
      return [...manual, ...filtered]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, suppressedAutoEdges])

  // Mark dirty when auto-wiring changes edges (separate effect to avoid loop)
  useEffect(() => {
    if (autoWireRef.current) {
      autoWireRef.current = false
      setDirty(true)
      setStructuralDirty(true)
    }
  }, [edges])

  const updateNode = (id, changes) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, ...changes } : n))
    // Position-only changes (x/y) are cosmetic; anything else is structural
    const isPositionOnly = Object.keys(changes).every(k => k === 'x' || k === 'y')
    markDirty(!isPositionOnly)
  }

  const deleteNode = (id) => {
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.from !== id && e.to !== id))
    setSelected(null)
    markDirty(true)
  }

  const addNode = (parentId = null) => {
    const newId = uid()
    let x = 400, y = 200
    if (parentId) {
      const parent = nodes.find(n => n.id === parentId)
      if (parent) {
        const { w: pW, h: pH } = nodeSize(parent)
        const siblings = edges.filter(e => e.from === parentId && e.type === 'hierarchy').length
        x = parent.x + (siblings - 1) * (pW + H_GAP)
        y = parent.y + pH + V_GAP
      }
    }
    const newNode = { id: newId, x, y, name: '', role: '', personId: null, unregistered: true, photo: null }
    setNodes(ns => [...ns, newNode])
    if (parentId) setEdges(es => [...es, { id: uid(), from: parentId, to: newId, type: 'hierarchy' }])
    setSelected(newId)
    markDirty(true)
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  const toggleConnect = (nodeId) => {
    if (!connectSource) { setConnSrc(nodeId); return }
    if (connectSource === nodeId) { setConnSrc(null); return }
    const exists = edges.find(e =>
      (e.from === connectSource && e.to === nodeId) ||
      (e.from === nodeId && e.to === connectSource)
    )
    if (!exists) {
      setEdges(es => [...es, { id: uid(), from: connectSource, to: nodeId, type: connectMode }])
      markDirty(true)
    }
    setConnSrc(null)
  }

  const removeEdge = (edgeId) => {
    setEdges(es => {
      const edge = es.find(e => e.id === edgeId)
      if (edge?.auto) {
        // Suppress this auto-edge so it won't be re-created
        setSuppressed(prev => new Set([...prev, `${edge.from}|${edge.to}|${edge.type}`]))
      }
      return es.filter(e => e.id !== edgeId)
    })
    markDirty(true)
  }

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onNodeDragStart = useCallback((e, nodeId) => {
    if (connectMode) return
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    panRef.current = null
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y }
    e.preventDefault()
    e.stopPropagation()
  }, [nodes, connectMode])

  const onSvgMouseDown = (e) => {
    const tag = e.target.tagName.toLowerCase()
    if (tag === 'button' || tag === 'input') return
    if (e.button !== 0) return
    if (!dragRef.current) {
      panRef.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } }
    }
  }

  const onMouseMove = useCallback((e) => {
    if (dragRef.current) {
      const dx = (e.clientX - dragRef.current.startX) / zoom
      const dy = (e.clientY - dragRef.current.startY) / zoom
      setNodes(ns => ns.map(n =>
        n.id === dragRef.current.nodeId
          ? { ...n, x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }
          : n
      ))
    } else if (panRef.current) {
      setPan({
        x: panRef.current.origPan.x + (e.clientX - panRef.current.startX),
        y: panRef.current.origPan.y + (e.clientY - panRef.current.startY),
      })
    }
  }, [zoom])

  const onMouseUp = useCallback(() => {
    if (dragRef.current) { markDirty(false); dragRef.current = null }
    panRef.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [onMouseMove, onMouseUp])

  const canvasRef = useRef(null)

  // ── Wheel: scroll = pan, Ctrl+scroll = zoom towards cursor ────────────────
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        setZoom(z => {
          const delta = -e.deltaY * 0.001 * (e.deltaMode === 1 ? 20 : 1)
          const next = Math.min(2.5, Math.max(0.15, z + delta * z))
          setPan(p => ({
            x: mx - (mx - p.x) * (next / z),
            y: my - (my - p.y) * (next / z),
          }))
          return next
        })
      } else {
        const speed = e.deltaMode === 1 ? 20 : 1
        setPan(p => ({
          x: p.x - e.deltaX * speed,
          y: p.y - e.deltaY * speed,
        }))
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ── Touch gestures: pinch-to-zoom + pan ───────────────────────────────────
  const touchRef = useRef({ touches: [], lastDist: null, lastCenter: null })

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const getTouches = (e) => Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }))
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    const center = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

    const onTouchStart = (e) => {
      const ts = getTouches(e)
      touchRef.current.touches = ts
      if (ts.length === 2) {
        touchRef.current.lastDist = dist(ts[0], ts[1])
        touchRef.current.lastCenter = center(ts[0], ts[1])
      } else if (ts.length === 1) {
        touchRef.current.lastCenter = ts[0]
        touchRef.current.lastDist = null
      }
      dragRef.current = null  // cancel node drag on touch
    }

    const onTouchMove = (e) => {
      e.preventDefault()
      const ts = getTouches(e)
      const rect = el.getBoundingClientRect()

      if (ts.length === 2) {
        // Pinch-to-zoom
        const d = dist(ts[0], ts[1])
        const c = center(ts[0], ts[1])
        const prev = touchRef.current
        if (prev.lastDist && prev.lastCenter) {
          const scale = d / prev.lastDist
          const mx = c.x - rect.left
          const my = c.y - rect.top
          setZoom(z => {
            const next = Math.min(2.5, Math.max(0.15, z * scale))
            setPan(p => ({
              x: mx - (mx - p.x) * (next / z),
              y: my - (my - p.y) * (next / z),
            }))
            return next
          })
          // Two-finger pan
          setPan(p => ({
            x: p.x + (c.x - prev.lastCenter.x),
            y: p.y + (c.y - prev.lastCenter.y),
          }))
        }
        touchRef.current.lastDist = d
        touchRef.current.lastCenter = c
      } else if (ts.length === 1) {
        // One-finger pan
        const prev = touchRef.current.lastCenter
        if (prev) {
          setPan(p => ({
            x: p.x + (ts[0].x - prev.x),
            y: p.y + (ts[0].y - prev.y),
          }))
        }
        touchRef.current.lastCenter = ts[0]
      }
    }

    const onTouchEnd = (e) => {
      const ts = getTouches(e)
      touchRef.current.touches = ts
      if (ts.length < 2) touchRef.current.lastDist = null
      if (ts.length === 1) touchRef.current.lastCenter = ts[0]
      else if (ts.length === 0) touchRef.current.lastCenter = null

      // Double-tap to reset zoom
      const now = Date.now()
      if (ts.length === 0 && e.changedTouches.length === 1) {
        if (touchRef.current.lastTap && now - touchRef.current.lastTap < 300) {
          setZoom(1); setPan({ x: 0, y: 0 })
          touchRef.current.lastTap = null
          return
        }
        touchRef.current.lastTap = now
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])  // zoom/pan are read via setZoom(z => ...) callbacks so no deps needed

  const handleRegisterClick = (node) => { onRegisterPerson && onRegisterPerson(node.name) }

  // ── PDF Export ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)

  const exportToPdf = useCallback(async () => {
    if (!svgRef.current || !nodes.length) return
    setExporting(true)
    try {
      const svgEl = svgRef.current
      const svgClone = svgEl.cloneNode(true)

      // ── 1. Compute tight bounding box ──────────────────────────────────────
      const PAD = 50
      let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity
      nodes.forEach(n => {
        const { w, h } = nodeSize(n)
        bMinX = Math.min(bMinX, n.x - w / 2)
        bMaxX = Math.max(bMaxX, n.x + w / 2)
        bMinY = Math.min(bMinY, n.y - h / 2)
        bMaxY = Math.max(bMaxY, n.y + h / 2)
      })
      const treeW = bMaxX - bMinX + PAD * 2
      const treeH = bMaxY - bMinY + PAD * 2

      // ── 2. Prepare SVG clone ───────────────────────────────────────────────
      const gEl = svgClone.querySelector('g[transform]')
      if (gEl) gEl.setAttribute('transform', `translate(${-bMinX + PAD}, ${-bMinY + PAD})`)
      svgClone.setAttribute('width', String(treeW))
      svgClone.setAttribute('height', String(treeH))
      svgClone.setAttribute('viewBox', `0 0 ${treeW} ${treeH}`)
      const bgRect = svgClone.querySelector('rect[fill="url(#dots)"]')
      if (bgRect) bgRect.setAttribute('fill', 'white')
      // Embed fonts so they render in the canvas
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      styleEl.textContent = `@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&family=Cairo:wght@600;700;900&display=swap');`
      svgClone.insertBefore(styleEl, svgClone.firstChild)

      // ── 3. Render SVG → canvas ─────────────────────────────────────────────
      const SCALE = 2
      const serializer = new XMLSerializer()
      const svgStr = serializer.serializeToString(svgClone)
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(blob)

      const treeCanvas = document.createElement('canvas')
      treeCanvas.width  = treeW * SCALE
      treeCanvas.height = treeH * SCALE
      const treeCtx = treeCanvas.getContext('2d')
      treeCtx.scale(SCALE, SCALE)
      treeCtx.fillStyle = 'white'
      treeCtx.fillRect(0, 0, treeW, treeH)
      await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => { treeCtx.drawImage(img, 0, 0, treeW, treeH); resolve() }
        img.onerror = reject
        img.src = svgUrl
      })
      URL.revokeObjectURL(svgUrl)

      // ── 4. Build full-page canvas with Arabic header + footer ──────────────
      const HEADER_H = 44 * SCALE   // px at SCALE
      const FOOTER_H = 28 * SCALE
      const H_PAD    = 24 * SCALE   // horizontal margin for header/footer canvas
      const fullW    = treeCanvas.width
      const fullH    = treeCanvas.height + HEADER_H + FOOTER_H

      const full = document.createElement('canvas')
      full.width  = fullW
      full.height = fullH
      const ctx = full.getContext('2d')

      // White background
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, fullW, fullH)

      // Header background strip
      ctx.fillStyle = '#0f2744'
      ctx.fillRect(0, 0, fullW, HEADER_H)

      // Header text — drawn by browser, so Arabic works perfectly
      const groupLabel   = groupLabelById[selectedGroup] || selectedGroup || 'الهيكل التنظيمي'
      const periodLabel  = currentPeriod
        ? `  •  ${currentPeriod.from_date || ''}${currentPeriod.to_date ? ' ← ' + currentPeriod.to_date : ' ← الآن'}`
        : ''
      const headerText   = groupLabel + periodLabel
      ctx.fillStyle = 'white'
      ctx.font      = `bold ${18 * SCALE}px Cairo, Tajawal, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.direction = 'rtl'
      ctx.fillText(headerText, fullW / 2, HEADER_H / 2)

      // Draw the tree image below the header
      ctx.drawImage(treeCanvas, 0, HEADER_H)

      // Footer
      ctx.fillStyle = '#f8f9fc'
      ctx.fillRect(0, HEADER_H + treeCanvas.height, fullW, FOOTER_H)
      ctx.fillStyle = '#888'
      ctx.font = `${11 * SCALE}px Tajawal, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.direction = 'rtl'
      const dateStr = new Date().toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' })
      ctx.fillText(dateStr, fullW / 2, HEADER_H + treeCanvas.height + FOOTER_H / 2)

      // ── 5. Create PDF sized to match the canvas aspect ratio ───────────────
      // Use the tree's natural shape — fit into either A4-width or A4-height
      // but keep aspect ratio; page dimensions in mm match the canvas ratio
      const A4_LONG = 297   // mm
      const A4_SHORT = 210  // mm

      // Decide orientation: landscape if tree is wider than tall
      const isLandscape = fullW > fullH
      const [pageW_mm, pageH_mm] = isLandscape ? [A4_LONG, A4_SHORT] : [A4_SHORT, A4_LONG]

      // Scale the image to fill the page (no margins — tree already has PAD)
      const scaleToFit = Math.min(pageW_mm / (fullW / SCALE), pageH_mm / (fullH / SCALE))
      const imgW_mm = (fullW / SCALE) * scaleToFit
      const imgH_mm = (fullH / SCALE) * scaleToFit
      const offX_mm = (pageW_mm - imgW_mm) / 2
      const offY_mm = (pageH_mm - imgH_mm) / 2

      const loadJsPDF = () => new Promise((resolve, reject) => {
        if (window.jspdf?.jsPDF) { resolve(window.jspdf.jsPDF); return }
        const s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
        s.onload = () => resolve(window.jspdf.jsPDF)
        s.onerror = reject
        document.head.appendChild(s)
      })
      const jsPDF = await loadJsPDF()
      const doc = new jsPDF({
        orientation: isLandscape ? 'l' : 'p',
        unit: 'mm',
        format: [pageW_mm, pageH_mm],
      })

      doc.addImage(full.toDataURL('image/png'), 'PNG', offX_mm, offY_mm, imgW_mm, imgH_mm)
      doc.save(`org-tree-${(groupLabelById[selectedGroup] || selectedGroup || 'tree').replace(/\s+/g, '-')}.pdf`)

    } catch (err) {
      console.error('PDF export failed:', err)
    }
    setExporting(false)
  }, [nodes, selectedGroup, currentPeriod])

  const filteredGroups = groups.filter(g => {
    // If allowedGroups is set (member view), only show those groups
    if (allowedGroups !== null) {
      if (!allowedGroups.includes(g.value)) return false
    }
    const label = g.label || g.value
    return !groupSearch || normalizeArabic(label).includes(normalizeArabic(groupSearch))
  })

  // Auto-select if member has only one group
  useEffect(() => {
    if (allowedGroups && allowedGroups.length === 1 && !selectedGroup) {
      setGroup(allowedGroups[0])
    }
  }, [allowedGroups, selectedGroup])
  const selectedNodeData = nodes.find(n => n.id === selectedNode)

  // ── Group selector screen ──────────────────────────────────────────────────
  if (!selectedGroup) {
    return (
      <div>
        <div style={{ maxWidth: 540, margin: '60px auto 0', textAlign: 'center' }}>
          <div style={{ width:72, height:72, background:'var(--navy)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px' }}>
            <GitBranch size={32} color="var(--gold)" />
          </div>
          <h2 style={{ fontFamily:'var(--font-head)', color:'var(--navy)', fontSize:'1.6rem', marginBottom:8 }}>الهيكل التنظيمي</h2>
          <p style={{ color:'var(--gray-500)', marginBottom:32, fontSize:'0.95rem' }}>اختر فرقة الشبيبة لعرض هيكلها التنظيمي أو إنشائه</p>

          <div style={{ position:'relative', marginBottom:12 }}>
            <Search size={16} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)' }}/>
            <input value={groupSearch} onChange={e => setGSearch(e.target.value)} placeholder="ابحث عن فرقة…"
              style={{ width:'100%', padding:'10px 40px 10px 16px', border:'1.5px solid var(--gray-200)', borderRadius:'var(--radius-md)', fontFamily:'var(--font-body)', fontSize:'0.9rem', direction:'rtl', textAlign:'right' }}
            />
          </div>

          <div style={{ maxHeight:360, overflowY:'auto', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-lg)', background:'white', boxShadow:'var(--shadow-sm)' }}>
            {filteredGroups.length === 0 && <div style={{ padding:32, color:'var(--gray-400)', fontSize:'0.9rem' }}>لا توجد مجموعات</div>}
            {filteredGroups.map(g => (
              <div key={g.value} onClick={() => setGroup(g.value)}
                style={{ padding:'14px 20px', cursor:'pointer', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between', transition:'background 0.15s' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'}
                onMouseLeave={e=>e.currentTarget.style.background='white'}>
                <div>
                  <div style={{ fontWeight:700, color:'var(--navy)', fontSize:'0.95rem' }}>{g.label || g.value}</div>
                  <div style={{ fontSize:'0.78rem', color:'var(--gray-400)', marginTop:2 }}>{g.count} عضو</div>
                </div>
                <ArrowRight size={16} style={{ color:'var(--gray-300)', transform:'rotate(180deg)' }}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Tree editor ────────────────────────────────────────────────────────────
  return (
    <div style={{ height:'calc(100vh - 120px)', display:'flex', flexDirection:'column', position:'relative' }}>

      {/* Period browser modal */}
      {showPeriodModal && (
        <PeriodBrowserModal
          periods={periods}
          currentPeriod={currentPeriod}
          selectedGroup={selectedGroup}
          onSelect={loadPeriod}
          onPeriodsUpdated={() => {
            api.getOrgTree(selectedGroup).then(data => {
              setPeriods(data.periods || [])
              // If the currently viewed period was edited, refresh currentPeriod too
              if (data.period) setCurrentPeriod(data.period)
            })
          }}
          onClose={() => setShowPeriodModal(false)}
        />
      )}

      {/* Unified save modal */}
      {showSaveModal && (
        <UnifiedSaveModal
          currentPeriod={currentPeriod}
          periods={periods}
          defaultJecYear={defaultJecYear}
          onSaveToPeriod={handleSaveToPeriod}
          onConfirmNewPeriod={handleSaveWithPeriod}
          onCancel={() => setShowSaveModal(false)}
        />
      )}

      {/* Toolbar */}
      <div style={{ background:'white', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-lg)', padding:'10px 16px', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        {(!allowedGroups || allowedGroups.length > 1) && (
          <button onClick={() => { setGroup(''); setNodes([]); setEdges([]) }} className="btn btn-ghost btn-sm">
            <ArrowRight size={14}/> {groupLabelById[selectedGroup] || selectedGroup}
          </button>
        )}
        {(!allowedGroups || allowedGroups.length > 1) && <div style={{ width:1, height:24, background:'var(--gray-200)' }}/>}
        {allowedGroups && allowedGroups.length === 1 && (
          <span style={{ fontWeight:700, color:'var(--navy)', fontSize:'0.9rem' }}>{groupLabelById[selectedGroup] || selectedGroup}</span>
        )}

        {/* Period badge */}
        <PeriodBadge period={currentPeriod} periods={periods} onClick={() => setShowPeriodModal(true)} />

        {/* Past period indicator */}
        {!viewOnly && currentPeriod?.to_date && (
          <span style={{ fontSize:'0.78rem', color:'#b45309', background:'#fff8e1', padding:'3px 10px', borderRadius:20, fontWeight:700 }}>
            فترة منتهية — التعديلات ستُحفظ في نفس الفترة
          </span>
        )}

        {!viewOnly && <div style={{ width:1, height:24, background:'var(--gray-200)' }}/>}
        {!viewOnly && <button onClick={() => addNode(null)} className="btn btn-ghost btn-sm"><Plus size={14}/> إضافة عقدة</button>}

        {!viewOnly && (
          <div style={{ display:'flex', gap:4 }}>
            <button className={`btn btn-sm ${connectMode==='hierarchy' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setConnectMode(c => c==='hierarchy' ? false : 'hierarchy'); setConnSrc(null) }}>
              <Link size={13}/> ربط هرمي
            </button>
            <button className={`btn btn-sm ${connectMode==='peer' ? 'btn-gold' : 'btn-ghost'}`}
              onClick={() => { setConnectMode(c => c==='peer' ? false : 'peer'); setConnSrc(null) }}>
              <Link size={13}/> ربط أفقي
            </button>
            {connectMode && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setConnectMode(false); setConnSrc(null) }}>
                <Link2Off size={13}/> إلغاء
              </button>
            )}
          </div>
        )}

        {viewOnly && (
          <span style={{ fontSize:'0.78rem', color:'var(--gray-400)', background:'var(--gray-100)', padding:'3px 10px', borderRadius:20, fontWeight:600 }}>
            عرض فقط
          </span>
        )}

        <div style={{ flex:1 }}/>

        {!viewOnly && nodes.length > 0 && (
          <button
            onClick={() => applyTidy(nodes, edges)}
            className="btn btn-ghost btn-sm"
            title="ترتيب الهيكل تلقائياً"
            style={{ gap: 6, color: 'var(--navy-light)', borderColor: 'var(--navy-light)' }}
          >
            <Sparkles size={13}/> تنظيم تلقائي
          </button>
        )}

        {/* Zoom controls */}
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.82rem', color:'var(--gray-500)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.min(2.5, z+0.15))}>+</button>
          <span style={{ minWidth:40, textAlign:'center' }}>{Math.round(zoom*100)}%</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setZoom(z => Math.max(0.15, z-0.15))}>−</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setZoom(1); setPan({x:0,y:0}) }}>⌖</button>
        </div>

        {/* Export PDF */}
        {nodes.length > 0 && (
          <button onClick={exportToPdf} disabled={exporting} className="btn btn-ghost btn-sm"
            title="تصدير كملف PDF" style={{ gap:6, color:'var(--gray-600)' }}>
            <FileDown size={14}/> {exporting ? 'جارٍ التصدير…' : 'PDF'}
          </button>
        )}

        {/* Save — hidden for view-only */}
        {!viewOnly && (
          <button onClick={handleSaveClick} disabled={!dirty || saving} className={`btn btn-sm ${dirty ? (structuralDirty ? 'btn-gold' : 'btn-primary') : 'btn-ghost'}`}>
            <Save size={14}/> {saving ? 'جارٍ الحفظ…' : dirty ? (structuralDirty ? 'حفظ ✦' : 'حفظ *') : 'محفوظ'}
          </button>
        )}
      </div>

      {/* Connect hint */}
      {connectMode && !viewOnly && (
        <div style={{ background: connectMode==='hierarchy' ? 'var(--navy)' : 'var(--gold)', color:'white', padding:'8px 16px', borderRadius:'var(--radius-md)', marginBottom:8, fontSize:'0.85rem', fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
          <Link size={14}/>
          {connectSource
            ? `انقر على العقدة الثانية للربط ${connectMode==='peer' ? 'أفقياً' : 'هرمياً'}`
            : `انقر على العقدة الأولى للربط ${connectMode==='peer' ? 'الأفقي' : 'الهرمي'}`
          }
          — <span style={{ opacity:0.75 }}>انقر خارج العقد للإلغاء</span>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ flex:1, position:'relative', overflow:'hidden', borderRadius:'var(--radius-lg)', border:'1px solid var(--gray-200)', background:'#f8fafd', cursor: connectMode ? 'crosshair' : 'grab', touchAction: 'none' }}
        onMouseDown={onSvgMouseDown}
      >

        {selectedNode && selectedNodeData && !connectMode && !viewOnly && (
          <NodeEditor
            node={selectedNodeData}
            allNodes={nodes}
            allEdges={edges}
            allPersons={allPersons}
            allUnregistered={allUnregistered}
            selectedGroup={selectedGroup}
            onUpdate={(changes) => updateNode(selectedNode, changes)}
            onDelete={() => deleteNode(selectedNode)}
            onClose={() => setSelected(null)}
            onRegisterClick={handleRegisterClick}
            onViewProfile={(pid) => onViewProfile && onViewProfile(pid, { nodes, edges, currentNodeId: selectedNode, groupName: selectedGroup })}
            onViewUnregisteredProfile={(uid) => onViewUnregisteredProfile && onViewUnregisteredProfile(uid)}
          />
        )}

        {loading
          ? <div className="loading-center"><div className="spinner"/></div>
          : (
          <svg
            ref={svgRef}
            width="100%" height="100%"
            style={{ display:'block' }}
            onClick={e => { if (e.target===svgRef.current || e.target.tagName==='svg' || e.target.tagName==='rect') { setSelected(null); if (connectMode) setConnSrc(null) } }}
          >
            <defs>
              <pattern id="dots" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#d1d9e6" opacity="0.6"/>
              </pattern>
              <marker id="arrow-h" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="var(--navy)" opacity="0.5"/>
              </marker>
              <marker id="arrow-p" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="var(--gold)" opacity="0.7"/>
              </marker>
              <marker id="arrow-h-auto" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#4a7fb5" opacity="0.7"/>
              </marker>
              <marker id="arrow-p-auto" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#e8b55a" opacity="0.9"/>
              </marker>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)"/>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>

              {/* Edges */}
              {edges.map(edge => {
                const fn = nodes.find(n => n.id === edge.from)
                const tn = nodes.find(n => n.id === edge.to)
                if (!fn || !tn) return null
                const isPeer = edge.type === 'peer'
                const isAuto = !!edge.auto
                const d = edgePath(fn, tn, edge.type)
                // Auto-edges: brighter/distinct colour so users know they're managed
                const strokeColor = isAuto
                  ? (isPeer ? '#e8b55a' : '#4a7fb5')
                  : (isPeer ? 'var(--gold)' : 'var(--navy)')
                const strokeOpacity = isAuto ? 0.75 : (isPeer ? 0.55 : 0.4)
                const strokeWidth   = isAuto ? 2.5 : 2
                const dashArray     = isPeer ? '6,4' : 'none'
                const markerEnd     = isAuto
                  ? (isPeer ? 'url(#arrow-p-auto)' : 'url(#arrow-h-auto)')
                  : (isPeer ? 'url(#arrow-p)' : 'url(#arrow-h)')
                return (
                  <g key={edge.id}>
                    {/* Wide transparent hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: viewOnly ? 'default' : 'pointer' }}
                      onClick={viewOnly ? undefined : (e => { e.stopPropagation(); removeEdge(edge.id) })}>
                      {isAuto && !viewOnly && <title>ربط تلقائي — انقر لإلغائه</title>}
                    </path>
                    <path d={d} fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeOpacity={strokeOpacity}
                      strokeDasharray={dashArray}
                      markerEnd={markerEnd}
                      style={{ transition: animating ? 'all 0.55s cubic-bezier(0.4,0,0.2,1)' : 'none' }}
                    />
                    {/* Small ⚡ badge on auto-edges at midpoint */}
                    {isAuto && (() => {
                      const mx = (fn.x + tn.x) / 2
                      const my = (fn.y + tn.y) / 2
                      return (
                        <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                          fontSize={9} fill={isPeer ? '#c9963c' : '#2d5986'}
                          fontFamily="Tajawal" style={{ pointerEvents:'none', userSelect:'none' }}>
                          ⚡
                        </text>
                      )
                    })()}
                  </g>
                )
              })}

              {/* ── مجلس الشبيبة enclosure hull ── */}
              {(() => {
                const councilNodes = nodes.filter(n => effectiveInCouncil(n))
                if (councilNodes.length < 1) return null

                const PAD = 14

                const pts = []
                councilNodes.forEach(n => {
                  const { w, h } = nodeSize(n)
                  const W2 = w / 2, H2 = h / 2
                  pts.push([n.x - W2 - PAD, n.y - H2 - PAD])
                  pts.push([n.x + W2 + PAD, n.y - H2 - PAD])
                  pts.push([n.x - W2 - PAD, n.y + H2 + PAD])
                  pts.push([n.x + W2 + PAD, n.y + H2 + PAD])
                })

                const cross = (O, A, B) => (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0])
                const hull = (() => {
                  const p = pts.slice().sort((a,b) => a[0]-b[0] || a[1]-b[1])
                  if (p.length < 3) return p
                  const lower = [], upper = []
                  for (const pt of p) {
                    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], pt) <= 0) lower.pop()
                    lower.push(pt)
                  }
                  for (let i = p.length-1; i >= 0; i--) {
                    const pt = p[i]
                    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], pt) <= 0) upper.pop()
                    upper.push(pt)
                  }
                  upper.pop(); lower.pop()
                  return lower.concat(upper)
                })()

                if (hull.length < 2) return null

                const R = 24
                const smooth = hull.map((pt, i) => {
                  const prev = hull[(i - 1 + hull.length) % hull.length]
                  const next = hull[(i + 1) % hull.length]
                  const d1 = Math.hypot(pt[0]-prev[0], pt[1]-prev[1])
                  const d2 = Math.hypot(pt[0]-next[0], pt[1]-next[1])
                  const t1 = Math.min(R / (d1 || 1), 0.5)
                  const t2 = Math.min(R / (d2 || 1), 0.5)
                  return {
                    in:  [pt[0] + (prev[0]-pt[0])*t1, pt[1] + (prev[1]-pt[1])*t1],
                    pt,
                    out: [pt[0] + (next[0]-pt[0])*t2, pt[1] + (next[1]-pt[1])*t2],
                  }
                })

                const d = smooth.map((s, i) => {
                  const cmd = i === 0 ? `M ${s.in[0]} ${s.in[1]}` : `L ${s.in[0]} ${s.in[1]}`
                  return `${cmd} Q ${s.pt[0]} ${s.pt[1]} ${s.out[0]} ${s.out[1]}`
                }).join(' ') + ' Z'

                const top = hull.reduce((a, b) => b[1] < a[1] ? b : a)

                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <path d={d}
                      fill="rgba(201,150,60,0.06)"
                      stroke="#c9963c"
                      strokeWidth={2}
                      strokeDasharray="8,5"
                      strokeOpacity={0.55}
                    />
                    <g transform={`translate(${top[0]}, ${top[1] - 14})`}>
                      <rect x={-58} y={-13} width={116} height={22} rx={11}
                        fill="#c9963c" opacity={0.92}/>
                      <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
                        fill="white" fontSize={11} fontWeight="700" fontFamily="Cairo"
                        style={{ userSelect: 'none' }}>
                        مجلس الشبيبة
                      </text>
                    </g>
                  </g>
                )
              })()}

              {/* ── Per-group/committee hulls (above edges, below nodes) ── */}
              {(() => {
                // Step 1: collect raw keys per node
                const rawKeySet = new Map() // rawKey → Set<node>
                nodes.forEach(n => {
                  nodeGroupKeys(n).forEach(k => {
                    if (!rawKeySet.has(k)) rawKeySet.set(k, new Set())
                    rawKeySet.get(k).add(n)
                  })
                })

                // Step 2: for age-group keys, merge any that share at least one age group
                const agKeys = [...rawKeySet.keys()].filter(k => k.startsWith('agegroup:'))

                const parent = {}
                agKeys.forEach(k => { parent[k] = k })
                const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k] } return k }
                const union = (a, b) => { parent[find(a)] = find(b) }

                for (let i = 0; i < agKeys.length; i++) {
                  const gi = agKeys[i].slice('agegroup:'.length).split('|')
                  for (let j = i + 1; j < agKeys.length; j++) {
                    const gj = agKeys[j].slice('agegroup:'.length).split('|')
                    if (ageGroupsOverlap(gi, gj)) union(agKeys[i], agKeys[j])
                  }
                }

                // Step 3: build merged keySet
                const keySet = new Map()

                rawKeySet.forEach((nodeSet, k) => {
                  if (!k.startsWith('agegroup:')) {
                    if (!keySet.has(k)) keySet.set(k, [])
                    nodeSet.forEach(n => { if (!keySet.get(k).includes(n)) keySet.get(k).push(n) })
                  }
                })

                const componentGroups = {}
                const componentNodes  = {}
                agKeys.forEach(k => {
                  const root = find(k)
                  if (!componentGroups[root]) { componentGroups[root] = new Set(); componentNodes[root] = new Set() }
                  k.slice('agegroup:'.length).split('|').forEach(g => componentGroups[root].add(g))
                  rawKeySet.get(k).forEach(n => componentNodes[root].add(n))
                })

                Object.keys(componentGroups).forEach(root => {
                  const sortedGroups = sortAgeGroupsForLabel([...componentGroups[root]])
                  const mergedKey = `agegroup:${sortedGroups.join('|')}`
                  if (!keySet.has(mergedKey)) keySet.set(mergedKey, [])
                  componentNodes[root].forEach(n => { if (!keySet.get(mergedKey).includes(n)) keySet.get(mergedKey).push(n) })
                })

                const PAD = 10
                const sortedKeys = [...keySet.keys()].sort()

                const labelForKey = (key) => {
                  if (key.startsWith('committee:')) return key.slice('committee:'.length)
                  if (key.startsWith('agegroup:'))  return agegroupKeyToLabel(key)
                  return key
                }

                return sortedKeys.map((key, idx) => {
                  const members = keySet.get(key)
                  if (members.length < 1) return null
                  const color = GROUP_PALETTE[idx % GROUP_PALETTE.length]
                  const label = labelForKey(key)
                  const lw = Math.max(label.length * 7.5 + 20, 60)

                  const pts = []
                  members.forEach(n => {
                    const { w, h } = nodeSize(n)
                    const W2 = w / 2, H2 = h / 2
                    pts.push([n.x - W2 - PAD, n.y - H2 - PAD])
                    pts.push([n.x + W2 + PAD, n.y - H2 - PAD])
                    pts.push([n.x - W2 - PAD, n.y + H2 + PAD])
                    pts.push([n.x + W2 + PAD, n.y + H2 + PAD])
                  })

                  if (members.length === 1) {
                    const n = members[0]
                    const { w: nw, h: nh } = nodeSize(n)
                    const rx = n.x - nw / 2 - PAD, ry = n.y - nh / 2 - PAD
                    const rw = nw + PAD * 2, rh = nh + PAD * 2
                    return (
                      <g key={key} style={{ pointerEvents: 'none' }}>
                        <rect x={rx} y={ry} width={rw} height={rh} rx={14}
                          fill={color.fill} stroke={color.stroke}
                          strokeWidth={1.5} strokeDasharray="5,4" strokeOpacity={0.65}/>
                        <g transform={`translate(${n.x}, ${ry - 11})`}>
                          <rect x={-lw/2} y={-10} width={lw} height={20} rx={10}
                            fill={color.stroke} opacity={0.9}/>
                          <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
                            fill="white" fontSize={10} fontWeight="700" fontFamily="Cairo"
                            style={{ userSelect:'none' }}>{label}</text>
                        </g>
                      </g>
                    )
                  }

                  const hull = buildHullPath(pts)
                  if (!hull) return null

                  return (
                    <g key={key} style={{ pointerEvents: 'none' }}>
                      <path d={hull.d}
                        fill={color.fill}
                        stroke={color.stroke}
                        strokeWidth={1.5}
                        strokeDasharray="5,4"
                        strokeOpacity={0.65}
                      />
                      <g transform={`translate(${hull.top[0]}, ${hull.top[1] - 11})`}>
                        <rect x={-lw/2} y={-10} width={lw} height={20} rx={10}
                          fill={color.stroke} opacity={0.9}/>
                        <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
                          fill="white" fontSize={10} fontWeight="700" fontFamily="Cairo"
                          style={{ userSelect:'none' }}>{label}</text>
                      </g>
                    </g>
                  )
                })
              })()}

              {/* Nodes */}
              {nodes.map(node => (
                <OrgNode key={node.id} node={node}
                  selected={selectedNode === node.id}
                  connectMode={!!connectMode} connectSource={connectSource}
                  onSelect={setSelected} onDragStart={viewOnly ? () => {} : onNodeDragStart}
                  onAddChild={viewOnly ? () => {} : addNode}
                  onToggleConnect={viewOnly ? () => {} : toggleConnect}
                  animating={animating}
                  viewOnly={viewOnly}
                />
              ))}
            </g>
          </svg>
        )}

        {/* Empty state */}
        {!loading && nodes.length === 0 && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
            <GitBranch size={52} style={{ color:'var(--gray-300)', marginBottom:16 }}/>
            <p style={{ color:'var(--gray-400)', fontSize:'1rem', fontWeight:600 }}>لا يوجد هيكل تنظيمي بعد</p>
            <p style={{ color:'var(--gray-400)', fontSize:'0.85rem', marginTop:4 }}>اضغط "إضافة عقدة" لبدء البناء</p>
          </div>
        )}

      </div>
    </div>
  )
}
