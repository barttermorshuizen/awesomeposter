declare const defineEventHandler: any
declare const defineNitroPlugin: any
declare function setHeader(event: any, name: string, value: string): void
declare function getHeader(event: any, name: string): string | undefined
declare function readBody<T = any>(event: any): Promise<T>
declare function createError(input: any): any
declare function sendRedirect(event: any, location: string, code?: number): any
