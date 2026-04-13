import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookOpen, Hash } from 'lucide-react'
import { api } from '../api.js'
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

function chapterVerseExists(book, chapterNumber, verseNumber) {
  const chapter = getChapterByNumber(book, chapterNumber)
  if (!chapter || !Array.isArray(chapter.s)) return false

  for (const section of chapter.s) {
    if (!section || typeof section !== 'object') continue
    const verses = section.v && typeof section.v === 'object' ? section.v : {}
    if (Object.prototype.hasOwnProperty.call(verses, String(verseNumber))) return true
  }
  return false
}

function collectCrossChapterRange(book, c1, v1, c2, v2) {
  const out = []
  if (!book || !Array.isArray(book.chapters)) return out

  for (const chapter of book.chapters) {
    const chapterNum = Number(chapter?.n)
    if (!Number.isFinite(chapterNum)) continue
    if (chapterNum < c1 || chapterNum > c2) continue

    const verses = []
    for (const section of (Array.isArray(chapter.s) ? chapter.s : [])) {
      const row = section?.v && typeof section.v === 'object' ? section.v : {}
      for (const key of Object.keys(row)) {
        const verseNum = Number(key)
        if (Number.isFinite(verseNum)) verses.push(verseNum)
      }
    }

    verses.sort((a, b) => a - b)
    for (const verseNum of verses) {
      if (chapterNum === c1 && verseNum < v1) continue
      if (chapterNum === c2 && verseNum > v2) continue
      out.push({ chapter: chapterNum, verse: verseNum })
    }
  }

  return out
}

function parseReferenceExpression(book, expression) {
  const parts = String(expression || '').split(',').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return null

  const refs = []
  let lastChapter = null

  for (const part of parts) {
    const cross = part.match(/^(\d+):(\d+)-(\d+):(\d+)$/)
    if (cross) {
      const c1 = Number(cross[1])
      const v1 = Number(cross[2])
      const c2 = Number(cross[3])
      const v2 = Number(cross[4])
      refs.push(...collectCrossChapterRange(book, c1, v1, c2, v2))
      lastChapter = c2
      continue
    }

    const sameChapter = part.match(/^(\d+):(\d+)(?:-(\d+))?$/)
    if (sameChapter) {
      const chapter = Number(sameChapter[1])
      const v1 = Number(sameChapter[2])
      const v2 = Number(sameChapter[3] || sameChapter[2])
      for (let v = v1; v <= v2; v += 1) refs.push({ chapter, verse: v })
      lastChapter = chapter
      continue
    }

    if (lastChapter !== null) {
      const onlyVerses = part.match(/^(\d+)(?:-(\d+))?$/)
      if (onlyVerses) {
        const v1 = Number(onlyVerses[1])
        const v2 = Number(onlyVerses[2] || onlyVerses[1])
        for (let v = v1; v <= v2; v += 1) refs.push({ chapter: lastChapter, verse: v })
        continue
      }
    }

    return null
  }

  return refs
}

