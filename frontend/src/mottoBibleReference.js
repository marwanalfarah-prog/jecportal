function convertArabicDigitsToLatin(value) {
  return String(value ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

function normalizeVerseId(value) {
  return convertArabicDigitsToLatin(String(value ?? ''))
    .replace(/\s+/g, '')
    .trim()
}

function parseVerseId(value) {
  const verseId = normalizeVerseId(value)
  const match = verseId.match(/^(\d+)(.*)$/)
  if (!match) return null

  const number = Number(match[1])
  if (!number) return null

  return {
    value: verseId,
    number,
    suffix: match[2] || '',
  }
}

function compareVerseIds(left, right) {
  if (!left || !right) return null
  if (left.number !== right.number) return left.number - right.number
  return left.suffix.localeCompare(right.suffix, 'ar')
}

function renderVerseSegment(segment) {
  const start = segment?.start || {}
  const end = segment?.end || {}
  const startChapter = Number(start?.chapter)
  const startVerse = parseVerseId(start?.verse)
  const endChapter = Number(end?.chapter)
  const endVerse = parseVerseId(end?.verse)

  if (!startChapter || !startVerse || !endChapter || !endVerse) return ''
  if (startChapter === endChapter && startVerse.value === endVerse.value) return `${startChapter}: ${startVerse.value}`
  if (startChapter === endChapter) return `${startChapter}: ${startVerse.value}-${endVerse.value}`
  return `${startChapter}: ${startVerse.value}-${endChapter}: ${endVerse.value}`
}

function collectRefsFromSegments(segments) {
  const refs = []

  for (const segment of Array.isArray(segments) ? segments : []) {
    const start = segment?.start || {}
    const end = segment?.end || {}
    const startChapter = Number(start?.chapter)
    const startVerse = parseVerseId(start?.verse)
    const endChapter = Number(end?.chapter)
    const endVerse = parseVerseId(end?.verse)

    if (!startChapter || !startVerse || !endChapter || !endVerse) continue
    if (endChapter < startChapter) continue
    if (endChapter === startChapter && compareVerseIds(startVerse, endVerse) > 0) continue

    if (startChapter !== endChapter) return []

    if (startVerse.value === endVerse.value) {
      refs.push({ chapter: startChapter, verse: startVerse.value })
      continue
    }

    if (startVerse.suffix || endVerse.suffix) return []

    for (let verse = startVerse.number; verse <= endVerse.number; verse += 1) {
      refs.push({ chapter: startChapter, verse: String(verse) })
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
    .split(/[،,؛;]/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (!parts.length) return []

  const refs = []
  let lastChapter = null

  for (const part of parts) {
    const crossChapter = part.match(/^(\d+)\s*:\s*([^\s,:-]+)\s*-\s*(\d+)\s*:\s*([^\s,:-]+)$/)
    if (crossChapter) {
      const startChapter = Number(crossChapter[1])
      const startVerse = parseVerseId(crossChapter[2])
      const endChapter = Number(crossChapter[3])
      const endVerse = parseVerseId(crossChapter[4])
      if (!startChapter || !startVerse || !endChapter || !endVerse) continue
      if (endChapter < startChapter) continue
      if (endChapter !== startChapter) return []
      if (compareVerseIds(startVerse, endVerse) > 0) continue

      if (startVerse.value === endVerse.value) {
        refs.push({ chapter: startChapter, verse: startVerse.value })
      } else if (!startVerse.suffix && !endVerse.suffix) {
        for (let verse = startVerse.number; verse <= endVerse.number; verse += 1) {
          refs.push({ chapter: startChapter, verse: String(verse) })
        }
      } else {
        return []
      }

      lastChapter = endChapter
      continue
    }

    const sameChapter = part.match(/^(\d+)\s*:\s*([^\s,:-]+)(?:\s*-\s*([^\s,:-]+))?$/)
    if (sameChapter) {
      const chapter = Number(sameChapter[1])
      const startVerse = parseVerseId(sameChapter[2])
      const endVerse = parseVerseId(sameChapter[3] || sameChapter[2])
      if (!chapter || !startVerse || !endVerse || compareVerseIds(startVerse, endVerse) > 0) continue

      if (startVerse.value === endVerse.value) {
        refs.push({ chapter, verse: startVerse.value })
      } else if (!startVerse.suffix && !endVerse.suffix) {
        for (let verse = startVerse.number; verse <= endVerse.number; verse += 1) {
          refs.push({ chapter, verse: String(verse) })
        }
      } else {
        return []
      }

      lastChapter = chapter
      continue
    }

    const onlyVerses = lastChapter !== null ? part.match(/^([^\s,:-]+)(?:\s*-\s*([^\s,:-]+))?$/) : null
    if (onlyVerses) {
      const startVerse = parseVerseId(onlyVerses[1])
      const endVerse = parseVerseId(onlyVerses[2] || onlyVerses[1])
      if (!startVerse || !endVerse || compareVerseIds(startVerse, endVerse) > 0) continue

      if (startVerse.value === endVerse.value) {
        refs.push({ chapter: lastChapter, verse: startVerse.value })
      } else if (!startVerse.suffix && !endVerse.suffix) {
        for (let verse = startVerse.number; verse <= endVerse.number; verse += 1) {
          refs.push({ chapter: lastChapter, verse: String(verse) })
        }
      } else {
        return []
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
  if (!refs.length && !expression) return null

  return { bookId, refs, expression }
}