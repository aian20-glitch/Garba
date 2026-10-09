# Вопрос Apple — «симуляция азартных игр» и индивидуальный аккаунт (07.10.2026)

Автоматический отказ: рейтинг указывает на Simulated Gambling, а заявку подал индивидуальный
разработчик. Анкету рейтинга **не меняли** (честно: 18+, Simulated Gambling — см. `forms.md`).
Спрашиваем Apple, считается ли ГАРБА симуляцией азартных игр.

Куда: App Store Connect → приложение ГАРБА → App Review (сообщение об отказе) → ответить;
если ответить нельзя — developer.apple.com/contact → App Review.

**Письмо Apple пришло (проверка 06.10.2026, сборка 1.0.0 (5), iPad Air):** «no longer allowing simulated
gambling apps submitted by individual developers… only verified accounts from incorporated business
entities». Причина — «includes simulated gambling features **or** you indicated in the Ratings
section». Предупреждают: повторные подачи с той же проблемой → долгая проверка, потом удаление
из программы. Предлагают App transfer на аккаунт организации. **С этого аккаунта без изменений
не подавать.** Решение: ответить письмом ниже и параллельно начать D-U-N-S на ТОО.

План Б: аккаунт организации на ТОО Серика (D-U-N-S → перевод аккаунта через Membership Support).

```
Hello App Review team,

Our submission of GARBA was automatically stopped because the age rating
indicates Simulated Gambling and the app was submitted by an individual
developer. Before changing anything, we would like to ask for your guidance.

GARBA is a traditional Kazakh trick-taking card game, similar to Whist or
Preference. In each deal one player commits to taking at least 3 of 5 tricks
and plays alone against everyone else; the others try to stop them. The
outcome depends on the players' decisions during the play of the cards.
There are no slot machines, roulette, dice, lotteries, loot boxes or other
casino games in the app.

Players keep score with virtual in-game coins. These coins:
- cannot be purchased: the app has no in-app purchases and no ads;
- cannot be sold, cashed out or exchanged for anything of real value;
- are only given for free: a starting amount, a daily bonus and small gifts
  between friends.

We rated the app 18+ with Simulated Gambling to be cautious, because each
deal is played for a shared pot of these virtual coins.

Could you please tell us whether this content counts as Simulated Gambling?
If it does not, we will correct the age rating and resubmit. If it does, we
will move our membership to our registered company and resubmit as an
organization.

Thank you for your help.

GARBA team
```

## План Б — аккаунт организации (если Apple скажет «да, это simulated gambling»)

Проверено по правилам Apple (developer.apple.com/help/account/membership/program-enrollment):
**ИП не подходит** — sole proprietor / single-person business Apple регистрирует только как
individual. Организация — только юрлицо. **У Серика есть ТОО — его и используем.**

Сроки (оценка, не проверены по свежим источникам): всего ~2–5 недель.

1. **D-U-N-S на ТОО** — developer.apple.com → Account → D-U-N-S Lookup. Название ТОО латиницей
   как в документах + юридический адрес. Нашёлся — дальше; нет — там же заявка (бесплатно,
   от нескольких дней до 2–3 недель — самое медленное место).
2. **Перевод текущего аккаунта** — developer.apple.com/contact → Membership and Account:
   «Please migrate my individual membership (Team ID F8T5C6JBBK) to an organization
   membership for [название ТОО], D-U-N-S [номер]». Карточка «ГАРБА», bundle id
   `kz.garbagame.app`, сборки остаются, $99 второй раз не платить.
3. **Проверка Apple** (3–14 дней): Серик должен иметь право подписи за ТОО (директор или
   доверенность), Apple может позвонить; сайт компании — garbagame.kz (вписать туда ТОО);
   почта на домене (`info@garbagame.kz`) — желательно.
4. **Подать заново** — рейтинг оставить честным (18+, Simulated Gambling). Продавцом в
   App Store станет ТОО.

**Сделать в коде, когда будут данные ТОО (название, БИН, адрес):** вписать ТОО как
ответственного в политику конфиденциальности (`backend/src/privacy.ts`) и на страницу
поддержки, выложить на сервер (`./deploy/deploy.sh garba-vps`). Нужно и для Apple, и для
закона РК о персональных данных. ОКЭД/налоги ТОО — вопрос к бухгалтеру.
