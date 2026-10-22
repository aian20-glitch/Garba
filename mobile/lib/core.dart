// Общее: адрес сервера, аккаунт, связь с сервером (RoomLink), ссылки-приглашения, форматирование.
part of 'main.dart';

// Адрес сервера задаётся при сборке: flutter build apk --dart-define=API_BASE=https://garbagame.kz
const _apiBaseOverride = String.fromEnvironment('API_BASE');
// Без API_BASE: релиз — сервер в интернете (забыли флаг — всё равно рабочая сборка,
// 28.09.2026); отладка — сервер на этом компьютере: Android-эмулятор видит его как
// 10.0.2.2, симулятор iPhone — как localhost.
// Веб-сборка (браузер и Telegram, 07.10.2026) лежит на том же сервере (/play/) —
// сервер там же, откуда открыта страница.
final apiBase = _apiBaseOverride.isNotEmpty
    ? _apiBaseOverride
    : kIsWeb
        ? Uri.base.origin
        : kReleaseMode
        ? 'https://garbagame.kz'
        : Platform.isIOS
            ? 'http://localhost:3000'
            : 'http://10.0.2.2:3000';

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
// Монеты коротко (просьба владельца, 09.10.2026): 900, 11.9k, 1.25M.
// Монеты ходят сотнями — одной цифры после точки обычно хватает; остаток
// при делении кона бывает не круглым — тогда две.
String fmtCoins(int value) {
  final negative = value < 0;
  final v = value.abs();
  String short(num x) {
    var t = x.toStringAsFixed(x * 10 == (x * 10).roundToDouble() ? 1 : 2);
    if (t.contains('.')) t = t.replaceFirst(RegExp(r'\.?0+$'), '');
    return t;
  }
  final text = v < 1000
      ? '$v'
      : v < 1000000
          ? '${short(v / 1000)}k'
          : '${short(v / 1000000)}M';
  return negative ? '−$text' : text;
}

// +500 / −500 для изменений баланса.
String fmtDelta(int value) => value > 0 ? '+${fmtCoins(value)}' : fmtCoins(value);

// Смайлики за столом (RULES.md §14). Тот же набор, что принимает сервер.
const tableReactions = ['👍', '👏', '😂', '😎', '😮', '🤔', '😭', '😡', '🔥', '🤝', '🙈', '🎉'];

// Готовые фразы (09.10.2026) — тот же список, что PHRASES в reactions.ts, менять вместе.
const tablePhrases = [
  'Жми ГОТОВ!',
  'Ходи быстрее!',
  'Раздавай!',
  'Удачи всем!',
  'Хорошая игра!',
  'Вот это ход!',
  'Не повезло…',
  'Повезло тебе!',
  'Ещё партию?',
  'Сейчас вернусь',
  'Спасибо!',
  'Рахмет!',
];

// Фраза живёт над аватаркой дольше смайлика — её надо успеть прочитать.
Duration reactionShowTime(String emoji) =>
    Duration(seconds: isPhrase(emoji) ? 4 : 3);

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
    this.onError,
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
    // Комнаты нет или токен не подошёл — экран должен это показать, а не крутить загрузку.
    _socket.on('room_error', (data) {
      final error = data is Map ? data['error']?.toString() : null;
      if (error != null) onError?.call(error);
    });
    _socket.connect();
  }

  final String roomCode;
  final void Function(Map<String, dynamic> room) onRoom;
  final void Function(String error)? onError;
  late final io.Socket _socket;

  bool get connected => _socket.connected;

  void dispose() => _socket.dispose();
}

// Звуки игры (23.09.2026): сигнал «ГОТОВ», когда комната набралась, и шлепок карты
// при раздаче. Сигнал сгенерирован для проекта, звук карты выбрал владелец
// (oxidvideos «taking playing card», assets/sounds/card.mp3). Беззвучный режим
// телефона уважаем, музыку игрока не выключаем. Звук не завёлся — пишем в журнал,
// игра идёт без него.
class GarbaSounds {
  static AudioPool? _card;
  static AudioPool? _move;
  static final _alert = AudioPlayer();

