FROM node:18-alpine

WORKDIR /app

# Dependências necessárias para compilar módulos nativos do Baileys
RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN mkdir -p auth_info_baileys

EXPOSE 3000

CMD ["node", "src/index.js"]
