/**
 * dsh-skin-switcher — host half.
 *
 * Registers two web routes on the dsh web server:
 *
 *   GET  /dsh-skin/state   -> installed skins (from the profile's linked
 *                             skin bundles and their skin.json) plus the
 *                             currently active skin id.
 *   POST /dsh-skin/switch  -> body `{ "target": <skinId|'none'> }`; rewrites
 *                             BOTH user patch layers (profile + home) so the
 *                             loader's patch watcher hot-applies the choice.
 *                             No restart, no service/event/model-touch.
 *
 * Presentation-adjacent only: it edits the same config rows a human would
 * edit by hand, and changes nothing else about the harness.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { applySkinChoice, resolveCurrent } from './patch-writer.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-skin-switcher'

/** The web routes need the HTTP carrier. */
export const inject = ['webServer']

/** Profile whose patch layers the switcher drives (the shipped web GUI). */
const PROFILE_NAME = 'web'

/** Only these bundles are skins; the switcher itself is excluded by skin.json presence. */
const SKIN_PACKAGE_PREFIX = '@dsh-external/dsh-client-ui-skin-'

/** Wire shape served by GET /dsh-skin/state. */
export interface SkinInfo {
  id: string
  name: string
  nameEn: string
  tagline: string
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function profileDir(): string {
  return join(dshHome(), 'profiles', PROFILE_NAME)
}

function profilePatchPath(): string {
  return join(profileDir(), 'cordis.patch.yml')
}

function homePatchPath(): string {
  return join(dshHome(), 'cordis.patch.yml')
}

/** Both user layers, profile first (home overrides it in the loader). */
function patchLayerPaths(): string[] {
  return [profilePatchPath(), homePatchPath()]
}

function readFileSafe(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Profile bundle list, in composition order. */
function readProfileBundles(): string[] {
  const content = readFileSafe(join(profileDir(), 'package.json'))
  if (content === undefined) return []
  try {
    const pkg = JSON.parse(content) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = pkg.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/** Discover installed skins by their skin.json inside the linked bundles. */
function discoverSkins(): SkinInfo[] {
  const skins: SkinInfo[] = []
  for (const bundle of readProfileBundles()) {
    if (!bundle.startsWith(SKIN_PACKAGE_PREFIX)) continue
    const skinJsonPath = join(profileDir(), 'node_modules', bundle, 'skin.json')
    if (!existsSync(skinJsonPath)) continue // the switcher has no skin.json
    try {
      const raw = JSON.parse(readFileSync(skinJsonPath, 'utf8')) as {
        id?: unknown
        name?: unknown
        nameEn?: unknown
        tagline?: unknown
      }
      if (typeof raw.id !== 'string' || raw.id.length === 0) continue
      skins.push({
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : raw.id,
        nameEn: typeof raw.nameEn === 'string' ? raw.nameEn : raw.id,
        tagline: typeof raw.tagline === 'string' ? raw.tagline : '',
      })
    } catch {
      // Malformed skin.json: skip the bundle, never crash the routes.
    }
  }
  return skins
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer | string) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Apply the chosen skin to both user patch layers. Missing layers are
 * created (the home layer is optional); existing content is preserved.
 * @returns the new active skin id on success.
 */
function applyChoice(skins: SkinInfo[], target: string): string {
  const ids = skins.map(skin => skin.id)
  for (const path of patchLayerPaths()) {
    const next = applySkinChoice(readFileSafe(path) ?? '', ids, target)
    writeFileSync(path, next, 'utf8')
  }
  return target
}

/** Host plugin body. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-skin/state',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      const skins = discoverSkins()
      const profile = readFileSafe(profilePatchPath()) ?? ''
      const home = readFileSafe(homePatchPath()) ?? ''
      json(res, 200, {
        skins: skins.map(({ id, name, nameEn, tagline }) => ({ id, name, nameEn, tagline })),
        current: resolveCurrent(skins.map(skin => skin.id), profile, home),
      })
    },
  }), 'dsh-skin-switcher: state route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-skin/switch',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let payload: { target?: unknown }
      try {
        payload = JSON.parse(await readBody(req)) as { target?: unknown }
      } catch {
        json(res, 400, { ok: false, error: 'invalid JSON body' })
        return
      }
      const target = payload.target
      const skins = discoverSkins()
      const known = skins.some(skin => skin.id === target) || target === 'none'
      if (typeof target !== 'string' || !known) {
        json(res, 400, { ok: false, error: `unknown skin target: ${String(target)}` })
        return
      }
      try {
        applyChoice(skins, target)
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        json(res, 500, { ok: false, error: 'failed to write patch layers' })
        return
      }
      json(res, 200, { ok: true, current: target })
    },
  }), 'dsh-skin-switcher: switch route')
}
