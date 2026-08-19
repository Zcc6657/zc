import { describe, expect, it } from 'vitest'
import { applySkinChoice, parsePatchRows, resolveCurrent, skinRowId } from '../src/patch-writer.ts'

const SKINS = ['maid-atelier', 'orca-link']

const PROFILE_HEADER = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
#
# Skin hot-switch (no restart needed):
#   maid-atelier ON : ui-skin-maid-atelier disabled:false, ui-skin-orca-link disabled:true
#   orca-link    ON : ui-skin-maid-atelier disabled:true,  ui-skin-orca-link disabled:false
#   original skin   : both disabled:true
- id: ui-skin-maid-atelier
  disabled: false
- id: ui-skin-orca-link
  disabled: true
`

describe('applySkinChoice', () => {
  it('flips an existing row to another skin', () => {
    const next = applySkinChoice(PROFILE_HEADER, SKINS, 'orca-link')
    expect(next).toContain('- id: ui-skin-maid-atelier\n  disabled: true')
    expect(next).toContain('- id: ui-skin-orca-link\n  disabled: false')
  })

  it('keeps the same skin active when re-picking it', () => {
    const next = applySkinChoice(PROFILE_HEADER, SKINS, 'maid-atelier')
    expect(next).toContain('- id: ui-skin-maid-atelier\n  disabled: false')
    expect(next).toContain('- id: ui-skin-orca-link\n  disabled: true')
  })

  it('disables every skin for the original look', () => {
    const next = applySkinChoice(PROFILE_HEADER, SKINS, 'none')
    expect(next).toContain('- id: ui-skin-maid-atelier\n  disabled: true')
    expect(next).toContain('- id: ui-skin-orca-link\n  disabled: true')
  })

  it('preserves the header comments verbatim', () => {
    const next = applySkinChoice(PROFILE_HEADER, SKINS, 'none')
    expect(next.startsWith(PROFILE_HEADER.slice(0, PROFILE_HEADER.indexOf('- id:')))).toBe(true)
  })

  it('appends a row for a skin missing from the file', () => {
    const sparse = `${PROFILE_HEADER.slice(0, PROFILE_HEADER.indexOf('- id: ui-skin-orca'))}`
    const next = applySkinChoice(sparse, SKINS, 'orca-link')
    expect(next).toContain('- id: ui-skin-maid-atelier\n  disabled: true')
    expect(next).toContain('- id: ui-skin-orca-link\n  disabled: false')
  })

  it('creates rows from an empty file (home layer bootstrap)', () => {
    const next = applySkinChoice('', SKINS, 'maid-atelier')
    expect(next).toBe('- id: ui-skin-maid-atelier\n  disabled: false\n\n- id: ui-skin-orca-link\n  disabled: true')
  })

  it('leaves unrelated rows untouched', () => {
    const withForeign = `${PROFILE_HEADER}\n- id: some-other-plugin\n  disabled: false\n`
    const next = applySkinChoice(withForeign, SKINS, 'orca-link')
    expect(next).toContain('- id: some-other-plugin\n  disabled: false')
  })

  it('tolerates CRLF input', () => {
    const crlf = PROFILE_HEADER.replace(/\n/g, '\r\n')
    const next = applySkinChoice(crlf, SKINS, 'orca-link')
    expect(next.replace(/\r/g, '')).toContain('- id: ui-skin-orca-link\n  disabled: false')
    expect(next.replace(/\r/g, '')).toContain('- id: ui-skin-maid-atelier\n  disabled: true')
  })
})

describe('parsePatchRows / resolveCurrent', () => {
  it('parses row ids and disabled flags', () => {
    const rows = parsePatchRows(PROFILE_HEADER)
    expect(rows.get(skinRowId('maid-atelier'))).toBe(false)
    expect(rows.get(skinRowId('orca-link'))).toBe(true)
  })

  it('home layer overrides the profile layer', () => {
    const profile = applySkinChoice(PROFILE_HEADER, SKINS, 'none')
    const home = applySkinChoice(PROFILE_HEADER, SKINS, 'maid-atelier')
    expect(resolveCurrent(SKINS, profile, home)).toBe('maid-atelier')
  })

  it('a skin with no row anywhere is enabled by default', () => {
    const profile = applySkinChoice(PROFILE_HEADER, SKINS, 'none')
    const home = applySkinChoice(PROFILE_HEADER, SKINS, 'none')
    expect(resolveCurrent(SKINS, profile, home)).toBe('none')
    expect(resolveCurrent(SKINS, '', '')).toBe('maid-atelier') // both absent -> first skin enabled
  })
})
