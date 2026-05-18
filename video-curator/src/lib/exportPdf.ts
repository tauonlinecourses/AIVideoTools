import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { Section } from './store'

const MARGIN_PT = 40
const RASTER_SCALE = 2
const SPINE_WIDTH_PX = 6
const TIMESTAMP_COL_PX = 72

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

function isHebrewText(text: string): boolean {
  return /[\u0590-\u05FF\u200F]/.test(text)
}

function hexWithAlpha(hex: string, alphaHex: string): string {
  const normalized = hex.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) return `${normalized}${alphaHex}`
  return normalized
}

function setText(el: HTMLElement, text: string) {
  el.textContent = text
}

function applyBaseTypography(el: HTMLElement) {
  el.style.fontFamily =
    'system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans Hebrew", sans-serif'
  el.style.fontSize = '12px'
  el.style.lineHeight = '1.35'
  el.style.color = '#111827'
  el.style.background = '#ffffff'
}

function spinePaddingProp(isRTL: boolean): 'paddingLeft' | 'paddingRight' {
  return isRTL ? 'paddingRight' : 'paddingLeft'
}

function appendSpine(parent: HTMLElement, color: string, isRTL: boolean) {
  const spineEl = document.createElement('div')
  spineEl.setAttribute('aria-hidden', 'true')
  spineEl.style.position = 'absolute'
  spineEl.style.top = '0'
  spineEl.style.bottom = '0'
  spineEl.style.width = `${SPINE_WIDTH_PX}px`
  spineEl.style.backgroundColor = color
  if (isRTL) spineEl.style.right = '0'
  else spineEl.style.left = '0'
  parent.appendChild(spineEl)
}

function appendStatusBadge(parent: HTMLElement, enabled: boolean) {
  const badge = document.createElement('span')
  badge.style.display = 'inline-block'
  badge.style.fontSize = '10px'
  badge.style.fontWeight = '700'
  badge.style.letterSpacing = '0.04em'
  badge.style.padding = '2px 6px'
  badge.style.marginInlineStart = '8px'
  badge.style.verticalAlign = 'middle'
  if (enabled) {
    badge.style.color = '#065f46'
    badge.style.background = '#d1fae5'
    setText(badge, 'ENABLED')
  } else {
    badge.style.color = '#6b7280'
    badge.style.background = '#f3f4f6'
    setText(badge, 'DISABLED')
  }
  parent.appendChild(badge)
}

