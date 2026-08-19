/**
 * dsh-skin-switcher — browser half.
 *
 * A small floating skin switcher pill (top-right, below the title bar) that
 * talks to the host routes over plain fetch:
 *
 *   GET  /dsh-skin/state   -> installed skins + active one
 *   POST /dsh-skin/switch  -> pick a skin; the host rewrites the user patch
 *                             layers, the loader hot-applies them, and this
 *                             page reloads onto the new boot graph.
 *
 * Pure DOM, no React, no css modules, no injected services: the same
 * footprint as the skins themselves. Every owned node and listener is
 * released through the Cordis effect disposer.
 */
import type { Context } from '@deepseek-ai/cordis'

const OWNER = 'skin-switcher'
const STATE_URL = '/dsh-skin/state'
const SWITCH_URL = '/dsh-skin/switch'
const RELOAD_DELAY_MS = 400
const FETCH_RETRIES = 2
const FETCH_RETRY_DELAY_MS = 800

/** The 'none' pseudo target restores the original (skin-free) look. */
const ORIGINAL_OPTION = { id: 'none', name: '原皮', nameEn: 'Original', tagline: '关闭所有皮肤' } as const

interface SkinOption {
  id: string
  name: string
  nameEn: string
  tagline: string
}

interface StateResponse {
  skins: SkinOption[]
  current: string
}

/** App-aligned tokens with neutral fallbacks so the pill reads in either scheme. */
function css(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`
}

export function apply(ctx: Context): void {
  let root: HTMLDivElement | undefined

  ctx.effect(() => () => {
    root?.remove()
    root = undefined
  }, 'dsh-skin-switcher: pill cleanup')

  async function fetchState(attempt = 0): Promise<StateResponse | undefined> {
    try {
      const response = await fetch(STATE_URL, { cache: 'no-store' })
      if (!response.ok) return undefined
      return await response.json() as StateResponse
    } catch {
      if (attempt < FETCH_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS))
        return fetchState(attempt + 1)
      }
      return undefined
    }
  }

  async function switchTo(target: string): Promise<void> {
    try {
      const response = await fetch(SWITCH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      if (!response.ok) return
      // Give the patch watcher a beat to hot-recompose the boot graph, then
      // load the new manifest (and skin) in one reload.
      setTimeout(() => location.reload(), RELOAD_DELAY_MS)
    } catch {
      // Host half missing or mid-restart: the pill stays, next click retries.
    }
  }

  function buildMenu(state: StateResponse, onPick: (target: string) => void): HTMLDivElement {
    const menu = document.createElement('div')
    menu.dataset.skinChrome = 'switcher-menu'
    Object.assign(menu.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '6px',
      borderRadius: '10px',
      background: css('--dsw-alias-bg-layer-2', 'rgba(255,255,255,0.92)'),
      border: `1px solid ${css('--dsw-alias-border-l1', 'rgba(0,0,0,0.12)')}`,
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      backdropFilter: 'blur(8px)',
      minWidth: '148px',
    })

    const options: SkinOption[] = [ORIGINAL_OPTION, ...state.skins]
    for (const option of options) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.skinChrome = 'switcher-option'
      button.textContent = option.name
      button.title = option.nameEn.length > 0 && option.nameEn !== option.id
        ? `${option.nameEn}${option.tagline ? ` — ${option.tagline}` : ''}`
        : option.tagline
      button.setAttribute('aria-pressed', state.current === option.id ? 'true' : 'false')
      const active = state.current === option.id
      Object.assign(button.style, {
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '20px',
        padding: '2px 10px',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        color: active
          ? css('--dsw-alias-brand-primary', '#2b6de8')
          : css('--dsw-alias-label-primary', '#1f2328'),
        background: active ? 'rgba(43,109,232,0.12)' : 'transparent',
        fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap',
      })
      button.addEventListener('click', () => {
        if (active) return
        onPick(option.id)
      })
      menu.append(button)
    }
    return menu
  }

  void (async () => {
    const state = await fetchState()
    if (state === undefined) return // host half absent: no pill

    root = document.createElement('div')
    root.dataset.skinOwner = OWNER
    Object.assign(root.style, {
      position: 'fixed',
      top: '48px',
      right: '14px',
      zIndex: '9990',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '6px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    })

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.dataset.skinChrome = 'switcher-toggle'
    toggle.textContent = '换肤'
    toggle.title = '切换皮肤（原皮 / 女仆工坊 / 虎鲸链路）'
    Object.assign(toggle.style, {
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '24px',
      padding: '0 12px',
      borderRadius: '12px',
      border: `1px solid ${css('--dsw-alias-border-l1', 'rgba(0,0,0,0.12)')}`,
      cursor: 'pointer',
      color: css('--dsw-alias-label-primary', '#1f2328'),
      background: css('--dsw-alias-bg-layer-2', 'rgba(255,255,255,0.92)'),
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      backdropFilter: 'blur(8px)',
    })

    let open = false
    let menu: HTMLDivElement | undefined
    const close = (): void => {
      menu?.remove()
      menu = undefined
      open = false
    }
    toggle.addEventListener('click', () => {
      if (open) {
        close()
        return
      }
      menu = buildMenu(state, (target) => {
        toggle.disabled = true
        toggle.textContent = '切换中…'
        close()
        void switchTo(target)
      })
      root!.append(menu)
      open = true
    })

    root.append(toggle)
    document.body.append(root)
  })()
}
