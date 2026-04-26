import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Section } from '../lib/store'
import { exportSrt } from '../lib/exportSrt'
import { exportVideo } from '../lib/exportVideo'

function formatMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00'
  const rounded = Math.max(0, Math.round(totalSeconds))
  const mm = Math.floor(rounded / 60)
  const ss = rounded % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function sectionStartTimeSeconds(section: Section): number | null {
  if (!section.items || section.items.length === 0) return null
  let minStart = Number.POSITIVE_INFINITY
  for (const it of section.items) {
    if (!it) continue
    if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
  }
  if (!Number.isFinite(minStart)) return null
  return minStart
}

export interface SectionManagerProps {
  onSeek: (time: number) => void
}

export function SectionManager({ onSeek }: SectionManagerProps) {
  const sections = useStore(s => s.sections)
  const videoFile = useStore(s => s.videoFile)
  const videoDuration = useStore(s => s.videoDuration)
  const toggleSection = useStore(s => s.toggleSection)
  const renameSection = useStore(s => s.renameSection)

  const [editingSectionId, setEditingSectionId] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)

  const editingOriginalTitle = useMemo(() => {
    if (editingSectionId == null) return null
    return sections.find(s => s.id === editingSectionId)?.title ?? null
  }, [editingSectionId, sections])

  useEffect(() => {
    if (editingSectionId == null) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editingSectionId])

  const durations = useMemo(() => {
    const map = new Map<number, string>()
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]
      const isFirst = i === 0
      const isLast = i === sections.length - 1
      const safeVideoDuration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : null

      if (!s.items || s.items.length === 0) {
        map.set(s.id, '00:00')
        continue
      }

      let minStart = Number.POSITIVE_INFINITY
      let maxEnd = 0
      for (const it of s.items) {
        if (!it) continue
        if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
        if (Number.isFinite(it.endTime)) maxEnd = Math.max(maxEnd, it.endTime)
      }
      if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
        map.set(s.id, '00:00')
        continue
      }

      const start = isFirst ? 0 : minStart
      const end = isLast && safeVideoDuration != null ? safeVideoDuration : maxEnd
      map.set(s.id, formatMMSS(Math.max(0, end - start)))
    }
    return map
  }, [sections, videoDuration])

  const durationWeights = useMemo(() => {
    const secondsById = new Map<number, number>()
    let total = 0
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]
      const isFirst = i === 0
      const isLast = i === sections.length - 1
      const safeVideoDuration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : null

      if (!s.items || s.items.length === 0) {
        secondsById.set(s.id, 0)
        continue
      }

      let minStart = Number.POSITIVE_INFINITY
      let maxEnd = 0
      for (const it of s.items) {
        if (!it) continue
        if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
        if (Number.isFinite(it.endTime)) maxEnd = Math.max(maxEnd, it.endTime)
      }
      if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
        secondsById.set(s.id, 0)
        continue
      }

      const start = isFirst ? 0 : minStart
      const end = isLast && safeVideoDuration != null ? safeVideoDuration : maxEnd
      const d = Math.max(0, end - start)
      const safe = Number.isFinite(d) && d > 0 ? d : 0
      secondsById.set(s.id, safe)
      total += safe
    }

    // Fallback: if everything is 0 (or missing), render equal heights.
    const useEqual = !Number.isFinite(total) || total <= 0
    const weightById = new Map<number, number>()
    for (const s of sections) {
      const w = useEqual ? 1 : (secondsById.get(s.id) ?? 0)
      weightById.set(s.id, Math.max(0, w))
    }
    return weightById
  }, [sections, videoDuration])

  const enabledSectionsCount = useMemo(() => sections.filter(s => s.isEnabled).length, [sections])
  const hasEnabledSections = enabledSectionsCount > 0
  const hasSections = sections.length > 0
  const disableExports = !hasSections || !hasEnabledSections || isExporting

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const DownloadIcon = ({ className }: { className?: string }) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 3v10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 11l4 4 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 21h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col">
          {sections.map((section, idx) => {
            const muted = !section.isEnabled
            const isEditing = editingSectionId === section.id
            const durationLabel = durations.get(section.id) ?? '00:00'
            const heightWeight = durationWeights.get(section.id) ?? 0
            const startTime = idx === 0 ? 0 : sectionStartTimeSeconds(section)

            const commitRename = () => {
              if (!isEditing) return
              const next = draftTitle.trim()
              const original = editingOriginalTitle ?? section.title
              setEditingSectionId(null)
              if (next.length === 0 || next === original) {
                setDraftTitle('')
                return
              }
              renameSection(section.id, next)
              setDraftTitle('')
            }

            const cancelRename = () => {
              if (!isEditing) return
              setEditingSectionId(null)
              setDraftTitle('')
            }

            return (
              <div
                key={section.id}
                className={cx(
                  'group relative px-3 py-2 overflow-hidden',
                  muted ? 'bg-gray-50' : 'bg-white'
                )}
                style={{ flexGrow: heightWeight, flexBasis: 0 }}
              >
                <span
                  aria-hidden="true"
                  className={cx('absolute top-0 bottom-0 right-0 w-1.5', muted ? 'opacity-40' : '')}
                  style={{ backgroundColor: section.color }}
                />

                <div className="pr-3">
                  <div className="flex items-center justify-end gap-2">
                    <div className="min-w-0 flex shrink items-center justify-end gap-2">
                      <button
                        type="button"
                        className={cx(
                          'inline-flex h-7 w-7 items-center justify-center',
                          'bg-transparent text-gray-900',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2'
                        )}
                        aria-label={section.isEnabled ? 'Hide section from video' : 'Show section in video'}
                        title={section.isEnabled ? 'Disable section' : 'Enable section'}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleSection(section.id)
                        }}
                      >
                        {section.isEnabled ? (
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

                      <span
                        className={cx('shrink-0 text-xs tabular-nums', muted ? 'text-gray-400' : 'text-gray-500')}
                        dir="ltr"
                      >
                        {durationLabel}
                      </span>

                      <div className="min-w-0 shrink">
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitRename()
                              } else if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelRename()
                              }
                            }}
                            className={cx(
                              'w-full border border-gray-300 bg-white px-2 py-1',
                              'text-sm font-semibold text-gray-900 text-right',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2'
                            )}
                            aria-label="Edit section title"
                          />
                        ) : (
                          <div
                            className={cx(
                              'truncate text-sm font-semibold text-right',
                              muted ? 'text-gray-500 line-through' : 'text-gray-900'
                            )}
                            onClick={() => {
                              if (startTime == null) return
                              onSeek(startTime)
                            }}
                            onDoubleClick={() => {
                              setEditingSectionId(section.id)
                              setDraftTitle(section.title)
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return
                              e.preventDefault()
                              setEditingSectionId(section.id)
                              setDraftTitle(section.title)
                            }}
                            aria-label="Rename section"
                            title="Double-click to rename"
                          >
                            {section.title}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {isEditing ? null : (
                    <>
                      <div className="mt-0.5 h-[2px] bg-gray-200" aria-hidden="true" />
                      {section.description ? (
                        <div
                          className={cx(
                            'mt-1 text-xs text-right',
                            muted ? 'text-gray-400' : 'text-gray-600'
                          )}
                          dir="rtl"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            direction: 'rtl',
                          }}
                          title={section.description}
                        >
                          {section.description}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-200 pt-4">
        <button
          type="button"
          disabled={disableExports || videoFile == null}
          onClick={async () => {
            if (disableExports || videoFile == null) return
            setIsExporting(true)
            setExportProgress(0)
            setExportError(null)
            try {
              const blob = await exportVideo(videoFile, sections, videoDuration, setExportProgress)
              downloadBlob(blob, 'curated-video.mp4')
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Export failed. Please try again.'
              setExportError(message)
            } finally {
              setIsExporting(false)
            }
          }}
          title={
            !hasSections
              ? 'No sections yet'
              : !hasEnabledSections
                ? 'No sections enabled'
                : videoFile == null
                  ? 'No video loaded'
                  : isExporting
                    ? 'Processing...'
                    : undefined
          }
          className={[
            'inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold',
            disableExports || videoFile == null
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50',
          ].join(' ')}
        >
          <DownloadIcon className="shrink-0" />
          <span>Download Video</span>
        </button>
        <button
          type="button"
          disabled={disableExports}
          onClick={() => {
            if (disableExports) return
            const srtString = exportSrt(sections)
            const blob = new Blob([srtString], { type: 'text/plain' })
            downloadBlob(blob, 'curated-transcript.srt')
          }}
          title={
            !hasSections
              ? 'No sections yet'
              : !hasEnabledSections
                ? 'No sections enabled'
                : isExporting
                  ? 'Processing...'
                  : undefined
          }
          className={[
            'inline-flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold',
            disableExports ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50',
          ].join(' ')}
        >
          <DownloadIcon className="shrink-0" />
          <span>Download Transcript</span>
        </button>
      </div>

      {hasSections && !hasEnabledSections ? (
        <div className="mt-2 text-xs text-gray-500">No sections enabled</div>
      ) : null}

      {isExporting ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs text-gray-600">
            <div>Processing... {exportProgress}%</div>
          </div>
          <div className="mt-2 h-2 w-full bg-gray-200">
            <div
              className="h-2 bg-black transition-[width]"
              style={{ width: `${Math.max(0, Math.min(100, exportProgress))}%` }}
              aria-hidden="true"
            />
          </div>
        </div>
      ) : null}

      {exportError ? (
        <div className="mt-3 border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-semibold text-red-800">Export failed</div>
          <div className="mt-1 text-sm text-red-700">{exportError}</div>
          <button
            type="button"
            className="mt-2 border border-red-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
            onClick={() => {
              setExportError(null)
              setExportProgress(0)
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  )
}