  static Future<void> init() async {
    try {
      // iPhone: ambient — молчит при беззвучном режиме и не останавливает музыку.
      // Android: звук игры, фокус не забираем — музыка игрока продолжает играть.
      await AudioPlayer.global.setAudioContext(AudioContext(
        iOS: AudioContextIOS(category: AVAudioSessionCategory.ambient),
        android: const AudioContextAndroid(
          contentType: AndroidContentType.sonification,
          usageType: AndroidUsageType.game,
          audioFocus: AndroidAudioFocus.none,
        ),
      ));
      _card = await AudioPool.createFromAsset(path: 'sounds/card.mp3', maxPlayers: 4);
      _move = await AudioPool.createFromAsset(path: 'sounds/move.wav', maxPlayers: 3);
    } catch (e) {
      debugPrint('Звук недоступен: $e');
    }
  }

  static void ready() {
    _alert.play(AssetSource('sounds/ready.wav')).catchError((Object e) {
      debugPrint('Сигнал «ГОТОВ» не проигрался: $e');
    });
  }

  // ГАРБА: барабанная дробь и удар (сгенерирован для проекта, assets/sounds/garba.wav).
  static final _garba = AudioPlayer();
  static void garba() {
    _garba.play(AssetSource('sounds/garba.wav')).catchError((Object e) {
      debugPrint('Звук ГАРБЫ не проигрался: $e');
    });
  }

  // Ход картой — короткий стук (24.09.2026).
  static void move() {
    _move?.start(volume: 0.7).catchError((Object e) {
      debugPrint('Звук хода не проигрался: $e');
      return () async {};
    });
  }

  // Заявка: РАЗ — одна нота, ДВА — две, КОН — три по нарастающей (24.09.2026).
  static final _bid = AudioPlayer();
  static void bid(String bid) {
    final file = switch (bid) { 'РАЗ' => 'raz', 'ДВА' => 'dva', 'КОН' => 'kon', _ => null };
    if (file == null) return;
    _bid.play(AssetSource('sounds/$file.wav')).catchError((Object e) {
      debugPrint('Звук заявки не проигрался: $e');
    });
  }

  // Спецкарта: ×1 — одна нота, дальше с каждым множителем выше и мощнее (24.09.2026).
  static void risk(int risk) {
    final r = risk.clamp(1, 5);
    _bid.play(AssetSource('sounds/risk$r.wav')).catchError((Object e) {
      debugPrint('Звук риска не проигрался: $e');
    });
  }

  // Итог раздачи: главный выиграл — перелив, проиграл — нисходящий звук.
  static final _result = AudioPlayer();
  static void result(bool won) {
    _result.play(AssetSource(won ? 'sounds/win.wav' : 'sounds/lose.wav')).catchError((Object e) {
      debugPrint('Звук итога не проигрался: $e');
    });
  }

  static void card() {
    _card?.start(volume: 0.6).catchError((Object e) {
      debugPrint('Звук карты не проигрался: $e');
      return () async {};
    });
  }
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

// Сервер отвечает короткими стабильными кодами на английском. В интерфейсе игрок
// всегда получает понятную причину и действие, без Exception и сырого JSON.
class ApiFailure implements Exception {
  ApiFailure(this.statusCode, this.code, this.body);

  factory ApiFailure.fromResponse(http.Response response) {
    Object? body;
    String code = '';
    try {
      body = jsonDecode(response.body);
      if (body is Map) code = body['error']?.toString() ?? '';
    } catch (_) {
      body = response.body;
    }
    return ApiFailure(response.statusCode, code, body);
  }

