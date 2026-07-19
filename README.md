# Napoleon Worker

Worker assíncrono (Node 20 + TypeScript) que executa o pipeline de avaliação
comercial: transcrição de áudio (chunked), extração de PDF, OCR, RAG, avaliação
por IA (Structured Outputs), cálculo determinístico da nota, geração de PDFs e
entrega via WhatsApp (Z-API). Substitui completamente o n8n.

## Requisitos de sistema (já incluídos no Dockerfile)

- `ffmpeg` / `ffprobe` — normalização e divisão de áudio
- `poppler-utils` — `pdftotext`, `pdftoppm`, `pdfinfo`
- `tesseract-ocr` (+ `por`, `eng`) — OCR de PDFs digitalizados

## Como funciona

1. Faz *polling* na fila `processing_jobs` via `claim_next_job` (lock transacional `FOR UPDATE SKIP LOCKED`).
2. Cada job de `pipeline` avança por estágios idempotentes/retomáveis:
   `downloading → preparing_file → transcribing/extracting_text/performing_ocr →
   preparing_context → evaluating → validating_result → calculating_score →
   generating_transcription_pdf → generating_report_pdf → creating_deliveries →
   sending_whatsapp → completed/partial_delivery`.
3. Jobs `index_document` extraem texto e geram embeddings (pgvector) para o RAG.
4. Falhas reagendam com backoff exponencial; estágios concluídos não são refeitos.

## Rodando localmente

```bash
cp .env.example .env   # preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev            # tsx watch
```

## Scripts

- `npm run dev` — execução com hot-reload
- `npm run build` — compila para `dist/`
- `npm start` — executa `dist/index.js`
- `npm run typecheck` — checagem de tipos
- `npm test` — testes unitários (Vitest)

## Docker

```bash
docker build -t napoleon-worker .
docker run --env-file .env napoleon-worker
```

Veja `DEPLOY.md` na raiz para deploy em Railway/Render/Fly.io.
