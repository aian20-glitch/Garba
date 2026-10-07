// Telegram Mini App (07.10.2026): игра открыта внутри Telegram.
// На телефоне (Android, iPhone) Telegram нет — работает заглушка, всё как раньше.
export 'tg_stub.dart' if (dart.library.js_interop) 'tg_web.dart';
