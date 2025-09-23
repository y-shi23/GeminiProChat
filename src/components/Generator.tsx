import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { useThrottleFn } from 'solidjs-use'
import { generateSignature } from '@/utils/auth'
import IconClear from './icons/Clear'
import IconSend from './icons/Send'
import IconX from './icons/X'
// import Picture from './icons/Picture'
import MessageItem from './MessageItem'
import ErrorMessageItem from './ErrorMessageItem'
import type { ChatMessage, ErrorMessage } from '@/types'

export default () => {
  let inputRef: HTMLTextAreaElement
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([])
  const [currentError, setCurrentError] = createSignal<ErrorMessage>()
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>(null)
  // Auto-scroll to bottom when streaming; disables when user scrolls up
  const [isStick, setStick] = createSignal(true)
  // const [showComingSoon, setShowComingSoon] = createSignal(false)
  const maxHistoryMessages = parseInt(import.meta.env.PUBLIC_MAX_HISTORY_MESSAGES || '99')

  createEffect(() => (isStick() && smoothToBottom()))

  onMount(() => {
    let lastPostion = window.scrollY

    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY
      // If user scrolls up, disable stick
      if (nowPostion < lastPostion)
        setStick(false)

      // If user scrolls down and is near bottom, re-enable stick
      // More precise bottom detection
      const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 50)
      if (nowPostion >= lastPostion && nearBottom)
        setStick(true)

      lastPostion = nowPostion
    })

    try {
      if (localStorage.getItem('messageList'))
        setMessageList(JSON.parse(localStorage.getItem('messageList')))

      if (localStorage.getItem('stickToBottom') === 'stick')
        setStick(true)
    } catch (err) {
      console.error(err)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    })
  })

  const handleBeforeUnload = () => {
    localStorage.setItem('messageList', JSON.stringify(messageList()))
    isStick() ? localStorage.setItem('stickToBottom', 'stick') : localStorage.removeItem('stickToBottom')
  }

  const handleButtonClick = async() => {
    const inputValue = inputRef.value
    if (!inputValue)
      return

    inputRef.value = ''
    setMessageList(prev => ([
      ...prev,
      {
        role: 'user',
        content: inputValue,
      },
    ]))
    // Enable stick when user sends a message to ensure they see the response
    setStick(true)
    requestWithLatestMessage()
    // Ensure we start at the bottom when sending
    smoothToBottom()
  }

  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }, 100, false, true)

  const instantToBottom = () => {
    // Use standard behavior value 'auto' for immediate jump
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' })
  }

  // ? Interim Solution
  // ensure that the user and the model have a one-to-one conversation and avoid any errors like:
  // "Please ensure that multiturn requests ends with a user role or a function response."
  // convert the raw list into data that conforms to the interface api rules
  const convertReqMsgList = (originalMsgList: ChatMessage[]) => {
    return originalMsgList.filter((curMsg, i, arr) => {
      // Check if there is a next message
      const nextMsg = arr[i + 1]
      // Include the current message if there is no next message or if the roles are different
      return !nextMsg || curMsg.role !== nextMsg.role
    })
  }
  const requestWithLatestMessage = async() => {
    setLoading(true)
    setCurrentAssistantMessage('')
    setCurrentError(null)
    const storagePassword = localStorage.getItem('pass')
    try {
      const controller = new AbortController()
      setController(controller)
      const requestMessageList = messageList().map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })).slice(-maxHistoryMessages)
      const timestamp = Date.now()
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          messages: convertReqMsgList(requestMessageList),
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.parts[0]?.text || '',
          }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = await response.json()
        console.error(error.error)
        setCurrentError(error.error)
        throw new Error('Request failed')
      }
      const data = response.body
      if (!data)
        throw new Error('No data')

      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          const char = decoder.decode(value, { stream: true })
          if (char === '\n' && currentAssistantMessage().endsWith('\n'))
            continue

          if (char) {
            // Functional update prevents lost chunks on rapid updates
            setCurrentAssistantMessage(prev => prev + char)
            // Smoothly follow the stream when stick is enabled - more responsive
            if (isStick()) smoothToBottom()
          }
        }
        done = readerDone
      }
      if (done)
        setCurrentAssistantMessage(prev => prev + decoder.decode())
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentMessage()
    if (isStick()) smoothToBottom()
  }

  const archiveCurrentMessage = () => {
    if (currentAssistantMessage()) {
      setMessageList(prev => ([
        ...prev,
        {
          role: 'assistant',
          content: currentAssistantMessage(),
        },
      ]))
      setCurrentAssistantMessage('')
      setLoading(false)
      setController(null)
      // Ensure we scroll to bottom when message is complete
      if (isStick()) {
        setTimeout(() => smoothToBottom(), 50)
      }
      // Disable auto-focus on touch devices
      if (!('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0))
        inputRef.focus()
    }
  }

  const clear = () => {
    inputRef.value = ''
    inputRef.style.height = 'auto'
    setMessageList([])
    setCurrentAssistantMessage('')
    setCurrentError(null)
  }

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort()
      archiveCurrentMessage()
    }
  }

  const retryLastFetch = () => {
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1]
      if (lastMessage.role === 'assistant')
        setMessageList(messageList().slice(0, -1))
      requestWithLatestMessage()
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey)
      return

    if (e.key === 'Enter') {
      e.preventDefault()
      handleButtonClick()
    }
  }

  // const handlePictureUpload = () => {
  //   // coming soon
  //   setShowComingSoon(true)
  // }

  return (
    <div my-6>
      {/* beautiful coming soon alert box, position: fixed, screen center, no transparent background, z-index 100
      <Show when={showComingSoon()}>
        <div class="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-100">
          <div class="bg-white rounded-md shadow-md p-6">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-medium">Coming soon</h3>
              <button onClick={() => setShowComingSoon(false)}>
                <IconX />
              </button>
            </div>
            <p class="text-gray-500 mt-2">Chat with picture is coming soon!</p>
          </div>
        </div>
      </Show> */}

      <Index each={messageList()}>
        {(message, index) => (
          <MessageItem
            role={message().role}
            message={message().content}
            showRetry={() => (message().role === 'assistant' && index === messageList().length - 1)}
            onRetry={retryLastFetch}
          />
        )}
      </Index>
      {currentAssistantMessage() && (
        <MessageItem
          role="assistant"
          message={currentAssistantMessage}
        />
      )}
      {currentError() && <ErrorMessageItem data={currentError()} onRetry={retryLastFetch} />}
      {/* Fixed input area at bottom when messages exist */}
      <Show when={messageList().length > 0}>
        {/* Background fill between input and footer */}
        <div class="fixed bottom-0 left-0 right-0 h-8 z-5 bg-[var(--c-bg)]"></div>

        <div class="fixed bottom-8 left-0 right-0 z-10 bg-[var(--c-bg)] pt-2 pb-4">
          <div class="max-w-[70ch] mx-auto px-8">
            <Show
              when={!loading()}
              fallback={() => (
                <div class="gen-cb-wrapper">
                  <span>AI is thinking...</span>
                  <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
                </div>
              )}
            >
              <div class="gen-text-wrapper relative">
                {/* <button title="Picture" onClick={handlePictureUpload} class="absolute left-1rem top-50% translate-y-[-50%]">
                  <Picture />
                </button> */}
                <textarea
                  ref={inputRef!}
                  onKeyDown={handleKeydown}
                  placeholder="Enter something..."
                  autocomplete="off"
                  autofocus
                  onInput={() => {
                    inputRef.style.height = 'auto'
                    inputRef.style.height = `${inputRef.scrollHeight}px`
                  }}
                  rows="1"
                  class="gen-textarea"
                />
                <button onClick={handleButtonClick} gen-slate-btn title="Send">
                  <IconSend />
                </button>
                <button title="Clear" onClick={clear} gen-slate-btn>
                  <IconClear />
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Regular input area when no messages */}
      <Show when={messageList().length === 0}>
        <Show
          when={!loading()}
          fallback={() => (
            <div class="gen-cb-wrapper">
              <span>AI is thinking...</span>
              <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
            </div>
          )}
        >
          <div class="gen-text-wrapper relative">
            {/* <button title="Picture" onClick={handlePictureUpload} class="absolute left-1rem top-50% translate-y-[-50%]">
              <Picture />
            </button> */}
            <textarea
              ref={inputRef!}
              onKeyDown={handleKeydown}
              placeholder="Enter something..."
              autocomplete="off"
              autofocus
              onInput={() => {
                inputRef.style.height = 'auto'
                inputRef.style.height = `${inputRef.scrollHeight}px`
              }}
              rows="1"
              class="gen-textarea"
            />
            <button onClick={handleButtonClick} gen-slate-btn title="Send">
              <IconSend />
            </button>
            <button title="Clear" onClick={clear} gen-slate-btn>
              <IconClear />
            </button>
          </div>
        </Show>
      </Show>
      {/* <div class="fixed bottom-5 left-5 rounded-md hover:bg-slate/10 w-fit h-fit transition-colors active:scale-90" class:stick-btn-on={isStick()}>
        <div>
          <button class="p-2.5 text-base" title="stick to bottom" type="button" onClick={() => setStick(!isStick())}>
            <div i-ph-arrow-line-down-bold />
          </button>
        </div>
      </div> */}
    </div>
  )
}
