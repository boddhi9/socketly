type WebSocketEvent = 'open' | 'close' | 'message' | 'error' | 'reconnect' | '*';
type EventCallback<T = any> = (data?: T) => void;
const MAX_DELAY = 30000;

interface WebSocketOptions {
  /**
   * Interval (in ms) between reconnect attempts.
   * @default 3000
   */
  reconnectInterval?: number;

  /**
   * Maximum number of reconnect attempts.
   * @default Infinity
   */
  maxRetries?: number;

  /**
   * Logger function to log WebSocket activity.
   * @default console.log
   */
  logger?: (message: string, ...data: any[]) => void;

  /**
   * AbortSignal to control the WebSocket lifecycle externally.
   */
  signal?: AbortSignal;

  /**
   * WebSocket protocols to use for the connection.
   */
  protocols?: string | string[];
}

export class Socketly {
  #url: string;
  #socket!: WebSocket;
  #reconnectInterval: number;
  #maxRetries: number;
  #retryCount = 0;
  #eventListeners: Map<WebSocketEvent, Set<EventCallback>> = new Map();
  #logger: (message: string, ...data: any[]) => void;
  #abortController: AbortController;
  #messageQueue: Array<string> = [];
  #protocols?: string | string[];

  /**
   * Creates a new Socketly instance.
   * @param url - The WebSocket URL to connect to.
   * @param options - Configuration options for the WebSocket connection.
   */
  constructor(url: string, options: WebSocketOptions = {}) {
    this.#url = url;
    this.#reconnectInterval = options.reconnectInterval ?? 3000;
    this.#maxRetries = options.maxRetries ?? Infinity;
    this.#logger = options.logger ?? console.log;
    this.#abortController = new AbortController();
    this.#protocols = options.protocols;

    options.signal?.addEventListener('abort', () => this.close());
    this.#connect();
  }

  /**
   * Establishes a WebSocket connection.
   */
  #connect(): void {
    this.#logger('Connecting to WebSocket:', this.#url);

    try {
      this.#socket = new WebSocket(this.#url, this.#protocols);

      this.#socket.addEventListener('open', this.#handleOpen);
      this.#socket.addEventListener('close', this.#handleClose);
      this.#socket.addEventListener('message', this.#handleMessage);
      this.#socket.addEventListener('error', this.#handleError);
    } catch (error: unknown) {
      this.#logger('WebSocket connection error:', error);
      this.#handleError(
        error instanceof Error ? error : new Error('An unknown error occurred')
      );
    }
  }

  /**
   * Handles the WebSocket `open` event.
   */
  #handleOpen = (): void => {
    this.#logger('WebSocket connected:', this.#url);
    this.#retryCount = 0;
    this.#flushMessageQueue();
    this.#emit('open');
  };

  /**
   * Handles the WebSocket `close` event.
   */
  #handleClose = (): void => {
    this.#logger('WebSocket closed:', this.#url);
    this.#emit('close');

    if (
      this.#retryCount < this.#maxRetries &&
      !this.#abortController.signal.aborted
    ) {
      const delay = this.#exponentialBackoff(this.#retryCount++);
      this.#logger(`Reconnecting in ${delay}ms (attempt ${this.#retryCount})`);
      this.#emit('reconnect', { attempt: this.#retryCount, delay });
      setTimeout(() => this.#connect(), delay);
    } else {
      this.#logger('Max reconnect attempts reached or connection aborted.');
    }
  };

  /**
   * Handles incoming WebSocket messages.
   * @param event - The WebSocket `message` event.
   */
  #handleMessage = (event: MessageEvent): void => {
    try {
      const data = JSON.parse(event.data);
      this.#logger('Message received:', data);
      this.#emit('message', structuredClone(data));
    } catch (error) {
      this.#logger('Error parsing message:', error);
      this.#handleError(
        error instanceof Error ? error : new Error('Failed to parse message')
      );
    }
  };

  /**
   * Handles WebSocket errors.
   * @param error - The error event or object.
   */
  #handleError = (error: Event | Error): void => {
    if (error instanceof Error) {
      this.#logger('WebSocket error (Error object):', error.message);
    } else if (error instanceof Event) {
      this.#logger('WebSocket error (Event):', error.type);
    } else {
      this.#logger('WebSocket error (Unknown):', error);
    }
    this.#emit('error', error);
  };

  /**
   * Flushes the message queue, sending messages once the WebSocket is open.
   */
  #flushMessageQueue(): void {
    while (
      this.#messageQueue.length > 0 &&
      this.#socket.readyState === WebSocket.OPEN
    ) {
      const message = this.#messageQueue.shift();
      if (message) this.#socket.send(message);
    }
  }

  /**
   * Emits an event to all registered listeners.
   * @param event - The event type.
   * @param data - Data to pass to the listeners.
   */
  #emit(event: WebSocketEvent, data?: any): void {
    this.#eventListeners.get(event)?.forEach((callback) => callback(data));
    this.#eventListeners
      .get('*')
      ?.forEach((callback) => callback({ event, data }));
  }

  /**
   * Calculates an exponential backoff delay for reconnection attempts.
   * @param attempt - The current reconnection attempt count.
   * @returns The backoff delay in milliseconds.
   */
  #exponentialBackoff(attempt: number): number {
    return Math.min(this.#reconnectInterval * Math.pow(2, attempt), MAX_DELAY);
  }

  /**
   * Registers an event listener.
   * @param event - The event type.
   * @param callback - The callback to invoke when the event is emitted.
   */
  public on<T = any>(event: WebSocketEvent, callback: EventCallback<T>): void {
    let listeners = this.#eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#eventListeners.set(event, listeners);
    }
    listeners.add(callback as EventCallback);
  }

  /**
   * Removes an event listener.
   * @param event - The event type.
   * @param callback - The callback to remove.
   */
  public off<T = any>(event: WebSocketEvent, callback: EventCallback<T>): void {
    this.#eventListeners.get(event)?.delete(callback as EventCallback);
  }

  /**
   * Sends data over the WebSocket connection.
   * @param data - The data to send.
   */
  public send(data: any): void {
    const message = JSON.stringify(data);
    if (this.#socket.readyState === WebSocket.OPEN) {
      this.#logger('Sending message:', message);
      this.#socket.send(message);
    } else {
      this.#logger('Queueing message as WebSocket is not open:', message);
      this.#messageQueue.push(message);
    }
  }

  /**
   * Closes the WebSocket connection and clears event listeners.
   */
  public async close(): Promise<void> {
    this.#logger('Closing WebSocket:', this.#url);
    this.#abortController.abort();

    await Promise.allSettled(
      Array.from(this.#eventListeners.values()).map((listeners) => {
        listeners.clear();
        return Promise.resolve();
      })
    );

    this.#socket.close();
  }

  /**
   * Returns an async iterator for WebSocket messages.
   */
  public async *messages(): AsyncIterable<any> {
    while (true) {
      yield await new Promise<any>((resolve) => {
        const onMessage = (data: any) => {
          this.off('message', onMessage);
          resolve(data);
        };
        this.on('message', onMessage);
      });
    }
  }

  /**
   * Gets the current WebSocket ready state.
   * @returns The ready state of the WebSocket connection.
   */
  public getState(): WebSocket['readyState'] {
    return this.#socket.readyState;
  }

  /**
   * Checks if the WebSocket is currently connected.
   * @returns True if the WebSocket is open, false otherwise.
   */
  public isConnected(): boolean {
    return this.#socket.readyState === WebSocket.OPEN;
  }
}