  final int statusCode;
  final String code;
  final Object? body;
}

const _apiErrorMessages = <String, String>{
  'unauthorized': 'Сессия закончилась. Войдите в аккаунт заново.',
  'invalid recovery credentials': 'Код игрока или код восстановления неверный.',
  'too many recovery attempts, try later':
      'Слишком много попыток. Подождите 15 минут и попробуйте снова.',
  'too many accounts, try later':
      'С этого подключения недавно создавали много аккаунтов. Попробуйте позже.',
  'name must be 1 to 20 characters': 'Введите имя длиной от 1 до 20 символов.',
  'invite code not found': 'Код приглашения не найден.',
  'room not found': 'Комната не найдена или уже закрыта.',
  'room is full': 'В комнате уже нет свободных мест.',
  'game already started': 'Игра в этой комнате уже началась.',
  'already in another room': 'Вы уже находитесь в другой комнате.',
  'not enough coins to enter': 'Недостаточно монет для входа в эту комнату.',
  'only the creator can change this': 'Настройки может менять только создатель комнаты.',
  'only creator can start the game': 'Начать игру может только создатель комнаты.',
  'room is not full': 'Сначала дождитесь всех игроков.',
  'player is not in this room': 'Игрок уже вышел из комнаты.',
  'not your turn': 'Сейчас ход другого игрока.',
  'invalid bid': 'Эта ставка сейчас недоступна.',
  'choose a suit for ДВА': 'Выберите масть для ДВА.',
  'card is not in your hand': 'Этой карты уже нет у вас в руке.',
  'card is not allowed by the rules': 'Этой картой сейчас ходить нельзя.',
  'play is not active': 'Розыгрыш уже закончился.',
  'bidding is not active': 'Торги уже закончились.',
  'cards are already dealt': 'Карты уже розданы.',
  'already voted': 'Ваш голос уже принят.',
  'too fast': 'Слишком быстро. Подождите секунду.',
  'image too large': 'Фото слишком большое.',
  'not an image': 'Выбранный файл не похож на фотографию.',
  'finish your game first': 'Сначала завершите текущую игру.',
  'game paused': 'Игра на паузе — ждём игрока.',
  'end vote in progress': 'Идёт голосование «закончить игру» — дождитесь его итога.',
  'cannot propose ending now': 'Закончить игру можно предложить только между раздачами.',
  'can leave only between deals': 'Выйти можно только между раздачами.',
  'cannot concede now': 'Сдаться сейчас нельзя.',
  'too many requests, slow down': 'Слишком много запросов. Подождите немного.',
  'player not found': 'Игрок с таким кодом не найден.',
  'self': 'Это ваш собственный код.',
  'bad amount': 'Сумма — от 100 до 10 000, кратно 100.',
  'not enough coins': 'Недостаточно монет.',
  'already gifted today': 'Сегодня вы уже подарили 10 000 монет. Попробуйте завтра.',
  'over daily limit': 'Это больше, чем можно подарить сегодня (10 000 в сутки).',
  'already friends': 'Вы уже друзья.',
  'request already sent': 'Заявка уже отправлена — ждём ответа.',
  'not a friend': 'Этот игрок не в списке друзей.',
  'seat taken': 'Это место уже заняли.',
  'no free seat': 'Свободных мест нет.',
  'room finished': 'Игра в этой комнате уже закончилась.',
  'not enough coins for this risk': 'Не хватает монет на такой риск.',
  'already claimed today': 'Бонус сегодня уже получен.',
  'name not allowed': 'Такое имя нельзя: без мата и оскорблений.',
  'blocked': 'Нельзя: один из вас заблокировал другого.',
  'already reported': 'Вы уже пожаловались на этого игрока — жалоба на проверке.',
  // Магазин (§17, 13.10.2026).
  'already owned': 'Это у вас уже есть.',
  'not owned': 'Сначала купите это в магазине.',
  'buy it in the shop': 'Этот набор продаётся в магазине.',
  'unknown item': 'Такой вещи в магазине нет — обновите приложение.',
  // Докупить из кошелька за столом (§9.1c, 22.10.2026).
  'cannot request top-up now': 'Докупить можно между раздачами, один раз до следующей раздачи.',
  'bad top-up amount': 'Столько докупить нельзя: не больше, чем у вас в кошельке.',
  'top-up vote in progress': 'Игрок просит докупить — дождитесь ответа стола.',
  'no top-up vote now': 'Просьба докупить уже решена.',
  'you do not vote on this': 'На свою просьбу отвечают другие игроки.',
  // Раздача сыграна — 3 секунды все смотрят открытые карты (§10.8, 22.10.2026).
  'cards on show': 'Все смотрят карты — раздать можно через пару секунд.',
  // Часть выигрыша другому игроку (§11.8, 22.10.2026).
  'cannot share now': 'Отдать часть выигрыша можно только сразу после своей победы, до следующей раздачи, один раз.',
  'bad share amount': 'Столько отдать нельзя: от взноса стола до 10% выигрыша, кратно 100.',
  'bad share recipient': 'Этого игрока уже нет за столом.',
};

String userErrorMessage(Object error, {String fallback = 'Не удалось выполнить действие'}) {
  if (error is ApiFailure) {
    final details = error.body is Map ? error.body as Map : const {};
    if (error.code == 'already in another room' && details['roomId'] != null) {
      return 'Вы уже в комнате #${details['roomId']}. Вернитесь в неё с главного экрана.';
    }
    if (error.code == 'not enough coins to enter') {
      final need = (details['minBalance'] as num?)?.toInt();
      final balance = (details['balance'] as num?)?.toInt();
      if (need != null && balance != null) {
        return 'Для входа нужно ${fmtCoins(need)} монет. У вас ${fmtCoins(balance)}.';
      }
    }
    final known = _apiErrorMessages[error.code];
    if (known != null) return known;
    if (error.statusCode >= 500) return 'Сервер временно недоступен. Попробуйте ещё раз.';
    if (error.statusCode == 404) return 'Нужные данные не найдены.';
    if (error.statusCode == 429) return 'Слишком много попыток. Попробуйте позже.';
    return fallback;
  }
  if (error is TimeoutException) return 'Сервер отвечает слишком долго. Проверьте интернет и повторите.';
  if (error is SocketException || error is http.ClientException) {
    return 'Нет связи с сервером. Проверьте интернет и повторите.';
  }
  final text = error.toString().replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
  if (text.isNotEmpty && !text.startsWith('{') && !text.startsWith('[')) return text;
  return fallback;
}

void expectStatus(http.Response response, Iterable<int> allowed) {
  if (!allowed.contains(response.statusCode)) throw ApiFailure.fromResponse(response);
}

Future<http.Response> apiRequest(Future<http.Response> request) =>
    request.timeout(const Duration(seconds: 15));

void showGarbaError(BuildContext context, Object error, {String? prefix}) {
  final message = userErrorMessage(error);
  final messenger = ScaffoldMessenger.of(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFF7A1F2A),
      content: Text(prefix == null ? message : '$prefix: $message'),
    ),
  );
}

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

