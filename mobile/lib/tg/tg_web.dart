// Веб-сборка: связь с Telegram через его скрипт telegram-web-app.js (подключён в
// web/index.html). Вне Telegram (просто браузер) initData пустой — available = false.
import 'dart:js_interop';

@JS('Telegram.WebApp')
external _WebApp? get _webApp;

extension type _WebApp(JSObject _) implements JSObject {
  external String get initData;
  external _InitDataUnsafe get initDataUnsafe;
  external void ready();
  external void expand();
  external void disableVerticalSwipes();
  external void setHeaderColor(String color);
  external void setBackgroundColor(String color);
  external void openTelegramLink(String url);
  external void requestWriteAccess();
}

extension type _InitDataUnsafe(JSObject _) implements JSObject {
  // ignore: non_constant_identifier_names
  external String? get start_param;
}

class Tg {
  static bool get available => (_webApp?.initData ?? '').isNotEmpty;

  // Подписанные Telegram данные запуска — сервер по ним узнаёт игрока.
  static String get initData => _webApp?.initData ?? '';

  // Параметр ссылки t.me/<бот>?startapp=room_12345 / invite_КОД.
  static String? get startParam => available ? _webApp?.initDataUnsafe.start_param : null;

  // Игра готова: во весь экран, цвета как у игры, свайп вниз не закрывает стол.
  static void ready() {
    final app = _webApp;
    if (app == null || !available) return;
    _try(() => app.ready());
    _try(() => app.expand());
    _try(() => app.disableVerticalSwipes());
    _try(() => app.setHeaderColor('#07131B'));
    _try(() => app.setBackgroundColor('#07131B'));
  }

  // Ссылки t.me открываем внутри Telegram (например, «поделиться»).
  static void openLink(String url) => _try(() => _webApp?.openTelegramLink(url));

  // Разрешить боту писать игроку — без этого не дойдут уведомления.
  static void requestWriteAccess() => _try(() => _webApp?.requestWriteAccess());

  // Старый Telegram может не знать новых методов — игре это не мешает.
  static void _try(void Function() fn) {
    try {
      fn();
    } catch (_) {}
  }
}
