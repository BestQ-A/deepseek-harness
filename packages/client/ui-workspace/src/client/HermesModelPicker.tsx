/** 基于目录显示配置路由；选择时原样回传 provider 与 model。 */
import { useId, useRef, useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './HermesModelPicker.module.css'

/** 模型目录提供的路由与可选声明，不包含实时验证结果。 */
export interface HermesModelCatalogItem {
  provider: string
  model: string
  label: string
  contextWindow?: number
  efforts?: readonly string[]
}

type Props = PropsLocale<'workspace'> & {
  catalog: readonly HermesModelCatalogItem[]
  provider: string
  model: string
  compact?: boolean
  onSelect: (provider: string, model: string) => void
}

function modelName(item: HermesModelCatalogItem): string {
  let name = item.label
  let previous: string
  do {
    previous = name
    name = name.replace(/\([^()]*\)|（[^（）]*）/g, '')
  } while (name !== previous)
  return name.trim() || item.model
}

function channelName(provider: string, t: Props['t']): string {
  if (provider === 'magpie') return t('hermes.model.channel.magpie')
  if (provider === 'magpie-responses') return t('hermes.model.channel.magpieResponses')
  if (provider === 'openai-codex') return t('hermes.model.channel.openaiCodex')
  if (provider === 'magpie-workbuddy') return t('hermes.model.channel.workbuddy')
  if (provider === 'agy') return t('hermes.model.channel.agy')
  if (provider === 'devin-acp') return t('hermes.model.channel.devinAcp')
  return provider || t('hermes.model.unset')
}

/**
 * 可搜索的内嵌模型目录；未知当前值保留显示且不会触发选择。
 * @param props - 目录、当前原始路由、翻译与现有保存回调。
 * @returns 主模型按钮、分组列表与当前配置来源明细。
 */
export function HermesModelPicker({ catalog, provider, model, compact = false, onSelect, t }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const current = catalog.find(item => item.provider === provider && item.model === model)
  const name = current === undefined ? model || t('hermes.model.unset') : modelName(current)
  const channel = channelName(provider, t)
  const slash = model.indexOf('/')
  const prefix = slash < 0 ? t('hermes.model.noPrefix') : model.slice(0, slash + 1)
  const needle = query.trim().toLocaleLowerCase()
  const groups = new Map<string, HermesModelCatalogItem[]>()
  for (const item of catalog) {
    const haystack = `${modelName(item)} ${item.provider} ${item.model} ${channelName(item.provider, t)}`.toLocaleLowerCase()
    if (needle !== '' && !haystack.includes(needle)) continue
    const items = groups.get(item.provider)
    if (items === undefined) groups.set(item.provider, [item])
    else items.push(item)
  }

  return (
    <div
      className={clsx(css.picker, compact && css.compact)}
      onKeyDown={(event) => {
        if (expanded && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setExpanded(false)
          trigger.current?.focus()
        }
      }}
    >
      <span id={`${id}-label`} className={css.label}>{t('hermes.model.label')}</span>
      <button
        ref={trigger}
        type="button"
        className={css.trigger}
        aria-labelledby={`${id}-label ${id}-current`}
        aria-expanded={expanded}
        aria-controls={`${id}-catalog`}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className={css.triggerContent}>
          <strong id={`${id}-current`}>{name}</strong>
          <span className={css.secondary}>{channel}</span>
          <code>{model || t('hermes.model.unset')}</code>
        </span>
        <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
      {current === undefined && <span className={css.secondary}>{t('hermes.model.notInCatalog')}</span>}

      {expanded && (
        <section id={`${id}-catalog`} aria-label={t('hermes.model.catalog')} className={css.catalog}>
          <div className={css.searchRow}>
            <input
              ref={search}
              type="search"
              aria-label={t('hermes.model.search')}
              placeholder={t('hermes.model.search')}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            {query !== '' && (
              <button
                type="button"
                className={css.clear}
                onClick={() => { setQuery(''); search.current?.focus() }}
              >
                {t('hermes.model.clear')}
              </button>
            )}
          </div>
          <div className={css.results}>
            {groups.size === 0 && <p role="status" className={css.secondary}>{t('hermes.model.noMatches')}</p>}
            {[...groups].map(([groupProvider, items]) => (
              <section key={groupProvider} aria-label={groupProvider} className={css.group}>
                <h4 className={css.groupHeading}>
                  <span>{channelName(groupProvider, t)}</span>
                  <code>{groupProvider}</code>
                </h4>
                <ul className={css.list}>
                  {items.map((item) => {
                    const selected = provider === item.provider && model === item.model
                    return (
                      <li key={JSON.stringify([item.provider, item.model])}>
                        <button
                          type="button"
                          className={css.option}
                          aria-pressed={selected}
                          onClick={() => {
                            onSelect(item.provider, item.model)
                            setExpanded(false)
                            setQuery('')
                            trigger.current?.focus()
                          }}
                        >
                          <span className={css.optionTitle}>
                            <strong>{modelName(item)}</strong>
                            {selected && <span className={css.selected}>{t('hermes.model.selected')}</span>}
                          </span>
                          <span className={css.secondary}>{channelName(item.provider, t)}</span>
                          <code>{item.model}</code>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </section>
      )}

      <dl className={css.details} aria-label={t('hermes.model.source')}>
        <div><dt>{t('hermes.model.name')}</dt><dd>{name}</dd></div>
        <div><dt>{t('hermes.model.channel')}</dt><dd>{channel}</dd></div>
        <div><dt>{t('hermes.model.providerId')}</dt><dd><code>{provider || t('hermes.model.unset')}</code></dd></div>
        <div><dt>{t('hermes.model.requestId')}</dt><dd><code>{model || t('hermes.model.unset')}</code></dd></div>
        <div><dt>{t('hermes.model.prefix')}</dt><dd><code>{prefix}</code></dd></div>
      </dl>
      {model.startsWith('group/') && <p className={css.notice}>{t('hermes.model.groupRoute')}</p>}
      <p className={css.notice}>{t('hermes.model.upstreamUnverified')}</p>
      <p className={css.notice}>{t('hermes.model.routeNotice')}</p>
      {current !== undefined && (current.contextWindow !== undefined || current.efforts !== undefined) && (
        <details className={css.declarations}>
          <summary>{t('hermes.model.declarations')}</summary>
          <dl className={css.details}>
            {current.contextWindow !== undefined && (
              <div><dt>{t('hermes.model.contextWindow')}</dt><dd><code>{current.contextWindow}</code></dd></div>
            )}
            {current.efforts !== undefined && (
              <div><dt>{t('hermes.model.efforts')}</dt><dd><code>{current.efforts.join(', ')}</code></dd></div>
            )}
          </dl>
        </details>
      )}
    </div>
  )
}
