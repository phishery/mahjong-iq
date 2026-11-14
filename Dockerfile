# Mahjong IQ game server (WebSocket rooms for online play).
# Build:  docker build -t mahjong-iq-server .
# Run:    docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://mahjong-iq.vercel.app mahjong-iq-server
# The private card is never baked into the image: pass CARD_JSON / CARD_PASSCODE at runtime.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY server ./server
COPY src/engine ./src/engine
COPY src/net ./src/net
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["npx", "tsx", "server/index.ts"]
