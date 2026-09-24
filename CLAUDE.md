# GARBA — карта проекта

Мобильная онлайн карточная игра. Читать этот файл в начале каждой сессии.
Полные правила игры — в `RULES.md`. **Правила брать только оттуда, не выдумывать.**

---

## 1. Стек и структура

```
~/Garba/backend                  Node.js + TypeScript, Express, порт 3000
~/Garba/backend/src/index.ts     основной файл backend (вся логика сейчас здесь)
~/Garba/mobile                   Flutter приложение (Android)
~/Garba/mobile/lib/main.dart     Flutter: подключения и запуск; код разложен по файлам (part):
~/Garba/mobile/lib/core.dart     адрес сервера, аккаунт (Session), RoomLink, ссылки, форматирование
~/Garba/mobile/lib/screens/      по файлу на экран (game_table.dart — игровой стол)
~/Garba/mobile/lib/widgets/      карты, казахский орнамент, окно итога, общие элементы
```

Модули в `backend/src` — что подключено к `index.ts`, а что нет:

| Файл | Оценка |
|---|---|
| `config.ts` | **Подключён** (этап 0). Формула колоды по составу. |
| `deck.ts` | **Подключён** (этап 0). Карты с `id`, честный шаффл. |
| `types.ts` | **Подключён частично** (этап 0) — пока только типы `Card` и `Suit`. |
| `bidding.ts` | **Новый** (этап 2). Торги: доступные заявки, конец торгов, итог. Чистые функции. |
| `play.ts` | **Новый** (этап 3). Розыгрыш: очередь хода, допустимые карты, взятки, итог. |
| `money.ts` | **Новый** (этап 4). Кон, взносы, стоимость заявок, расчёт после раздачи. |
| `vote.ts` | **Новый** (этап 4). Подсчёт голосов «продолжаем / делим кон». |
| `deal.ts` | **Новый** (этап 5). Открытие козыря: ИЗЖОГА, возврат в колоду, до 3 попыток. |
| `accounts.ts` | **Новый** (этап 9.1). Аккаунты в SQLite (`node:sqlite`, встроен в Node): имя, баланс, хеш токена; с 9.3 — код игрока, серия бонусов, кто пригласил, журнал подарков, миграция старой базы. |
| `rating.ts` | **Новый** (этап 9.6). Рейтинг по RULES.md §16: опыт, мастерство после партии и комнаты, сила соперника, размер стола, штраф за уход. Чистые функции. |
| `reactions.ts` | **Новый** (этап 9.7). Смайлики после раздачи (§14): набор, когда можно, частота; проверка кодов в ссылках. Чистые функции. |
| `stats.ts` | **Новый** (этап 9.4). Статистика игрока: партии, победы главным, РАЗ/ДВА/КОН, ГАРБА, монеты, максимумы; победитель комнаты. Чистые функции. |
| `avatars.ts` | **Новый** (этап 9.5). Аватар: хранение фото в базе, тип по байтам, адрес с версией. |
| `bonus.ts` | **Новый** (этап 9.3). Ежедневный бонус и серия 7 дней, проверка подарка, код игрока. Чистые функции. |
| `roomDb.ts` | **Новый** (этап 9.2). Комнаты в SQLite: комната + балансы одной транзакцией, подъём после перезапуска. |
| `presence.ts` | **Новый** (этап 9.2). Кто за столом, кто отключился, у кого вышли 5 минут (§13). Чистые функции. |
| `endVote.ts` | **Новый** (19.09.2026). Закончить игру по согласию (§12.3): кто может предложить, итог, 30 с. Чистые функции. |
| `turnTimer.ts` | **Новый** (19.09.2026). Время на ход 20 с (§13a): часы хода, пропуски, «ушёл». Чистые функции. |
| `rateLimit.ts` | **Новый** (19.09.2026). Ограничение частоты — новые аккаунты с одного адреса. Чистые функции. |
| `openRooms.ts` | **Новый** (19.09.2026). Открытые комнаты и «Быстрая игра»: какие показываем, куда сажаем. Чистые функции. |
| `oauth.ts` | **Новый** (23.09.2026). Вход через Google/Apple: проверка подписи токена (RS256, iss, aud, срок) встроенным `node:crypto`, кеш ключей. |
| `readyCheck.ts` | **Новый** (23.09.2026). «ГОТОВ» перед стартом: 30 с, не нажал — вышел, создатель — следующему. Чистые функции. |
| `special.ts` | **Новый** (этап 7). Спецкарты: какая карта, очередь, множители, итог борьбы, первый ход. |
| `rules.ts` | **Используются** `canPlayCard`, `trickWinner` (этап 3) и `isGarba` (этап 6) — сверены с RULES.md. `specialKind`, `canDeclareMain` — ещё не проверены. |

**Бэкапы — это git** (решение владельца, 19.09.2026). Старые копии `index_old*.ts`,
`main_old*.dart`, `main_wrong.dart`, неиспользуемые `gameEngine.ts` / `roomStore.ts` и папки
платформ `linux/macos/windows/web` удалены — всё это есть в истории git (до коммита «Уборка»).

---

## 2. Окружение (MacBook, с 19.09.2026)

Проект переехал с Windows-ПК на MacBook: Apple M2, 16 ГБ памяти, macOS Tahoe 26.5.1.
Всё ставилось через Homebrew.

- Node.js 26.9 (`brew install node`), npm 11.19
- Flutter 3.47.4 (`brew install --cask flutter`), в PATH — просто `flutter`
- Android SDK: `~/Library/Android/sdk` (без Android Studio: `brew install --cask
  android-commandlinetools`, дальше `sdkmanager`). NDK `28.2.13676358` Gradle докачал сам.
- ADB: `~/Library/Android/sdk/platform-tools/adb` (в PATH не прописан)
- Эмулятор: `Pixel_8`, Android 16 / API 36, ARM-образ `google_apis;arm64-v8a`, id `emulator-5554`
- Java 25 уже стояла в системе — Gradle 9.3.1 с ней работает, отдельная JDK не нужна
- Xcode 27 (App Store) и CocoaPods (Homebrew) установлены; macOS 27.0
- Flutter ходит на backend по `http://10.0.2.2:3000` (это localhost Mac из Android-эмулятора)

Запуск:

```bash
cd ~/Garba/backend && npm run dev
~/Library/Android/sdk/emulator/emulator -avd Pixel_8 &
cd ~/Garba/mobile && flutter run -d emulator-5554
```

Проверка после каждого этапа:

```bash
cd ~/Garba/backend && npm test
cd ~/Garba/mobile && flutter analyze
```

`npm run test:live` — живая проверка сервера, три файла (третий — `tests/live-auth.ts`,
порт 3097: вход через Google на своих тестовых ключах):
- `tests/live-socket.ts` — порт 3099, база в памяти: аккаунты, рассылка по Socket.IO, чужие карты
  никому не уходят, без токена и с чужим токеном ничего не сделать, одна комната за раз, выход из лобби;
- `tests/live-restart.ts` — порт 3098, база во временном файле, таймеры укорочены (1 с / 3 с):
  комната переживает перезапуск сервера, отключение ставит паузу, возврат снимает,
  не вернулся — кон делится между оставшимися.
Не входит в `npm test`, потому что запускает настоящий сервер.