// Состояние комнаты старее уже показанного? Сервер нумерует состояния (version растёт
// с каждым сохранением); у старого сервера номера нет — тогда принимаем всё.
bool isStaleRoom(Map<String, dynamic>? current, Map<String, dynamic> next) {
  final have = (current?['version'] as num?)?.toInt();
  final got = (next['version'] as num?)?.toInt();
  return have != null && got != null && got < have;
}

// Имя бота Telegram (без @) — задаётся при веб-сборке: --dart-define=TG_BOT=garbagame_bot.
const tgBot = String.fromEnvironment('TG_BOT');
bool get _tgLinks => Tg.available && tgBot.isNotEmpty;

// В Telegram друг получает ссылку на бота: нажал — игра открылась сразу в комнате.
String roomLink(String roomId) =>
    _tgLinks ? 'https://t.me/$tgBot?startapp=room_$roomId' : '$apiBase/r/$roomId';

String inviteLink(String code) =>
    _tgLinks ? 'https://t.me/$tgBot?startapp=invite_$code' : '$apiBase/i/$code';

// «Поделиться»: в Telegram — его окно выбора чата, на телефоне — системное.
void shareInvite({required String text, required String link, String extra = ''}) {
  if (Tg.available) {
    final q = 'url=${Uri.encodeComponent(link)}&text=${Uri.encodeComponent(text)}';
    Tg.openLink('https://t.me/share/url?$q');
    return;
  }
  SharePlus.instance.share(ShareParams(text: '$text $link${extra.isEmpty ? '' : '\n$extra'}'));
}

class DeepLinks {
  // Ссылка пришла раньше, чем игрок вошёл в аккаунт, — откроем после входа.
  static Uri? pending;
  static StreamSubscription<Uri>? _sub;

  // Подписка ловит и ту ссылку, которой приложение запустили.
  static void start() {
    if (kIsWeb) {
      // Веб и Telegram: ссылка t.me/<бот>?startapp=room_12345 / invite_КОД.
      final param = Tg.startParam ?? '';
      final match = RegExp(r'^(room|invite)_([A-Za-z0-9]+)$').firstMatch(param);
      if (match != null && !_webStartHandled) {
        _webStartHandled = true;
        handle(Uri.parse('garba://${match.group(1)}/${match.group(2)}'));
      }
      return;
    }
    _sub ??= AppLinks().uriLinkStream.listen(handle);
  }

