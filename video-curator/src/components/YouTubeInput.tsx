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
  const [langMode, setLangMode] = useState<'auto' | 'he' | 'en' | 'ar' | 'custom'>('auto')
  const [customLang, setCustomLang] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transcriptLoaded = useStore(s => s.srtItems.length > 0)
  const setSrtItems = useStore(s => s.setSrtItems)

  const onImport = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const lang =
        langMode === 'auto'
          ? undefined
          : langMode === 'custom'
            ? (customLang.trim() || undefined)
            : langMode

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
  }, [customLang, langMode, onImportedLabel, setSrtItems, url])

  const loadedHint = transcriptLoaded ? 'Transcript loaded' : 'Paste a link, then import'

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="flex gap-2">
          <select
            name="youtube-lang"
            value={langMode}
            disabled={busy}
            onChange={(e) => setLangMode(e.target.value as typeof langMode)}
            className={cx(
              'border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none',
              'focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
              busy && 'opacity-60',
            )}
            aria-label="Transcript language"
          >
            <option value="auto">Auto</option>
            <option value="he">Hebrew (he/iw)</option>
            <option value="en">English (en)</option>
            <option value="ar">Arabic (ar)</option>
            <option value="custom">Custom…</option>
          </select>
          {langMode === 'custom' ? (
            <input
              type="text"
              name="youtube-lang-custom"
              value={customLang}
              disabled={busy}
              onChange={(e) => setCustomLang(e.target.value)}
              placeholder="e.g. he, en, ar"
              className={cx(
                'w-[140px] border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none',
                'focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                busy && 'opacity-60',
              )}
              aria-label="Custom language code"
            />
          ) : null}
        </div>
        <input
          type="url"
          name="youtube-url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          className={cx(
            'min-w-0 flex-1 border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none',
            'focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
            busy && 'opacity-60',
          )}
        />
        <button
          type="button"
          disabled={busy || !url.trim()}
          onClick={() => void onImport()}
          className={cx(
            'shrink-0 border px-4 py-2 text-sm font-semibold transition-colors rounded-[6px]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
            busy || !url.trim()
              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
              : 'border-black bg-black text-white hover:bg-gray-900',
          )}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>

      <div className="mt-2 text-xs text-gray-600">{loadedHint}</div>

      {error ? (
        <div className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-900">
          {error}
        </div>
      ) : null}
    </div>
  )
}