function buildReportDom(args: {
  sections: Section[]
  hiddenSentenceByIndex: Record<number, true>
  isRTL: boolean
  contentWidthPx: number
  videoDuration: number
}): HTMLElement {
  const report = document.createElement('div')
  report.dir = args.isRTL ? 'rtl' : 'ltr'
  report.style.width = `${args.contentWidthPx}px`
  report.style.boxSizing = 'border-box'
  report.style.padding = '0'
  report.style.margin = '0'
  applyBaseTypography(report)

  const allItems = args.sections.flatMap(s => s.items ?? [])
  const totalSentenceCount = allItems.length
  const hiddenSentenceCount = Object.keys(args.hiddenSentenceByIndex).length
  const disabledSectionCount = args.sections.filter(s => !s.isEnabled).length

  const headerSection = document.createElement('div')
  headerSection.dir = 'ltr'
  headerSection.style.direction = 'ltr'
  headerSection.style.textAlign = 'left'
  headerSection.style.margin = '0 0 16px 0'

  const title = document.createElement('div')
  title.style.fontSize = '20px'
  title.style.fontWeight = '700'
  title.style.margin = '0 0 8px 0'
  title.style.color = '#111827'
  title.style.textAlign = 'left'
  setText(title, 'Video Curator — Full Transcript Export')
  headerSection.appendChild(title)

  const metaLine = document.createElement('div')
  metaLine.style.fontSize = '12px'
  metaLine.style.margin = '0 0 2px 0'
  metaLine.style.color = '#4b5563'
  metaLine.style.textAlign = 'left'
  setText(metaLine, `Generated: ${new Date().toLocaleString()}`)
  headerSection.appendChild(metaLine)

  const metaLine2 = document.createElement('div')
  metaLine2.style.fontSize = '12px'
  metaLine2.style.margin = '0 0 12px 0'
  metaLine2.style.color = '#4b5563'
  metaLine2.style.textAlign = 'left'
  setText(
    metaLine2,
    `Sections: ${args.sections.length} • Sentences: ${totalSentenceCount} • Hidden: ${hiddenSentenceCount} • Disabled sections: ${disabledSectionCount}`,
  )
  headerSection.appendChild(metaLine2)

  const hr = document.createElement('div')
  hr.style.height = '2px'
  hr.style.background = '#111827'
  hr.style.margin = '0'
  headerSection.appendChild(hr)

  report.appendChild(headerSection)

  const padProp = spinePaddingProp(args.isRTL)
  const spinePadValue = `${SPINE_WIDTH_PX + 12}px`

  for (let i = 0; i < args.sections.length; i++) {
    const section = args.sections[i]
    if (!section) continue

    const range = sectionTimeRangeSeconds(section, {
      isFirst: i === 0,
      isLast: i === args.sections.length - 1,
      videoDuration: args.videoDuration,
    })
    const timeLabel = range ? `${formatMMSS(range.start)}–${formatMMSS(range.end)}` : '00:00–00:00'
    const sectionMuted = !section.isEnabled

    const sectionBlock = document.createElement('div')
    sectionBlock.style.margin = '0 0 16px 0'
    sectionBlock.style.opacity = sectionMuted ? '0.4' : '1'

    const headerWrap = document.createElement('div')
    headerWrap.style.position = 'relative'
    headerWrap.style[padProp] = spinePadValue
    headerWrap.style.margin = '0 0 8px 0'
    appendSpine(headerWrap, section.color, args.isRTL)

    const headerRow = document.createElement('div')
    headerRow.style.display = 'grid'
    headerRow.style.gridTemplateColumns = args.isRTL
      ? `1fr ${TIMESTAMP_COL_PX}px`
      : `${TIMESTAMP_COL_PX}px 1fr`
    headerRow.style.gap = '12px'
    headerRow.style.alignItems = 'start'

    const titleCol = document.createElement('div')
    titleCol.style.minWidth = '0'

    const titleRow = document.createElement('div')
    titleRow.style.display = 'flex'
    titleRow.style.flexWrap = 'wrap'
    titleRow.style.alignItems = 'baseline'
    titleRow.style.justifyContent = args.isRTL ? 'flex-start' : 'flex-end'
    titleRow.style.textAlign = args.isRTL ? 'right' : 'left'

    const sectionTitle = document.createElement('span')
    sectionTitle.style.fontSize = '15px'
    sectionTitle.style.fontWeight = '700'
    sectionTitle.style.color = '#111827'
    if (sectionMuted) sectionTitle.style.textDecoration = 'line-through'
    setText(sectionTitle, `Section ${i + 1}: ${section.title}`)
    titleRow.appendChild(sectionTitle)
    appendStatusBadge(titleRow, section.isEnabled)
    titleCol.appendChild(titleRow)

    if (section.description && section.description.trim().length > 0) {
      const desc = document.createElement('div')
      desc.style.margin = '6px 0 0 0'
      desc.style.fontSize = '11px'
      desc.style.color = '#4b5563'
      desc.style.textAlign = args.isRTL ? 'right' : 'left'
      desc.style.whiteSpace = 'pre-wrap'
      desc.style.wordBreak = 'break-word'
      setText(desc, section.description.trim())
      titleCol.appendChild(desc)
    }

    const timeCol = document.createElement('div')
    timeCol.style.fontSize = '11px'
    timeCol.style.color = '#6b7280'
    timeCol.style.textAlign = args.isRTL ? 'left' : 'right'
    timeCol.dir = 'ltr'
    setText(timeCol, timeLabel)

    if (args.isRTL) {
      headerRow.appendChild(titleCol)
      headerRow.appendChild(timeCol)
    } else {
      headerRow.appendChild(timeCol)
      headerRow.appendChild(titleCol)
    }

    headerWrap.appendChild(headerRow)
    sectionBlock.appendChild(headerWrap)

    const sortedItems = [...(section.items ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const it of sortedItems) {
      const isHidden = Boolean(args.hiddenSentenceByIndex[it.index])
      const isHebrew = isHebrewText(it.text)
      const rowMuted = sectionMuted || isHidden

      const rowWrap = document.createElement('div')
      rowWrap.style.position = 'relative'
      rowWrap.style[padProp] = spinePadValue
      rowWrap.style.margin = '0 0 4px 0'
      rowWrap.style.background = isHidden ? '#f9fafb' : hexWithAlpha(section.color, '1A')
      rowWrap.style.opacity = rowMuted && !sectionMuted ? '0.55' : '1'

      appendSpine(rowWrap, section.color, args.isRTL)

      const rowGrid = document.createElement('div')
      rowGrid.style.display = 'grid'
      rowGrid.style.gridTemplateColumns = args.isRTL
        ? `1fr ${TIMESTAMP_COL_PX}px`
        : `${TIMESTAMP_COL_PX}px 1fr`
      rowGrid.style.gap = '12px'
      rowGrid.style.padding = '5px 0'
      rowGrid.style.alignItems = 'center'

      const textCol = document.createElement('div')
      textCol.style.minWidth = '0'
      textCol.style.display = 'flex'
      textCol.style.alignItems = 'center'
      textCol.style.flexWrap = 'wrap'
      textCol.style.gap = '6px'

      if (isHidden) {
        const hiddenLabel = document.createElement('span')
        hiddenLabel.style.display = 'inline-block'
        hiddenLabel.style.fontSize = '9px'
        hiddenLabel.style.fontWeight = '700'
        hiddenLabel.style.color = '#6b7280'
        hiddenLabel.style.background = '#e5e7eb'
        hiddenLabel.style.padding = '1px 4px'
        hiddenLabel.style.marginInlineEnd = '6px'
        hiddenLabel.style.alignSelf = 'center'
        setText(hiddenLabel, 'HIDDEN')
        textCol.appendChild(hiddenLabel)
      }

      const textSpan = document.createElement('span')
      textSpan.style.fontSize = '12px'
      textSpan.style.lineHeight = '1.25'
      textSpan.style.color = '#111827'
      textSpan.style.whiteSpace = 'pre-wrap'
      textSpan.style.wordBreak = 'break-word'
      textSpan.style.textAlign = isHebrew || args.isRTL ? 'right' : 'left'
      if (isHidden) textSpan.style.textDecoration = 'line-through'
      textSpan.dir = isHebrew || args.isRTL ? 'rtl' : 'ltr'
      setText(textSpan, it.text)
      textCol.appendChild(textSpan)

      const tsWrap = document.createElement('div')
      tsWrap.style.display = 'flex'
      tsWrap.style.alignItems = 'center'
      tsWrap.style.justifyContent = args.isRTL ? 'flex-start' : 'flex-end'
      tsWrap.style.fontSize = '11px'
      tsWrap.style.lineHeight = '1.25'
      tsWrap.style.color = '#6b7280'
      tsWrap.style.fontVariantNumeric = 'tabular-nums'
      tsWrap.style.textAlign = args.isRTL ? 'left' : 'right'
      tsWrap.dir = 'ltr'
      setText(tsWrap, formatMMSS(it.startTime))

      if (args.isRTL) {
        rowGrid.appendChild(textCol)
        rowGrid.appendChild(tsWrap)
      } else {
        rowGrid.appendChild(tsWrap)
        rowGrid.appendChild(textCol)
      }

      rowWrap.appendChild(rowGrid)
      sectionBlock.appendChild(rowWrap)
    }

    const sep = document.createElement('div')
    sep.style.height = '1px'
    sep.style.background = '#e5e7eb'
    sep.style.margin = '12px 0 0 0'
    sectionBlock.appendChild(sep)

    report.appendChild(sectionBlock)
  }

  return report
}

function addCanvasToPdf(doc: jsPDF, canvas: HTMLCanvasElement, marginPt: number): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const imgWidth = pageWidth - marginPt * 2
  const pageContentHeight = pageHeight - marginPt * 2
  const imgHeight = (canvas.height * imgWidth) / canvas.width

  if (imgHeight <= pageContentHeight + 0.5) {
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', marginPt, marginPt, imgWidth, imgHeight)
    return
  }

  const sliceCanvas = document.createElement('canvas')
  const sliceCtx = sliceCanvas.getContext('2d')
  if (!sliceCtx) throw new Error('Could not create canvas context for PDF pagination')

  let sourceY = 0
  let pageIndex = 0

  while (sourceY < canvas.height - 0.5) {
    const remainingSource = canvas.height - sourceY
    const maxSourceSlice = (pageContentHeight / imgHeight) * canvas.height
    const sourceSliceHeight = Math.min(maxSourceSlice, remainingSource)
    const displaySliceHeight = (sourceSliceHeight / canvas.height) * imgHeight

    sliceCanvas.width = canvas.width
    sliceCanvas.height = Math.max(1, Math.ceil(sourceSliceHeight))
    sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height)
    sliceCtx.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sourceSliceHeight,
      0,
      0,
      canvas.width,
      sourceSliceHeight,
    )

    if (pageIndex > 0) doc.addPage()

    doc.addImage(
      sliceCanvas.toDataURL('image/png'),
      'PNG',
      marginPt,
      marginPt,
      imgWidth,
      displaySliceHeight,
    )

    sourceY += sourceSliceHeight
    pageIndex++
  }
}

export async function exportPdf(args: {
  sections: Section[]
  hiddenSentenceByIndex: Record<number, true>
  isRTL: boolean
  videoDuration: number
}): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidthPt = pageWidth - MARGIN_PT * 2
  const contentWidthPx = Math.round(contentWidthPt * (96 / 72))

  const container = buildReportDom({
    sections: args.sections,
    hiddenSentenceByIndex: args.hiddenSentenceByIndex,
    isRTL: args.isRTL,
    contentWidthPx,
    videoDuration: args.videoDuration,
  })

  const hostEl = document.createElement('div')
  hostEl.style.position = 'fixed'
  hostEl.style.left = '-12000px'
  hostEl.style.top = '0'
  hostEl.style.width = `${contentWidthPx}px`
  hostEl.style.background = '#ffffff'
  hostEl.style.overflow = 'visible'
  hostEl.appendChild(container)
  document.body.appendChild(hostEl)

  try {
    await document.fonts.ready

    const canvas = await html2canvas(container, {
      scale: RASTER_SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: contentWidthPx,
      windowWidth: contentWidthPx,
      logging: false,
    })

    addCanvasToPdf(doc, canvas, MARGIN_PT)
    return doc.output('blob')
  } finally {
    hostEl.remove()
  }
}