`npm test` = `tsc --noEmit` + проверки логики из `backend/tests/` (торги, розыгрыш, деньги,
голосование — всё по примерам из RULES.md, без сервера). Код выхода 1, если что-то упало.

- `tests/check.ts` — `check(имя, получили, ожидали)` и `section(заголовок)`, без фреймворков.
- `tests/<модуль>.test.ts` — проверки одного модуля из `src/`.
- `tests/run.ts` — подключает все `*.test.ts`. **Новый файл проверок добавлять сюда.**
- Каждое новое правило из RULES.md — сразу проверкой с примером владельца правил.

`flutter analyze` должен показывать **No issues found!** (набор `flutter_lints` не подключён,
шаблонный тест удалён).

### Сервер в интернете (готовится, 19.09.2026)

Владелец выбрал **VPS в Казахстане** (данные граждан РК — в РК; уточнить у юриста перед
публикацией). Всё для запуска — в `deploy/` (см. `deploy/README.md`): systemd-сервис,
Caddy (https сам), ежедневная копия базы, `setup-server.sh` (один раз), `deploy.sh`
(каждое обновление, сначала гоняет `npm test`). SSH-ключ — `~/.ssh/garba_vps` на Mac.
Сервер в продакшене — `node dist/index.js` (`npm run build`), слушает `HOST=127.0.0.1`.
Ключ подписи Android — `~/garba-keys/garba-upload.jks` (пароль там же, `key.properties`;
копия в `mobile/android/key.properties`, в git не попадает). **Потеря ключа = нельзя обновлять
приложение у игроков** — владельцу хранить копию папки `~/garba-keys` отдельно.
Приложение: `flutter build apk --release --dart-define=API_BASE=https://<домен>`; без
`API_BASE` — `http://10.0.2.2:3000`. Обычный http разрешён только в отладке
(`android/app/src/debug/AndroidManifest.xml`). Релиз подписан постоянным ключом.
**Ждём от владельца:** IP сервера и домен.

### iPhone (готовится, 19.09.2026)

Код под iPhone готов: bundle id `kz.garba.app`, иконки всех размеров, доступ к фото, схема
`garba://`, только iPhone (`TARGETED_DEVICE_FAMILY = 1`) и только вертикально (Info.plist +
`SystemChrome` в `main.dart` — и для Android), `NSAllowsLocalNetworking` для разработки.
`apiBase` без `API_BASE`: симулятор iPhone — `http://localhost:3000`, Android-эмулятор — `10.0.2.2`.
**Xcode 27 установлен владельцем 20.09.2026** (macOS обновилась до 27.0). Лицензия принята,
`xcode-select` указывает на Xcode. **CocoaPods для iOS не нужен**: Flutter 3.47 подключает
плагины через Swift Package Manager, Podfile не создаётся (CocoaPods всё же стоит — не мешает).
Сборка под симулятор проходит: `flutter build ios --simulator --debug` → `build/ios/iphonesimulator/Runner.app`.
**Образ симулятора iPhone не установлен** и без владельца не ставится: он пишется в системную
папку `/Library/Developer/CoreSimulator/Images`, поэтому нужен пароль Mac. Без `sudo`
и `xcodebuild -downloadPlatform iOS`, и `xcodes runtimes install` молча висят: ни сети, ни
записи на диск (проверено 20.09.2026). Владельцу: `./tools/ios-setup.sh` (один раз спросит
пароль) или Xcode → Settings → Components → iOS Simulator → Get. Для TestFlight и App Store нужен аккаунт
Apple Developer ($99/год) и команда подписи в Xcode.

### Проверка на симуляторе iPhone (20.09.2026)

Xcode 27 **не содержит Simulator.app** — окна симулятора из командной строки не открыть,
нажимать в нём нечем (`simctl` умеет только запуск, ссылки и снимки экрана; `idb` поставить
не удалось — GitHub периодически недоступен). Поэтому:
- аккаунт кладётся прямо в настройки приложения:
  `PlistBuddy -c "Add :flutter.account.token string <токен>" "$(xcrun simctl get_app_container
  booted kz.garba.app data)/Library/Preferences/kz.garba.app.plist"` (и `.id`, `.name`);
- **отладочный ключ `flutter.debug.room`** в тех же настройках — приложение при старте сразу
  открывает эту комнату (`openDebugRoom()` в `screens/start.dart`, только `kDebugMode`);
- снимок экрана: `xcrun simctl io booted screenshot файл.png`;
- `simctl openurl` с `garba://` показывает системный вопрос «Открыть в приложении?» — без
  нажатия дальше не пройти, поэтому для проверок используется ключ выше.

Проверено на iPhone 17 (iOS 27): экран имени, главный экран (сетка плиток целиком помещается),
ежедневный бонус, круглый стол с картами и отсчётом хода, окно итога раздачи, иконка и
заставка. **Не проверено:** маленький экран iPhone SE, выбор фото для аватара, «Поделиться».

### Эмулятор на Mac

- `adb exec-out screencap -p > файл.png` работает (на Windows-ПК отдавал чёрный кадр).
- Приложение: `kz.garba.app` (постоянное имя с 19.09.2026, iOS — тот же bundle id), запуск —
  `adb shell am start -n kz.garba.app/.MainActivity`.
- Первая сборка APK — около 7 минут (Gradle докачивает NDK, CMake, Platform 35), дальше быстрее.
- Нажатия: `adb shell input tap X Y` в пикселях экрана 1080×2400.
- **Клавиатура.** AVD из `avdmanager` создаётся с `hw.keyboard=no` — клавиатура Mac в эмулятор
  не идёт, а Gboard уходит в «плавающий» режим. В `~/.android/avd/Pixel_8.avd/config.ini`
  выставлено `hw.keyboard=yes` (действует после перезапуска эмулятора). Кириллицу с клавиатуры
  Mac эмулятор не переводит — русское имя набирать на экранной Gboard (добавить русский язык).
- `npm install` пишет «install scripts not covered by allowScripts: esbuild» — это не мешает,
  `tsx` работает.

### Живая проверка после переезда (19.09.2026)

- `npm test` — 340 из 340; `npm run test:live` — 64 + 23, всё прошло.
  Одна проверка в `live-socket.ts` устарела (ждала карточку игрока без `stats`/`rating`) — поправлена.
- Приложение собрано и открыто на эмуляторе. **Экраны этапов 7–9.7 руками ещё не пройдены.**
- **До первого запуска на симуляторе iPhone** поправить в приложении:
  - `apiBase` сейчас `http://10.0.2.2:3000` — это адрес компьютера только из Android-эмулятора.
    Симулятору iPhone нужен `http://localhost:3000`: выбирать по платформе
    (`Platform.isIOS`), а для настоящих телефонов — адрес компьютера в сети или сервер в интернете;
  - iOS запрещает обычный http (App Transport Security): для разработки в `ios/Runner/Info.plist`
    разрешить `NSAllowsLocalNetworking`; к выпуску сервер должен быть на https;
  - iOS-плагины (image_picker, share_plus, app_links, shared_preferences) ставятся через
    CocoaPods: `pod install` делает `flutter run` сам, если CocoaPods установлен.

### Старый Windows-ПК (история)

