/** Single flight for every refresh; foreground events additionally share a cooldown. */
export class RefreshGate {
  private pending?: Promise<void>
  private lastStarted = -Infinity
  run(task: () => Promise<void>, foreground = false, now = Date.now()) {
    if (this.pending) return this.pending
    if (foreground && now - this.lastStarted < 30_000) return Promise.resolve()
    this.lastStarted = now
    const pending = Promise.resolve().then(task).finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
    this.pending = pending
    return pending
  }
}
