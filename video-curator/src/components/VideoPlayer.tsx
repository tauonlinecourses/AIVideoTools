import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'

export type VideoPlayerHandle = {
  seekTo: (time: number) => void
}

export interface VideoPlayerProps {
  className?: string
}

function formatMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00'
  const rounded = Math.max(0, Math.round(totalSeconds))
  const mm = Math.floor(rounded / 60)
  const ss = rounded % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function clampTime(t: number): number {
  if (!Number.isFinite(t)) return 0
  return Math.max(0, t)
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="currentColor" d="M8 5v14l12-7-12-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  )
}

const VideoPlayerImpl = React.forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ className }, ref) {
    const videoUrl = useStore(s => s.videoUrl)
    const setCurrentTime = useStore(s => s.setCurrentTime)

    const videoRef = useRef<HTMLVideoElement | null>(null)
    const rafRef = useRef<number | null>(null)
    const currentTimeRef = useRef(0)
    const lastSyncedTime = useRef(0)

    const timeLabelRef = useRef<HTMLSpanElement | null>(null)
    const durationLabelRef = useRef<HTMLSpanElement | null>(null)

    const [isPlaying, setIsPlaying] = useState(false)

    const [duration, setDuration] = useState(0)
    const durationLabel = useMemo(() => formatMMSS(duration), [duration])

    useEffect(() => {
      const el = durationLabelRef.current
      if (!el) return
      el.textContent = durationLabel
    }, [durationLabel])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      if (videoUrl) {
        if (video.src !== videoUrl) {
          video.src = videoUrl
          video.load()
        }
      } else {
        video.removeAttribute('src')
        video.load()
        currentTimeRef.current = 0
        lastSyncedTime.current = 0
        const timeEl = timeLabelRef.current
        if (timeEl) timeEl.textContent = '00:00'
      }
    }, [videoUrl])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      const onLoaded = () => {
        const d = Number.isFinite(video.duration) ? video.duration : 0
        setDuration(d > 0 ? d : 0)
      }

      const onPlay = () => setIsPlaying(true)
      const onPause = () => setIsPlaying(false)
      const onEnded = () => setIsPlaying(false)

      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('durationchange', onLoaded)
      video.addEventListener('play', onPlay)
      video.addEventListener('pause', onPause)
      video.addEventListener('ended', onEnded)

      return () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('durationchange', onLoaded)
        video.removeEventListener('play', onPlay)
        video.removeEventListener('pause', onPause)
        video.removeEventListener('ended', onEnded)
      }
    }, [])

    function tick() {
      const video = videoRef.current
      if (video) {
        const t = clampTime(video.currentTime)
        currentTimeRef.current = t

        const timeEl = timeLabelRef.current
        if (timeEl) {
          timeEl.textContent = formatMMSS(t)
        }

        if (Math.abs(t - lastSyncedTime.current) > 0.1) {
          setCurrentTime(t)
          lastSyncedTime.current = t
        }
      }
      rafRef.current = window.requestAnimationFrame(tick)
    }

    useEffect(() => {
      rafRef.current = window.requestAnimationFrame(tick)
      return () => {
        if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        const video = videoRef.current
        if (!video) return
        const t = clampTime(time)
        video.currentTime = t
        currentTimeRef.current = t
        setCurrentTime(t)
        lastSyncedTime.current = t
        const timeEl = timeLabelRef.current
        if (timeEl) timeEl.textContent = formatMMSS(t)
      },
    }), [setCurrentTime])

    const togglePlay = async () => {
      const video = videoRef.current
      if (!video) return
      if (!videoUrl) return

      try {
        if (video.paused) {
          await video.play()
        } else {
          video.pause()
        }
      } catch {
        // Autoplay policies / play() can throw; ignore for minimal UI.
      }
    }

    return (
      <section className={className ?? 'w-full'}>
        <div className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-black pt-[56.25%]">
          {videoUrl ? (
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-contain"
              playsInline
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <div className="text-center">
                <div className="text-sm font-semibold text-gray-900">No video loaded</div>
                <div className="mt-1 text-sm text-gray-600">Upload a video to preview and sync playback</div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!videoUrl}
            className={[
              'inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900',
              'hover:bg-gray-50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
              !videoUrl ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <div className="font-mono text-sm text-gray-700">
            <span ref={timeLabelRef}>00:00</span>
            <span className="mx-2 text-gray-400">/</span>
            <span ref={durationLabelRef}>{durationLabel}</span>
          </div>
        </div>
      </section>
    )
  }
)

export const VideoPlayer = VideoPlayerImpl

