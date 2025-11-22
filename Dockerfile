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

# Create a non-root user for security
RUN useradd -m -u 1000 appuser

# Change ownership of all files to appuser before switching users
RUN chown -R appuser:appuser /app

USER appuser

# Expose any ports if needed (currently not required for this app)
# EXPOSE 3000

# Default command - expects .env file to be mounted or environment variables to be passed
CMD ["node", "--env-file=.env", "lib/ring-to-open.js"]

