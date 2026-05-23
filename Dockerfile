FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY data ./data
COPY services ./services
COPY public ./public
COPY ["CAPSTONE PROJECT REPORT.docx", "./CAPSTONE PROJECT REPORT.docx"]
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
