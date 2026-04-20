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

export const UploadZone = forwardRef<UploadZoneHandle, UploadZoneProps>(function UploadZone(
  { fileType, className },
  ref
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null)

  const videoFilename = useStore(s => s.videoFile?.name ?? null)
  const setVideoFile = useStore(s => s.setVideoFile)
  const setSrtItems = useStore(s => s.setSrtItems)

  const accept = useMemo(() => {
    return fileType === 'video' ? '.mp4,video/mp4' : '.srt,text/plain'
  }, [fileType])

  const loadedFilename = fileType === 'video' ? videoFilename : transcriptFilename

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

  const isLoaded = Boolean(loadedFilename)

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
          'w-full border px-4 py-3 text-left transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
          isDragOver ? 'border-black bg-gray-50' : 'border-gray-200 bg-white',
          isLoaded ? 'border-gray-300' : '',
        )}
        aria-label={`Upload ${label}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">
              {label}
            </div>
            <div className="mt-1 text-xs text-gray-600">
              {isLoaded ? (
                <span className="truncate">
                  Loaded: <span className="font-medium text-gray-900">{loadedFilename}</span>
                </span>
              ) : isDragOver ? (
                <span className="font-medium text-gray-900">Drop the file to upload</span>
              ) : (
                <span>Drag & drop, or click to choose a file</span>
              )}
            </div>
          </div>

          <div className="shrink-0 border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-900">
            {isLoaded ? 'Loaded' : isDragOver ? 'Release' : 'Upload'}
          </div>
        </div>
      </div>
    </div>
  )
})

