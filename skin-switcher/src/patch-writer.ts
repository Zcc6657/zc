/**
 * Pure patch-layer helpers for the dsh skin switcher.
 *
 * The user patch layers (`$DSH_HOME/cordis.patch.yml` and
 * `$DSH_HOME/profiles/<name>/cordis.patch.yml`) are YAML lists of loader
 * patch entries. Each installed skin owns one row shaped like
 *
 *   - id: ui-skin-<skinId>
 *     disabled: true|false
 *
 * A skin with NO row anywhere is ENABLED by the loader by default, so
 * "only one skin active" requires an explicit `disabled: true` row for every
 * inactive skin, in both layers (the home layer overrides the profile layer).
 * These helpers edit the rows in place and preserve every other byte
 * (comments, unknown rows, formatting) so switching never disturbs
 * unrelated configuration.
 */

/** One `- id:` row opener (also matches rows that are not skins). */
const ROW_ID_RE = /^\s*-\s*id:\s*(.+?)\s*$/

/** A `disabled:` field inside a row. */
const DISABLED_RE = /^(\s*)disabled:\s*(true|false)\s*$/

/** Skin row ids live under `ui-skin-`; the switcher itself never matches. */
export function skinRowId(skinId: string): string {
  return `ui-skin-${skinId}`
}

/** Parse a patch layer into `{ rowId -> disabled }`. Later rows with the same id win. */
export function parsePatchRows(content: string): Map<string, boolean> {
  const rows = new Map<string, boolean>()
  let currentId: string | undefined
  for (const line of content.split(/\r?\n/)) {
    const idMatch = ROW_ID_RE.exec(line)
    if (idMatch !== null) {
      currentId = idMatch[1].trim()
      continue
    }
    const disabledMatch = DISABLED_RE.exec(line)
    if (disabledMatch !== null && currentId !== undefined) {
      rows.set(currentId, disabledMatch[2] === 'true')
    }
  }
  return rows
}

/**
 * Resolve the active skin id from both layers (home overrides profile).
 * A skin with no row is enabled by default; when several are enabled the
 * first one wins (the switcher UI offers an explicit choice anyway).
 * @param skinIds - installed skin ids in profile bundle order.
 * @param profileContent - profile patch layer, or '' when absent.
 * @param homeContent - home patch layer, or '' when absent.
 * @returns the active skin id, or 'none' when no skin is enabled.
 */
export function resolveCurrent(skinIds: string[], profileContent: string, homeContent: string): string {
  const profileRows = parsePatchRows(profileContent)
  const homeRows = parsePatchRows(homeContent)
  const enabled = skinIds.filter((skinId) => {
    const disabled = homeRows.get(skinRowId(skinId)) ?? profileRows.get(skinRowId(skinId)) ?? false
    return !disabled
  })
  return enabled[0] ?? 'none'
}

/**
 * Rewrite one patch layer so the given choice is active:
 *   target 'none'    -> every installed skin gets `disabled: true`
 *   target <skinId>  -> that skin gets `disabled: false`, every other skin `true`
 * Existing skin rows are updated in place (their `disabled:` line, or an
 * inserted one right after the `- id:` line); skins missing from the file
 * get a new row appended. Comments and unrelated rows are preserved
 * verbatim. Returns the full next content of the file.
 */
export function applySkinChoice(content: string, skinIds: string[], target: string): string {
  const lines = content === '' ? [] : content.split('\n')
  const out = [...lines]

  // Block boundaries: each `- id:` line opens a block that runs to the next
  // one (or EOF). Comment lines before the first block are file header.
  const blockStarts: number[] = []
  for (let i = 0; i < out.length; i++) {
    if (ROW_ID_RE.test(out[i])) blockStarts.push(i)
  }
  const blocks = blockStarts.map((start, index) => ({
    start,
    end: index + 1 < blockStarts.length ? blockStarts[index + 1] : out.length,
    id: ROW_ID_RE.exec(out[start])![1].trim(),
  }))

  const seen = new Set<string>()
  for (const block of blocks) {
    const rowId = block.id
    const skinId = skinIds.find(candidate => skinRowId(candidate) === rowId)
    if (skinId === undefined) continue
    seen.add(skinId)
    const wantDisabled = target === 'none' || target !== skinId
    let patched = false
    for (let i = block.start + 1; i < block.end; i++) {
      const match = DISABLED_RE.exec(out[i])
      if (match === null) continue
      out[i] = `${match[1]}disabled: ${wantDisabled}`
      patched = true
      break
    }
    if (!patched) out.splice(block.start + 1, 0, `  disabled: ${wantDisabled}`)
  }

  for (const skinId of skinIds) {
    if (seen.has(skinId)) continue
    if (out.length > 0 && out[out.length - 1] !== '') out.push('')
    out.push(
      `- id: ${skinRowId(skinId)}`,
      `  disabled: ${target === 'none' || target !== skinId}`,
    )
  }
  return out.join('\n')
}
