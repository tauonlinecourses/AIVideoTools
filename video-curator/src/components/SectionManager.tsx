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

function sectionDurationSeconds(section: Section): number {
  const first = section.items[0]
  const last = section.items[section.items.length - 1]
  if (!first || !last) return 0
  return Math.max(0, last.endTime - first.startTime)
}

export function SectionManager() {
  const sections = useStore(s => s.sections)
  const videoFile = useStore(s => s.videoFile)
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
    for (const s of sections) {
      map.set(s.id, formatMMSS(sectionDurationSeconds(s)))
    }
    return map
  }, [sections])

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="space-y-2">
          {sections.map((section) => {
            const muted = !section.isEnabled
            const isEditing = editingSectionId === section.id
            const switchId = `section-toggle-${section.id}`

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
                className={[
                  'flex items-center gap-3 border px-3 py-2',
                  muted ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white',
                ].join(' ')}
              >
                <span
                  className={['h-3 w-3 shrink-0', muted ? 'opacity-40' : ''].join(' ')}
                  style={{ backgroundColor: section.color }}
                  aria-hidden="true"
                />

                <div className="min-w-0 flex-1">
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
                      className={[
                        'w-full border border-gray-300 bg-white px-2 py-1',
                        'text-sm font-semibold text-gray-900',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                      ].join(' ')}
                      aria-label="Edit section title"
                    />
                  ) : (
                    <div
                      className={[
                        'truncate text-sm font-semibold',
                        muted ? 'text-gray-500 line-through' : 'text-gray-900',
                      ].join(' ')}
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

                  <div className={['mt-0.5 text-xs', muted ? 'text-gray-400' : 'text-gray-600'].join(' ')}>
                    Duration: {durations.get(section.id) ?? '00:00'}
                  </div>
                </div>

                <div className="shrink-0">
                  <input
                    id={switchId}
                    type="checkbox"
                    className="sr-only peer"
                    checked={section.isEnabled}
                    onChange={() => toggleSection(section.id)}
                    aria-label={section.isEnabled ? 'Disable section' : 'Enable section'}
                  />
                  <label
                    htmlFor={switchId}
                    className={[
                      'relative inline-flex h-6 w-11 cursor-pointer items-center border transition-colors',
                      'focus-within:outline-none focus-within:ring-2 focus-within:ring-black focus-within:ring-offset-2',
                      'peer-checked:border-black peer-checked:bg-black',
                      'border-gray-300 bg-white',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block h-5 w-5 transform bg-white transition-transform',
                        'translate-x-0.5 border border-gray-300',
                        'peer-checked:translate-x-5 peer-checked:border-white',
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  </label>
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
              const blob = await exportVideo(videoFile, sections, setExportProgress)
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
            'border px-3 py-2 text-sm font-semibold',
            disableExports || videoFile == null
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50',
          ].join(' ')}
        >
          Download Video
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
            'border px-3 py-2 text-sm font-semibold',
            disableExports ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-900 bg-white text-gray-900 hover:bg-gray-50',
          ].join(' ')}
        >
          Download Transcript
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

