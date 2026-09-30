export const REVIEW_PERSIST_BATCH_SIZE = 50

export function reviewPersistenceBatches<T>(items: readonly T[]): T[][] {
  const batches: T[][] = []
  for (let offset = 0; offset < items.length; offset += REVIEW_PERSIST_BATCH_SIZE) {
    batches.push(items.slice(offset, offset + REVIEW_PERSIST_BATCH_SIZE))
  }
  return batches
}
