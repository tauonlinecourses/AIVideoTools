import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import { useStore, type Section } from '../lib/store'
import type { SrtItem } from '../lib/parseSrt'

export type TranscriptPaneHandle = {
  scrollToSentence: (index: number) => void
}

export interface TranscriptPaneProps {
  onSeek: (time: number) => void
  className?: string
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function formatMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00'
  const rounded = Math.max(0, Math.round(totalSeconds))
  const mm = Math.floor(rounded / 60)
  const ss = rounded % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function formatMMSSFloor(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00'
  const floored = Math.max(0, Math.floor(totalSeconds))
  const mm = Math.floor(floored / 60)
  const ss = floored % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function sectionDurationSeconds(
  section: Section,
  opts: { isFirst: boolean; isLast: boolean; videoDuration: number }
): number {
  if (!section.items || section.items.length === 0) return 0
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const it of section.items) {
    if (!it) continue
    if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
    if (Number.isFinite(it.endTime)) maxEnd = Math.max(maxEnd, it.endTime)
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return 0

  const safeVideoDuration =
    Number.isFinite(opts.videoDuration) && opts.videoDuration > 0 ? opts.videoDuration : null

  const start = opts.isFirst ? 0 : minStart
  const end = opts.isLast && safeVideoDuration != null ? safeVideoDuration : maxEnd
  return Math.max(0, end - start)
}

type SentenceMeta = {
  sectionId: number
  title: string
  color: string
  isEnabled: boolean
  posInSection: number
  sectionItemCount: number
  isFirstInSection: boolean
  isLastInSection: boolean
  sectionIndex: number
  sectionCount: number
  sectionDurationLabel: string
}

function findActiveIndex(items: SrtItem[], currentTime: number): number | null {
  if (items.length === 0) return null
  if (!Number.isFinite(currentTime) || currentTime < 0) return null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (currentTime >= it.startTime && currentTime <= it.endTime) return it.index
  }
  return null
}

function isHebrewText(text: string): boolean {
  // Hebrew + common RTL marks; keeps it simple and fast for per-row rendering.
  return /[\u0590-\u05FF\u200F]/.test(text)
}

function isWithinRange(index: number, range: { start: number; end: number } | null): boolean {
  if (!range) return false
  const a = Math.min(range.start, range.end)
  const b = Math.max(range.start, range.end)
  return index >= a && index <= b
}

export const TranscriptPane = forwardRef<TranscriptPaneHandle, TranscriptPaneProps>(
  function TranscriptPane({ onSeek, className }, ref) {
    const srtItems = useStore(s => s.srtItems)
    const isRTL = useStore(s => s.isRTL)
    const sections = useStore(s => s.sections)
    const videoDuration = useStore(s => s.videoDuration)
    const currentTime = useStore(s => s.currentTime)
    const toggleSection = useStore(s => s.toggleSection)
    const selectedSectionId = useStore(s => s.selectedSectionId)
    const selectedRange = useStore(s => s.selectedRange)
    const hiddenSentenceByIndex = useStore(s => s.hiddenSentenceByIndex)
    const setSelectedIndex = useStore(s => s.setSelectedIndex)
    const setSelectedSectionId = useStore(s => s.setSelectedSectionId)
    const clearSelection = useStore(s => s.clearSelection)
    const hideSelectedSentences = useStore(s => s.hideSelectedSentences)
    const unhideSelectedSentences = useStore(s => s.unhideSelectedSentences)
    const moveSelectionToPrevSection = useStore(s => s.moveSelectionToPrevSection)
    const moveSelectionToNextSection = useStore(s => s.moveSelectionToNextSection)
    const createSectionFromSelection = useStore(s => s.createSectionFromSelection)
    const removeSelectedSection = useStore(s => s.removeSelectedSection)

    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const isUserScrollingRef = useRef(false)
    const scrollingTimeoutRef = useRef<number | null>(null)

    const activeIndex = useMemo(() => findActiveIndex(srtItems, currentTime), [srtItems, currentTime])

    const sentenceMetaByIndex = useMemo(() => {
      const map = new Map<number, SentenceMeta>()
      const sectionCount = sections.length

      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const section = sections[sectionIndex]
        const durationLabel = formatMMSSFloor(sectionDurationSeconds(section, {
          isFirst: sectionIndex === 0,
          isLast: sectionIndex === sections.length - 1,
          videoDuration,
        }))

        for (let posInSection = 0; posInSection < section.items.length; posInSection++) {
          const item = section.items[posInSection]
          map.set(item.index, {
            sectionId: section.id,
            title: section.title,
            color: section.color,
            isEnabled: section.isEnabled,
            posInSection,
            sectionItemCount: section.items.length,
            isFirstInSection: posInSection === 0,
            isLastInSection: posInSection === section.items.length - 1,
            sectionIndex,
            sectionCount,
            sectionDurationLabel: durationLabel,
          })
        }
      }

      return map
    }, [sections, videoDuration])

    const scrollToSentence = useCallback((index: number) => {
      const container = scrollContainerRef.current
      if (!container) return
      const el = container.querySelector<HTMLElement>(`[data-sentence-index="${index}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [])

    useImperativeHandle(ref, () => ({ scrollToSentence }), [scrollToSentence])

    const prevAutoScrolledIndexRef = useRef<number | null>(null)
    useEffect(() => {
      if (activeIndex == null) return
      if (prevAutoScrolledIndexRef.current === activeIndex) return
      prevAutoScrolledIndexRef.current = activeIndex
      if (isUserScrollingRef.current) return
      scrollToSentence(activeIndex)
    }, [activeIndex, scrollToSentence])

    const onScroll = useCallback(() => {
      isUserScrollingRef.current = true
      if (scrollingTimeoutRef.current) {
        window.clearTimeout(scrollingTimeoutRef.current)
      }
      scrollingTimeoutRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false
      }, 2000)
    }, [])

    useEffect(() => {
      return () => {
        if (scrollingTimeoutRef.current) window.clearTimeout(scrollingTimeoutRef.current)
      }
    }, [])

    if (srtItems.length === 0) {
      return (
        <section className={cx('flex h-full flex-col bg-white', className)}>
          <div className="px-4 py-3">
            <div className="text-sm font-semibold text-gray-900">Transcript</div>
          </div>
          <div className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-gray-500">
            Upload a transcript to see it here
          </div>
        </section>
      )
    }

    const selectionStart = selectedRange ? Math.min(selectedRange.start, selectedRange.end) : null
    const selectionEnd = selectedRange ? Math.max(selectedRange.start, selectedRange.end) : null
    const selectedCount =
      selectionStart == null || selectionEnd == null ? 0 : Math.max(0, selectionEnd - selectionStart + 1)

    const selectionAllHidden = (() => {
      if (selectionStart == null || selectionEnd == null) return false
      if (selectionEnd < selectionStart) return false
      for (let i = selectionStart; i <= selectionEnd; i++) {
        if (!hiddenSentenceByIndex[i]) return false
      }
      return true
    })()

    const selectionMetaStart = selectionStart == null ? null : (sentenceMetaByIndex.get(selectionStart) ?? null)
    const selectionMetaEnd = selectionEnd == null ? null : (sentenceMetaByIndex.get(selectionEnd) ?? null)
    const selectionWithinOneSection =
      Boolean(selectionMetaStart && selectionMetaEnd && selectionMetaStart.sectionId === selectionMetaEnd.sectionId)

    const canMovePrev =
      selectedCount > 0 && selectionWithinOneSection && (selectionMetaStart?.sectionIndex ?? 0) > 0
    const canMoveNext =
      selectedCount > 0 &&
      selectionWithinOneSection &&
      (selectionMetaStart?.sectionIndex ?? 0) < (selectionMetaStart?.sectionCount ?? 0) - 1
    const canCreate = selectedCount > 0 && selectionWithinOneSection
    const canRemove = selectedSectionId != null && sections.length > 1

    return (
      <section
        className={cx('flex h-full flex-col bg-white', className)}
      >
        <div className="px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Transcript</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-2 py-1.5">
            <div className="text-xs text-gray-700">
              <span className="font-semibold text-gray-900">Selected:</span>{' '}
              <span className="tabular-nums">{selectedCount}</span>
              {!selectedRange ? null : !selectionWithinOneSection ? (
                <span className="ml-2 text-gray-500">(selection must be within one section)</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canMovePrev}
                onClick={() => moveSelectionToPrevSection()}
                className={cx(
                  'border px-2 py-1 text-xs font-semibold',
                  canMovePrev ? 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500'
                )}
                title={canMovePrev ? 'Move selected sentences to previous section' : 'Select sentences within a non-first section'}
              >
                Move prev
              </button>
              <button
                type="button"
                disabled={!canMoveNext}
                onClick={() => moveSelectionToNextSection()}
                className={cx(
                  'border px-2 py-1 text-xs font-semibold',
                  canMoveNext ? 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500'
                )}
                title={canMoveNext ? 'Move selected sentences to next section' : 'Select sentences within a non-last section'}
              >
                Move next
              </button>
              <button
                type="button"
                disabled={!canCreate}
                onClick={() => createSectionFromSelection()}
                className={cx(
                  'border px-2 py-1 text-xs font-semibold',
                  canCreate ? 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500'
                )}
                title={canCreate ? 'Create a new section from the selected sentences' : 'Select sentences within one section'}
              >
                Create section
              </button>
              <button
                type="button"
                disabled={!canRemove}
                onClick={() => removeSelectedSection()}
                className={cx(
                  'border px-2 py-1 text-xs font-semibold',
                  canRemove ? 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500'
                )}
                title={canRemove ? 'Remove the selected section (merges into neighbor)' : 'Select a section checkbox to remove it'}
              >
                Remove section
              </button>
              <button
                type="button"
                disabled={selectedCount <= 0}
                onClick={() => {
                  if (selectedCount <= 0) return
                  if (selectionAllHidden) unhideSelectedSentences()
                  else hideSelectedSentences()
                }}
                className={cx(
                  'border px-2 py-1 text-xs font-semibold',
                  selectedCount > 0 ? 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500'
                )}
                title={selectedCount > 0 ? (selectionAllHidden ? 'Unhide selected sentences' : 'Hide selected sentences') : 'Select sentences to hide/unhide'}
              >
                {selectionAllHidden ? 'Unhide' : 'Hide'}
              </button>
              <button
                type="button"
                disabled={!selectedRange && selectedSectionId == null}
                onClick={() => clearSelection()}
                className={cx(
                  'border px-2 py-1 text-xs font-semibold',
                  selectedRange || selectedSectionId != null ? 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50' : 'border-gray-200 bg-gray-50 text-gray-500'
                )}
                title="Clear selection"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          dir={isRTL ? 'rtl' : 'ltr'}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto"
        >
          <div>
            {srtItems.map((item, rowIdx) => {
              const meta = sentenceMetaByIndex.get(item.index) ?? null
              const prevItem = rowIdx > 0 ? srtItems[rowIdx - 1] : null
              const prevMeta = prevItem ? (sentenceMetaByIndex.get(prevItem.index) ?? null) : null
              const nextItem = rowIdx < srtItems.length - 1 ? srtItems[rowIdx + 1] : null
              const nextMeta = nextItem ? (sentenceMetaByIndex.get(nextItem.index) ?? null) : null
              const isSameSectionAsPrev =
                meta !== null && prevMeta !== null && meta.sectionId === prevMeta.sectionId
              const isSameSectionAsNext =
                meta !== null && nextMeta !== null && meta.sectionId === nextMeta.sectionId
              const rowGapClass = rowIdx > 0 && !isSameSectionAsPrev ? 'mt-6' : ''
              const isActive = activeIndex === item.index
              const isHebrew = isHebrewText(item.text)

              const borderColor = meta?.color ?? '#D1D5DB' // gray-300

              const isHidden = Boolean(hiddenSentenceByIndex[item.index])
              const mutedSection = meta ? !meta.isEnabled : false
              const mutedRow = mutedSection || isHidden

              const showSectionHeader = Boolean(meta && !isSameSectionAsPrev)
              const isSectionSelected = meta ? selectedSectionId === meta.sectionId : false

              const timestamp = formatMMSS(item.startTime)

              const isSelected = isWithinRange(item.index, selectedRange)

              const rowStyle: React.CSSProperties | undefined = (() => {
                if (isSelected && isActive && meta) return { backgroundColor: `${meta.color}26` } // ~15% alpha
                if (isSelected && isActive) return { backgroundColor: 'rgba(156, 163, 175, 0.16)' }
                if (isSelected) return { backgroundColor: 'rgba(0, 0, 0, 0.06)' }
                if (isActive && meta) return { backgroundColor: `${meta.color}1A` } // ~10% alpha
                if (isActive) return { backgroundColor: 'rgba(156, 163, 175, 0.10)' }
                return undefined
              })()

              const spineRadiusClass =
                (!isSameSectionAsPrev && !isSameSectionAsNext) || (!showSectionHeader && !isSameSectionAsPrev && !isSameSectionAsNext)
                  ? 'rounded-[6px]'
                  : !isSameSectionAsPrev && !showSectionHeader
                    ? 'rounded-t-[6px]'
                    : !isSameSectionAsNext
                      ? 'rounded-b-[6px]'
                      : ''

              return (
                <div
                  key={item.index}
                  data-sentence-index={item.index}
                  className={cx('group relative', rowGapClass)}
                >
                  {meta && showSectionHeader ? (
                    <div
                      className={cx(
                        'pb-0',
                        isRTL ? 'pl-4 pr-0' : 'pl-0 pr-4',
                        mutedSection ? 'opacity-40' : ''
                      )}
                    >
                      <div
                        className={cx('relative', isRTL ? 'pr-5' : 'pl-5')}
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            'absolute top-0 bottom-0 w-1.5 rounded-t-[6px]',
                            isRTL ? 'right-0' : 'left-0'
                          )}
                          style={{ backgroundColor: borderColor }}
                        />
                        <div
                          className={cx(
                            'grid items-stretch gap-3',
                            isRTL ? 'grid-cols-[1fr_80px]' : 'grid-cols-[80px_1fr]'
                          )}
                        >
                        {isRTL ? (
                          <>
                            <div className="min-w-0 h-full px-3 pt-1 pb-0">
                              <div
                                className={cx(
                                  'flex items-center gap-2 text-right',
                                  // In RTL, "end" is the left side; use start to keep the header anchored to the right edge.
                                  isRTL ? 'justify-start' : 'justify-end'
                                )}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold text-gray-900 text-right">
                                    {meta.title}
                                  </div>
                                </div>
                                <div className="shrink-0 inline-flex items-center gap-1 text-xs text-gray-500" dir="ltr">
                                  <button
                                    type="button"
                                    className={[
                                      'inline-flex h-7 w-7 items-center justify-center',
                                      'bg-transparent text-gray-900',
                                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                                    ].join(' ')}
                                    aria-label={meta.isEnabled ? 'Hide section from video' : 'Show section in video'}
                                    title={meta.isEnabled ? 'Disable section' : 'Enable section'}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      toggleSection(meta.sectionId)
                                    }}
                                  >
                                    {meta.isEnabled ? (
                                      <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    ) : (
                                      <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M9.88 5.09A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.3 4.38"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M6.61 6.61A18.2 18.2 0 0 0 2 12s3.5 7 10 7c1.25 0 2.42-.2 3.5-.55"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M2 2l20 20"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                  <span className="text-right">{meta.sectionDurationLabel}</span>
                                </div>
                              </div>
                              <div className="mt-1 h-px bg-gray-100" />
                            </div>
                            <div className="flex items-start justify-end gap-2 py-3 text-xs text-gray-500">
                              <input
                                type="checkbox"
                                checked={isSectionSelected}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  setSelectedSectionId(e.target.checked ? meta.sectionId : null)
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-[3px] h-4 w-4 border border-gray-400 bg-white"
                                aria-label="Select section"
                                title="Select section"
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-start justify-start gap-2 py-3 text-xs text-gray-500">
                              <input
                                type="checkbox"
                                checked={isSectionSelected}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  setSelectedSectionId(e.target.checked ? meta.sectionId : null)
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-[3px] h-4 w-4 border border-gray-400 bg-white"
                                aria-label="Select section"
                                title="Select section"
                              />
                            </div>
                            <div className="min-w-0 h-full px-3 pt-1 pb-0">
                              <div className="flex items-center justify-end gap-2 text-right">
                                <div className="shrink-0 inline-flex items-center gap-1 text-xs text-gray-500" dir="ltr">
                                  <button
                                    type="button"
                                    className={[
                                      'inline-flex h-7 w-7 items-center justify-center',
                                      'bg-transparent text-gray-900',
                                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                                    ].join(' ')}
                                    aria-label={meta.isEnabled ? 'Hide section from video' : 'Show section in video'}
                                    title={meta.isEnabled ? 'Disable section' : 'Enable section'}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      toggleSection(meta.sectionId)
                                    }}
                                  >
                                    {meta.isEnabled ? (
                                      <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    ) : (
                                      <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M9.88 5.09A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.3 4.38"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M6.61 6.61A18.2 18.2 0 0 0 2 12s3.5 7 10 7c1.25 0 2.42-.2 3.5-.55"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M2 2l20 20"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    )}
                                  </button>
                                  <span className="text-right">{meta.sectionDurationLabel}</span>
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold text-gray-900 text-right">
                                    {meta.title}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-1 h-px bg-gray-100" />
                            </div>
                          </>
                        )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSeek(item.startTime)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSeek(item.startTime)
                      }
                    }}
                    className={cx(
                      'w-full text-left',
                      isRTL ? 'pl-4 pr-0 py-0' : 'pl-0 pr-4 py-0',
                      'transition-colors hover:bg-gray-50',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                      mutedRow ? 'opacity-40' : ''
                    )}
                    style={rowStyle}
                  >
                    <div
                      className={cx(
                        'relative',
                        isRTL ? 'pr-5' : 'pl-5'
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          'absolute top-0 bottom-0 w-1.5',
                          spineRadiusClass,
                          isRTL ? 'right-0' : 'left-0'
                        )}
                        style={{ backgroundColor: borderColor }}
                      />
                      <div
                        className={cx(
                          'grid items-stretch gap-3',
                          isRTL ? 'grid-cols-[1fr_80px]' : 'grid-cols-[80px_1fr]'
                        )}
                      >
                      {isRTL ? (
                        <>
                          <div
                            className="min-w-0 h-full px-3 py-3"
                          >
                            <div
                              className={cx(
                                'text-sm text-gray-900',
                                isHebrew ? 'text-right' : 'text-left',
                                isHidden ? 'line-through' : ''
                              )}
                              dir={isHebrew ? 'rtl' : 'ltr'}
                            >
                              {item.text}
                            </div>
                          </div>
                          <div className="flex items-start justify-end gap-2 py-3 text-xs text-gray-500">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => setSelectedIndex(item.index, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-[3px] h-4 w-4 border border-gray-400 bg-white"
                              aria-label="Select sentence"
                              title="Select sentence"
                            />
                            <span className="pt-[5px]">{timestamp}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start justify-start gap-2 py-3 text-xs text-gray-500">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => setSelectedIndex(item.index, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-[3px] h-4 w-4 border border-gray-400 bg-white"
                              aria-label="Select sentence"
                              title="Select sentence"
                            />
                            <span className="pt-[5px]">{timestamp}</span>
                          </div>
                          <div
                            className="min-w-0 h-full px-3 py-3"
                          >
                            <div
                              className={cx(
                                'text-sm text-gray-900',
                                isHebrew ? 'text-right' : 'text-left',
                                isHidden ? 'line-through' : ''
                              )}
                              dir={isHebrew ? 'rtl' : 'ltr'}
                            >
                              {item.text}
                            </div>
                          </div>
                        </>
                      )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }
)

