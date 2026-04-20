FROM node:20-alpine

WORKDIR /app

# Install production deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "index.js"]
