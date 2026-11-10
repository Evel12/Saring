#!/usr/bin/env bash
# Pasang backend + worker Saring di VPS Ubuntu 24.04 baru (jalankan sebagai root).
#   bash setup-vps.sh <domain-vercel>        contoh: bash setup-vps.sh saring.vercel.app
# Jalankan ulang kapan saja untuk update kode (git pull + migrasi + restart).
set -euo pipefail
WEB="${1:?Isi domain Vercel, contoh: saring.vercel.app}"
REPO="${REPO:-https://github.com/Evel12/Saring.git}"
APP=/opt/saring
IP=$(curl -4fsS https://api.ipify.org)
HOST="${IP//./-}.sslip.io"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq python3 python3-venv python3-pip git curl tesseract-ocr tesseract-ocr-ind caddy

# RAM 1 GB: tambah swap 2 GB biar OCR/pip nggak kehabisan memori.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id saring &>/dev/null || useradd --system --create-home --home-dir /home/saring saring
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
mkdir -p "$APP/storage"
python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q -r "$APP/backend/requirements.lock"

if [ ! -f /etc/saring.env ]; then
  cat > /etc/saring.env <<ENV
SESSION_SECRET=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')
COOKIE_SECURE=true
ALLOWED_ORIGINS=https://$WEB
PUBLIC_APP_URL=https://$WEB
DATABASE_URL=sqlite:///$APP/saring.db
STORAGE_ROOT=$APP/storage
OCR_LANG=eng+ind
ENV
  chmod 600 /etc/saring.env
fi
chown -R saring:saring "$APP"

run() { sudo -u saring bash -c "set -a; . /etc/saring.env; cd $APP; $1"; }
run ".venv/bin/python -m alembic upgrade head"
[ -f "$APP/.seeded" ] || { run ".venv/bin/python -m backend.seed" && touch "$APP/.seeded"; }

for svc in api worker; do
  if [ $svc = api ]; then CMD="$APP/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --proxy-headers"
  else CMD="$APP/.venv/bin/python -m backend.worker"; fi
  cat > /etc/systemd/system/saring-$svc.service <<UNIT
[Unit]
Description=Saring $svc
After=network.target
[Service]
User=saring
WorkingDirectory=$APP
EnvironmentFile=/etc/saring.env
ExecStart=$CMD
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
done

cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  reverse_proxy 127.0.0.1:8000
}
CADDY

systemctl daemon-reload
systemctl enable --now saring-api saring-worker
systemctl restart saring-api saring-worker caddy
sleep 3
echo
echo "Selesai. Isi env API_URL di Vercel dengan:  https://$HOST"
echo "Cek:  curl https://$HOST/api/health"