Там было 3,8 ГБ памяти — эмулятор падал, живьём проверить этапы 7–9.7 не удалось.
Flutter не был в PATH (`C:\Users\Gold Lombard\Desktop\flutter\bin\flutter.bat`), SDK в
`C:\Android\Sdk`, скриншоты только через `adb emu screenrecord screenshot`.
Для ботов на Windows остаётся `tools\garba.ps1` (см. раздел 4).

---

## 3. Железные правила проекта

1. **Backend — единственный источник истины.** Flutter только отображает состояние и
   отправляет действия. Flutter НИКОГДА сам не решает: чей ход, какая карта допустима,
   кто раздающий, какой козырь, кто выиграл торги, кто взял взятку.
2. **Карты других игроков скрыты даже от клиента** — backend не отдаёт чужие руки наружу.
   То же касается масти, выбранной при ДВА: она не попадает в публичное состояние
   до начала розыгрыша.
3. **Ничего не выдумывать.** Правило неизвестно или отсутствует в `RULES.md` —
   остановиться и спросить владельца. Придуманные правила хуже, чем отсутствие кода.
4. Работать маленькими шагами: одно изменение → сборка → проверка → следующий шаг.
5. Перед серьёзной заменой файла — коммит в git (это и есть бэкап). Копии `*_oldN` больше не делать.
6. Комментарии в коде и тексты в UI — на русском.
7. Не добавлять новые зависимости без объяснения, зачем они нужны.
8. Ошибки не замазывать заглушками: если что-то не работает — сказать прямо.

---

## 4. Контракт API

Менять без предупреждения нельзя.

**С этапа 9.1 игрок определяется только по токену.** Все запросы `/rooms/...` и `GET /me`
идут с заголовком `Authorization: Bearer <токен>`, без него — 401. Поля `playerId` и `name`
в теле больше не нужны: сервер подставляет их из аккаунта, присланные — игнорирует.
`?playerId=` в `GET /rooms/:id` тоже больше не читается. Так никто не может ходить
за другого игрока или подсмотреть его руку.

```
GET  /health
POST /accounts                   { name }   → 201 { id, name, balance, createdAt, token }
                                 имя 1..20 символов; новый аккаунт — 30 000 монет (с 25.09.2026);
                                 токен выдаётся один раз, телефон обязан его сохранить
POST /accounts/recover           { playerCode, recoveryCode } → новый токен и новый код; 401, 429
POST /me/recovery-code           → { recoveryCode } — выпустить новый, старый перестаёт работать
POST /accounts                   { name, inviteCode? }   inviteCode — код пригласившего (этап 9.3),
                                 ему +10 000 (с 25.09.2026), когда новый игрок доиграет 3 комнаты (с 19.09.2026);
                                 неизвестный код — 400 invite code not found; с одного адреса
                                 не больше 5 в час / 20 в сутки — 429 (свой компьютер — без лимита)
POST /auth/:provider             { idToken, name?, inviteCode? }   provider: google | apple (23.09.2026).
                                 Сервер сам проверяет подпись токена Google/Apple. Привязан → 200
                                 { ...аккаунт, token } (новый токен, прежний телефон выходит);
                                 не привязан и нет name → 404 { suggestedName }; с name → 201 новый
                                 аккаунт с этим входом. 401 invalid token; 503 login not configured
POST /me/logins/:provider        { idToken } → { logins }  привязать; 409 чужой / уже есть другой
DELETE /me/logins/:provider      → { logins }  отвязать; 404 not linked
GET  /me                         → { id, name, balance, createdAt, code, dailyDay, dailyStreak,
                                     invitedBy, roomId, daily, giftSentToday, invitedCount,
                                     friendRequests, logins }   friendRequests — сколько зовут в друзья;
                                 logins — ['google', 'apple'] — к чему привязан
                                 roomId — незаконченная комната игрока или null;
                                 daily = { claimedToday, streak, amount } — бонус сегодня (этап 9.3)
POST /me/daily-bonus             → { amount, streak, balance }; 409 already claimed today
DELETE /me                       → { ok } — удалить аккаунт навсегда (требование Apple/Google):
                                 аккаунт, фото, друзья, статистика; в старых комнатах имя —
                                 «Удалённый игрок». 409 finish your game first { roomId }
GET  /players/:code              → { code, name, stats, isFriend, friendStatus }   карточка игрока;
                                 friendStatus: friends | outgoing | incoming | none; 404
GET  /me/profile                 → { id, name, code, balance, createdAt, stats, friendsCount }
                                 stats — за всё время: rooms, deals, mains, wins, losses, raz, dva,
                                 kon, garba, coinsWon, coinsLost, maxWin, maxRisk (этап 9.4)
PUT  /me/avatar                  тело — сама картинка (не JSON), до 300 КБ → { avatar }
                                 400 not an image (JPEG/PNG/WebP по байтам); 413 image too large
GET  /avatars/:id?v=...          картинка, без токена; «v» — версия, меняется с новой фоткой
GET  /rating?scope=friends|all   → { scope, total, myPlace, players: [{ place, code, name, avatar,
                                     rating, me }] }   friends — я и друзья; all — первые 50
GET  /friends                    → { friends: [{ code, name, avatar, rating, stats, roomId }] }
POST /friends                    { code }   → 202 { status: 'requested' } — заявка (с 19.09.2026
                                 дружба только с согласия второго); 201 { status: 'friends' } — он
                                 уже звал меня; 404 player not found; 400 self; 409 already friends
                                 | request already sent
GET  /friends/requests           → { incoming: [...], outgoing: [...] } — { code, name, avatar, rating }
POST /friends/requests/:code/accept | decline | cancel   — принять / отклонить входящую /
                                 отменить свою; отклонённому не сообщаем
DELETE /friends/:code            → { ok }; 404 not a friend
POST /gifts                      { toCode, amount }  → { amount, balance, to: { code, name } }
                                 amount 100..10000 кратно 100 (с 25.09.2026); ошибки: 400 bad amount | self |
                                 not enough coins; 409 already gifted today; 409 finish your game
                                 first (дарить нельзя, пока сидишь в комнате); 404 player not found

— дальше всё с токеном —
POST /rooms                      { capacity, ante, emptyLimit, konThreshold, minBalance, isPublic?,
                                   turnSeconds? }   turnSeconds 20 | 40, без него — 20 (§13a, 23.09.2026)
                                 capacity 4..7; ante 100..1000 кратно 100;
                                 emptyLimit 3..10; konThreshold 3..10;
                                 minBalance 1000..10000 кратно 1000, не меньше ante × 10
                                 (с этапа 4 обязательны)
                                 409 { error: 'already in another room', roomId } — см. ниже
                                 403 not enough coins to enter — баланс аккаунта меньше minBalance
GET  /rooms/open                 → { rooms: [{ id, capacity, players, creatorName, settings }] } — открытые
                                 лобби со свободным местом, куда хватает монет; почти полные сверху
POST /rooms/quick                {} → комната: сесть в самую заполненную открытую, нет — создать
                                 открытую (5 игроков, взнос 100); 409 already in another room; 403
POST /rooms/:id/visibility       { isPublic } — открыть для всех / только по коду; создатель, в лобби
GET  /rooms/:id
POST /rooms/:id/invite           { code }   позвать друга (25.09.2026): только друга, только когда есть
                                 свободное место (лобби или освободилось в игре); 403 not a friend;
                                 приглашение 10 мин в /me → roomInvites: [{ roomId, fromName, at }]
                                 (в памяти, без push — друг видит его на главном экране)
DELETE /me/invites/:roomId       → { ok } — отказаться от приглашения
POST /rooms/:id/seat             { seat }   пересесть на свободное место — только в лобби (24.09.2026);
                                 409 seat taken | game already started; 400 bad seat
POST /rooms/:id/join             { seat? }   место — выбранное или первое свободное; в начатую
                                      игру — только на освободившееся место (§13b); 403 { error: 'not enough coins to enter',
                                           minBalance, balance }, если денег меньше минимума;
                                      409 already in another room
POST /rooms/:id/leave            {}   в лобби — выйти (ушёл создатель — комната закрывается);
                                      в игре — только между раздачами (§13b, 24.09.2026): кон
                                      делится между оставшимися, −1.0 рейтинга, место свободно
                                      → { left: true }; 409 can leave only between deals
POST /rooms/:id/start            {}   только создатель
POST /rooms/:id/dealer/continue  {}   только раздающий (не создатель!);
                                 в стадиях dealer_found, awaiting_deal, round_done
POST /rooms/:id/bid              { bid, suit? }   bid: РАЗ | ДВА | ПАС;
                                 bid: ещё КОН, когда кон дорос до порога (этап 6);
                                 suit обязателен для ДВА при 6–7 игроках, иначе
                                 400 { error: 'choose a suit for ДВА', suitOptions }
POST /rooms/:id/play             { cardId }   ход картой (этап 3)
POST /rooms/:id/vote             { choice }   choice: continue | split (этап 4)
POST /rooms/:id/kon-trump        { suit }     выигравший КОН называет козырь (этап 6)
POST /rooms/:id/special          { action, risk? }   спецкарта: action take | pass (этап 7)
POST /rooms/:id/discard          { cardId }   владелец спецкарты сбрасывает карту (этап 7)
POST /rooms/:id/concede          {}           главный сдаётся в любой момент розыгрыша (§10.7):
                                              платит как при проигрыше; 409 cannot concede now
POST /rooms/:id/end-game         { choice }   yes | no — закончить игру по согласию (§12.3): первый yes
                                              между раздачами — предложение, дальше — голоса; все yes —
                                              кон поровну, room_done, closeReason 'agreed_end';
                                              30 с без ответа — «нет»; пока идёт — раздавать нельзя (409)
POST /rooms/:id/react            { emoji }    смайлик — в любой момент, и в лобби, и на паузе (25.09.2026);
                                 400 не из набора, 429 чаще раза в 2 секунды

— служебное, только с этого компьютера (23.09.2026) —
POST /admin/coins                { code | id, amount }  → { name, amount, balance }; через moveCoins;
                                 с X-Forwarded-For (из интернета через Caddy) — 403 local only

— без токена, для людей (этап 9.7) —
GET  /r/:roomId                  страница-приглашение в комнату: кнопка garba://room/<номер>
GET  /i/:code                    страница-приглашение друга: кнопка garba://invite/<код>
```

