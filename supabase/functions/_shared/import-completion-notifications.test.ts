import { describe, expect, it, vi } from 'vitest'
import { dispatchImportCompletionNotifications } from './import-completion-notifications'

const notice = {
  notification_id: 'notification-1', lease_token: 'lease-1', user_id: 'user-1',
  establishment_id: 'restaurant-1', title: 'Nhập dữ liệu hoàn tất',
  body: 'Mai Hương Restaurant\nĐã nhập 100 đánh giá',
}

describe('import completion push outbox', () => {
  it('sends the persisted localized notice with establishment deep-link and stable tag', async () => {
    const send = vi.fn().mockResolvedValue({ sent: 1, skipped: false })
    const finish = vi.fn()
    await dispatchImportCompletionNotifications({ claim: async () => [notice], send, finish })
    expect(send).toHaveBeenCalledExactlyOnceWith('user-1', {
      title: notice.title, body: notice.body,
      url: '#/etablissements/restaurant-1', tag: 'import-completed-notification-1',
    })
    expect(finish).toHaveBeenCalledWith(notice, 'sent')
  })
  it('does not send a second push when another invocation has claimed the notice', async () => {
    const send = vi.fn()
    await dispatchImportCompletionNotifications({ claim: async () => [], send, finish: vi.fn() })
    expect(send).not.toHaveBeenCalled()
  })
  it.each([
    [{ sent: 0, skipped: true }, 'skipped'],
    [{ sent: 0, skipped: false }, 'failed'],
    [{ sent: 1, skipped: false }, 'sent'],
  ] as const)('records delivery outcome %s', async (result, status) => {
    const finish = vi.fn()
    await dispatchImportCompletionNotifications({ claim: async () => [notice], send: async () => result, finish })
    expect(finish).toHaveBeenCalledWith(notice, status)
  })
  it('records provider failure without throwing or affecting import completion', async () => {
    const finish = vi.fn()
    await dispatchImportCompletionNotifications({
      claim: async () => [notice], send: async () => { throw new Error('private provider detail') }, finish,
    })
    expect(finish).toHaveBeenCalledWith(notice, 'failed')
  })
})
