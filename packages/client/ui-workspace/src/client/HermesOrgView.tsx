/**
 * Hermes × DSH Native UI Components for @deepseek-ai/dsh-client-ui-workspace:
 * 1. HermesPanelIcon — top-left `sidebar.panellist` navigation icon
 * 2. HermesSidebarOrgTree — collapsible 3-zone nested organization tree inside the left sidebar (`WorkspaceBrowser`)
 * 3. HermesCommandCenterPage — full-screen `main` panel hosting:
 *    - Tab 1: 83-Agent 3-Zone Nested Organization Tree (`Optix` 3 / `个人` 73 [`伴学` 37 · `万界` 35 · 直属 1] / `本机` 7) & `.agent-presets` Launcher
 *    - Tab 2: Feishu Dual-Tenant Event Gateway (`company` / `life` auto-wakeup, bot-loop guard, idempotency, cross-tenant block)
 *    - Tab 3: 6-Step Self-Reinforcement Loop Pipeline (BEFORE/AFTER/DIFF DocxXML + Feishu Trace + `1_personal/life-events.jsonl`)
 */
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StartSessionOptions } from './navigation.ts'
import { HermesModelPicker } from './HermesModelPicker.tsx'
import modelCss from './HermesModelPicker.module.css'
import {
  HERMES_INITIAL_AGENT_CONFIGS,
  HERMES_INITIAL_GATEWAY,
  HERMES_INITIAL_LOOP6,
  HERMES_INITIAL_SESSIONS,
  HERMES_INITIAL_WAR_ROOM,
  HERMES_ORG_TREE,
  type HermesAgentNode,
  type HermesBrigadeNode,
  type HermesOrgTreeData,
  type HermesSessionSummary,
  type HermesZoneNode,
} from './hermes-org-data.ts'

async function callHermesBridgeApi(payload: Record<string, unknown>): Promise<Record<string, any> | null> {
  try {
    const url = new URL('/hermes-bridge/api', window.location.origin).toString()
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dsh-hermes-bridge': '1',
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => null) as Record<string, any> | null
    if (!res.ok) {
      return data ?? { ok: false, status: res.status, error: `HTTP ${String(res.status)}` }
    }
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function normalizePathForMatch(p: string): string {
  return String(p || '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

function findMatchingWorkspaceId(
  workspaces: readonly WorkspaceView[],
  projectRoot: string,
): WorkspaceId | undefined {
  const target = normalizePathForMatch(projectRoot)
  if (!target) return undefined
  const exact = workspaces.find(w => normalizePathForMatch(w.path) === target)
  if (exact !== undefined) return exact.workspaceId
  const boundaryMatch = workspaces.find((w) => {
    const wp = normalizePathForMatch(w.path)
    return wp !== '' && target.startsWith(`${wp}/`)
  })
  return boundaryMatch?.workspaceId
}

function activateAgentMinimalChatMode(agent: HermesAgentNode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.dshChatMode = 'hermes'
    document.documentElement.dataset.dshActiveAgent = `${agent.title} (${agent.id})`
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dsh-hermes-chat-mode', {
      detail: { mode: 'hermes', agentId: agent.id, agentTitle: agent.title },
    }))
  }
}

function focusComposerInputSoon(): void {
  window.setTimeout(() => {
    const editable = document.querySelector<HTMLElement>('[contenteditable="true"]')
      ?? document.querySelector<HTMLTextAreaElement>('textarea')
    if (editable) {
      editable.focus()
    }
  }, 120)
}

function readPersistedAgentSessionMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem('dsh-hermes-agent-session-map-v1')
    return raw ? JSON.parse(raw) as Record<string, string> : {}
  } catch {
    return {}
  }
}

function readPersistedSessionToAgentMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem('dsh-hermes-session-to-agent-v1')
    return raw ? JSON.parse(raw) as Record<string, string> : {}
  } catch {
    return {}
  }
}

function readLastCommunicatedAgentId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage.getItem('dsh-hermes-last-agent-id') ?? undefined
  } catch {
    return undefined
  }
}

export function writePersistedAgentSession(agentId: string, sessionId: string, isNonBlank = true): void {
  if (typeof window === 'undefined') return
  try {
    const map = readPersistedAgentSessionMap()
    map[agentId] = sessionId
    map[`hermes-${agentId}`] = sessionId
    window.localStorage.setItem('dsh-hermes-agent-session-map-v1', JSON.stringify(map))
    const rev = readPersistedSessionToAgentMap()
    rev[sessionId] = agentId
    window.localStorage.setItem('dsh-hermes-session-to-agent-v1', JSON.stringify(rev))
    window.localStorage.setItem('dsh-hermes-last-agent-id', agentId)
    if (isNonBlank) {
      window.localStorage.setItem('dsh-hermes-last-session-id', sessionId)
    }
    // Sync this Agent <-> DSH persistent Session binding to the Host Feishu Bot Bridge
    void callHermesBridgeApi({
      op: 'feishuBindSession',
      agentId,
      dshSessionId: sessionId,
      autoSyncToFeishu: true,
    })
    // Also apply this Agent's configured model & reasoningEffort to the DSH Session
    void callHermesBridgeApi({
      op: 'applyAgentSessionConfig',
      agentId,
      sessionId,
    })
  } catch {
    // ignore storage errors
  }
}

function isPrimaryOwnerOfProjectRoot(agent: HermesAgentNode): boolean {
  return (
    agent.id === 'default'
    || agent.id === 'fit-lead-1013'
    || agent.id === 'bl-company-coordinator'
    || agent.id === 'wj-m01-producer'
    || agent.isCompanyHead
  )
}

export function findExistingAgentSession(
  sessions: SessionListState | undefined,
  archivedSessionIds: readonly SessionId[] | undefined,
  agent: HermesAgentNode,
  persistedMap?: Record<string, string>,
): SessionSummary | undefined {
  if (!sessions?.byId) return undefined
  const archived = new Set<string>(archivedSessionIds ?? [])
  const presetToken = agent.presetId || `hermes-${agent.id}`
  const map = persistedMap ?? readPersistedAgentSessionMap()
  const revMap = readPersistedSessionToAgentMap()
  const mappedId = map[agent.id] ?? map[presetToken]
  const mappedSession = mappedId === undefined ? undefined : sessions.byId[mappedId as SessionId]
  // Only return mappedSession immediately if it is an active NON-BLANK conversation session
  if (mappedSession !== undefined && !archived.has(mappedSession.id) && !mappedSession.blank) {
    return mappedSession
  }

  const all = Object.values(sessions.byId).filter(
    (s): s is SessionSummary =>
      s !== undefined
      && !archived.has(s.id)
      && (s as { subagent?: unknown }).subagent == null,
  )

  const idToken = `(${agent.id})`
  const titleToken = agent.title
  const normAgentRoot = normalizePathForMatch(agent.projectRoot)
  const isPrimaryOwner = isPrimaryOwnerOfProjectRoot(agent)

  const scoreCandidate = (s: SessionSummary): number => {
    const recPreset = s.projectionValues?.agentPreset
    if (recPreset === presetToken || recPreset === agent.id) return 3
    if (revMap[s.id] === agent.id) return 2
    const text = `${s.displayTitle ?? ''} ${s.title ?? ''}`
    if (text.includes(idToken) || text.includes(presetToken) || (titleToken.length >= 3 && text.includes(titleToken))) {
      return 2
    }
    if (!s.blank && isPrimaryOwner && normAgentRoot !== '' && normalizePathForMatch(s.cwd ?? '') === normAgentRoot) {
      if (typeof recPreset !== 'string' || recPreset === '' || recPreset === 'cordis') {
        return 1
      }
    }
    return 0
  }

  const candidates = all.filter(s => scoreCandidate(s) > 0)

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const scoreDiff = scoreCandidate(b) - scoreCandidate(a)
      if (scoreDiff !== 0) return scoreDiff
      if (a.blank !== b.blank) return a.blank ? 1 : -1
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })
    return candidates[0]
  }

  if (mappedSession !== undefined && !archived.has(mappedSession.id)) {
    return mappedSession
  }
  return undefined
}

function agentMatchesQuery(agent: HermesAgentNode, q: string, branchFilter = 'all'): boolean {
  if (branchFilter !== 'all') {
    if (branchFilter === 'staff') {
      if (agent.branch !== 'intel' && agent.branch !== 'logistics') return false
    } else if (agent.branch !== branchFilter) {
      return false
    }
  }
  if (!q) return true
  const haystack = `${agent.id} ${agent.title} ${agent.callsign ?? ''} ${agent.militaryRank ?? ''} ${agent.branchLabel ?? ''} ${agent.department} ${agent.sectionPath} ${agent.projectRoot} ${agent.description} ${agent.feishuProfile} ${agent.supervisor} ${agent.reviewer ?? ''}`.toLowerCase()
  return haystack.includes(q)
}

function zoneHasMatch(node: HermesZoneNode, q: string, branchFilter = 'all'): boolean {
  if (node.agents.some(a => agentMatchesQuery(a, q, branchFilter))) return true
  return node.children.some(child => zoneHasMatch(child, q, branchFilter))
}

function getRankVisualStyle(agent: HermesAgentNode): { bg: string, color: string, border: string, badge: string } {
  const tier = agent.rankTier ?? (agent.isCompanyHead || agent.id === 'default' ? 1 : 5)
  if (tier <= 2) {
    return {
      bg: 'rgba(245, 158, 11, 0.18)',
      color: '#d97706',
      border: 'rgba(245, 158, 11, 0.45)',
      badge: agent.rankBadge ?? '★★★',
    }
  }
  if (tier === 3) {
    return {
      bg: 'rgba(2, 132, 199, 0.16)',
      color: '#0284c7',
      border: 'rgba(2, 132, 199, 0.42)',
      badge: agent.rankBadge ?? '★★',
    }
  }
  if (agent.branch === 'mp') {
    return {
      bg: 'rgba(139, 92, 246, 0.16)',
      color: '#8b5cf6',
      border: 'rgba(139, 92, 246, 0.4)',
      badge: '🛡️',
    }
  }
  if (tier === 4) {
    return {
      bg: 'rgba(16, 185, 129, 0.15)',
      color: '#059669',
      border: 'rgba(16, 185, 129, 0.38)',
      badge: agent.rankBadge ?? '★',
    }
  }
  return {
    bg: 'rgba(148, 163, 184, 0.15)',
    color: 'var(--dsw-alias-label-secondary)',
    border: 'rgba(148, 163, 184, 0.28)',
    badge: agent.rankBadge ?? '▲',
  }
}

/** Decorative glyph for the `sidebar.panellist` row. */
export function HermesPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  const px = size ?? 16
  return (
    <svg width={px} height={px} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="6" y="1.5" width="4" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="10.5" width="3.6" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.2" y="10.5" width="3.6" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10.9" y="10.5" width="3.6" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.5V7.5M3.3 10.5V7.5H12.7V10.5M8 7.5V10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function SidebarAgentRow({
  agent,
  selected,
  existingSession,
  onSelectAgent,
  onStartAgentSession,
}: {
  agent: HermesAgentNode
  selected: boolean
  existingSession: SessionSummary | undefined
  onSelectAgent: (agent: HermesAgentNode) => void
  onStartAgentSession: (agent: HermesAgentNode, forceNew?: boolean) => void
}) {
  const isCommander = (agent.rankTier ?? 5) <= 3 || agent.isCompanyHead || agent.id === 'default'
  const rk = getRankVisualStyle(agent)
  const callsignText = agent.callsign ?? `${String(agent.seatOrder ?? 1).padStart(2, '0')}号`
  const subCount = agent.subordinateCount ?? agent.subordinateIds?.length ?? 0

  return (
    <div
      onClick={() => { onSelectAgent(agent) }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        padding: '4px 7px',
        marginTop: 2,
        borderRadius: 6,
        cursor: 'pointer',
        background: selected
          ? 'var(--dsw-alias-interactive-bg-active, rgba(2,132,199,0.15))'
          : isCommander
            ? 'rgba(245, 158, 11, 0.04)'
            : 'transparent',
        border: selected
          ? '1px solid rgba(2,132,199,0.5)'
          : isCommander
            ? '1px solid rgba(245, 158, 11, 0.2)'
            : '1px solid transparent',
        fontSize: 12,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: isCommander ? 700 : 500,
            color: 'var(--dsw-alias-label-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={`【${agent.militaryRank ?? '作战席位'} · ${callsignText}】${agent.title} (${agent.id})\n兵种: ${agent.branchLabel ?? agent.department}\n直属长官: ${agent.supervisor}${agent.reviewer ? ` ｜ 宪兵督察: ${agent.reviewer}` : ''}\n防区目录: ${agent.projectRoot}\n飞书加密频段: --profile ${agent.feishuProfile}${existingSession ? `\n常驻会话: ${existingSession.displayTitle || existingSession.id}` : ''}`}
        >
          <span
            style={{
              fontSize: 9.5,
              padding: '0 4px',
              borderRadius: 3,
              background: rk.bg,
              color: rk.color,
              border: `1px solid ${rk.border}`,
              fontWeight: 700,
              flex: 'none',
              fontFamily: 'monospace',
            }}
          >
            {rk.badge} {callsignText}
          </span>
          {existingSession !== undefined && (
            <span
              title="战备在线：已有常驻会话，点击直接续接"
              style={{ color: '#10b981', fontSize: 9, flex: 'none' }}
            >
              ●
            </span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.title}</span>
          {subCount > 0 && (
            <span
              title={`直辖下属 ${String(subCount)} 人`}
              style={{
                fontSize: 9.5,
                padding: '0 4px',
                borderRadius: 999,
                background: 'rgba(245, 158, 11, 0.16)',
                color: '#d97706',
                fontWeight: 700,
                flex: 'none',
              }}
            >
              统{subCount}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        title={existingSession
          ? `续接 ${agent.title} 的常驻作战室 (${existingSession.displayTitle || existingSession.id})`
          : `点将唤醒 ${agent.title} (${agent.id}) 开启专属会话 (${agent.projectRoot})`}
        onClick={(e) => {
          e.stopPropagation()
          onSelectAgent(agent)
          onStartAgentSession(agent, false)
        }}
        style={{
          flex: 'none',
          padding: '1px 6px',
          borderRadius: 4,
          border: existingSession
            ? '1px solid rgba(16, 185, 129, 0.45)'
            : '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.35))',
          background: existingSession ? 'rgba(16, 185, 129, 0.12)' : 'var(--dsw-alias-bg-layer-1, transparent)',
          color: existingSession ? '#059669' : 'var(--dsw-alias-label-secondary)',
          fontSize: 10.5,
          fontWeight: existingSession ? 700 : 600,
          cursor: 'pointer',
        }}
      >
        {existingSession ? '续接' : '点将'}
      </button>
    </div>
  )
}

function SidebarBrigadeGroup({
  brigade,
  query,
  branchFilter,
  selectedAgentId,
  activeSessionByAgentId,
  onSelectAgent,
  onStartAgentSession,
}: {
  brigade: HermesBrigadeNode
  query: string
  branchFilter: string
  selectedAgentId: string | undefined
  activeSessionByAgentId: ReadonlyMap<string, SessionSummary>
  onSelectAgent: (agent: HermesAgentNode) => void
  onStartAgentSession: (agent: HermesAgentNode, forceNew?: boolean) => void
}) {
  const [open, setOpen] = useState(true)
  const q = query.trim().toLowerCase()
  const matched = useMemo(
    () => brigade.agents.filter(a => agentMatchesQuery(a, q, branchFilter)),
    [brigade.agents, q, branchFilter],
  )
  if (matched.length === 0) return null

  return (
    <div
      style={{
        marginTop: 4,
        marginBottom: 4,
        marginLeft: 6,
        paddingLeft: 6,
        borderLeft: '1.5px dashed rgba(2, 132, 199, 0.35)',
      }}
    >
      <button
        type="button"
        onClick={() => { setOpen(v => !v) }}
        title={`${brigade.code} · ${brigade.name}\n主官: ${brigade.commanderTitle} (${brigade.commanderId})\n使命: ${brigade.mission}`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
          padding: '3px 6px',
          borderRadius: 5,
          border: '1px solid rgba(2, 132, 199, 0.22)',
          background: 'rgba(2, 132, 199, 0.06)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 9, opacity: 0.75 }}>{open ? '▾' : '▸'}</span>
          <span
            style={{
              fontSize: 9,
              padding: '0 4px',
              borderRadius: 3,
              background: 'rgba(2, 132, 199, 0.16)',
              color: '#0284c7',
              fontFamily: 'monospace',
              flex: 'none',
            }}
          >
            {brigade.code}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {brigade.name}
          </span>
        </span>
        <span
          style={{
            fontSize: 10,
            padding: '0 5px',
            borderRadius: 999,
            background: 'rgba(2, 132, 199, 0.14)',
            color: '#0284c7',
            flex: 'none',
          }}
        >
          {matched.length}人
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 2 }}>
          {matched.map(agent => (
            <SidebarAgentRow
              key={agent.id}
              agent={agent}
              selected={selectedAgentId === agent.id}
              existingSession={activeSessionByAgentId.get(agent.id)}
              onSelectAgent={onSelectAgent}
              onStartAgentSession={onStartAgentSession}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarZoneBranch({
  node,
  depth,
  query,
  branchFilter = 'all',
  groupByBrigade = true,
  selectedAgentId,
  activeSessionByAgentId,
  onSelectAgent,
  onStartAgentSession,
}: {
  node: HermesZoneNode
  depth: number
  query: string
  branchFilter?: string
  groupByBrigade?: boolean
  selectedAgentId: string | undefined
  activeSessionByAgentId: ReadonlyMap<string, SessionSummary>
  onSelectAgent: (agent: HermesAgentNode) => void
  onStartAgentSession: (agent: HermesAgentNode, forceNew?: boolean) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const q = query.trim().toLowerCase()
  const matchedAgents = useMemo(
    () => node.agents.filter(a => agentMatchesQuery(a, q, branchFilter)),
    [node.agents, q, branchFilter],
  )
  const visible = matchedAgents.length > 0 || node.children.some(c => zoneHasMatch(c, q, branchFilter))
  if ((q || branchFilter !== 'all') && !visible) return null

  const isOptix = node.feishuProfile === 'company'
  const zoneBadgeBg = isOptix ? 'rgba(234, 88, 12, 0.16)' : 'rgba(16, 185, 129, 0.16)'
  const zoneBadgeColor = isOptix ? '#ea580c' : '#059669'
  const hasBrigades = groupByBrigade && Array.isArray(node.brigades) && node.brigades.length > 1
  const theaterCode = node.theaterCode ?? (depth === 0 ? 'THEATER' : 'CORPS')

  return (
    <div
      style={{
        marginLeft: depth > 0 ? 10 : 0,
        paddingLeft: depth > 0 ? 7 : 0,
        borderLeft: depth > 0 ? '1.5px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.3))' : 'none',
        marginBottom: 5,
      }}
    >
      <button
        type="button"
        onClick={() => { setExpanded(v => !v) }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '5px 8px',
          borderRadius: 6,
          border: depth === 0 ? '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25))' : 'none',
          background: depth === 0 ? 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.1))' : 'rgba(148,163,184,0.05)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 10, opacity: 0.7 }}>{expanded ? '▾' : '▸'}</span>
          <span
            style={{
              fontSize: 9.5,
              padding: '0 4px',
              borderRadius: 3,
              background: depth === 0 ? 'rgba(245, 158, 11, 0.16)' : 'rgba(2, 132, 199, 0.15)',
              color: depth === 0 ? '#d97706' : '#0284c7',
              fontFamily: 'monospace',
              fontWeight: 700,
              flex: 'none',
            }}
          >
            {theaterCode}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.militaryTitle ?? node.name}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
          <span
            style={{
              fontSize: 10,
              padding: '0 5px',
              borderRadius: 4,
              background: zoneBadgeBg,
              color: zoneBadgeColor,
              fontWeight: 600,
            }}
          >
            {node.feishuProfile}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '0 6px',
              borderRadius: 999,
              background: 'var(--dsw-alias-bg-layer-3, rgba(148,163,184,0.2))',
              color: 'var(--dsw-alias-label-secondary)',
            }}
          >
            {node.totalCount}人
          </span>
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 2 }}>
          {node.children.map(child => (
            <SidebarZoneBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              query={query}
              branchFilter={branchFilter}
              groupByBrigade={groupByBrigade}
              selectedAgentId={selectedAgentId}
              activeSessionByAgentId={activeSessionByAgentId}
              onSelectAgent={onSelectAgent}
              onStartAgentSession={onStartAgentSession}
            />
          ))}
          {hasBrigades
            ? node.brigades!.map(bde => (
                <SidebarBrigadeGroup
                  key={bde.id}
                  brigade={bde}
                  query={query}
                  branchFilter={branchFilter}
                  selectedAgentId={selectedAgentId}
                  activeSessionByAgentId={activeSessionByAgentId}
                  onSelectAgent={onSelectAgent}
                  onStartAgentSession={onStartAgentSession}
                />
              ))
            : matchedAgents.map(agent => (
                <SidebarAgentRow
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgentId === agent.id}
                  existingSession={activeSessionByAgentId.get(agent.id)}
                  onSelectAgent={onSelectAgent}
                  onStartAgentSession={onStartAgentSession}
                />
              ))}
        </div>
      )}
    </div>
  )
}

