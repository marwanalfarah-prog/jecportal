function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function withLineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br />')
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function renderLinkedText({ text, href = '', className = '', multiline = false }) {
  const safeText = multiline ? withLineBreaks(text || '—') : escapeHtml(text || '—')
  if (!href) return safeText
  return `<a class="pdf-link${className ? ` ${className}` : ''}" href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${safeText}</a>`
}

function renderFilledAtEntries(entries, fallbackText = '—') {
  const items = Array.isArray(entries) ? entries : []
  if (!items.length) return `<div class="pdf-meta-value">${escapeHtml(fallbackText)}</div>`

  return `
    <div class="pdf-timestamp-list">
      ${items.map((entry) => `
        <div class="pdf-timestamp-item">
          <div class="pdf-timestamp-topline">
            <span class="pdf-timestamp-group">${escapeHtml(entry?.label || '—')}</span>
          </div>
          <div class="pdf-timestamp-date">${escapeHtml(entry?.timestamp || '—')}</div>
        </div>
      `).join('')}
    </div>
  `
}

function renderYouthGroupLogos(logos) {
  const items = (Array.isArray(logos) ? logos : []).filter((item) => item?.dataUrl)
  if (!items.length) return ''

  return `
    <div class="pdf-youth-logos-list">
        ${items.map((item) => `
          <div class="pdf-youth-logo-wrap">
            <img class="pdf-youth-logo-image" src="${escapeAttribute(item.dataUrl)}" alt="${escapeAttribute(item.label || 'Youth Group Logo')}" />
          </div>
        `).join('')}
    </div>
  `
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return String(value)
  }
}

function groupOrgEntries(entries) {
  const groups = new Map()

  ;(Array.isArray(entries) ? entries : []).forEach((entry) => {
    const groupName = String(entry?.groupName || 'غير محدد')
    const jecYear = String(entry?.jecYear || '—')
    if (!groups.has(groupName)) groups.set(groupName, new Map())
    const byYear = groups.get(groupName)
    if (!byYear.has(jecYear)) byYear.set(jecYear, [])
    byYear.get(jecYear).push(entry)
  })

  return [...groups.entries()].map(([groupName, byYear]) => ({
    groupName,
    years: [...byYear.entries()]
      .sort(([a], [b]) => b.localeCompare(a, 'ar'))
      .map(([jecYear, yearEntries]) => ({
        jecYear,
        entries: yearEntries,
      })),
  }))
}

function renderFieldGrid(fields) {
  const items = (Array.isArray(fields) ? fields : []).filter((field) => {
    const value = String(field?.value ?? '').trim()
    return field?.showEmpty || value
  })

  if (!items.length) return ''

  return `
    <div class="pdf-field-grid">
      ${items.map((field) => `
        <div class="pdf-field-card${field?.dir === 'ltr' ? ' ltr' : ''}">
          <div class="pdf-field-label">${escapeHtml(field?.label || '')}</div>
          <div class="pdf-field-value">${renderLinkedText({ text: field?.value || '—', href: field?.href || '', multiline: field?.multiline, className: field?.dir === 'ltr' ? 'ltr' : '' })}</div>
        </div>
      `).join('')}
    </div>
  `
}

function renderChips(chips, emptyText = '') {
  const items = (Array.isArray(chips) ? chips : []).map((chip) => String(chip || '').trim()).filter(Boolean)
  if (!items.length) {
    return emptyText ? `<div class="pdf-empty">${escapeHtml(emptyText)}</div>` : ''
  }

  return `
    <div class="pdf-chip-list">
      ${items.map((chip) => `<span class="pdf-chip">${escapeHtml(chip)}</span>`).join('')}
    </div>
  `
}

