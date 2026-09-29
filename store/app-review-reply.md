# Ответ Apple — Guideline 2.1 «Information Needed» (29.09.2026)

Apple просит видео с настоящего iPhone и 6 письменных ответов. Текст ниже (English) —
**и в ответ в App Store Connect (Resolution Center), и в поле Notes** раздела
App Review Information. Видео прикрепить к ответу.

## Видео (снимать на сборке 1.0.0 (5) из TestFlight, iOS — последняя)

Пункт управления → запись экрана. Начать с главного экрана iPhone, 3–4 минуты:

1. Нажать иконку ГАРБА — запуск.
2. Экран имени: видно правила поведения; ввести имя → «НАЧАТЬ» → окно с кодами → «Я СОХРАНИЛ(А)».
3. Главный экран: ежедневный бонус.
4. «ПРАВИЛА» — пролистать, назад.
5. «СОЗДАТЬ КОМНАТУ» → внизу «СОЗДАТЬ КОМНАТУ» → «ДОБАВИТЬ БОТОВ · ТРЕНИРОВКА» → «ГОТОВ».
6. Сыграть раздачу: заявка, ходы картами, окно итога.
7. **Жалоба и блокировка:** нужен второй живой игрок (у ботов карточки нет). Проще всего —
   рейтинг → «ВСЕ» → нажать на любого игрока → «ПОЖАЛОВАТЬСЯ» → «Оскорбительное имя» →
   сообщение «Жалоба отправлена» → «ЗАБЛОКИРОВАТЬ» → подтвердить → «Вы заблокировали».
   Потом Профиль → «Заблокированные игроки» → он в списке.
   В рейтинге «ВСЕ» видны все настоящие аккаунты (на 29.09: Аян, sss, Ayn, Player1) — жаловаться
   лучше на свой же старый аккаунт, например «Player1». Жалоба настоящая: потом закрыть её
   `./deploy/reports.sh garba-vps resolve <номер>`.
8. Профиль → «Удалить аккаунт» → «УДАЛИТЬ» → приложение вернулось на экран имени.

## Текст ответа

```
Hello, and thank you for the review.

1. SCREEN RECORDING
Attached: a recording made on a physical iPhone running the latest iOS. It starts
with launching the app and shows: account creation (enter a name), the daily bonus,
the rules screen, a full game against computer players, reporting and blocking
another player, and account deletion (Profile → "Удалить аккаунт").

2. PURPOSE AND AUDIENCE
GARBA is a traditional Kazakh trick-taking card game for 4–7 players, adapted for
mobile. Players play with friends or random opponents online, as they would at a
real table. The app is for adults (18+) in Kazakhstan and Russian-speaking
countries who know the game or want to learn it; it keeps a popular folk card
game alive and lets people play together when they are apart. The game uses
virtual coins only: they cannot be bought, sold, withdrawn or exchanged for money
or anything of value. There are no in-app purchases and no ads.

3. HOW TO ACCESS THE APP
No login or demo account is needed. On first launch enter any name and tap
"НАЧАТЬ" (Start) — an account is created instantly.
To play right away with computer players:
  1. Tap "СОЗДАТЬ КОМНАТУ" (Create room), keep the defaults and tap
     "СОЗДАТЬ КОМНАТУ" at the bottom.
  2. In the room tap "ДОБАВИТЬ БОТОВ · ТРЕНИРОВКА" (Add bots · Practice).
  3. Tap "ГОТОВ" (Ready). The game starts; the bots play by themselves.
The rules are in "ПРАВИЛА" on the main screen.
Report / block: tap any player at the table, in the lobby or in "РЕЙТИНГ"
(Rating) → "ПОЖАЛОВАТЬСЯ" (Report) or "ЗАБЛОКИРОВАТЬ" (Block). Blocked players
are listed in Profile → "Заблокированные игроки".
Account deletion: Profile → "Удалить аккаунт" (Delete account).

User-generated content: players only see each other's nicknames and emoji from
a fixed set — there is no text chat, no photos. Users accept the rules of conduct
(no abuse or profanity) on the sign-up screen; profane nicknames are rejected;
any player can be reported and blocked; we review reports within 24 hours and
rename or remove offending accounts.

4. EXTERNAL SERVICES
None. The app talks only to our own game server (https://garbagame.kz), hosted on
a VPS in Kazakhstan. No third-party authentication, payments, analytics,
advertising or AI services are used.

5. REGIONAL DIFFERENCES
None. The app works the same in all regions. The interface is in Russian.

6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
Not applicable. GARBA is a folk card game with no real-money gambling: coins are
virtual, cannot be purchased or cashed out, and the app is rated 18+ for
simulated gambling. The artwork and sounds were made for this app, except one
card sound effect, which is a free sound by oxidvideos.
```
