FROM node:22-slim

WORKDIR /srv
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

# Nội dung bảng lưu ở /srv/data (gắn volume trong docker-compose để không mất khi dựng lại)
RUN mkdir -p /srv/data && chown node:node /srv/data
USER node
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
