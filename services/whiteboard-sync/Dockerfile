FROM node:22-slim

WORKDIR /srv
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

USER node
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
