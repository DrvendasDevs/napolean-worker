# =====================================================
# Worker Napoleon — Node 20 + FFmpeg + Poppler + Tesseract
# =====================================================
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# =====================================================
FROM node:20-bookworm-slim AS runtime

# Ferramentas de sistema usadas pelo pipeline:
# - ffmpeg/ffprobe: áudio (normalização, chunks)
# - poppler-utils: pdftotext/pdftoppm/pdfinfo (extração e rasterização de PDF)
# - tesseract-ocr (+ por/eng): OCR de PDFs digitalizados
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-por \
      tesseract-ocr-eng \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
ENV WORKER_TMP_DIR=/tmp/napoleon

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

# Cria diretório temporário
RUN mkdir -p /tmp/napoleon

CMD ["node", "dist/index.js"]
