/**
 * Normalização de telefone — fonte de verdade para identificar remetente,
 * localizar workspace/vendedor/gestor e enviar avaliações.
 *
 * Formato canônico: DDI + DDD + número, apenas dígitos. Ex.: 5531999999999.
 * Considera números brasileiros e variações do nono dígito.
 */

const BR_DDI = '55'

/** Remove tudo que não for dígito. */
export function onlyDigits(input: string | null | undefined): string {
  return (input ?? '').replace(/\D+/g, '')
}

/**
 * Normaliza para o formato canônico (DDI+DDD+número).
 * Regras:
 *  - remove +, espaços, parênteses, hífens e não numéricos;
 *  - remove zeros à esquerda de operadora/DDD;
 *  - se vier sem DDI (10/11 dígitos), assume Brasil (55);
 *  - mantém DDI existente quando presente.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  let digits = onlyDigits(raw)
  if (!digits) return null

  // Remove prefixo internacional "00"
  if (digits.startsWith('00')) digits = digits.slice(2)

  // Já tem DDI Brasil
  if (digits.startsWith(BR_DDI) && (digits.length === 12 || digits.length === 13)) {
    return digits
  }

  // Remove zero de operadora à esquerda (ex.: 0 31 9...)
  if (digits.length > 11 && digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '')
  }

  // Número nacional sem DDI: DDD (2) + número (8 ou 9)
  if (digits.length === 10 || digits.length === 11) {
    return BR_DDI + digits
  }

  // Já possui DDI + DDD + número válidos (13) ou fixo (12)
  if (digits.length === 12 || digits.length === 13) {
    // Se não começa com 55 mas tem tamanho de BR, ainda assim prefixa? Não:
    // assume que já contém algum DDI. Retorna como está.
    return digits
  }

  // Fallback: se tiver DDI Brasil em qualquer forma
  if (digits.startsWith(BR_DDI)) return digits

  return digits.length >= 10 ? digits : null
}

/**
 * Gera variações canônicas para busca tolerante ao nono dígito.
 * Ex.: 5531999999999 <-> 553199999999 (com/sem o 9 após o DDD).
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const canonical = normalizePhone(raw)
  if (!canonical) return []
  const variants = new Set<string>([canonical])

  // Apenas para números BR (55 + DDD + assinante)
  if (canonical.startsWith(BR_DDI)) {
    const rest = canonical.slice(2) // DDD + número
    const ddd = rest.slice(0, 2)
    const subscriber = rest.slice(2)

    if (subscriber.length === 9 && subscriber.startsWith('9')) {
      // remove o nono dígito
      variants.add(BR_DDI + ddd + subscriber.slice(1))
    } else if (subscriber.length === 8) {
      // adiciona o nono dígito
      variants.add(BR_DDI + ddd + '9' + subscriber)
    }
  }
  return Array.from(variants)
}

/** Compara dois telefones considerando as variações do nono dígito. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = new Set(phoneVariants(a))
  return phoneVariants(b).some((v) => va.has(v))
}
