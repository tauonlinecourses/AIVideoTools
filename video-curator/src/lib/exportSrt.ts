import type { Section } from './store'

function secondsToSrtTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const totalMs = Math.round(safe * 1000)

  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function exportSrt(sections: Section[]): string {
  const enabledItems = sections
    .filter((s) => s.isEnabled)
    .flatMap((s) => s.items)

  let runningTime = 0
  const blocks: string[] = []

  for (let i = 0; i < enabledItems.length; i++) {
    const item = enabledItems[i]
    const duration = Math.max(0, item.endTime - item.startTime)

    const startTime = runningTime
    const endTime = runningTime + duration
    runningTime = endTime

    blocks.push(
      String(i + 1),
      `${secondsToSrtTime(startTime)} --> ${secondsToSrtTime(endTime)}`,
      item.text,
      '',
    )
  }

  return blocks.join('\n')
}
