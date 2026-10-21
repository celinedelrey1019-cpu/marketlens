# 盘镜 MarketLens — 容器镜像
# 零依赖运行，不需要 npm install。

FROM node:22-alpine

WORKDIR /app

# 运行时只需要 public/ 和 server.js；缓存目录挂出来可以保留行情缓存。
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    YF_MIN_GAP_MS=900

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
