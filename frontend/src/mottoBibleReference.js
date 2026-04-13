function renderVerseSegment(segment) {
  const start = segment?.start || {}
  const end = segment?.end || {}
  const startChapter = Number(start?.chapter)
  const startVerse = Number(start?.verse)
  const endChapter = Number(end?.chapter)
  const endVerse = Number(end?.verse)

  if (!startChapter || !startVerse || !endChapter || !endVerse) return ''
  if (startChapter === endChapter && startVerse === endVerse) return `${startChapter}: ${startVerse}`
  if (startChapter === endChapter) return `${startChapter}: ${startVerse}-${endVerse}`
  return `${startChapter}: ${startVerse}-${endChapter}: ${endVerse}`
}

function collectRefsFromSegments(segments) {
  const refs = []

  for (const segment of Array.isArray(segments) ? segments : []) {
    const start = segment?.start || {}
    const end = segment?.end || {}
    const startChapter = Number(start?.chapter)
    const startVerse = Number(start?.verse)
    const endChapter = Number(end?.chapter)
    const endVerse = Number(end?.verse)

    if (!startChapter || !startVerse || !endChapter || !endVerse) continue
    if (endChapter < startChapter) continue
    if (endChapter === startChapter && endVerse < startVerse) continue

    if (startChapter !== endChapter) return []

    for (let verse = startVerse; verse <= endVerse; verse += 1) {
      refs.push({ chapter: startChapter, verse })
    }
  }

  return refs
}

function buildReferenceExpression(verse) {
  const raw = String(verse?.raw || '').trim()
  if (raw) return raw

  return (Array.isArray(verse?.segments) ? verse.segments : [])
    .map(renderVerseSegment)
    .filter(Boolean)
    .join(', ')
}

function parseReferenceExpression(expression) {
  const parts = String(expression || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) return []

  const refs = []
  let lastChapter = null

  for (const part of parts) {
    const crossChapter = part.match(/^(\d+):(\d+)-(\d+):(\d+)$/)
    if (crossChapter) {
      const startChapter = Number(crossChapter[1])
      const startVerse = Number(crossChapter[2])
      const endChapter = Number(crossChapter[3])
      const endVerse = Number(crossChapter[4])
      if (!startChapter || !startVerse || !endChapter || !endVerse) continue
      if (endChapter < startChapter) continue
      if (endChapter === startChapter && endVerse < startVerse) continue

      for (let chapter = startChapter; chapter <= endChapter; chapter += 1) {
        const verseFrom = chapter === startChapter ? startVerse : 1
        const verseTo = chapter === endChapter ? endVerse : endVerse
        for (let verse = verseFrom; verse <= verseTo; verse += 1) {
          refs.push({ chapter, verse })
        }
      }

      lastChapter = endChapter
      continue
    }

    const sameChapter = part.match(/^(\d+):(\d+)(?:-(\d+))?$/)
    if (sameChapter) {
      const chapter = Number(sameChapter[1])
      const startVerse = Number(sameChapter[2])
      const endVerse = Number(sameChapter[3] || sameChapter[2])
      if (!chapter || !startVerse || !endVerse || endVerse < startVerse) continue

      for (let verse = startVerse; verse <= endVerse; verse += 1) {
        refs.push({ chapter, verse })
      }

      lastChapter = chapter
      continue
    }

    const onlyVerses = lastChapter !== null ? part.match(/^(\d+)(?:-(\d+))?$/) : null
    if (onlyVerses) {
      const startVerse = Number(onlyVerses[1])
      const endVerse = Number(onlyVerses[2] || onlyVerses[1])
      if (!startVerse || !endVerse || endVerse < startVerse) continue

      for (let verse = startVerse; verse <= endVerse; verse += 1) {
        refs.push({ chapter: lastChapter, verse })
      }
    }
  }

  return refs
}

export function formatMottoSource(ref) {
  if (!ref || typeof ref !== 'object') return ''

  const abbr = String(ref?.book?.book_abbr || ref?.book?.abbr || ref?.book?.book_name || '').trim()
  const verse = ref?.verse && typeof ref.verse === 'object' ? ref.verse : {}
  let verseRaw = String(verse?.raw || '').trim()

  if (!verseRaw) {
    verseRaw = (Array.isArray(verse?.segments) ? verse.segments : [])
      .map(renderVerseSegment)
      .filter(Boolean)
      .join(', ')
  }

  verseRaw = verseRaw.replace(/:\s*/g, ': ')
  if (!abbr || !verseRaw) return ''
  return `(${abbr} ${verseRaw})`
}

export function formatMottoTextWithSource(motto) {
  const title = String(motto?.title || '').trim()
  if (!title) return '—'

  const references = Array.isArray(motto?.bible_references) ? motto.bible_references : []
  const source = formatMottoSource(references[0])
  return source ? `${title} ${source}` : title
}

export function buildMottoBibleReaderTarget(motto) {
  const reference = Array.isArray(motto?.bible_references) ? motto.bible_references[0] : null
  const bookId = String(reference?.book?.book_id || '').trim()
  if (!bookId) return null

  const verse = reference?.verse && typeof reference.verse === 'object' ? reference.verse : {}
  let refs = collectRefsFromSegments(verse?.segments)
  const expression = buildReferenceExpression(verse)
  if (!refs.length) refs = parseReferenceExpression(expression)
  if (!refs.length && !expression) return null

  return { bookId, refs, expression }
}