FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Cloud Run serves from the domain root, unlike GitHub Pages.
ENV VITE_BASE=/
RUN npm run build


FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only the built assets and the server are needed at runtime, so no
# node_modules is copied across.
COPY --from=build /app/dist ./dist
COPY server.js ./

USER node
EXPOSE 8080
CMD ["node", "server.js"]
