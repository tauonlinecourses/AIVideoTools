import { jsPDF } from 'jspdf'
import type { Section } from './store'

function formatMMSS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00'
  const floored = Math.max(0, Math.floor(totalSeconds))
  const mm = Math.floor(floored / 60)
  const ss = floored % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function safeVideoDurationSeconds(videoDuration: number): number | null {
  return Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : null
}

function sectionTimeRangeSeconds(
  section: Section,
  opts: { isFirst: boolean; isLast: boolean; videoDuration: number }
): { start: number; end: number } | null {
  if (!section.items || section.items.length === 0) return null

  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const it of section.items) {
    if (!it) continue
    if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
    if (Number.isFinite(it.endTime)) maxEnd = Math.max(maxEnd, it.endTime)
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null

  const safeDuration = safeVideoDurationSeconds(opts.videoDuration)
  const start = opts.isFirst ? 0 : minStart
  const end = opts.isLast && safeDuration != null ? safeDuration : maxEnd
  return { start: Math.max(0, start), end: Math.max(0, end) }
}

function sentenceLine(args: {
  timestampSeconds: number
  text: string
  isHidden: boolean
}): string {
  const ts = formatMMSS(args.timestampSeconds)
  return args.isHidden ? `[${ts}] HIDDEN — ${args.text}` : `[${ts}] ${args.text}`
}

function setText(el: HTMLElement, text: string) {
  el.textContent = text
}

export async function exportPdf(args: {
  sections: Section[]
  hiddenSentenceByIndex: Record<number, true>
  isRTL: boolean
  videoDuration: number
}): Promise<Blob> {
  // Use browser text shaping for RTL/Hebrew and render to PDF via jsPDF's html() pipeline.
  // This avoids garbled glyphs from built-in PDF fonts.
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()

  const marginPt = 40
  const contentWidthPt = pageWidth - marginPt * 2

  const container = document.createElement('div')
  container.dir = args.isRTL ? 'rtl' : 'ltr'
  container.style.width = `${contentWidthPt}px`
  container.style.padding = '0'
  container.style.margin = '0'
  container.style.color = '#000'
  container.style.background = '#fff'
  container.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans Hebrew", sans-serif'
  container.style.fontSize = '12px'
  container.style.lineHeight = '1.35'
  container.style.textAlign = args.isRTL ? 'right' : 'left'

  const title = document.createElement('div')
  title.style.fontSize = '20px'
  title.style.fontWeight = '700'
  title.style.margin = '0 0 8px 0'
  setText(title, 'Video Curator — Full Transcript Export')
  container.appendChild(title)

  const allItems = args.sections.flatMap(s => s.items ?? [])
  const totalSentenceCount = allItems.length
  const hiddenSentenceCount = Object.keys(args.hiddenSentenceByIndex).length
  const disabledSectionCount = args.sections.filter(s => !s.isEnabled).length

  const meta = document.createElement('div')
  meta.style.fontSize = '12px'
  meta.style.margin = '0 0 2px 0'
  setText(meta, `Generated: ${new Date().toLocaleString()}`)
  container.appendChild(meta)

  const meta2 = document.createElement('div')
  meta2.style.fontSize = '12px'
  meta2.style.margin = '0 0 10px 0'
  setText(
    meta2,
    `Sections: ${args.sections.length} • Sentences: ${totalSentenceCount} • Hidden: ${hiddenSentenceCount} • Disabled sections: ${disabledSectionCount}`,
  )
  container.appendChild(meta2)

  const hr = document.createElement('div')
  hr.style.height = '2px'
  hr.style.background = '#000'
  hr.style.margin = '10px 0 14px 0'
  container.appendChild(hr)

  for (let i = 0; i < args.sections.length; i++) {
    const section = args.sections[i]
    if (!section) continue

    const range = sectionTimeRangeSeconds(section, {
      isFirst: i === 0,
      isLast: i === args.sections.length - 1,
      videoDuration: args.videoDuration,
    })
    const timeLabel = range ? `${formatMMSS(range.start)}–${formatMMSS(range.end)}` : '00:00–00:00'
    const statusLabel = section.isEnabled ? 'ENABLED' : 'DISABLED'

    const h = document.createElement('div')
    h.style.fontSize = '14px'
    h.style.fontWeight = '700'
    h.style.margin = '10px 0 6px 0'
    setText(h, `Section ${i + 1}: ${section.title}  (${timeLabel})  [${statusLabel}]`)
    container.appendChild(h)

    if (section.description && section.description.trim().length > 0) {
      const desc = document.createElement('div')
      desc.style.margin = '0 0 8px 0'
      desc.style.color = '#111'
      setText(desc, section.description.trim())
      container.appendChild(desc)
    }

    const list = document.createElement('div')
    list.style.margin = '0 0 8px 0'

    const sortedItems = [...(section.items ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const it of sortedItems) {
      const row = document.createElement('div')
      row.style.whiteSpace = 'pre-wrap'
      row.style.wordBreak = 'break-word'
      row.style.margin = '0 0 3px 0'
      const isHidden = Boolean(args.hiddenSentenceByIndex[it.index])
      if (isHidden) row.style.color = '#444'
      setText(row, sentenceLine({ timestampSeconds: it.startTime, text: it.text, isHidden }))
      list.appendChild(row)
    }
    container.appendChild(list)

    const sep = document.createElement('div')
    sep.style.height = '1px'
    sep.style.background = '#cfcfcf'
    sep.style.margin = '10px 0 10px 0'
    container.appendChild(sep)
  }

  // Offscreen render target (must be in DOM for accurate layout).
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${contentWidthPt}px`
  host.style.background = '#fff'
  host.appendChild(container)
  document.body.appendChild(host)

  try {
    await doc.html(container, {
      x: marginPt,
      y: marginPt,
      width: contentWidthPt,
      windowWidth: container.getBoundingClientRect().width || contentWidthPt,
      autoPaging: 'text',
      html2canvas: {
        scale: 1.4,
        backgroundColor: '#ffffff',
        useCORS: true,
      },
    })
    return doc.output('blob')
  } finally {
    host.remove()
  }
}

