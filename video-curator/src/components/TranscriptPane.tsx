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

function sectionDurationSeconds(section: Section): number {
  const first = section.items[0]
  const last = section.items[section.items.length - 1]
  if (!first || !last) return 0
  return Math.max(0, last.endTime - first.startTime)
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

export const TranscriptPane = forwardRef<TranscriptPaneHandle, TranscriptPaneProps>(
  function TranscriptPane({ onSeek, className }, ref) {
    const srtItems = useStore(s => s.srtItems)
    const isRTL = useStore(s => s.isRTL)
    const sections = useStore(s => s.sections)
    const currentTime = useStore(s => s.currentTime)
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
        const durationLabel = formatMMSS(sectionDurationSeconds(section))

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
    }, [sections])

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
        <section className={cx('flex h-full flex-col border border-gray-200 bg-white', className)}>
          <div className="border-b border-gray-200 px-4 py-3">
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
        className={cx('flex h-full flex-col border border-gray-200 bg-white', className)}
      >
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Transcript</div>
        </div>

        <div
          ref={scrollContainerRef}
          dir={isRTL ? 'rtl' : 'ltr'}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto"
        >
          <div className="divide-y divide-gray-100">
            {srtItems.map((item) => {
              const meta = sentenceMetaByIndex.get(item.index) ?? null
              const isActive = activeIndex === item.index

              const borderColor = meta?.color ?? '#D1D5DB' // gray-300
              const borderSideClass = isRTL ? 'border-r-4' : 'border-l-4'

              const muted = meta ? !meta.isEnabled : false

              const showSectionLabel = Boolean(meta?.isFirstInSection)
              const showUp = Boolean(
                meta?.isFirstInSection && meta.sectionIndex > 0 && meta.sectionItemCount > 1
              )
              const showDown = Boolean(
                meta?.isLastInSection && meta.sectionIndex < meta.sectionCount - 1 && meta.sectionItemCount > 1
              )

              const marginLabel = showSectionLabel && meta ? (
                <div
                  className={cx(
                    'min-w-0 text-xs font-medium text-gray-600',
                    muted ? 'opacity-40' : ''
                  )}
                >
                  <div className="truncate">{meta.title}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {meta.sectionDurationLabel}
                  </div>
                </div>
              ) : (
                <div />
              )

              const timestamp = formatMMSS(item.startTime)

              const activeStyle: React.CSSProperties | undefined =
                isActive && meta
                  ? { backgroundColor: `${meta.color}1A` } // ~10% alpha
                  : isActive
                    ? { backgroundColor: 'rgba(156, 163, 175, 0.10)' }
                    : undefined

              return (
                <div
                  key={item.index}
                  data-sentence-index={item.index}
                  className={cx('group relative')}
                >
                  <button
                    type="button"
                    onClick={() => onSeek(item.startTime)}
                    className={cx(
                      'w-full text-left',
                      'px-4 py-3',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                      muted ? 'opacity-40' : ''
                    )}
                    style={activeStyle}
                  >
                    <div
                      className={cx(
                        'grid items-start gap-3',
                        isRTL ? 'grid-cols-[1fr_112px_80px]' : 'grid-cols-[80px_112px_1fr]'
                      )}
                    >
                      {isRTL ? (
                        <>
                          <div
                            className={cx('min-w-0', borderSideClass)}
                            style={isRTL ? { borderRightColor: borderColor } : { borderLeftColor: borderColor }}
                          >
                            <div className="px-3 py-0">
                              <div className="text-sm text-gray-900">{item.text}</div>
                            </div>
                          </div>
                          <div className={cx('w-28 shrink-0', muted ? 'opacity-40' : '')}>
                            {showSectionLabel ? marginLabel : null}
                          </div>
                          <div className="flex items-start justify-end text-xs text-gray-500">
                            {timestamp}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start justify-start text-xs text-gray-500">
                            {timestamp}
                          </div>
                          <div className={cx('w-28 shrink-0', muted ? 'opacity-40' : '')}>
                            {showSectionLabel ? marginLabel : null}
                          </div>
                          <div
                            className={cx('min-w-0', borderSideClass)}
                            style={isRTL ? { borderRightColor: borderColor } : { borderLeftColor: borderColor }}
                          >
                            <div className="px-3 py-0">
                              <div className="text-sm text-gray-900">{item.text}</div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </button>

                  {meta ? (
                    <div
                      className={cx(
                        'pointer-events-none absolute top-2',
                        isRTL ? 'left-3' : 'right-3'
                      )}
                    >
                      <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {showUp ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              moveSentenceUp(meta.sectionId, 0)
                            }}
                            className={[
                              'pointer-events-auto inline-flex h-4 w-4 items-center justify-center',
                              'text-gray-400 hover:text-gray-700',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                            ].join(' ')}
                            aria-label="Move section boundary up"
                            title="Move to previous section"
                          >
                            ↑
                          </button>
                        ) : null}
                        {showDown ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              moveSentenceDown(meta.sectionId, meta.sectionItemCount - 1)
                            }}
                            className={[
                              'pointer-events-auto inline-flex h-4 w-4 items-center justify-center',
                              'text-gray-400 hover:text-gray-700',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                            ].join(' ')}
                            aria-label="Move section boundary down"
                            title="Move to next section"
                          >
                            ↓
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }
)

