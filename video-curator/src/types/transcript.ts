export interface SrtItem {
  index: number
  startTime: number
  endTime: number
  text: string
}

export interface Section {
  id: number
  title: string
  description: string
  color: string
  isEnabled: boolean
  items: SrtItem[]
}
