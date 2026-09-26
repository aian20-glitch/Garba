# Выпуск в магазины

- `listing.md` — тексты карточки (название, описания, ключевые слова).
- `forms.md` — ответы на анкеты: конфиденциальность, возраст, безопасность данных.
- `screenshots/ios/` — 1320×2868 (iPhone 6.9"), для App Store.
- `screenshots/android/` — 1320×2640 (те же кадры без строки состояния, у Google Play стороны
  не больше 1:2), для Google Play.
- `android/icon-512.png` — значок для Google Play; `android/feature-1024x500.png` — баннер
  (исходник `android/feature.html`, перерисовать — Chrome headless, см. `mobile/design/README.md`).
- `android/garba-<версия>.aab` — сборка для Google Play (в git не попадает):
  `cd mobile && flutter build appbundle --release --dart-define=API_BASE=https://garbagame.kz`.
  Подпись — ключ загрузки `~/garba-keys/garba-upload.jks`. Каждая новая загрузка — поднять
  `version` в `mobile/pubspec.yaml` (число после `+` должно расти).

Скриншоты сняты 26.09.2026 на симуляторе iPhone 17 Pro Max с локальным сервером и ботами
(игрок «Алибек» — выдуманный). Экран поменялся — переснять.
