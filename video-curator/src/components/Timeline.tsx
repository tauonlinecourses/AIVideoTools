import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Section } from '../lib/store'

export interface TimelineProps {
  onSeek: (time: number) => void
  onSectionClick: (sectionId: number) => void
  className?: string
}

type SectionBlock = {
  id: number
  title: string
  color: string
  isEnabled: boolean
  startTime: number
  endTime: number
  duration: number
  widthPct: number
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.min(1, Math.max(0, x))
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

function sectionStartEnd(
  section: Section,
  opts: { isFirst: boolean; isLast: boolean; videoDuration: number }
): { start: number; end: number } {
  if (!section.items || section.items.length === 0) return { start: 0, end: 0 }
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const it of section.items) {
    if (!it) continue
    if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
    if (Number.isFinite(it.endTime)) maxEnd = Math.max(maxEnd, it.endTime)
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return { start: 0, end: 0 }

  const safeVideoDuration =
    Number.isFinite(opts.videoDuration) && opts.videoDuration > 0 ? opts.videoDuration : null

  const start = opts.isFirst ? 0 : minStart
  const end = opts.isLast && safeVideoDuration != null ? safeVideoDuration : maxEnd

  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, end: 0 }
  if (end <= start) return { start: 0, end: 0 }
  return { start, end }
}

export function Timeline({ onSeek, onSectionClick, className }: TimelineProps) {
  const sections = useStore(s => s.sections)
  const videoDuration = useStore(s => s.videoDuration)
  const timelinePosterUrl = useStore(s => s.timelinePosterUrl)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrubberRef = useRef<HTMLDivElement | null>(null)

  const [containerWidthPx, setContainerWidthPx] = useState(0)

  const { blocks, totalDuration } = useMemo(() => {
    if (sections.length === 0) {
      return { blocks: [] as SectionBlock[], totalDuration: videoDuration }
    }
    const durations = sections.map((s, idx) => {
      const { start, end } = sectionStartEnd(s, {
        isFirst: idx === 0,
        isLast: idx === sections.length - 1,
        videoDuration,
      })
      return Math.max(0, end - start)
    })
    const total = durations.reduce((acc, d) => acc + d, 0)
    const blocks: SectionBlock[] = sections.map((s, idx) => {
      const { start, end } = sectionStartEnd(s, {
        isFirst: idx === 0,
        isLast: idx === sections.length - 1,
        videoDuration,
      })
      const duration = Math.max(0, end - start)
      const widthPct = total > 0 ? (duration / total) * 100 : 0
      return {
        id: s.id,
        title: s.title,
        color: s.color,
        isEnabled: s.isEnabled,
        startTime: start,
        endTime: end,
        duration,
        widthPct,
      }
    })

    // Avoid accumulating floating error leaving a visible gap at the end.
    if (blocks.length > 0 && total > 0) {
      const sum = blocks.reduce((acc, b) => acc + b.widthPct, 0)
      const diff = 100 - sum
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], widthPct: blocks[blocks.length - 1].widthPct + diff }
    }

    return { blocks, totalDuration: total }
  }, [sections, videoDuration])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerWidthPx(entry.contentRect.width)
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let rafId = 0

    const tick = () => {
      const scrubber = scrubberRef.current
      if (scrubber) {
        const { currentTime } = useStore.getState()
        const pct = totalDuration > 0 ? clamp01(currentTime / totalDuration) * 100 : 0
        scrubber.style.left = `${pct}%`
      }
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [totalDuration])

  const onBackgroundClick = (e: React.MouseEvent) => {
    const el = containerRef.current
    if (!el) return
    if (totalDuration <= 0) return

    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = clamp01(rect.width > 0 ? x / rect.width : 0)
    onSeek(pct * totalDuration)
  }

  return (
    <div
      ref={containerRef}
      className={[
        'relative h-12 w-full overflow-visible border border-gray-200 bg-white',
        'rounded-[3px]',
        className ?? '',
      ].join(' ')}
      onClick={onBackgroundClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        // Keyboard interaction uses center seek
        if (totalDuration > 0) onSeek(totalDuration * 0.5)
      }}
      aria-label="Timeline"
    >
      {sections.length === 0 ? (
        <div
          className="absolute inset-0 rounded-[3px]"
          style={
            timelinePosterUrl
              ? {
                  backgroundImage: [
                    `url("${timelinePosterUrl}")`,
                    // vertical separators between thumbnails
                    'repeating-linear-gradient(90deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 72px)',
                    // subtle top/bottom edge lines like editors
                    'linear-gradient(to bottom, rgba(0,0,0,0.10), rgba(0,0,0,0) 12px, rgba(0,0,0,0) 36px, rgba(0,0,0,0.10))',
                  ].join(', '),
                  backgroundRepeat: 'repeat-x, repeat-x, no-repeat',
                  backgroundPosition: 'left center, left center, left center',
                  backgroundSize: '72px 48px, 72px 48px, 100% 100%',
                  filter: 'brightness(1.02) contrast(1.05)',
                }
              : undefined
          }
          aria-hidden="true"
        />
      ) : null}

      <div
        className={[
          'relative flex h-full w-full gap-[1px]',
          sections.length === 0 ? 'bg-transparent' : 'bg-white',
        ].join(' ')}
      >
        {sections.length === 0 ? (
          <div className="flex h-full w-full items-center justify-end px-3 text-xs text-gray-700">
            {totalDuration > 0 ? (
              <div className="font-mono text-gray-600">{formatMMSS(totalDuration)}</div>
            ) : null}
          </div>
        ) : (
          blocks.map((b, idx) => {
            const blockWidthPx = containerWidthPx > 0 ? (b.widthPct / 100) * containerWidthPx : 0
            const canShowTitle = blockWidthPx > 80
            const tooltip = `${b.title} • ${formatMMSSFloor(b.duration)}`
            const isLast = idx === blocks.length - 1

            return (
              <button
                key={b.id}
                type="button"
                className={[
                  'relative h-full flex-none min-w-0',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                  !b.isEnabled ? 'opacity-40' : '',
                ].join(' ')}
                style={{ width: `${b.widthPct}%`, backgroundColor: b.color }}
                title={canShowTitle ? undefined : tooltip}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onSectionClick(b.id)
                  onSeek(b.startTime)
                }}
                aria-label={tooltip}
              >
                {!b.isEnabled ? (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: `repeating-linear-gradient(
                        45deg,
                        rgba(0,0,0,0.15) 0px,
                        rgba(0,0,0,0.15) 4px,
                        transparent 4px,
                        transparent 10px
                      )`,
                    }}
                  />
                ) : null}

                {canShowTitle ? (
                  <div className={['flex h-full items-center justify-end px-2', isLast ? 'pr-4' : ''].join(' ')}>
                    <div
                      className="min-w-0 truncate text-[11px] font-medium text-white text-right"
                      style={{ direction: 'rtl' }}
                    >
                      <span dir="ltr">{b.title}</span>
                    </div>
                  </div>
                ) : null}
              </button>
            )
          })
        )}
      </div>

      <div
        ref={scrubberRef}
        className="pointer-events-none absolute top-0 h-full w-[3px] bg-black"
        style={{ left: '0%' }}
        aria-hidden="true"
      >
        <div
          className={[
            'absolute left-1/2 -translate-x-1/2 -ml-[0.1px]',
            '-top-[7px]',
            'w-0 h-0',
            'border-l-[6px] border-l-transparent',
            'border-r-[6px] border-r-transparent',
            'border-t-[8px] border-t-black',
          ].join(' ')}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

