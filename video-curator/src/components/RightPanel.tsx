import { useMemo, useRef } from 'react'
import { useStore } from '../lib/store'
import { SectionManager } from './SectionManager'
import { UploadZone, type UploadZoneHandle } from './UploadZone'

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      aria-hidden="true"
    />
  )
}

export function RightPanel() {
  const videoFile = useStore(s => s.videoFile)
  const srtItemsCount = useStore(s => s.srtItems.length)
  const sectionsCount = useStore(s => s.sections.length)
  const isGenerating = useStore(s => s.isGenerating)
  const generateError = useStore(s => s.generateError)
  const generateSections = useStore(s => s.generateSections)

  const videoRef = useRef<UploadZoneHandle | null>(null)
  const transcriptRef = useRef<UploadZoneHandle | null>(null)

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
            <button
              type="button"
              onClick={() => videoRef.current?.openFileDialog()}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
            >
              Upload Video
            </button>
            <button
              type="button"
              onClick={() => transcriptRef.current?.openFileDialog()}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
            >
              Upload Transcript
            </button>
          </div>

          <div className="mt-3 space-y-2">
            <UploadZone ref={videoRef} fileType="video" />
            <UploadZone ref={transcriptRef} fileType="transcript" />
          </div>

          <div className="mt-6">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => generateSections()}
              className={[
                'inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                canGenerate
                  ? 'bg-black text-white hover:bg-gray-900'
                  : 'bg-gray-100 text-gray-500',
              ].join(' ')}
            >
              {isGenerating ? <Spinner /> : null}
              <span>Generate Sections</span>
            </button>
            <div className="mt-2 text-xs text-gray-600">
              {state === 'A'
                ? 'Upload both files to enable generation.'
                : 'Ready to generate sections from your transcript.'}
            </div>
          </div>

          <div className="mt-auto pt-6 text-xs text-gray-500">
            Light mode only. Minimal, high-contrast UI.
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="text-base font-semibold text-gray-900">
            Sections
          </div>

          {generateError ? (
            <div className="mt-3 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              {generateError}
            </div>
          ) : null}

          <div className="mt-4 flex-1">
            <SectionManager />
          </div>
        </div>
      )}
    </aside>
  )
}

