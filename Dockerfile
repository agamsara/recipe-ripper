FROM node:20-bullseye

# Install system deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# Copy package files and install Node deps
COPY package.json package-lock.json ./
RUN npm ci

# Copy Python deps and install them
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .

# Build Next.js app
RUN npm run build

# Expose port
EXPOSE 3000

# Start Next in production
ENV PORT=3000
CMD ["npm", "start"]
