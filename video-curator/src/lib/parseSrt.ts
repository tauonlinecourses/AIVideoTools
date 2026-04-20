import SrtParser2 from 'srt-parser-2'

export interface SrtItem {
  index: number
  startTime: number
  endTime: number
  text: string
}

function timeToSeconds(time: string): number {
  const [hours, minutes, rest] = time.split(':')
  const [seconds, millis] = rest.replace(',', '.').split('.')
  return (
    parseInt(hours) * 3600 +
    parseInt(minutes) * 60 +
    parseInt(seconds) +
    parseInt(millis) / 1000
  )
}

export function parseSrt(raw: string): SrtItem[] {
  const parser = new SrtParser2()
  const parsed = parser.fromSrt(raw)

  return parsed.map((item, i) => ({
    index: i,
    startTime: timeToSeconds(item.startTime),
    endTime: timeToSeconds(item.endTime),
    text: item.text,
  }))
}