`GET /rooms/:id` отдаёт `game.hand` только владельцу токена,
чужие руки — только числом в `game.handCounts`.

**Деньги вне игры (этап 9.3).** Бонус, подарок и награда за приглашение идут через
`moveCoins` → `changeCoins` в `index.ts`, одной транзакцией. Если игрок сидит в
незаконченной комнате, деньги меняются **и в комнате** (`balance` и `startBalance`) —
иначе следующее сохранение комнаты затёрло бы начисление. `startBalance` сдвигается,
чтобы бонус не считался выигрышем за столом. **Любое новое начисление вне игры — только
через `moveCoins`**, не прямым UPDATE в базе.

Сутки для бонуса и подарков — по времени Казахстана (UTC+5), `dayKey()` в `bonus.ts`.

**Аватар (этап 9.5).** Поле `avatar` — адрес вида `/avatars/<id>?v=<время>` или `null`;
есть в `/me`, `/me/profile`, `/players/:code`, `/friends` и у каждого игрока в
`players[]` комнаты. Клиент добавляет к нему `apiBase`. Фото выбирается в галерее через
`image_picker` (зависимость Flutter), телефон сам уменьшает его до 256 точек.

**Рейтинг (этап 9.6, RULES.md §16).** Рейтинг = мастерство (`accounts.skill`, 0…8) + опыт
(0.01 за партию из `room_stats`, до 2). Пока игрок за столом, мастерство живёт в
`room.rating[id].skill` и пишется в аккаунт вместе с комнатой — как баланс. Меняется в
`finishRound` (`afterDeal`) и при закрытии комнаты (`markWinners` → `afterRoom`, там же
штраф −1.0 ушедшему). Поле `rating` (одна цифра после запятой) — в `/me`, профиле, карточке,
друзьях и у каждого игрока в `players[]` комнаты; там же `ratingStart` — для «4.0 → 4.9».
Все числа — константы в начале `rating.ts`, менять только вместе с RULES.md §16.

**Статистика (этап 9.4).** `room.stats` — статистика каждого игрока за комнату, заводится
в `/start`. Пишется в трёх местах, где двигаются деньги за столом: взнос (`takeAnte`),
расчёт раздачи (`finishRound` — там же `addDeal`), раздел кона (`closeWithSplit`,
`closeByDisconnect`) — через `recordMoney`. **Новое движение денег за столом — тоже через
`recordMoney`**, иначе статистика разойдётся с балансом. При сохранении комнаты статистика
пишется в таблицу `room_stats`; профиль (`profileStats`) складывает её по всем комнатам.
В публичном состоянии: `stats` на уровне комнаты, `game.winnerIds` — победитель (§36).

**Смайлики (этап 9.7, RULES.md §14).** `reactions` на уровне комнаты — последние 20:
`[{ id, playerId, emoji, at }]`. `id` растёт; клиент показывает только новые, а при первом
открытии комнаты старые лишь запоминает. Набор смайликов — в `reactions.ts` и в
`tableReactions` в `lib/core.dart`, менять оба вместе.

**Ссылки-приглашения (этап 9.7).** Приложение делится ссылкой `<apiBase>/r/<номер>` (кнопка
«ПРИГЛАСИТЬ» в лобби) или `<apiBase>/i/<код>` (экран «Пригласить друга»). Страница сервера
открывает приложение по схеме `garba://` (зарегистрирована в AndroidManifest и Info.plist,
встроенная обработка ссылок Flutter выключена). Ссылку ловит `DeepLinks` в `lib/core.dart`
(пакет `app_links`): комната — сразу вход; приглашение до создания аккаунта — код
подставляется на экране имени, после — открывается карточка пригласившего. Делится
приложение через `share_plus`. **Пока сервер на домашнем ПК, ссылка работает только в
домашней сети** — для друзей нужен сервер в интернете.

**Одна комната за раз.** Баланс у аккаунта один, и пока игрок за столом, его деньги
считаются в комнате. Поэтому создать или войти во вторую незаконченную комнату нельзя —
409 с `roomId` той, где он сидит; приложение предлагает вернуться в неё.

**База надёжно пишется (23.09.2026).** `openDb` включает `journal_mode=WAL` и ждёт занятую
базу до 5 с (`timeout`) — ночная копия (`sqlite3 .backup`) и чтение базы не мешают записи.
`persistRoom` ошибку записи только пишет в журнал: он вызывается после ответа и из таймеров,
где брошенная ошибка уронила бы весь сервер; комната цела в памяти, следующее сохранение
запишет её целиком. Рядом с базой лежат `garba.db-wal` и `garba.db-shm` — это нормально.

