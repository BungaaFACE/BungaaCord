# Frontend Dockerfile for BungaaCord
FROM node:18-alpine

WORKDIR /app

COPY frontend .

RUN npm install

CMD ["node", "server.js"]
