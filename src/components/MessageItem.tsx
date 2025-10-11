import { createSignal } from 'solid-js'
import MarkdownIt from 'markdown-it'
import mdKatex from 'markdown-it-katex'
import mdHighlight from 'markdown-it-highlightjs'
import { useClipboard, useEventListener } from 'solidjs-use'
import IconRefresh from './icons/Refresh'
import IconCopy from './icons/Copy'
import type { Accessor } from 'solid-js'
import type { ChatMessage } from '@/types'

interface Props {
  role: ChatMessage['role']
  message: Accessor<string> | string
  showRetry?: Accessor<boolean>
  onRetry?: () => void
  parts?: Accessor<ChatMessage['parts']>
}

export default ({ role, message, showRetry, onRetry, parts }: Props) => {
  const roleClass = {
    system: 'bg-gradient-to-r from-gray-300 via-gray-200 to-gray-300',
    user: 'bg-gradient-to-r from-purple-400 to-yellow-400',
    assistant: 'bg-gradient-to-r from-yellow-200 via-green-200 to-green-300',
  }
  const [source] = createSignal('')
  const { copy } = useClipboard({ source, copiedDuring: 1000 })

  // Track per-button tooltip timers so only the clicked block shows "Copied"
  const tipTimers = new WeakMap<HTMLElement, number>()

  useEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest('div.copy-btn') as HTMLElement | null
    if (!btn) return

    const code = btn.dataset.code ? decodeURIComponent(btn.dataset.code) : ''
    if (!code) return

    copy(code)

    const tip = btn.querySelector('.gpt-copy-tips') as HTMLElement | null
    if (tip) {
      tip.textContent = 'Copied'
      const prev = tipTimers.get(btn)
      if (prev) window.clearTimeout(prev)
      const timer = window.setTimeout(() => {
        tip.textContent = 'Copy'
        tipTimers.delete(btn)
      }, 1000)
      tipTimers.set(btn, timer)
    }
  })

  const htmlString = () => {
    const md = MarkdownIt({
      linkify: true,
      breaks: true,
    }).use(mdKatex).use(mdHighlight)
    const fence = md.renderer.rules.fence!
    md.renderer.rules.fence = (...args) => {
      const [tokens, idx] = args
      const token = tokens[idx]
      const rawCode = fence(...args)

      return `<div relative>
      <div data-code=${encodeURIComponent(token.content)} class="copy-btn gpt-copy-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="currentColor" d="M28 10v18H10V10h18m0-2H10a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z" /><path fill="currentColor" d="M4 18H2V4a2 2 0 0 1 2-2h14v2H4Z" /></svg>
            <div class="gpt-copy-tips">Copy</div>
      </div>
      ${rawCode}
      </div>`
    }

    let text = ''

    // Get text from parts if available, otherwise use message prop
    if (parts) {
      const partsList = parts()
      text = partsList.map(p => p.text || '').join('')
    } else if (typeof message === 'function') {
      text = message()
    } else if (typeof message === 'string') {
      text = message
    }

    return md.render(text)
  }

  const renderImages = () => {
    if (!parts) return null

    const partsList = parts()
    const images = partsList.filter(p => p.image)

    if (images.length === 0) return null

    return (
      <div class="flex flex-wrap gap-2 mb-3">
        {images.map((img, index) => (
          <img
            src={img.image!.url}
            alt={img.image!.name}
            class="max-w-48 max-h-48 rounded-lg border border-gray-200 dark:border-gray-600 object-cover"
            title={img.image!.name}
          />
        ))}
      </div>
    )
  }

  const copyWholeMessage = () => {
    const text = typeof message === 'function' ? message() : (message || '')
    copy(text)
  }

  return (
    <div class="py-2 -mx-4 px-4 transition-colors md:hover:bg-slate/3 group">
      <div class="flex gap-3 rounded-lg" class:op-75={role === 'user'}>
        <div class={`shrink-0 w-7 h-7 mt-4 rounded-full op-80 ${roleClass[role]}`} />
        <div class="flex-1">
          {renderImages()}
          <div
            class="message prose break-words overflow-hidden"
            classList={{ 'msg-assistant': role === 'assistant', 'msg-user': role === 'user' }}
            innerHTML={htmlString()}
          />
        </div>
      </div>
      {role === 'assistant' && (
        <div class="fie gap-2 px-3 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button onClick={copyWholeMessage} class="gpt-retry-btn relative group/item" type="button">
            <IconCopy />
            <div class="group-hover/item:op-100 gpt-copy-tips-below select-none">Copy</div>
          </button>
          {showRetry?.() && onRetry && (
            <button onClick={onRetry} class="gpt-retry-btn relative group/item" type="button">
              <IconRefresh />
              <div class="group-hover/item:op-100 gpt-copy-tips-below select-none">Regenerate</div>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
