# Complete Hosting & Deployment Guide

This application consists of a **FastAPI backend** that serves the **React full-screen frontend**, WebSocket real-time streams (`/ws/live`), and REST APIs.

> [!IMPORTANT]
> **Mobile Camera Requirement**: Mobile browsers (iOS Safari and Android Chrome) strictly require **HTTPS (SSL)** to allow camera access (`getUserMedia`). All the cloud hosting options below provide free automatic HTTPS certificates out of the box.

---

## Option 1: Free Cloud Hosting (Recommended: Render / Railway / Fly.io)

### A. Deploying to Render (Free & Simplest)
1. Push your code to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
2. Go to [render.com](https://render.com) and log in.
3. Click **New +** → **Web Service**.
4. Connect your GitHub repository.
5. Configure:
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
6. Click **Deploy Web Service**.
7. Render gives you an instant public HTTPS URL (e.g. `https://your-app.onrender.com`), and phone camera permissions will work immediately on any device without warnings.

---

### B. Deploying to Railway
1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your repository. Railway will automatically detect the Python environment and `requirements.txt`.
4. In project settings, click **Generate Domain**. You will get a free `https://xxxx.up.railway.app` URL.

---

## Option 2: Deploy on a Linux VPS / Cloud VM (Ubuntu / AWS EC2 / DigitalOcean)

### Step 1: Clone and Set Up on Server
```bash
# Update server & install dependencies
sudo apt update && sudo apt install -y python3-pip python3-venv git nginx certbot python3-certbot-nginx

# Clone repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /var/www/qr-scanner
cd /var/www/qr-scanner

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Step 2: Set Up Systemd Background Service
Create `/etc/systemd/system/qr-scanner.service`:
```ini
[Unit]
Description=QR Scanner FastAPI Service
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/qr-scanner
ExecStart=/var/www/qr-scanner/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now qr-scanner
```

### Step 3: Configure Nginx Reverse Proxy with HTTPS
Create `/etc/nginx/sites-available/qr-scanner`:
```nginx
server {
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and get free SSL certificate:
```bash
sudo ln -s /etc/nginx/sites-available/qr-scanner /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

---

## Option 3: Docker Deployment

### Run with Docker Compose:
```bash
docker compose up -d --build
```
The app will be running at `http://localhost:8000`.

---

## Option 4: Instant Public Access via Cloudflare Tunnel or Ngrok (For Quick Testing)

If you want to test from your local computer with an instant public HTTPS URL on your phone without deploying:

### Using Cloudflare Tunnel (Free & No Account Required):
```bash
# If using brew:
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel --url http://localhost:8000
```
Cloudflare will give you a temporary public HTTPS link (e.g. `https://xxxx.trycloudflare.com`). Open that on your phone for immediate camera scanning.

### Using Ngrok:
```bash
ngrok http 8000
```
Open the generated `https://xxxx.ngrok-free.app` URL on your phone.
