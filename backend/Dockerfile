FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p auth_info_baileys

EXPOSE 3000

CMD ["npm", "start"]