**Вход через Google и Apple (23.09.2026).** Вход по имени остаётся; Google/Apple — вход и
привязка из профиля (решение владельца). Храним только `account_logins(provider, subject,
account_id)` — ни email, ни имени (решение владельца). Apple — только на iPhone. Настройки:
`GARBA_GOOGLE_CLIENT_IDS` — идентификаторы клиентов из Google Cloud через запятую (iOS,
Android, веб); пусто — вход через Google выключен (503). `GARBA_APPLE_CLIENT_IDS` — по умолчанию
`kz.garba.app`. `GARBA_GOOGLE_JWKS_URL` / `GARBA_APPLE_JWKS_URL` — только для проверок
(`tests/live-auth.ts`). **Сделан только сервер.** Кнопки в приложении — после того, как владелец
создаст проект в Google Cloud (Google) и купит Apple Developer (Apple). До App Store: отзыв
входа Apple при удалении аккаунта (нужен ключ `.p8`).

**Деньги и база.** `players[].balance` в комнате — это баланс аккаунта. После каждого
`POST /rooms/:id/...` сервер записывает балансы игроков комнаты в базу
(`syncBalances`, в том же middleware, что и рассылка). База — `backend/data/garba.db`
(в git не попадает), путь меняется переменной `GARBA_DB` (`:memory:` — в памяти).
**Комнаты тоже в базе** (этап 9.2): таблица `rooms`, комната целиком одной строкой JSON.
Комната и балансы её игроков пишутся **одной транзакцией** (`persistRoom` → `saveRoom`) —
после каждого POST, при создании и при паузе/возврате/закрытии. При старте сервер поднимает
все недоигранные комнаты обратно; закрытые остаются в базе, но в память не грузятся.

**Отключение (§13, этап 9.2).** Раз в секунду сервер смотрит, у кого из игроков начатой
комнаты открыт сокет (запрос к своей комнате тоже считается). Нет связи дольше 10 секунд —
игрок отключился: `pause` в состоянии комнаты, ходы отклоняются 409 `game paused`
(кроме join/leave/start). Вернулся — пауза снята. Не вернулся за 5 минут — `room_done`,
`closeReason: 'player_left'`, `leftPlayerIds`, кон поровну между оставшимися, остаток —
тому из них, кто больше всех проиграл. В лобби и после конца игры присутствие не следится.
Присутствие живёт в памяти: после перезапуска всем снова 10 секунд на переподключение.
Для проверок таймеры меняются переменными `GARBA_GRACE_MS` и `GARBA_DISCONNECT_MS`.

```
pause: null | { players: [{ id, name, secondsLeft }] }   — на уровне комнаты, не game
```

**Время на ход (§13a).** Раз в секунду сервер смотрит, кого ждёт (`awaitedMoves` в `index.ts`),
и через `room.settings.turnSeconds` (20 или 40 с; нет поля — 20) ходит за него **запросом самому себе** — через те же проверки, базу и рассылку.
Пропуск — заголовки `x-garba-internal` (случайный секрет процесса) + `x-garba-player`, только
с 127.0.0.1. Два пропуска подряд — `game.awayAt[id]`: пауза как при отключении, 5 минут.
Любой POST самого игрока (в том числе `POST /rooms/:id/back` — «Я ЗДЕСЬ», разрешён на паузе)
сбрасывает пропуски. Открыл стол (сокет `watch`) — тоже вернулся: «ушёл» снимается сам.
Выход из-за стола посреди игры — приложение переспрашивает (`PopScope` в `game_table.dart`). В состоянии: `game.turnSecondsLeft`, `game.awaitedIds`,
`pause.players[].reason` — `offline` | `away`. Для проверок: `GARBA_TURN_MS`.
5 минут — **общий запас на всю игру** и на `offline`, и на `away` (`absenceStep` в `presence.ts`):
потрачено — `game.absenceUsedMs` (в базе), текущий отрезок — в памяти; `pause.players[].secondsLeft`
— остаток запаса.

**Места и замена ушедшего (24.09.2026, `seats.ts`, RULES.md §2, §13, §13b).** У игрока
`players[].seat` 0…capacity−1; `room.players` всегда отсортирован по месту (следующий — сосед
справа), при старте не перемешивается. Ушёл (`vacateSeat`) — кон делится между оставшимися
(`game.lastLeave`), место в `room.vacancies` и `pause.vacancies: [{ seat, secondsLeft }]`, ходы на
паузе (закончить игру по согласию — можно). Сел новый — пустой кон, со следующей раздачи играет;
был раздающим — раздаёт новый. 10 минут никто не сел — `closeReason: 'seat_empty'`
(`GARBA_VACANCY_MS`). Пропал на 5 минут посреди раздачи — `game.goneIds`: главный сразу
сдаётся, за него ходит таймер через 1,5 с, после раздачи место свободно. В `/rooms/open` —
и начатые открытые игры со свободным местом (`started: true`).

**Живые обновления — Socket.IO** (с этапа 8), тот же порт 3000:

```
клиент → 'watch' { roomId, token }      следить за комнатой
сервер → 'room'  <то же, что GET /rooms/:id для этого токена>   сразу и после каждого POST /rooms/:id/...
сервер → 'room_error' { error: 'room not found' | 'unauthorized' }
```

- Действия по-прежнему идут HTTP-запросами; сокет только **присылает** состояние.
- Каждому подписчику — своё состояние (`publicRoom(room, id его аккаунта)`): своя рука,
  чужих карт нет. Рассылка — middleware на `app.use('/rooms/:id')`, после ответа на POST.
- Приложение (`RoomLink` в `lib/core.dart`) подписывается на каждом экране комнаты;
  пока сокет отвалился — опрашивает `GET /rooms/:id` раз в 3 секунды.
- Порт сервера можно задать переменной `PORT` (по умолчанию 3000).

**Стадии игры** (`game.stage`, с этапа 2):

| Стадия | Что происходит |
|---|---|
| `dealer_found` | первый раздающий найден вскрытием на туза, ждём раздачи |
| `bidding` | карты розданы, идут торги |
| `playing` | главный определён, идёт розыгрыш 5 взяток (с этапа 3; заменила `bidding_done`) |
| `round_done` | раздача сыграна, деньги посчитаны, следующий раздающий должен раздать |
| `awaiting_deal` | все спасовали, пересдача — новый раздающий должен раздать |
| `special` | открылась спецкарта: слепой круг туза или окно борьбы за карту (этап 7) |
| `special_discard` | спецкарту забрали: владелец сбрасывает одну свою карту (этап 7) |
| `kon_trump` | торги выиграл КОН, он называет козырь — по РАЗ или по ДВА (этап 6) |
| `vote` | ни у кого не хватает ни на РАЗ, ни на ДВА (заявка КОН не мешает); голосуем: продолжаем или делим (§12.2) |
| `room_done` | комната закрыта (с этапа 4), `room.status = 'finished'` |

**Поля торгов** (с этапа 2, заменили прежний `trumpCard`):

