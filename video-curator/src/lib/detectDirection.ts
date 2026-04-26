import type { SrtItem } from '../types/transcript'

const HEBREW_REGEX = /[\u0590-\u05FF]/

export function detectDirection(items: SrtItem[]): boolean {
  const sample = items
    .slice(0, 10)
    .map(item => item.text)
    .join(' ')

  return HEBREW_REGEX.test(sample)
}