function renderRecords(records, emptyText = 'لا توجد بيانات محفوظة') {
  const items = Array.isArray(records) ? records : []
  if (!items.length) return `<div class="pdf-empty">${escapeHtml(emptyText)}</div>`

  return `
    <div class="pdf-record-grid">
      ${items.map((record) => `
        <article class="pdf-record-card${record?.accent ? ` ${escapeHtml(record.accent)}` : ''}">
          <div class="pdf-record-header">
            <div class="pdf-record-heading">
              <div class="pdf-record-title${record?.titleDir === 'ltr' ? ' ltr' : ''}">${renderLinkedText({ text: record?.title || '—', href: record?.titleHref || '', className: record?.titleDir === 'ltr' ? 'ltr' : '' })}</div>
              ${record?.subtitle ? `<div class="pdf-record-subtitle${record?.subtitleDir === 'ltr' ? ' ltr' : ''}">${renderLinkedText({ text: record.subtitle, href: record?.subtitleHref || '', className: record?.subtitleDir === 'ltr' ? 'ltr' : '' })}</div>` : ''}
            </div>
            <div class="pdf-record-header-side">
              ${record?.badge ? `<span class="pdf-record-badge">${escapeHtml(record.badge)}</span>` : ''}
              ${record?.logoDataUrl ? `<span class="pdf-record-logo-wrap"><img class="pdf-record-logo" src="${escapeAttribute(record.logoDataUrl)}" alt="${escapeAttribute(record.logoAlt || record.title || 'Logo')}" /></span>` : ''}
            </div>
          </div>
          ${renderFieldGrid(record?.fields || [])}
          ${renderChips(record?.chips || [], record?.emptyChipsText || '')}
          ${record?.body ? `<div class="pdf-record-body">${withLineBreaks(record.body)}</div>` : ''}
        </article>
      `).join('')}
    </div>
  `
}

function renderOrgHistory(entries, emptyText) {
  const groups = groupOrgEntries(entries)
  if (!groups.length) return `<div class="pdf-empty">${escapeHtml(emptyText)}</div>`

  return groups.map(({ groupName, years }) => `
    <section class="pdf-org-group">
      <div class="pdf-org-group-title">${escapeHtml(groupName)}</div>
      ${years.map(({ jecYear, entries: yearEntries }) => `
        <div class="pdf-org-year-block">
          <div class="pdf-org-year-pill">سنة JEC ${escapeHtml(jecYear)}</div>
          <div class="pdf-org-entry-stack">
            ${yearEntries.map((entry) => {
              const relationGroups = [
                { label: 'يتبع إداريًا إلى', items: (entry?.smartConnections || []).filter((item) => item?.relType === 'parent') },
                { label: 'يُشرف إداريًا على', items: (entry?.smartConnections || []).filter((item) => item?.relType === 'child') },
                { label: 'ارتباطات أفقية', items: (entry?.smartConnections || []).filter((item) => item?.relType === 'peer') },
                ...((entry?.bubblesGrouped || []).map((group) => ({ label: `زملاء ${group?.label || 'المجموعة'}`, items: group?.members || [] }))),
              ].filter((group) => Array.isArray(group.items) && group.items.length)

              return `
                <div class="pdf-org-entry-block">
                  <article class="pdf-org-entry-card pdf-org-entry-summary">
                    <div class="pdf-org-entry-header">
                      <div class="pdf-org-role">${escapeHtml(entry?.role || 'بدون دور محدد')}</div>
                      <div class="pdf-org-period">${escapeHtml(formatDate(entry?.entryStart))} - ${escapeHtml(entry?.isActive ? 'الآن' : formatDate(entry?.entryEnd))}</div>
                    </div>
                    ${entry?.bubblesGrouped?.length ? `
                      <div class="pdf-chip-list">
                        ${entry.bubblesGrouped.map((group) => `<span class="pdf-chip pdf-chip-soft">${escapeHtml(group?.label || '')}</span>`).join('')}
                      </div>
                    ` : ''}
                  </article>
                  ${relationGroups.length ? relationGroups.map((group) => `
                    <article class="pdf-org-entry-card pdf-org-relation-card">
                      <div class="pdf-org-relation-title">${escapeHtml(group.label)}</div>
                      <div class="pdf-org-relation-list">
                        ${group.items.map((item) => `
                          <div class="pdf-org-person-row">
                            <div class="pdf-org-person-main">
                              <span class="pdf-org-person-name">${escapeHtml(item?.node?.name || 'بدون اسم')}</span>
                              ${item?.node?.unregistered ? '<span class="pdf-org-tag">غير مسجّل</span>' : ''}
                            </div>
                            <div class="pdf-org-person-role">${escapeHtml(item?.node?.role || '—')}</div>
                            ${item?.needsAnnotation ? `<div class="pdf-org-person-dates">${escapeHtml(formatDate(item?.connStart))} - ${escapeHtml(item?.connEnd ? formatDate(item.connEnd) : 'الآن')}</div>` : ''}
                          </div>
                        `).join('')}
                      </div>
                    </article>
                  `).join('') : `<div class="pdf-empty compact">لا توجد علاقات هرمية محددة في هذه الفترة</div>`}
                </div>
              `
            }).join('')}
          </div>
        </div>
      `).join('')}
    </section>
  `).join('')
}

