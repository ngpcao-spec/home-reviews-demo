interface CompletionNotice {
  notification_id: string
  lease_token: string
  user_id: string
  establishment_id: string
  title: string
  body: string
}

interface Dependencies {
  claim: () => Promise<CompletionNotice[]>
  send: (userId: string, payload: { title: string; body: string; url: string; tag: string }) => Promise<{ sent: number; skipped: boolean }>
  finish: (notice: CompletionNotice, status: 'sent' | 'skipped' | 'failed') => Promise<void>
}

// No browser dependency, provider import, or AI. A delivery failure never fails an import.
export async function dispatchImportCompletionNotifications(deps: Dependencies) {
  const notices = await deps.claim()
  for (const notice of notices) {
    let status: 'sent' | 'skipped' | 'failed' = 'failed'
    try {
      const result = await deps.send(notice.user_id, {
        title: notice.title,
        body: notice.body,
        url: `#/etablissements/${notice.establishment_id}`,
        tag: `import-completed-${notice.notification_id}`,
      })
      status = result.skipped ? 'skipped' : result.sent > 0 ? 'sent' : 'failed'
    } catch { /* Save a safe error code, never subscription data or secrets. */ }
    await deps.finish(notice, status)
  }
  return notices.length
}
