import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { Section } from './store'

let ffmpegSingleton: FFmpeg | null = null
let loadPromise: Promise<unknown> | null = null

async function getFfmpeg(onProgress: (progress: number) => void): Promise<FFmpeg> {
  if (!ffmpegSingleton) {
    ffmpegSingleton = new FFmpeg()
  }

  // Register/refresh progress handler for this call.
  ffmpegSingleton.on('progress', ({ progress }) => {
    onProgress(Math.min(Math.round(progress * 100), 100))
  })

  if (!loadPromise) {
    loadPromise = ffmpegSingleton.load({
      coreURL: await toBlobURL(
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
        'text/javascript',
      ),
      wasmURL: await toBlobURL(
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
        'application/wasm',
      ),
    })
  }

  await loadPromise
  return ffmpegSingleton
}

function sectionTimeRange(section: Section): { startTime: number; endTime: number } | null {
  const first = section.items[0]
  const last = section.items[section.items.length - 1]
  if (!first || !last) return null

  const startTime = first.startTime
  const endTime = last.endTime
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null
  if (endTime <= startTime) return null

  return { startTime, endTime }
}

export async function exportVideo(
  videoFile: File,
  sections: Section[],
  onProgress: (progress: number) => void, // 0 to 100
): Promise<Blob> {
  const enabledSections = sections.filter((s) => s.isEnabled)
  if (enabledSections.length === 0) {
    throw new Error('No sections enabled.')
  }

  const ranges = enabledSections
    .map(sectionTimeRange)
    .filter((r): r is { startTime: number; endTime: number } => r != null)

  if (ranges.length === 0) {
    throw new Error('No valid enabled sections to export.')
  }

  const ffmpeg = await getFfmpeg(onProgress)

  const segmentNames = ranges.map((_, i) => `segment_${i}.mp4`)
  const inputName = 'input.mp4'
  const outputName = 'output.mp4'
  const concatName = 'concat.txt'

  try {
    onProgress(0)
    await ffmpeg.writeFile(inputName, await fetchFile(videoFile))

    for (let i = 0; i < ranges.length; i++) {
      const { startTime, endTime } = ranges[i]
      const duration = Math.max(0, endTime - startTime)
      if (duration <= 0) continue
      await ffmpeg.exec([
        '-i',
        inputName,
        '-ss',
        String(startTime),
        '-t',
        String(duration),
        // Re-encode to guarantee the first frame decodes immediately.
        // Stream copy can start on a non-keyframe → audio plays but video stays black until next keyframe.
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-reset_timestamps',
        '1',
        segmentNames[i],
      ])
    }

    const concatContent = segmentNames.map((name) => `file '${name}'`).join('\n')
    await ffmpeg.writeFile(concatName, concatContent)

    // Concatenating re-encoded segments is safest by re-muxing (stream copy) because codecs match.
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', concatName, '-c', 'copy', outputName])

    const data = await ffmpeg.readFile(outputName)
    onProgress(100)
    // Ensure we hand Blob an ArrayBuffer-backed view (not SharedArrayBuffer-backed).
    const bytes = new Uint8Array(data as Uint8Array)
    return new Blob([bytes], { type: 'video/mp4' })
  } finally {
    // Best-effort cleanup.
    try {
      await ffmpeg.deleteFile(inputName)
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(outputName)
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(concatName)
    } catch {
      // ignore
    }

    for (const name of segmentNames) {
      try {
        await ffmpeg.deleteFile(name)
      } catch {
        // ignore
      }
    }
  }
}
