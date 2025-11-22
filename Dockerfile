# Use Node.js LTS as base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy TypeScript configuration
COPY tsconfig.json ./

# Copy source files
COPY *.ts ./

# Compile TypeScript to JavaScript
RUN npx tsc

# Note: Running as root user for simplicity
# The container is isolated in the deployment environment

# Expose any ports if needed (currently not required for this app)
# EXPOSE 3000

# Default command - environment variables are passed directly by the container runtime
# The application uses dotenv.config() which will use environment variables if .env file doesn't exist
CMD ["node", "lib/ring-to-open.js"]

