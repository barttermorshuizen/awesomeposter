/* Vitest setup for JSDOM + Vuetify */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Use a non-conflicting class name and assign to global to avoid TS duplicate identifier issues
class FakeResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(_target?: Element): void {}
  unobserve(_target?: Element): void {}
  disconnect(): void {}
}

type GlobalLike = {
  ResizeObserver?: any
  matchMedia?: (query: string) => MediaQueryList
  requestAnimationFrame?: (cb: FrameRequestCallback) => number
  cancelAnimationFrame?: (id: number) => void
}

const g = globalThis as unknown as GlobalLike

// Polyfill ResizeObserver used by Vuetify if not present
if (!g.ResizeObserver) {
  g.ResizeObserver = FakeResizeObserver as any
}

// Mock matchMedia if missing (JSDOM)
if (!g.matchMedia) {
  g.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {}, // deprecated
      removeListener: () => {}, // deprecated
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

// requestAnimationFrame/cancelAnimationFrame
if (!g.requestAnimationFrame) {
  g.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0) as unknown as number
}
if (!g.cancelAnimationFrame) {
  g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as any)
}