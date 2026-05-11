import { useCallback, useState } from 'react'
import { detectDirection } from '../lib/detectDirection'
import { fetchYoutubeTranscriptAsSrtItems } from '../lib/fetchYoutubeTranscript'
import { useStore } from '../lib/store'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export interface YouTubeInputProps {
  /** Shown in the upload summary row after a successful import. */
  onImportedLabel: (label: string) => void
  className?: string
}

export function YouTubeInput({ onImportedLabel, className }: YouTubeInputProps) {
  const [url, setUrl] = useState('')
  const [langMode, setLangMode] = useState<'auto' | 'he' | 'en' | 'ar'>('auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transcriptLoaded = useStore(s => s.srtItems.length > 0)
  const setSrtItems = useStore(s => s.setSrtItems)

  const onImport = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const lang = langMode === 'auto' ? undefined : langMode

      const { items, title, videoId } = await fetchYoutubeTranscriptAsSrtItems(url, { lang })
      const isRTL = detectDirection(items)
      setSrtItems(items, isRTL)
      const labelBase = title?.trim() || 'YouTube transcript'
      onImportedLabel(`${labelBase} (${videoId})`)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [langMode, onImportedLabel, setSrtItems, url])

  const loadedHint = transcriptLoaded ? 'Transcript loaded' : null

  return (
    <div className={className}>
      <div className="flex flex-col gap-2">
        <input
          type="url"
          name="youtube-url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          className={cx(
            'w-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none',
            'focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
            busy && 'opacity-60',
          )}
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
          <select
            name="youtube-lang"
            value={langMode}
            disabled={busy}
            onChange={(e) => setLangMode(e.target.value as typeof langMode)}
            className={cx(
              'w-full border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none',
              'focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
              busy && 'opacity-60',
            )}
            aria-label="Transcript language"
          >
            <option value="auto">Select language</option>
            <option value="he">Hebrew (he/iw)</option>
            <option value="en">English (en)</option>
            <option value="ar">Arabic (ar)</option>
          </select>

          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={() => void onImport()}
            className={cx(
              'w-full shrink-0 border px-4 py-2 text-sm font-semibold transition-colors rounded-[6px] sm:w-auto',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
              busy || !url.trim()
                ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                : 'border-black bg-black text-white hover:bg-gray-900',
            )}
          >
            {busy ? 'Importing…' : 'Import transcript'}
          </button>
        </div>
      </div>

      {!loadedHint ? null : <div className="mt-2 text-xs text-gray-600">{loadedHint}</div>}

      {error ? (
        <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-900">
          {error}
        </div>
      ) : null}
    </div>
  )
}
