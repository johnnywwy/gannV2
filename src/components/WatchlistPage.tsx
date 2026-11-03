import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Label, TextField } from '@heroui/react'
import { saveKLineActiveSymbol } from '../utils/kLineStore'

type Stock = { id: number; symbol: string; name: string }
type Group = { id: number; name: string; stocks: Stock[] }
type SearchStock = { symbol: string; name: string; nameCn?: string; nameEn?: string }
const API = 'https://n1-longbridge.johnnywwy.com/api/local-watchlist'

export default function WatchlistPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchStock[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [groupEditor, setGroupEditor] = useState<'new' | number | null>(null)
  const [groupName, setGroupName] = useState('')
  const [quotes, setQuotes] = useState<Record<string, { price: string; previousClose: string }>>({})
  const navigate = useNavigate()
  const group = groups.find(item => item.id === selected) ?? groups[0]
  async function request(path = '', method = 'GET', body?: unknown) {
    const response = await fetch(API + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.message || '请求失败')
    return payload
  }
  async function load() {
    try { setGroups((await request()).data); setError('') } catch (e) { setError(String(e)) }
  }
  useEffect(() => { void request().then(data => setGroups(data.data)).catch(e => setError(String(e))) }, [])
  useEffect(() => {
    if (!adding || !query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      setSearchError('')
      void fetch(`https://n1-longbridge.johnnywwy.com/api/securities/search?q=${encodeURIComponent(query.trim())}&limit=20`, { signal: controller.signal })
        .then(async response => { const payload = await response.json(); if (!response.ok || !payload.success) throw new Error(payload.message || '搜索失败'); return payload.data as SearchStock[] })
        .then(items => { if (!controller.signal.aborted) setResults(items.filter(item => /\.(SH|SZ|US)$/.test(item.symbol))) })
        .catch(e => { if (!controller.signal.aborted) setSearchError(String(e)) })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [adding, query])
  useEffect(() => {
    const refresh = () => { void request('/quotes').then(result => setQuotes(Object.fromEntries(result.data.map((quote: { symbol: string; price: string; previousClose: string }) => [quote.symbol, quote])))).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    return () => clearInterval(timer)
  }, [groups])
  async function change(path: string, method: string, body?: unknown) {
    setBusy(true)
    try { await request(path, method, body); await load() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  function move(index: number, offset: number, type: 'stocks' | 'groups') {
    const items = [...(type === 'groups' ? groups : group?.stocks ?? [])]
    const next = index + offset
    if (next < 0 || next >= items.length) return
    ;[items[index], items[next]] = [items[next], items[index]]
    void change('/order', 'PUT', { type, groupId: group?.id, ids: items.map(item => item.id) })
  }
  return <main className="mx-auto min-h-screen max-w-4xl bg-background px-4 pb-36 pt-6 text-foreground">
    <header className="mb-5 flex items-center justify-between"><h1 className="text-2xl font-semibold">自选</h1><Button size="sm" variant="secondary" onPress={() => { setGroupEditor('new'); setGroupName('') }}>新建分组</Button></header>
    {groupEditor !== null && <form className="mb-4 flex items-end gap-2" onSubmit={event => { event.preventDefault(); if (!groupName.trim()) return; void change(groupEditor === 'new' ? '/groups' : `/groups/${groupEditor}`, groupEditor === 'new' ? 'POST' : 'PUT', { name: groupName.trim() }); setGroupEditor(null) }}><TextField className="min-w-0 flex-1" value={groupName} onChange={setGroupName}><Label>分组名称</Label><Input autoFocus maxLength={60} placeholder="输入分组名称" /></TextField><Button type="submit" size="sm" isDisabled={busy || !groupName.trim()}>保存</Button><Button size="sm" variant="ghost" onPress={() => setGroupEditor(null)}>取消</Button></form>}
    <div className="mb-3 flex items-center justify-between"><p className="text-xs text-muted">共享自选 · 行情来源：长桥</p><Button size="sm" variant="ghost" onPress={() => setEditing(!editing)}>{editing ? '完成' : '管理'}</Button></div>
    {error && <p role="alert" className="mb-3 text-danger">{error}</p>}
    <div className="mb-4 flex gap-2 overflow-x-auto" aria-label="自选分组">{groups.map(item => <Button key={item.id} aria-pressed={group?.id === item.id} size="sm" variant={group?.id === item.id ? 'primary' : 'ghost'} onPress={() => setSelected(item.id)}>{item.name}</Button>)}</div>
    {group && <>
      <Button size="sm" className="mb-3" onPress={() => { setAdding(!adding); setQuery(''); setResults([]); setSearchError('') }}>{adding ? '收起搜索' : '＋ 添加股票'}</Button>
      {adding && <section className="mb-4 rounded-2xl border border-separator bg-surface p-3">
        <TextField value={query} onChange={value => { setQuery(value); setResults([]) }}><Label>搜索股票</Label><Input autoFocus placeholder="输入代码或名称，如 600519、茅台、AAPL" /></TextField>
        <p className="mt-2 text-xs text-muted">添加到「{group.name}」· 选择结果即可添加</p>
        {searching && <p role="status" className="py-3 text-sm text-muted">正在搜索…</p>}
        {searchError && <p role="alert" className="py-3 text-sm text-danger">{searchError}</p>}
        {!searching && query.trim() && !results.length && !searchError && <p className="py-3 text-sm text-muted">未找到匹配股票</p>}
        <div className="max-h-72 overflow-y-auto">{results.map(stock => { const exists = group.stocks.some(item => item.symbol === stock.symbol); const name = stock.nameCn || stock.name || stock.nameEn || stock.symbol; return <Button key={stock.symbol} fullWidth variant="ghost" isDisabled={busy || exists} className="!h-auto min-h-14 justify-between rounded-lg py-2" onPress={() => void change(`/groups/${group.id}/stocks`, 'POST', { symbol: stock.symbol, name })}><span className="min-w-0 text-left"><span className="block truncate font-medium">{name}</span><span className="block text-xs text-muted">{stock.symbol}</span></span><span className="text-xs text-accent">{exists ? '已添加' : '添加'}</span></Button> })}</div>
      </section>}
      <div className={`mb-4 flex flex-wrap gap-2 ${editing ? '' : 'hidden'}`}>
        <Button size="sm" variant="ghost" onPress={() => { setGroupEditor(group.id); setGroupName(group.name) }}>改名</Button>
        <Button size="sm" variant="ghost" onPress={() => move(groups.indexOf(group), -1, 'groups')}>分组前移</Button>
        <Button size="sm" variant="ghost" onPress={() => move(groups.indexOf(group), 1, 'groups')}>分组后移</Button>
        <Button size="sm" variant="ghost" onPress={() => { if (confirm(`删除“${group.name}”及其中自选？`)) void change(`/groups/${group.id}`, 'DELETE') }}>删除分组</Button>
      </div>
      <div className="mb-1 grid grid-cols-[1fr_90px_80px] gap-2 border-b border-separator py-2 text-right text-xs text-muted"><span className="text-left">名称 / 代码</span><span>价格</span><span>涨跌幅</span></div>
      <div>{group.stocks.map((stock, index) => <div key={stock.id} className="flex items-center gap-2 border-b border-separator py-4 last:border-0">
        <button className="min-w-0 flex-1 text-left" onClick={() => { saveKLineActiveSymbol({ ticker: stock.symbol }); navigate('/kline') }}><span className="block font-semibold">{stock.name}</span><span className="text-xs text-muted">{stock.symbol}</span></button>
        {!editing && <><span className="w-[90px] text-right font-medium tabular-nums">{quotes[stock.symbol] ? Number(quotes[stock.symbol].price).toFixed(3) : '—'}</span><span className={`w-20 rounded-md px-1 py-2 text-center text-sm tabular-nums ${quotes[stock.symbol] ? Number(quotes[stock.symbol].price) >= Number(quotes[stock.symbol].previousClose) ? 'bg-danger text-white' : 'bg-success text-white' : 'text-muted'}`}>{quotes[stock.symbol] && Number(quotes[stock.symbol].previousClose) > 0 ? `${((Number(quotes[stock.symbol].price) / Number(quotes[stock.symbol].previousClose) - 1) * 100).toFixed(2)}%` : '暂无行情'}</span></>}
        {editing && <><Button size="sm" isIconOnly aria-label={`${stock.name}上移`} isDisabled={busy || index === 0} variant="ghost" onPress={() => move(index, -1, 'stocks')}>↑</Button>
        <Button size="sm" isIconOnly aria-label={`${stock.name}下移`} isDisabled={busy || index === group.stocks.length - 1} variant="ghost" onPress={() => move(index, 1, 'stocks')}>↓</Button>
        <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => { if (confirm(`删除 ${stock.name}？`)) void change(`/stocks/${stock.id}`, 'DELETE') }}>删除</Button></>}
      </div>)}</div>
      {!group.stocks.length && <p className="py-12 text-center text-muted">暂无自选，添加第一只股票</p>}
    </>}
  </main>
}
