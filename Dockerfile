# ---- 构建阶段：安装全部依赖并打包前端 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先拷贝包清单，利用 Docker 层缓存安装依赖
COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm install

# 拷贝源码并构建 React 产物（client/dist）
COPY . .
RUN npm run build

# 精简生产依赖
RUN npm prune --omit=dev

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3000
USER node

CMD ["node", "server/index.js"]
