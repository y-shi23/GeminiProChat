import { For, Show, createSignal, onMount, onCleanup } from 'solid-js'
import SessionItem from './SessionItem'
import type { ChatSession } from '@/types'

interface SidebarProps {
  sessions: ChatSession[]
  currentSessionId: string | null
  onSessionSelect: (sessionId: string) => void
  onSessionDelete: (sessionId: string) => void
  onNewSession: () => void
}

export default (props: SidebarProps) => {
  const [isVisible, setIsVisible] = createSignal(false)
  const [hoverTimeout, setHoverTimeout] = createSignal<number | null>(null)

  let sidebarRef: HTMLDivElement

  const showSidebar = () => {
    if (hoverTimeout()) {
      clearTimeout(hoverTimeout())
      setHoverTimeout(null)
    }
    setIsVisible(true)
  }

  const hideSidebar = () => {
    const timeout = setTimeout(() => {
      setIsVisible(false)
    }, 300)
    setHoverTimeout(timeout)
  }

  const handleMouseEnter = () => {
    if (hoverTimeout()) {
      clearTimeout(hoverTimeout())
      setHoverTimeout(null)
    }
  }

  onMount(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Show sidebar when mouse is near left edge (within 20px)
      if (e.clientX <= 20) {
        showSidebar()
      }
    }

    document.addEventListener('mousemove', handleMouseMove)

    onCleanup(() => {
      document.removeEventListener('mousemove', handleMouseMove)
      if (hoverTimeout()) {
        clearTimeout(hoverTimeout())
      }
    })
  })

  return (
    <>
      {/* Hover trigger area */}
      <div
        class="fixed left-0 top-0 w-5 h-full z-40 pointer-events-auto"
        onMouseEnter={showSidebar}
      />

      {/* Sidebar */}
      <div
        ref={sidebarRef!}
        class={`fixed left-4 top-4 bottom-4 w-80 bg-$c-bg rounded-xl shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
          isVisible() ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={hideSidebar}
      >
        <div class="flex flex-col h-full p-4">
          {/* Header */}
          <div class="mb-4">
            <button
              onClick={props.onNewSession}
              class="w-full px-4 py-3 bg-slate/15 hover:bg-slate/25 rounded-lg transition-all duration-200 text-sm font-medium text-$c-fg fcc gap-2"
            >
              <div class="w-4 h-4 fcc text-lg">+</div>
              New Chat
            </button>
          </div>

          {/* Sessions List */}
          <div class="flex-1 overflow-y-auto">
            <Show
              when={props.sessions.length > 0}
              fallback={
                <div class="p-4 text-center text-sm text-$c-fg/60">
                  No conversations yet.
                  <br />
                  Start a new chat to begin!
                </div>
              }
            >
              <For each={props.sessions}>
                {(session) => (
                  <SessionItem
                    session={session}
                    isActive={session.id === props.currentSessionId}
                    onSelect={props.onSessionSelect}
                    onDelete={props.onSessionDelete}
                  />
                )}
              </For>
            </Show>
          </div>

          {/* Footer */}
          <div class="mt-4 pt-2">
            <div class="text-xs text-$c-fg/50 text-center">
              {props.sessions.length} conversation{props.sessions.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Backdrop for mobile */}
      <Show when={isVisible()}>
        <div
          class="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={() => setIsVisible(false)}
        />
      </Show>
    </>
  )
}