import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookOpen, Hash } from 'lucide-react'
import { api } from '../api.js'
import { EmptyState, ErrorState, LoadingState } from '../pageStates.jsx'
import './BibleReader.css'

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

function toArabicDigits(value) {
  return String(value).replace(/\d/g, (d) => AR_DIGITS[d] || d)
}

function convertArabicDigitsToLatin(value) {
  return String(value).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

function normalizeArabic(text) {
  return String(text || '')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[.,،:;!?؟()«»\-_/\\"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function getSectionHeadings(section) {
  if (!section || typeof section !== 'object') return []

  const seen = new Set()
  const out = []
  const addHeading = (value) => {
    const text = String(value || '').trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    out.push(text)
  }

  addHeading(section.t)

  if (Array.isArray(section.headings)) {
    for (const value of section.headings) addHeading(value)
  }

  return out
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createHighlightSpans(original, query) {
  const normalizedQuery = normalizeArabic(query)
  if (!normalizedQuery) return [{ text: original, highlighted: false }]

  const mappedChars = []
  const mappedIndex = []
  for (let i = 0; i < original.length; i += 1) {
    const normChar = normalizeArabic(original[i])
    if (!normChar) continue
    mappedChars.push(normChar)
    mappedIndex.push(i)
  }

  const normalizedOriginal = mappedChars.join('')
  if (!normalizedOriginal) return [{ text: original, highlighted: false }]

  const re = new RegExp(escapeRegExp(normalizedQuery), 'gi')
  const spans = []
  let match = null

  while ((match = re.exec(normalizedOriginal)) !== null) {
    const startNorm = match.index
    const endNorm = match.index + match[0].length - 1
    if (startNorm >= mappedIndex.length) continue

    const startOriginal = mappedIndex[startNorm]
    let endOriginal = mappedIndex[Math.min(endNorm, mappedIndex.length - 1)]
    while (endOriginal + 1 < original.length && !normalizeArabic(original[endOriginal + 1])) {
      endOriginal += 1
    }
    spans.push([startOriginal, endOriginal])
  }

  if (!spans.length) return [{ text: original, highlighted: false }]

  const chunks = []
  let cursor = 0
  for (const [start, end] of spans) {
    if (start > cursor) {
      chunks.push({ text: original.slice(cursor, start), highlighted: false })
    }
    chunks.push({ text: original.slice(start, end + 1), highlighted: true })
    cursor = end + 1
  }
  if (cursor < original.length) {
    chunks.push({ text: original.slice(cursor), highlighted: false })
  }
  return chunks
}

function renderHighlightedText(text, query) {
  return createHighlightSpans(String(text || ''), query).map((chunk, index) => (
    chunk.highlighted
      ? <mark key={index}>{chunk.text}</mark>
      : <span key={index}>{chunk.text}</span>
  ))
}

function getChapterByNumber(book, chapterNumber) {
  if (!book || !Array.isArray(book.chapters)) return null
  return book.chapters.find((ch) => Number(ch?.n) === Number(chapterNumber)) || null
}

function getBookName(bookLike, fallback = '') {
  const name = String(bookLike?.name || bookLike?.bookName || '').trim()
  if (name) return name

  const bookId = String(bookLike?.book_id || bookLike?.id || fallback || '').trim()
  return bookId
}

function getBookAbbr(bookLike) {
  return String(bookLike?.abbr || '').trim()
}

function formatBookLabel(bookLike, fallback = '—') {
  const name = getBookName(bookLike, fallback)
  const abbr = getBookAbbr(bookLike)
  if (name && abbr) return `${name} (${abbr})`
  return name || abbr || fallback
}

function buildQuickGuide(tree) {
  if (!Array.isArray(tree)) return []

  return tree
    .map((testament, testamentIndex) => {
      const rows = []

      const visitSection = (section, path = []) => {
        if (!section || typeof section !== 'object') return

        const sectionName = String(section?.name || '').trim()
        const nextPath = sectionName ? [...path, sectionName] : path
        const books = (Array.isArray(section?.books) ? section.books : [])
          .map((book, index) => {
            const bookId = String(book?.book_id || book?.id || `${testamentIndex}-${index}`).trim()
            const name = getBookName(book, bookId)
            const abbr = getBookAbbr(book)
            if (!name && !abbr) return null
            return {
              id: bookId || `${testamentIndex}-${index}`,
              name: name || bookId,
              abbr,
            }
          })
          .filter(Boolean)

        if (books.length) {
          rows.push({
            key: `${String(testament?.id || testamentIndex)}-${nextPath.join('|') || 'root'}`,
            path: nextPath,
            books,
          })
        }

        for (const subsection of Array.isArray(section?.subsections) ? section.subsections : []) {
          visitSection(subsection, nextPath)
        }
      }

      for (const section of Array.isArray(testament?.sections) ? testament.sections : []) {
        visitSection(section)
      }

      return {
        id: String(testament?.id || testamentIndex),
        name: String(testament?.name || '—'),
        rows,
      }
    })
    .filter((testament) => testament.rows.length)
}

function normalizeVerseId(value) {
  return convertArabicDigitsToLatin(String(value || ''))
    .replace(/\s+/g, '')
    .trim()
}

function getChapterVerseIds(chapter) {
  const out = []
  const seen = new Set()

  for (const section of (Array.isArray(chapter?.s) ? chapter.s : [])) {
    const verses = section?.v && typeof section.v === 'object' ? section.v : {}
    for (const rawVerseId of Object.keys(verses)) {
      const verseId = normalizeVerseId(rawVerseId)
      if (!verseId || seen.has(verseId)) continue
      seen.add(verseId)
      out.push(verseId)
    }
  }

  return out
}

function collectChapterRange(book, chapterNumber, startVerseId, endVerseId) {
  const chapter = getChapterByNumber(book, chapterNumber)
  if (!chapter) return null

  const verseIds = getChapterVerseIds(chapter)
  const startId = normalizeVerseId(startVerseId)
  const endId = normalizeVerseId(endVerseId)
  if (!startId || !endId) return null

  const startIndex = verseIds.indexOf(startId)
  const endIndex = verseIds.indexOf(endId)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return null

  return verseIds.slice(startIndex, endIndex + 1).map((verse) => ({
    chapter: chapterNumber,
    verse,
  }))
}

function chapterVerseExists(book, chapterNumber, verseNumber) {
  const chapter = getChapterByNumber(book, chapterNumber)
  const verseId = normalizeVerseId(verseNumber)
  if (!chapter || !verseId) return false
  return getChapterVerseIds(chapter).includes(verseId)
}

function collectCrossChapterRange(book, c1, v1, c2, v2) {
  if (!book || !Array.isArray(book.chapters)) return null

  if (c2 < c1) return null
  if (c1 === c2) {
    return collectChapterRange(book, c1, v1, v2)
  }

  const out = []
  const startVerseId = normalizeVerseId(v1)
  const endVerseId = normalizeVerseId(v2)
  if (!startVerseId || !endVerseId) return null

  for (const chapter of book.chapters) {
    const chapterNum = Number(chapter?.n)
    if (!Number.isFinite(chapterNum)) continue
    if (chapterNum < c1 || chapterNum > c2) continue

    const verseIds = getChapterVerseIds(chapter)
    if (!verseIds.length) continue

    if (chapterNum === c1) {
      const startIndex = verseIds.indexOf(startVerseId)
      if (startIndex === -1) return null
      out.push(...verseIds.slice(startIndex).map((verse) => ({ chapter: chapterNum, verse })))
      continue
    }

    if (chapterNum === c2) {
      const endIndex = verseIds.indexOf(endVerseId)
      if (endIndex === -1) return null
      out.push(...verseIds.slice(0, endIndex + 1).map((verse) => ({ chapter: chapterNum, verse })))
      continue
    }

    out.push(...verseIds.map((verse) => ({ chapter: chapterNum, verse })))
  }

  return out.length ? out : null
}

function parseReferenceExpression(book, expression) {
  const normalizedExpression = convertArabicDigitsToLatin(expression)
  const parts = String(normalizedExpression || '')
    .split(/[،,؛;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return null

  const refs = []
  let lastChapter = null

  for (const part of parts) {
    const cross = part.match(/^(\d+)\s*:\s*([^\s,:-]+)\s*-\s*(\d+)\s*:\s*([^\s,:-]+)$/)
    if (cross) {
      const c1 = Number(cross[1])
      const v1 = normalizeVerseId(cross[2])
      const c2 = Number(cross[3])
      const v2 = normalizeVerseId(cross[4])
      const range = collectCrossChapterRange(book, c1, v1, c2, v2)
      if (!range?.length) return null
      refs.push(...range)
      lastChapter = c2
      continue
    }

    const sameChapter = part.match(/^(\d+)\s*:\s*([^\s,:-]+)(?:\s*-\s*([^\s,:-]+))?$/)
    if (sameChapter) {
      const chapter = Number(sameChapter[1])
      const v1 = normalizeVerseId(sameChapter[2])
      const v2 = normalizeVerseId(sameChapter[3] || sameChapter[2])
      const range = collectChapterRange(book, chapter, v1, v2)
      if (!range?.length) return null
      refs.push(...range)
      lastChapter = chapter
      continue
    }

    if (lastChapter !== null) {
      const onlyVerses = part.match(/^([^\s,:-]+)(?:\s*-\s*([^\s,:-]+))?$/)
      if (onlyVerses) {
        const v1 = normalizeVerseId(onlyVerses[1])
        const v2 = normalizeVerseId(onlyVerses[2] || onlyVerses[1])
        const range = collectChapterRange(book, lastChapter, v1, v2)
        if (!range?.length) return null
        refs.push(...range)
        continue
      }
    }

    return null
  }

  return refs
}

function resolveReferenceQuery(raw, aliases) {
  const normalizedDigits = convertArabicDigitsToLatin(raw)
  const compact = String(normalizedDigits || '').replace(/\s+/g, ' ').trim()
  if (!compact) return null

  const tokens = compact.split(' ')
  for (let splitIndex = tokens.length - 1; splitIndex >= 1; splitIndex -= 1) {
    const bookLabel = tokens.slice(0, splitIndex).join(' ').trim()
    const expression = tokens.slice(splitIndex).join(' ').trim()
    if (!bookLabel || !expression) continue

    const normalizedBookLabel = normalizeArabic(bookLabel)
    if (!normalizedBookLabel) continue

    const bookId = aliases[normalizedBookLabel] || aliases[normalizedBookLabel.replace(/\s+/g, '')]
    if (bookId) {
      return { bookId, expression }
    }
  }

  return null
}

export default function BibleReader({ toast, externalTarget }) {
  const [booksMeta, setBooksMeta] = useState([])
  const [booksTree, setBooksTree] = useState([])
  const [mainTab, setMainTab] = useState('reader')
  const [activeBookId, setActiveBookId] = useState('')
  const [activeChapterIndex, setActiveChapterIndex] = useState(0)
  const [highlightVerses, setHighlightVerses] = useState([])
  const [searchText, setSearchText] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [referenceText, setReferenceText] = useState('')
  const [loadingBooks, setLoadingBooks] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [viewMode, setViewMode] = useState('chapter')
  const [multiChapterView, setMultiChapterView] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const booksCacheRef = useRef({})

  const booksMetaById = useMemo(() => {
    const index = {}
    for (const row of booksMeta) {
      const bid = String(row?.book_id || '')
      if (!bid) continue
      index[bid] = row
    }
    return index
  }, [booksMeta])

  const availableBooksMeta = useMemo(
    () => booksMeta.filter((book) => !!book?.has_content),
    [booksMeta],
  )

  const quickGuide = useMemo(() => buildQuickGuide(booksTree), [booksTree])

  const aliases = useMemo(() => {
    const map = {}

    const add = (key, bookId) => {
      const normalized = normalizeArabic(key)
      if (!normalized) return
      map[normalized] = bookId
      map[normalized.replace(/\s+/g, '')] = bookId
    }

    for (const book of booksMeta) {
      const bookId = String(book?.book_id || '').trim()
      if (!bookId) continue

      const name = String(book?.name || '').trim()
      const abbr = String(book?.abbr || '').trim()

      add(bookId, bookId)
      add(name, bookId)
      add(abbr, bookId)

      add(name.replace(/^إنجيل\s+/u, ''), bookId)
      add(name.replace(/^سفر\s+/u, ''), bookId)
      add(name.replace(/^رسالة\s+/u, ''), bookId)
      add(name.replace(/^رسالة\s+القديس\s+/u, ''), bookId)
    }

    return map
  }, [booksMeta])

  const activeBook = booksCacheRef.current[activeBookId] || null
  const chapters = Array.isArray(activeBook?.chapters) ? activeBook.chapters : []
  const activeChapter = chapters[activeChapterIndex] || null

  const ensureBookLoaded = async (bookId) => {
    if (booksCacheRef.current[bookId]) return booksCacheRef.current[bookId]
    const response = await api.getBibleReaderBook(bookId)
    const book = response?.book || null
    if (book) {
      booksCacheRef.current[bookId] = book
    }
    return book
  }

  useEffect(() => {
    let cancelled = false
    setLoadingBooks(true)
    setLoadError('')
    setActiveBookId('')
    setActiveChapterIndex(0)
    setHighlightVerses([])
    setSearchResult(null)
    setMultiChapterView(null)

    api.listBibleReaderBooks()
      .then((res) => {
        if (cancelled) return
        const rows = Array.isArray(res?.books) ? res.books : []
        const tree = Array.isArray(res?.tree) ? res.tree : []
        setBooksMeta(rows)
        setBooksTree(tree)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError('تعذر تحميل بيانات الكتاب المقدس حالياً. حاول مرة أخرى.')
        toast?.('تعذر تحميل بيانات الكتاب المقدس', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoadingBooks(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey, toast])

  useEffect(() => {
    const query = searchText.trim()
    if (!query) {
      setSearchResult(null)
      if (viewMode === 'search') setViewMode('chapter')
      return
    }

    const handle = setTimeout(async () => {
      try {
        for (const row of availableBooksMeta) {
          const bid = String(row?.book_id || '')
          if (!bid) continue
          // Load all available books once so searching includes future-added JSON books.
          await ensureBookLoaded(bid)
        }
      } catch {
        toast?.('تعذر تحميل بعض الأسفار للبحث', 'error')
      }

      const nQuery = normalizeArabic(query)
      if (!nQuery) return

      const verseHits = []
      const titleHits = []
      const sectionHits = []
      const seenTitles = new Set()
      const seenSections = new Set()

      for (const row of availableBooksMeta) {
        const bookId = String(row?.book_id || '')
        const book = booksCacheRef.current[bookId]
        if (!book || !Array.isArray(book.chapters)) continue
        const bookLabel = formatBookLabel(row || book, bookId)

        for (let ci = 0; ci < book.chapters.length; ci += 1) {
          const chapter = book.chapters[ci]
          const chapterNum = Number(chapter?.n)
          const sections = Array.isArray(chapter?.s) ? chapter.s : []

          for (const section of sections) {
            const sectionHeadings = getSectionHeadings(section)
            const primaryHeading = String(sectionHeadings[0] || '')
            const subHeadings = sectionHeadings.slice(1)

            if (primaryHeading && normalizeArabic(primaryHeading).includes(nQuery)) {
              const key = `${bookId}|${primaryHeading}`
              if (!seenTitles.has(key)) {
                seenTitles.add(key)
                titleHits.push({ bookId, chapterIndex: ci, chapterNum, heading: primaryHeading, bookName: bookLabel })
              }
            }

            for (const sectionTitle of subHeadings) {
              if (!normalizeArabic(sectionTitle).includes(nQuery)) continue
              const key = `${bookId}|${chapterNum}|${sectionTitle}`
              if (!seenSections.has(key)) {
                seenSections.add(key)
                sectionHits.push({ bookId, chapterIndex: ci, chapterNum, sectionTitle, bookName: bookLabel })
              }
            }

            const verses = section?.v && typeof section.v === 'object' ? section.v : {}
            for (const [verseNumber, verseText] of Object.entries(verses)) {
              if (!normalizeArabic(verseText).includes(nQuery)) continue
              const verseId = normalizeVerseId(verseNumber)
              if (!verseId) continue
              verseHits.push({
                bookId,
                chapterIndex: ci,
                chapterNum,
                verseId,
                verseText: String(verseText || ''),
                bookName: bookLabel,
              })
            }
          }
        }
      }

      setSearchResult({
        query,
        titleHits,
        sectionHits,
        verseHits,
        total: titleHits.length + sectionHits.length + verseHits.length,
      })
      setViewMode('search')
      setMultiChapterView(null)
    }, 220)

    return () => clearTimeout(handle)
  }, [searchText, availableBooksMeta])

  const goToChapter = async (bookId, chapterIndex, verseNumbers = []) => {
    if (!booksMetaById[bookId]?.has_content) return
    await ensureBookLoaded(bookId)
    setMainTab('reader')
    setActiveBookId(bookId)
    setActiveChapterIndex(chapterIndex)
    setHighlightVerses(verseNumbers)
    setViewMode('chapter')
    setMultiChapterView(null)
  }

  const applyReferenceTarget = async (bookId, refs, expression = '') => {
    if (!bookId) return false

    if (!booksMetaById[bookId]?.has_content) {
      toast?.('هذا السفر ظاهر في الفهرس لكنه غير متوفر بعد', 'error')
      return false
    }

    let book = null
    try {
      book = await ensureBookLoaded(bookId)
    } catch {
      toast?.('تعذر تحميل السفر المطلوب', 'error')
      return false
    }

    if (!book) {
      toast?.('تعذر تحميل السفر المطلوب', 'error')
      return false
    }

    const resolvedRefs = Array.isArray(refs) && refs.length
      ? refs
      : parseReferenceExpression(book, expression)

    if (!Array.isArray(resolvedRefs) || !resolvedRefs.length) {
      toast?.('لا توجد آيات مطابقة', 'error')
      return false
    }

    for (const ref of resolvedRefs) {
      if (!chapterVerseExists(book, ref?.chapter, ref?.verse)) {
        toast?.(`آية غير موجودة: ${toArabicDigits(ref?.chapter)}:${toArabicDigits(ref?.verse)}`, 'error')
        return false
      }
    }

    const byChapter = {}
    for (const ref of resolvedRefs) {
      const chapter = Number(ref?.chapter)
      const verse = normalizeVerseId(ref?.verse)
      if (!chapter || !verse) continue
      if (!byChapter[chapter]) byChapter[chapter] = []
      if (!byChapter[chapter].includes(verse)) byChapter[chapter].push(verse)
    }

    const chapterNumbers = Object.keys(byChapter).map(Number).sort((a, b) => a - b)
    if (!chapterNumbers.length) {
      toast?.('لا توجد آيات مطابقة', 'error')
      return false
    }

    if (chapterNumbers.length === 1) {
      const onlyChapter = chapterNumbers[0]
      const chapterIndex = book.chapters.findIndex((ch) => Number(ch?.n) === onlyChapter)
      await goToChapter(bookId, chapterIndex, byChapter[onlyChapter])
    } else {
      setMainTab('reader')
      setActiveBookId(bookId)
      setViewMode('chapter')
      setHighlightVerses([])
      setMultiChapterView({ bookId, byChapter, chapterNumbers })
    }

    setReferenceText('')
    setSearchText('')
    setSearchResult(null)
    return true
  }

  const handleReferenceSubmit = async (event) => {
    event.preventDefault()
    const raw = String(referenceText || '').trim()
    if (!raw) return

    const resolvedQuery = resolveReferenceQuery(raw, aliases)
    if (!resolvedQuery) {
      toast?.('صيغة المرجع غير صحيحة', 'error')
      return
    }

    const { bookId, expression } = resolvedQuery

    if (!booksMetaById[bookId]?.has_content) {
      toast?.('هذا السفر ظاهر في الفهرس لكنه غير متوفر بعد', 'error')
      return
    }

    let book = null
    try {
      book = await ensureBookLoaded(bookId)
    } catch {
      toast?.('تعذر تحميل السفر المطلوب', 'error')
      return
    }

    if (!book) {
      toast?.('تعذر تحميل السفر المطلوب', 'error')
      return
    }

    const refs = parseReferenceExpression(book, expression)
    if (!refs) {
      toast?.('صيغة المرجع غير صحيحة', 'error')
      return
    }
    await applyReferenceTarget(bookId, refs)
  }

  useEffect(() => {
    const requestId = externalTarget?.requestId
    const bookId = String(externalTarget?.bookId || '').trim()
    const refs = Array.isArray(externalTarget?.refs) ? externalTarget.refs : []
    const expression = String(externalTarget?.expression || '').trim()
    if (!requestId || !bookId || loadingBooks) return
    if (!refs.length && !expression) return
    applyReferenceTarget(bookId, refs, expression)
  }, [externalTarget?.requestId, loadingBooks])

  if (loadingBooks) {
    return (
      <LoadingState
        title="جارٍ تحميل الكتاب المقدس"
        description="يتم تجهيز الأسفار والبحث الآن."
        minHeight={320}
      />
    )
  }

  if (loadError) {
    return (
      <ErrorState
        title="تعذر تحميل الكتاب المقدس"
        description={loadError}
        onRetry={() => setReloadKey((value) => value + 1)}
        minHeight={320}
      />
    )
  }

  if (!availableBooksMeta.length) {
    return (
      <EmptyState
        title="لا توجد أسفار متاحة حالياً"
        description="لم يتم العثور على أسفار متاحة للقراءة في الوقت الحالي."
        icon={BookOpen}
        actionLabel="إعادة المحاولة"
        onAction={() => setReloadKey((value) => value + 1)}
        minHeight={320}
      />
    )
  }

  const renderSectionNode = (section, depth = 0, keyPrefix = '') => {
    const sectionId = String(section?.id || `section-${depth}`)
    const nodeKey = keyPrefix ? `${keyPrefix}-${sectionId}` : sectionId
    const sectionName = String(section?.name || '—')
    const books = Array.isArray(section?.books) ? section.books : []
    const subsections = Array.isArray(section?.subsections) ? section.subsections : []

    return (
      <details key={nodeKey} className={`bible-tree-section depth-${depth}`} defaultOpen={depth === 0}>
        <summary className="bible-tree-summary">{sectionName}</summary>
        <div className="bible-tree-content">
          {books.map((book) => {
            const bid = String(book?.book_id || book?.id || '')
            const hasContent = !!book?.has_content
            const isActive = hasContent && bid === activeBookId
            const name = getBookName(book, bid || '—')
            const abbr = getBookAbbr(book)
            const fullLabel = formatBookLabel(book, bid || '—')
            return (
              <button
                key={`${nodeKey}-${bid}`}
                type="button"
                className={`bible-book-btn tree${isActive ? ' active' : ''}${!hasContent ? ' disabled' : ''}`}
                disabled={!hasContent}
                title={!hasContent ? `${fullLabel} • غير متوفر بعد` : fullLabel}
                onClick={async () => {
                  if (!hasContent) return
                  await goToChapter(bid, 0, [])
                }}
              >
                <span className="bible-book-label">
                  <span className="bible-book-name">{name}</span>
                  {abbr ? <span className="bible-book-abbr">{abbr}</span> : null}
                </span>
                {!hasContent ? <span className="bible-book-disabled-label">غير متوفر</span> : null}
              </button>
            )
          })}
          {subsections.map((subsection) => renderSectionNode(subsection, depth + 1, nodeKey))}
        </div>
      </details>
    )
  }

  const renderGuidePanel = (testament) => {
    const sections = Array.isArray(testament?.rows) ? testament.rows : []
    if (!sections.length) return null

    return (
      <section key={testament.id} className="bible-guide-panel">
        <div className="bible-guide-panel-heading">{testament.name}</div>
        <div className={`bible-guide-panel-body ${testament.id === 'old_testament' ? 'old' : 'new'}`}>
          {sections.map((row) => {
            const trail = Array.isArray(row?.path) ? row.path.filter(Boolean) : []
            const title = trail[trail.length - 1] || '—'
            const parentPath = trail.length > 1 ? trail.slice(0, -1).join(' / ') : ''
            const books = Array.isArray(row?.books) ? row.books : []

            return (
              <article key={row.key} className="bible-guide-section-card">
                {parentPath ? <div className="bible-guide-section-parent">{parentPath}</div> : null}
                <div className="bible-guide-section-title">{title}</div>
                <div className="bible-guide-book-table">
                  {books.map((book) => (
                    <div key={book.id} className="bible-guide-book-row">
                      <span className="bible-guide-book-row-name">{book.name}</span>
                      <span className="bible-guide-book-row-abbr">{book.abbr || '—'}</span>
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    )
  }

  const activeBookLabel = activeBookId
    ? formatBookLabel(booksMetaById[activeBookId] || activeBook, activeBookId || '—')
    : 'اختر سفراً من القائمة'

  return (
    <div className={`bible-reader${mainTab === 'guide' ? ' guide-tab' : ''}`}>
      {mainTab === 'reader' ? (
      <section className="card bible-sidebar">
        <div className="card-header">
          <div className="card-title">
            <BookOpen size={16} />
            قارئ الكتاب المقدس
          </div>
        </div>

        <div className="card-body bible-toolbar">
          <div className="bible-input-wrap">
            <Search size={14} className="bible-input-icon" />
            <input
              className="bible-input"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="ابحث في الآيات أو العناوين"
            />
          </div>

          <form onSubmit={handleReferenceSubmit}>
            <div className="bible-input-wrap">
              <Hash size={14} className="bible-input-icon" />
              <input
                className="bible-input"
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder="مثال: يو 3:16 أو يو 5:1-10,6:3"
              />
            </div>
          </form>
        </div>

        <div className="bible-sidebar-body">
          <div className="bible-book-list">
            <div className="bible-book-list-inner">
              {booksTree.map((testament) => (
                <details key={String(testament?.id || '')} className="bible-tree-testament">
                  <summary className="bible-tree-summary testament">{String(testament?.name || '—')}</summary>
                  <div className="bible-tree-content">
                    {(Array.isArray(testament?.sections) ? testament.sections : []).map((section) => renderSectionNode(section, 0, String(testament?.id || 'testament')))}
                  </div>
                </details>
              ))}

              {activeBookId && chapters.length ? (
                <div className="bible-tree-group">
                  <div className="bible-tree-group-label">فصول {activeBookLabel}</div>
                  <div className="bible-ch-grid">
                    {chapters.map((chapter, index) => (
                      <button
                        key={`${activeBookId}-${chapter?.n}-${index}`}
                        className={`bible-ch-btn${index === activeChapterIndex ? ' active' : ''}`}
                        onClick={() => {
                          setActiveChapterIndex(index)
                          setHighlightVerses([])
                          setViewMode('chapter')
                          setMultiChapterView(null)
                        }}
                      >
                        {toArabicDigits(chapter?.n)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bible-sidebar-note">
                  اختر سفراً أولاً لعرض الأصحاحات في نفس القائمة.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      ) : null}

      <section className="card bible-main">
        <div className="bible-main-header">
          <div className="bible-main-header-copy">
            <div className="bible-main-tabs" role="tablist" aria-label="عرض قارئ الكتاب المقدس">
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'reader'}
                className={`bible-main-tab${mainTab === 'reader' ? ' active' : ''}`}
                onClick={() => setMainTab('reader')}
              >
                القارئ
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mainTab === 'guide'}
                className={`bible-main-tab${mainTab === 'guide' ? ' active' : ''}`}
                onClick={() => setMainTab('guide')}
              >
                دليل الأسفار
              </button>
            </div>
            <div className="bible-main-title">
              {mainTab === 'guide' ? 'الدليل السريع لأسفار الكتاب المقدس' : activeBookLabel}
            </div>
          </div>
          {mainTab === 'guide' ? (
            <div className="bible-guide-header-note">
              ترتيب هرمي سريع بالأسماء والاختصارات
            </div>
          ) : activeChapter ? (
            <div style={{ fontSize: '0.84rem', color: 'var(--gray-500)' }}>
              الفصل {toArabicDigits(activeChapter?.n)}
            </div>
          ) : null}
        </div>

        <div className="bible-main-body">
          {mainTab === 'guide' ? (
            <div className="bible-guide-page">
              <div className="bible-guide-sheet">
                <div className="bible-guide-banner">الترتيب الكتابي لأسماء أسفار الكتاب المقدس</div>
                <div className="bible-guide-subtitle">الأقسام، الأسفار، والاختصارات المرجعية السريعة</div>
                {quickGuide.map((testament) => renderGuidePanel(testament))}
              </div>
            </div>
          ) : viewMode === 'search' && searchResult ? (
            <>
              {!searchResult.total ? (
                <div style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--gray-500)' }}>
                  لا توجد نتائج مطابقة
                </div>
              ) : (
                <>
                  {searchResult.titleHits.length > 0 ? (
                    <div className="bible-search-group">
                      <div className="bible-search-label">عناوين رئيسية ({searchResult.titleHits.length})</div>
                      {searchResult.titleHits.map((hit, idx) => (
                        <div
                          key={`hl-${idx}`}
                          className="bible-result-item"
                          onClick={() => goToChapter(hit.bookId, hit.chapterIndex, [])}
                        >
                          <div className="bible-result-ref">{hit.bookName} • الفصل {toArabicDigits(hit.chapterNum)}</div>
                          <div className="bible-result-text">{renderHighlightedText(hit.heading, searchResult.query)}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {searchResult.sectionHits.length > 0 ? (
                    <div className="bible-search-group">
                      <div className="bible-search-label">عناوين الفقرات ({searchResult.sectionHits.length})</div>
                      {searchResult.sectionHits.map((hit, idx) => (
                        <div
                          key={`sec-${idx}`}
                          className="bible-result-item"
                          onClick={() => goToChapter(hit.bookId, hit.chapterIndex, [])}
                        >
                          <div className="bible-result-ref">{hit.bookName} • الفصل {toArabicDigits(hit.chapterNum)}</div>
                          <div className="bible-result-text">{renderHighlightedText(hit.sectionTitle, searchResult.query)}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {searchResult.verseHits.length > 0 ? (
                    <div className="bible-search-group">
                      <div className="bible-search-label">الآيات ({searchResult.verseHits.length})</div>
                      {searchResult.verseHits.map((hit, idx) => (
                        <div
                          key={`verse-${idx}`}
                          className="bible-result-item"
                          onClick={() => goToChapter(hit.bookId, hit.chapterIndex, [hit.verseId])}
                        >
                          <div className="bible-result-ref">
                            {hit.bookName} • الفصل {toArabicDigits(hit.chapterNum)} • الآية {toArabicDigits(hit.verseId)}
                          </div>
                          <div className="bible-result-text">{renderHighlightedText(hit.verseText, searchResult.query)}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : multiChapterView && activeBook ? (
            <>
              <div className="bible-section-title">آيات مختارة</div>
              {multiChapterView.chapterNumbers.map((chapterNumber) => {
                const chapter = getChapterByNumber(activeBook, chapterNumber)
                if (!chapter) return null

                return (
                  <div key={`multi-${chapterNumber}`}>
                    <div className="bible-paragraph-title">الفصل {toArabicDigits(chapterNumber)}</div>
                    {(Array.isArray(chapter.s) ? chapter.s : []).map((section, secIdx) => {
                      const sectionHeadings = getSectionHeadings(section)
                      const primaryHeading = String(sectionHeadings[0] || '')
                      const subHeadings = sectionHeadings.slice(1)
                      const relevant = Object.entries(section?.v && typeof section.v === 'object' ? section.v : {})
                        .filter(([verse]) => (multiChapterView.byChapter[chapterNumber] || []).includes(normalizeVerseId(verse)))

                      if (!relevant.length) return null

                      return (
                        <div key={`multi-sec-${chapterNumber}-${secIdx}`}>
                          {primaryHeading ? <div className="bible-section-title">{primaryHeading}</div> : null}
                          {subHeadings.map((heading, headingIdx) => (
                            <div key={`multi-sec-title-${chapterNumber}-${secIdx}-${headingIdx}`} className="bible-paragraph-title">{heading}</div>
                          ))}
                          <p className="bible-paragraph">
                            {relevant.map(([verse, verseText], idx) => (
                              <span key={`multi-verse-${chapterNumber}-${verse}`} className="bible-verse hl">
                                <sup className="bible-verse-num">{toArabicDigits(verse)}</sup>
                                {verseText}
                                {idx < relevant.length - 1 ? ' ' : ''}
                              </span>
                            ))}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </>
          ) : activeChapter ? (
            <>
              {(Array.isArray(activeChapter.s) ? activeChapter.s : []).map((section, sectionIndex) => {
                const sectionHeadings = getSectionHeadings(section)
                const primaryHeading = String(sectionHeadings[0] || '')
                const subHeadings = sectionHeadings.slice(1)
                const verses = section?.v && typeof section.v === 'object' ? section.v : {}
                const entries = Object.entries(verses)

                return (
                  <div key={`sec-${sectionIndex}`}>
                    {primaryHeading ? <div className="bible-section-title">{primaryHeading}</div> : null}
                    {subHeadings.map((heading, headingIdx) => (
                      <div key={`sec-${sectionIndex}-title-${headingIdx}`} className="bible-paragraph-title">{heading}</div>
                    ))}
                    <p className="bible-paragraph">
                      {entries.map(([verseNumber, verseText], idx) => {
                        const isHighlighted = highlightVerses.includes(normalizeVerseId(verseNumber))
                        return (
                          <span key={`verse-${verseNumber}`} className={`bible-verse${isHighlighted ? ' hl' : ''}`}>
                            <sup className="bible-verse-num">{toArabicDigits(verseNumber)}</sup>
                            {verseText}
                            {idx < entries.length - 1 ? ' ' : ''}
                          </span>
                        )
                      })}
                    </p>
                  </div>
                )
              })}

              <div className="bible-nav">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={activeChapterIndex <= 0}
                  onClick={() => {
                    setActiveChapterIndex((prev) => Math.max(0, prev - 1))
                    setHighlightVerses([])
                  }}
                >
                  السابق
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={activeChapterIndex >= chapters.length - 1}
                  onClick={() => {
                    setActiveChapterIndex((prev) => Math.min(chapters.length - 1, prev + 1))
                    setHighlightVerses([])
                  }}
                >
                  التالي
                </button>
              </div>
            </>
          ) : !activeBookId ? (
            <div className="bible-empty-state">
              <BookOpen size={30} />
              <div className="bible-empty-state-title">اختر سفراً لبدء القراءة</div>
              <div className="bible-empty-state-copy">
                افتح أحد العهدين من القائمة الجانبية ثم اختر السفر والفصل المطلوب.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--gray-500)' }}>
              لا توجد بيانات لعرضها
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
