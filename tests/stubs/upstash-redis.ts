export class Redis {
  constructor(_: unknown) {}
  async get(): Promise<null> { return null }
  async set(): Promise<void> {}
  async del(): Promise<void> {}
  async publish(): Promise<number> { return 1 }
}
