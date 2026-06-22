@echo off
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f "C:\Users\Ryan B\Desktop\FlashFeed-complete\docker-compose.yml" ps --all
echo ---
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" ps -a --filter "name=feedflash" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ---
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f "C:\Users\Ryan B\Desktop\FlashFeed-complete\docker-compose.yml" logs --tail 50 backend
echo ---
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/health' -UseBasicParsing -TimeoutSec 5; Write-Host 'HEALTH:' $r.StatusCode } catch { Write-Host 'HEALTH:FAILED' }"
