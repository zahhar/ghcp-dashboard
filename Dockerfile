FROM node:20-alpine

WORKDIR /app

COPY server.js ./
COPY public ./public
COPY data/data.json ./data/data.json
COPY data/config.json ./data/config.json
COPY data/users.json ./data/users.json

EXPOSE 8080

CMD ["node", "server.js"]
