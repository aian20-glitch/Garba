// Общее: адрес сервера, аккаунт, связь с сервером (RoomLink), ссылки-приглашения, форматирование.
part of 'main.dart';

// Адрес сервера задаётся при сборке: flutter build apk --dart-define=API_BASE=https://garba.kz
// Без него — сервер на этом компьютере, как его видит Android-эмулятор (10.0.2.2).
const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');

// Backend присылает масть именем ('hearts'), а не символом.
// Символы живут только здесь, в слое отображения.
const _suitSymbols = <String, String>{
  'hearts': '♥',
  'diamonds': '♦',
  'clubs': '♣',
  'spades': '♠',
};

String suitSymbol(String suit) => _suitSymbols[suit] ?? suit;

const _suitNames = <String, String>{
  'hearts': 'черви',
  'diamonds': 'бубны',
  'clubs': 'крести',
  'spades': 'пики',
};

String suitName(String suit) => _suitNames[suit] ?? suit;

// Названия спецкарт (RULES.md §7).
const _specialNames = <String, String>{
  'A': 'ТУЗ',
  'K': 'КОРОЛЬ',
  'Q': 'ДАМА',
  '6': 'ШЕСТЁРКА',
  '10': 'ДЕСЯТКА',
};

String specialName(String kind) => _specialNames[kind] ?? kind;

// 12500 → «12 500».
String fmtCoins(int value) {
  final negative = value < 0;
  final digits = value.abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(' ');
    buf.write(digits[i]);
  }
  return negative ? '−$buf' : buf.toString();
}

// +500 / −500 для изменений баланса.
String fmtDelta(int value) => value > 0 ? '+${fmtCoins(value)}' : fmtCoins(value);

// Смайлики за столом (RULES.md §14). Тот же набор, что принимает сервер.
const tableReactions = ['👍', '👏', '😂', '😎', '😮', '🤔', '😭', '😡', '🔥', '🤝', '🙈', '🎉'];

bool isRedSuit(String suit) =>
    suit == 'hearts' || suit == 'diamonds' || suit == '♥' || suit == '♦';

// Живые обновления комнаты по Socket.IO (этап 8).
//
// Сервер после каждого действия сам присылает свежее состояние комнаты ('room'),
// поэтому экранам не нужно спрашивать его раз в секунду. Действия по-прежнему
// отправляются обычными HTTP-запросами.
//
// Если соединение пропало, экраны временно возвращаются к опросу (см. [connected]) —
// так игра не зависает, пока Socket.IO переподключается сам.
class RoomLink {
  RoomLink({
    required this.roomCode,
    required this.onRoom,
  }) {
    _socket = io.io(
      apiBase,
      io.OptionBuilder()
          .setTransports(['websocket'])
          // Каждому экрану — своё соединение: иначе библиотека вернёт из кэша
          // сокет, который прошлый экран уже закрыл.
          .enableForceNew()
          .disableAutoConnect()
          .build(),
    );

    // Подписываемся при каждом подключении — в том числе после обрыва.
    _socket.onConnect((_) {
      // Кто смотрит, сервер узнаёт по токену — чужую руку так не получить.
      _socket.emit('watch', {'roomId': roomCode, 'token': Session.token});
    });
    _socket.on('room', (data) {
      if (data is Map) onRoom(Map<String, dynamic>.from(data));
    });
    _socket.connect();
  }

  final String roomCode;
  final void Function(Map<String, dynamic> room) onRoom;
  late final io.Socket _socket;

  bool get connected => _socket.connected;

  void dispose() => _socket.dispose();
}

// Пока сокет подключён, опрос не нужен. Если отвалился — раз в столько опрашиваем сервер.
const fallbackPollInterval = Duration(seconds: 3);

// Аккаунт игрока на этом телефоне (этап 9.1).
//
// При первом запуске игрок вводит имя, сервер создаёт аккаунт и выдаёт токен.
// Токен хранится на телефоне (shared_preferences) и уходит в каждом запросе —
// по нему сервер узнаёт игрока. Свой playerId приложение больше не придумывает.
class Session {
  static String id = '';
  static String name = '';
  static String token = '';

