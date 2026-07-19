import { describe, it, expect } from 'vitest'
import {
  STAGES,
  STAGE_KEYS,
  TOTAL_WEIGHT,
  computeFinalScore,
  evaluationSchema,
  scoresFromEvaluation,
  type Evaluation,
} from '../src/shared/evaluation'

function makeEvaluation(scores: number[]): Evaluation {
  return {
    client: { name: 'ACME', estimated_duration_minutes: 42 },
    transcription_limitations: [],
    stages: STAGES.map((s, i) => ({
      key: s.key,
      name: s.name,
      score: scores[i]!,
      strengths: ['ok'],
      evidence: [{ quote: 'trecho', timestamp: '00:01:00', speaker: 'Vendedor' }],
      improvements: ['melhorar'],
      absences: [],
      rationale: 'justificativa',
    })),
    overall: { strengths: ['forte'], improvements: ['melhoria'] },
  }
}

describe('pesos e soma', () => {
  it('soma dos pesos é 11,5', () => {
    expect(TOTAL_WEIGHT).toBeCloseTo(11.5, 5)
  })
})

describe('computeFinalScore (média ponderada)', () => {
  it('todas as notas 10 => 10.00', () => {
    const scores = Object.fromEntries(STAGE_KEYS.map((k) => [k, 10])) as Record<string, number>
    expect(computeFinalScore(scores as never)).toBe(10)
  })

  it('cálculo ponderado específico', () => {
    // boas_vindas=8(1.0), identificacao=6(2.0), historia=7(1.5), pilares=9(2.0),
    // objecoes=5(1.5), impacto=8(2.0), proposta=7(1.5)
    // = 8 + 12 + 10.5 + 18 + 7.5 + 16 + 10.5 = 82.5 / 11.5 = 7.173913 -> 7.17
    const ev = makeEvaluation([8, 6, 7, 9, 5, 8, 7])
    const score = computeFinalScore(scoresFromEvaluation(ev))
    expect(score).toBe(7.17)
  })

  it('não usa média simples', () => {
    const ev = makeEvaluation([10, 0, 0, 0, 0, 0, 0])
    // média simples seria 1.43; ponderada: 10*1 / 11.5 = 0.8695 -> 0.87
    expect(computeFinalScore(scoresFromEvaluation(ev))).toBe(0.87)
  })
})

describe('evaluationSchema (contrato obrigatório)', () => {
  it('aceita 7 etapas válidas', () => {
    const ev = makeEvaluation([8, 6, 7, 9, 5, 8, 7])
    expect(evaluationSchema.safeParse(ev).success).toBe(true)
  })

  it('rejeita menos de 7 etapas', () => {
    const ev = makeEvaluation([8, 6, 7, 9, 5, 8, 7])
    ev.stages = ev.stages.slice(0, 6)
    expect(evaluationSchema.safeParse(ev).success).toBe(false)
  })

  it('rejeita nota decimal', () => {
    const ev = makeEvaluation([8, 6, 7, 9, 5, 8, 7]) as unknown as { stages: { score: number }[] }
    ev.stages[0]!.score = 8.5
    expect(evaluationSchema.safeParse(ev).success).toBe(false)
  })

  it('rejeita nota fora de 0..10', () => {
    const ev = makeEvaluation([8, 6, 7, 9, 5, 8, 7]) as unknown as { stages: { score: number }[] }
    ev.stages[0]!.score = 11
    expect(evaluationSchema.safeParse(ev).success).toBe(false)
  })

  it('rejeita etapa duplicada', () => {
    const ev = makeEvaluation([8, 6, 7, 9, 5, 8, 7])
    ev.stages[1]!.key = ev.stages[0]!.key
    expect(evaluationSchema.safeParse(ev).success).toBe(false)
  })

  it('permite nota zero com evidências vazias (etapa inexistente)', () => {
    const ev = makeEvaluation([0, 6, 7, 9, 5, 8, 7])
    ev.stages[0]!.evidence = []
    ev.stages[0]!.strengths = []
    expect(evaluationSchema.safeParse(ev).success).toBe(true)
  })
})
