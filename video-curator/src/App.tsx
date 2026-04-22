import { RightPanel } from './components/RightPanel'
import { useCallback, useRef } from 'react'
import { Timeline } from './components/Timeline'
import { TranscriptPane, type TranscriptPaneHandle } from './components/TranscriptPane'
import { useStore } from './lib/store'
import { VideoPlayer, type VideoPlayerHandle } from './components/VideoPlayer'

function App() {
  const sections = useStore(s => s.sections)

  const videoPlayerRef = useRef<VideoPlayerHandle | null>(null)
  const transcriptRef = useRef<TranscriptPaneHandle | null>(null)

  const handleSeek = useCallback((t: number) => {
    videoPlayerRef.current?.seekTo(t)
  }, [])

  const handleSectionClick = useCallback((sectionId: number) => {
    const section = sections.find(s => s.id === sectionId)
    if (!section || section.items.length === 0) return
    const firstItem = section.items[0]
    transcriptRef.current?.scrollToSentence(firstItem.index)
    videoPlayerRef.current?.seekTo(firstItem.startTime)
  }, [sections])

  return (
    <div className="h-screen overflow-hidden bg-white text-gray-900">
      <div className="flex h-full">
        <main className="w-[65%] p-6">
          <div className="flex h-full flex-col gap-4">
            <VideoPlayer ref={videoPlayerRef} />

            <Timeline onSeek={handleSeek} onSectionClick={handleSectionClick} />

            <div className="min-h-0 flex-1">
              <TranscriptPane ref={transcriptRef} onSeek={handleSeek} className="h-full" />
            </div>
          </div>
        </main>

        <div className="w-[35%]">
          <RightPanel onSeek={handleSeek} />
        </div>
      </div>
    </div>
  )
}

export default App