  static const _keyId = 'account.id';
  static const _keyName = 'account.name';
  static const _keyToken = 'account.token';

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    id = prefs.getString(_keyId) ?? '';
    name = prefs.getString(_keyName) ?? '';
    token = prefs.getString(_keyToken) ?? '';
  }

  static Future<void> save(Map<String, dynamic> account) async {
    id = account['id'].toString();
    name = account['name'].toString();
    token = account['token'].toString();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyId, id);
    await prefs.setString(_keyName, name);
    await prefs.setString(_keyToken, token);
  }

  // Сервер не знает этот токен (например, базу стёрли) — заводим аккаунт заново.
  static Future<void> clear() async {
    id = '';
    name = '';
    token = '';
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyId);
    await prefs.remove(_keyName);
    await prefs.remove(_keyToken);
  }
}

// Заголовки для запросов к серверу: JSON и токен.
Map<String, String> authHeaders() => {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ${Session.token}',
    };

// Текст ошибки «уже играешь в другой комнате» — или null, если ошибка другая.
String? busyInRoomMessage(http.Response response) {
  if (response.statusCode != 409) return null;
  try {
    final err = jsonDecode(response.body);
    if (err is Map && err['error'] == 'already in another room') {
      return 'Вы уже в комнате #${err['roomId']}. Играть можно только в одной — '
          'вернитесь в неё с главного экрана.';
    }
  } catch (_) {}
  return null;
}

// Главный экран обновляет баланс, когда на него возвращаются.
final routeObserver = RouteObserver<ModalRoute<void>>();

// Ссылки-приглашения (ТЗ §4, §6, этап 9.7).
//
// Друг получает ссылку вида http://сервер/r/12345 (комната) или /i/КОД (приглашение).
// Страница на сервере открывает приложение ссылкой garba://room/12345 или
// garba://invite/КОД — её и ловит этот код.
final navigatorKey = GlobalKey<NavigatorState>();

String roomLink(String roomId) => '$apiBase/r/$roomId';

String inviteLink(String code) => '$apiBase/i/$code';

class DeepLinks {
  // Ссылка пришла раньше, чем игрок вошёл в аккаунт, — откроем после входа.
  static Uri? pending;
  static StreamSubscription<Uri>? _sub;

  // Подписка ловит и ту ссылку, которой приложение запустили.
  static void start() {
    _sub ??= AppLinks().uriLinkStream.listen(handle);
  }

  static void handle(Uri uri) {
    final kind = uri.host; // room или invite
    final value = uri.pathSegments.isEmpty ? '' : uri.pathSegments.first;
    final navigator = navigatorKey.currentState;

    if (value.isEmpty) return;
    // Аккаунта ещё нет или приложение не готово — запомним ссылку.
    if (Session.token.isEmpty || navigator == null) {
      pending = uri;
      return;
    }

    if (kind == 'room') {
      navigator.push(MaterialPageRoute(builder: (_) => JoinRoomScreen(initialCode: value)));
    } else if (kind == 'invite') {
      // У игрока уже есть аккаунт — бонус за приглашение не начислится,
      // но можно посмотреть карточку пригласившего и добавить его в друзья.
      navigator.push(MaterialPageRoute(builder: (_) => PlayerScreen(code: value)));
    }
  }

  // Код приглашения из ссылки — подставляется на экране первого входа.
  static String takeInviteCode() {
    final uri = pending;
    if (uri == null || uri.host != 'invite' || uri.pathSegments.isEmpty) return '';
    pending = null;
    return uri.pathSegments.first;
  }

  // Игрок вошёл в аккаунт — открываем отложенную ссылку.
  static void openPending() {
    final uri = pending;
    if (uri == null) return;
    pending = null;
    handle(uri);
  }
}

// Рейтинг (ТЗ §38, RULES.md §16): среди друзей и среди всех игроков.
String fmtRating(Object? value) => ((value as num?) ?? 0).toStringAsFixed(1);
