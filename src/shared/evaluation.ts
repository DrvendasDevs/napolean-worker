/**
 * Contrato obrigatório da resposta da IA (seção 28) + definição das 7 etapas,
 * pesos e cálculo determinístico (seção 29).
 */
import { z } from 'zod'

export interface StageDef {
  key: StageKey
  name: string
  weight: number
}

export type StageKey =
  | 'boas_vindas'
  | 'identificacao'
  | 'historia'
  | 'pilares'
  | 'objecoes'
  | 'impacto'
  | 'proposta'

/** As sete etapas na ordem oficial, com nomes e pesos (seção 5). */
export const STAGES: StageDef[] = [
  { key: 'boas_vindas', name: 'Boas-vindas e Posicionamento Inicial', weight: 1.0 },
  { key: 'identificacao', name: 'Identificação de Necessidades', weight: 2.0 },
  { key: 'historia', name: 'História da Solução', weight: 1.5 },
  { key: 'pilares', name: 'Pilares da Solução', weight: 2.0 },
  { key: 'objecoes', name: 'Objeções', weight: 1.5 },
  { key: 'impacto', name: 'Impacto e Transformação', weight: 2.0 },
  { key: 'proposta', name: 'Proposta e Próximo Passo', weight: 1.5 },
]

export const STAGE_KEYS = STAGES.map((s) => s.key) as [StageKey, ...StageKey[]]
export const STAGE_NAMES = STAGES.map((s) => s.name)
export const TOTAL_WEIGHT = STAGES.reduce((acc, s) => acc + s.weight, 0) // 11.5

/** Mapa key -> coluna de nota em `relatorios`. */
export const STAGE_TO_COLUMN: Record<StageKey, string> = {
  boas_vindas: 'nota_boas_vindas',
  identificacao: 'nota_identificacao',
  historia: 'nota_historia',
  pilares: 'nota_pilares',
  objecoes: 'nota_objecoes',
  impacto: 'nota_impacto',
  proposta: 'nota_proposta',
}

// ------------------------- Zod schema -------------------------

const evidenceSchema = z.object({
  quote: z.string(),
  timestamp: z.string().nullable().optional(),
  speaker: z.string().nullable().optional(),
})

const stageSchema = z.object({
  key: z.enum(STAGE_KEYS),
  name: z.string(),
  score: z.number().int().min(0).max(10),
  strengths: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  improvements: z.array(z.string()),
  absences: z.array(z.string()),
  rationale: z.string(),
})

export const evaluationSchema = z
  .object({
    client: z.object({
      name: z.string().nullable(),
      estimated_duration_minutes: z.number().nullable(),
    }),
    transcription_limitations: z.array(z.string()),
    stages: z.array(stageSchema),
    overall: z.object({
      strengths: z.array(z.string()),
      improvements: z.array(z.string()),
    }),
  })
  .superRefine((data, ctx) => {
    // exatamente sete etapas, sem duplicadas, sem ausentes, sem extras
    const keys = data.stages.map((s) => s.key)
    const unique = new Set(keys)
    if (data.stages.length !== 7) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Esperadas 7 etapas, recebidas ${data.stages.length}` })
    }
    if (unique.size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Etapas duplicadas na resposta' })
    }
    for (const req of STAGE_KEYS) {
      if (!unique.has(req)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Etapa ausente: ${req}` })
      }
    }
  })

export type Evaluation = z.infer<typeof evaluationSchema>

// ------------------------- JSON Schema (Structured Outputs) -------------------------

/** JSON Schema estrito para OpenAI Structured Outputs (response_format json_schema). */
export const evaluationJsonSchema = {
  name: 'napoleon_evaluation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['client', 'transcription_limitations', 'stages', 'overall'],
    properties: {
      client: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'estimated_duration_minutes'],
        properties: {
          name: { type: ['string', 'null'] },
          estimated_duration_minutes: { type: ['number', 'null'] },
        },
      },
      transcription_limitations: { type: 'array', items: { type: 'string' } },
      stages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'name', 'score', 'strengths', 'evidence', 'improvements', 'absences', 'rationale'],
          properties: {
            key: { type: 'string', enum: STAGE_KEYS },
            name: { type: 'string', enum: STAGE_NAMES },
            score: { type: 'integer', minimum: 0, maximum: 10 },
            strengths: { type: 'array', items: { type: 'string' } },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['quote', 'timestamp', 'speaker'],
                properties: {
                  quote: { type: 'string' },
                  timestamp: { type: ['string', 'null'] },
                  speaker: { type: ['string', 'null'] },
                },
              },
            },
            improvements: { type: 'array', items: { type: 'string' } },
            absences: { type: 'array', items: { type: 'string' } },
            rationale: { type: 'string' },
          },
        },
      },
      overall: {
        type: 'object',
        additionalProperties: false,
        required: ['strengths', 'improvements'],
        properties: {
          strengths: { type: 'array', items: { type: 'string' } },
          improvements: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

// ------------------------- Cálculo determinístico (seção 29) -------------------------

/** Arredonda para N casas decimais com segurança. */
function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round((value + Number.EPSILON) * f) / f
}

/**
 * Nota final = média ponderada das 7 notas pelos pesos / 11,5.
 * A IA fornece as notas; o backend é a fonte de verdade.
 */
export function computeFinalScore(scores: Record<StageKey, number>): number {
  let weighted = 0
  for (const s of STAGES) {
    const n = scores[s.key]
    if (typeof n !== 'number' || Number.isNaN(n)) {
      throw new Error(`Nota ausente para etapa ${s.key}`)
    }
    weighted += n * s.weight
  }
  return roundTo(weighted / TOTAL_WEIGHT, 2)
}

/** Extrai o mapa key->score de uma avaliação validada. */
export function scoresFromEvaluation(ev: Evaluation): Record<StageKey, number> {
  const map = {} as Record<StageKey, number>
  for (const stage of ev.stages) {
    map[stage.key] = stage.score
  }
  return map
}
