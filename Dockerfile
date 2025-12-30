FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# App listens on:
EXPOSE 3007

# Run the server
CMD ["node", "server.js"]
