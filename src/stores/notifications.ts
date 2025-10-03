import { defineStore } from 'pinia'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastPayload {
  id?: string
  message: string
  kind?: ToastKind
  timeout?: number
}

export interface ToastEntry {
  id: string
  message: string
  kind: ToastKind
  timeout: number
}

const DEFAULT_TIMEOUT = 6000

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    toasts: [] as ToastEntry[],
  }),
  actions: {
    enqueue(payload: ToastPayload) {
      const id =
        payload.id ?? (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
      const kind: ToastKind = payload.kind ?? 'info'
      const timeout = typeof payload.timeout === 'number' ? payload.timeout : DEFAULT_TIMEOUT
      this.toasts.push({
        id,
        message: payload.message,
        kind,
        timeout,
      })
      return id
    },
    dismiss(id: string) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },
    notifyError(message: string, options?: { timeout?: number }) {
      return this.enqueue({ message, kind: 'error', timeout: options?.timeout })
    },
    notifySuccess(message: string, options?: { timeout?: number }) {
      return this.enqueue({ message, kind: 'success', timeout: options?.timeout })
    },
    notifyInfo(message: string, options?: { timeout?: number }) {
      return this.enqueue({ message, kind: 'info', timeout: options?.timeout })
    },
    clear() {
      this.toasts = []
    },
  },
})
