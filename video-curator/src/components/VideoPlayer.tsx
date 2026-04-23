import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { computeSectionTimeRanges } from '../lib/sectionsTime'

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

function captureFirstFrameDataUrl(video: HTMLVideoElement): string | null {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  const canvas = document.createElement('canvas')
  // Small thumbnail is enough for a repeating filmstrip and avoids huge data URLs.
  const targetH = 48
  const targetW = 72
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(video, 0, 0, w, h, 0, 0, targetW, targetH)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path fill="currentColor" d="M8 5v14l12-7-12-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  )
}

const VideoPlayerImpl = React.forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ className }, ref) {
    const videoUrl = useStore(s => s.videoUrl)
    const sections = useStore(s => s.sections)
    const videoDuration = useStore(s => s.videoDuration)
    const setCurrentTime = useStore(s => s.setCurrentTime)
    const setVideoMeta = useStore(s => s.setVideoMeta)

    const videoRef = useRef<HTMLVideoElement | null>(null)
    const rafRef = useRef<number | null>(null)
    const currentTimeRef = useRef(0)
    const lastSyncedTime = useRef(0)

    const timeLabelRef = useRef<HTMLSpanElement | null>(null)
    const durationLabelRef = useRef<HTMLSpanElement | null>(null)

    const [isPlaying, setIsPlaying] = useState(false)

    const [duration, setDuration] = useState(0)
    const durationLabel = useMemo(() => formatMMSS(duration), [duration])

    const sectionRanges = useMemo(() => {
      return computeSectionTimeRanges(sections, videoDuration)
    }, [sections, videoDuration])

    const hasEnabledSections = useMemo(
      () => sections.some(s => s.isEnabled),
      [sections]
    )

    const sectionRangesRef = useRef(sectionRanges)
    const hasEnabledSectionsRef = useRef(hasEnabledSections)

    const manualSeekUntilMsRef = useRef(0)
    const lastAutoSkipTargetRef = useRef<number | null>(null)
    const lastAutoSkipAtMsRef = useRef(0)

    useEffect(() => {
      sectionRangesRef.current = sectionRanges
      hasEnabledSectionsRef.current = hasEnabledSections
    }, [sectionRanges, hasEnabledSections])

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
      if (!videoUrl) return

      let cancelled = false
      let cleanupSeeked: (() => void) | null = null

      const tryCapture = () => {
        if (cancelled) return false
        const poster = captureFirstFrameDataUrl(video)
        if (!poster) return false
        const d = Number.isFinite(video.duration) ? video.duration : 0
        setVideoMeta({ duration: d, timelinePosterUrl: poster })
        return true
      }

      // If we already have enough data, capture immediately.
      if (video.readyState >= 2) {
        tryCapture()
        return () => {
          cancelled = true
          cleanupSeeked?.()
        }
      }

      const onLoadedData = () => {
        if (tryCapture()) return

        // Some videos don't paint a useful first frame at t=0 until a seek occurs,
        // and t=0 can often be black. Grab a tiny offset to get a representative frame.
        const dur = Number.isFinite(video.duration) ? video.duration : 0
        const target = Math.min(Math.max(0, dur - 0.01), Math.max(0.0, Math.min(0.5, dur * 0.05)))

        const onSeeked = () => {
          cleanupSeeked?.()
          tryCapture()
          try {
            video.currentTime = 0
          } catch {
            // ignore
          }
        }

        cleanupSeeked = () => video.removeEventListener('seeked', onSeeked)
        video.addEventListener('seeked', onSeeked)
        try {
          video.currentTime = target
        } catch {
          cleanupSeeked?.()
        }
      }

      video.addEventListener('loadeddata', onLoadedData)
      return () => {
        cancelled = true
        video.removeEventListener('loadeddata', onLoadedData)
        cleanupSeeked?.()
      }
    }, [setVideoMeta, videoUrl])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      const onLoaded = () => {
        const d = Number.isFinite(video.duration) ? video.duration : 0
        setDuration(d > 0 ? d : 0)
        setVideoMeta({ duration: d, timelinePosterUrl: useStore.getState().timelinePosterUrl })
      }

      const onPlay = () => setIsPlaying(true)
      const onPause = () => setIsPlaying(false)
      const onEnded = () => setIsPlaying(false)

      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('durationchange', onLoaded)
      video.addEventListener('play', onPlay)
      video.addEventListener('pause', onPause)
      video.addEventListener('ended', onEnded)

      // Ensure initial UI is correct if metadata already exists
      onLoaded()
      setIsPlaying(!video.paused && !video.ended)

      return () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('durationchange', onLoaded)
        video.removeEventListener('play', onPlay)
        video.removeEventListener('pause', onPause)
        video.removeEventListener('ended', onEnded)
      }
    }, [setVideoMeta, videoUrl])

    function tick() {
      const video = videoRef.current
      if (video) {
        const t = clampTime(video.currentTime)
        currentTimeRef.current = t

        // Skip disabled sections only during normal playback progression.
        // - If user manually sought recently, do nothing.
        // - If all sections are disabled, do nothing (play full original).
        const ranges = sectionRangesRef.current
        const hasEnabled = hasEnabledSectionsRef.current
        if (!video.paused && hasEnabled && ranges.length > 0) {
          const nowMs = Date.now()
          const recentlyManualSeeked = nowMs < manualSeekUntilMsRef.current
          const recentlyAutoSkipped = nowMs - lastAutoSkipAtMsRef.current < 250

          if (!recentlyManualSeeked && !recentlyAutoSkipped) {
            const EPS = 0.03
            const cur = t

            let activeIdx = -1
            for (let i = 0; i < ranges.length; i++) {
              const r = ranges[i]
              if (cur >= r.start - EPS && cur < r.end - EPS) {
                activeIdx = i
                break
              }
            }

            if (activeIdx >= 0) {
              const active = ranges[activeIdx]
              if (!active.isEnabled) {
                let nextEnabled: number | null = null
                for (let j = activeIdx + 1; j < ranges.length; j++) {
                  if (ranges[j].isEnabled) {
                    nextEnabled = ranges[j].start
                    break
                  }
                }

                if (nextEnabled != null) {
                  const target = Math.max(0, nextEnabled + EPS)
                  if (lastAutoSkipTargetRef.current == null || Math.abs(target - lastAutoSkipTargetRef.current) > 0.01) {
                    try {
                      video.currentTime = target
                      lastAutoSkipTargetRef.current = target
                      lastAutoSkipAtMsRef.current = nowMs
                    } catch {
                      // ignore
                    }
                  }
                } else {
                  // No enabled content after this point: pause at the end of the disabled range.
                  try {
                    const endTarget = Math.max(0, active.end)
                    video.currentTime = endTarget
                    video.pause()
                    lastAutoSkipTargetRef.current = endTarget
                    lastAutoSkipAtMsRef.current = nowMs
                  } catch {
                    // ignore
                  }
                }
              }
            }
          }
        }

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
        manualSeekUntilMsRef.current = Date.now() + 600
        lastAutoSkipTargetRef.current = null
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
        if (video.src !== videoUrl) {
          video.src = videoUrl
          video.load()
        }
        if (video.paused) {
          await video.play()
        } else {
          video.pause()
        }
      } catch {
        // Autoplay policies / play() can throw; ignore for minimal UI.
      }
    }

    const onPreviewClick = () => {
      void togglePlay()
    }

    return (
      <section className={className ?? 'w-full'}>
        <div className="flex w-full justify-center">
          <div className="w-full max-w-[680px]">
            <div
              className={[
                'relative w-full overflow-hidden border border-gray-200 bg-black pt-[56.25%]',
                videoUrl ? 'cursor-pointer' : '',
              ].join(' ')}
              onClick={onPreviewClick}
            >
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              preload="auto"
            />

            {!videoUrl ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <div className="text-center">
                  <div className="text-sm font-semibold text-gray-900">No video loaded</div>
                  <div className="mt-1 text-sm text-gray-600">Upload a video to preview and sync playback</div>
                </div>
              </div>
            ) : null}
            </div>

            <div className="mt-0 grid grid-cols-3 items-center gap-3">
              <div className="flex justify-start" aria-hidden="true" />

              <button
                type="button"
                onClick={togglePlay}
                disabled={!videoUrl}
                className={[
                  'inline-flex items-center justify-center bg-white px-4 py-2 text-gray-900',
                  'hover:bg-gray-100',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                  !videoUrl ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause' : 'Play'}
                style={{ justifySelf: 'center' }}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>

              <div className="justify-self-end font-mono text-sm text-gray-700">
                <span ref={timeLabelRef}>00:00</span>
                <span className="mx-2 text-gray-400">/</span>
                <span ref={durationLabelRef}>{durationLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }
)

export const VideoPlayer = VideoPlayerImpl