- `openCard` — открытая карта. **Это не козырь.**
- `razSuit` — масть РАЗ. При 4 игроках всегда `hearts`, при 5+ — масть открытой карты.
- `trumpSuit` — итоговый козырь, `null` до конца торгов (ДВА может сменить масть).
- `mains` — главные: `[{ playerId, playerName, declaration: 'РАЗ' | 'ДВА' }]`, один или двое.
- `lastRedeal` — почему пересдача: `'all_pass'` или `'three_izzhoga'`, иначе `null`.
- `izzhoga` — карты ИЗЖОГИ, открывшиеся в этой раздаче и вернувшиеся в колоду (открыты всем).
- `myDvaSuit` — масть, выбранная при ДВА; видна **только** сказавшему ДВА.
  Сама масть хранится в `game.dvaSuit` и в публичное состояние не попадает —
  раскрывается через `trumpSuit`, когда ДВА стал главным (RULES.md §6.3).
- `myDvaSuitOptions` — из каких мастей можно выбрать ДВА; тому, чья очередь и кому ДВА доступен.
  Если вариант один (5 игроков) — клиент не спрашивает, сервер берёт его сам.
- `myAllowedBids` — какие заявки сейчас доступны запросившему (`playerId` из query).
  Пусто, если не его очередь. **Клиент включает кнопки только по этому списку.**

Логика торгов — чистые функции в `backend/src/bidding.ts`.

**Поля розыгрыша** (с этапа 3):

- `turnPlayerId` — кто сейчас кладёт карту.
- `trickNumber` — номер взятки, 1…5.
- `currentTrick` — карты текущей взятки: `[{ playerId, playerName, card }]`. Открыты всем.
- `lastTrick` — прошлая взятка `{ cards, winnerId, winnerName }`, чтобы все успели
  увидеть, кто её забрал.
- `playedTricks` — все завершённые взятки раздачи по порядку; сыгранные карты открыты
  всем до конца раздачи (RULES.md §10.6). Свои сыгранные карты клиент показывает в руке серыми.
- `tricksWon` — `{ playerId: число взяток }`.
- `result` — после раздачи: `[{ playerId, playerName, declaration, tricks, won }]`.
- `myPlayableCardIds` — какими картами запросивший может пойти сейчас.
  Пусто, если не его ход. **Клиент даёт нажать только эти карты.**

`POST /play` отвечает 400, если карты нет в руке или правила её не разрешают
(в ответе — `playableCardIds`), и 409, если не ход этого игрока.

Логика розыгрыша — `backend/src/play.ts`, поверх `canPlayCard` / `trickWinner` из `rules.ts`.

**Деньги** (с этапа 4):

- `room.settings` — `{ ante, emptyLimit, konThreshold, minBalance, turnSeconds }`, выбирает создатель.
  `minBalance` при входе сравнивается с настоящим балансом аккаунта (этап 9.1).
- `players[].balance` — баланс аккаунта, пока игрок в комнате; `players[].startBalance` —
  баланс при входе. Новый аккаунт получает 10 000 (`STARTING_COINS`). Балансы открыты всем — так и по ТЗ.
- `game.kon` — текущий кон; `game.baseKon` — игроки × взнос.
- `game.razStake`, `game.dvaStake` — сколько сейчас стоит заявка (столько заберёшь
  при победе и положишь при проигрыше, до риска). По ним же проверяется баланс.
- `game.konBeforeSettlement` — кон до расчёта последней раздачи.
- `game.result[].delta` — сколько главный получил (+) или положил в кон (−).
- `game.lastAnte` — последний взнос: `{ reason: 'kon_empty' | 'all_pass', perPlayer, total,
  skipped, brokePlayerIds }`. Доливают все или никто: `skipped = true`, если у кого-то
  (`brokePlayerIds`) не хватило денег.
  `noRaz: true` — всеобщий ПАС, а на РАЗ не хватает ни у кого: не доливали (§9.2a,
  `refillPointless` в `money.ts`); после трёх ИЗЖОГ правило не действует.
- `game.emptyStreak` — пустых раздач подряд; `game.closing` — доигрываем последний кон.
- `game.closeReason` — `'kon_taken'` (§12.1) или `'nobody_can_play'` (§12.2);
  `game.split` — `{ kon, perPlayer, remainder, remainderTo }`, если кон поделили.
- `game.vote` — идущее голосование: `{ continueVotes, splitVotes, votedIds, cheapest }`;
  `game.myVote` — голос запросившего; `game.lastVote` — `{ result, continueVotes, splitVotes }`.
  Делим **только единогласно**: первый же голос «продолжаем» решает — играем дальше.
  Подсчёт — `backend/src/vote.ts`.
- `game.konAvailable` — открыт ли КОН сейчас; `game.konStake` — сколько стоит (базовый кон);
  `game.konUnlockAt` — с какого кона открывается.
- `game.konAs` — как КОН назвал козырь: `'РАЗ'` или `'ДВА'` (виден, когда козырь объявлен).
- `game.myKonTrumpOptions` — `[{ suit, as }]` только выигравшему КОН в стадии `kon_trump`.
  До его выбора `trumpSuit` пуст — козырь не знает никто (RULES.md §6.7).
- `game.result[].instant` — главный выиграл сразу, без розыгрыша: у него дама, король и туз
  козыря; тогда `trickNumber = 0`. Так бывает при РАЗ, КОНЕ и ДВА.
- `game.result[].garba` — это ГАРБА: `instant` при РАЗ или КОНЕ. Анимация «ГАРБА!» и
  статистика — только по этому флагу. ДВА с Q K A — `instant`, но **не** `garba` (RULES.md §8): анимация та же (с 25.09.2026), в статистику не идёт.
- `game.special` — спецкарта и борьба за неё (этап 7): `{ kind: A|K|Q|6|10, card, phase: blind|window,
  holderId, holderName, risk, passedIds, activeId, outcome }`. `outcome` — `{ holderId, risk }`
  или `'nobody'` (тогда обычные торги). Взявший — главный как РАЗ, проигрыш × `risk`.
- `game.mySpecialRisks` — какие множители может назвать запросивший (уже с учётом баланса:
  кон × риск); пусто, если не его очередь.
- `game.myCanConcede` — запросивший главный и может сдаться (§10.7); `game.myConcedeLoss` — сколько
  положит в кон; `game.concededIds` — кто уже сдался (при двух главных доигрывает противником);
  `game.result[].conceded` — главный сдался (платит как при проигрыше).
- `game.myDiscardOptions` — id карт, которые владелец спецкарты может сбросить (не саму спецкарту).
  Сброшенная карта хранится в `game.discardedCard` и наружу не отдаётся.
- Во время борьбы за спецкарту `hand` и `handCounts` урезаны: при слепом круге туза — 0 карт,
  в окне — 1. Все 5 уже лежат на сервере, они «дораздаются молча» после борьбы.
- `game.endVote` — `{ proposerName, yesIds, noIds, secondsLeft }` или null; `game.myEndVote` — yes/no/null;
  `game.myCanProposeEnd`; `game.lastEndVote` — `{ result: rejected|expired, byName }` (§12.3,
  чистые функции — `backend/src/endVote.ts`).
- `game.dealsUntilNextVote` — после «продолжаем» снова голосуем не раньше чем через круг
  (число игроков раздач, пустые тоже считаются). 0 — ограничения нет.

