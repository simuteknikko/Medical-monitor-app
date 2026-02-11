# Use a small Node LTS image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the app
COPY . .

# Cloud Run provides a PORT env variable at runtime
ENV PORT=8080
EXPOSE 8080

# Start the server. The server is located at root/server.js in this repo.
CMD ["node", "root/server.js"]
