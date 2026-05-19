import { Button, Card, Empty, Space, Steps, Tag } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'

function BacktestComingSoonPage() {
  return (
    <main className="min-h-screen bg-[#f5f5f5] px-3 pb-28 pt-3 sm:px-5 sm:pt-5">
      <section className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card styles={{ body: { minHeight: 420, display: 'grid', placeItems: 'center' } }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={8}>
                <span className="text-base font-medium text-slate-800">回溯测试暂未实现</span>
                <span className="max-w-md text-sm text-slate-500">
                  这里先放一个入口页面，后续可以接入策略参数、历史行情和交易结果统计。
                </span>
              </Space>
            }
          >
            <Button type="primary" icon={<ExperimentOutlined />} disabled>
              等待实现
            </Button>
          </Empty>
        </Card>

        <div className="flex flex-col gap-4">
          <Card size="small" title="模块状态">
            <Space size={[8, 8]} wrap>
              <Tag color="default">数据源未接入</Tag>
              <Tag color="default">策略未配置</Tag>
              <Tag color="default">报告未生成</Tag>
            </Space>
          </Card>

          <Card size="small" title="预计流程">
            <Steps
              direction="vertical"
              current={0}
              items={[
                { title: '选择标的', description: '股票、指数或自定义数据' },
                { title: '配置策略', description: '入场、止损、止盈和周期' },
                { title: '运行回测', description: '生成交易记录与指标' },
              ]}
            />
          </Card>
        </div>
      </section>
    </main>
  )
}

export default BacktestComingSoonPage
