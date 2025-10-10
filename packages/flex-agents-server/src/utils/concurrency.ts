export class Semaphore {
  private available: number
  private queue: Array<() => void> = []
  private readonly capacity: number

  constructor(limit: number) {
    this.available = Math.max(1, Math.floor(limit || 1))
    this.capacity = this.available
  }

  get used() {
    return this.capacity - this.available
  }

  get pending() {
    return this.queue.length
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1
      return () => this.release()
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.available -= 1
    return () => this.release()
  }

  private release() {
    this.available += 1
    if (this.available > this.capacity) this.available = this.capacity
    const next = this.queue.shift()
    if (next) next()
  }
}

// Global semaphore for SSE-like long-running routes
const defaultLimit = Number.parseInt(process.env.SSE_CONCURRENCY || '4', 10)
export const sseSemaphore = new Semaphore(Number.isFinite(defaultLimit) ? defaultLimit : 4)

const parsedMax = Number.parseInt(process.env.SSE_MAX_PENDING || '32', 10)
export const SSE_MAX_PENDING = Number.isFinite(parsedMax) ? parsedMax : 32

export async function withSseConcurrency<T>(fn: () => Promise<T>) {
  const release = await sseSemaphore.acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

export function isBacklogFull() {
  return sseSemaphore.pending >= SSE_MAX_PENDING
}

export function backlogSnapshot() {
  return { used: sseSemaphore.used, pending: sseSemaphore.pending, limit: SSE_MAX_PENDING }
}
