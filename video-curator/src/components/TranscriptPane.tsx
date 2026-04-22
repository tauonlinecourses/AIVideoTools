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

export const TranscriptPane = forwardRef<TranscriptPaneHandle, TranscriptPaneProps>(
  function TranscriptPane({ onSeek, className }, ref) {
    const srtItems = useStore(s => s.srtItems)
    const isRTL = useStore(s => s.isRTL)
    const sections = useStore(s => s.sections)
    const videoDuration = useStore(s => s.videoDuration)
    const currentTime = useStore(s => s.currentTime)
    const toggleSection = useStore(s => s.toggleSection)
    const moveSentenceUp = useStore(s => s.moveSentenceUp)
    const moveSentenceDown = useStore(s => s.moveSentenceDown)

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

    return (
      <section
        className={cx('flex h-full flex-col bg-white', className)}
      >
        <div className="px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Transcript</div>
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

              const muted = meta ? !meta.isEnabled : false

              const showSectionHeader = Boolean(meta && !isSameSectionAsPrev)
              const showUp = Boolean(
                meta?.isFirstInSection && meta.sectionIndex > 0 && meta.sectionItemCount > 1
              )
              const showDown = Boolean(
                meta?.isLastInSection && meta.sectionIndex < meta.sectionCount - 1 && meta.sectionItemCount > 1
              )

              const timestamp = formatMMSS(item.startTime)

              const activeStyle: React.CSSProperties | undefined =
                isActive && meta
                  ? { backgroundColor: `${meta.color}1A` } // ~10% alpha
                  : isActive
                    ? { backgroundColor: 'rgba(156, 163, 175, 0.10)' }
                    : undefined

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
                        muted ? 'opacity-40' : ''
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
                            <div className="py-3" />
                          </>
                        ) : (
                          <>
                            <div className="py-3" />
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
                      muted ? 'opacity-40' : ''
                    )}
                    style={activeStyle}
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
                              className={cx('text-sm text-gray-900', isHebrew ? 'text-right' : 'text-left')}
                              dir={isHebrew ? 'rtl' : 'ltr'}
                            >
                              {item.text}
                            </div>
                          </div>
                          <div className="flex items-start justify-end gap-2 py-3 text-xs text-gray-500">
                            {meta && showUp ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  moveSentenceUp(meta.sectionId, 0)
                                }}
                                className={[
                                  'inline-flex h-7 w-7 items-center justify-center',
                                  'bg-transparent text-[18px] font-black leading-none text-gray-900',
                                  'transition-transform duration-150 ease-out hover:scale-125 hover:text-black',
                                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                                ].join(' ')}
                                aria-label="Move section boundary up"
                                title="Move to previous section"
                              >
                                ↑
                              </button>
                            ) : null}
                            {meta && showDown ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  moveSentenceDown(meta.sectionId, meta.sectionItemCount - 1)
                                }}
                                className={[
                                  'inline-flex h-7 w-7 items-center justify-center',
                                  'bg-transparent text-[18px] font-black leading-none text-gray-900',
                                  'transition-transform duration-150 ease-out hover:scale-125 hover:text-black',
                                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                                ].join(' ')}
                                aria-label="Move section boundary down"
                                title="Move to next section"
                              >
                                ↓
                              </button>
                            ) : null}
                            <span className="pt-[5px]">{timestamp}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start justify-start gap-2 py-3 text-xs text-gray-500">
                            <span className="pt-[5px]">{timestamp}</span>
                            {meta && showUp ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  moveSentenceUp(meta.sectionId, 0)
                                }}
                                className={[
                                  'inline-flex h-7 w-7 items-center justify-center',
                                  'bg-transparent text-[18px] font-black leading-none text-gray-900',
                                  'transition-transform duration-150 ease-out hover:scale-125 hover:text-black',
                                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                                ].join(' ')}
                                aria-label="Move section boundary up"
                                title="Move to previous section"
                              >
                                ↑
                              </button>
                            ) : null}
                            {meta && showDown ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  moveSentenceDown(meta.sectionId, meta.sectionItemCount - 1)
                                }}
                                className={[
                                  'inline-flex h-7 w-7 items-center justify-center',
                                  'bg-transparent text-[18px] font-black leading-none text-gray-900',
                                  'transition-transform duration-150 ease-out hover:scale-125 hover:text-black',
                                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                                ].join(' ')}
                                aria-label="Move section boundary down"
                                title="Move to next section"
                              >
                                ↓
                              </button>
                            ) : null}
                          </div>
                          <div
                            className="min-w-0 h-full px-3 py-3"
                          >
                            <div
                              className={cx('text-sm text-gray-900', isHebrew ? 'text-right' : 'text-left')}
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

