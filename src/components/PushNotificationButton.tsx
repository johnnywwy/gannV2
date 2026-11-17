import { BellFilled, BellOutlined, LoadingOutlined } from '@ant-design/icons'
import { Button, Tooltip, message } from 'antd'
import { useEffect, useState } from 'react'

const PUSH_API = 'https://n1-longbridge.johnnywwy.com/api/push'

function decodeApplicationServerKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, character => character.charCodeAt(0))
}

async function getRegistration() {
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  return navigator.serviceWorker.ready
}

export default function PushNotificationButton() {
  const [messageApi, contextHolder] = message.useMessage()
  const [supported] = useState(() => (
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  ))
  const [loading, setLoading] = useState(false)
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    if (!supported) return
    void getRegistration()
      .then(registration => registration.pushManager.getSubscription())
      .then(subscription => setSubscribed(Boolean(subscription)))
  }, [supported])

  const testPush = async () => {
    const response = await fetch(`${PUSH_API}/test`, { method: 'POST' })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.message || '测试通知发送失败')
    if (payload.data?.sent > 0) messageApi.success('测试通知已提交，请查看系统通知')
    else if (payload.data?.removed > 0) {
      const registration = await getRegistration()
      await (await registration.pushManager.getSubscription())?.unsubscribe()
      setSubscribed(false)
      throw new Error('原订阅已失效，请重新开启推送')
    } else throw new Error(payload.data?.failed ? '推送发送失败，请稍后重试' : '没有有效推送订阅，请重新开启推送')
  }
  const testExistingPush = async () => {
    setLoading(true)
    try { await testPush() } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '测试通知失败')
    } finally { setLoading(false) }
  }

  const enablePush = async () => {
    setLoading(true)
    try {
      const configResponse = await fetch(`${PUSH_API}/config`, { cache: 'no-store' })
      const configPayload = await configResponse.json()
      if (!configResponse.ok || !configPayload?.data?.publicKey) throw new Error('后端推送尚未启用')

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('没有获得系统通知权限')
      const registration = await getRegistration()
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(configPayload.data.publicKey),
      })
      const saveResponse = await fetch(`${PUSH_API}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), platform: navigator.platform }),
      })
      if (!saveResponse.ok) throw new Error('保存推送订阅失败')
      setSubscribed(true)
      messageApi.success('手机推送已开启')
      await testPush()
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '开启推送失败')
    } finally {
      setLoading(false)
    }
  }

  const tooltip = supported
    ? (subscribed ? '数据更新完成后通知；点击可发送测试通知' : '开启扫描结果手机推送')
    : 'iPhone 请先用 Safari 添加到主屏幕，再从主屏幕打开'

  return (
    <>
      {contextHolder}
      <Tooltip title={tooltip}>
        <Button
          icon={loading ? <LoadingOutlined /> : subscribed ? <BellFilled /> : <BellOutlined />}
          disabled={!supported}
          loading={loading}
          onClick={() => void (subscribed ? testExistingPush() : enablePush())}
        >
          {subscribed ? '测试通知' : '开启推送'}
        </Button>
      </Tooltip>
    </>
  )
}