Логика денег — чистые функции в `backend/src/money.ts`.

**Формат карты** (с этапа 0):

```json
{ "id": "hearts-A", "suit": "hearts", "rank": "A" }
```

- `suit` — имя масти: `hearts` | `diamonds` | `clubs` | `spades`.
  Символы `♥ ♦ ♣ ♠` живут только в UI (`suitSymbol()` в `lib/core.dart`).
- `id` — стабильный идентификатор карты, уникальный в пределах колоды.
  Нужен, чтобы клиент мог сослаться на конкретную карту при ходе.

### Боты для ручной проверки

**На Mac — `tools/garba`** (обёртка над `backend/scripts/garba.ts`, Node + встроенный `fetch`,
новых зависимостей нет). Запускать из корня проекта; адрес сервера — переменная `GARBA_URL`
(по умолчанию `http://127.0.0.1:3000`).

```bash
./tools/garba join     12345              добрать ботов — дальше они играют сами (журнал: tools/.bots-online.log)
./tools/garba join     12345 --manual     боты только держат связь, ходы — командами ниже
./tools/garba state    12345              показать состояние
./tools/garba deal     12345              раздать, если раздающий — бот
./tools/garba passall  12345              боты пасуют до твоего хода
./tools/garba playall  12345              боты ходят картами до твоего хода
./tools/garba bid      12345 РАЗ --bot 1  заявка бота (ДВА при 6–7: --suit clubs)
./tools/garba vote     12345 split        все боты голосуют (continue | split)
./tools/garba kontrump 12345 diamonds     бот-КОН называет козырь (без масти — масть РАЗ)
./tools/garba special  12345 2            бот берёт спецкарту за ×2 (без числа — пас)
./tools/garba discard  12345              бот-владелец спецкарты сбрасывает карту
./tools/garba online   12345 [--manual]   снова посадить ботов на связь
./tools/garba offline                     «отключить» ботов — проверка паузы (§13)
./tools/garba coins    ER6XKJ 60000       начислить монеты игроку по коду (минус — списать)
./tools/garba coins    bots 60000         всем шести ботам
```

**На Windows — `tools\garba.ps1`** с теми же командами (`.\tools\garba.ps1 join -Room 12345`,
`-Bid РАЗ -Bot 1`, `-Choice split`, `-Suit`, `-Risk`). Причина его появления — Git Bash
перекодирует аргументы `curl.exe` в кодовую страницу Windows и ломает кириллицу, а
PowerShell 5.1 срезает кавычки в `-d`. Файл сохранён в **UTF-8 с BOM** — без BOM PowerShell 5.1
прочитает кириллицу как ANSI. При правке BOM не потерять. На Mac curl кириллицу не портит.

Боты: 1 — Айдар, 2 — Дана, 3 — Ержан, 4 — Асель, 5 — Тимур, 6 — Мадина.
С этапа 9.1 у каждого бота настоящий аккаунт; токены лежат в `tools/.bots.json` (в git не
попадает). Сервер их не знает (база стёрта) — скрипт сам заводит аккаунты заново. Бот застрял
в старой недоигранной комнате — `join` заводит ему новый аккаунт с тем же именем.
В розыгрыше бот кладёт первую разрешённую сервером карту, без стратегии.

**Боты играют сами** (`bots-online.ts` без `--manual`): как только их очередь — раздают
(после раздачи ждут 6 с, чтобы был виден итог), говорят РАЗ при 3+ картах масти РАЗ или 2
со старшей (туз/король), иначе ПАС; ДВА, КОН и спецкарты не берут; голосуют «делим» —
значит, решает живой игрок. Выбирают только из того, что разрешил сервер (`myAllowedBids`,
`myPlayableCardIds`…). Это инструмент проверки, а не правило игры.

**Боты и пауза (9.2).** Бот без сокета через 10 секунд считается отключившимся. Соединение
им держит `npm run bots -- <комната>` (`backend/scripts/bots-online.ts`), `join` запускает его
сам: на Mac — в фоне (pid в `tools/.bots-online.pid`, журнал `tools/.bots-online.log`, оба в git
не попадают), на Windows — в свёрнутом окне. Боты «отключились» — через 5 минут игра закроется.
Живой игрок, которого изображаешь curl-запросами, тоже без сокета: держать его на связи
опросом `GET /rooms/:id` раз в пару секунд, иначе игра встанет на паузу.

---

## 5. Что работает сейчас

- аккаунты (этап 9.1): при первом запуске игрок вводит имя, телефон хранит токен; баланс
  хранится в базе и переживает перезапуск приложения и сервера; на главном экране — имя,
  баланс и кнопка «вернуться в комнату»; из лобби можно выйти до старта;
- ежедневный бонус с серией 7 дней (забирается сам, окно «День N/7»), подарки монет по коду
  игрока (до 1 000, раз в сутки), приглашение друга по коду (+1 000 пригласившему, когда друг
  доиграет 3 комнаты) — этап 9.3;
- профиль со статистикой за всё время, друзья по коду (взаимно), карточка игрока с подарком,
  итоги комнаты по §35 и победитель, отмеченный сервером (§36) — этап 9.4;
- аватар — любое фото из галереи, виден в лобби, за столом, в профиле и у друзей;
  экран «ПРАВИЛА»: монеты не деньги, главное правило (3 взятки из 5), РАЗ, ДВА, ИЗЖОГА,
  КОН, как ходить, ГАРБА — этап 9.5;
- рейтинг 0–10 (RULES.md §16): рядом с аватаром за столом и в лобби, «Рейтинг 4.0 → 4.9» в итогах
  комнаты, на главном и в профиле, экран «РЕЙТИНГ» — друзья и все игроки; штраф −1.0 за уход
  из игры, из-за которого закрылась комната — этап 9.6;
- главный экран — сетка по две плитки со значками (`HomeTile`), «Вернуться в комнату» во всю ширину;
- смайлики после раздачи и после игры, ссылки-приглашения в комнату и для друга с кнопкой
  «Поделиться» — этап 9.7;
- комнаты переживают перезапуск сервера; отключившийся игрок ставит игру на паузу с отсчётом
  5 минут, вернулся — играем дальше, не вернулся — кон делится между оставшимися (этап 9.2);
- создание комнаты по коду, вход игроков, живое обновление по Socket.IO;
- старт игры только при полной комнате;
- определение раздающего — карты открываются по кругу до первого туза;
- открытие козыря и раздача по 5 карт;
- игрок видит только свои карты;
- случайная посадка за столом, порядок торгов от соседа справа от раздающего;
- карты сдаёт раздающий (тот, кому выпал туз), а не создатель комнаты;
- торги до конца: определение главного, двое РАЗ, обрыв после второго РАЗ,
  все ПАС → пересдача новым раздающим;
- ДВА для 5–7 игроков: при 5 масть однозначна, при 6–7 игрок выбирает её сам и она
  скрыта от остальных до начала розыгрыша; меняет козырь, выбывает при РАЗ, второго ДВА нет;
- ИЗЖОГА при 5–6 игроках: карта вбивается обратно в колоду, открывается следующая,
  до 3 раз; три подряд — пересдача с доливкой, как при всеобщем ПАСе (этап 5);
