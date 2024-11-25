# Socketly

[![CodeQL Advanced](https://github.com/boddhi9/socketly/actions/workflows/codeql.yml/badge.svg)](https://github.com/boddhi9/socketly/actions/workflows/codeql.yml)

**Socketly** is a tiny, lightweight WebSocket library for TypeScript with built-in reconnect functionality and an event-driven API.

## Features

- 🔄 Automatic reconnection with configurable retries and exponential backoff
- 🎭 Event-driven API (`open`, `close`, `message`, `error`, `reconnect`)
- 🚀 Minimal and powerful
- 💪 TypeScript support
- 🔒 Secure connection handling
- 📊 Message queueing for offline scenarios
- 🔍 Detailed logging options

## Installation

```bash
npm install socketly
```

## Usage

### Basic Usage

```typescript
import { Socketly } from 'socketly'

const ws = new Socketly('wss://echo.websocket.org')

ws.on('open', () => {
  console.log('Connected to WebSocket')
  ws.send({ type: 'greeting', content: 'Hello, WebSocket!' })
})

ws.on('message', (data) => {
  console.log('Received message:', data)
})

ws.on('close', () => {
  console.log('WebSocket connection closed')
})

ws.on('error', (error) => {
  console.error('WebSocket error:', error)
})
```

### Advanced Usage

```typescript
import { Socketly } from 'socketly'

const ws = new Socketly('wss://echo.websocket.org', {
  reconnectInterval: 5000,
  maxRetries: 5,
  logger: console.log,
  protocols: ['protocol1', 'protocol2'],
})

ws.on('open', () => {
  console.log('Connected to WebSocket')
  ws.send({ type: 'greeting', content: 'Hello, WebSocket!' })
})

ws.on('message', (data) => {
  console.log('Received message:', data)
})

ws.on('close', () => {
  console.log('WebSocket connection closed')
})

ws.on('error', (error) => {
  console.error('WebSocket error:', error)
})

ws.on('reconnect', ({ attempt, delay }) => {
  console.log(`Reconnecting... Attempt ${attempt}, Delay: ${delay}ms`)
})

// Using the messages generator
;(async () => {
  for await (const message of ws.messages()) {
    console.log('Received message (via generator):', message)
  }
})()

// Check connection state
console.log('Is connected:', ws.isConnected())
console.log('Connection state:', ws.getState())

// Close the connection after 1 minute
setTimeout(() => {
  ws.close().then(() => console.log('WebSocket closed'))
}, 60000)
```

## API

### `Socketly`

#### Constructor

```typescript
new Socketly(url: string, options?: WebSocketOptions)
```

- `url`: The WebSocket server URL to connect to.
- `options`: (Optional) Configuration options for the WebSocket connection.

##### `WebSocketOptions`

- `reconnectInterval`: Time (in ms) between reconnection attempts (default: 3000).
- `maxRetries`: Maximum number of reconnection attempts (default: Infinity).
- `logger`: Custom logging function (default: console.log).
- `signal`: AbortSignal to control the connection externally.
- `protocols`: WebSocket sub-protocols to use.

#### Methods

- `on(event: WebSocketEvent, callback: EventCallback): void`: Add an event listener.
- `off(event: WebSocketEvent, callback: EventCallback): void`: Remove an event listener.
- `send(data: any): void`: Send data to the WebSocket server.
- `close(): Promise<void>`: Close the WebSocket connection.
- `messages(): AsyncIterable<any>`: Get an async iterator for incoming messages.
- `getState(): number`: Get the current WebSocket connection state.
- `isConnected(): boolean`: Check if the WebSocket is currently connected.

#### Events

- `'open'`: Fired when the connection is established.
- `'close'`: Fired when the connection is closed.
- `'message'`: Fired when a message is received.
- `'error'`: Fired when an error occurs.
- `'reconnect'`: Fired when attempting to reconnect.
- `'*'`: Fired for all events.
