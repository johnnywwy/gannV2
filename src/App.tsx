import { Button, ConfigProvider, Space, Typography } from 'antd'

function App() {
  return (
    <ConfigProvider>
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-slate-950">
        <section className="text-center">
          <Typography.Title level={1}>Gann V2</Typography.Title>
          <Typography.Paragraph className="text-base text-slate-600">
            Ant Design and Tailwind CSS are ready.
          </Typography.Paragraph>
          <Space>
            <Button type="primary">Ant Design</Button>
            <Button>Tailwind CSS</Button>
          </Space>
        </section>
      </main>
    </ConfigProvider>
  )
}

export default App
