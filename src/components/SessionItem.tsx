import { createSignal, Show } from 'solid-js'
import MoreDots from './icons/MoreDots'
import type { ChatSession } from '@/types'

interface SessionItemProps {
  session: ChatSession
  isActive: boolean
  onSelect: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}

export default (props: SessionItemProps) => {
  const [showMenu, setShowMenu] = createSignal(false)
  const [hovering, setHovering] = createSignal(false)

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = diff / (1000 * 60 * 60)

    if (hours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (hours < 24 * 7) {
      return date.toLocaleDateString([], { weekday: 'short' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  const handleDelete = (e: Event) => {
    e.stopPropagation()
    setShowMenu(false)
    props.onDelete(props.session.id)
  }

  const handleMenuClick = (e: Event) => {
    e.stopPropagation()
    setShowMenu(!showMenu())
  }

  const handleSessionClick = () => {
    props.onSelect(props.session.id)
  }

  return (
    <div
      class={`relative p-3 my-1 rounded-lg cursor-pointer transition-all duration-200 ${
        props.isActive
          ? 'bg-slate/20 border border-slate/30'
          : 'hover:bg-slate/10'
      }`}
      onClick={handleSessionClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false)
        setShowMenu(false)
      }}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate text-$c-fg">
            {props.session.title || 'New Chat'}
          </div>
          <div class="text-xs text-$c-fg/60 mt-1">
            {formatTime(props.session.updatedAt)}
          </div>
        </div>

        <Show when={hovering()}>
          <div class="relative">
            <button
              class={`p-1.5 rounded-md transition-all duration-200 ${
                showMenu() ? 'bg-slate/20' : 'hover:bg-slate/15'
              }`}
              onClick={handleMenuClick}
              title="More options"
            >
              <MoreDots />
            </button>

            <Show when={showMenu()}>
              <div
                class="absolute right-0 top-full mt-1 bg-$c-bg border border-slate/20 rounded-md shadow-lg z-50 min-w-32 overflow-hidden transition-all duration-200 scale-100 opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  class="w-full px-3 py-2 text-left text-sm hover:bg-slate/10 transition-colors text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}