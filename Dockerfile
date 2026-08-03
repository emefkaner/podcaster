# Node + system-ffmpeg (Audio) + Chromium (Anchor-Push per Browser-Automation).
# Node 22: das AWS-SDK (für Cloudflare R2) verlangt ab Anfang 2027 mindestens Node 22.
FROM node:22-slim

# ffmpeg für Audio-Zusammenschnitt/-Optimierung.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (besseres Layer-Caching).
COPY package.json ./
RUN npm install --omit=dev

# Chromium für Playwright inkl. benötigter System-Bibliotheken installieren.
# (Nur nötig für den optionalen "direkt zu Anchor pushen"-Modus.)
RUN npx playwright install --with-deps chromium

COPY . .

ENV DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "src/server.js"]