export default function BibleReader({ toast, externalTarget }) {
  const [booksMeta, setBooksMeta] = useState([])
  const [booksTree, setBooksTree] = useState([])
  const [activeBookId, setActiveBookId] = useState('')
  const [activeChapterIndex, setActiveChapterIndex] = useState(0)
  const [highlightVerses, setHighlightVerses] = useState([])
  const [searchText, setSearchText] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [referenceText, setReferenceText] = useState('')
  const [loadingBooks, setLoadingBooks] = useState(true)
  const [viewMode, setViewMode] = useState('chapter')
  const [multiChapterView, setMultiChapterView] = useState(null)

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

    api.listBibleReaderBooks()
      .then(async (res) => {
        if (cancelled) return
        const rows = Array.isArray(res?.books) ? res.books : []
        const tree = Array.isArray(res?.tree) ? res.tree : []
        setBooksMeta(rows)
        setBooksTree(tree)
        if (!rows.length) return

        const firstAvailableBook = rows.find((book) => !!book?.has_content)
        const firstBookId = String(firstAvailableBook?.book_id || '')
        if (!firstBookId) return

        await ensureBookLoaded(firstBookId)
        if (cancelled) return
        setActiveBookId(firstBookId)
        setActiveChapterIndex(0)
      })
      .catch(() => {
        if (cancelled) return
        toast?.('تعذر تحميل بيانات الكتاب المقدس', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoadingBooks(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

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
                titleHits.push({ bookId, chapterIndex: ci, chapterNum, heading: primaryHeading, bookName: row?.name || book?.name || bookId })
              }
            }

            for (const sectionTitle of subHeadings) {
              if (!normalizeArabic(sectionTitle).includes(nQuery)) continue
              const key = `${bookId}|${chapterNum}|${sectionTitle}`
              if (!seenSections.has(key)) {
                seenSections.add(key)
                sectionHits.push({ bookId, chapterIndex: ci, chapterNum, sectionTitle, bookName: row?.name || book?.name || bookId })
              }
            }

            const verses = section?.v && typeof section.v === 'object' ? section.v : {}
            for (const [verseNumber, verseText] of Object.entries(verses)) {
              if (!normalizeArabic(verseText).includes(nQuery)) continue
              verseHits.push({
                bookId,
                chapterIndex: ci,
                chapterNum,
                verseNum: Number(verseNumber),
                verseText: String(verseText || ''),
                bookName: row?.name || book?.name || bookId,
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
      const verse = Number(ref?.verse)
      if (!chapter || !verse) continue
      if (!byChapter[chapter]) byChapter[chapter] = []
      byChapter[chapter].push(verse)
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

    const normalizedDigits = convertArabicDigitsToLatin(raw)
    const match = normalizedDigits.match(/^([^\s]+)\s+(.+)$/)
    if (!match) {
      toast?.('صيغة المرجع غير صحيحة', 'error')
      return
    }

    const token = normalizeArabic(match[1])
    const expression = match[2]
    const bookId = aliases[token] || aliases[token.replace(/\s+/g, '')]
    if (!bookId) {
      toast?.('اسم السفر غير معروف', 'error')
      return
    }

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
      <div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  const renderSectionNode = (section, depth = 0) => {
    const sectionId = String(section?.id || `section-${depth}`)
    const sectionName = String(section?.name || '—')
    const books = Array.isArray(section?.books) ? section.books : []
    const subsections = Array.isArray(section?.subsections) ? section.subsections : []

    return (
      <details key={sectionId} className={`bible-tree-section depth-${depth}`} defaultOpen={depth === 0}>
        <summary className="bible-tree-summary">{sectionName}</summary>
        <div className="bible-tree-content">
          {books.map((book) => {
            const bid = String(book?.book_id || book?.id || '')
            const hasContent = !!book?.has_content
            const isActive = hasContent && bid === activeBookId
            const label = String(book?.name || bid || '—')
            return (
              <button
                key={`${sectionId}-${bid}`}
                type="button"
                className={`bible-book-btn tree${isActive ? ' active' : ''}${!hasContent ? ' disabled' : ''}`}
                disabled={!hasContent}
                title={!hasContent ? 'غير متوفر بعد' : label}
                onClick={async () => {
                  if (!hasContent) return
                  await goToChapter(bid, 0, [])
                }}
              >
                <span>{label}</span>
                {!hasContent ? <span className="bible-book-disabled-label">غير متوفر</span> : null}
              </button>
            )
          })}
          {subsections.map((subsection) => renderSectionNode(subsection, depth + 1))}
        </div>
      </details>
    )
  }

  return (
    <div className="bible-reader">
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
            {booksTree.map((testament) => (
              <details key={String(testament?.id || '')} className="bible-tree-testament" defaultOpen>
                <summary className="bible-tree-summary testament">{String(testament?.name || '—')}</summary>
                <div className="bible-tree-content">
                  {(Array.isArray(testament?.sections) ? testament.sections : []).map((section) => renderSectionNode(section, 0))}
                </div>
              </details>
            ))}
          </div>

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
      </section>

      <section className="card bible-main">
        <div className="bible-main-header">
          <div className="bible-main-title">
            {activeBook?.name || booksMetaById[activeBookId]?.name || '—'}
          </div>
          {activeChapter ? (
            <div style={{ fontSize: '0.84rem', color: 'var(--gray-500)' }}>
              الفصل {toArabicDigits(activeChapter?.n)}
            </div>
          ) : null}
        </div>

        <div className="bible-main-body">
          {viewMode === 'search' && searchResult ? (
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
                          onClick={() => goToChapter(hit.bookId, hit.chapterIndex, [hit.verseNum])}
                        >
                          <div className="bible-result-ref">
                            {hit.bookName} • الفصل {toArabicDigits(hit.chapterNum)} • الآية {toArabicDigits(hit.verseNum)}
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
                        .filter(([verse]) => (multiChapterView.byChapter[chapterNumber] || []).includes(Number(verse)))

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
                        const isHighlighted = highlightVerses.includes(Number(verseNumber))
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
