import { useMemo, useRef } from 'react'
import { useStore } from '../lib/store'
import { SectionManager } from './SectionManager'
import { UploadZone, type UploadZoneHandle } from './UploadZone'

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin border-2 border-white/40 border-t-white"
      aria-hidden="true"
    />
  )
}

export interface RightPanelProps {
  onSeek: (time: number) => void
}

export function RightPanel({ onSeek }: RightPanelProps) {
  const videoFile = useStore(s => s.videoFile)
  const srtItemsCount = useStore(s => s.srtItems.length)
  const sectionsCount = useStore(s => s.sections.length)
  const isGenerating = useStore(s => s.isGenerating)
  const generateProgress = useStore(s => s.generateProgress)
  const generateError = useStore(s => s.generateError)
  const generateSections = useStore(s => s.generateSections)

  const videoRef = useRef<UploadZoneHandle | null>(null)
  const transcriptRef = useRef<UploadZoneHandle | null>(null)

  const aiIconSrc = '/icons/AI%20icon%20white.png'

  const state = useMemo(() => {
    if (sectionsCount > 0) return 'C'
    if (videoFile && srtItemsCount > 0) return 'B'
    return 'A'
  }, [sectionsCount, videoFile, srtItemsCount])

  const canGenerate = state === 'B' && !isGenerating

  return (
    <aside className="flex h-full flex-col border-l border-gray-200 bg-white p-6">
      {state !== 'C' ? (
        <div className="flex flex-1 flex-col">
          <div>
            <div className="text-lg font-semibold tracking-tight text-gray-900">
              Video Curator
            </div>
            <div className="mt-1 text-sm text-gray-600">
              Upload a video and transcript, generate topic sections, then export a trimmed result.
            </div>
          </div>

          <ol className="mt-6 space-y-2 text-sm text-gray-800">
            <li className="flex gap-2">
              <span className="w-5 shrink-0 text-gray-500">1.</span>
              <span>Upload Video and Transcript Files</span>
            </li>
            <li className="flex gap-2">
              <span className="w-5 shrink-0 text-gray-500">2.</span>
              <span>Click Generate Sections to segment the video using AI</span>
            </li>
            <li className="flex gap-2">
              <span className="w-5 shrink-0 text-gray-500">3.</span>
              <span>Edit sections and disable ones you want to remove</span>
            </li>
            <li className="flex gap-2">
              <span className="w-5 shrink-0 text-gray-500">4.</span>
              <span>Download the final video and transcript</span>
            </li>
          </ol>

          <div className="mt-6 grid grid-cols-2 gap-2">
            <UploadZone ref={videoRef} fileType="video" className="min-w-0" />
            <UploadZone ref={transcriptRef} fileType="transcript" className="min-w-0" />
          </div>

          <div className="mt-6">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => generateSections()}
              className={[
                'inline-flex h-11 w-full items-center justify-center gap-2 px-3 text-sm font-semibold rounded-[6px]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                canGenerate
                  ? 'bg-black text-white hover:bg-gray-900'
                  : 'bg-gray-100 text-gray-500',
              ].join(' ')}
            >
              <img
                src={aiIconSrc}
                alt=""
                aria-hidden="true"
                className={[
                  'h-4 w-4 shrink-0',
                  canGenerate ? '' : 'invert',
                ].join(' ')}
              />
              {isGenerating ? <Spinner /> : null}
              <span>Generate Sections</span>
            </button>

            {isGenerating ? (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-gray-700">
                  <span>Generating sections…</span>
                  <span className="tabular-nums">{Math.max(0, Math.min(100, generateProgress))}%</span>
                </div>
                <div
                  className="mt-1 h-2 w-full border border-gray-300 bg-white"
                  role="progressbar"
                  aria-label="Generating sections"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.max(0, Math.min(100, generateProgress))}
                >
                  <div
                    className="h-full bg-black transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, generateProgress))}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-2 text-xs text-gray-600">
              {state === 'A'
                ? 'Upload both files to enable generation.'
                : 'Ready to generate sections from your transcript.'}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="text-base font-semibold text-gray-900">
            Sections
          </div>

          {generateError ? (
            <div className="mt-3 border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              {generateError}
            </div>
          ) : null}

          <div className="mt-4 flex-1">
            <SectionManager onSeek={onSeek} />
          </div>
        </div>
      )}
    </aside>
  )
}

