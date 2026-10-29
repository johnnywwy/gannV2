const CACHE_NAME = 'longbridge-pwa-v1'

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  } catch {
    payload = { body: event.data?.text() || '新的扫描信号已经生成。' }
  }

  event.waitUntil(self.registration.showNotification(payload.title || '长桥信号扫描', {
    body: payload.body || '新的扫描信号已经生成。',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: payload.tag || 'longbridge-signal',
    renotify: true,
    data: { url: payload.url || './#/backtest' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || './#/backtest', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => client.url.startsWith(self.location.origin))
    if (existing) {
      await existing.navigate(targetUrl)
      return existing.focus()
    }
    return self.clients.openWindow(targetUrl)
  })())
})
