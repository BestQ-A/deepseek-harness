// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HermesModelPicker, type HermesModelCatalogItem } from '../src/client/HermesModelPicker.tsx'
import { en, zh } from '../src/client/locales.ts'

const catalog: readonly HermesModelCatalogItem[] = [
  { provider: 'magpie', model: 'group/shared:model:v2', label: 'Shared Model (主力旗舰)', contextWindow: 1000000, efforts: ['high', 'max'] },
  { provider: 'magpie-workbuddy', model: 'group/shared:model:v2', label: 'Shared Model（免费图文）' },
  { provider: 'other-provider', model: 'auto/other', label: 'Other Model (用途（内部）)' },
]
const t = makeTranslate(zh)

afterEach(cleanup)

function mount(provider = 'magpie', model = 'group/shared:model:v2', compact = false) {
  const onSelect = vi.fn()
  const view = render(<HermesModelPicker catalog={catalog} provider={provider} model={model} compact={compact} onSelect={onSelect} t={t} />)
  return { onSelect, view }
}

function expand() {
  const trigger = screen.getByRole('button', { name: /主模型/ })
  fireEvent.click(trigger)
  return trigger
}

describe('Hermes model picker', () => {
  it('distinguishes identical model IDs by provider and preserves colon-containing IDs', () => {
    const { onSelect, view } = mount()
    const trigger = expand()
    const region = screen.getByRole('region', { name: '模型目录' })
    const options = within(region).getAllByRole('button', { name: /Shared Model/ })
    expect(options).toHaveLength(2)
    const magpie = within(region).getByRole('region', { name: 'magpie' })
    const workbuddy = within(region).getByRole('region', { name: 'magpie-workbuddy' })
    expect(within(magpie).getByRole('button', { name: /Shared Model/ }).getAttribute('aria-pressed')).toBe('true')
    const workbuddyOption = within(workbuddy).getByRole('button', { name: /Shared Model/ })
    expect(workbuddyOption.getAttribute('aria-pressed')).toBe('false')
    expect(workbuddyOption.textContent).toContain('WorkBuddy AI（国际版） / Magpie 网关')
    expect(region.textContent).not.toContain('免费')
    expect(region.textContent).not.toContain('主力旗舰')
    expect(region.textContent).not.toContain('内部')
    fireEvent.click(workbuddyOption)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('magpie-workbuddy', 'group/shared:model:v2')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    view.rerender(<HermesModelPicker catalog={catalog} provider="magpie-workbuddy" model="group/shared:model:v2" onSelect={onSelect} t={t} />)
    expand()
    const updatedRegion = screen.getByRole('region', { name: '模型目录' })
    expect(within(within(updatedRegion).getByRole('region', { name: 'magpie' })).getByRole('button', { name: /Shared Model/ }).getAttribute('aria-pressed')).toBe('false')
    expect(within(within(updatedRegion).getByRole('region', { name: 'magpie-workbuddy' })).getByRole('button', { name: /Shared Model/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it.each([
    { query: 'SHARED MODEL', expectedProviders: ['magpie', 'magpie-workbuddy'], expectedName: 'Shared Model', expectedModel: 'group/shared:model:v2' },
    { query: 'magpie-workbuddy', expectedProviders: ['magpie-workbuddy'], expectedName: 'Shared Model', expectedModel: 'group/shared:model:v2' },
    { query: 'group/shared:model:v2', expectedProviders: ['magpie', 'magpie-workbuddy'], expectedName: 'Shared Model', expectedModel: 'group/shared:model:v2' },
    { query: 'WorkBuddy AI（国际版）', expectedProviders: ['magpie-workbuddy'], expectedName: 'Shared Model', expectedModel: 'group/shared:model:v2' },
    { query: 'Other Model', expectedProviders: ['other-provider'], expectedName: 'Other Model', expectedModel: 'auto/other' },
  ])('searches names, providers, complete model IDs and channels: $query', ({ query, expectedProviders, expectedName, expectedModel }) => {
    mount()
    expand()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
    const region = screen.getByRole('region', { name: '模型目录' })
    const groups = within(region).getAllByRole('region')
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(expectedProviders)
    for (const group of groups) {
      const option = within(group).getByRole('button')
      expect(option.querySelector('strong')?.textContent).toBe(expectedName)
      expect(option.querySelector('code')?.textContent).toBe(expectedModel)
    }
  })

  it('offers clearing an empty search result without changing the current config', () => {
    const { onSelect } = mount()
    expand()
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'no-such-model' } })
    expect(screen.getByRole('status').textContent).toContain('没有匹配的模型')
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('status')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(search)
  })

  it('retains an unknown provider/model pair and labels it outside the catalog', () => {
    const { onSelect, view } = mount('unknown-provider:west', 'private/model:v3', true)
    expect(screen.getByText('不在当前目录')).toBeTruthy()
    expect(screen.getByLabelText('当前配置来源')).toBeTruthy()
    expect(view.container.textContent).toContain('unknown-provider:west')
    expect(view.container.textContent).toContain('private/model:v3')
    expect(screen.getByText('上游实际部署未核验')).toBeTruthy()
    expand()
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(3)
    view.rerender(<HermesModelPicker catalog={[...catalog]} provider="unknown-provider:west" model="private/model:v3" compact onSelect={onSelect} t={t} />)
    expect(screen.getByText('不在当前目录')).toBeTruthy()
    const source = screen.getByLabelText('当前配置来源')
    expect(within(source).getByText('unknown-provider:west', { selector: 'code' })).toBeTruthy()
    expect(within(source).getByText('private/model:v3', { selector: 'code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /主模型/ }).textContent).toContain('private/model:v3')
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(3)
    expect(screen.queryByRole('button', { pressed: true })).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes from Escape and returns focus to the model button', () => {
    mount()
    const trigger = expand()
    const search = screen.getByRole('searchbox')
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '模型目录' })).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('labels group routing, unverified upstream, and folded catalog declarations', () => {
    mount()
    expect(screen.getByText('路由组，实际模型由网关分配')).toBeTruthy()
    expect(screen.getByText('显示配置路由，不代表已通过连通性测试')).toBeTruthy()
    const summary = screen.getByText('目录声明，未经实时核验')
    expect(summary.closest('details')?.open).toBe(false)
    expect(screen.getByText('1000000')).toBeTruthy()
    expect(screen.getByText('high, max')).toBeTruthy()
  })

  it('uses the English dictionary without inferring a route for a model without a prefix', () => {
    const fullChannels: readonly HermesModelCatalogItem[] = [
      { provider: 'openai-codex', model: 'codex/gpt-6-astra', label: 'GPT-6 Astra' },
      { provider: 'magpie-responses', model: 'group/claude-fable-5-1', label: 'Codex Fable 5.1' },
      { provider: 'agy', model: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { provider: 'devin-acp', model: 'swe-2-max', label: 'Devin SWE-2 Max' },
    ]
    const view = render(<HermesModelPicker catalog={fullChannels} provider="other" model="plain:model" onSelect={vi.fn()} t={makeTranslate(en)} />)
    expect(screen.getByText('Not in the current catalog')).toBeTruthy()
    expect(screen.getByText('No prefix')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Main model/ }).textContent).toContain('plain:model')
    fireEvent.click(screen.getByRole('button', { name: /Main model/ }))
    expect(screen.getAllByText('S2 · OpenAI Codex Pro Subscription ($200/mo)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('S2 · Codex Responses routing group').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Antigravity Subscription (AGY · session-bound delta)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Devin Windsurf ACP (session-bound JSON-RPC)').length).toBeGreaterThan(0)
    view.rerender(<HermesModelPicker catalog={[]} provider="" model="" onSelect={vi.fn()} t={makeTranslate(en)} />)
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
  })
})
