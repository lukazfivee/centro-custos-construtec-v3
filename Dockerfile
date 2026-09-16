FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production CONSTRUTEC_API_HOST=0.0.0.0 PORT=8080 HOST=0.0.0.0
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js db.js ./
COPY routes ./routes
COPY services ./services
COPY lib ./lib
COPY middleware ./middleware
COPY migrations ./migrations
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
