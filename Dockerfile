FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production
COPY . .
RUN mkdir -p uploads/uploads/thumbs
EXPOSE 3000
CMD ["node", "index.js"]
