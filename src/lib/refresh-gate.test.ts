import { describe, expect, it, vi } from 'vitest'
import { RefreshGate } from './refresh-gate'

describe('foreground refresh gate', () => {
  it('shares one in-flight request and cools down focus/visibility for 30 seconds', async () => {
    const gate=new RefreshGate()
    let complete!:()=>void
    const task=vi.fn(()=>new Promise<void>(resolve=>{complete=resolve}))
    const first=gate.run(task,true,0)
    expect(gate.run(task,true,1)).toBe(first)
    await Promise.resolve()
    expect(task).toHaveBeenCalledTimes(1)
    complete();await first
    await gate.run(task,true,29_999)
    expect(task).toHaveBeenCalledTimes(1)
    const next=gate.run(task,true,30_000)
    await Promise.resolve();complete();await next
    expect(task).toHaveBeenCalledTimes(2)
  })
  it('permits explicit refresh/online recovery and releases failures', async () => {
    const gate=new RefreshGate(),task=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    await expect(gate.run(task,false,100)).rejects.toThrow('offline')
    await gate.run(task,false,101)
    expect(task).toHaveBeenCalledTimes(2)
  })
})
