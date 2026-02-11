# Dockerfile for simuteknikko/Medical-monitor-app (server files are in the 'root' folder)
FROM node:16-alpine

WORKDIR /app

# Copy only package files from the repo root/root folder to install dependencies
COPY root/package*.json ./
RUN npm ci --only=production

# Copy the app files from the repo root/root into the container working dir
COPY root/ ./

# Cloud Run provides PORT at runtime; set a default inside the container
ENV PORT=8080
EXPOSE 8080

# Start the app (package.json start is "node server.js" and server.js is in copied root/)
CMD ["node", "server.js"]
