import { describe, it, expect } from 'vitest'
import { DEFAULT_TEMPLATES, renderTemplate } from '../src/shared/templates'
import { backoffMs } from '../src/shared/stages'

describe('templates', () => {
  it('possui as quatro mensagens obrigatórias', () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual(
      ['file_received', 'text_received', 'unauthorized', 'unsupported_file'].sort(),
    )
  })

  it('substitui apenas variáveis permitidas', () => {
    const out = renderTemplate('Olá {{nome_usuario}} da {{nome_empresa}} — {{proibida}}', {
      nome_usuario: 'Ana',
      nome_empresa: 'ACME',
    })
    expect(out).toContain('Olá Ana da ACME')
    // variável não permitida permanece literal (não é substituída)
    expect(out).toContain('{{proibida}}')
  })
})

describe('backoff', () => {
  it('cresce exponencialmente com teto', () => {
    expect(backoffMs(1)).toBe(30_000)
    expect(backoffMs(2)).toBe(60_000)
    expect(backoffMs(3)).toBe(120_000)
    expect(backoffMs(100)).toBe(30 * 60_000)
  })
})
