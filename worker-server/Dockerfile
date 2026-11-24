FROM node:22-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV POCKETMIND_DATA_FILE=/app/data/pocketmind-state.json

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js integration-hub.js direct-providers.js state-storage.js drive-content.js ./

RUN addgroup -S pocketmind && adduser -S pocketmind -G pocketmind \
    && mkdir -p /app/data \
    && chown -R pocketmind:pocketmind /app

USER pocketmind
VOLUME ["/app/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
