type WebSocketEvent = 'open' | 'close' | 'message' | 'error' | 'reconnect' | '*'
type EventCallback = (data?: any) => void
const MAX_DELAY = 30000

interface WebSocketOptions {
  reconnectInterval?: number
  maxRetries?: number
  logger?: (message: string, ...data: any[]) => void
  signal?: AbortSignal // optional external signal to control the connection
}

export class Socketly {
  #url: string
  #socket!: WebSocket
  #reconnectInterval: number
  #maxRetries: number
  #retryCount = 0
  #eventListeners: Map<WebSocketEvent, Set<EventCallback>> = new Map()
  #logger: (message: string, ...data: any[]) => void
  #abortController: AbortController
  #messageQueue: Array<string> = []

  constructor(url: string, options: WebSocketOptions = {}) {
    this.#url = url
    this.#reconnectInterval = options.reconnectInterval ?? 3000
    this.#maxRetries = options.maxRetries ?? Infinity
    this.#logger = options.logger ?? console.log
    this.#abortController = new AbortController()

    // listen for external abort signal
    options.signal?.addEventListener('abort', () => this.close())

    this.#connect()
  }

  #connect(): void {
    this.#logger('Connecting to WebSocket:', this.#url)

    try {
      this.#socket = new WebSocket(this.#url)

      this.#socket.addEventListener('open', () => {
        this.#logger('WebSocket connected:', this.#url)
        this.#retryCount = 0
        this.#flushMessageQueue()
        this.#emit('open')
      })

      this.#socket.addEventListener('close', () => this.#handleClose())
      this.#socket.addEventListener('message', (event) => {
        const data = JSON.parse(event.data)
        this.#logger('Message received:', data)
        this.#emit('message', structuredClone(data))
      })

      this.#socket.addEventListener('error', (event) =>
        this.#handleError(event)
      )
    } catch (error: unknown) {
      this.#logger('WebSocket connection error:', error)

      if (error instanceof Error) {
        this.#handleError(error)
      } else {
        this.#handleError(new Error('An unknown error occurred'))
      }
    }
  }

  #handleClose() {
    this.#logger('WebSocket closed:', this.#url)
    this.#emit('close')

    if (
      this.#retryCount < this.#maxRetries &&
      !this.#abortController.signal.aborted
    ) {
      const delay = this.#exponentialBackoff(this.#retryCount++)
      this.#logger(`Reconnecting in ${delay}ms (attempt ${this.#retryCount})`)
      this.#emit('reconnect')
      setTimeout(() => this.#connect(), delay)
    } else {
      this.#logger('Max reconnect attempts reached or connection aborted.')
    }
  }

  #handleError(error: Event | Error): void {
    if (error instanceof Error) {
      this.#logger('WebSocket error (Error object):', error.message)
    } else if (error instanceof Event) {
      this.#logger('WebSocket error (Event):', error.type)
    } else {
      this.#logger('WebSocket error (Unknown):', error)
    }
    this.#emit('error', error)
  }

  #flushMessageQueue(): void {
    while (
      this.#messageQueue.length > 0 &&
      this.#socket.readyState === WebSocket.OPEN
    ) {
      const message = this.#messageQueue.shift()
      if (message) this.#socket.send(message)
    }
  }

  #emit(event: WebSocketEvent, data?: any): void {
    if (event !== '*') {
      this.#eventListeners.get(event)?.forEach((callback) => callback(data))
    }
    this.#eventListeners
      .get('*')
      ?.forEach((callback) => callback({ event, data }))
  }

  #exponentialBackoff(attempt: number): number {
    const baseDelay = this.#reconnectInterval
    const maxDelay = MAX_DELAY
    return Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
  }

  public on(event: WebSocketEvent, callback: EventCallback): void {
    let listeners = this.#eventListeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.#eventListeners.set(event, listeners)
    }
    listeners.add(callback)
  }

  public off(event: WebSocketEvent, callback: EventCallback): void {
    this.#eventListeners.get(event)?.delete(callback)
  }

  public send(data: any): void {
    const message = JSON.stringify(data)
    if (this.#socket.readyState === WebSocket.OPEN) {
      this.#logger('Sending message:', message)
      this.#socket.send(message)
    } else {
      this.#logger('Queueing message as WebSocket is not open:', message)
      this.#messageQueue.push(message)
    }
  }

  public async close(): Promise<void> {
    this.#logger('Closing WebSocket:', this.#url)
    this.#abortController.abort()

    await Promise.allSettled(
      Array.from(this.#eventListeners.values()).map((listeners) => {
        listeners.clear()
      })
    )

    this.#socket.close()
  }

  public async *messages(): AsyncIterable<any> {
    while (true) {
      const message = await new Promise((resolve) => {
        this.on('message', resolve)
      })
      yield structuredClone(message)
    }
  }
}
