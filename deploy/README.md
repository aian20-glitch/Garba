# Сервер ГАРБА в интернете

VPS в Казахстане (Ubuntu 24.04) → Caddy (https, сертификат сам) → Node (`dist/index.js`)
→ SQLite в `/var/lib/garba/garba.db`, копия каждую ночь в `/var/backups/garba` (14 дней).

## Что нужно купить (владелец)

1. **VPS**: Ubuntu 24.04, 1 ядро, 2 ГБ памяти, 20 ГБ диска (PS.kz, Hoster.kz…).
   При заказе вставить SSH-ключ — содержимое `~/.ssh/garba_vps.pub` на Mac.
2. **Домен** (например garba.kz): в его DNS — запись `A` на IP сервера.

## Запуск (Claude делает сам, когда есть IP и домен)

```bash
# 1. Адрес сервера — в ~/.ssh/config:
#    Host garba-vps
#        HostName <IP>
#        User root
#        IdentityFile ~/.ssh/garba_vps
# 2. Первая настройка:
./deploy/deploy.sh garba-vps --first
ssh garba-vps 'bash /root/garba-deploy/setup-server.sh garba.kz'
# 3. Код и запуск (так же — каждое обновление сервера):
./deploy/deploy.sh garba-vps
# 4. Проверка снаружи:
curl https://garba.kz/health
```

## Приложение на сервер в интернете

```bash
cd mobile
flutter build apk --release --dart-define=API_BASE=https://garba.kz
```
Без `--dart-define` приложение ходит на сервер на этом Mac (`10.0.2.2` из эмулятора).
Обычный http разрешён только в отладочной сборке.

## На сервере

- логи: `journalctl -u garba -f`; перезапуск: `systemctl restart garba`
- копии базы: `ls /var/backups/garba`; сделать сейчас: `systemctl start garba-backup`
- восстановить: `systemctl stop garba && cp /var/backups/garba/garba-<дата>.db /var/lib/garba/garba.db && chown garba:garba /var/lib/garba/garba.db && systemctl start garba`
