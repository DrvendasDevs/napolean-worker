import { describe, it, expect } from 'vitest'
import { normalizePhone, phoneVariants, phonesMatch, onlyDigits } from '../src/shared/telefone'

describe('normalizePhone', () => {
  it('remove símbolos e mantém dígitos', () => {
    expect(onlyDigits('+55 (31) 99999-9999')).toBe('5531999999999')
  })

  it('normaliza número BR com DDI', () => {
    expect(normalizePhone('+55 31 99999-9999')).toBe('5531999999999')
  })

  it('adiciona DDI 55 quando ausente (11 dígitos)', () => {
    expect(normalizePhone('31999999999')).toBe('5531999999999')
  })

  it('adiciona DDI 55 para fixo (10 dígitos)', () => {
    expect(normalizePhone('3133334444')).toBe('553133334444')
  })

  it('remove prefixo internacional 00', () => {
    expect(normalizePhone('005531999999999')).toBe('5531999999999')
  })

  it('retorna null para entrada vazia', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('phoneVariants / phonesMatch (nono dígito)', () => {
  it('gera variação com e sem o nono dígito', () => {
    const v = phoneVariants('5531999999999')
    expect(v).toContain('5531999999999')
    expect(v).toContain('553199999999')
  })

  it('casa números com e sem nono dígito', () => {
    expect(phonesMatch('5531999998888', '553199998888')).toBe(true)
    expect(phonesMatch('+55 31 99999-8888', '31 9999-8888')).toBe(true)
  })

  it('não casa números diferentes', () => {
    expect(phonesMatch('5531999998888', '5531988887777')).toBe(false)
  })
})
