import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { parseSrt, type SrtItem } from '../lib/parseSrt'
import { detectDirection } from '../lib/detectDirection'
import { useStore } from '../lib/store'

export type UploadFileType = 'video' | 'transcript'

export type UploadZoneHandle = {
  openFileDialog: () => void
}

export interface UploadZoneProps {
  fileType: UploadFileType
  className?: string
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Icon({ type }: { type: UploadFileType }) {
  if (type === 'video') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="mt-[1px] shrink-0"
      >
        <path
          d="M2.5 4.75c0-.69.56-1.25 1.25-1.25h6.5c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-6.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M11.5 6.25 14 4.75v6.5l-2.5-1.5v-3.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="mt-[1px] shrink-0"
    >
      <path
        d="M4 2.75h5.2L12 5.55V13.25c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V3.75c0-.55.45-1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.2 2.75v2.4c0 .22.18.4.4.4H12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 7h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5 9.25h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5 11.5h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M13.25 4.75 6.75 11.25 3 7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const UploadZone = forwardRef<UploadZoneHandle, UploadZoneProps>(function UploadZone(
  { fileType, className },
  ref
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null)

  const videoFilename = useStore(s => s.videoFile?.name ?? null)
  const transcriptLoaded = useStore(s => s.srtItems.length > 0)
  const setVideoFile = useStore(s => s.setVideoFile)
  const setSrtItems = useStore(s => s.setSrtItems)

  const accept = useMemo(() => {
    return fileType === 'video' ? '.mp4,video/mp4' : '.srt,text/plain'
  }, [fileType])

  const loadedFilename =
    fileType === 'video'
      ? videoFilename
      : transcriptFilename ?? (transcriptLoaded ? 'Transcript loaded' : null)

  useImperativeHandle(ref, () => ({
    openFileDialog: () => {
      inputRef.current?.click()
    },
  }))

  const handleFiles = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return

    if (fileType === 'video') {
      setVideoFile(file)
      return
    }

    // transcript
    setTranscriptFilename(file.name)
    const raw = await file.text()
    const items: SrtItem[] = parseSrt(raw)
    const isRTL = detectDirection(items)
    setSrtItems(items, isRTL)
  }, [fileType, setSrtItems, setVideoFile])

  const onInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFiles(e.target.files)
    // Allow selecting the same file again.
    e.target.value = ''
  }, [handleFiles])

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    await handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const label = fileType === 'video' ? 'Video (.mp4)' : 'Transcript (.srt)'

  const isLoaded = fileType === 'video' ? Boolean(videoFilename) : transcriptLoaded

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onInputChange}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cx(
          'group w-full border px-4 py-3 text-left transition-colors rounded-[6px]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
          isDragOver
            ? 'border-black bg-gray-50'
            : isLoaded
              ? 'border-black bg-gray-50'
              : 'border-gray-200 bg-white hover:bg-gray-50',
        )}
        aria-label={`Upload ${label}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-start gap-2 text-sm font-semibold text-gray-900">
              <Icon type={fileType} />
              <span className="min-w-0">{label}</span>
            </div>
            <div className="mt-1 text-xs text-gray-600">
              {isLoaded ? (
                <span className="flex min-w-0 items-baseline gap-1">
                  <span className="shrink-0 font-medium text-gray-900">Uploaded:</span>
                  <span className="min-w-0 truncate font-medium text-gray-900">
                    {loadedFilename ?? 'Ready'}
                  </span>
                </span>
              ) : isDragOver ? (
                <span className="font-medium text-gray-900">Drop the file to upload</span>
              ) : (
                <span>Drag & drop, or click to choose a file</span>
              )}
            </div>
          </div>

          <div
            className={cx(
              'shrink-0 border px-2 py-1 text-xs font-medium rounded-[6px]',
              isLoaded
                ? 'border-black bg-black text-white group-hover:bg-gray-900'
                : isDragOver
                  ? 'border-black bg-white text-gray-900'
                  : 'border-gray-200 bg-white text-gray-900 group-hover:bg-gray-50'
            )}
          >
            <span className="inline-flex items-center gap-1">
              {isLoaded ? <CheckIcon /> : null}
              <span>{isLoaded ? 'Uploaded' : isDragOver ? 'Release' : 'Upload'}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
})

