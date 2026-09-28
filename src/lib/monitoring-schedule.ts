export const MONITORING_INTERVALS = [1, 3, 6, 12, 24] as const
export type MonitoringIntervalHours = typeof MONITORING_INTERVALS[number]

export function isMonitoringInterval(value: number): value is MonitoringIntervalHours {
  return MONITORING_INTERVALS.includes(value as MonitoringIntervalHours)
}

export function nextSyncAtFromLastSync(lastSyncAt: string | undefined, hours: number, now = Date.now()) {
  const lastSyncTimestamp = lastSyncAt ? new Date(lastSyncAt).getTime() : now
  const baseTimestamp = Number.isFinite(lastSyncTimestamp) ? lastSyncTimestamp : now
  return new Date(baseTimestamp + hours * 60 * 60 * 1_000).toISOString()
}
