FROM node:18-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

RUN mkdir -p auth_info_baileys

EXPOSE 3000

CMD ["node", "src/index.js"]
