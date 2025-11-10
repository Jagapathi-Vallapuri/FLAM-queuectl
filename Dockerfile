FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    QUEUECTL_HOME=/data

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm prune --omit=dev

VOLUME ["/data"]

ENTRYPOINT ["node","bin/queuectl.js"]
CMD ["--help"]
