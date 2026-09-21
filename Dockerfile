# Production Dockerfile for Smart QR Scanner & Receiver
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend and frontend source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create data directory for JSON persistence
RUN mkdir -p backend/data

# Expose default HTTP port
EXPOSE 8000

# Run uvicorn server in production mode
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