function buildHtml(report, photoDataUrl, youthGroupLogos) {
  const summaryBadges = (Array.isArray(report?.summaryBadges) ? report.summaryBadges : []).map((item) => String(item || '').trim()).filter(Boolean)
  const sections = Array.isArray(report?.sections) ? report.sections : []

  return `
    <div class="pdf-page-root">
      <style>
        .pdf-page-root {
          direction: rtl;
          color: #1f2937;
          background: linear-gradient(180deg, #f7f1e6 0%, #f8fafc 24%, #ffffff 100%);
          font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
          width: 210mm;
          min-height: 297mm;
          box-sizing: border-box;
        }
        .pdf-shell {
          padding: 16mm 14mm 14mm;
        }
        .pdf-hero {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          padding: 18mm 14mm;
          background: linear-gradient(135deg, #0f2744 0%, #17385f 56%, #c89c46 140%);
          color: #ffffff;
          box-shadow: 0 20px 48px rgba(15, 39, 68, 0.16);
          margin-bottom: 10mm;
        }
        .pdf-hero:before,
        .pdf-hero:after {
          content: '';
          position: absolute;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
        }
        .pdf-hero:before {
          width: 150mm;
          height: 150mm;
          top: -90mm;
          left: -35mm;
        }
        .pdf-hero:after {
          width: 85mm;
          height: 85mm;
          bottom: -42mm;
          right: -10mm;
        }
        .pdf-hero-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: 1fr 34mm;
          gap: 10mm;
          align-items: center;
        }
        .pdf-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.18);
          font-size: 11px;
          font-weight: 700;
          margin-bottom: 10px;
        }
        .pdf-name {
          font-size: 25px;
          line-height: 1.35;
          font-weight: 800;
          margin-bottom: 5px;
        }
        .pdf-name-secondary {
          font-size: 14px;
          line-height: 1.5;
          opacity: 0.88;
          direction: ltr;
          text-align: left;
        }
        .pdf-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .pdf-youth-logos-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: center;
          width: 34mm;
        }
        .pdf-youth-logo-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
            padding: 3px 4px;
            border-radius: 12px;
            background: rgba(255,255,255,0.95);
            box-shadow: 0 0 0 1px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.12);
        }
        .pdf-youth-logo-image {
          display: block;
          width: auto;
          max-width: 21mm;
          height: auto;
          max-height: 16mm;
          object-fit: contain;
        }
        .pdf-hero-side {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .pdf-summary-badge {
          display: inline-flex;
          align-items: center;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.15);
          font-size: 10.5px;
        }
        .pdf-avatar,
        .pdf-avatar-fallback {
          width: 34mm;
          height: 34mm;
          border-radius: 18px;
          background: rgba(255,255,255,0.12);
          border: 1.5px solid rgba(255,255,255,0.24);
          box-shadow: 0 16px 32px rgba(9, 17, 31, 0.22);
        }
        .pdf-avatar {
          object-fit: cover;
        }
        .pdf-avatar-fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 800;
        }
        .pdf-meta-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 10mm;
        }
        .pdf-meta-card {
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(15,39,68,0.08);
          border-radius: 18px;
          padding: 12px 14px;
          box-shadow: 0 10px 24px rgba(15,39,68,0.06);
        }
        .pdf-meta-label {
          color: #64748b;
          font-size: 10px;
          font-weight: 700;
          margin-bottom: 4px;
        }
        .pdf-meta-value {
          color: #0f2744;
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.5;
          word-break: break-word;
          white-space: pre-wrap;
        }
        .pdf-timestamp-list {
          display: grid;
          gap: 8px;
          margin-top: 4px;
        }
        .pdf-timestamp-item {
          padding: 8px 10px;
          border-radius: 12px;
          background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
          border: 1px solid #e2e8f0;
        }
        .pdf-timestamp-topline {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 3px;
        }
        .pdf-timestamp-group {
          color: #0f2744;
          font-size: 11.5px;
          font-weight: 800;
          line-height: 1.5;
        }
        .pdf-timestamp-date {
          color: #475569;
          font-size: 10px;
          font-weight: 600;
          line-height: 1.6;
        }
        .pdf-link {
          color: #0b4d9c;
          text-decoration: underline;
          text-underline-offset: 2px;
          word-break: break-all;
        }
        .pdf-link.ltr {
          direction: ltr;
          unicode-bidi: plaintext;
        }
        .pdf-section {
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(15,39,68,0.08);
          border-radius: 22px;
          padding: 16px;
          box-shadow: 0 14px 32px rgba(15,39,68,0.07);
          margin-bottom: 10mm;
          page-break-inside: avoid;
        }
        .pdf-section-flow {
          page-break-inside: auto;
        }
        .pdf-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 12px;
        }
        .pdf-section-title {
          color: #0f2744;
          font-size: 17px;
          font-weight: 800;
        }
        .pdf-section-note {
          margin-bottom: 12px;
          padding: 10px 12px;
          border-radius: 14px;
          background: #fff8ea;
          border: 1px solid #f1d7a1;
          color: #8a5b12;
          font-size: 11px;
          line-height: 1.7;
        }
        .pdf-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }
        .pdf-field-card {
          border-radius: 14px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          padding: 10px 12px;
        }
        .pdf-field-card.ltr {
          direction: ltr;
          text-align: left;
        }
        .pdf-field-label {
          color: #64748b;
          font-size: 10px;
          font-weight: 700;
          margin-bottom: 5px;
        }
        .pdf-field-value {
          color: #0f172a;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.7;
          word-break: break-word;
          white-space: pre-wrap;
        }
        .pdf-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 10px;
        }
        .pdf-chip {
          display: inline-flex;
          align-items: center;
          padding: 5px 10px;
          border-radius: 999px;
          background: #eef4ff;
          border: 1px solid #d9e5ff;
          color: #17407a;
          font-size: 10.5px;
          font-weight: 600;
        }
        .pdf-chip-soft {
          background: #faf5ff;
          border-color: #eadcff;
          color: #6d28d9;
        }
        .pdf-record-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .pdf-record-card {
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
          padding: 12px;
          page-break-inside: avoid;
        }
        .pdf-record-card.gold {
          border-color: rgba(200,156,70,0.35);
          background: linear-gradient(180deg, #fffdf8 0%, #faf7ef 100%);
        }
        .pdf-record-header {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
        }
        .pdf-record-heading {
          min-width: 0;
          flex: 1 1 auto;
        }
        .pdf-record-header-side {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .pdf-record-title {
          color: #0f2744;
          font-size: 12.5px;
          font-weight: 800;
          line-height: 1.6;
          word-break: break-word;
        }
        .pdf-record-title.ltr,
        .pdf-record-subtitle.ltr {
          direction: ltr;
          text-align: left;
        }
        .pdf-record-subtitle {
          color: #64748b;
          font-size: 10.5px;
          margin-top: 3px;
          line-height: 1.6;
          word-break: break-word;
        }
        .pdf-record-badge {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          border-radius: 999px;
          background: #0f2744;
          color: #ffffff;
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 700;
        }
        .pdf-record-logo-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 17mm;
          height: 17mm;
          padding: 2.2mm;
          border-radius: 12px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          box-shadow: 0 6px 16px rgba(15, 39, 68, 0.08);
        }
        .pdf-record-logo {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .pdf-record-body {
          margin-top: 10px;
          padding: 10px 12px;
          border-radius: 14px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          font-size: 11px;
          line-height: 1.8;
          color: #334155;
        }
        .pdf-empty {
          padding: 14px;
          border-radius: 14px;
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          color: #64748b;
          font-size: 11px;
          text-align: center;
        }
        .pdf-empty.compact {
          margin-top: 8px;
          padding: 10px;
        }
        .pdf-org-group + .pdf-org-group {
          margin-top: 14px;
        }
        .pdf-org-group-title {
          color: #0f2744;
          font-size: 14px;
          font-weight: 800;
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 2px solid rgba(15,39,68,0.12);
        }
        .pdf-org-year-block + .pdf-org-year-block {
          margin-top: 12px;
        }
        .pdf-org-year-pill {
          display: inline-flex;
          align-items: center;
          padding: 4px 12px;
          border-radius: 999px;
          background: #0f2744;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .pdf-org-entry-stack {
          display: grid;
          gap: 10px;
        }
        .pdf-org-entry-block {
          display: grid;
          gap: 8px;
          page-break-inside: auto;
          break-inside: auto;
        }
        .pdf-org-entry-card {
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 12px;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .pdf-org-entry-summary {
          border-right: 4px solid #c89c46;
        }
        .pdf-org-relation-card {
          margin-right: 8px;
        }
        .pdf-org-entry-header {
          display: flex;
          align-items: start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
        }
        .pdf-org-role {
          color: #0f2744;
          font-size: 12px;
          font-weight: 800;
        }
        .pdf-org-period {
          color: #2f6d39;
          background: #edf9ef;
          border: 1px solid #c7e8cf;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 9.5px;
          font-weight: 700;
          white-space: nowrap;
        }
        .pdf-org-relation-title {
          color: #475569;
          font-size: 10.5px;
          font-weight: 800;
          margin-bottom: 6px;
        }
        .pdf-org-relation-list {
          display: grid;
          gap: 6px;
        }
        .pdf-org-person-row {
          padding: 8px 10px;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .pdf-org-person-main {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 2px;
        }
        .pdf-org-person-name {
          color: #0f172a;
          font-size: 11px;
          font-weight: 700;
        }
        .pdf-org-tag {
          color: #92400e;
          background: #fff7ed;
          border: 1px solid #fdba74;
          border-radius: 999px;
          padding: 2px 7px;
          font-size: 9px;
          font-weight: 700;
        }
        .pdf-org-person-role,
        .pdf-org-person-dates {
          color: #64748b;
          font-size: 9.5px;
          line-height: 1.5;
        }
      </style>

      <div class="pdf-shell">
        <header class="pdf-hero">
          <div class="pdf-hero-grid">
            <div>
              <div class="pdf-eyebrow">ملف شخصي مصدَّر بصيغة PDF</div>
              <div class="pdf-name">${escapeHtml(report?.arabicDisplayName || 'بلا اسم')}</div>
              ${report?.englishDisplayName ? `<div class="pdf-name-secondary">${escapeHtml(report.englishDisplayName)}</div>` : ''}
              ${summaryBadges.length ? `
                <div class="pdf-summary">
                  ${summaryBadges.map((item) => `<span class="pdf-summary-badge">${escapeHtml(item)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
            <div class="pdf-hero-side">
              ${photoDataUrl
                ? `<img class="pdf-avatar" src="${photoDataUrl}" alt="Profile" />`
                : `<div class="pdf-avatar-fallback">${escapeHtml(report?.initials || '؟')}</div>`}
              ${renderYouthGroupLogos(youthGroupLogos)}
            </div>
          </div>
        </header>

        <section class="pdf-meta-strip">
          <div class="pdf-meta-card">
            <div class="pdf-meta-label">نوع السجل</div>
            <div class="pdf-meta-value">${escapeHtml(report?.personTypeLabel || '—')}</div>
          </div>
          <div class="pdf-meta-card">
            <div class="pdf-meta-label">تواريخ تعبئة البيانات</div>
            ${renderFilledAtEntries(report?.filledAtEntries, report?.filledAtLabel || '—')}
          </div>
          <div class="pdf-meta-card">
            <div class="pdf-meta-label">وقت التنزيل</div>
            <div class="pdf-meta-value">${escapeHtml(report?.downloadedAtLabel || '—')}</div>
          </div>
        </section>

        ${sections.map((section) => `
          <section class="pdf-section${section?.type === 'org-history' ? ' pdf-section-flow' : ''}">
            <div class="pdf-section-header">
              <div class="pdf-section-title">${escapeHtml(section?.title || '')}</div>
            </div>
            ${section?.note ? `<div class="pdf-section-note">${escapeHtml(section.note)}</div>` : ''}
            ${renderFieldGrid(section?.fields || [])}
            ${section?.records ? renderRecords(section.records, section.emptyText) : ''}
            ${section?.chips ? renderChips(section.chips, section.emptyText) : ''}
            ${section?.type === 'org-history' ? renderOrgHistory(section.entries, section.emptyText || 'لا توجد بيانات') : ''}
          </section>
        `).join('')}
      </div>
    </div>
  `
}

async function loadImageAsDataUrl(url) {
  if (!url) return ''

  try {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return ''
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

async function loadImagesAsDataUrls(items) {
  const normalized = Array.isArray(items) ? items : []
  const resolved = await Promise.all(normalized.map(async (item) => ({
    ...item,
    dataUrl: await loadImageAsDataUrl(item?.url),
  })))

  return resolved.filter((item) => item?.dataUrl)
}

async function embedRecordLogos(report) {
  const sections = Array.isArray(report?.sections) ? report.sections : []
  const hydratedSections = await Promise.all(sections.map(async (section) => {
    const records = Array.isArray(section?.records) ? section.records : []
    const hydratedRecords = await Promise.all(records.map(async (record) => {
      const logoUrl = String(record?.logoUrl || '').trim()
      if (!logoUrl) return record
      return {
        ...record,
        logoDataUrl: await loadImageAsDataUrl(logoUrl),
      }
    }))
    return {
      ...section,
      records: hydratedRecords,
    }
  }))

  return {
    ...report,
    sections: hydratedSections,
  }
}

export async function downloadProfilePdf(report) {
  const { default: html2pdf } = await import('html2pdf.js')
  const [hydratedReport, photoDataUrl, youthGroupLogos] = await Promise.all([
    embedRecordLogos(report),
    loadImageAsDataUrl(report?.photoUrl),
    loadImagesAsDataUrls(report?.youthGroupLogos),
  ])
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-100000px'
  container.style.top = '0'
  container.style.zIndex = '-1'
  container.innerHTML = buildHtml(hydratedReport, photoDataUrl, youthGroupLogos)
  document.body.appendChild(container)

  try {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
    await html2pdf()
      .set({
        margin: 0,
        filename: report?.fileName || 'profile-export.pdf',
        enableLinks: true,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 3,
          useCORS: true,
          backgroundColor: '#f8fafc',
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.pdf-record-card', '.pdf-org-entry-card', '.pdf-org-person-row'] },
      })
      .from(container.firstElementChild)
      .save()
  } finally {
    container.remove()
  }
}