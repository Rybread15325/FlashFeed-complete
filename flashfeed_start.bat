@echo off
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f "C:\Users\Ryan B\Desktop\FlashFeed-complete\docker-compose.yml" up -d --build
echo EXITCODE=%ERRORLEVEL%
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f "C:\Users\Ryan B\Desktop\FlashFeed-complete\docker-compose.yml" ps --all
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" ps -a --filter "name=feedflash" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f "C:\Users\Ryan B\Desktop\FlashFeed-complete\docker-compose.yml" logs --tail 20 backend
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/health' -UseBasicParsing; Write-Host 'HEALTH:' $r.StatusCode } catch { if ($_.Exception.Response) { Write-Host 'HEALTH:' $_.Exception.Response.StatusCode.Value__ } else { Write-Host 'HEALTH:NO_RESPONSE' } }"
