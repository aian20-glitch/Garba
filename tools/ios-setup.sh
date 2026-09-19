#!/bin/bash
# Первая настройка Xcode для сборки ГАРБЫ под iPhone. Запускать один раз после установки
# Xcode из App Store:   ./tools/ios-setup.sh
# Пароль администратора Mac спросит один раз (лицензия Xcode и его компоненты).
set -euo pipefail
XCODE=/Applications/Xcode.app

if [ ! -d "$XCODE" ]; then
  echo "Xcode ещё не установлен — открываю его страницу в App Store. Нажмите «Получить»,"
  echo "дождитесь установки и запустите этот скрипт снова."
  open "macappstore://apps.apple.com/app/id497799835"
  exit 1
fi

echo "1/4 Xcode — основной, лицензия, компоненты (нужен пароль Mac)…"
sudo xcode-select -s "$XCODE/Contents/Developer"
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch

echo "2/4 Симулятор iPhone (несколько ГБ)…"
xcodebuild -downloadPlatform iOS

echo "3/4 Библиотеки приложения (CocoaPods)…"
cd "$(dirname "$0")/../mobile"
flutter precache --ios
flutter pub get
(cd ios && pod install)

echo "4/4 Проверка:"
flutter doctor
echo
echo "Готово. Скажите Claude «Xcode готов» — он соберёт и проверит ГАРБУ на симуляторе iPhone."
