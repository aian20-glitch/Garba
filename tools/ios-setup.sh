#!/bin/bash
# Симулятор iPhone для ГАРБЫ. Xcode уже установлен (20.09.2026), осталось скачать образ
# системы для симулятора — он ставится в системную папку, поэтому нужен пароль Mac.
#
#   ./tools/ios-setup.sh          (спросит пароль один раз, качает ~8 ГБ)
#
# То же самое можно сделать мышкой: Xcode → меню Xcode → Settings → Components →
# iOS 27.0 Simulator → Get.
set -euo pipefail

if [ ! -d /Applications/Xcode.app ]; then
  echo "Xcode не найден. Поставьте его из App Store и запустите скрипт снова."
  open "macappstore://apps.apple.com/app/id497799835"
  exit 1
fi

echo "Скачиваю образ симулятора iPhone (несколько ГБ). Прогресса почти не видно — это нормально."
sudo xcodebuild -downloadPlatform iOS

echo
echo "Установлено:"
xcrun simctl list runtimes | grep -i ios || echo "образ не появился — попробуйте через Xcode → Settings → Components"
echo
echo "Готово. Скажите Claude «симулятор готов» — он соберёт и проверит ГАРБУ на iPhone."
