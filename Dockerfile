FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# SQLite may need to compile its native module on Alpine.
# Keep its C++ runtime, but remove the compiler after installation.
RUN apk add --no-cache libstdc++ \
    && apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps

# Copy all source files
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

# Start the server
CMD ["node", "server/index.js"]