- ДВА при 4 игроках отклоняется даже прямым запросом;
- открытая карта показывается отдельно от козыря;
- розыгрыш: первым ходит сосед слева от главного, ход в масть и обязательный
  козырь проверяет сервер, взявший взятку ходит следующим, итог — 3 взятки из 5.
  Раздача останавливается, как только исход ясен для всех главных (RULES.md §10.5a),
  поэтому в `round_done` у игроков могут остаться карты на руках;
- деньги: выбор взноса и лимита пустых раздач при создании, взнос при пустом коне,
  доливка при всеобщем ПАСе с лимитом, проверка баланса перед заявкой, расчёт кона
  для РАЗ / ДВА / двух РАЗ (ДВА берёт половину только с кона ×2 базового, вниз до сотни; до этого — как РАЗ), доливка «все или никто»,
  смена раздающего каждую раздачу, закрытие комнаты с экраном итогов — когда кон
  забрали или когда на РАЗ и ДВА не хватает ни у кого и все единогласно решили «делим»;
- порог КОН (×3…×10) выбирается при создании комнаты; заявка КОН: самый низкий приоритет,
  стоит базовый кон, козырь называет после торгов — по РАЗ или по ДВА (этап 6);
- ГАРБА: главный с дамой, королём и тузом козыря выигрывает сразу, без розыгрыша (при ДВА —
  тоже сразу, но без анимации и не ГАРБА);
  при КОНЕ — только базовый кон; на экране надпись «ГАРБА!» (этап 6);
- минимум монет для входа (1 000…10 000, не меньше взноса × 10) выбирается при создании
  и проверяется при входе; условия комнаты видны в лобби;
- спецкарты (этап 7): туз — слепой круг на ×1, потом одно окно перехвата до ×5; король и
  дама — от ×2 с перехватом; 6 и 10 — ×1 без перехвата; пас в борьбе — окончательный;
  взявший берёт карту в руку и сбрасывает одну свою; первый ход: 6 — сам главный,
  10 — главный последним; проигрыш × риск; никто не взял — обычные торги;
  кому не хватает монет ни на один множитель, того не спрашивают — сразу пас (§7.4a,
  `passUnaffordable` в `special.ts`); не хватает никому — борьба кончается сразу;
- все сыгранные взятки на виду до конца раздачи (строкой на взятку), свои сыгранные
  карты остаются в руке серыми;
- круглый стол в стиле покерного (`roundTable()` в `lib/screens/game_table.dart`): я внизу, остальные по кругу
  **против часовой стрелки** — следующий в `room.players` (сосед справа) правее меня, дальше
  вверх и влево. У каждого: аватар (зелёное кольцо — чей ход, звезда — главный, фишка «Р» —
  раздающий), табличка «имя, монеты, рейтинг», плашка заявки / взяток, мелко — его карты из
  прошлых взяток. Карта текущей взятки лежит перед игроком; только что закрытая взятка видна,
  пока новая пуста. В центре — открытая карта всю раздачу (в розыгрыше компактно) и под ней
  масть РАЗ / итоговый козырь; главный — золотая табличка, золотое свечение, красная плашка заявки;
- казахский стиль (выбор владельца, 19.09.2026): иконка «Көк аспан» — небо и золотые рога
  «қошқар мүйіз» (исходники SVG — `mobile/design/`, адаптивная иконка Android + все размеры iOS);
  стол «Көк» — небесное сукно, бортик с золотыми рогами, шаңырақ в центре (`KazakhTablePainter`);
  рога у заголовка ГАРБА (`GarbaTitle`, `kazakhHornPath` — тот же рисунок, что в иконке).
  Название на iPhone — «ГАРБА»;
- итог раздачи — окно поверх стола (`DealResultPopup`): «serik сказал РАЗ, взял 2 взятки,
  ПРОИГРАЛ, положил в кон 🪙 9 000» / «ВЫИГРАЛ, забрал из кона», сумма отсчитывается, монета
  летит в кон или из кона, «КОН 9 000 → 18 000»; при пересдаче — почему и кто сколько долил.
  Закрывается нажатием или само со следующей раздачей;
- заявка РАЗ / ДВА / КОН и перехват спецкарты — крупное объявление над столом на 2,6 с
  («Тимур — РАЗ!», `applyAnnouncements`); у главного плашка до конца раздачи «РАЗ · взяток 1»;
  кон — над столом рядом с раздающим (в центре его закрывали карты взятки); стол прокручивается, если не влезает по высоте.

---

## 6. Известные слабые места

Критичные:

1. ~~`dealer/continue` не защищён стадией~~ — **исправлено на этапе 1**
   (вызов вне стадии `dealer_found` отдаёт 409).
2. ~~У карт нет `id`~~ — **исправлено на этапе 0.**
3. **Две модели данных ещё не сведены**: `index.ts` держит свои `Room/GameState`
   (стадии `dealer_found` / `bidding` / `bidding_done`), а в `types.ts` лежит
   `RoomState/Player` с фазами, взятками и коном. Общий у них пока только `Card`.
4. ~~Колода для 5/6/7 неправильная~~ — **исправлено на этапе 0** (состав берётся из
   `config.ts`). ИЗЖОГА и переоткрытие козыря — **сделаны на этапе 5**.
5. **Выбор раздающего идёт по полной 36-карточной колоде**, хотя в игре на 4 живёт 21 карта.
   Правилами состав колоды для вскрытия не оговорён — решить на этапе 1.
6. ~~Посадка за столом не случайная~~ — **исправлено на этапе 1.** `room.players`
   тасуется в `/start` и с этого момента означает **места за столом против часовой
   стрелки**: следующий элемент массива = сосед справа, предыдущий = сосед слева.
7. ~~Порядок торгов не привязан к раздающему~~ — **исправлено на этапе 1.**
8. ~~Открытая карта ошибочно называлась козырем~~ — **исправлено на этапе 2**
   (`openCard` отдельно от `razSuit` / `trumpSuit`).

Прочие:

8. ~~Нет идентификации~~ — **исправлено на этапе 9.1:** игрок определяется по токену.
   Сам аккаунт держится только на токене в телефоне: удалил приложение — аккаунт потерян.
   Привязка телефона / Google — позже.
9. ~~Всё в RAM, нет reconnect~~ — **этап 9.2:** комнаты в базе, пауза и таймер 5 минут.
   Закрытые комнаты пока не выгружаются из памяти до перезапуска сервера.
   Ответ на POST уходит чуть раньше записи в базу: если процесс упадёт в эту долю
   секунды, последнее действие потеряется (деньги при этом не разъедутся — транзакция).
10. ~~Flutter: `playerId` зашит в код~~ — **исправлено на этапе 9.1.**
11. ~~Polling раз в секунду~~ — **заменён на Socket.IO на этапе 8.** Опрос остался только
    запасным — пока сокет отвалился. Ошибки HTTP-запросов по-прежнему глушатся `catch (_) {}`.
12. ~~`GameTableScreen` падает при `game == null`~~ — исправлено: пока `game` нет, крутится загрузка.
13. Анимация вскрытия карт локальная: вошедший позже увидит её с нуля.

---

## 7. Что не реализовано

- вход по ссылке без установленного приложения: код не «доживает» до установки (нужны
  отложенные ссылки и опубликованное приложение) — сейчас его вводят вручную со страницы;
- общий рейтинг грузит всех игроков разом — при тысячах игроков нужен запрос с сортировкой в базе.