/**
 * Embedded 3-zone nested organization tree for the left sidebar (`WorkspaceBrowser`).
 */
export function HermesSidebarOrgTree({
  workspaces,
  sessions,
  archivedSessionIds,
  openSession,
  startSession,
  createWorkspace,
  onOpenCommandCenter,
  t,
}: PropsLocale<'workspace'> & {
  workspaces: readonly WorkspaceView[]
  sessions?: SessionListState | undefined
  archivedSessionIds?: readonly SessionId[] | undefined
  openSession?: ((sessionId: SessionId) => void) | undefined
  startSession: (workspaceId?: WorkspaceId, options?: StartSessionOptions) => void
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  onOpenCommandCenter?: (() => void) | undefined
}) {
  const [treeData, setTreeData] = useState<HermesOrgTreeData>(HERMES_ORG_TREE)
  const [query, setQuery] = useState('')
  const [sidebarBranchFilter, setSidebarBranchFilter] = useState<string>('all')
  const [sidebarGroupByBrigade, setSidebarGroupByBrigade] = useState<boolean>(true)
  const [selectedAgent, setSelectedAgent] = useState<HermesAgentNode | undefined>(() => {
    const flat: HermesAgentNode[] = []
    const walk = (n: HermesZoneNode) => {
      flat.push(...n.agents)
      n.children.forEach(walk)
    }
    HERMES_ORG_TREE.roots.forEach(walk)
    const lastId = readLastCommunicatedAgentId()
    if (lastId) {
      const found = flat.find(a => a.id === lastId)
      if (found !== undefined) return found
    }
    const localRoot = HERMES_ORG_TREE.roots.find(r => r.name === '本机')
    return localRoot?.agents.find(a => a.id === 'default') ?? HERMES_ORG_TREE.roots[0]?.agents[0]
  })
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [bindingTick, setBindingTick] = useState(0)
  const hasAutoRestoredOnEntryRef = useRef(false)
  const [showSessionOptionsInAgentMode, setShowSessionOptionsInAgentMode] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.dataset.dshChatMode === 'sessions'
  })
  const [agentConfigsData, setAgentConfigsData] = useState<Record<string, any>>(
    () => (HERMES_INITIAL_AGENT_CONFIGS as Record<string, any>) ?? {},
  )
  const [showSidebarParamDrawer, setShowSidebarParamDrawer] = useState(false)
  const [surgeryStatus, setSurgeryStatus] = useState<Record<string, any> | null>(null)
  const [surgeryBusy, setSurgeryBusy] = useState(false)

  const isSurgeryPodWindow = useMemo(() => {
    if (surgeryStatus?.currentProcess?.isSurgeryPod) return true
    if (typeof window === 'undefined') return false
    return window.location.port === '17580' || window.location.search.includes('surgeryPod=1')
  }, [surgeryStatus])

  const selectedAgentConfig = useMemo(() => {
    const id = selectedAgent?.id ?? 'default'
    return agentConfigsData?.configs?.[id] ?? {
      agentId: id,
      provider: 'magpie',
      model: 'group/claude-fable-5-1',
      reasoningEffort: 'high',
      permissionPreset: 'danger-full-access',
      ensembleMode: 'single',
      moaPreset: 'council',
      fusionPreset: 'trinity',
    }
  }, [agentConfigsData, selectedAgent?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onBound = () => { setBindingTick(t => t + 1) }
    const onMode = (e: Event) => {
      const mode = (e as CustomEvent<{ mode?: string }>).detail?.mode
      if (mode === 'sessions' || mode === 'hermes') {
        setShowSessionOptionsInAgentMode(mode === 'sessions')
      }
    }
    window.addEventListener('dsh-hermes-session-bound', onBound)
    window.addEventListener('dsh-hermes-chat-mode', onMode)
    return () => {
      window.removeEventListener('dsh-hermes-session-bound', onBound)
      window.removeEventListener('dsh-hermes-chat-mode', onMode)
    }
  }, [])

  useEffect(() => {
    void callHermesBridgeApi({ op: 'orgTree' }).then((res) => {
      if (res?.ok && res.tree?.roots) {
        setTreeData(res.tree as HermesOrgTreeData)
      }
    })
    void callHermesBridgeApi({ op: 'agentConfigs' }).then((res) => {
      if (res?.ok && res.configs) {
        setAgentConfigsData(res)
      }
    })
    void callHermesBridgeApi({ op: 'surgeryPodStatus' }).then((res) => {
      if (res?.ok) {
        setSurgeryStatus(res)
      }
    })
    const isPodUrl = typeof window !== 'undefined' && (window.location.port === '17580' || window.location.search.includes('surgeryPod=1'))
    if (!isPodUrl) {
      // Ensure Feishu dual-tenant event gateway (life & company) and War Room (:18765) are running on Main Desktop startup
      void callHermesBridgeApi({ op: 'gatewayStart', profile: 'life', eventKey: 'im.message.receive_v1', autoDispatch: true, dryRun: false })
      void callHermesBridgeApi({ op: 'gatewayStart', profile: 'company', eventKey: 'im.message.receive_v1', autoDispatch: true, dryRun: false })
    }
    void callHermesBridgeApi({ op: 'warRoomStartServer' })
  }, [])

  const allAgents = useMemo(() => {
    const list: HermesAgentNode[] = []
    const walk = (node: HermesZoneNode) => {
      list.push(...node.agents)
      node.children.forEach(walk)
    }
    treeData.roots.forEach(walk)
    return list
  }, [treeData.roots])

  const primaryAgents = useMemo(() => {
    const wanted = ['default', 'fit-lead-1013', 'bl-company-coordinator', 'wj-m01-producer']
    return wanted
      .map(id => allAgents.find(a => a.id === id))
      .filter((a): a is HermesAgentNode => a !== undefined)
  }, [allAgents])

  const activeSessionByAgentId = useMemo(() => {
    void bindingTick
    const persisted = readPersistedAgentSessionMap()
    const map = new Map<string, SessionSummary>()
    for (const agent of allAgents) {
      const found = findExistingAgentSession(sessions, archivedSessionIds, agent, persisted)
      if (found !== undefined) {
        map.set(agent.id, found)
      }
    }
    return map
  }, [allAgents, archivedSessionIds, bindingTick, sessions])

  const handleSaveSidebarAgentConfig = useCallback(async (patch: Record<string, unknown>) => {
    if (!selectedAgent) return
    const activeSess = activeSessionByAgentId.get(selectedAgent.id)
    const nextCfg = {
      ...selectedAgentConfig,
      ...patch,
      agentId: selectedAgent.id,
      sessionId: activeSess?.id ?? '',
    }
    setAgentConfigsData(prev => ({
      ...prev,
      configs: {
        ...(prev?.configs ?? {}),
        [selectedAgent.id]: nextCfg,
      },
    }))
    const res = await callHermesBridgeApi({
      op: 'updateAgentConfig',
      ...nextCfg,
    })
    if (res?.ok && res.config) {
      setStatusNotice(
        `✓ 已保存 ${selectedAgent.title} 参数：${String(res.config.model)} [${String(res.config.reasoningEffort)}] · 模式=${String(res.config.ensembleMode).toUpperCase()}`,
      )
    }
  }, [activeSessionByAgentId, selectedAgent, selectedAgentConfig])

  // Auto-restore the last communicated Agent and its previous conversation session on entering DSH
  useEffect(() => {
    if (hasAutoRestoredOnEntryRef.current) return
    if (!sessions || sessions.phase !== 'ready' || allAgents.length === 0) return
    hasAutoRestoredOnEntryRef.current = true

    const currentMain = Object.values(sessions.byId).find(
      (s): s is SessionSummary => s !== undefined && (s.retainedBy.mainView ?? 0) > 0,
    )

    // 0. If opened in Surgery Pod with an explicit ?sessionId=<id> handoff parameter, open it directly!
    if (typeof window !== 'undefined' && openSession !== undefined) {
      try {
        const params = new URLSearchParams(window.location.search)
        const handoffId = params.get('sessionId')
        if (handoffId && sessions.byId[handoffId as SessionId]) {
          openSession(handoffId as SessionId)
          setStatusNotice(`🩺 已接入独立手术舱会话 (${handoffId})`)
          return
        }
      } catch {
        // ignore URL parse error
      }
    }

    let targetAgent: HermesAgentNode | undefined
    let targetSession: SessionSummary | undefined

    // 1. Check explicitly remembered last communicated agent
    const rememberedAgentId = readLastCommunicatedAgentId()
    if (rememberedAgentId) {
      const candidateAgent = allAgents.find(a => a.id === rememberedAgentId)
      const candidateSession = candidateAgent ? activeSessionByAgentId.get(candidateAgent.id) : undefined
      if (candidateAgent !== undefined && candidateSession !== undefined && !candidateSession.blank) {
        targetAgent = candidateAgent
        targetSession = candidateSession
      }
    }

    // 2. If current main session is already a non-blank conversation owned by an agent, honor it
    if (targetAgent === undefined && currentMain !== undefined && !currentMain.blank) {
      for (const agent of allAgents) {
        if (activeSessionByAgentId.get(agent.id)?.id === currentMain.id) {
          targetAgent = agent
          targetSession = currentMain
          break
        }
      }
    }

    // 3. Otherwise pick the agent with the most recently updated non-blank conversation session
    if (targetAgent === undefined) {
      let latestUpdatedAt = Number.NEGATIVE_INFINITY
      for (const agent of allAgents) {
        const s = activeSessionByAgentId.get(agent.id)
        if (s !== undefined && !s.blank && (s.updatedAt ?? 0) > latestUpdatedAt) {
          latestUpdatedAt = s.updatedAt ?? 0
          targetAgent = agent
          targetSession = s
        }
      }
    }

    if (targetAgent !== undefined && targetSession !== undefined) {
      setSelectedAgent(targetAgent)
      activateAgentMinimalChatMode(targetAgent)
      writePersistedAgentSession(targetAgent.id, targetSession.id, !targetSession.blank)
      if (openSession !== undefined && (currentMain === undefined || currentMain.blank || currentMain.id !== targetSession.id)) {
        openSession(targetSession.id)
      }
      setStatusNotice(`✓ 已自动恢复与 ${targetAgent.title} 的上次对话`)
    }
  }, [activeSessionByAgentId, allAgents, openSession, sessions])

  // Keep selectedAgent and persisted mapping synced whenever the active non-blank mainView session changes
  useEffect(() => {
    if (!sessions?.byId || allAgents.length === 0) return
    const currentMain = Object.values(sessions.byId).find(
      (s): s is SessionSummary => s !== undefined && (s.retainedBy.mainView ?? 0) > 0,
    )
    if (currentMain === undefined || currentMain.blank) return

    const revMap = readPersistedSessionToAgentMap()
    const mappedAgentId = revMap[currentMain.id]
    const preset = currentMain.projectionValues?.agentPreset
    const presetAgentId = typeof preset === 'string' && preset.startsWith('hermes-')
      ? preset.slice('hermes-'.length)
      : undefined

    let ownerAgent = (mappedAgentId ? allAgents.find(a => a.id === mappedAgentId) : undefined)
      ?? (presetAgentId ? allAgents.find(a => a.id === presetAgentId) : undefined)

    if (ownerAgent === undefined) {
      for (const agent of allAgents) {
        if (activeSessionByAgentId.get(agent.id)?.id === currentMain.id) {
          ownerAgent = agent
          break
        }
      }
    }

    if (ownerAgent !== undefined) {
      writePersistedAgentSession(ownerAgent.id, currentMain.id, true)
      setSelectedAgent(prev => (prev?.id === ownerAgent.id ? prev : ownerAgent))
      if (typeof document !== 'undefined' && document.documentElement.dataset.dshChatMode !== 'sessions') {
        document.documentElement.dataset.dshActiveAgent = `${ownerAgent.title} (${ownerAgent.id})`
      }
    }
  }, [activeSessionByAgentId, allAgents, sessions])

  const handleStartAgentSession = useCallback(async (agent: HermesAgentNode, forceNew = false) => {
    try {
      activateAgentMinimalChatMode(agent)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('dsh-hermes-last-agent-id', agent.id)
        } catch {
          // ignore
        }
      }
      const existing = !forceNew ? activeSessionByAgentId.get(agent.id) : undefined
      if (existing !== undefined && openSession !== undefined) {
        writePersistedAgentSession(agent.id, existing.id, !existing.blank)
        openSession(existing.id)
        setStatusNotice(`✓ 已续接 ${agent.title} 常驻对话`)
        focusComposerInputSoon()
        return
      }

      const presetId = agent.presetId || `hermes-${agent.id}`
      let wsId = findMatchingWorkspaceId(workspaces, agent.projectRoot)
      if (wsId === undefined && agent.projectRoot) {
        try {
          const created = await createWorkspace({ path: agent.projectRoot })
          wsId = created.workspaceId
        } catch {
          wsId = workspaces[0]?.workspaceId
        }
      }
      if (wsId === undefined) {
        wsId = workspaces[0]?.workspaceId
      }
      startSession(wsId, {
        agentPreset: presetId,
        clearPreviousDraft: true,
      })
      setStatusNotice(`✓ 已就绪：直接与 ${agent.title} 对话（已绑定预设设定）`)
      focusComposerInputSoon()
    } catch (err) {
      setStatusNotice(`启动失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [activeSessionByAgentId, createWorkspace, openSession, startSession, workspaces])

  const defaultSteward = useMemo(
    () => primaryAgents.find(a => a.id === 'default') ?? allAgents[0],
    [allAgents, primaryAgents],
  )

  const handlePopSurgeryPod = useCallback(async (handoffCurrent = false) => {
    if (surgeryBusy) return
    setSurgeryBusy(true)
    const targetAgent = selectedAgent ?? defaultSteward
    const currentSess = targetAgent ? activeSessionByAgentId.get(targetAgent.id) : undefined
    const handoffSessionId = handoffCurrent && currentSess ? currentSess.id : ''
    setStatusNotice(
      handoffSessionId
        ? `🩺 正在将 ${targetAgent?.title ?? '当前智能体'} 会话 (${handoffSessionId}) 接力并弹出独立热手术进程 (:17580)…`
        : '🩺 正在拉起独立热手术伴生进程 (:17580) 并弹出独立编程窗口…',
    )
    try {
      const res = await callHermesBridgeApi({
        op: 'surgeryPodStart',
        openWindow: true,
        agentId: targetAgent?.id ?? 'default',
        handoffSessionId,
      })
      if (res?.ok) {
        setSurgeryStatus(res)
        setStatusNotice(
          `✓ 独立热手术舱 (:17580 · PID=${String(res.surgeryPod?.pid ?? 'N/A')}) 已弹出独立窗口${handoffSessionId ? '（已完成会话接力）' : ''}`,
        )
      } else {
        setStatusNotice(`独立热手术进程启动失败: ${String(res?.error ?? '未知错误')}`)
      }
    } finally {
      setSurgeryBusy(false)
    }
  }, [activeSessionByAgentId, defaultSteward, selectedAgent, surgeryBusy])

  const handleRestartSurgeryPodFromSidebar = useCallback(async () => {
    if (surgeryBusy) return
    setSurgeryBusy(true)
    setStatusNotice('🔄 正在执行 sync-modded-client.mjs 编译同步并热重启独立手术进程 (:17580)…')
    try {
      const res = await callHermesBridgeApi({
        op: 'surgeryPodRestart',
        syncBeforeRestart: true,
        openWindow: false,
        agentId: selectedAgent?.id ?? 'default',
      })
      if (res?.ok) {
        setSurgeryStatus(res)
        setStatusNotice(`✓ 独立热手术进程 (:17580) 已更新并重启 (PID=${String(res.surgeryPod?.pid ?? 'N/A')})`)
      } else {
        setStatusNotice(`重启独立手术进程失败: ${String(res?.error ?? '未知错误')}`)
      }
    } finally {
      setSurgeryBusy(false)
    }
  }, [selectedAgent?.id, surgeryBusy])

  const handleRestartMainDesktopFromSidebar = useCallback(async () => {
    if (surgeryBusy) return
    setSurgeryBusy(true)
    setStatusNotice('⚡ 正在编译同步 DSH 源码并热重启主桌面端 (DeepSeek Harness.exe)，当前独立手术舱保持在线…')
    try {
      const res = await callHermesBridgeApi({
        op: 'surgeryPodRestartMainDesktop',
        syncBeforeRestart: true,
      })
      if (res?.ok) {
        setSurgeryStatus(res)
        setStatusNotice('✓ DSH 主桌面端已完成编译同步并热重启，当前独立手术舱未受影响！')
      } else {
        setStatusNotice(`热重启主桌面端失败: ${String(res?.error ?? '未知错误')}`)
      }
    } finally {
      setSurgeryBusy(false)
    }
  }, [surgeryBusy])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: '2px 8px 12px 4px',
        gap: 6,
      }}
    >
      {/* 👑 置顶：主智能体对话舱 (核心日常入口) */}
      <div
        style={{
          padding: '7px 8px',
          borderRadius: 8,
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.14), rgba(16, 185, 129, 0.10))',
          border: '1px solid rgba(2, 132, 199, 0.32)',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' }}>
            👑 主智能体常驻对话舱
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => {
                const nextMode = showSessionOptionsInAgentMode ? 'hermes' : 'sessions'
                setShowSessionOptionsInAgentMode(!showSessionOptionsInAgentMode)
                if (typeof document !== 'undefined') {
                  document.documentElement.dataset.dshChatMode = nextMode
                }
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('dsh-hermes-chat-mode', { detail: { mode: nextMode } }))
                }
              }}
              title="切换对话框显示模式：极简三按钮 (Agent自动运行) vs 展开完整 Session 选项 (工作区/预设/权限/模型)"
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid rgba(16, 185, 129, 0.45)',
                background: showSessionOptionsInAgentMode ? 'rgba(16, 185, 129, 0.18)' : 'transparent',
                color: '#059669',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showSessionOptionsInAgentMode ? '⚙️ 已展开选项' : '🤖 极简对话框'}
            </button>
            {onOpenCommandCenter !== undefined && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem('dsh-hermes-preferred-tab', 'warroom')
                    window.dispatchEvent(new CustomEvent('dsh-hermes-open-tab', { detail: { tab: 'warroom' } }))
                  }
                  onOpenCommandCenter()
                }}
                title="打开 E:/6_learn_space 作战大屏插件视图（伴学45课包·11项门禁·9大算力池·飞书督办·83岗实时工位）"
                style={{
                  padding: '2px 7px',
                  borderRadius: 4,
                  border: '1px solid rgba(245, 158, 11, 0.55)',
                  background: 'rgba(245, 158, 11, 0.16)',
                  color: '#d97706',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🎯 作战大屏
              </button>
            )}
            {onOpenCommandCenter !== undefined && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem('dsh-hermes-preferred-tab', 'org')
                    window.dispatchEvent(new CustomEvent('dsh-hermes-open-tab', { detail: { tab: 'org' } }))
                  }
                  onOpenCommandCenter()
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid rgba(2, 132, 199, 0.4)',
                  background: 'rgba(2, 132, 199, 0.15)',
                  color: '#0284c7',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                总控台
              </button>
            )}
          </div>
        </div>

        {/* 🎯 E:/6_learn_space 作战大屏迷你实时态势条 */}
        {onOpenCommandCenter !== undefined && (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('dsh-hermes-preferred-tab', 'warroom')
                window.dispatchEvent(new CustomEvent('dsh-hermes-open-tab', { detail: { tab: 'warroom' } }))
              }
              onOpenCommandCenter()
            }}
            title="点击查看 E:/6_learn_space 作战大屏完整态势：11项门禁、初一数学45节课包矩阵、S1~S4/A~E 9大算力池配额、飞书督办与83岗实时工位流"
            style={{
              width: '100%',
              padding: '4px 7px',
              borderRadius: 5,
              border: '1px solid rgba(245, 158, 11, 0.35)',
              background: 'rgba(245, 158, 11, 0.09)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 10.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span>
              🎯 <strong>作战大屏</strong> (E:/6_learn_space)
            </span>
            <span style={{ opacity: 0.88, fontSize: 10 }}>
              门禁 {String((HERMES_INITIAL_WAR_ROOM as any)?.summary?.gatesPassCount ?? 10)}/{String((HERMES_INITIAL_WAR_ROOM as any)?.summary?.gatesTotalCount ?? 11)} · 45课包 · 9算力池 ▸
            </span>
          </button>
        )}

        {/* 🩺 双进程互为手术台 (Main Desktop ⇄ :17580 Detached Surgery Pod) */}
        <div
          style={{
            padding: '5px 7px',
            borderRadius: 6,
            border: isSurgeryPodWindow
              ? '1px solid rgba(16, 185, 129, 0.55)'
              : '1px solid rgba(14, 165, 233, 0.35)',
            background: isSurgeryPodWindow
              ? 'rgba(16, 185, 129, 0.14)'
              : 'rgba(14, 165, 233, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10.5 }}>
            <span style={{ fontWeight: 700, color: isSurgeryPodWindow ? '#059669' : '#0284c7' }}>
              {isSurgeryPodWindow ? '🩺 当前处于：独立热手术进程 (:17580)' : '🩺 独立热手术伴生进程 (:17580)'}
            </span>
            <span style={{ fontSize: 9.5, opacity: 0.86 }}>
              {isSurgeryPodWindow
                ? `主端 ${surgeryStatus?.mainDesktop?.running ? '🟢运行中' : '⚪已停'}`
                : surgeryStatus?.surgeryPod?.healthy
                  ? `🟢在线 PID:${String(surgeryStatus.surgeryPod.pid ?? '')}`
                  : '⚪按需拉起'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {isSurgeryPodWindow ? (
              <>
                <button
                  type="button"
                  disabled={surgeryBusy}
                  onClick={() => { void handleRestartMainDesktopFromSidebar() }}
                  title="在独立热手术进程中编译同步 DSH 源码并热重启主桌面客户端 (DeepSeek Harness.exe)，当前独立进程不断连"
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#059669',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: surgeryBusy ? 'wait' : 'pointer',
                  }}
                >
                  {surgeryBusy ? '⏳ 编译重启主端中…' : '⚡ 编译同步并热重启主 DSH'}
                </button>
                {onOpenCommandCenter !== undefined && (
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.localStorage.setItem('dsh-hermes-preferred-tab', 'surgery')
                        window.dispatchEvent(new CustomEvent('dsh-hermes-open-tab', { detail: { tab: 'surgery' } }))
                      }
                      onOpenCommandCenter()
                    }}
                    style={{
                      padding: '3px 6px',
                      borderRadius: 4,
                      border: '1px solid rgba(16, 185, 129, 0.45)',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    手术台
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={surgeryBusy}
                  onClick={() => { void handlePopSurgeryPod(false) }}
                  title="启动并弹出一个完全脱离主进程的独立编程 Agent 窗口 (:17580)，用于修改并热重启 DSH 主进程而不断连"
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#0284c7',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: surgeryBusy ? 'wait' : 'pointer',
                  }}
                >
                  {surgeryBusy ? '⏳ 正在拉起…' : '🩺 弹出独立进程'}
                </button>
                <button
                  type="button"
                  disabled={surgeryBusy}
                  onClick={() => { void handlePopSurgeryPod(true) }}
                  title="将当前智能体会话无缝 Fork 接力到独立热手术进程 (:17580) 继续执行"
                  style={{
                    padding: '3px 6px',
                    borderRadius: 4,
                    border: '1px solid rgba(2, 132, 199, 0.4)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: surgeryBusy ? 'wait' : 'pointer',
                  }}
                >
                  📤 接力会话
                </button>
                <button
                  type="button"
                  disabled={surgeryBusy}
                  onClick={() => { void handleRestartSurgeryPodFromSidebar() }}
                  title="当在主进程修改了独立进程代码后，一键编译同步并重启 :17580 独立热手术进程"
                  style={{
                    padding: '3px 6px',
                    borderRadius: 4,
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    background: 'transparent',
                    color: '#8b5cf6',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: surgeryBusy ? 'wait' : 'pointer',
                  }}
                >
                  🔄 重启独立舱
                </button>
              </>
            )}
          </div>
        </div>

        {defaultSteward !== undefined && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => {
                setSelectedAgent(defaultSteward)
                void handleStartAgentSession(defaultSteward, false)
              }}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: 6,
                border: 'none',
                background: '#0284c7',
                color: '#fff',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              title="优先续接 👑 终极管家 (default) 的常驻主会话，保持全局上下文连续"
            >
              <span>👑 与主智能体对话 (终极管家)</span>
              <span style={{ fontSize: 10, opacity: 0.92 }}>
                {activeSessionByAgentId.has('default') ? '● 续接' : '▶ 启动'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedAgent(defaultSteward)
                void handleStartAgentSession(defaultSteward, true)
              }}
              title="强制新建一个 👑 终极管家 (default) 会话"
              style={{
                padding: '5px 7px',
                borderRadius: 6,
                border: '1px solid rgba(2, 132, 199, 0.4)',
                background: 'var(--dsw-alias-bg-layer-1, transparent)',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 10.5,
                cursor: 'pointer',
              }}
            >
              ➕新开
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {primaryAgents.filter(a => a.id !== 'default').map((head) => {
            const hasActive = activeSessionByAgentId.has(head.id)
            const shortLabel = head.id === 'fit-lead-1013'
              ? '🏛️ Optix主帅'
              : head.id === 'bl-company-coordinator'
                ? '🧭 个人总协调'
                : '🎮 万界制作人'
            return (
              <button
                key={head.id}
                type="button"
                onClick={() => {
                  setSelectedAgent(head)
                  void handleStartAgentSession(head, false)
                }}
                title={`${head.title} (${head.id})\n点击直接${hasActive ? '续接常驻会话' : '开启专属对话'}`}
                style={{
                  padding: '3px 4px',
                  borderRadius: 5,
                  border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.32))',
                  background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.04))',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {hasActive ? '● ' : ''}{shortLabel}
              </button>
            )
          })}
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value) }}
        placeholder="筛选 83 名战将 (番号 / 军衔 / 伴学 / 万界 / Optix)…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '5px 8px',
          borderRadius: 6,
          border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.3))',
          background: 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 12,
          outline: 'none',
        }}
      />

      {/* Military Branch & Brigade Formation Filter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {([
            ['all', '🎖️全军'],
            ['command', '⭐将帅'],
            ['assault', '⚔️突击'],
            ['mp', '🛡️督察'],
            ['staff', '🧭参谋'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setSidebarBranchFilter(key) }}
              style={{
                padding: '2px 5px',
                borderRadius: 4,
                border: sidebarBranchFilter === key
                  ? '1px solid #0284c7'
                  : '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.28))',
                background: sidebarBranchFilter === key
                  ? 'rgba(2, 132, 199, 0.16)'
                  : 'transparent',
                color: sidebarBranchFilter === key ? '#0284c7' : 'var(--dsw-alias-label-secondary)',
                fontSize: 10,
                fontWeight: sidebarBranchFilter === key ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { setSidebarGroupByBrigade(v => !v) }}
          title="切换『合成旅建制编组』与『平铺席位』模式"
          style={{
            padding: '2px 5px',
            borderRadius: 4,
            border: '1px solid rgba(245, 158, 11, 0.4)',
            background: sidebarGroupByBrigade ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
            color: '#d97706',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {sidebarGroupByBrigade ? '🪖合成旅编成' : '📋平铺'}
        </button>
      </div>

      {statusNotice !== null && (
        <div
          style={{
            padding: '4px 7px',
            borderRadius: 5,
            background: 'rgba(16, 185, 129, 0.14)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 11,
          }}
        >
          {statusNotice}
        </div>
      )}

      {selectedAgent !== undefined && (
        <div
          style={{
            padding: '6px 8px',
            borderRadius: 7,
            border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.28))',
            background: 'var(--dsw-alias-bg-layer-2, rgba(15,23,42,0.03))',
            fontSize: 11,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
            <div style={{ fontWeight: 700, color: 'var(--dsw-alias-label-primary)' }}>
              {selectedAgent.title}
            </div>
            <span
              style={{
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 9.5,
                fontWeight: 700,
                background: selectedAgentConfig.ensembleMode === 'fusion'
                  ? 'rgba(239, 68, 68, 0.16)'
                  : selectedAgentConfig.ensembleMode === 'moa'
                    ? 'rgba(139, 92, 246, 0.18)'
                    : 'rgba(2, 132, 199, 0.14)',
                color: selectedAgentConfig.ensembleMode === 'fusion'
                  ? '#ef4444'
                  : selectedAgentConfig.ensembleMode === 'moa'
                    ? '#8b5cf6'
                    : '#0284c7',
              }}
            >
              {selectedAgentConfig.ensembleMode === 'fusion'
                ? `🔥 Fusion:${String(selectedAgentConfig.fusionPreset)}`
                : selectedAgentConfig.ensembleMode === 'moa'
                  ? `🐝 MoA:${String(selectedAgentConfig.moaPreset)}`
                  : '⚡ 单模'} · {String(selectedAgentConfig.reasoningEffort)}
            </span>
          </div>
          <div style={{ opacity: 0.85, marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            <span
              style={{
                padding: '0 5px',
                borderRadius: 3,
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#d97706',
                fontWeight: 700,
                fontSize: 10,
              }}
            >
              {selectedAgent.militaryRank ?? '⚔️ 作战席位'} · {selectedAgent.callsign ?? selectedAgent.id}
            </span>
            <span>{selectedAgent.branchLabel ?? selectedAgent.department}</span>
          </div>
          <div style={{ opacity: 0.78, marginTop: 2 }}>
            直属长官: <code>{selectedAgent.supervisor}</code>
            {selectedAgent.reviewer ? <> · 宪兵督察: <code>{selectedAgent.reviewer}</code></> : null}
          </div>
          <div style={{ opacity: 0.78, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            武器: <code>{String(selectedAgentConfig.model)}</code> (<code>{String(selectedAgentConfig.reasoningEffort)}</code>) · 频段: <code>{selectedAgent.feishuProfile}</code>
          </div>
          <div
            style={{
              opacity: 0.72,
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={selectedAgent.projectRoot}
          >
            目录: {selectedAgent.projectRoot}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
            <button
              type="button"
              onClick={() => { void handleStartAgentSession(selectedAgent, false) }}
              style={{
                flex: 1,
                padding: '3px 6px',
                borderRadius: 4,
                border: 'none',
                background: '#0284c7',
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {activeSessionByAgentId.has(selectedAgent.id) ? '💬 续接常驻对话' : '✨ 与该 Agent 对话'}
            </button>
            <button
              type="button"
              onClick={() => { void handleStartAgentSession(selectedAgent, true) }}
              title="强制新建该岗位的空白对话"
              style={{
                padding: '3px 6px',
                borderRadius: 4,
                border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 10.5,
                cursor: 'pointer',
              }}
            >
              ➕ 新开
            </button>
            <button
              type="button"
              onClick={() => { setShowSidebarParamDrawer(v => !v) }}
              title="设置该智能体的专属模型、推理等级 (low~max)、Hermes MoA 或 Devin Fusion 模式"
              style={{
                padding: '3px 6px',
                borderRadius: 4,
                border: '1px solid rgba(139, 92, 246, 0.45)',
                background: showSidebarParamDrawer ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
                color: '#8b5cf6',
                fontSize: 10.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ⚙️ 参数
            </button>
            {onOpenCommandCenter !== undefined && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem('dsh-hermes-preferred-tab', 'ensemble')
                    window.dispatchEvent(new CustomEvent('dsh-hermes-open-tab', { detail: { tab: 'ensemble' } }))
                  }
                  onOpenCommandCenter()
                }}
                style={{
                  padding: '3px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 10.5,
                  cursor: 'pointer',
                }}
              >
                总控
              </button>
            )}
          </div>

          {showSidebarParamDrawer && (
            <div
              style={{
                marginTop: 7,
                padding: '7px 8px',
                borderRadius: 6,
                border: '1px solid rgba(139, 92, 246, 0.32)',
                background: 'var(--dsw-alias-bg-layer-1, rgba(15,23,42,0.06))',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                fontSize: 10.5,
              }}
            >
              <div style={{ fontWeight: 700, color: '#8b5cf6', display: 'flex', justifyContent: 'space-between' }}>
                <span>🧠 岗位专属参数 & MoA/Fusion 设置</span>
                <button
                  type="button"
                  onClick={() => { setShowSidebarParamDrawer(false) }}
                  style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 10 }}
                >
                  收起 ▴
                </button>
              </div>
              <HermesModelPicker
                key={selectedAgent.id}
                compact
                catalog={agentConfigsData?.catalog ?? []}
                provider={String(selectedAgentConfig.provider)}
                model={String(selectedAgentConfig.model)}
                onSelect={(provider, model) => { void handleSaveSidebarAgentConfig({ provider, model }) }}
                t={t}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ opacity: 0.78 }}>推理等级 (Effort):</span>
                  <select
                    value={String(selectedAgentConfig.reasoningEffort || 'high')}
                    onChange={(e) => {
                      void handleSaveSidebarAgentConfig({ reasoningEffort: e.target.value })
                    }}
                    style={{
                      width: '100%',
                      padding: '3px 5px',
                      borderRadius: 4,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                      background: 'var(--dsw-alias-bg-base)',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 10.5,
                    }}
                  >
                    {['low', 'medium', 'high', 'xhigh', 'max'].map(lvl => (
                      <option key={lvl} value={lvl}>{lvl.toUpperCase()}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ opacity: 0.78 }}>协同推理模式:</span>
                  <select
                    value={String(selectedAgentConfig.ensembleMode || 'single')}
                    onChange={(e) => {
                      void handleSaveSidebarAgentConfig({ ensembleMode: e.target.value })
                    }}
                    style={{
                      width: '100%',
                      padding: '3px 5px',
                      borderRadius: 4,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                      background: 'var(--dsw-alias-bg-base)',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 10.5,
                    }}
                  >
                    <option value="single">⚡ Single (单模直出)</option>
                    <option value="moa">🐝 Hermes MoA (多参谋聚合)</option>
                    <option value="fusion">🔥 Devin Fusion (多路对抗融合)</option>
                  </select>
                </label>
              </div>

              {selectedAgentConfig.ensembleMode === 'moa' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ opacity: 0.78 }}>🐝 Hermes MoA 参谋团预设:</span>
                  <select
                    value={String(selectedAgentConfig.moaPreset || 'council')}
                    onChange={(e) => {
                      void handleSaveSidebarAgentConfig({ moaPreset: e.target.value })
                    }}
                    style={{
                      width: '100%',
                      padding: '3px 5px',
                      borderRadius: 4,
                      border: '1px solid rgba(139, 92, 246, 0.45)',
                      background: 'var(--dsw-alias-bg-base)',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 10.5,
                    }}
                  >
                    <option value="council">🏛️ council (4参谋内阁 → GPT-6.1-Sol)</option>
                    <option value="code">💻 code (5参谋代码攻坚 → GPT-6.1-Sol)</option>
                    <option value="review">🛡️ review (红队挑刺 → Gemini-4-Argon)</option>
                    <option value="cheap">⚡ cheap (双模快参 → MiniMax-M3.1)</option>
                  </select>
                </label>
              )}

              {selectedAgentConfig.ensembleMode === 'fusion' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ opacity: 0.78 }}>🔥 Devin Fusion 融合管线预设:</span>
                  <select
                    value={String(selectedAgentConfig.fusionPreset || 'trinity')}
                    onChange={(e) => {
                      void handleSaveSidebarAgentConfig({ fusionPreset: e.target.value })
                    }}
                    style={{
                      width: '100%',
                      padding: '3px 5px',
                      borderRadius: 4,
                      border: '1px solid rgba(239, 68, 68, 0.45)',
                      background: 'var(--dsw-alias-bg-base)',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 10.5,
                    }}
                  >
                    <option value="trinity">🔥 trinity (Fable5.1+GPT6.1+GLM5.3 → Grok挑刺 → 主裁合成)</option>
                    <option value="code_fusion">⚔️ code_fusion (Opus5.5+GPT6.1 双轨补丁竞速融合)</option>
                  </select>
                </label>
              )}

              {onOpenCommandCenter !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem('dsh-hermes-preferred-tab', 'ensemble')
                      window.dispatchEvent(new CustomEvent('dsh-hermes-open-tab', { detail: { tab: 'ensemble' } }))
                    }
                    onOpenCommandCenter()
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: 'none',
                    background: '#8b5cf6',
                    color: '#fff',
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: 2,
                  }}
                >
                  🚀 打开 MoA / Devin Fusion 多模融合大工作台
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }}>
        {treeData.roots.map(rootNode => (
          <SidebarZoneBranch
            key={rootNode.id}
            node={rootNode}
            depth={0}
            query={query}
            branchFilter={sidebarBranchFilter}
            groupByBrigade={sidebarGroupByBrigade}
            selectedAgentId={selectedAgent?.id}
            activeSessionByAgentId={activeSessionByAgentId}
            onSelectAgent={setSelectedAgent}
            onStartAgentSession={(agent, forceNew) => { void handleStartAgentSession(agent, forceNew) }}
          />
        ))}
      </div>
    </div>
  )
}

export interface HermesCommandCenterInjected {
  startAgentSession: (agent: HermesAgentNode, customPrompt?: string, forceNew?: boolean) => void
  closePanel: () => void
}

/**
 * Full-screen Command Center mounted in the `main` slot (`key: 'hermes-org'`).
 */
export function HermesCommandCenterPage({
  startAgentSession,
  closePanel,
  t,
}: PropsRuntime<'main'> & HermesCommandCenterInjected & PropsLocale<'workspace'>) {
  const [activeTab, setActiveTab] = useState<'warroom' | 'surgery' | 'ensemble' | 'org' | 'gateway' | 'loop6'>(() => {
    if (typeof window !== 'undefined') {
      const pref = window.localStorage.getItem('dsh-hermes-preferred-tab')
      if (pref === 'org' || pref === 'gateway' || pref === 'loop6' || pref === 'warroom' || pref === 'ensemble' || pref === 'surgery') {
        return pref
      }
    }
    return 'warroom'
  })
  const [warRoomSubTab, setWarRoomSubTab] = useState<'overview' | 'gates' | 'pools' | 'lessons' | 'tasks' | 'iframe'>('overview')
  const [warRoomData, setWarRoomData] = useState<Record<string, any>>(HERMES_INITIAL_WAR_ROOM as Record<string, any>)
  const [surgeryPodData, setSurgeryPodData] = useState<Record<string, any> | null>(null)
  const [surgeryActionBusy, setSurgeryActionBusy] = useState(false)
  const [surgeryTaskPrompt, setSurgeryTaskPrompt] = useState(
    '请检查 F:/3_open_source/deepseek-harness 的 UI 组件代码，完成修改后运行 node scripts/sync-modded-client.mjs 并热重启主桌面端 DeepSeek Harness.exe',
  )
  const [agentConfigsState, setAgentConfigsState] = useState<Record<string, any>>(
    () => (HERMES_INITIAL_AGENT_CONFIGS as Record<string, any>) ?? {},
  )
  const [ensemblePrompt, setEnsemblePrompt] = useState('请结合 E:\\6_learn_space 伴学初一数学 45 节课包与万界微信小游戏的当前进度，给出最高杠杆的下一步推进方案与潜在风险防呆点')
  const [ensembleRunning, setEnsembleRunning] = useState(false)
  const [ensembleResult, setEnsembleResult] = useState<Record<string, any> | null>(null)
  const [treeData, setTreeData] = useState<HermesOrgTreeData>(HERMES_ORG_TREE)
  const [query, setQuery] = useState('')
  const [orgViewMode, setOrgViewMode] = useState<'matrix' | 'tree'>('matrix')
  const [orgBranchFilter, setOrgBranchFilter] = useState<string>('all')
  const [selectedAgent, setSelectedAgent] = useState<HermesAgentNode>(() => {
    const localRoot = HERMES_ORG_TREE.roots.find(r => r.name === '本机')
    return localRoot?.agents.find(a => a.id === 'default') ?? HERMES_ORG_TREE.roots[0]!.agents[0]!
  })

  const allOrgAgents = useMemo(() => {
    const out: HermesAgentNode[] = []
    const walk = (n: HermesZoneNode) => {
      out.push(...n.agents)
      for (const c of n.children) walk(c)
    }
    for (const r of treeData.roots) walk(r)
    return out
  }, [treeData.roots])

  const allOrgSectionsWithBrigades = useMemo(() => {
    const out: HermesZoneNode[] = []
    const walk = (n: HermesZoneNode) => {
      if ((n.brigades && n.brigades.length > 0) || n.agents.length > 0) {
        out.push(n)
      }
      for (const c of n.children) walk(c)
    }
    for (const r of treeData.roots) walk(r)
    return out
  }, [treeData.roots])

  const orgBranchCounts = useMemo(() => {
    const counts = { all: allOrgAgents.length, command: 0, assault: 0, mp: 0, staff: 0 }
    for (const a of allOrgAgents) {
      if (a.branch === 'command') counts.command++
      else if (a.branch === 'mp') counts.mp++
      else if (a.branch === 'intel' || a.branch === 'logistics') counts.staff++
      else counts.assault++
    }
    return counts
  }, [allOrgAgents])
  const [sessions, setSessions] = useState<HermesSessionSummary[]>(
    () => HERMES_INITIAL_SESSIONS.default ?? [],
  )
  const [dispatchPrompt, setDispatchPrompt] = useState('')
  const [gatewayState, setGatewayState] = useState<Record<string, any>>(HERMES_INITIAL_GATEWAY)
  const [simProfile, setSimProfile] = useState<'life' | 'company'>('life')
  const [simText, setSimText] = useState('请检查伴学初一数学有理数章节知识图谱与错题闭环')
  const [loopReceipts, setLoopReceipts] = useState<Record<string, any>[]>(HERMES_INITIAL_LOOP6)
  const [loopTitle, setLoopTitle] = useState('DSH 魔改客户端原生集成三区组织树与飞书双租户网关验收')
  const [loopAnchor, setLoopAnchor] = useState('围绕技术水平更高的 DSH 打造胡飞扬专属的 83 智能体总控客户端，固化高可见度工程壁垒')
  const [loopAsset, setLoopAsset] = useState('@deepseek-ai/dsh-client-ui-workspace 原生组织树 + dsh-hermes-bridge v0.3.0')
  const [banner, setBanner] = useState<string | null>(null)

  const findAgentById = useCallback((agentId: string): HermesAgentNode | undefined => {
    const all: HermesAgentNode[] = []
    const walk = (n: HermesZoneNode) => {
      all.push(...n.agents)
      for (const c of n.children) walk(c)
    }
    for (const r of treeData.roots) walk(r)
    return all.find(a => a.id === agentId)
  }, [treeData.roots])

  const refreshAll = useCallback(async () => {
    const [wRes, tRes, gRes, lRes, cRes, sRes] = await Promise.all([
      callHermesBridgeApi({ op: 'warRoom' }),
      callHermesBridgeApi({ op: 'orgTree' }),
      callHermesBridgeApi({ op: 'gatewayStatus', limit: 12, includeAllBindings: true }),
      callHermesBridgeApi({ op: 'loop6List', limit: 10 }),
      callHermesBridgeApi({ op: 'agentConfigs', limit: 10 }),
      callHermesBridgeApi({ op: 'surgeryPodStatus' }),
    ])
    if (wRes?.ok) setWarRoomData(wRes)
    if (tRes?.ok && tRes.tree?.roots) setTreeData(tRes.tree as HermesOrgTreeData)
    if (gRes?.ok) setGatewayState(gRes)
    if (lRes?.ok && Array.isArray(lRes.receipts)) setLoopReceipts(lRes.receipts)
    if (cRes?.ok && cRes.configs) setAgentConfigsState(cRes)
    if (sRes?.ok) setSurgeryPodData(sRes)
  }, [])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const onOpenTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab === 'warroom' || tab === 'surgery' || tab === 'ensemble' || tab === 'org' || tab === 'gateway' || tab === 'loop6') {
        setActiveTab(tab)
      }
    }
    window.addEventListener('dsh-hermes-open-tab', onOpenTab)
    return () => {
      window.removeEventListener('dsh-hermes-open-tab', onOpenTab)
    }
  }, [])

  const currentAgentCfg = useMemo(() => {
    return agentConfigsState?.configs?.[selectedAgent.id] ?? {
      agentId: selectedAgent.id,
      provider: 'magpie',
      model: 'group/claude-fable-5-1',
      reasoningEffort: 'high',
      permissionPreset: 'danger-full-access',
      ensembleMode: 'single',
      moaPreset: 'council',
      fusionPreset: 'trinity',
    }
  }, [agentConfigsState, selectedAgent.id])

  const handleUpdateSelectedAgentCfg = async (patch: Record<string, unknown>) => {
    const persisted = readPersistedAgentSessionMap()
    const mappedSessionId = persisted[selectedAgent.id] ?? persisted[`hermes-${selectedAgent.id}`] ?? ''
    const nextCfg = {
      ...currentAgentCfg,
      ...patch,
      agentId: selectedAgent.id,
      sessionId: mappedSessionId,
    }
    setAgentConfigsState(prev => ({
      ...prev,
      configs: {
        ...(prev?.configs ?? {}),
        [selectedAgent.id]: nextCfg,
      },
    }))
    const res = await callHermesBridgeApi({
      op: 'updateAgentConfig',
      ...nextCfg,
    })
    if (res?.ok && res.config) {
      setBanner(
        `✓ 已保存并同步 ${selectedAgent.title} (${selectedAgent.id}) 参数：模型=${String(res.config.provider)}:${String(res.config.model)} · 推理等级=${String(res.config.reasoningEffort).toUpperCase()} · 模式=${String(res.config.ensembleMode).toUpperCase()}`,
      )
    }
  }

  const handleRunEnsemble = async (mode: 'moa' | 'fusion', injectToSession = false) => {
    const text = ensemblePrompt.trim()
    if (!text || ensembleRunning) return
    setEnsembleRunning(true)
    const persisted = readPersistedAgentSessionMap()
    const targetSessionId = injectToSession
      ? (persisted[selectedAgent.id] ?? persisted[`hermes-${selectedAgent.id}`] ?? '')
      : ''
    setBanner(
      mode === 'moa'
        ? `🐝 正在并行调用 Hermes MoA (${String(currentAgentCfg.moaPreset)}) 参谋团并由主帅聚合…`
        : `🔥 正在运行 Devin Fusion (${String(currentAgentCfg.fusionPreset)}) 三阶多路主创 + 交叉盲审挑刺 + 主裁融合…`,
    )
    try {
      const res = await callHermesBridgeApi({
        op: mode === 'moa' ? 'runMoA' : 'runFusion',
        prompt: text,
        preset: mode === 'moa' ? (currentAgentCfg.moaPreset || 'council') : (currentAgentCfg.fusionPreset || 'trinity'),
        agentId: selectedAgent.id,
        injectToSessionId: targetSessionId,
      })
      if (res?.ok) {
        setEnsembleResult(res)
        setBanner(
          `✓ ${mode === 'moa' ? '🐝 Hermes MoA' : '🔥 Devin Fusion'} 执行完成 (耗时 ${String(res.totalDurationMs ?? 0)}ms)${targetSessionId ? ` · 已自动注入会话 ${targetSessionId}` : ''}`,
        )
        void refreshAll()
      } else {
        setBanner(`执行失败: ${String(res?.error ?? '未知错误')}`)
      }
    } finally {
      setEnsembleRunning(false)
    }
  }

  const handleStartWarRoomLiveServer = async () => {
    setBanner('正在后台拉起 E:\\6_learn_space\\tools\\live_war_room_server.py (:18765)…')
    const res = await callHermesBridgeApi({ op: 'warRoomStartServer' })
    if (res?.ok) {
      setBanner(`✓ 作战大屏 Web 服务已就绪: ${String(res.url ?? 'http://127.0.0.1:18765')} ${String(res.note ?? '')}`)
      void refreshAll()
    } else {
      setBanner(`启动 :18765 服务失败: ${String(res?.error ?? '未知错误')}`)
    }
  }

  useEffect(() => {
    let cancelled = false
    setSessions(HERMES_INITIAL_SESSIONS[selectedAgent.id] ?? [])
    void callHermesBridgeApi({ op: 'agentSessions', agentId: selectedAgent.id, limit: 6 }).then((res) => {
      if (!cancelled && res?.ok && Array.isArray(res.sessions)) {
        setSessions(res.sessions as HermesSessionSummary[])
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedAgent.id])

  const handleDispatchBackground = async () => {
    const text = dispatchPrompt.trim()
    if (!text) return
    setBanner(`正在向 ${selectedAgent.title} (${selectedAgent.id}) 派发后台任务…`)
    const res = await callHermesBridgeApi({
      op: 'dispatch',
      agentId: selectedAgent.id,
      prompt: text,
      mode: 'background',
    })
    if (res?.ok) {
      setBanner(`✓ 已向 ${selectedAgent.title} 派发后台任务: jobId=${String(res.job?.jobId ?? '')}`)
      setDispatchPrompt('')
    } else {
      startAgentSession(selectedAgent, text)
    }
  }

  const handleSimulateGateway = async () => {
    const text = simText.trim()
    if (!text) return
    const res = await callHermesBridgeApi({
      op: 'gatewayIngest',
      profile: simProfile,
      dryRun: true,
      event: {
        profile: simProfile,
        message_id: `om_dsh_ui_${String(Date.now())}`,
        sender_type: 'user',
        content: text,
      },
    })
    if (res?.ok) {
      setBanner(`✓ 飞书网关路由成功 [${String(res.status)}] -> ${String(res.target?.title)} (${String(res.target?.agentId)}) | 原因: ${String(res.target?.routeReason)}`)
      void refreshAll()
    } else {
      setBanner(`网关路由拦截或未连接 (${String(res?.error ?? '服务端未响应')})`)
    }
  }

  const handleRunLoop6 = async () => {
    setBanner('正在生成六步自我强化闭环演练预览（dryRun=true，不写正式个人账本）…')
    const res = await callHermesBridgeApi({
      op: 'loop6Run',
      payload: {
        agentId: selectedAgent.id,
        title: loopTitle,
        step1Anchor: loopAnchor,
        step2ToolAsset: loopAsset,
        step3Verification: `[干跑演练预览] 关联岗位 ${selectedAgent.id} (${selectedAgent.title})`,
        beforeItems: ['仅静态 HTML 报告，未直接体现在 DSH 客户端主界面与左栏'],
        afterItems: ['直接魔改 deepseek-harness 客户端源码，左栏与主界面原生呈现 Optix/个人(伴学·万界)/本机 83 智能体与飞书网关'],
        diffItems: ['打通 UI 源码层 (@deepseek-ai/dsh-client-ui-workspace) 与 Host 插件层 (dsh-hermes-bridge v0.3.0) 全链路'],
        recordPersonalLedger: false,
        dryRun: true,
      },
    })
    if (res?.ok && res.receipt) {
      setBanner(`✓ 六步闭环演练预览生成完成: 回执 ${String(res.receipt.receiptId)} (${String(res.receipt.steps?.step4DocxXmlPath)})`)
      void refreshAll()
    } else {
      setBanner(`六步闭环接口未就绪或调用失败 (${String(res?.error ?? '当前展示内置快照回执')})`)
    }
  }

  const cardStyle: CSSProperties = {
    borderRadius: 12,
    border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25))',
    background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.03))',
    padding: 16,
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 24px',
          borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.2))',
          flex: 'none',
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🏛️ DeepSeek Harness × Hermes 智能体编队与飞书双租户总控台</span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(2, 132, 199, 0.15)',
                color: '#0284c7',
                fontWeight: 600,
              }}
            >
              自研魔改客户端 v0.3.0 · 83 岗位同源
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 }}>
            三区嵌套架构：Optix (3人 · --profile company) ｜ 个人 (73人：伴学 37 · 万界 35 · 直属 1 · --profile life) ｜ 本机 (7人 · 👑 终极管家 · --profile life)
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => { void refreshAll() }}
            style={{
              padding: '6px 12px',
              borderRadius: 7,
              border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.3))',
              background: 'transparent',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            刷新同步
          </button>
          <button
            type="button"
            onClick={closePanel}
            style={{
              padding: '6px 12px',
              borderRadius: 7,
              border: 'none',
              background: '#0284c7',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            返回当前对话
          </button>
        </div>
      </div>

      {/* KPI & Mode Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 24px',
          borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(148,163,184,0.16))',
          gap: 12,
          flexWrap: 'wrap',
          flex: 'none',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            ['warroom', '🎯 作战大屏 (E:/6_learn_space · 11门禁·45课包·9算力池·督办)'],
            ['surgery', '🩺 双进程互为手术台 (主进程 ⇄ :17580 独立热手术伴生进程)'],
            ['ensemble', '🧠 参数 · MoA · Fusion (83岗模型/推理等级 & 多模融合工作台)'],
            ['org', '🎖️ 全军建制与作战指挥部 (83编制 · 三大战区 · 15合成旅/营)'],
            ['gateway', '📡 飞书双租户常驻事件网关 (company / life)'],
            ['loop6', '♾️ 六步自我强化闭环流水线 (DocxXML + 个人账本)'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveTab(key)
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem('dsh-hermes-preferred-tab', key)
                }
              }}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: activeTab === key
                  ? (key === 'warroom' ? '1px solid #d97706' : key === 'surgery' ? '1px solid #10b981' : key === 'ensemble' ? '1px solid #8b5cf6' : '1px solid #0284c7')
                  : '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.28))',
                background: activeTab === key
                  ? (key === 'warroom' ? 'rgba(245, 158, 11, 0.16)' : key === 'surgery' ? 'rgba(16, 185, 129, 0.18)' : key === 'ensemble' ? 'rgba(139, 92, 246, 0.18)' : 'rgba(2, 132, 199, 0.15)')
                  : 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                fontWeight: activeTab === key ? 700 : 500,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
          <span>作战门禁: <strong style={{ color: '#10b981' }}>{String(warRoomData?.summary?.gatesPassCount ?? 10)} / {String(warRoomData?.summary?.gatesTotalCount ?? 11)} PASS</strong></span>
          <span>数学课包: <strong style={{ color: '#0284c7' }}>{String(warRoomData?.summary?.lessonsPassCount ?? 45)} / {String(warRoomData?.summary?.lessonsTotalCount ?? 45)}</strong></span>
          <span>飞书督办: <strong style={{ color: '#d97706' }}>Open {String(warRoomData?.summary?.feishuOpenTasks ?? 0)} · Closed {String(warRoomData?.summary?.feishuClosedTasks ?? 0)}</strong></span>
          <span>已编译预设: <strong style={{ color: '#0284c7' }}>83 / 83</strong></span>
        </div>
      </div>

      {banner !== null && (
        <div
          style={{
            margin: '10px 24px 0',
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(2, 132, 199, 0.12)',
            border: '1px solid rgba(2, 132, 199, 0.3)',
            fontSize: 12.5,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => { setBanner(null) }}
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px 28px' }}>
        {activeTab === 'surgery' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Top Architecture Banner */}
            <div
              style={{
                ...cardStyle,
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(2, 132, 199, 0.10))',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🩺 DSH 双进程互为手术台架构 (Main Desktop Process ⇄ Detached Surgery Companion Pod)</span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: surgeryPodData?.currentProcess?.isSurgeryPod ? 'rgba(16, 185, 129, 0.22)' : 'rgba(2, 132, 199, 0.2)',
                      color: surgeryPodData?.currentProcess?.isSurgeryPod ? '#059669' : '#0284c7',
                      fontWeight: 700,
                    }}
                  >
                    当前窗口角色：{surgeryPodData?.currentProcess?.isSurgeryPod ? '🩺 独立热手术伴生进程 (:17580)' : '🏛️ DSH 主桌面进程 (desktop)'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                  正向手术：在 <strong>:17580 独立手术舱 (node.exe)</strong> 中修改并热重启 <strong>DeepSeek Harness.exe 主进程</strong>，独立手术舱不断连、不中断任务；反向更新：在 <strong>主进程</strong> 中修改独立进程代码并一键编译重启 <strong>:17580 独立手术舱</strong>。双端共享 <code>~/.dsh/sessions</code> 与 83 智能体模型配置。
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={surgeryActionBusy}
                  onClick={async () => {
                    setSurgeryActionBusy(true)
                    setBanner('🩺 正在启动独立热手术伴生进程 (:17580) 并弹出独立应用窗口…')
                    try {
                      const res = await callHermesBridgeApi({
                        op: 'surgeryPodStart',
                        openWindow: true,
                        agentId: selectedAgent.id,
                      })
                      if (res?.ok) {
                        setSurgeryPodData(res)
                        setBanner(`✓ 独立热手术伴生进程 (:17580 · PID=${String(res.surgeryPod?.pid ?? 'N/A')}) 已启动并弹出独立窗口！`)
                      } else {
                        setBanner(`启动失败: ${String(res?.error ?? '未知错误')}`)
                      }
                    } finally {
                      setSurgeryActionBusy(false)
                    }
                  }}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#059669',
                    color: '#fff',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: surgeryActionBusy ? 'wait' : 'pointer',
                  }}
                >
                  🩺 一键弹出独立热手术窗口 (:17580)
                </button>
              </div>
            </div>

            {/* Dual Process Status & Mutual Surgery Controls */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
              {/* Card A: Main Desktop Process */}
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    🏛️ 进程 A：DSH 主桌面客户端 (DeepSeek Harness.exe)
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: surgeryPodData?.mainDesktop?.running ? 'rgba(16, 185, 129, 0.16)' : 'rgba(239, 68, 68, 0.16)',
                      color: surgeryPodData?.mainDesktop?.running ? '#059669' : '#dc2626',
                      fontWeight: 700,
                    }}
                  >
                    {surgeryPodData?.mainDesktop?.running ? `🟢 运行中 (PID: ${(surgeryPodData.mainDesktop.pids || []).join(', ')})` : '⚪ 未运行'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 }}>
                  <div>· Profile: <code>~/.dsh/profiles/desktop</code>（独占 Electron 桌面锁）</div>
                  <div>· 可执行文件: <code>{String(surgeryPodData?.mainDesktop?.exePath ?? 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe')}</code></div>
                  <div>· 职责: 日常主力交互界面、飞书双租户常驻网关宿主，以及在需要更新独立手术舱时作为主控端。</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <button
                    type="button"
                    disabled={surgeryActionBusy}
                    onClick={async () => {
                      setSurgeryActionBusy(true)
                      setBanner('⚡ 正在执行 sync-modded-client.mjs 编译同步并热重启 DSH 主桌面客户端…')
                      try {
                        const res = await callHermesBridgeApi({
                          op: 'surgeryPodRestartMainDesktop',
                          syncBeforeRestart: true,
                        })
                        if (res?.ok) {
                          setSurgeryPodData(res)
                          setBanner('✓ 已完成源码编译同步并热重启 DSH 主桌面端 (DeepSeek Harness.exe)！')
                        } else {
                          setBanner(`重启主桌面端失败: ${String(res?.error ?? '未知错误')}`)
                        }
                      } finally {
                        setSurgeryActionBusy(false)
                      }
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 7,
                      border: 'none',
                      background: '#0284c7',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: surgeryActionBusy ? 'wait' : 'pointer',
                    }}
                  >
                    ⚡ 编译同步并热重启主 DSH 桌面端
                  </button>
                  <button
                    type="button"
                    disabled={surgeryActionBusy}
                    onClick={async () => {
                      setSurgeryActionBusy(true)
                      setBanner('🔨 正在运行 scripts/sync-modded-client.mjs 编译并同步双端产物…')
                      try {
                        const res = await callHermesBridgeApi({ op: 'surgeryPodSyncClient' })
                        if (res?.ok) {
                          setBanner(`✓ 编译同步完成 (耗时 ${String(res.durationMs ?? 0)}ms)，双端产物已对齐！`)
                        } else {
                          setBanner(`编译同步失败: ${String(res?.stderr || res?.error || '未知错误')}`)
                        }
                      } finally {
                        setSurgeryActionBusy(false)
                      }
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 7,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.35))',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: surgeryActionBusy ? 'wait' : 'pointer',
                    }}
                  >
                    🔨 仅编译同步源码 (不重启)
                  </button>
                </div>
              </div>

              {/* Card B: Detached Surgery Companion Pod */}
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    🩺 进程 B：独立热手术伴生进程 (node.exe · :17580)
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: surgeryPodData?.surgeryPod?.healthy ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.2)',
                      color: surgeryPodData?.surgeryPod?.healthy ? '#059669' : 'var(--dsw-alias-label-secondary)',
                      fontWeight: 700,
                    }}
                  >
                    {surgeryPodData?.surgeryPod?.healthy
                      ? `🟢 在线就绪 (PID: ${String(surgeryPodData.surgeryPod.pid ?? 'N/A')})`
                      : '⚪ 待拉起 (:17580)'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 }}>
                  <div>· Profile: <code>~/.dsh/profiles/surgery</code>（独立 <code>node.exe</code> 宿主 + 独立 App 窗口，完全免疫 <code>taskkill DeepSeek Harness.exe</code>）</div>
                  <div>· 独立访问地址: <code>{String(surgeryPodData?.surgeryPod?.url ?? 'http://127.0.0.1:17580/?surgeryPod=1')}</code></div>
                  <div>· 当前绑定手术会话: <code>{String(surgeryPodData?.surgeryPod?.activeSurgerySessionId ?? '(启动时自动就绪)')}</code> · 源码仓: <code>F:/3_open_source/deepseek-harness</code></div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <button
                    type="button"
                    disabled={surgeryActionBusy}
                    onClick={async () => {
                      const persisted = readPersistedAgentSessionMap()
                      const currentSessId = persisted[selectedAgent.id] ?? persisted[`hermes-${selectedAgent.id}`] ?? ''
                      setSurgeryActionBusy(true)
                      setBanner(`📤 正在将 ${selectedAgent.title} 的当前会话 Fork 接力至 :17580 独立手术舱并弹出窗口…`)
                      try {
                        const res = await callHermesBridgeApi({
                          op: 'surgeryPodStart',
                          openWindow: true,
                          agentId: selectedAgent.id,
                          handoffSessionId: currentSessId,
                        })
                        if (res?.ok) {
                          setSurgeryPodData(res)
                          setBanner(`✓ 会话已接力至独立手术舱 (:17580 · 新会话 ${String(res.surgeryPod?.activeSurgerySessionId ?? '')})！`)
                        } else {
                          setBanner(`会话接力失败: ${String(res?.error ?? '未知错误')}`)
                        }
                      } finally {
                        setSurgeryActionBusy(false)
                      }
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 7,
                      border: 'none',
                      background: '#059669',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: surgeryActionBusy ? 'wait' : 'pointer',
                    }}
                  >
                    📤 接力当前智能体会话至独立手术舱
                  </button>
                  <button
                    type="button"
                    disabled={surgeryActionBusy}
                    onClick={async () => {
                      setSurgeryActionBusy(true)
                      setBanner('🔄 正在编译同步并热重启 :17580 独立热手术伴生进程…')
                      try {
                        const res = await callHermesBridgeApi({
                          op: 'surgeryPodRestart',
                          syncBeforeRestart: true,
                          openWindow: false,
                          agentId: selectedAgent.id,
                        })
                        if (res?.ok) {
                          setSurgeryPodData(res)
                          setBanner(`✓ 独立热手术伴生进程 (:17580) 已完成热更新并重启 (新 PID=${String(res.surgeryPod?.pid ?? 'N/A')})！`)
                        } else {
                          setBanner(`热重启独立进程失败: ${String(res?.error ?? '未知错误')}`)
                        }
                      } finally {
                        setSurgeryActionBusy(false)
                      }
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 7,
                      border: '1px solid rgba(139, 92, 246, 0.45)',
                      background: 'rgba(139, 92, 246, 0.14)',
                      color: '#8b5cf6',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: surgeryActionBusy ? 'wait' : 'pointer',
                    }}
                  >
                    🔄 编译同步并热重启独立手术舱 (:17580)
                  </button>
                  {surgeryPodData?.surgeryPod?.running && (
                    <button
                      type="button"
                      disabled={surgeryActionBusy}
                      onClick={async () => {
                        setSurgeryActionBusy(true)
                        try {
                          const res = await callHermesBridgeApi({ op: 'surgeryPodStop' })
                          if (res?.ok) {
                            setSurgeryPodData(res)
                            setBanner('⏹️ 独立热手术伴生进程 (:17580) 已停止。')
                          }
                        } finally {
                          setSurgeryActionBusy(false)
                        }
                      }}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 7,
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        background: 'transparent',
                        color: '#dc2626',
                        fontSize: 12,
                        cursor: surgeryActionBusy ? 'wait' : 'pointer',
                      }}
                    >
                      ⏹️ 停止独立进程
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick DSH Self-Surgery Task Launcher */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                🚀 向独立热手术舱 (:17580) 派发 DSH 客户端自我改造任务（自动绑定 F:/3_open_source/deepseek-harness）
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={surgeryTaskPrompt}
                  onChange={(e) => { setSurgeryTaskPrompt(e.target.value) }}
                  placeholder="输入要让独立手术舱 Agent 对 DSH 源码执行的修改与重启任务…"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                    background: 'var(--dsw-alias-bg-base)',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 12.5,
                  }}
                />
                <button
                  type="button"
                  disabled={surgeryActionBusy || !surgeryTaskPrompt.trim()}
                  onClick={async () => {
                    setSurgeryActionBusy(true)
                    setBanner('🚀 正在拉起独立热手术舱 (:17580)、注入 DSH 源码改造任务并弹出窗口…')
                    try {
                      const res = await callHermesBridgeApi({
                        op: 'surgeryPodStart',
                        openWindow: true,
                        agentId: selectedAgent.id,
                        cwd: 'F:/3_open_source/deepseek-harness',
                        initialPrompt: surgeryTaskPrompt.trim(),
                      })
                      if (res?.ok) {
                        setSurgeryPodData(res)
                        setBanner(`✓ 已在独立热手术舱会话 (${String(res.surgeryPod?.activeSurgerySessionId ?? '')}) 中启动 DSH 改造任务并弹出独立窗口！`)
                      } else {
                        setBanner(`派发失败: ${String(res?.error ?? '未知错误')}`)
                      }
                    } finally {
                      setSurgeryActionBusy(false)
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 7,
                    border: 'none',
                    background: '#0284c7',
                    color: '#fff',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: surgeryActionBusy ? 'wait' : 'pointer',
                  }}
                >
                  🚀 发送至独立手术舱执行并弹窗
                </button>
              </div>
            </div>

            {/* Recent Operations Log */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                📜 最近双进程热手术与同步记录
              </div>
              {Array.isArray(surgeryPodData?.recentOperations) && surgeryPodData.recentOperations.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {surgeryPodData.recentOperations.slice(0, 8).map((opItem: any) => (
                    <div
                      key={String(opItem.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.08))',
                        fontSize: 11.5,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <span>
                        <strong>{String(opItem.action)}</strong>
                        {opItem.triggeredFrom ? ` (来源: ${String(opItem.triggeredFrom)})` : ''}
                        {opItem.pid ? ` · PID=${String(opItem.pid)}` : ''}
                        {opItem.sessionId ? ` · Session=${String(opItem.sessionId)}` : ''}
                        {opItem.syncDurationMs ? ` · 编译同步=${String(opItem.syncDurationMs)}ms` : ''}
                      </span>
                      <span style={{ opacity: 0.7 }}>{String(opItem.timestamp ?? '')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                  暂无操作记录，点击上方按钮即可启动独立热手术伴生进程。
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ensemble' && (
          <div className={modelCss.ensembleLayout}>
            {/* Left column: 83 Agents Selector */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 760, overflow: 'hidden' }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                🤖 选择要配置参数的智能体 ({treeData.totalAgents} 岗)
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value) }}
                placeholder="筛选岗位 (如: 终极管家 / 伴学 / 万界 / Optix)…"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  borderRadius: 7,
                  border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.3))',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 12,
                }}
              />
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                {treeData.roots.map(rootNode => (
                  <SidebarZoneBranch
                    key={rootNode.id}
                    node={rootNode}
                    depth={0}
                    query={query}
                    selectedAgentId={selectedAgent.id}
                    activeSessionByAgentId={new Map()}
                    onSelectAgent={setSelectedAgent}
                    onStartAgentSession={(agent, forceNew) => { startAgentSession(agent, undefined, forceNew) }}
                  />
                ))}
              </div>
            </div>

            {/* Right column: Parameter Configurator + Hermes MoA & Devin Fusion Workbench */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Card 1: Per-Agent Model / Reasoning Effort / Ensemble Mode Configurator */}
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>⚙️ {selectedAgent.title} (<code>{selectedAgent.id}</code>) 专属参数配置</span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: currentAgentCfg.ensembleMode === 'fusion'
                            ? 'rgba(239,68,68,0.16)'
                            : currentAgentCfg.ensembleMode === 'moa'
                              ? 'rgba(139,92,246,0.18)'
                              : 'rgba(2,132,199,0.15)',
                          color: currentAgentCfg.ensembleMode === 'fusion'
                            ? '#ef4444'
                            : currentAgentCfg.ensembleMode === 'moa'
                              ? '#8b5cf6'
                              : '#0284c7',
                        }}
                      >
                        当前模式: {String(currentAgentCfg.ensembleMode).toUpperCase()} · 推理等级: {String(currentAgentCfg.reasoningEffort).toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 }}>
                      修改后自动持久化至 <code>~/.dsh/hermes-bridge/agent-configs/agent-configs.json</code>，并在启动或续接该岗位常驻会话时通过 <code>sessionController.selectModel</code> 实时生效。
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { startAgentSession(selectedAgent) }}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#0284c7',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    💬 以当前参数进入 {selectedAgent.title} 对话
                  </button>
                </div>

                <div className={modelCss.parameterLayout}>
                  <HermesModelPicker
                    key={selectedAgent.id}
                    catalog={agentConfigsState?.catalog ?? []}
                    provider={String(currentAgentCfg.provider)}
                    model={String(currentAgentCfg.model)}
                    onSelect={(provider, model) => { void handleUpdateSelectedAgentCfg({ provider, model }) }}
                    t={t}
                  />
                  <div className={modelCss.parameterGrid}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>2. 推理等级 (Reasoning Effort)</span>
                    <select
                      value={String(currentAgentCfg.reasoningEffort || 'high')}
                      onChange={(e) => {
                        void handleUpdateSelectedAgentCfg({ reasoningEffort: e.target.value })
                      }}
                      style={{
                        padding: '7px 10px',
                        borderRadius: 7,
                        border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 12,
                      }}
                    >
                      {['low', 'medium', 'high', 'xhigh', 'max'].map(lvl => (
                        <option key={lvl} value={lvl}>{lvl.toUpperCase()} ({lvl === 'max' || lvl === 'xhigh' ? '极限深度思考' : lvl === 'high' ? '高强度推理' : lvl === 'medium' ? '均衡标准' : '极速轻量'})</option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>3. 沙箱与权限档位</span>
                    <select
                      value={String(currentAgentCfg.permissionPreset || 'danger-full-access')}
                      onChange={(e) => {
                        void handleUpdateSelectedAgentCfg({ permissionPreset: e.target.value })
                      }}
                      style={{
                        padding: '7px 10px',
                        borderRadius: 7,
                        border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 12,
                      }}
                    >
                      <option value="danger-full-access">🔓 Full Access (全权自驱免审)</option>
                      <option value="workspace-write">✍️ Workspace Write (工作区可写)</option>
                      <option value="read-only">🔒 Read Only (只读安全审计)</option>
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>4. 协同架构模式 (Single / MoA / Fusion)</span>
                    <select
                      value={String(currentAgentCfg.ensembleMode || 'single')}
                      onChange={(e) => {
                        void handleUpdateSelectedAgentCfg({ ensembleMode: e.target.value })
                      }}
                      style={{
                        padding: '7px 10px',
                        borderRadius: 7,
                        border: '1px solid rgba(139, 92, 246, 0.45)',
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <option value="single">⚡ Single (单模型极速直出)</option>
                      <option value="moa">🐝 Hermes MoA (多参谋并行献策 + 主帅聚合)</option>
                      <option value="fusion">🔥 Devin Fusion (多候选独立实现 + 盲审挑刺 + 融合主裁)</option>
                    </select>
                  </label>
                  </div>
                </div>
              </div>

              {/* Card 2: Hermes MoA vs Devin Fusion Architecture & Live Workbench */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Hermes MoA Box */}
                <div
                  style={{
                    ...cardStyle,
                    border: currentAgentCfg.ensembleMode === 'moa' ? '1.5px solid #8b5cf6' : cardStyle.border,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: '#8b5cf6' }}>
                      🐝 Hermes MoA (Mixture of Agents · 多参谋献策模式)
                    </span>
                    <select
                      value={String(currentAgentCfg.moaPreset || 'council')}
                      onChange={(e) => {
                        void handleUpdateSelectedAgentCfg({ ensembleMode: 'moa', moaPreset: e.target.value })
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid rgba(139,92,246,0.45)',
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 11.5,
                        fontWeight: 600,
                      }}
                    >
                      <option value="council">🏛️ council (4参谋内阁)</option>
                      <option value="code">💻 code (5参谋代码攻坚)</option>
                      <option value="review">🛡️ review (红队挑刺终审)</option>
                      <option value="cheap">⚡ cheap (双模极速快参)</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 }}>
                    同源移植自 Hermes <code>agent/moa_loop.py</code>：先由多路异构参谋模型（Grok-4.7、GLM-5.3、Sonnet-5.5、DeepSeek-V4.1 等）并行针对当前问题给出架构分析、盲点预警与工具策略，再由聚合主帅（GPT-6.1-Sol / Gemini-4-Argon）提炼为高密度行动指南注入 DSH 会话。
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                    {((agentConfigsState?.moaPresets?.[currentAgentCfg.moaPreset || 'council']?.referenceModels) ?? []).map((slot: any, idx: number) => (
                      <div
                        key={`moa-ref-${String(idx)}`}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 5,
                          background: 'rgba(139,92,246,0.08)',
                          fontSize: 11,
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span><strong>参谋 #{String(idx + 1)} ({String(slot.role)})</strong></span>
                        <code>{String(slot.model)} [{String(slot.reasoningEffort)}]</code>
                      </div>
                    ))}
                    <div
                      style={{
                        padding: '4px 8px',
                        borderRadius: 5,
                        background: 'rgba(2,132,199,0.12)',
                        fontSize: 11,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 700,
                      }}
                    >
                      <span>🎯 Aggregator 聚合主帅</span>
                      <code>{String(agentConfigsState?.moaPresets?.[currentAgentCfg.moaPreset || 'council']?.aggregator?.model ?? 'workbuddy-ai/gpt-6.1-sol')}</code>
                    </div>
                  </div>
                </div>

                {/* Devin Fusion Box */}
                <div
                  style={{
                    ...cardStyle,
                    border: currentAgentCfg.ensembleMode === 'fusion' ? '1.5px solid #ef4444' : cardStyle.border,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: '#ef4444' }}>
                      🔥 Devin Fusion (三阶段多模候选对抗 + 择优融合模式)
                    </span>
                    <select
                      value={String(currentAgentCfg.fusionPreset || 'trinity')}
                      onChange={(e) => {
                        void handleUpdateSelectedAgentCfg({ ensembleMode: 'fusion', fusionPreset: e.target.value })
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid rgba(239,68,68,0.45)',
                        background: 'var(--dsw-alias-bg-base)',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 11.5,
                        fontWeight: 600,
                      }}
                    >
                      <option value="trinity">🔥 trinity (三路主创+Grok挑刺+Fable主裁)</option>
                      <option value="code_fusion">⚔️ code_fusion (双路补丁竞速+盲裁合成)</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 }}>
                    复刻 Devin Fusion 深度合成管线：<strong>Stage 1</strong> 由三路旗舰模型分别从「架构完备性」、「极简可逆补丁」、「工程落地闭环」独立产出完整候选方案 (A/B/C) → <strong>Stage 2</strong> 由独立红队挑刺官交叉盲审找漏洞 → <strong>Stage 3</strong> 由终审主裁取长补短输出零缺陷融合定稿与采纳矩阵。
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                    {((agentConfigsState?.fusionPresets?.[currentAgentCfg.fusionPreset || 'trinity']?.candidates) ?? []).map((cand: any) => (
                      <div
                        key={String(cand.id)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 5,
                          background: 'rgba(239,68,68,0.08)',
                          fontSize: 11,
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span><strong>{String(cand.id)}: {String(cand.lens)}</strong></span>
                        <code>{String(cand.model)}</code>
                      </div>
                    ))}
                    <div
                      style={{
                        padding: '4px 8px',
                        borderRadius: 5,
                        background: 'rgba(245,158,11,0.12)',
                        fontSize: 11,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span><strong>Stage 2 交叉盲审挑刺官</strong></span>
                      <code>{String(agentConfigsState?.fusionPresets?.[currentAgentCfg.fusionPreset || 'trinity']?.critic?.model ?? 'workbuddy-ai/grok-4.7')}</code>
                    </div>
                    <div
                      style={{
                        padding: '4px 8px',
                        borderRadius: 5,
                        background: 'rgba(16,185,129,0.14)',
                        fontSize: 11,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 700,
                      }}
                    >
                      <span>⚖️ Stage 3 终审融合主裁 (Judge)</span>
                      <code>{String(agentConfigsState?.fusionPresets?.[currentAgentCfg.fusionPreset || 'trinity']?.judge?.model ?? 'group/claude-fable-5-1')}</code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 3: Interactive MoA & Fusion Execution Console */}
              <div style={cardStyle}>
                <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 8 }}>
                  🚀 MoA / Devin Fusion 实时演练与一键注入 DSH 会话控制台
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    value={ensemblePrompt}
                    onChange={(e) => { setEnsemblePrompt(e.target.value) }}
                    placeholder="输入需要多模型参谋聚合 (MoA) 或三阶段候选对抗融合 (Devin Fusion) 的问题/任务…"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 12.5,
                    }}
                  />
                  <button
                    type="button"
                    disabled={ensembleRunning}
                    onClick={() => { void handleRunEnsemble('moa', false) }}
                    style={{
                      padding: '8px 13px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#8b5cf6',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: ensembleRunning ? 'wait' : 'pointer',
                    }}
                  >
                    🐝 运行 Hermes MoA
                  </button>
                  <button
                    type="button"
                    disabled={ensembleRunning}
                    onClick={() => { void handleRunEnsemble('fusion', false) }}
                    style={{
                      padding: '8px 13px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#ef4444',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: ensembleRunning ? 'wait' : 'pointer',
                    }}
                  >
                    🔥 运行 Devin Fusion
                  </button>
                  <button
                    type="button"
                    disabled={ensembleRunning}
                    onClick={() => { void handleRunEnsemble(currentAgentCfg.ensembleMode === 'fusion' ? 'fusion' : 'moa', true) }}
                    title="执行多模型聚合并将聚合指导直接注入当前选中智能体的 DSH 常驻会话"
                    style={{
                      padding: '8px 13px',
                      borderRadius: 8,
                      border: '1px solid #059669',
                      background: 'rgba(16,185,129,0.14)',
                      color: '#059669',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: ensembleRunning ? 'wait' : 'pointer',
                    }}
                  >
                    💉 聚合并注入 DSH 会话
                  </button>
                </div>

                <div style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' }}>
                  💡 提示：除在此面板执行外，你在任何 DSH 对话框中也可以直接输入斜杠命令 <code>/hermes moa council &lt;问题&gt;</code>、<code>/hermes fusion trinity &lt;问题&gt;</code>、<code>/hermes config &lt;agentId&gt; &lt;model&gt; &lt;effort&gt;</code>，或让智能体自主调用原生工具 <code>hermes_moa_fusion</code>。
                </div>

                {ensembleResult !== null && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.28))',
                      background: 'var(--dsw-alias-bg-layer-2, rgba(15,23,42,0.04))',
                      fontSize: 12,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 360,
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6, color: ensembleResult.mode === 'fusion' ? '#ef4444' : '#8b5cf6' }}>
                      {ensembleResult.mode === 'fusion' ? '🔥 Devin Fusion 融合输出' : '🐝 Hermes MoA 聚合输出'} ({String(ensembleResult.presetName)} · 耗时 {String(ensembleResult.totalDurationMs)}ms)
                    </div>
                    {String(ensembleResult.fusionBlock ?? ensembleResult.guidanceBlock ?? '')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'warroom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* War Room Top Summary & Sub-navigation */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🎯 E:/6_learn_space 作战大屏 (DSH 原生插件集成视图)</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: warRoomData?.liveServer?.online ? 'rgba(16,185,129,0.16)' : 'rgba(148,163,184,0.16)',
                        color: warRoomData?.liveServer?.online ? '#059669' : 'var(--dsw-alias-label-secondary)',
                      }}
                    >
                      {warRoomData?.liveServer?.online ? '🟢 :18765 Web大屏在线' : '⚡ DSH直连本地SQLite/JSON实时引擎'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 }}>
                    {String(warRoomData?.ownerActions?.headline ?? '')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => { void handleStartWarRoomLiveServer() }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 7,
                      border: '1px solid rgba(16, 185, 129, 0.45)',
                      background: 'rgba(16, 185, 129, 0.12)',
                      color: '#059669',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🚀 启动/重连 :18765 原生服务
                  </button>
                  <button
                    type="button"
                    onClick={() => { setWarRoomSubTab(warRoomSubTab === 'iframe' ? 'overview' : 'iframe') }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 7,
                      border: '1px solid rgba(2, 132, 199, 0.45)',
                      background: warRoomSubTab === 'iframe' ? '#0284c7' : 'rgba(2, 132, 199, 0.12)',
                      color: warRoomSubTab === 'iframe' ? '#fff' : '#0284c7',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {warRoomSubTab === 'iframe' ? '📊 切回 DSH 原生卡片视图' : '🖥️ 内嵌预览 :18765 网页大屏'}
                  </button>
                </div>
              </div>

              {/* 6 KPI Stat Tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
                {[
                  {
                    label: '11 项 M1 自驱门禁',
                    value: `${String(warRoomData?.summary?.gatesPassCount ?? 10)} / ${String(warRoomData?.summary?.gatesTotalCount ?? 11)}`,
                    sub: '内部自驱流水线自动验算',
                    color: '#10b981',
                  },
                  {
                    label: '初一数学 45 节课包',
                    value: `${String(warRoomData?.summary?.lessonsPassCount ?? 45)} / ${String(warRoomData?.summary?.lessonsTotalCount ?? 45)}`,
                    sub: '七上 26 节 + 七下 19 节',
                    color: '#0284c7',
                  },
                  {
                    label: '9 大异构模型算力池',
                    value: `${String(warRoomData?.summary?.llmPoolsCount ?? 9)} 池在线`,
                    sub: 'S1~S4 导师 + A~E 苦力池',
                    color: '#8b5cf6',
                  },
                  {
                    label: '飞书任务主清单督办',
                    value: `${String(warRoomData?.summary?.feishuClosedTasks ?? 0)} 已关单`,
                    sub: `当前 Open 挂单: ${String(warRoomData?.summary?.feishuOpenTasks ?? 0)}`,
                    color: '#f59e0b',
                  },
                  {
                    label: '本地 Kanban 哨兵队列',
                    value: `Done ${String(warRoomData?.kanban?.counts?.done ?? 0)}`,
                    sub: `Ready ${String(warRoomData?.kanban?.counts?.ready ?? 0)} · Run ${String(warRoomData?.kanban?.counts?.running ?? 0)}`,
                    color: '#14b8a6',
                  },
                  {
                    label: '83 岗智能体工位状态',
                    value: `活跃 ${String((warRoomData?.summary?.workingCount ?? 0) + (warRoomData?.summary?.recentCount ?? 0))}`,
                    sub: `Online ${String(warRoomData?.summary?.onlineCount ?? 0)} · 共 ${String(warRoomData?.summary?.totalAgents ?? 83)} 岗`,
                    color: '#ec4899',
                  },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.22))',
                      background: 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.06))',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }}>{kpi.label}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: kpi.color, marginTop: 3 }}>{kpi.value}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.78, marginTop: 2 }}>{kpi.sub}</div>
                  </div>
                ))}
              </div>

              {/* Sub-tab selector */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  ['overview', '📊 全局态势总览 (待办 + 门禁 + 算力池 + 实时流)'],
                  ['gates', '🛡️ 11 项 M1 治理门禁 & 24h 实质交付'],
                  ['pools', '⚡ 9 大模型算力池配额 & 3NF Token 账本 & 跑分榜'],
                  ['lessons', '📚 初一数学 45 节课包矩阵 (七上26 + 七下19)'],
                  ['tasks', '📌 飞书任务主清单督办 & Kanban 哨兵 & 83 工位'],
                  ['iframe', '🖥️ :18765 原生网页大屏 (Iframe)'],
                ] as const).map(([sKey, sLabel]) => (
                  <button
                    key={sKey}
                    type="button"
                    onClick={() => { setWarRoomSubTab(sKey) }}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 6,
                      border: warRoomSubTab === sKey
                        ? '1px solid #0284c7'
                        : '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25))',
                      background: warRoomSubTab === sKey ? 'rgba(2, 132, 199, 0.15)' : 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 11.5,
                      fontWeight: warRoomSubTab === sKey ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {sLabel}
                  </button>
                ))}
              </div>
            </div>

            {warRoomSubTab === 'iframe' && (
              <div style={{ ...cardStyle, height: 680, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    🖥️ E:/6_learn_space 原生网页版作战大屏 (http://127.0.0.1:18765)
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handleStartWarRoomLiveServer() }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid #059669',
                      background: 'rgba(16,185,129,0.12)',
                      color: '#059669',
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    若未显示请点此启动 :18765 服务
                  </button>
                </div>
                <iframe
                  src="http://127.0.0.1:18765"
                  title="E:/6_learn_space Live War Room"
                  style={{ flex: 1, width: '100%', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 8, background: '#0f172a' }}
                />
              </div>
            )}

            {(warRoomSubTab === 'overview' || warRoomSubTab === 'gates') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 16 }}>
                {/* Owner Action Now + 24h Deliveries */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={cardStyle}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                      🚨 所有者待决事项 (OWNER-ACTION-NOW.md)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(warRoomData?.ownerActions?.items ?? []).map((it: any) => (
                        <div
                          key={String(it.id)}
                          style={{
                            padding: '9px 11px',
                            borderRadius: 8,
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            background: 'rgba(245, 158, 11, 0.07)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700 }}>
                              <span style={{ color: '#d97706', marginRight: 6 }}>[{String(it.priority)}]</span>
                              {String(it.title)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const ag = findAgentById(String(it.targetAgentId || 'bl-company-coordinator'))
                                if (ag) startAgentSession(ag)
                              }}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 5,
                                border: 'none',
                                background: '#0284c7',
                                color: '#fff',
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                flex: 'none',
                              }}
                            >
                              💬 对话 {String(it.targetAgentId)}
                            </button>
                          </div>
                          <div style={{ marginTop: 4, opacity: 0.85, fontSize: 11.5 }}>
                            影响范围：{String(it.BlockingScope)}
                          </div>
                          <div style={{ marginTop: 2, opacity: 0.78, fontSize: 11 }}>
                            操作建议：{String(it.actionHint)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                      📦 E:/6_learn_space 核心实质交付报告 (HTML 验收台)
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(warRoomData?.substantiveDeliveries ?? []).map((doc: any) => (
                        <div
                          key={String(doc.relPath)}
                          style={{
                            padding: '7px 10px',
                            borderRadius: 7,
                            border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.22))',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 11.5,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{String(doc.label)}</div>
                            <div style={{ opacity: 0.72, fontSize: 10.5 }}>
                              <code>{String(doc.relPath)}</code> · {String(doc.sizeKb)} KB · 更新于 {String(doc.updatedAt)}
                            </div>
                          </div>
                          <span style={{ color: '#10b981', fontWeight: 700, fontSize: 11 }}>✓ 已落盘</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 11 Governance Gates */}
                <div style={cardStyle}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    🛡️ 11 项 M1 自驱治理门禁 (Governance Gates)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(warRoomData?.governanceGates ?? []).map((g: any) => (
                      <div
                        key={String(g.id)}
                        style={{
                          padding: '9px 11px',
                          borderRadius: 8,
                          border: g.status === 'PASS'
                            ? '1px solid rgba(16, 185, 129, 0.35)'
                            : '1px solid rgba(2, 132, 199, 0.35)',
                          background: g.status === 'PASS'
                            ? 'rgba(16, 185, 129, 0.06)'
                            : 'rgba(2, 132, 199, 0.06)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>{String(g.title)}</span>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 7px',
                              borderRadius: 999,
                              background: g.status === 'PASS' ? 'rgba(16,185,129,0.18)' : 'rgba(2,132,199,0.18)',
                              color: g.status === 'PASS' ? '#059669' : '#0284c7',
                              fontWeight: 700,
                              flex: 'none',
                            }}
                          >
                            {String(g.badge)}
                          </span>
                        </div>
                        <div style={{ marginTop: 4, opacity: 0.84, fontSize: 11.5 }}>{String(g.detail)}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, fontSize: 11 }}>
                          <span style={{ opacity: 0.75 }}>
                            责任岗: <code>{String(g.targetProfile)}</code> ({String(g.targetBot)})
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const ag = findAgentById(String(g.targetProfile || 'bl-company-coordinator'))
                              if (ag) startAgentSession(ag)
                            }}
                            style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              border: '1px solid #0284c7',
                              background: 'transparent',
                              color: '#0284c7',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            💬 与该岗位对话
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(warRoomSubTab === 'overview' || warRoomSubTab === 'pools') && (
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    ⚡ S1~S4 导师池 & A~E 主力算力池实时水位 (3NF 资源账本 · Snapshot {String(warRoomData?.llmPools?.snapshotUpdatedAt ?? '')})
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' }}>
                    ≤5% 自动切换保底 · &gt;20% 重置卡自动切回
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {(warRoomData?.llmPools?.pools ?? []).map((pool: any) => (
                    <div
                      key={String(pool.providerId)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25))',
                        background: 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.04))',
                        fontSize: 11.5,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: String(pool.color || '#0284c7'),
                              color: '#fff',
                              fontSize: 10.5,
                              marginRight: 6,
                            }}
                          >
                            {String(pool.tier)}
                          </span>
                          {String(pool.vendor)}
                        </span>
                        <span style={{ fontSize: 11, opacity: 0.8 }}>
                          绑定 <strong>{String(pool.roleCount)}</strong> 岗 · 调用 {String(pool.totalApiCalls)} 次
                        </span>
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.82 }}>{String(pool.purpose)}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
                        {(pool.windows ?? []).map((w: any, wIdx: number) => (
                          <div key={`${String(pool.providerId)}-w-${String(wIdx)}`} style={{ fontSize: 11 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>{String(w.label)}</span>
                              <strong style={{ color: Number(w.remainingPct) <= 10 ? '#ef4444' : '#10b981' }}>
                                剩 {String(w.remainingPct)}% ({String(w.resetStr)})
                              </strong>
                            </div>
                            <div
                              style={{
                                height: 5,
                                borderRadius: 999,
                                background: 'rgba(148,163,184,0.2)',
                                overflow: 'hidden',
                                marginTop: 2,
                              }}
                            >
                              <div
                                style={{
                                  width: `${String(Math.max(0, Math.min(100, Number(w.remainingPct ?? 100))))}%`,
                                  height: '100%',
                                  background: Number(w.remainingPct) <= 10 ? '#ef4444' : String(pool.color || '#10b981'),
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {warRoomSubTab === 'pools' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                        📊 Top 12 岗位 Token 消耗账本 (session_token_ledger)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {(warRoomData?.llmPools?.topTokenConsumers ?? []).map((row: any, i: number) => (
                          <div
                            key={`${String(row.profileId)}-${String(i)}`}
                            style={{
                              padding: '6px 9px',
                              borderRadius: 6,
                              border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.2))',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: 11,
                            }}
                          >
                            <span>
                              <code>{String(row.profileId)}</code> · {String(row.modelId)}
                            </span>
                            <span>
                              Calls: {String(row.apiCalls)} · In: {String(Math.round(Number(row.inputTokens || 0) / 1000))}k · Out: {String(Math.round(Number(row.outputTokens || 0) / 1000))}k
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                        🏆 模型能力 Benchmark 矩阵 (SWE-bench & AIME)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {(warRoomData?.llmPools?.benchmarks ?? []).map((b: any) => (
                          <div
                            key={String(b.modelId)}
                            style={{
                              padding: '6px 9px',
                              borderRadius: 6,
                              border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.2))',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: 11,
                            }}
                          >
                            <span>
                              <strong>[{String(b.poolTier)}] {String(b.displayName)}</strong> ({String(b.contextWindow)})
                            </span>
                            <span>
                              SWE: <strong>{String(b.sweBenchVerified)}</strong> · AIME: <strong>{String(b.aimeMath)}</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(warRoomSubTab === 'overview' || warRoomSubTab === 'lessons') && (
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    📚 初一数学 45 节三高课包矩阵进度 (七上 26 节 + 七下 19 节 · 已就绪 {String(warRoomData?.sectionStages45?.passOrSyncedCount ?? 45)}/{String(warRoomData?.sectionStages45?.total ?? 45)})
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const ag = findAgentById('bl-curriculum-engineer')
                      if (ag) startAgentSession(ag)
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid #0284c7',
                      background: 'rgba(2,132,199,0.1)',
                      color: '#0284c7',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    💬 对话 @课程工程 (bl-curriculum-engineer)
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 6 }}>
                  {(warRoomData?.sectionStages45?.items ?? []).map((sec: any) => (
                    <div
                      key={String(sec.section)}
                      style={{
                        padding: '6px 7px',
                        borderRadius: 6,
                        border: `1px solid ${String(sec.color || '#10b981')}55`,
                        background: `${String(sec.color || '#10b981')}14`,
                        fontSize: 10.5,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                        <span>§{String(sec.section)}</span>
                        <span style={{ opacity: 0.75 }}>{String(sec.semester)}</span>
                      </div>
                      <div style={{ color: String(sec.color || '#10b981'), fontWeight: 600, marginTop: 2, fontSize: 10 }}>
                        {String(sec.badge)}
                      </div>
                      <div style={{ opacity: 0.72, fontSize: 9.5, marginTop: 1 }}>{String(sec.sub)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(warRoomSubTab === 'overview' || warRoomSubTab === 'tasks') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Feishu Tasklist & Kanban */}
                <div style={cardStyle}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    📌 飞书任务主清单督办 (Open {String(warRoomData?.feishuTasklist?.openCount ?? 0)} · Closed {String(warRoomData?.feishuTasklist?.closedCount ?? 0)})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                    {(warRoomData?.feishuTasklist?.openTasks ?? []).slice(0, 14).map((t: any) => (
                      <div
                        key={String(t.guid)}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 7,
                          border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.22))',
                          fontSize: 11.5,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{String(t.summary)}</div>
                        <div style={{ opacity: 0.7, fontSize: 10.5, marginTop: 2 }}>
                          GUID: <code>{String(t.guid)}</code> · 状态: 待推进/收口
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Workstation Stream */}
                <div style={cardStyle}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    🤖 83 岗智能体实时工位与最新消息流 (点击直接对话)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                    {(warRoomData?.workstations ?? []).slice(0, 18).map((ws: any) => (
                      <div
                        key={String(ws.id)}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 7,
                          border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.22))',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 11.5,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '1px 5px',
                                borderRadius: 4,
                                fontSize: 10,
                                marginRight: 6,
                                background: ws.status === 'WORKING' ? 'rgba(16,185,129,0.2)' : 'rgba(2,132,199,0.15)',
                                color: ws.status === 'WORKING' ? '#059669' : '#0284c7',
                              }}
                            >
                              {String(ws.status)}
                            </span>
                            {String(ws.title)} (<code>{String(ws.id)}</code>)
                          </div>
                          <div
                            style={{
                              opacity: 0.78,
                              fontSize: 10.5,
                              marginTop: 2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            会话 {String(ws.sessionCount)} · 消息 {String(ws.totalMessages)} · 工具 {String(ws.totalToolCalls)} · 最近: {String(ws.lastActiveAt)} — {String(ws.lastPreview || ws.lastSessionTitle || '就绪')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const ag = findAgentById(String(ws.id))
                            if (ag) startAgentSession(ag)
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 5,
                            border: 'none',
                            background: '#0284c7',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            flex: 'none',
                          }}
                        >
                          对话
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'org' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 1. Supreme Military Order-of-Battle (OOB) Command Header */}
            <div
              style={{
                ...cardStyle,
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.09) 0%, rgba(2, 132, 199, 0.08) 55%, rgba(16, 185, 129, 0.07) 100%)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(245, 158, 11, 0.22)',
                        color: '#d97706',
                        fontSize: 11,
                        fontWeight: 800,
                        fontFamily: 'monospace',
                      }}
                    >
                      DEFCON-1 · READY
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800 }}>
                      🎖️ 全军五级建制与作战序列管理系统 (Military Order of Battle & C2)
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 6, lineHeight: 1.55 }}>
                    <strong>最高统帅部：</strong>最高统帅 <code>胡飞扬 (OWNER)</code> ➔ 五星总参谋长 <code>👑 终极管家 (default · JOC-00)</code> ➔ 统辖 <strong>三大战区 / 两大集团军 / 15 个合成旅与特遣营 / {treeData.totalAgents} 名满编战将</strong>（全员配备直属指挥官 <code>supervisor</code> + 独立宪兵督察官 <code>reviewer</code>）
                  </div>
                </div>

                {/* View Mode Switcher */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => { setOrgViewMode('matrix') }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 7,
                      border: orgViewMode === 'matrix' ? '1px solid #d97706' : '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.3))',
                      background: orgViewMode === 'matrix' ? 'rgba(245, 158, 11, 0.18)' : 'transparent',
                      color: orgViewMode === 'matrix' ? '#d97706' : 'var(--dsw-alias-label-primary)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🗺️ 战区合成旅方阵沙盘 (15旅/营)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOrgViewMode('tree') }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 7,
                      border: orgViewMode === 'tree' ? '1px solid #0284c7' : '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.3))',
                      background: orgViewMode === 'tree' ? 'rgba(2, 132, 199, 0.16)' : 'transparent',
                      color: orgViewMode === 'tree' ? '#0284c7' : 'var(--dsw-alias-label-primary)',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🌲 五级建制树视图
                  </button>
                </div>
              </div>

              {/* 5-Branch Military Force Breakdown & Filter Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 12 }}>
                {([
                  ['all', '🎖️ 全军满编兵力', `${String(orgBranchCounts.all)} 员战将`, '三大战区 · 15 合成旅/营', '#0284c7'],
                  ['command', '⭐ 将帅与指挥参谋部', `${String(orgBranchCounts.command)} 名主官`, '总参 / 战区 / 集团军 / 旅营长', '#d97706'],
                  ['assault', '⚔️ 主力工程与突击兵', `${String(orgBranchCounts.assault)} 名突击手`, '代码 / 美术 / 课程 / 多模态攻坚', '#059669'],
                  ['mp', '🛡️ 宪兵督察与独立QA', `${String(orgBranchCounts.mp)} 名督察官`, '红队代码审查 / 教学验收 / 盲测', '#8b5cf6'],
                  ['staff', '🧭 参谋情报与后勤保障', `${String(orgBranchCounts.staff)} 名参谋官`, '架构 / 策划 / 数据 / 法务财务', '#0ea5e9'],
                ] as const).map(([key, title, stat, sub, accent]) => {
                  const active = orgBranchFilter === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setOrgBranchFilter(key) }}
                      style={{
                        textAlign: 'left',
                        padding: '9px 11px',
                        borderRadius: 8,
                        border: active ? `1.5px solid ${accent}` : '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.24))',
                        background: active ? `${accent}1f` : 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.03))',
                        color: 'var(--dsw-alias-label-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 11, opacity: 0.82, fontWeight: 600 }}>{title}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: accent, marginTop: 2 }}>{stat}</div>
                      <div style={{ fontSize: 10.5, opacity: 0.72, marginTop: 2 }}>{sub}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. Main Split Workspace: Left (OOB Matrix OR 4-Level Tree) + Right (Officer Dossier & C2 Console) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: orgViewMode === 'matrix' ? '1.35fr 1fr' : '380px 1fr',
                gap: 18,
                minHeight: 620,
                alignItems: 'start',
              }}
            >
              {/* Left Pane: Order-of-Battle Brigade Matrix OR 4-Level Military Tree */}
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 820, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {orgViewMode === 'matrix'
                      ? '🗺️ 三大战区 · 15 合成旅/独立营作战方阵沙盘'
                      : `🌲 五级军队建制指挥树 (${String(treeData.totalAgents)} 人)`}
                  </div>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value) }}
                    placeholder="搜索番号 (如 BDE-BX-101 / WJ-P01) / 军衔 / 姓名…"
                    style={{
                      width: 240,
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.3))',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 12,
                    }}
                  />
                </div>

                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {orgViewMode === 'tree' ? (
                    treeData.roots.map(rootNode => (
                      <SidebarZoneBranch
                        key={rootNode.id}
                        node={rootNode}
                        depth={0}
                        query={query}
                        branchFilter={orgBranchFilter}
                        groupByBrigade
                        selectedAgentId={selectedAgent.id}
                        activeSessionByAgentId={new Map()}
                        onSelectAgent={setSelectedAgent}
                        onStartAgentSession={(agent, forceNew) => { startAgentSession(agent, undefined, forceNew) }}
                      />
                    ))
                  ) : (
                    allOrgSectionsWithBrigades.map((sec) => {
                      const q = query.trim().toLowerCase()
                      const brigades = (sec.brigades ?? []).map(bde => ({
                        ...bde,
                        visibleAgents: bde.agents.filter(a => agentMatchesQuery(a, q, orgBranchFilter)),
                      })).filter(bde => bde.visibleAgents.length > 0)
                      if (brigades.length === 0) return null

                      return (
                        <div
                          key={sec.id}
                          style={{
                            borderRadius: 10,
                            border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.28))',
                            background: 'var(--dsw-alias-bg-layer-2, rgba(15,23,42,0.03))',
                            padding: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: 4,
                                  background: 'rgba(245, 158, 11, 0.18)',
                                  color: '#d97706',
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  fontWeight: 800,
                                }}
                              >
                                {sec.theaterCode ?? sec.id.toUpperCase()}
                              </span>
                              <span style={{ fontWeight: 800, fontSize: 13.5 }}>
                                {sec.militaryTitle ?? sec.path}
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: sec.feishuProfile === 'company' ? 'rgba(234,88,12,0.16)' : 'rgba(16,185,129,0.16)',
                                color: sec.feishuProfile === 'company' ? '#ea580c' : '#059669',
                                fontWeight: 700,
                              }}
                            >
                              频段: --profile {sec.feishuProfile} · 下辖 {brigades.length} 个旅/营
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: brigades.length > 1 ? 'repeat(2, 1fr)' : '1fr', gap: 10 }}>
                            {brigades.map((bde) => {
                              const cmdAgent = findAgentById(bde.commanderId)
                              const mpAgent = bde.commissarId ? findAgentById(bde.commissarId) : undefined
                              return (
                                <div
                                  key={bde.id}
                                  style={{
                                    borderRadius: 8,
                                    border: '1px solid rgba(2, 132, 199, 0.28)',
                                    background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.03))',
                                    padding: 10,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 7,
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span
                                          style={{
                                            fontSize: 10,
                                            padding: '1px 5px',
                                            borderRadius: 3,
                                            background: 'rgba(2, 132, 199, 0.18)',
                                            color: '#0284c7',
                                            fontFamily: 'monospace',
                                            fontWeight: 800,
                                          }}
                                        >
                                          {bde.code}
                                        </span>
                                        <span style={{ fontWeight: 800, fontSize: 12.5 }}>{bde.name}</span>
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 3, lineHeight: 1.4 }}>
                                        {bde.mission}
                                      </div>
                                    </div>
                                    <span
                                      style={{
                                        fontSize: 10.5,
                                        padding: '2px 7px',
                                        borderRadius: 999,
                                        background: 'rgba(245, 158, 11, 0.16)',
                                        color: '#d97706',
                                        fontWeight: 800,
                                        flex: 'none',
                                      }}
                                    >
                                      {bde.visibleAgents.length}人
                                    </span>
                                  </div>

                                  {/* Brigade Commander & MP Commissar bar */}
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: 6,
                                      padding: '5px 7px',
                                      borderRadius: 6,
                                      background: 'rgba(148, 163, 184, 0.08)',
                                      fontSize: 11,
                                    }}
                                  >
                                    {cmdAgent && (
                                      <button
                                        type="button"
                                        onClick={() => { setSelectedAgent(cmdAgent) }}
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          color: '#d97706',
                                          fontWeight: 700,
                                          fontSize: 11,
                                          padding: 0,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        ⭐⭐ 主官: {cmdAgent.title}
                                      </button>
                                    )}
                                    {mpAgent && (
                                      <button
                                        type="button"
                                        onClick={() => { setSelectedAgent(mpAgent) }}
                                        style={{
                                          border: 'none',
                                          background: 'transparent',
                                          color: '#8b5cf6',
                                          fontWeight: 700,
                                          fontSize: 11,
                                          padding: 0,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        ｜ 🛡️ 督察: {mpAgent.title}
                                      </button>
                                    )}
                                  </div>

                                  {/* Brigade Roster Chips */}
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                    {bde.visibleAgents.map((ag) => {
                                      const isSel = selectedAgent.id === ag.id
                                      const rk = getRankVisualStyle(ag)
                                      return (
                                        <button
                                          key={ag.id}
                                          type="button"
                                          onClick={() => { setSelectedAgent(ag) }}
                                          title={`【${ag.militaryRank ?? ''} · ${ag.callsign ?? ag.id}】${ag.title}\n点击查看军籍档案，双击直接点将对话`}
                                          onDoubleClick={() => { startAgentSession(ag) }}
                                          style={{
                                            padding: '3px 7px',
                                            borderRadius: 5,
                                            border: isSel ? '1.5px solid #0284c7' : `1px solid ${rk.border}`,
                                            background: isSel ? 'rgba(2, 132, 199, 0.18)' : rk.bg,
                                            color: isSel ? '#0284c7' : 'var(--dsw-alias-label-primary)',
                                            fontSize: 11,
                                            fontWeight: (ag.rankTier ?? 5) <= 3 || isSel ? 700 : 500,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                          }}
                                        >
                                          <span style={{ color: rk.color, fontFamily: 'monospace', fontSize: 10 }}>
                                            {rk.badge}{ag.callsign ?? ''}
                                          </span>
                                          <span>{ag.title}</span>
                                        </button>
                                      )
                                    })}
                                  </div>

                                  {/* Brigade-level Tactical Order Action */}
                                  {cmdAgent && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedAgent(cmdAgent)
                                          const rosterNames = bde.visibleAgents.map(a => `${a.title}(${a.id})`).join('、')
                                          setDispatchPrompt(
                                            `【作战军令 · ${bde.code} ${bde.name}】请作为本旅主官 (${cmdAgent.title}) 统筹麾下编制（${rosterNames}），针对防区 ${cmdAgent.projectRoot} 执行以下作战任务并由宪兵督察 (${String(bde.commissarId ?? 'QA')}) 验收：`,
                                          )
                                        }}
                                        style={{
                                          padding: '3px 8px',
                                          borderRadius: 5,
                                          border: '1px solid rgba(245, 158, 11, 0.45)',
                                          background: 'rgba(245, 158, 11, 0.12)',
                                          color: '#d97706',
                                          fontSize: 10.5,
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                        }}
                                      >
                                        📣 向本旅下达作战军令 (主官领衔)
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Officer Tactical Dossier & C2 Command Console */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 5,
                            background: 'rgba(245, 158, 11, 0.18)',
                            color: '#d97706',
                            fontWeight: 800,
                            fontSize: 11.5,
                            fontFamily: 'monospace',
                          }}
                        >
                          {selectedAgent.militaryRank ?? '⚔️ 突击少校'} · 番号 {selectedAgent.callsign ?? selectedAgent.id}
                        </span>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 5,
                            background: 'rgba(2, 132, 199, 0.14)',
                            color: '#0284c7',
                            fontWeight: 700,
                            fontSize: 11.5,
                          }}
                        >
                          {selectedAgent.branchLabel ?? selectedAgent.department}
                        </span>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            background: selectedAgent.feishuProfile === 'company' ? 'rgba(234,88,12,0.16)' : 'rgba(16,185,129,0.16)',
                            color: selectedAgent.feishuProfile === 'company' ? '#ea580c' : '#059669',
                          }}
                        >
                          加密频段: --profile {selectedAgent.feishuProfile}
                        </span>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>
                        {selectedAgent.title}
                        <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75, marginLeft: 8 }}>
                          ({selectedAgent.id})
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }}>
                        防区建制：<strong>{selectedAgent.sectionPath}</strong> · 编制部门：{selectedAgent.department} · 席位序列：第 {String(selectedAgent.seatOrder ?? 1).padStart(2, '0')} 号
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { startAgentSession(selectedAgent) }}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#0284c7',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 12.5,
                        cursor: 'pointer',
                      }}
                    >
                      ⚡ 升帐点将 (启动 DSH 常驻作战室)
                    </button>
                  </div>

                  {/* Interactive Chain of Command & MP Reviewer Card */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 10,
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 8,
                      background: 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.08))',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.22))',
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <div style={{ opacity: 0.72, fontSize: 11 }}>⬆️ 直属上级指挥官 (Supervisor)</div>
                      {(() => {
                        const supAgent = findAgentById(selectedAgent.supervisor)
                        if (supAgent) {
                          return (
                            <button
                              type="button"
                              onClick={() => { setSelectedAgent(supAgent) }}
                              style={{
                                marginTop: 4,
                                padding: '4px 8px',
                                borderRadius: 5,
                                border: '1px solid rgba(245, 158, 11, 0.4)',
                                background: 'rgba(245, 158, 11, 0.12)',
                                color: '#d97706',
                                fontWeight: 700,
                                fontSize: 11.5,
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                              }}
                            >
                              {supAgent.rankBadge ?? '⭐'} {supAgent.title} ({supAgent.id})
                            </button>
                          )
                        }
                        return (
                          <div style={{ fontWeight: 700, marginTop: 4, color: '#d97706' }}>
                            👑 最高统帅 ({selectedAgent.supervisor})
                          </div>
                        )
                      })()}
                    </div>

                    <div>
                      <div style={{ opacity: 0.72, fontSize: 11 }}>🛡️ 独立宪兵督察官 (Reviewer / QA)</div>
                      {(() => {
                        const revAgent = selectedAgent.reviewer ? findAgentById(selectedAgent.reviewer) : undefined
                        if (revAgent) {
                          return (
                            <button
                              type="button"
                              onClick={() => { setSelectedAgent(revAgent) }}
                              style={{
                                marginTop: 4,
                                padding: '4px 8px',
                                borderRadius: 5,
                                border: '1px solid rgba(139, 92, 246, 0.4)',
                                background: 'rgba(139, 92, 246, 0.12)',
                                color: '#8b5cf6',
                                fontWeight: 700,
                                fontSize: 11.5,
                                cursor: 'pointer',
                                textAlign: 'left',
                                width: '100%',
                              }}
                            >
                              🛡️ {revAgent.title} ({revAgent.id})
                            </button>
                          )
                        }
                        return (
                          <div style={{ fontWeight: 600, marginTop: 4, opacity: 0.8 }}>
                            <code>{selectedAgent.reviewer ?? '总参宪兵直辖'}</code>
                          </div>
                        )
                      })()}
                    </div>

                    <div>
                      <div style={{ opacity: 0.72, fontSize: 11 }}>📍 驻防目录 & 预设武器库</div>
                      <div style={{ fontWeight: 600, marginTop: 4, fontSize: 11.5 }}>
                        <code>{selectedAgent.projectRoot}</code>
                      </div>
                      <div style={{ fontSize: 10.5, opacity: 0.75, marginTop: 2 }}>
                        武器: <code>{String(currentAgentCfg.model)}</code> ({String(currentAgentCfg.reasoningEffort).toUpperCase()})
                      </div>
                    </div>
                  </div>

                  {/* Direct Subordinates Roster (if Commander / Lead) */}
                  {(selectedAgent.subordinateIds?.length ?? 0) > 0 && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        background: 'rgba(245, 158, 11, 0.06)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#d97706' }}>
                          ⬇️ 麾下直辖作战部队 ({selectedAgent.subordinateIds!.length} 员直属战将)
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const subNames = selectedAgent.subordinateIds!
                              .map(id => findAgentById(id))
                              .filter((a): a is HermesAgentNode => a !== undefined)
                              .map(a => `${a.title}(${a.id})`)
                              .join('、')
                            setDispatchPrompt(
                              `【将军升帐 · 旅营协同军令】请作为 ${selectedAgent.title} (${selectedAgent.id}) 统领直属部下（${subNames}），在防区 ${selectedAgent.projectRoot} 协同推进以下战役目标：`,
                            )
                          }}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 5,
                            border: '1px solid #d97706',
                            background: 'rgba(245, 158, 11, 0.16)',
                            color: '#d97706',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          📣 拟定全队联合作战军令
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {selectedAgent.subordinateIds!.map((subId) => {
                          const sub = findAgentById(subId)
                          if (!sub) return null
                          const rk = getRankVisualStyle(sub)
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => { setSelectedAgent(sub) }}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 5,
                                border: `1px solid ${rk.border}`,
                                background: rk.bg,
                                color: 'var(--dsw-alias-label-primary)',
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{ color: rk.color, fontFamily: 'monospace', marginRight: 4 }}>
                                {rk.badge}{sub.callsign ?? ''}
                              </span>
                              {sub.title}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.6 }}>
                    <strong>📜 作战条令与岗位职责 (SOUL 摘要)：</strong> {selectedAgent.description}
                  </div>

                  {/* Tactical Order Dispatch Box */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <input
                      type="text"
                      value={dispatchPrompt}
                      onChange={(e) => { setDispatchPrompt(e.target.value) }}
                      placeholder={`向 ${selectedAgent.militaryRank ?? ''} ${selectedAgent.title} (${selectedAgent.callsign ?? selectedAgent.id}) 下达作战军令…`}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                        background: 'transparent',
                        color: 'var(--dsw-alias-label-primary)',
                        fontSize: 12.5,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => { startAgentSession(selectedAgent, dispatchPrompt.trim() || undefined) }}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: '1px solid #0284c7',
                        background: 'rgba(2,132,199,0.12)',
                        color: '#0284c7',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      填入 DSH 作战室
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleDispatchBackground() }}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#059669',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      🚀 后台异步传令
                    </button>
                  </div>
                </div>

                {/* Recent Hermes state.db sessions */}
                <div style={cardStyle}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>
                    💬 该战将最近作战记录 (Hermes state.db 已清洗系统提示词噪声)
                  </div>
                  {sessions.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
                      该战将暂无历史作战记录，点击上方「⚡ 升帐点将」即可开启首个原生会话。
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sessions.map(sess => (
                        <div
                          key={sess.id}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.2))',
                            background: 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.05))',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                            <span>{sess.cleanTitle || sess.id}</span>
                            <span style={{ opacity: 0.75 }}>
                              <code>{sess.id}</code> · {sess.source} · {sess.messageCount} 条消息
                            </span>
                          </div>
                          {sess.lastMessagePreview !== undefined && sess.lastMessagePreview !== '' && (
                          <div style={{ marginTop: 4, opacity: 0.82, fontSize: 11.5 }}>
                            最新消息：{sess.lastMessagePreview}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
        )}

        {activeTab === 'gateway' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  📡 飞书双租户常驻事件网关 & 83 岗位飞书机器人 ⇄ DSH 常驻 Session 双向实时桥
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      void callHermesBridgeApi({ op: 'gatewayStart', profile: 'life', dryRun: false }).then((r) => {
                        setBanner(r?.ok ? `✓ 已启动 --profile life 飞书实时监听 (PID: ${String(r.pid ?? 'running')})` : `启动失败: ${String(r?.error ?? '')}`)
                        void refreshAll()
                      })
                    }}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 6,
                      border: '1px solid #059669',
                      background: 'rgba(16,185,129,0.14)',
                      color: '#059669',
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ▶️ 启动 life 飞书长连接监听
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void callHermesBridgeApi({ op: 'gatewayStart', profile: 'company', dryRun: false }).then((r) => {
                        setBanner(r?.ok ? `✓ 已启动 --profile company 飞书实时监听 (PID: ${String(r.pid ?? 'running')})` : `启动失败: ${String(r?.error ?? '')}`)
                        void refreshAll()
                      })
                    }}
                    style={{
                      padding: '5px 11px',
                      borderRadius: 6,
                      border: '1px solid #ea580c',
                      background: 'rgba(234,88,12,0.14)',
                      color: '#ea580c',
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ▶️ 启动 company 飞书长连接监听
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 }}>
                双向实时机制：飞书入站消息通过各岗位专属机器人 (<code>company-binding.json</code> 的 <code>app_id</code>) 或双租户分流铁律直接注入该智能体在 DSH 的常驻 Session (<code>sessionController.prompt</code>)；DSH 完成推理触发 <code>turn/end</code> 时自动以该岗位飞书机器人身份 (<code>--as bot</code>) 回复到飞书对应会话，手机飞书与电脑 DSH 共享同一上下文。
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={simProfile}
                  onChange={(e) => { setSimProfile(e.target.value as 'life' | 'company') }}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 12.5,
                  }}
                >
                  <option value="life">--profile life (个人 / 伴学 / 万界 / 本机)</option>
                  <option value="company">--profile company (Optix 眼动追踪)</option>
                </select>
                <input
                  type="text"
                  value={simText}
                  onChange={(e) => { setSimText(e.target.value) }}
                  placeholder="输入模拟飞书消息或携带 #agentId 标签测试双向路由与 DSH Session 注入…"
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 12.5,
                  }}
                />
                <button
                  type="button"
                  onClick={() => { void handleSimulateGateway() }}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 7,
                    border: 'none',
                    background: '#059669',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  执行网关路由核验
                </button>
              </div>
            </div>

            {/* 🔗 83 岗位飞书机器人 ⇄ DSH 原生常驻 Session 双向绑定矩阵 */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  🔗 飞书独立机器人 ⇄ DSH 常驻 Session 双向绑定表 (已绑飞书Bot: {String(gatewayState?.botBindingsSummary?.boundBotCount ?? 78)} / {String(gatewayState?.botBindingsSummary?.totalAgents ?? 83)} · 已绑DSH会话: {String(gatewayState?.botBindingsSummary?.boundDshSessionCount ?? 0)})
                </div>
                <span style={{ fontSize: 11.5, color: '#059669', fontWeight: 600 }}>
                  {gatewayState?.botBindingsSummary?.hostBridgeActive ? '🟢 DSH Host SessionController 双向桥已激活' : '⚡ 点击任意 Agent 对话自动绑定'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
                {(gatewayState?.botBindingsSummary?.bindings ?? []).map((b: any) => (
                  <div
                    key={String(b.agentId)}
                    style={{
                      padding: '8px 11px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.24))',
                      background: 'var(--dsw-alias-bg-layer-2, rgba(148,163,184,0.04))',
                      fontSize: 11.5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: 4,
                            fontSize: 10,
                            background: b.feishuProfile === 'company' ? 'rgba(234,88,12,0.16)' : 'rgba(16,185,129,0.16)',
                            color: b.feishuProfile === 'company' ? '#ea580c' : '#059669',
                          }}
                        >
                          {String(b.feishuProfile)}
                        </span>
                        <span>{String(b.botName || b.title)}</span>
                        <code style={{ opacity: 0.72, fontSize: 10.5 }}>({String(b.agentId)})</code>
                      </div>
                      <div style={{ marginTop: 3, opacity: 0.8, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        飞书AppID: <code>{String(b.appId || 'tenant-shared')}</code> · DSH常驻会话: <code>{String(b.dshSessionId || '点右侧对话自动绑定')}</code>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
                      <button
                        type="button"
                        onClick={() => {
                          void callHermesBridgeApi({
                            op: 'feishuBindSession',
                            agentId: b.agentId,
                            createIfMissing: true,
                            autoSyncToFeishu: true,
                          }).then((res) => {
                            if (res?.ok) {
                              setBanner(`✓ 已将 ${String(b.botName)} (${String(b.agentId)}) 绑定至 DSH 常驻会话: ${String(res.binding?.dshSessionId ?? '已就绪')}`)
                              void refreshAll()
                            }
                          })
                        }}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 5,
                          border: '1px solid #059669',
                          background: 'rgba(16,185,129,0.12)',
                          color: '#059669',
                          fontSize: 10.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        🔗 绑定
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const ag = findAgentById(String(b.agentId))
                          if (ag) startAgentSession(ag)
                        }}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 5,
                          border: 'none',
                          background: '#0284c7',
                          color: '#fff',
                          fontSize: 10.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        💬 对话
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                最近飞书网关路由与跨租户拦截流水
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(gatewayState?.recentEvents ?? []).map((evt: any, idx: number) => (
                  <div
                    key={String(evt?.event?.eventId ?? idx)}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.22))',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontWeight: 700,
                          marginRight: 8,
                          background: evt?.event?.profile === 'company' ? 'rgba(234,88,12,0.16)' : 'rgba(16,185,129,0.16)',
                          color: evt?.event?.profile === 'company' ? '#ea580c' : '#059669',
                        }}
                      >
                        --profile {String(evt?.event?.profile ?? 'life')}
                      </span>
                      <strong>{String(evt?.target?.title ?? evt?.status ?? '')}</strong>
                      {evt?.target?.agentId && <span> (<code>{String(evt.target.agentId)}</code>)</span>}
                      <div style={{ marginTop: 4, opacity: 0.82 }}>
                        事件内容: {String(evt?.event?.text ?? '')} · 判定: {String(evt?.target?.routeReason ?? evt?.error ?? evt?.reason ?? '')}
                      </div>
                    </div>
                    {evt?.target && (
                      <button
                        type="button"
                        onClick={() => {
                          const found = treeData.roots
                            .flatMap(r => [r, ...r.children])
                            .flatMap(z => z.agents)
                            .find(a => a.id === evt.target.agentId)
                          if (found) startAgentSession(found, evt?.event?.text)
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid #0284c7',
                          background: 'transparent',
                          color: '#0284c7',
                          fontSize: 11.5,
                          cursor: 'pointer',
                          flex: 'none',
                        }}
                      >
                        在 DSH 打开会话
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'loop6' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                ♾️ 六步自我强化闭环流水线 (hermes_six_step_loop)
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12 }}>
                一键生成带 BEFORE / AFTER / DIFF 与 <code>&lt;img path="@..."/&gt;</code> 的飞书 DocxXML，绑定飞书任务产出物链接，并幂等写入 <code>C:/Users/Administrator/Documents/1_personal/life-events.jsonl</code> (<code>proc-career-value-raise</code>)。
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <input
                  type="text"
                  value={loopTitle}
                  onChange={(e) => { setLoopTitle(e.target.value) }}
                  placeholder="闭环交付标题"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 12,
                  }}
                />
                <input
                  type="text"
                  value={loopAnchor}
                  onChange={(e) => { setLoopAnchor(e.target.value) }}
                  placeholder="Step 1: 自我锚定与涨薪价值目标"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 7,
                    border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary)',
                    fontSize: 12,
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={loopAsset}
                    onChange={(e) => { setLoopAsset(e.target.value) }}
                    placeholder="Step 2: 内化工具资产"
                    style={{
                      flex: 1,
                      padding: '7px 10px',
                      borderRadius: 7,
                      border: '1px solid var(--dsw-alias-border-l3, rgba(148,163,184,0.35))',
                      background: 'transparent',
                      color: 'var(--dsw-alias-label-primary)',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => { void handleRunLoop6() }}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 7,
                      border: 'none',
                      background: '#0284c7',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    生成闭环回执
                  </button>
                </div>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                已入账的六步自我强化闭环回执 ({loopReceipts.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {loopReceipts.map((r: any) => (
                  <div
                    key={String(r.receiptId)}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l2, rgba(148,163,184,0.25))',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>回执 ID: <code>{String(r.receiptId)}</code> (飞书通道: <code>--profile {String(r.route?.effectiveProfile ?? 'life')}</code>)</span>
                      <span style={{ color: '#059669' }}>
                        ✓ 已同步 {String(r.steps?.step6SelfLedger?.record?.object ?? 'proc-career-value-raise')}
                      </span>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <strong>1. 起点（自我锚定）：</strong>{String(r.steps?.step1Anchor ?? '')}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      <strong>2. 工具内化（自我武装）：</strong>{String(r.steps?.step2ToolAsset ?? '')}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      <strong>3. 全局真闭环（自我把关）：</strong>{String(r.steps?.step3Verification ?? '')}
                    </div>
                    <div style={{ marginTop: 3, opacity: 0.8 }}>
                      <strong>4. DocxXML 产物：</strong><code>{String(r.steps?.step4DocxXmlPath ?? '')}</code> · <strong>6. 个人账本：</strong><code>{String(r.steps?.step6SelfLedger?.logPath ?? 'C:/Users/Administrator/Documents/1_personal/life-events.jsonl')}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