  static bool _webStartHandled = false;

  // Что может прийти в ссылке: номер комнаты — цифры, код игрока — 6 знаков.
  // Всё прочее не пускаем: pathSegments раскодирует %2F и %3F, и чужая ссылка
  // подменила бы адрес запроса — например, вывела бы игрока из игры (28.09.2026).
  static bool validValue(String kind, String value) => kind == 'room'
      ? RegExp(r'^\d{1,10}$').hasMatch(value)
      : RegExp(r'^[A-Za-z0-9]{6}$').hasMatch(value);

  static void handle(Uri uri) {
    final kind = uri.host; // room или invite
    final value = uri.pathSegments.isEmpty ? '' : uri.pathSegments.first;
    final navigator = navigatorKey.currentState;

    if (value.isEmpty || !validValue(kind, value)) return;
    // Аккаунта ещё нет или приложение не готово — запомним ссылку.
    if (Session.token.isEmpty || navigator == null) {
      pending = uri;
      // Экран имени уже открыт — код приглашения подставляется сразу (28.09.2026).
      if (kind == 'invite') onInviteCode?.call(value);
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

  // Экран первого входа слушает приглашения, пришедшие, пока он открыт.
  static void Function(String code)? onInviteCode;

  // Код приглашения из ссылки — подставляется на экране первого входа.
  static String takeInviteCode() {
    final uri = pending;
    if (uri == null || uri.host != 'invite' || uri.pathSegments.isEmpty) return '';
    pending = null;
    final code = uri.pathSegments.first;
    return validValue('invite', code) ? code : '';
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

// Цвет рейтинга по уровню (выбор владельца, 09.10.2026): новичок с 4.0 — белый,
// дальше зелёный, синий, фиолетовый, оранжевый и красный для лучших.
Color ratingColor(Object? value) {
  final r = ((value as num?) ?? 0).toDouble();
  if (r >= 9) return const Color(0xFFFF4D4D); // красный — легенда
  if (r >= 8) return const Color(0xFFFF9A3C); // оранжевый — мастер
  if (r >= 7) return const Color(0xFFC07BFF); // фиолетовый — эксперт
  if (r >= 6) return const Color(0xFF4FA8FF); // синий — опытный
  if (r >= 5) return const Color(0xFF5BD46A); // зелёный — уверенный
  if (r >= 3) return Colors.white; // белый — обычный, старт 4.0
  return const Color(0xFF9E9E9E); // серый — ниже старта
}

// Цвет места на экране «РЕЙТИНГ»: первое — золото, второе — серебро, третье — бронза.
Color topColor(int place) => switch (place) {
      1 => const Color(0xFFFFD34D),
      2 => const Color(0xFFD9DEE3),
      3 => const Color(0xFFE09A5B),
      _ => const Color(0xFF9FD8FF),
    };

// Уровни рейтинга с цветом — для объявления «За столом: один игрок фиолетового
// уровня» (просьба владельца, 11.10.2026, вместо меток «ТОП-N»). Пороги — как в ratingColor.
const ratingLevels = [
  (min: 9.0, name: 'красного'),
  (min: 8.0, name: 'оранжевого'),
  (min: 7.0, name: 'фиолетового'),
  (min: 6.0, name: 'синего'),
  (min: 5.0, name: 'зелёного'),
];

// Только самый высокий цветной уровень за столом и сколько на нём игроков:
// есть красный — «один игрок красного уровня», остальные не называются
// (просьба владельца, 11.10.2026). Белых и серых не считаем; нет цветных — пусто.
List<({String text, Color color})> strongLevels(List players) {
  for (final level in ratingLevels) {
    final count = players.cast<Map>().where((p) => ((p['rating'] as num?) ?? 0) >= level.min).length;
    if (count > 0) {
      return [(text: '${playersCount(count)} ${level.name} уровня', color: ratingColor(level.min))];
    }
  }
  return const [];
}

// «один игрок», «два игрока», «пять игроков» — за столом не больше семи.
String playersCount(int n) {
  const words = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь'];
  final word = n < words.length ? words[n] : '$n';
  return n == 1 ? '$word игрок' : n < 5 ? '$word игрока' : '$word игроков';
}
