export function reviewClassification(rating: number) {
  if (rating <= 2) {
    return {
      requires_attention: true,
      requires_ai_analysis: false,
      status: 'to_process',
    } as const
  }
  if (rating === 3) {
    return {
      requires_attention: false,
      requires_ai_analysis: true,
      status: 'new',
    } as const
  }
  return {
    requires_attention: false,
    requires_ai_analysis: false,
    status: 'ignored',
  } as const
}

