import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType,
} from 'docx'

// A5 dimensions in DXA (twentieths of a point)
const A5_W  = 8391
const A5_H  = 11906
const MARGIN = 720  // ~12.7mm

function shortYg(label) {
  if (!label) return ''
  const dash = label.lastIndexOf(' - ')
  if (dash >= 0) return label.slice(dash + 3).trim()
  return label.replace(/^شبيبة\s+/, '').trim() || label
}

function rtlPara(text, { bold = false, size = 20, center = false, before = 0, after = 120, pageBreak = false } = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: center ? AlignmentType.CENTER : AlignmentType.RIGHT,
    pageBreakBefore: pageBreak,
    spacing: { before, after },
    children: [new TextRun({ text: String(text ?? ''), bold, size, font: 'Arial' })],
  })
}

function cell(text, { bold = false, width, center = false } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    children: [new Paragraph({
      bidirectional: true,
      alignment: center ? AlignmentType.CENTER : AlignmentType.RIGHT,
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text: String(text ?? ''), bold, size: 20, font: 'Arial' })],
    })],
  })
}

function hdrRow(cols) {
  return new TableRow({
    tableHeader: true,
    children: cols.map(c => cell(c.t, { bold: true, width: c.w, center: c.c })),
  })
}

function dataRow(cols) {
  return new TableRow({
    children: cols.map(c => cell(c.t, { width: c.w, center: c.c })),
  })
}

function makeTable(rows) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

function buildDoc(children) {
  return new Document({
    sections: [{
      properties: {
        page: {
          size: { width: A5_W, height: A5_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children,
    }],
  })
}

async function triggerDownload(doc, fileName) {
  const blob = await Packer.toBlob(doc)
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function downloadTeamsDocx(teams, members, supers, fileName = 'توزيع_الفرق.docx') {
  const children = []

  for (let ti = 0; ti < teams.length; ti++) {
    const team        = teams[ti]
    const teamMembers = members.filter(m => m.team_id === team.team_id)
    const teamSups    = supers.filter(s => s.team_id === team.team_id)

    // Team name heading (page break before each team except first)
    children.push(rtlPara(team.name, { bold: true, size: 32, center: true, after: 200, pageBreak: ti > 0 }))

    // Supervisors line
    if (teamSups.length > 0) {
      const names = teamSups.map(s => s.name).filter(Boolean).join(' و')
      children.push(rtlPara(`مسؤول(ين) الفرقة: ${names}`, { bold: true, size: 22, after: 200 }))
    }

    // Members table
    if (teamMembers.length > 0) {
      children.push(makeTable([
        hdrRow([
          { t: 'رقم',     w: 600,  c: true  },
          { t: 'الاسم',   w: 4200, c: false },
          { t: 'الشبيبة', w: 2400, c: false },
        ]),
        ...teamMembers.map((m, i) => dataRow([
          { t: i + 1,                        w: 600,  c: true  },
          { t: m.name || '—',                w: 4200, c: false },
          { t: shortYg(m.youth_group_label), w: 2400, c: false },
        ])),
      ]))
    } else {
      children.push(rtlPara('— لا يوجد أعضاء —', { center: true }))
    }
  }

  if (!children.length) {
    children.push(rtlPara('لا توجد فرق', { center: true }))
  }

  await triggerDownload(buildDoc(children), fileName)
}

// ── Bedrooms ──────────────────────────────────────────────────────────────────

export async function downloadBedroomsDocx(rooms_flat, assignments, registration, fileName = 'توزيع_المنامات.docx') {
  // Person lookup
  const people = {}
  for (const rt of ['members', 'supervisors', 'gs_committee', 'guests']) {
    for (const p of (registration?.[rt] || [])) {
      people[String(p.person_id)] = { ...p, reg_type: rt }
    }
  }

  // Room → assignments map
  const byRoom = {}
  for (const a of assignments) {
    if (!byRoom[a.room_id]) byRoom[a.room_id] = []
    byRoom[a.room_id].push(a)
  }

  const populated = rooms_flat.filter(r => (byRoom[r.room.id] || []).length > 0)
  const children  = []

  for (let ri = 0; ri < populated.length; ri++) {
    const re   = populated[ri]
    const room = re.room
    const asgns = byRoom[room.id] || []

    const supAsgns = asgns.filter(a => a.reg_type === 'supervisors')
    const memAsgns = asgns.filter(a => a.reg_type === 'members')
    const gsAsgns  = asgns.filter(a => a.reg_type === 'gs_committee')
    const gstAsgns = asgns.filter(a => a.reg_type === 'guests')

    // Room title
    children.push(rtlPara(
      `${re.building_name} › ${re.floor_name} › غرفة ${room.name}`,
      { bold: true, size: 26, center: true, after: 200, pageBreak: ri > 0 },
    ))

    if (memAsgns.length > 0 || supAsgns.length > 0) {
      // Regular room: members and/or supervisors
      if (supAsgns.length > 0) {
        const names = supAsgns.map(a => people[String(a.person_id)]?.name).filter(Boolean).join(' و')
        children.push(rtlPara(`مسؤول(ين) الغرفة: ${names}`, { bold: true, size: 22, after: 200 }))
      }

      const all = [...supAsgns, ...memAsgns]
      children.push(makeTable([
        hdrRow([
          { t: 'رقم',     w: 600,  c: true  },
          { t: 'الاسم',   w: 4200, c: false },
          { t: 'الشبيبة', w: 2400, c: false },
        ]),
        ...all.map((a, i) => {
          const p = people[String(a.person_id)] || {}
          return dataRow([
            { t: i + 1,                 w: 600,  c: true  },
            { t: p.name || '—',         w: 4200, c: false },
            { t: shortYg(p.youth_group_label), w: 2400, c: false },
          ])
        }),
      ]))

    } else if (gsAsgns.length > 0) {
      // GS/committee room: show hull name then table of names
      const hulls = [...new Set(
        gsAsgns.map(a => a.active_hull || people[String(a.person_id)]?.hulls?.[0]).filter(Boolean)
      )]
      if (hulls.length) {
        children.push(rtlPara(hulls.join(' / '), { bold: true, size: 24, after: 200 }))
      }
      children.push(makeTable([
        hdrRow([
          { t: 'رقم',   w: 600,  c: true  },
          { t: 'الاسم', w: 6600, c: false },
        ]),
        ...gsAsgns.map((a, i) => {
          const p = people[String(a.person_id)] || {}
          return dataRow([
            { t: i + 1,         w: 600,  c: true  },
            { t: p.name || '—', w: 6600, c: false },
          ])
        }),
      ]))

    } else if (gstAsgns.length > 0) {
      // Guests: just list names
      for (const a of gstAsgns) {
        const p = people[String(a.person_id)]
        if (p?.name) {
          children.push(rtlPara(p.name, { size: 22, after: 80 }))
        }
      }
    }
  }

  if (!children.length) {
    children.push(rtlPara('لا يوجد توزيع حالي', { center: true }))
  }

  await triggerDownload(buildDoc(children), fileName)
}
