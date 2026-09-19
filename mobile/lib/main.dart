import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:app_links/app_links.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

const apiBase = 'http://10.0.2.2:3000';

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

void main() => runApp(const GarbaApp());

class GarbaApp extends StatelessWidget {
  const GarbaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'ГАРБА',
      theme: ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF07131B),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFD4A94F),
          brightness: Brightness.dark,
        ),
      ),
      navigatorKey: navigatorKey,
      navigatorObservers: [routeObserver],
      home: const StartScreen(),
    );
  }
}

// Первый экран: есть ли на телефоне аккаунт. Нет — спрашиваем имя и заводим.
// Есть — проверяем токен на сервере и идём на главный экран.
class StartScreen extends StatefulWidget {
  const StartScreen({super.key});

  @override
  State<StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<StartScreen> {
  final nameController = TextEditingController();
  // Код друга, который пригласил (ТЗ §4). Необязательно.
  final inviteController = TextEditingController();
  // checking — проверяем сохранённый аккаунт; needName — аккаунта нет, нужно имя.
  bool checking = true;
  bool needName = false;
  bool creating = false;
  String? error;

  @override
  void initState() {
    super.initState();
    DeepLinks.start();
    checkAccount();
  }

  @override
  void dispose() {
    nameController.dispose();
    inviteController.dispose();
    super.dispose();
  }

  Future<void> checkAccount() async {
    setState(() {
      checking = true;
      error = null;
    });

    await Session.load();
    if (Session.token.isEmpty) {
      // Пришли по ссылке-приглашению — код уже заполнен.
      final fromLink = DeepLinks.takeInviteCode();
      if (fromLink.isNotEmpty) inviteController.text = fromLink;
      setState(() {
        checking = false;
        needName = true;
      });
      return;
    }

    try {
      final response = await http.get(Uri.parse('$apiBase/me'), headers: authHeaders());
      if (response.statusCode == 401) {
        // Сервер не знает этот аккаунт — заводим новый.
        await Session.clear();
        setState(() {
          checking = false;
          needName = true;
        });
        return;
      }
      if (response.statusCode != 200) throw Exception(response.body);
      openHome();
    } catch (_) {
      // Сеть недоступна — токен НЕ стираем, просто предлагаем повторить.
      if (!mounted) return;
      setState(() {
        checking = false;
        error = 'Нет связи с сервером';
      });
    }
  }

  Future<void> createAccount() async {
    final name = nameController.text.trim();
    if (name.isEmpty || creating) return;
    setState(() {
      creating = true;
      error = null;
    });

    try {
      final response = await http.post(
        Uri.parse('$apiBase/accounts'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': name,
          if (inviteController.text.trim().isNotEmpty) 'inviteCode': inviteController.text.trim(),
        }),
      );
      if (response.statusCode == 400 && response.body.contains('invite code not found')) {
        setState(() => error = 'Код приглашения не найден. Проверьте его или оставьте поле пустым.');
        return;
      }
      if (response.statusCode != 201) throw Exception(response.body);
      await Session.save(jsonDecode(response.body) as Map<String, dynamic>);
      openHome();
    } catch (e) {
      if (!mounted) return;
      setState(() => error = 'Не удалось создать аккаунт: $e');
    } finally {
      if (mounted) setState(() => creating = false);
    }
  }

  void openHome() {
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => const HomeScreen()),
    );
    // Ссылка на комнату ждала входа в аккаунт — открываем её.
    DeepLinks.openPending();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'ГАРБА',
                style: TextStyle(
                  fontSize: 38,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFFD4A94F),
                ),
              ),
              const Spacer(),
              if (checking)
                const Center(child: CircularProgressIndicator())
              else if (needName) ...[
                const Text(
                  'Как вас зовут?',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Это имя увидят другие игроки за столом.',
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: nameController,
                  maxLength: 20,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Имя игрока',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => createAccount(),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: inviteController,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: 'Код приглашения (если есть)',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(
                  error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ],
              const Spacer(),
              if (!checking && needName)
                GarbaButton(
                  label: creating ? 'СОЗДАЁМ...' : 'НАЧАТЬ',
                  onTap: createAccount,
                )
              else if (!checking && error != null)
                GarbaButton(label: 'ПОВТОРИТЬ', onTap: checkAccount),
            ],
          ),
        ),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with RouteAware {
  // Всё с сервера (GET /me): баланс, незаконченная комната, код игрока,
  // ежедневный бонус (ТЗ §3), дарил ли сегодня (ТЗ §5).
  int? balance;
  String? roomId;
  String code = '';
  int dailyStreak = 0;
  int invitedCount = 0;
  bool claimingBonus = false;
  String? avatar;
  Object? rating;

  @override
  void initState() {
    super.initState();
    refreshMe();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    super.dispose();
  }

  // Вернулись на главный экран — баланс мог измениться.
  @override
  void didPopNext() => refreshMe();

  Future<void> refreshMe() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/me'), headers: authHeaders());
      if (response.statusCode != 200) return;
      final me = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      final daily = Map<String, dynamic>.from(me['daily'] as Map);
      setState(() {
        balance = (me['balance'] as num).toInt();
        roomId = me['roomId']?.toString();
        code = me['code'].toString();
        dailyStreak = (daily['streak'] as num).toInt();
        avatar = me['avatar']?.toString();
        rating = me['rating'];
        invitedCount = (me['invitedCount'] as num?)?.toInt() ?? 0;
      });
      // Первый вход за день — бонус забирается сам (ТЗ §3: «за ежедневный вход»).
      if (daily['claimedToday'] != true) await claimDailyBonus();
    } catch (_) {
      // Нет связи — оставляем то, что уже показано.
    }
  }

  Future<void> claimDailyBonus() async {
    if (claimingBonus) return;
    claimingBonus = true;
    try {
      final response = await http.post(
        Uri.parse('$apiBase/me/daily-bonus'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );
      if (response.statusCode != 200) return;
      final bonus = jsonDecode(response.body) as Map<String, dynamic>;
      final amount = (bonus['amount'] as num).toInt();
      final streak = (bonus['streak'] as num).toInt();
      if (!mounted) return;
      setState(() {
        balance = (bonus['balance'] as num).toInt();
        dailyStreak = streak;
      });
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Ежедневный бонус'),
          content: Text(
            streak == 7
                ? 'День 7/7 — 7 дней подряд!\n+${fmtCoins(amount)} монет'
                : 'День $streak/7\n+${fmtCoins(amount)} монет\n\n'
                    'Заходите каждый день: на 7-й день подряд — 6 000.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('ЗАБРАТЬ'),
            ),
          ],
        ),
      );
    } catch (_) {
      // Нет связи — бонус заберётся при следующем входе.
    } finally {
      claimingBonus = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'ГАРБА',
                    style: TextStyle(
                      fontSize: 38,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFD4A94F),
                    ),
                  ),
                  Text(
                    balance == null ? '🪙 …' : '🪙 ${fmtCoins(balance!)}',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  AvatarView(avatar: avatar, name: Session.name, radius: 24),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          rating == null ? Session.name : '${Session.name} · ⭐ ${fmtRating(rating)}',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                        ),
                        if (code.isNotEmpty)
                          Text(
                            'Ваш код: $code · бонус: день $dailyStreak/7',
                            style: const TextStyle(color: Colors.white70),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Кнопок много — на небольшом экране они прокручиваются.
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Игрок уже сидит в комнате — туда и возвращаемся, новую не начать.
                      if (roomId != null) ...[
                        GarbaButton(
                          label: 'ВЕРНУТЬСЯ В КОМНАТУ #$roomId',
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => LobbyScreen(
                                roomCode: roomId!,
                                currentPlayerId: Session.id,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],
                      GarbaButton(
                        label: 'СОЗДАТЬ КОМНАТУ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const CreateRoomScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ВОЙТИ ПО КОДУ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const JoinRoomScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПОДАРИТЬ МОНЕТЫ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const GiftScreen(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПРИГЛАСИТЬ ДРУГА',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => InviteScreen(code: code, invitedCount: invitedCount),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ДРУЗЬЯ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const FriendsScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'РЕЙТИНГ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const RatingScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПРОФИЛЬ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const ProfileScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПРАВИЛА',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const RulesScreen()),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Игровые монеты являются виртуальными единицами и не имеют денежного эквивалента.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Подарок монет другому игроку по его коду (ТЗ §5): до 1 000, раз в сутки.
// Все проверки — на сервере; экран только подсказывает заранее.
class GiftScreen extends StatefulWidget {
  // Код получателя, если подарок открыт из карточки друга.
  final String? initialCode;

  const GiftScreen({super.key, this.initialCode});

  @override
  State<GiftScreen> createState() => _GiftScreenState();
}

class _GiftScreenState extends State<GiftScreen> {
  final codeController = TextEditingController();
  int amount = 100;
  // Кому уйдёт подарок — имя по коду, чтобы не ошибиться адресатом.
  String? recipientName;
  String? error;
  bool sending = false;
  // С сервера (GET /me): сколько монет, дарил ли сегодня, сидит ли в комнате.
  int balance = 0;
  bool giftSentToday = false;
  bool inRoom = false;
  bool loaded = false;

  @override
  void initState() {
    super.initState();
    codeController.text = widget.initialCode ?? '';
    loadMe();
    if (widget.initialCode != null) findRecipient();
  }

  Future<void> loadMe() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/me'), headers: authHeaders());
      if (response.statusCode != 200) throw Exception(response.body);
      final me = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        balance = (me['balance'] as num).toInt();
        giftSentToday = me['giftSentToday'] == true;
        inRoom = me['roomId'] != null;
        loaded = true;
      });
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  static const _gifts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  static const _errors = <String, String>{
    'player not found': 'Игрока с таким кодом нет',
    'bad amount': 'Сумма — от 100 до 1 000',
    'self': 'Себе подарить нельзя',
    'already gifted today': 'Сегодня вы уже дарили. Следующий подарок — завтра',
    'not enough coins': 'Не хватает монет',
    'finish your game first': 'Сначала доиграйте: пока вы в комнате, дарить нельзя',
  };

  @override
  void dispose() {
    codeController.dispose();
    super.dispose();
  }

  Future<void> findRecipient() async {
    final code = codeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      recipientName = null;
      error = null;
    });
    try {
      final response = await http.get(
        Uri.parse('$apiBase/players/${Uri.encodeComponent(code)}'),
        headers: authHeaders(),
      );
      if (!mounted) return;
      if (response.statusCode == 404) {
        setState(() => error = _errors['player not found']);
        return;
      }
      if (response.statusCode != 200) throw Exception(response.body);
      final player = jsonDecode(response.body) as Map<String, dynamic>;
      setState(() => recipientName = player['name'].toString());
    } catch (e) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  Future<void> sendGift() async {
    if (sending || recipientName == null) return;
    setState(() {
      sending = true;
      error = null;
    });
    try {
      final response = await http.post(
        Uri.parse('$apiBase/gifts'),
        headers: authHeaders(),
        body: jsonEncode({'toCode': codeController.text.trim(), 'amount': amount}),
      );
      final body = jsonDecode(response.body);
      if (response.statusCode != 200) {
        final code = body is Map ? body['error']?.toString() : null;
        setState(() => error = _errors[code] ?? 'Ошибка: ${response.body}');
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Подарок отправлен: $recipientName +${fmtCoins(amount)}')),
      );
      Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!loaded) {
      return Scaffold(
        appBar: AppBar(title: const Text('Подарить монеты')),
        body: Center(child: error == null ? const CircularProgressIndicator() : Text(error!)),
      );
    }

    final blocked = giftSentToday
        ? _errors['already gifted today']
        : inRoom
            ? _errors['finish your game first']
            : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Подарить монеты')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Можно подарить до 1 000 монет, один раз в сутки.',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 16),
              if (blocked != null)
                Text(blocked, style: const TextStyle(color: Colors.orangeAccent, fontSize: 16))
              else ...[
                TextField(
                  controller: codeController,
                  textCapitalization: TextCapitalization.characters,
                  decoration: InputDecoration(
                    labelText: 'Код игрока',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.search),
                      onPressed: findRecipient,
                    ),
                  ),
                  onChanged: (_) {
                    if (recipientName != null) setState(() => recipientName = null);
                  },
                  onSubmitted: (_) => findRecipient(),
                ),
                if (recipientName != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Получатель: $recipientName',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                  ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _gifts.map((n) {
                    return ChoiceChip(
                      label: Text(fmtCoins(n)),
                      selected: amount == n,
                      onSelected: n <= balance ? (_) => setState(() => amount = n) : null,
                    );
                  }).toList(),
                ),
              ],
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(error!, style: const TextStyle(color: Colors.redAccent)),
                ),
              const Spacer(),
              if (blocked == null)
                GarbaButton(
                  label: sending
                      ? 'ОТПРАВЛЯЕМ...'
                      : recipientName == null
                          ? 'ВВЕДИТЕ КОД И НАЙДИТЕ ИГРОКА'
                          : 'ПОДАРИТЬ ${fmtCoins(amount)}',
                  onTap: recipientName == null ? findRecipient : sendGift,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// Приглашение друга (ТЗ §4): друг вводит этот код при первом входе в игру —
// пригласивший получает 1 000 монет.
class InviteScreen extends StatelessWidget {
  final String code;
  final int invitedCount;

  const InviteScreen({super.key, required this.code, required this.invitedCount});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Пригласить друга')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Ваш код приглашения',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              SelectableText(
                code,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 40,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 6,
                  color: Color(0xFFD4A94F),
                ),
              ),
              const SizedBox(height: 8),
              GarbaButton(
                label: 'ОТПРАВИТЬ ССЫЛКУ',
                onTap: () => SharePlus.instance.share(
                  ShareParams(
                    text: 'Играю в ГАРБУ — карточная игра для друзей. '
                        'Заходи по ссылке: ${inviteLink(code)}\n'
                        'При первом входе введи код приглашения $code.',
                  ),
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: code));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Код скопирован')),
                  );
                },
                icon: const Icon(Icons.copy),
                label: const Text('СКОПИРОВАТЬ'),
              ),
              const SizedBox(height: 24),
              const Text(
                'Друг устанавливает ГАРБУ и при первом входе вводит этот код. '
                'Как только он создаст аккаунт — вы получите 1 000 монет.',
                style: TextStyle(fontSize: 16),
              ),
              const SizedBox(height: 16),
              Text(
                'Пришло по вашему коду: $invitedCount',
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              const Text(
                'По этому же коду вам можно подарить монеты.',
                style: TextStyle(color: Colors.white54),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Статистика игрока (ТЗ §2): считает сервер, экран только показывает.
class StatsView extends StatelessWidget {
  final Map<String, dynamic> stats;

  const StatsView({super.key, required this.stats});

  int v(String key) => (stats[key] as num?)?.toInt() ?? 0;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      if (stats.containsKey('rooms')) ('Сыграно комнат', '${v('rooms')}'),
      ('Сыграно партий', '${v('deals')}'),
      ('Был главным', '${v('mains')}'),
      ('Победы', '${v('wins')}'),
      ('Поражения', '${v('losses')}'),
      ('Играл РАЗ', '${v('raz')}'),
      ('Играл ДВА', '${v('dva')}'),
      ('Играл КОН', '${v('kon')}'),
      ('ГАРБА', '${v('garba')}'),
      ('Выиграно монет', fmtCoins(v('coinsWon'))),
      ('Проиграно монет', fmtCoins(v('coinsLost'))),
      ('Максимальный выигрыш', fmtCoins(v('maxWin'))),
      ('Максимальный выигранный риск', v('maxRisk') == 0 ? '—' : '×${v('maxRisk')}'),
    ];
    return Column(
      children: rows
          .map((r) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    Expanded(child: Text(r.$1, style: const TextStyle(color: Colors.white70))),
                    Text(r.$2, style: const TextStyle(fontWeight: FontWeight.w800)),
                  ],
                ),
              ))
          .toList(),
    );
  }
}

// Свой профиль (ТЗ §2). Аватара пока нет, рейтинг — после утверждения формулы (§37).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? profile;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/me/profile'), headers: authHeaders());
      if (response.statusCode != 200) throw Exception(response.body);
      if (!mounted) return;
      setState(() => profile = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = profile;
    return Scaffold(
      appBar: AppBar(title: const Text('Профиль')),
      body: p == null
          ? Center(child: error == null ? const CircularProgressIndicator() : Text(error!))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                  child: GestureDetector(
                    onTap: () async {
                      final avatar = await pickAndUploadAvatar(context);
                      if (avatar != null && mounted) setState(() => p['avatar'] = avatar);
                    },
                    child: Stack(
                      children: [
                        AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 56),
                        const Positioned(
                          right: 0,
                          bottom: 0,
                          child: CircleAvatar(radius: 16, child: Icon(Icons.photo_camera, size: 18)),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                const Center(
                  child: Text('Нажмите на фото, чтобы сменить', style: TextStyle(color: Colors.white54)),
                ),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text('Код игрока: ${p['code']}', style: const TextStyle(color: Colors.white70)),
                const SizedBox(height: 12),
                Text(
                  'Баланс: ${fmtCoins((p['balance'] as num).toInt())} 🪙',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                Text('Друзей: ${p['friendsCount']}', style: const TextStyle(color: Colors.white70)),
                Text(
                  'Рейтинг: ⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                const Divider(height: 32),
                StatsView(stats: Map<String, dynamic>.from(p['stats'] as Map)),
              ],
            ),
    );
  }
}

// Друзья (ТЗ §2): список, добавить по коду, открыть карточку друга.
class FriendsScreen extends StatefulWidget {
  const FriendsScreen({super.key});

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen> {
  final codeController = TextEditingController();
  List<Map<String, dynamic>>? friends;
  String? error;
  bool adding = false;

  static const _errors = <String, String>{
    'player not found': 'Игрока с таким кодом нет',
    'self': 'Это ваш собственный код',
    'already friends': 'Уже в друзьях',
  };

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    codeController.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/friends'), headers: authHeaders());
      if (response.statusCode != 200) throw Exception(response.body);
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        friends = (body['friends'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        error = null;
      });
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  Future<void> addFriend() async {
    final code = codeController.text.trim();
    if (code.isEmpty || adding) return;
    setState(() {
      adding = true;
      error = null;
    });
    try {
      final response = await http.post(
        Uri.parse('$apiBase/friends'),
        headers: authHeaders(),
        body: jsonEncode({'code': code}),
      );
      if (response.statusCode != 201) {
        final body = jsonDecode(response.body);
        final key = body is Map ? body['error']?.toString() : null;
        if (mounted) setState(() => error = _errors[key] ?? 'Ошибка: ${response.body}');
        return;
      }
      codeController.clear();
      await load();
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    } finally {
      if (mounted) setState(() => adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = friends;
    return Scaffold(
      appBar: AppBar(title: const Text('Друзья')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: codeController,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(
                  labelText: 'Код игрока',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.person_add),
                    onPressed: addFriend,
                  ),
                ),
                onSubmitted: (_) => addFriend(),
              ),
              const SizedBox(height: 6),
              const Text(
                'Добавили по коду — дружба сразу у обоих.',
                style: TextStyle(color: Colors.white54),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(error!, style: const TextStyle(color: Colors.redAccent)),
                ),
              const SizedBox(height: 12),
              Expanded(
                child: list == null
                    ? const Center(child: CircularProgressIndicator())
                    : list.isEmpty
                        ? const Center(
                            child: Text(
                              'Друзей пока нет.\nПопросите у друга его код — он есть в профиле.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.white70),
                            ),
                          )
                        : ListView(
                            children: list.map((f) {
                              final stats = Map<String, dynamic>.from(f['stats'] as Map);
                              final roomId = f['roomId']?.toString();
                              return ListTile(
                                leading: AvatarView(avatar: f['avatar']?.toString(), name: f['name'].toString()),
                                title: Text(f['name'].toString()),
                                subtitle: Text(
                                  '⭐ ${fmtRating(f['rating'])} · код ${f['code']} · партий ${stats['deals']} · побед ${stats['wins']}'
                                  '${roomId != null ? ' · сейчас в комнате #$roomId' : ''}',
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () async {
                                  await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => PlayerScreen(code: f['code'].toString()),
                                    ),
                                  );
                                  load();
                                },
                              );
                            }).toList(),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Карточка другого игрока: статистика, дружба, подарок.
class PlayerScreen extends StatefulWidget {
  final String code;

  const PlayerScreen({super.key, required this.code});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  Map<String, dynamic>? player;
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(
        Uri.parse('$apiBase/players/${Uri.encodeComponent(widget.code)}'),
        headers: authHeaders(),
      );
      if (response.statusCode != 200) throw Exception(response.body);
      if (!mounted) return;
      setState(() => player = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  Future<void> toggleFriend(bool isFriend) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final response = isFriend
          ? await http.delete(
              Uri.parse('$apiBase/friends/${Uri.encodeComponent(widget.code)}'),
              headers: authHeaders(),
            )
          : await http.post(
              Uri.parse('$apiBase/friends'),
              headers: authHeaders(),
              body: jsonEncode({'code': widget.code}),
            );
      if (response.statusCode >= 300) throw Exception(response.body);
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Не получилось: $e')));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = player;
    return Scaffold(
      appBar: AppBar(title: Text(p?['name']?.toString() ?? 'Игрок')),
      body: p == null
          ? Center(child: error == null ? const CircularProgressIndicator() : Text(error!))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(child: AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 56)),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
                ),
                Text('Код игрока: ${p['code']}', style: const TextStyle(color: Colors.white70)),
                Text(
                  'Рейтинг: ⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: busy ? null : () => toggleFriend(p['isFriend'] == true),
                        child: Text(p['isFriend'] == true ? 'УДАЛИТЬ ИЗ ДРУЗЕЙ' : 'ДОБАВИТЬ В ДРУЗЬЯ'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => GiftScreen(initialCode: p['code'].toString()),
                          ),
                        ),
                        child: const Text('ПОДАРИТЬ'),
                      ),
                    ),
                  ],
                ),
                const Divider(height: 32),
                StatsView(stats: Map<String, dynamic>.from(p['stats'] as Map)),
              ],
            ),
    );
  }
}

// Аватар игрока (этап 9.5): фото с сервера или первая буква имени.
// avatar — адрес от сервера вида /avatars/<id>?v=<версия> или null.
class AvatarView extends StatelessWidget {
  final String? avatar;
  final String name;
  final double radius;

  const AvatarView({super.key, required this.avatar, required this.name, this.radius = 20});

  @override
  Widget build(BuildContext context) {
    final letter = name.isEmpty ? '?' : name.characters.first.toUpperCase();
    return CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF2A3B45),
      foregroundImage: avatar == null ? null : NetworkImage('$apiBase$avatar'),
      child: Text(letter, style: TextStyle(fontSize: radius * 0.9, fontWeight: FontWeight.w800)),
    );
  }
}

// Выбрать фото в галерее и загрузить как аватар. Телефон сам уменьшает фото
// до 256 точек — сервер принимает не больше 300 КБ. Возвращает новый адрес или null.
Future<String?> pickAndUploadAvatar(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 256,
      maxHeight: 256,
      imageQuality: 85,
    );
    if (picked == null) return null; // передумал
    final bytes = await picked.readAsBytes();
    final response = await http.put(
      Uri.parse('$apiBase/me/avatar'),
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': 'Bearer ${Session.token}',
      },
      body: bytes,
    );
    if (response.statusCode == 413) {
      messenger.showSnackBar(const SnackBar(content: Text('Фото слишком большое')));
      return null;
    }
    if (response.statusCode == 400) {
      messenger.showSnackBar(const SnackBar(content: Text('Это не похоже на фото')));
      return null;
    }
    if (response.statusCode != 200) throw Exception(response.body);
    return (jsonDecode(response.body) as Map)['avatar']?.toString();
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('Не удалось загрузить фото: $e')));
    return null;
  }
}

// Правила для игроков (ТЗ §39: кнопка «ПРАВИЛА»). Текст — по RULES.md.
class RulesScreen extends StatelessWidget {
  const RulesScreen({super.key});

  static const _sections = <(String, String)>[
    (
      'Монеты — не деньги',
      'Все монеты в ГАРБЕ — игровые. Это не деньги: их нельзя купить, обналичить, '
          'продать или обменять на призы. Игра создана только для того, чтобы хорошо '
          'провести время с друзьями.',
    ),
    (
      'Главное правило',
      'Кто сказал РАЗ, ДВА или КОН — становится главным и играет один против всех. '
          'Ему нужно взять 3 взятки из 5.\n\n'
          'Остальные играют вместе против него: их задача — не дать главному взять эти '
          '3 взятки.\n\n'
          'Взял 3 взятки — главный забирает деньги из кона. Не взял — сам кладёт в кон.',
    ),
    (
      'Торги',
      'После раздачи каждый по очереди говорит заявку. Первым — сосед справа от '
          'раздающего, раздающий — последним. Старшинство: РАЗ, потом ДВА, потом КОН. '
          'Сказать заявку ниже уже прозвучавшей нельзя. Все сказали ПАС — пересдача, '
          'и все доливают взнос в кон.',
    ),
    (
      'РАЗ',
      'РАЗ — это масть открытой карты, она становится козырем. При 4 игроках козырь '
          'всегда черви, какая бы карта ни открылась.\n\n'
          'РАЗ — самая сильная заявка. Если РАЗ скажут двое, играют оба, а на втором '
          'РАЗ торги сразу заканчиваются.',
    ),
    (
      'ДВА',
      'ДВА бывает при 5, 6 и 7 игроках. Это другая масть, которая в этом составе тоже '
          'может стать козырем. Кто сказал ДВА, меняет козырь на свою масть.\n\n'
          'При 6 и 7 игроках масть для ДВА игрок выбирает сам, и до начала розыгрыша её '
          'никто не видит.\n\n'
          'Если после ДВА кто-то скажет РАЗ — ДВА не играет. Второго ДВА быть не может. '
          'Когда кон вырос вдвое от базового, ДВА играет на половину кона.',
    ),
    (
      'ИЗЖОГА',
      'ИЗЖОГА — масть, которая в этом составе не может стать козырем (бывает при 5 и 6 '
          'игроках). Если при открытии козыря вышла ИЗЖОГА, карту возвращают в колоду и '
          'открывают следующую — до трёх раз. Три ИЗЖОГИ подряд — пересдача.\n\n'
          'В игре ИЗЖОГА — оружие против главного: когда ходят в ИЗЖОГУ, а у главного '
          'её нет, он обязан бить козырем и тратить свои сильные карты.',
    ),
    (
      'КОН',
      'КОН — заявка для случая, когда кон сильно вырос и на РАЗ уже не у всех хватает '
          'денег. Кнопка появляется, когда кон дорос до порога, который выбрал создатель '
          'комнаты.\n\n'
          'Кто сказал КОН, играет не на весь кон, а только на базовый (число игроков × '
          'взнос). КОН — самая младшая заявка: если потом кто-то скажет РАЗ или ДВА, '
          'КОН не играет. Козырь — по РАЗ или по ДВА — он называет после торгов.',
    ),
    (
      'Как ходить',
      'Первый во взятке ходит любой картой. Остальные обязаны:\n'
          '1. Положить карту той же масти, если она есть.\n'
          '2. Если этой масти нет — обязательно положить козырь.\n'
          '3. Только если нет ни масти, ни козыря — можно положить любую карту.\n\n'
          'Каким козырем бить, игрок решает сам. Взятку забирает старший козырь, '
          'а если козырей не было — старшая карта масти хода. Кто взял взятку, '
          'тот ходит следующим.',
    ),
    (
      'ГАРБА',
      'ГАРБА — дама, король и туз козыря у одного игрока. Главный с ГАРБОЙ '
          'выигрывает сразу, без розыгрыша.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Правила')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: _sections
            .map((s) => Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.$1,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                          color: Color(0xFFD4A94F),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(s.$2, style: const TextStyle(fontSize: 16, height: 1.35)),
                    ],
                  ),
                ))
            .toList(),
      ),
    );
  }
}

// Рейтинг (ТЗ §38, RULES.md §16): среди друзей и среди всех игроков.
String fmtRating(Object? value) => ((value as num?) ?? 0).toStringAsFixed(1);

class RatingScreen extends StatelessWidget {
  const RatingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: _RatingAppBar(),
        body: TabBarView(
          children: [
            RatingList(scope: 'friends'),
            RatingList(scope: 'all'),
          ],
        ),
      ),
    );
  }
}

class _RatingAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _RatingAppBar();

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight + kTextTabBarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: const Text('Рейтинг'),
      actions: [
        IconButton(
          icon: const Icon(Icons.help_outline),
          onPressed: () => showDialog<void>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Как считается рейтинг'),
              content: const SingleChildScrollView(
                child: Text(
                  'Рейтинг от 0 до 10, новичок начинает с 4.0.\n\n'
                  'Опыт: +0.01 за каждую сыгранную партию, до 2.0.\n\n'
                  'Главный выиграл: +0.05 × риск. Проиграл: −0.03 × риск. ГАРБА: ещё +0.10.\n'
                  'Не дали главному взять 3 взятки: каждому +0.02.\n\n'
                  'После комнаты: победитель +0.50, в плюсе +0.20, в минусе −0.20, '
                  'проиграл больше всех −0.40.\n'
                  'Ушёл из игры и из-за тебя закрылась комната: −1.0.\n\n'
                  'Обыграл сильных — баллов больше. За большим столом прибавка больше. '
                  'Чем выше рейтинг, тем медленнее он растёт — 10 получить очень трудно.',
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('ПОНЯТНО'),
                ),
              ],
            ),
          ),
        ),
      ],
      bottom: const TabBar(tabs: [Tab(text: 'ДРУЗЬЯ'), Tab(text: 'ВСЕ ИГРОКИ')]),
    );
  }
}

class RatingList extends StatefulWidget {
  final String scope;

  const RatingList({super.key, required this.scope});

  @override
  State<RatingList> createState() => _RatingListState();
}

class _RatingListState extends State<RatingList> {
  Map<String, dynamic>? board;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(
        Uri.parse('$apiBase/rating?scope=${widget.scope}'),
        headers: authHeaders(),
      );
      if (response.statusCode != 200) throw Exception(response.body);
      if (!mounted) return;
      setState(() => board = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = board;
    if (b == null) {
      return Center(child: error == null ? const CircularProgressIndicator() : Text(error!));
    }
    final players = (b['players'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final myPlace = b['myPlace'];
    final total = b['total'];

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            widget.scope == 'friends'
                ? 'Ваше место среди друзей: $myPlace из $total'
                : 'Ваше место среди всех игроков: $myPlace из $total',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
        ),
        if (widget.scope == 'friends' && total == 1)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Добавьте друзей по коду — и увидите, кто из вас сильнее.',
              style: TextStyle(color: Colors.white54),
            ),
          ),
        Expanded(
          child: ListView(
            children: players.map((p) {
              final isMe = p['me'] == true;
              return ListTile(
                tileColor: isMe ? const Color(0x33D4A94F) : null,
                leading: SizedBox(
                  width: 76,
                  child: Row(
                    children: [
                      SizedBox(
                        width: 28,
                        child: Text('${p['place']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      ),
                      AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString()),
                    ],
                  ),
                ),
                title: Text(isMe ? '${p['name']} (вы)' : p['name'].toString()),
                trailing: Text(
                  '⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                onTap: isMe
                    ? null
                    : () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => PlayerScreen(code: p['code'].toString())),
                        ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}

class CreateRoomScreen extends StatefulWidget {
  const CreateRoomScreen({super.key});

  @override
  State<CreateRoomScreen> createState() => _CreateRoomScreenState();
}

class _CreateRoomScreenState extends State<CreateRoomScreen> {
  int capacity = 5;
  // Взнос и лимит пустых раздач выбирает создатель (RULES.md §9.1, §9.3).
  int ante = 100;
  int emptyLimit = 5;
  // КОН открывается, когда кон достигнет базового × konThreshold (RULES.md §6.7).
  int konThreshold = 10;
  // Минимум денег для входа: 1 000…10 000, не меньше взноса × 10 (RULES.md §9.1a).
  int minBalance = 1000;
  bool loading = false;

  int get lowestEntry => ante * 10 < 1000 ? 1000 : ante * 10;

  void setAnte(int value) {
    setState(() {
      ante = value;
      // Подняли взнос — минимум для входа подтягивается следом.
      if (minBalance < lowestEntry) minBalance = lowestEntry;
    });
  }

  Future<void> createRoom() async {
    if (loading) return;
    setState(() => loading = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms'),
        headers: authHeaders(),
        body: jsonEncode({
          'capacity': capacity,
          'ante': ante,
          'emptyLimit': emptyLimit,
          'konThreshold': konThreshold,
          'minBalance': minBalance,
        }),
      );

      final busy = busyInRoomMessage(response);
      if (busy != null) throw Exception(busy);

      if (response.statusCode == 403) {
        final err = jsonDecode(response.body);
        if (err is Map && err['error'] == 'not enough coins to enter') {
          throw Exception(
            'Недостаточно монет: минимум комнаты ${fmtCoins((err['minBalance'] as num).toInt())}, '
            'у вас ${fmtCoins((err['balance'] as num).toInt())}',
          );
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: data['id'].toString(),
            currentPlayerId: Session.id,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка создания комнаты: $e')),
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Создать комнату')),
      // Настроек четыре блока — на небольшом экране они не влезут,
      // поэтому прокручиваем их, а кнопка создания всегда видна внизу.
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Количество игроков',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [4, 5, 6, 7].map((n) {
                return ChoiceChip(
                  label: Text('$n игроков'),
                  selected: capacity == n,
                  onSelected: (_) => setState(() => capacity = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 24),
            const Text(
              'Взнос в кон',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
                  .map((n) {
                return ChoiceChip(
                  label: Text('$n'),
                  selected: ante == n,
                  onSelected: (_) => setAnte(n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Базовый кон: $capacity × $ante = ${capacity * ante} монет',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Минимум монет для входа',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]
                  .map((n) {
                // Меньше взноса × 10 выбрать нельзя — кнопка выключена.
                final allowed = n >= lowestEntry;
                return ChoiceChip(
                  label: Text(fmtCoins(n)),
                  selected: minBalance == n,
                  onSelected: allowed ? (_) => setState(() => minBalance = n) : null,
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Кто меньше ${fmtCoins(minBalance)}, в комнату не войдёт. '
              'При взносе $ante — не меньше ${fmtCoins(lowestEntry)}.',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Лимит пустых раздач подряд',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [3, 4, 5, 6, 7, 8, 9, 10].map((n) {
                return ChoiceChip(
                  label: Text('$n'),
                  selected: emptyLimit == n,
                  onSelected: (_) => setState(() => emptyLimit = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            const Text(
              'Сколько раз подряд все доливают в кон, если никто не взялся играть',
              style: TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Когда открывается КОН',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [3, 4, 5, 6, 7, 8, 9, 10].map((n) {
                return ChoiceChip(
                  label: Text('×$n'),
                  selected: konThreshold == n,
                  onSelected: (_) => setState(() => konThreshold = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Играть на базовый кон можно, когда кон дорастёт до '
              '${fmtCoins(capacity * ante * konThreshold)}',
              style: const TextStyle(color: Colors.white60),
            ),
          ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: GarbaButton(
                label: loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ',
                onTap: createRoom,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class JoinRoomScreen extends StatefulWidget {
  // Номер комнаты из ссылки-приглашения — тогда входим сразу.
  final String? initialCode;

  const JoinRoomScreen({super.key, this.initialCode});

  @override
  State<JoinRoomScreen> createState() => _JoinRoomScreenState();
}

class _JoinRoomScreenState extends State<JoinRoomScreen> {
  final roomController = TextEditingController();
  bool loading = false;

  @override
  void initState() {
    super.initState();
    final code = widget.initialCode;
    if (code != null && code.isNotEmpty) {
      roomController.text = code;
      WidgetsBinding.instance.addPostFrameCallback((_) => joinRoom());
    }
  }

  Future<void> joinRoom() async {
    final roomId = roomController.text.trim();

    if (roomId.isEmpty || loading) return;

    setState(() => loading = true);

    try {
      // Кто входит — сервер знает по токену, имя берётся из аккаунта.
      final response = await http.post(
        Uri.parse('$apiBase/rooms/$roomId/join'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );

      final busy = busyInRoomMessage(response);
      if (busy != null) throw Exception(busy);

      // Не хватает монет на минимум комнаты (RULES.md §9.1a) — говорим прямо.
      if (response.statusCode == 403) {
        final err = jsonDecode(response.body);
        if (err is Map && err['error'] == 'not enough coins to enter') {
          throw Exception(
            'Недостаточно монет для входа: нужно ${fmtCoins((err['minBalance'] as num).toInt())}, '
            'у вас ${fmtCoins((err['balance'] as num).toInt())}',
          );
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: roomId,
            currentPlayerId: Session.id,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка входа: $e')),
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    roomController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Войти по коду')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: roomController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Код комнаты',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Вы войдёте как ${Session.name}',
              style: const TextStyle(color: Colors.white70),
            ),
            const Spacer(),
            GarbaButton(
              label: loading ? 'ВХОДИМ...' : 'ВОЙТИ',
              onTap: joinRoom,
            ),
          ],
        ),
      ),
    );
  }
}

class LobbyScreen extends StatefulWidget {
  final String roomCode;
  final String currentPlayerId;

  const LobbyScreen({
    super.key,
    required this.roomCode,
    required this.currentPlayerId,
  });

  @override
  State<LobbyScreen> createState() => _LobbyScreenState();
}

class _LobbyScreenState extends State<LobbyScreen> {
  Timer? timer;
  late final RoomLink link;
  Map<String, dynamic>? room;
  bool starting = false;
  bool firstLoad = true;
  bool moved = false;

  @override
  void initState() {
    super.initState();
    // Обновления приходят сами по сокету; опрос — только пока сокет отвалился.
    link = RoomLink(
      roomCode: widget.roomCode,
      onRoom: applyRoom,
    );
    refreshRoom();
    timer = Timer.periodic(fallbackPollInterval, (_) {
      if (!link.connected) refreshRoom();
    });
  }

  String roomUrl() =>
      '$apiBase/rooms/${widget.roomCode}';

  Future<void> refreshRoom() async {
    try {
      final response = await http.get(Uri.parse(roomUrl()), headers: authHeaders());
      if (response.statusCode == 200) {
        applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
      }
    } catch (_) {
      if (mounted && firstLoad) {
        setState(() => firstLoad = false);
      }
    }
  }

  // Свежее состояние комнаты — по сокету или по HTTP.
  void applyRoom(Map<String, dynamic> data) {
    if (!mounted) return;

    setState(() {
      room = data;
      firstLoad = false;
    });

    if (data['status']?.toString() == 'started' &&
        data['game'] is Map &&
        !moved) {
      moved = true;
      timer?.cancel();

      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => DealerSelectionScreen(
              roomCode: widget.roomCode,
              currentPlayerId: widget.currentPlayerId,
            ),
          ),
        );
      });
    }
  }

  Future<void> startGame() async {
    if (starting) return;
    setState(() => starting = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/start'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось начать игру: $e')),
      );
    } finally {
      if (mounted) setState(() => starting = false);
    }
  }

  // Выйти из комнаты, пока игра не началась. Если выходит создатель —
  // сервер закрывает комнату для всех.
  Future<void> leaveRoom() async {
    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/leave'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }
      if (!mounted) return;
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось выйти: $e')),
      );
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (room == null) {
      return Scaffold(
        appBar: AppBar(title: Text('Комната #${widget.roomCode}')),
        body: Center(
          child: firstLoad
              ? const CircularProgressIndicator()
              : const Text('Нет связи с сервером'),
        ),
      );
    }

    // Создатель вышел до начала игры — комнаты больше нет.
    if (room!['status']?.toString() == 'finished' && room!['game'] == null) {
      return Scaffold(
        appBar: AppBar(title: Text('Комната #${widget.roomCode}')),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              const Text(
                'Создатель закрыл комнату',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              ),
              const Spacer(),
              GarbaButton(
                label: 'В ГЛАВНОЕ МЕНЮ',
                onTap: () => Navigator.pop(context),
              ),
            ],
          ),
        ),
      );
    }

    final capacity = (room!['capacity'] as num).toInt();
    final creatorId = room!['creatorId'].toString();
    final players = (room!['players'] as List)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    final isCreator = creatorId == widget.currentPlayerId;
    final isFull = players.length == capacity;

    return Scaffold(
      appBar: AppBar(title: Text('Комната #${widget.roomCode}')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${players.length} / $capacity игроков',
              style: const TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Код комнаты: ${widget.roomCode}',
              style: const TextStyle(
                fontSize: 20,
                color: Color(0xFFD4A94F),
                fontWeight: FontWeight.w700,
              ),
            ),
            // Условия комнаты — их выбрал создатель.
            if (room!['settings'] is Map)
              Builder(builder: (_) {
                final s = Map<String, dynamic>.from(room!['settings'] as Map);
                int v(String k) => (s[k] as num?)?.toInt() ?? 0;
                return Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'Взнос ${fmtCoins(v('ante'))} · вход от ${fmtCoins(v('minBalance'))}\n'
                    'Лимит пустых раздач ${v('emptyLimit')} · КОН с ×${v('konThreshold')}',
                    style: const TextStyle(color: Colors.white60),
                  ),
                );
              }),
            const SizedBox(height: 20),
            // Список прокручивается: при 6–7 игроках он не влезает, и кнопки
            // «НАЧАТЬ ИГРУ» / «ЗАКРЫТЬ КОМНАТУ» уходили за край экрана.
            Expanded(
              child: ListView(
                children: [
                  ...players.map((p) {
                    final isOwner = p['id'].toString() == creatorId;
                    return PlayerTile(
                      name: p['name'].toString(),
                      subtitle: '${isOwner ? 'Создатель' : 'Игрок'} • ⭐ ${fmtRating(p['rating'])}',
                      ready: true,
                      avatar: p['avatar']?.toString(),
                    );
                  }),
                  ...List.generate(
                    capacity - players.length,
                    (_) => const PlayerTile(
                      name: 'Свободное место',
                      subtitle: 'Ожидание игрока',
                      ready: false,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => SharePlus.instance.share(
                ShareParams(
                  text: 'Играем в ГАРБУ! Заходи в комнату #${widget.roomCode}: '
                      '${roomLink(widget.roomCode)}\n'
                      'Если ссылка не открылась — введи код комнаты ${widget.roomCode} в приложении.',
                ),
              ),
              icon: const Icon(Icons.share),
              label: const Text('ПРИГЛАСИТЬ'),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: isCreator && isFull ? startGame : null,
              icon: const Icon(Icons.play_arrow),
              label: Text(starting ? 'ЗАПУСК...' : 'НАЧАТЬ ИГРУ'),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: leaveRoom,
              child: Text(isCreator ? 'ЗАКРЫТЬ КОМНАТУ' : 'ВЫЙТИ ИЗ КОМНАТЫ'),
            ),
          ],
        ),
      ),
    );
  }
}

class DealerSelectionScreen extends StatefulWidget {
  final String roomCode;
  final String currentPlayerId;

  const DealerSelectionScreen({
    super.key,
    required this.roomCode,
    required this.currentPlayerId,
  });

  @override
  State<DealerSelectionScreen> createState() =>
      _DealerSelectionScreenState();
}

class _DealerSelectionScreenState extends State<DealerSelectionScreen> {
  Timer? pollTimer;
  Timer? revealTimer;
  late final RoomLink link;
  Map<String, dynamic>? room;
  int visibleCount = 0;
  bool continuing = false;
  bool moved = false;

  @override
  void initState() {
    super.initState();
    // Обновления приходят сами по сокету; опрос — только пока сокет отвалился.
    link = RoomLink(
      roomCode: widget.roomCode,
      onRoom: applyRoom,
    );
    refreshRoom();
    pollTimer = Timer.periodic(fallbackPollInterval, (_) {
      if (!link.connected) refreshRoom();
    });
  }

  String roomUrl() =>
      '$apiBase/rooms/${widget.roomCode}';

  Future<void> refreshRoom() async {
    try {
      final response = await http.get(Uri.parse(roomUrl()), headers: authHeaders());
      if (response.statusCode != 200) return;
      applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {}
  }

  // Свежее состояние комнаты — по сокету или по HTTP.
  void applyRoom(Map<String, dynamic> data) {
    {
      if (!mounted) return;

      setState(() => room = data);

      final game = data['game'];
      if (game is Map) {
        final revealLog = (game['revealLog'] as List?) ?? const [];

        if (revealTimer == null && visibleCount < revealLog.length) {
          revealTimer = Timer.periodic(
            const Duration(milliseconds: 900),
            (timer) {
              if (!mounted) return;

              if (visibleCount >= revealLog.length) {
                timer.cancel();
                revealTimer = null;
                return;
              }

              setState(() => visibleCount++);

              if (visibleCount >= revealLog.length) {
                timer.cancel();
                revealTimer = null;
              }
            },
          );
        }

        // Карты розданы — уходим к столу. Не только на 'bidding': если при первой
        // же раздаче трижды вышла ИЗЖОГА, стадия сразу 'awaiting_deal' (пересдача),
        // и без этого все остались бы на экране раздающего.
        final stage = game['stage']?.toString();
        if (stage != null && stage != 'dealer_found' && !moved) {
          moved = true;
          pollTimer?.cancel();
          revealTimer?.cancel();

          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                builder: (_) => GameTableScreen(
                  roomCode: widget.roomCode,
                  currentPlayerId: widget.currentPlayerId,
                ),
              ),
            );
          });
        }
      }
    }
  }

  Future<void> continueGame() async {
    if (continuing) return;
    setState(() => continuing = true);

    try {
      final response = await http.post(
        Uri.parse(
          '$apiBase/rooms/${widget.roomCode}/dealer/continue',
        ),
        headers: authHeaders(),
        body: jsonEncode({}),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось продолжить: $e')),
      );
    } finally {
      if (mounted) setState(() => continuing = false);
    }
  }

  @override
  void dispose() {
    pollTimer?.cancel();
    revealTimer?.cancel();
    link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = room;
    if (data == null) {
      return Scaffold(
        appBar: AppBar(title: Text('Комната #${widget.roomCode}')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final game = Map<String, dynamic>.from(data['game'] as Map);
    final dealerName = game['dealerName'].toString();

    // Карты сдаёт раздающий, а не создатель комнаты.
    final isDealer = game['dealerId'].toString() == widget.currentPlayerId;
    final reveals = ((game['revealLog'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    final shown = reveals.take(visibleCount).toList();
    final finished = reveals.isNotEmpty && visibleCount >= reveals.length;
    final current = shown.isNotEmpty ? shown.last : null;

    return Scaffold(
      appBar: AppBar(title: Text('Комната #${widget.roomCode}')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                finished
                    ? 'Первый Туз найден!'
                    : visibleCount == 0
                        ? 'Определяем раздающего'
                        : 'Открываем карты...',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                finished
                    ? 'Раздающий определён'
                    : 'Карты открываются по очереди до первого Туза',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white60),
              ),
              const SizedBox(height: 20),
              Expanded(
                child: current == null
                    ? const Center(
                        child: Icon(
                          Icons.style,
                          size: 110,
                          color: Color(0xFFD4A94F),
                        ),
                      )
                    : Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            current['playerName'].toString(),
                            style: const TextStyle(
                              fontSize: 21,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 14),
                          PlayingCardView(
                            rank: current['rank'].toString(),
                            suit: current['suit'].toString(),
                            glow: current['rank'].toString() == 'A',
                          ),
                          const SizedBox(height: 12),
                          Text(
                            current['rank'].toString() == 'A'
                                ? 'ТУЗ!'
                                : 'Ищем первого Туза...',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
              ),
              if (finished) ...[
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        const Text(
                          'РАЗДАЮЩИЙ',
                          style: TextStyle(color: Colors.white54),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          dealerName,
                          style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFD4A94F),
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text('Сдаёт карты и говорит последним в торгах'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: isDealer && !continuing ? continueGame : null,
                  child: Text(
                    continuing
                        ? 'РАЗДАЁМ...'
                        : isDealer
                            ? 'ОТКРЫТЬ КОЗЫРЬ И РАЗДАТЬ'
                            : 'РАЗДАЁТ $dealerName',
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class GameTableScreen extends StatefulWidget {
  final String roomCode;
  final String currentPlayerId;

  const GameTableScreen({
    super.key,
    required this.roomCode,
    required this.currentPlayerId,
  });

  @override
  State<GameTableScreen> createState() => _GameTableScreenState();
}

class _GameTableScreenState extends State<GameTableScreen> {
  Timer? timer;
  Map<String, dynamic>? room;
  bool sendingBid = false;
  bool dealing = false;
  bool sendingCard = false;
  bool voting = false;
  bool choosingKonTrump = false;
  bool sendingSpecial = false;
  // Пауза из-за отключения (RULES.md §13): когда пришло последнее состояние паузы —
  // от него на экране идёт обратный отсчёт, раз в секунду.
  DateTime pauseReceivedAt = DateTime.now();
  Timer? pauseTicker;
  // Смайлики (RULES.md §14): какой смайлик сейчас висит у игрока, и номер
  // последней показанной реакции — старые при входе в комнату не всплывают.
  final Map<String, String> flyingEmoji = {};
  // Объявление «Тимур — РАЗ!» крупно над столом на пару секунд: заявку легко пропустить.
  ({int id, String text})? announcement;
  int announcementSeq = 0;
  int seenBids = 0;
  String seenSpecial = '';
  bool firstAnnounce = true;
  // Итог раздачи всплывает поверх стола; закрытый нажатием больше не показываем.
  String? dismissedResultKey;
  int lastReactionId = 0;
  bool firstReactions = true;
  bool sendingReaction = false;

  late final RoomLink link;

  @override
  void initState() {
    super.initState();
    // Обновления приходят сами по сокету; опрос — только пока сокет отвалился.
    link = RoomLink(
      roomCode: widget.roomCode,
      onRoom: applyRoom,
    );
    refreshRoom();
    timer = Timer.periodic(fallbackPollInterval, (_) {
      if (!link.connected) refreshRoom();
    });
  }

  String roomUrl() =>
      '$apiBase/rooms/${widget.roomCode}';

  Future<void> refreshRoom() async {
    try {
      final response = await http.get(Uri.parse(roomUrl()), headers: authHeaders());
      if (response.statusCode == 200) {
        applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
      }
    } catch (_) {}
  }

  // Свежее состояние комнаты — по сокету или по HTTP.
  void applyRoom(Map<String, dynamic> data) {
    if (!mounted) return;
    setState(() {
      room = data;
      pauseReceivedAt = DateTime.now();
    });

    applyReactions((data['reactions'] as List?) ?? const []);
    applyAnnouncements(data);

    // Пока пауза — перерисовываем раз в секунду, чтобы шёл обратный отсчёт.
    if (data['pause'] is Map) {
      pauseTicker ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else {
      pauseTicker?.cancel();
      pauseTicker = null;
    }
  }

  // Новые заявки (кроме ПАС) и перехват спецкарты — крупным объявлением над столом.
  // При первом открытии комнаты старое только запоминаем.
  void applyAnnouncements(Map<String, dynamic> data) {
    final game = data['game'];
    if (game is! Map) return;
    String nameOf(String id) {
      for (final p in (data['players'] as List? ?? const [])) {
        if ((p as Map)['id'].toString() == id) return p['name'].toString();
      }
      return '';
    }

    String? text;
    final bids = (game['bids'] as List?) ?? const [];
    if (bids.length < seenBids) seenBids = 0; // новая раздача — заявки с нуля
    for (var i = seenBids; i < bids.length; i++) {
      final b = Map<String, dynamic>.from(bids[i] as Map);
      if (b['bid'] != 'ПАС') text = '${nameOf(b['playerId'].toString())} — ${b['bid']}!';
    }
    seenBids = bids.length;

    final special = game['special'];
    final holder = special is Map ? special['holderId']?.toString() : null;
    final specialKey = holder == null ? '' : '$holder-${special['risk']}';
    if (specialKey != seenSpecial && holder != null) {
      text = '${nameOf(holder)} — '
          '${specialName(special['kind'].toString())} ×${special['risk']}!';
    }
    seenSpecial = specialKey;

    if (firstAnnounce) {
      firstAnnounce = false;
      return;
    }
    if (text == null) return;
    final id = ++announcementSeq;
    setState(() => announcement = (id: id, text: text!));
    Timer(const Duration(milliseconds: 2600), () {
      if (mounted && announcement?.id == id) setState(() => announcement = null);
    });
  }

  // Новые смайлики всплывают у игрока на 3 секунды. Те, что пришли при первом
  // открытии комнаты, только запоминаем — они уже отжили своё у других.
  void applyReactions(List reactions) {
    for (final raw in reactions) {
      final r = Map<String, dynamic>.from(raw as Map);
      final id = (r['id'] as num).toInt();
      if (id <= lastReactionId) continue;
      lastReactionId = id;
      if (firstReactions) continue;

      final playerId = r['playerId'].toString();
      final emoji = r['emoji'].toString();
      flyingEmoji[playerId] = emoji;
      Timer(const Duration(seconds: 3), () {
        if (!mounted) return;
        setState(() {
          if (flyingEmoji[playerId] == emoji) flyingEmoji.remove(playerId);
        });
      });
    }
    firstReactions = false;
  }

  // Отправить смайлик. Сервер сам решает, можно ли сейчас (§14).
  Future<void> sendReaction(String emoji) async {
    if (sendingReaction) return;
    setState(() => sendingReaction = true);
    try {
      await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/react'),
        headers: authHeaders(),
        body: jsonEncode({'emoji': emoji}),
      );
    } catch (_) {
      // Не дошло — не беда, это просто смайлик.
    } finally {
      if (mounted) setState(() => sendingReaction = false);
    }
  }

  // suit — масть для ДВА при 6 и 7 игроках (RULES.md §6.3).
  Future<void> sendBid(String bid, {String? suit}) async {
    if (sendingBid) return;
    setState(() => sendingBid = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/bid'),
        headers: authHeaders(),
        body: jsonEncode({
          'bid': bid,
          if (suit != null) 'suit': suit,
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка хода: $e')),
      );
    } finally {
      if (mounted) setState(() => sendingBid = false);
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    pauseTicker?.cancel();
    link.dispose();
    super.dispose();
  }

  // Раздача после пересдачи. Кнопка есть только у раздающего,
  // сервер всё равно проверяет это сам.
  Future<void> dealCards() async {
    if (dealing) return;
    setState(() => dealing = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/dealer/continue'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось раздать: $e')),
      );
    } finally {
      if (mounted) setState(() => dealing = false);
    }
  }

  // Ход картой. Допустима ли карта, проверяет сервер — клиент только
  // не даёт нажать на те, которых нет в myPlayableCardIds.
  Future<void> playCard(String cardId) async {
    if (sendingCard) return;
    setState(() => sendingCard = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/play'),
        headers: authHeaders(),
        body: jsonEncode({
          'cardId': cardId,
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка хода: $e')),
      );
    } finally {
      if (mounted) setState(() => sendingCard = false);
    }
  }

  // ДВА при 6 и 7 игроках: сначала выбираем масть. Выбор видит только сам игрок,
  // остальным придёт просто «ДВА» (RULES.md §6.3). Масти присылает сервер.
  Future<void> chooseDva(List<String> options) async {
    if (options.length <= 1) {
      await sendBid('ДВА');
      return;
    }

    final suit = await showModalBottomSheet<String>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'ДВА — какой масти козырь?',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 6),
              const Text(
                'Остальные увидят только «ДВА». Масть откроется, если вы станете главным.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white60),
              ),
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 12,
                children: options
                    .map(
                      (s) => GestureDetector(
                        onTap: () => Navigator.pop(sheetContext, s),
                        child: SuitBadge(suit: s),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );

    if (suit != null) await sendBid('ДВА', suit: suit);
  }

  // Спецкарта (RULES.md §7): взять за множитель, пасовать, или сбросить карту.
  // Всё проверяет сервер — клиент только отправляет выбор.
  Future<void> sendSpecial(String path, Map<String, dynamic> body) async {
    if (sendingSpecial) return;
    setState(() => sendingSpecial = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/$path'),
        headers: authHeaders(),
        body: jsonEncode(body),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка: $e')),
      );
    } finally {
      if (mounted) setState(() => sendingSpecial = false);
    }
  }

  // Сдаться со спецкартой до первого хода (RULES.md §7.6) — сначала спрашиваем.
  Future<void> confirmConcede(int loss) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Сдаться?'),
        content: Text(
          'Раздача будет проиграна без розыгрыша.\n'
          'Вы положите в кон ${fmtCoins(loss)} — как при обычном проигрыше.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('ИГРАТЬ'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('СДАТЬСЯ'),
          ),
        ],
      ),
    );
    if (ok == true) await sendSpecial('concede', {});
  }

  // Выигравший КОН называет козырь (RULES.md §6.7).
  Future<void> chooseKonTrump(String suit) async {
    if (choosingKonTrump) return;
    setState(() => choosingKonTrump = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/kon-trump'),
        headers: authHeaders(),
        body: jsonEncode({'suit': suit}),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось назвать козырь: $e')),
      );
    } finally {
      if (mounted) setState(() => choosingKonTrump = false);
    }
  }

  // Подпись кнопки заявки в две строки: название и цена. В одну строку четыре
  // кнопки («РАЗ · 1 000», «ДВА · 500», «КОН · 500», «ПАС») не помещаются.
  Widget bidLabel(String name, int stake) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(name, style: const TextStyle(fontWeight: FontWeight.w900)),
        Text(fmtCoins(stake), style: const TextStyle(fontSize: 11)),
      ],
    );
  }

  // Голос «продолжаем» / «делим кон», когда кон не по карману никому (RULES.md §12.2).
  Future<void> sendVote(String choice) async {
    if (voting) return;
    setState(() => voting = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/vote'),
        headers: authHeaders(),
        body: jsonEncode({
          'choice': choice,
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось проголосовать: $e')),
      );
    } finally {
      if (mounted) setState(() => voting = false);
    }
  }

  // Сыгранные взятки компактно, строкой на взятку: «1. Q♥ K♠ 9♦ → Дана» (RULES.md §10.6).
  Widget trickHistory(List<Map<String, dynamic>> tricks) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < tricks.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              children: [
                Text('${i + 1}.', style: const TextStyle(color: Colors.white54)),
                const SizedBox(width: 6),
                Expanded(
                  child: Wrap(
                    spacing: 4,
                    runSpacing: 4,
                    children: ((tricks[i]['cards'] as List?) ?? const [])
                        .map((t) => cardChip(Map<String, dynamic>.from((t as Map)['card'] as Map)))
                        .toList(),
                  ),
                ),
                Text(
                  '→ ${tricks[i]['winnerName']}',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // Сыгранная карта строкой: «Q♦». Карта текущей взятки — крупнее и в золотой рамке.
  Widget cardChip(Map<String, dynamic> card, {bool current = false}) {
    final suit = card['suit'].toString();
    return Container(
      padding: EdgeInsets.symmetric(horizontal: current ? 6 : 4, vertical: 1),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(4),
        border: current ? Border.all(color: const Color(0xFFD4A94F), width: 2) : null,
      ),
      child: Text(
        '${card['rank']}${suitSymbol(suit)}',
        style: TextStyle(
          fontSize: current ? 15 : 12,
          fontWeight: FontWeight.w800,
          color: isRedSuit(suit) ? Colors.red.shade800 : Colors.black,
        ),
      ),
    );
  }

  // Карты одной взятки с именами игроков под ними.
  Widget trickRow(List<Map<String, dynamic>> trick, {bool dim = false}) {
    return Opacity(
      opacity: dim ? 0.55 : 1,
      child: Wrap(
        alignment: WrapAlignment.center,
        spacing: 8,
        runSpacing: 8,
        children: trick.map((t) {
          final card = Map<String, dynamic>.from(t['card'] as Map);
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SmallTrumpCard(
                rank: card['rank'].toString(),
                suit: card['suit'].toString(),
              ),
              const SizedBox(height: 3),
              Text(
                t['playerName'].toString(),
                style: const TextStyle(fontSize: 11, color: Colors.white70),
              ),
            ],
          );
        }).toList(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = room;

    if (data == null || data['game'] is! Map) {
      return Scaffold(
        appBar: AppBar(title: Text('ГАРБА • #${widget.roomCode}')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final game = Map<String, dynamic>.from(data['game'] as Map);
    final stage = game['stage'].toString();
    final dealerId = game['dealerId'].toString();
    final dealerName = game['dealerName'].toString();
    final isDealer = dealerId == widget.currentPlayerId;

    // Открытая карта и козырь — разные вещи: при 4 игроках козырь всегда
    // черви, что бы ни открылось. Какой козырь — решает сервер.
    final openCardRaw = game['openCard'];
    final openCard =
        openCardRaw is Map ? Map<String, dynamic>.from(openCardRaw) : null;
    final razSuit = game['razSuit']?.toString();
    final trumpSuit = game['trumpSuit']?.toString();
    // ИЗЖОГИ, которые открылись и вернулись в колоду (RULES.md §5.2).
    final izzhoga = ((game['izzhoga'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    // Масть ДВА: свою видит только сказавший ДВА (RULES.md §6.3).
    final myDvaSuit = game['myDvaSuit']?.toString();
    final myDvaSuitOptions = ((game['myDvaSuitOptions'] as List?) ?? const [])
        .map((e) => e.toString())
        .toList();

    final activeBidderId = game['activeBidderId']?.toString();
    final myAllowedBids = ((game['myAllowedBids'] as List?) ?? const [])
        .map((e) => e.toString())
        .toSet();

    final hand = ((game['hand'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final bids = ((game['bids'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final mains = ((game['mains'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final mainIds = mains.map((m) => m['playerId'].toString()).toSet();
    final players = (data['players'] as List)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    final capacity = (data['capacity'] as num).toInt();

    // Розыгрыш.
    final isPlaying = stage == 'playing';
    final isRoundDone = stage == 'round_done';
    final turnPlayerId = game['turnPlayerId']?.toString();
    final trickNumber = (game['trickNumber'] as num?)?.toInt() ?? 0;
    final currentTrick = ((game['currentTrick'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    // Все завершённые взятки раздачи — они остаются на виду до конца (RULES.md §10.6).
    final playedTricks = ((game['playedTricks'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    // Мои сыгранные карты: остаются в руке, но серыми (§10.6).
    final myPlayed = <Map<String, dynamic>>[
      for (final t in [
        for (final pt in playedTricks) ...(pt['cards'] as List),
        ...((game['currentTrick'] as List?) ?? const []),
      ])
        if ((t as Map)['playerId'].toString() == widget.currentPlayerId)
          Map<String, dynamic>.from(t['card'] as Map),
    ];
    // Карта каждого игрока в текущей взятке — кладём её перед ним на столе.
    final currentCardOf = <String, Map<String, dynamic>>{
      for (final t in currentTrick)
        t['playerId'].toString(): Map<String, dynamic>.from(t['card'] as Map),
    };
    final lastTrickRaw = game['lastTrick'];
    final lastTrick =
        lastTrickRaw is Map ? Map<String, dynamic>.from(lastTrickRaw) : null;
    final tricksWonRaw = game['tricksWon'];
    final tricksWon = tricksWonRaw is Map
        ? tricksWonRaw.map((k, v) => MapEntry(k.toString(), (v as num).toInt()))
        : <String, int>{};
    final result = ((game['result'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final myPlayable = ((game['myPlayableCardIds'] as List?) ?? const [])
        .map((e) => e.toString())
        .toSet();

    // Деньги. Все суммы считает сервер, здесь только показываем.
    final kon = (game['kon'] as num?)?.toInt() ?? 0;
    final baseKon = (game['baseKon'] as num?)?.toInt() ?? 0;
    final razStake = (game['razStake'] as num?)?.toInt() ?? 0;
    final dvaStake = (game['dvaStake'] as num?)?.toInt() ?? 0;
    // КОН: открыт ли, сколько стоит, как назван козырь (RULES.md §6.7).
    final konOpen = game['konAvailable'] == true;
    final konStake = (game['konStake'] as num?)?.toInt() ?? 0;
    final konAs = game['konAs']?.toString();
    final myKonTrumpOptions = ((game['myKonTrumpOptions'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    // Спецкарта и борьба за неё (RULES.md §7).
    final specialRaw = game['special'];
    final special =
        specialRaw is Map ? Map<String, dynamic>.from(specialRaw) : null;
    final isSpecial = stage == 'special' && special != null;
    final isDiscard = stage == 'special_discard';
    final mySpecialRisks = ((game['mySpecialRisks'] as List?) ?? const [])
        .map((e) => (e as num).toInt())
        .toList();
    final myDiscardOptions = ((game['myDiscardOptions'] as List?) ?? const [])
        .map((e) => e.toString())
        .toSet();
    // Во что превратилась спецкарта: у кого и на каком риске (или никто не взял).
    final specialOutcomeRaw = special?['outcome'];
    final specialOutcome = specialOutcomeRaw is Map
        ? Map<String, dynamic>.from(specialOutcomeRaw)
        : null;
    final konBefore = (game['konBeforeSettlement'] as num?)?.toInt();
    final closing = game['closing'] == true;
    final isRoomDone = stage == 'room_done';
    final lastAnteRaw = game['lastAnte'];
    final lastAnte =
        lastAnteRaw is Map ? Map<String, dynamic>.from(lastAnteRaw) : null;

    int balanceOf(String playerId) {
      final matches = players.where((p) => p['id'].toString() == playerId);
      if (matches.isEmpty) return 0;
      return (matches.first['balance'] as num?)?.toInt() ?? 0;
    }


    // Голосование.
    final isVote = stage == 'vote';
    final voteRaw = game['vote'];
    final vote = voteRaw is Map ? Map<String, dynamic>.from(voteRaw) : null;
    final myVote = game['myVote']?.toString();
    final lastVoteRaw = game['lastVote'];
    final lastVote =
        lastVoteRaw is Map ? Map<String, dynamic>.from(lastVoteRaw) : null;

    // Чей сейчас ход: в торгах — кто говорит, в розыгрыше — кто кладёт карту.
    // В борьбе за спецкарту — тот, кого сейчас спрашивают.
    final actorId = isSpecial
        ? special['activeId']?.toString()
        : isPlaying
            ? turnPlayerId
            : activeBidderId;
    // Пауза: кто-то отключился, ходы сервер не принимает (RULES.md §13).
    final pauseRaw = data['pause'];
    final pausedPlayers = pauseRaw is Map
        ? ((pauseRaw['players'] as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList()
        : <Map<String, dynamic>>[];
    final paused = pausedPlayers.isNotEmpty;
    final pauseElapsed = DateTime.now().difference(pauseReceivedAt).inSeconds;
    String countdown(Map<String, dynamic> p) {
      final left = ((p['secondsLeft'] as num?)?.toInt() ?? 0) - pauseElapsed;
      final safe = left < 0 ? 0 : left;
      return '${safe ~/ 60}:${(safe % 60).toString().padLeft(2, '0')}';
    }

    final myTurn = (stage == 'bidding' || isPlaying || isSpecial) &&
        actorId == widget.currentPlayerId &&
        !paused;

    String activeName = '';
    if (actorId != null) {
      final matches = players.where((p) => p['id'].toString() == actorId);
      if (matches.isNotEmpty) {
        activeName = matches.first['name'].toString();
      }
    }

    final String headline;
    if (isRoomDone) {
      headline = 'Комната закрыта';
    } else if (paused) {
      headline = 'ПАУЗА';
    } else if (isVote) {
      headline = 'Голосование';
    } else if (stage == 'kon_trump') {
      headline = 'КОН называет козырь';
    } else if (isSpecial) {
      headline = myTurn ? 'ВАШ ХОД' : 'Ход: $activeName';
    } else if (isDiscard) {
      headline = 'Сброс карты';
    } else if (stage == 'awaiting_deal') {
      headline = 'Пересдача';
    } else if (isRoundDone) {
      headline = 'Раздача сыграна';
    } else if (myTurn) {
      headline = 'ВАШ ХОД';
    } else {
      headline = 'Ход: $activeName';
    }

    // Какие кнопки активны, решает сервер через myAllowedBids.
    bool canBid(String bid) => myAllowedBids.contains(bid) && !sendingBid;

    // Почему пересдача и кто сколько долил — для окна итога.
    String? redealText;
    final Widget footer;
    if (isRoomDone) {
      // Итог комнаты: кто сколько выиграл или проиграл за всю игру.
      // Победителя (§36) определяет сервер, статистику за комнату (§35) — тоже.
      final winnerIds = ((game['winnerIds'] as List?) ?? const []).map((e) => e.toString()).toSet();
      final roomStats = data['stats'] is Map ? Map<String, dynamic>.from(data['stats'] as Map) : const {};
      final rows = players.map((p) {
        final start = (p['startBalance'] as num?)?.toInt() ?? 0;
        final end = (p['balance'] as num?)?.toInt() ?? 0;
        final id = p['id'].toString();
        final st = roomStats[id] is Map ? Map<String, dynamic>.from(roomStats[id] as Map) : <String, dynamic>{};
        return (
          id: id,
          name: p['name'].toString(),
          start: start,
          end: end,
          diff: end - start,
          stats: st,
          ratingStart: (p['ratingStart'] as num?)?.toDouble() ?? 0,
          ratingEnd: (p['rating'] as num?)?.toDouble() ?? 0,
        );
      }).toList()
        ..sort((a, b) => b.diff.compareTo(a.diff));
      int stat(Map<String, dynamic> st, String key) => (st[key] as num?)?.toInt() ?? 0;

      footer = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'ИТОГИ ИГРЫ',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w900,
              color: Color(0xFFD4A94F),
            ),
          ),
          // Кон никто не мог взять — его поделили поровну (RULES.md §12.2).
          if (game['closeReason'] == 'nobody_can_play' && game['split'] is Map)
            Builder(builder: (_) {
              final split = Map<String, dynamic>.from(game['split'] as Map);
              final splitKon = (split['kon'] as num).toInt();
              final perPlayer = (split['perPlayer'] as num).toInt();
              final remainder = (split['remainder'] as num).toInt();
              final remainderTo = split['remainderTo']?.toString();
              final remainderName = players
                  .where((p) => p['id'].toString() == remainderTo)
                  .map((p) => p['name'].toString())
                  .join();
              return Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Кон ${fmtCoins(splitKon)} не по карману никому — '
                  'поделили поровну: по ${fmtCoins(perPlayer)}'
                  '${remainder > 0 ? ', остаток ${fmtCoins(remainder)} — $remainderName' : ''}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
              );
            }),
          // Игрок отключился и не вернулся за 5 минут — кон поделили
          // между оставшимися (RULES.md §13).
          if (game['closeReason'] == 'player_left' && game['split'] is Map)
            Builder(builder: (_) {
              final split = Map<String, dynamic>.from(game['split'] as Map);
              final leftIds = ((game['leftPlayerIds'] as List?) ?? const [])
                  .map((e) => e.toString())
                  .toSet();
              final leftNames = players
                  .where((p) => leftIds.contains(p['id'].toString()))
                  .map((p) => p['name'].toString())
                  .join(', ');
              final remainder = (split['remainder'] as num).toInt();
              final remainderName = players
                  .where((p) => p['id'].toString() == split['remainderTo']?.toString())
                  .map((p) => p['name'].toString())
                  .join();
              return Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '$leftNames не вернулся за 5 минут — игра прекращена. '
                  'Кон ${fmtCoins((split['kon'] as num).toInt())} поделили между оставшимися: '
                  'по ${fmtCoins((split['perPlayer'] as num).toInt())}'
                  '${remainder > 0 ? ', остаток ${fmtCoins(remainder)} — $remainderName' : ''}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
              );
            }),
          const SizedBox(height: 8),
          ...rows.map((r) {
            final isWinner = winnerIds.contains(r.id);
            final st = r.stats;
            final maxRisk = stat(st, 'maxRisk');
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                children: [
                  Expanded(
                    child: Text(
                      isWinner ? '🏆 ${r.name}' : r.name,
                      style: TextStyle(
                        fontWeight:
                            isWinner ? FontWeight.w900 : FontWeight.w500,
                      ),
                    ),
                  ),
                  Text(
                    '${fmtCoins(r.start)} → ${fmtCoins(r.end)}  ',
                    style: const TextStyle(color: Colors.white60, fontSize: 12),
                  ),
                  Text(
                    fmtDelta(r.diff),
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      color: r.diff >= 0 ? Colors.greenAccent : Colors.redAccent,
                    ),
                  ),
                ],
              ),
                  Builder(builder: (_) {
                    final change = ((r.ratingEnd - r.ratingStart) * 10).round() / 10;
                    return Text(
                      'Рейтинг ${fmtRating(r.ratingStart)} → ${fmtRating(r.ratingEnd)} '
                      '(${change > 0 ? '+' : change < 0 ? '−' : ''}${change.abs().toStringAsFixed(1)})',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: change > 0
                            ? Colors.greenAccent
                            : change < 0
                                ? Colors.redAccent
                                : Colors.white60,
                      ),
                    );
                  }),
                  if (st.isNotEmpty)
                    Text(
                      'выиграно ${fmtCoins(stat(st, 'coinsWon'))} · проиграно ${fmtCoins(stat(st, 'coinsLost'))} · '
                      'побед ${stat(st, 'wins')}, поражений ${stat(st, 'losses')} · '
                      'главным ${stat(st, 'mains')} (РАЗ ${stat(st, 'raz')}, ДВА ${stat(st, 'dva')}) · '
                      'ГАРБА ${stat(st, 'garba')}'
                      '${maxRisk > 0 ? ' · макс. риск ×$maxRisk' : ''}',
                      style: const TextStyle(color: Colors.white54, fontSize: 11),
                    ),
                ],
              ),
            );
          }),
        ],
      );
    } else if (isSpecial) {
      // Борьба за спецкарту (RULES.md §7): что открылось, у кого карта, кто выбыл.
      final kind = special['kind'].toString();
      final card = Map<String, dynamic>.from(special['card'] as Map);
      final blind = special['phase'] == 'blind';
      final holderName = special['holderName']?.toString();
      final risk = (special['risk'] as num?)?.toInt() ?? 0;
      final passedIds = ((special['passedIds'] as List?) ?? const [])
          .map((e) => e.toString())
          .toSet();
      final passedNames = players
          .where((p) => passedIds.contains(p['id'].toString()))
          .map((p) => p['name'].toString())
          .join(', ');
      footer = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SmallTrumpCard(
                rank: card['rank'].toString(),
                suit: card['suit'].toString(),
              ),
              const SizedBox(width: 12),
              Text(
                specialName(kind),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: Color(0xFFD4A94F),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            blind
                ? 'Слепой круг: забрать туза можно только сейчас, не глядя в карты, за ×1'
                : holderName != null
                    ? 'Карта у $holderName на ×$risk'
                    : 'Кто заберёт карту? Кто забрал — главный, торгов не будет',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          if (passedNames.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'Выбыли: $passedNames',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            ),
          ],
        ],
      );
    } else if (isDiscard) {
      // Владелец спецкарты взял её в руку и сбрасывает одну свою карту (RULES.md §7.5).
      final owner = mains.isNotEmpty ? mains.first['playerName'].toString() : '';
      final risk = (specialOutcome?['risk'] as num?)?.toInt() ?? 1;
      footer = Text(
        myDiscardOptions.isNotEmpty
            ? 'Спецкарта ваша на ×$risk.\nСбросьте одну свою карту — её никто не увидит.'
            : '$owner забрал спецкарту на ×$risk и сбрасывает одну карту',
        textAlign: TextAlign.center,
        style: const TextStyle(fontWeight: FontWeight.w700),
      );
    } else if (isVote && vote != null) {
      final votedIds = ((vote['votedIds'] as List?) ?? const [])
          .map((e) => e.toString())
          .toSet();
      final waiting = players
          .where((p) => !votedIds.contains(p['id'].toString()))
          .map((p) => p['name'].toString())
          .join(', ');
      footer = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Кон ${fmtCoins(kon)} не по карману никому — даже самая дешёвая '
            'заявка стоит ${fmtCoins((vote['cheapest'] as num).toInt())}.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70),
          ),
          const SizedBox(height: 8),
          Text(
            'Продолжаем или делим кон поровну — по '
            '${fmtCoins(kon ~/ players.length)} каждому?',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
          ),
          const SizedBox(height: 10),
          Text(
            'Продолжаем: ${vote['continueVotes']}   ·   Делим: ${vote['splitVotes']}',
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              color: Color(0xFFD4A94F),
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Делим, только если согласны все. Хоть один против — играем дальше',
            style: TextStyle(color: Colors.white54, fontSize: 12),
          ),
          if (waiting.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'Ждём: $waiting',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            ),
          ],
        ],
      );
    } else if (stage == 'awaiting_deal') {
      // Доливка в кон при пересдаче — пока пустых раздач подряд не больше лимита.
      // Доливка бывает и после всеобщего ПАСа, и после трёх ИЗЖОГ.
      final isRefill = lastAnte != null &&
          (lastAnte['reason'] == 'all_pass' ||
              lastAnte['reason'] == 'three_izzhoga');
      final String anteText;
      if (isRefill && lastAnte['noRaz'] == true) {
        // На РАЗ не хватает ни у кого — не доливаем (RULES.md §9.2a). Владелец правил
        // просил об этом не писать: только «Все спасовали — пересдача».
        anteText = '';
      } else if (isRefill && lastAnte['skipped'] == true) {
        // Доливают все или никто (RULES.md §9.2).
        final brokeIds = ((lastAnte['brokePlayerIds'] as List?) ?? const [])
            .map((e) => e.toString())
            .toSet();
        final names = players
            .where((p) => brokeIds.contains(p['id'].toString()))
            .map((p) => p['name'].toString())
            .join(', ');
        anteText = 'У игрока $names не хватает на взнос — доливки нет ни у кого.';
      } else if (isRefill) {
        anteText = 'Все долили по ${fmtCoins((lastAnte['perPlayer'] as num).toInt())} в кон.';
      } else {
        anteText = 'Лимит пустых раздач исчерпан — в кон больше не доливаем.';
      }
      // Почему пересдача: все спасовали (§6.5) или три ИЗЖОГИ подряд (§5.2).
      final String why;
      if (game['lastRedeal'] == 'three_izzhoga') {
        final shown = izzhoga
            .map((c) => '${c['rank']}${suitSymbol(c['suit'].toString())}')
            .join(', ');
        why = 'Три раза подряд открылась ИЗЖОГА ($shown) — пересдача.';
      } else {
        why = 'Все спасовали — пересдача.';
      }
      redealText = anteText.isEmpty ? why : '$why\n$anteText';
      footer = Text(
        '$why\n${anteText.isEmpty ? '' : '$anteText\n'}Раздаёт $dealerName.',
        textAlign: TextAlign.center,
        style: const TextStyle(color: Colors.white70, fontSize: 16),
      );
    } else if (isPlaying) {
      // У КОНА видно, как он назвал козырь: «КОН по ДВА».
      final names = mains.map((m) {
        final d = m['declaration'].toString();
        // Главный спецраздачи: «ТУЗ ×3»; КОН: «КОН по ДВА».
        final label = specialOutcome != null && special != null
            ? '${specialName(special['kind'].toString())} ×${specialOutcome['risk']}'
            : d == 'КОН' && konAs != null
                ? 'КОН по $konAs'
                : d;
        return '${m['playerName']} ($label)';
      }).join(' и ');
      footer = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${mains.length > 1 ? 'Играют' : 'Главный'}: $names',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: Color(0xFFD4A94F),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Взятка $trickNumber из 5',
            style: const TextStyle(color: Colors.white60, fontSize: 13),
          ),
          const SizedBox(height: 10),
          // Пока новая взятка пуста — показываем предыдущую, чтобы все
          // успели увидеть, кто её забрал.
          if (currentTrick.isNotEmpty)
            trickRow(currentTrick)
          else if (lastTrick != null) ...[
            Text(
              'Взятку забрал ${lastTrick['winnerName']}',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            trickRow(
              ((lastTrick['cards'] as List?) ?? const [])
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList(),
              dim: true,
            ),
          ] else
            const Text(
              'Ждём первый ход',
              style: TextStyle(color: Colors.white54),
            ),
          // Прошлые взятки: крупно показана только текущая (или последняя, пока
          // новая пуста) — остальные строками ниже, чтобы все карты были на виду.
          if (playedTricks.length > (currentTrick.isEmpty ? 1 : 0)) ...[
            const SizedBox(height: 12),
            trickHistory(
              playedTricks.sublist(
                0,
                playedTricks.length - (currentTrick.isEmpty ? 1 : 0),
              ),
            ),
          ],
        ],
      );
    } else if (isRoundDone) {
      footer = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ГАРБА — дама, король и туз козыря: побеждает без розыгрыша (RULES.md §8).
          if (result.any((r) => r['garba'] == true))
            const GarbaBanner()
          // ДВА с дамой, королём и тузом своей масти тоже побеждает без розыгрыша,
          // но это не ГАРБА: без анимации, просто строкой (RULES.md §8).
          else if (result.any((r) => r['instant'] == true))
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text(
                'Дама, король и туз козыря — без розыгрыша',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white60, fontSize: 13),
              ),
            )
          // Раздача не доигрывается до пятой взятки, если исход уже ясен.
          else if (trickNumber < 5)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Исход ясен после $trickNumber-й взятки — дальше не играем',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white60, fontSize: 13),
              ),
            ),
          ...result.map((r) {
            final won = r['won'] == true;
            final delta = (r['delta'] as num?)?.toInt() ?? 0;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Text(
                '${r['playerName']} (${r['declaration']}): '
                '${r['garba'] == true ? 'ГАРБА' : r['instant'] == true ? 'Q K A козыря' : 'взяток ${r['tricks']}'} — '
                '${won ? 'ВЫИГРАЛ' : 'ПРОИГРАЛ'} '
                '${fmtDelta(delta)}',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  color: won ? Colors.greenAccent : Colors.redAccent,
                ),
              ),
            );
          }),
          const SizedBox(height: 8),
          if (konBefore != null)
            Text(
              'Кон: ${fmtCoins(konBefore)} → ${fmtCoins(kon)}',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          const SizedBox(height: 4),
          Text(
            'Следующую раздачу сдаёт $dealerName',
            style: const TextStyle(color: Colors.white60, fontSize: 13),
          ),
          // Как прошла раздача — все сыгранные взятки.
          if (playedTricks.isNotEmpty) ...[
            const SizedBox(height: 12),
            trickHistory(playedTricks),
          ],
        ],
      );
    } else {
      footer = Text(
        capacity == 4 ? 'РАЗ / ПАС' : 'РАЗ / ДВА / ПАС',
        style: const TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w900,
          color: Color(0xFFD4A94F),
        ),
      );
    }

    // Круглый стол (RULES.md §2): я внизу, остальные — по кругу против часовой стрелки.
    // Следующий в room.players — сосед справа: на экране он правее меня, дальше вверх и
    // влево, и так обратно ко мне. Карта взятки лежит перед игроком, ближе к центру.
    Widget roundTable(double maxHeight) {
      final n = players.length;
      final myIndex = math.max(
        0,
        players.indexWhere((p) => p['id'].toString() == widget.currentPlayerId),
      );
      // Взятка только что закрылась — ещё показываем её, чтобы была видна последняя
      // карта и кто забрал.
      final showLast = isPlaying && currentTrick.isEmpty && lastTrick != null;
      final trickCardOf = <String, Map<String, dynamic>>{
        if (showLast)
          for (final t in ((lastTrick['cards'] as List?) ?? const []))
            (t as Map)['playerId'].toString(): Map<String, dynamic>.from(t['card'] as Map)
        else
          ...currentCardOf,
      };
      // Прошлые взятки — мелко под игроком (§10.6: сыгранные карты открыты всем).
      final historyOf = <String, List<Map<String, dynamic>>>{};
      final shownTricks = showLast
          ? playedTricks.sublist(0, playedTricks.length - 1)
          : playedTricks;
      for (final pt in shownTricks) {
        for (final t in (pt['cards'] as List)) {
          historyOf.putIfAbsent((t as Map)['playerId'].toString(), () => []).add(
                Map<String, dynamic>.from(t['card'] as Map),
              );
        }
      }
      const gold = Color(0xFFD4A94F);
      const seatWidth = 96.0;

      Widget smallChip(Map<String, dynamic> card) {
        final suit = card['suit'].toString();
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          decoration: BoxDecoration(
            color: const Color(0xFFF4EFE2).withValues(alpha: 0.75),
            borderRadius: BorderRadius.circular(3),
          ),
          child: Text(
            '${card['rank']}${suitSymbol(suit)}',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: isRedSuit(suit) ? Colors.red.shade800 : Colors.black,
            ),
          ),
        );
      }

      Widget seat(Map<String, dynamic> p) {
        final pId = p['id'].toString();
        final isMain = mainIds.contains(pId);
        final isActive = pId == actorId;
        final bidMatches = bids.where((b) => b['playerId'].toString() == pId);

        // В торгах — заявка, в розыгрыше — взятки.
        final String bidText;
        final mainDecl = mains
            .where((m) => m['playerId'].toString() == pId)
            .map((m) => m['declaration'].toString())
            .firstOrNull;
        if ((isPlaying || isRoundDone) && mainDecl != null) {
          // Главный: заявка видна до конца раздачи — «РАЗ · взяток 1».
          final label = specialOutcome != null && special != null
              ? '${specialName(special['kind'].toString())} ×${specialOutcome['risk']}'
              : mainDecl;
          bidText = '$label · взяток ${tricksWon[pId] ?? 0}';
        } else if (isPlaying || isRoundDone) {
          bidText = 'взяток: ${tricksWon[pId] ?? 0}';
        } else if (bidMatches.isEmpty) {
          bidText = isActive ? 'думает…' : '';
        } else {
          final said = bidMatches.last['bid'].toString();
          // Свою масть ДВА игрок видит, остальные — просто «ДВА».
          bidText = said == 'ДВА' && pId == widget.currentPlayerId && myDvaSuit != null
              ? 'ДВА ${suitSymbol(myDvaSuit)}'
              : said;
        }
        final history = historyOf[pId] ?? const <Map<String, dynamic>>[];

        return SizedBox(
          width: seatWidth,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  // Чей ход — зелёное кольцо со свечением, главный — золотое со свечением.
                  Container(
                    padding: const EdgeInsets.all(2.5),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: const Color(0xFF0B1620),
                      border: Border.all(
                        color: isActive
                            ? Colors.greenAccent
                            : isMain
                                ? gold
                                : const Color(0xFF3A4A55),
                        width: isMain ? 4 : 3,
                      ),
                      boxShadow: [
                        if (isMain) BoxShadow(color: gold.withValues(alpha: 0.7), blurRadius: 16, spreadRadius: 2),
                        if (isActive) BoxShadow(color: Colors.greenAccent.withValues(alpha: 0.5), blurRadius: 12),
                      ],
                    ),
                    child: AvatarView(
                      avatar: p['avatar']?.toString(),
                      name: p['name'].toString(),
                      radius: 21,
                    ),
                  ),
                  if (isMain)
                    const Positioned(
                      left: -6,
                      top: -6,
                      child: Icon(Icons.star, size: 18, color: gold),
                    ),
                  // Раздающий — фишка «Р», как кнопка дилера в покере.
                  if (pId == dealerId)
                    Positioned(
                      right: -8,
                      top: -4,
                      child: Container(
                        width: 20,
                        height: 20,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.black26, width: 2),
                        ),
                        child: const Text(
                          'Р',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                            color: Colors.black,
                          ),
                        ),
                      ),
                    ),
                  // Смайлик этого игрока, если он только что его отправил.
                  if (flyingEmoji[pId] != null)
                    Positioned(
                      right: -22,
                      bottom: -4,
                      child: Text(flyingEmoji[pId]!, style: const TextStyle(fontSize: 22)),
                    ),
                ],
              ),
              // Табличка: имя и монеты.
              Transform.translate(
                offset: const Offset(0, -6),
                // Главный — золотая табличка: его видно сразу.
                child: Container(
                  width: seatWidth,
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  decoration: BoxDecoration(
                    color: isMain ? null : const Color(0xE60B1620),
                    gradient: isMain
                        ? const LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Color(0xFFF0CF7A), Color(0xFFC08A2E)],
                          )
                        : null,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isActive
                          ? Colors.greenAccent
                          : isMain
                              ? const Color(0xFFFFE9A8)
                              : const Color(0xFF3A4A55),
                      width: isActive || isMain ? 2 : 1,
                    ),
                  ),
                  child: Column(
                    children: [
                      Text(
                        p['name'].toString(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                          color: isMain ? Colors.black : Colors.white,
                        ),
                      ),
                      Text(
                        '🪙 ${fmtCoins(balanceOf(pId))}  ⭐${fmtRating(p['rating'])}',
                        maxLines: 1,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: isMain ? Colors.black87 : gold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // Заявка в торгах или взятки в розыгрыше — плашкой.
              if (bidText.isNotEmpty)
                Transform.translate(
                  offset: const Offset(0, -4),
                  // Заявка главного — на красной плашке, остальные — золото / серый ПАС.
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
                    decoration: BoxDecoration(
                      color: isMain
                          ? const Color(0xFFC62828)
                          : bidText == 'ПАС'
                              ? const Color(0xFF3A4A55)
                              : gold,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    // Длинная «КОН · взяток 0» ужимается, а не переносится.
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                      bidText,
                      maxLines: 1,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                        color: isMain
                            ? Colors.white
                            : bidText == 'ПАС'
                                ? Colors.white70
                                : Colors.black,
                      ),
                    ),
                    ),
                  ),
                ),
              if ((isPlaying || isRoundDone) && history.isNotEmpty)
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 2,
                  runSpacing: 2,
                  children: history.map(smallChip).toList(),
                ),
            ],
          ),
        );
      }

      // Центр стола: открытая карта лежит всю раздачу — чтобы не забыть, что открылось.
      // Под ней — масть РАЗ в торгах или итоговый козырь (ДВА и КОН могут его сменить).
      final shownSuit = trumpSuit ?? razSuit;
      final centerParts = <Widget>[
        // В розыгрыше вокруг лежат карты взятки — открытая карта компактнее.
        if (openCard != null && (isPlaying || isRoundDone))
          cardChip(openCard, current: true)
        else if (openCard != null)
          SmallTrumpCard(
            rank: openCard['rank'].toString(),
            suit: openCard['suit'].toString(),
          ),
        if (shownSuit != null)
          Container(
            margin: const EdgeInsets.only(top: 3),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            // Светлая подложка: чёрные ♣ ♠ на тёмном не видно.
            decoration: BoxDecoration(
              color: const Color(0xFFF4EFE2),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: gold, width: 1.5),
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: trumpSuit != null ? 'КОЗЫРЬ ' : 'РАЗ ',
                    style: const TextStyle(color: Colors.black87),
                  ),
                  TextSpan(
                    text: suitSymbol(shownSuit),
                    style: TextStyle(
                      fontSize: 15,
                      color: isRedSuit(shownSuit) ? Colors.red.shade800 : Colors.black,
                    ),
                  ),
                ],
              ),
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
            ),
          ),
        if (showLast)
          Text(
            'забрал ${lastTrick['winnerName']}',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 10, color: Colors.white70),
          ),
      ];

      return LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final height = math.min((width * 1.2).clamp(330.0, 480.0), maxHeight);
          return SizedBox(
            height: height,
            child: Stack(
              children: [
                // Стол: деревянный бортик с золотой каймой, внутри — сукно.
                Positioned(
                  left: 14,
                  right: 14,
                  top: 30,
                  bottom: 40,
                  child: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.all(Radius.elliptical(width / 2, height / 2)),
                      gradient: const LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Color(0xFF6B4423), Color(0xFF3B2412)],
                      ),
                      border: Border.all(color: gold.withValues(alpha: 0.8), width: 1.5),
                      boxShadow: const [
                        BoxShadow(color: Colors.black54, blurRadius: 18, offset: Offset(0, 6)),
                      ],
                    ),
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.all(Radius.elliptical(width / 2, height / 2)),
                        gradient: const RadialGradient(
                          colors: [Color(0xFF2F8F5B), Color(0xFF17583A)],
                          radius: 0.8,
                        ),
                        border: Border.all(color: Colors.black38, width: 2),
                      ),
                    ),
                  ),
                ),
                Align(
                  alignment: Alignment.center,
                  child: Column(mainAxisSize: MainAxisSize.min, children: centerParts),
                ),
                for (var i = 0; i < n; i++) ...() {
                  // Смещение от меня по кругу: 0 — я (внизу), 1 — сосед справа, …
                  final k = (i - myIndex + n) % n;
                  final angle = -math.pi / 2 + 2 * math.pi * k / n;
                  final x = math.cos(angle);
                  final y = -math.sin(angle);
                  final p = players[i];
                  final pId = p['id'].toString();
                  final card = trickCardOf[pId];
                  return <Widget>[
                    Align(alignment: Alignment(x, y), child: seat(p)),
                    if (card != null)
                      Align(
                        alignment: Alignment(x * 0.42, y * 0.42),
                        child: Opacity(
                          opacity: showLast ? 0.6 : 1,
                          child: cardChip(card, current: true),
                        ),
                      ),
                  ];
                }(),
              ],
            ),
          );
        },
      );
    }

    // Взял спецкарту и видит, что не выиграет, — может сдаться до первого хода (§7.6).
    // Разрешает сервер (myCanConcede); платит как при проигрыше — кон × риск.
    final canConcede = game['myCanConcede'] == true;
    final concedeLoss = kon * ((specialOutcome?['risk'] as num?)?.toInt() ?? 1);
    Widget concedeButton() => Padding(
          padding: const EdgeInsets.only(top: 6),
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.redAccent,
              side: const BorderSide(color: Colors.redAccent),
            ),
            onPressed: sendingSpecial ? null : () => confirmConcede(concedeLoss),
            icon: const Icon(Icons.flag),
            label: Text('СДАТЬСЯ (в кон ${fmtCoins(concedeLoss)})'),
          ),
        );

    // Итог раздачи — поверх стола, чтобы не искать его под столом: кто что сказал,
    // выиграл или проиграл, сколько забрал из кона или положил в кон (RULES.md §11).
    Widget? resultPopup;
    final String? resultKey = isRoundDone && result.isNotEmpty
        ? 'r-$konBefore-$kon-${playedTricks.length}-'
            '${result.map((r) => '${r['playerId']}${r['delta']}').join()}'
        : stage == 'awaiting_deal' && redealText != null
            ? 'a-$kon-${game['emptyStreak']}-${game['lastRedeal']}'
            : null;
    if (resultKey != null && resultKey != dismissedResultKey) {
      resultPopup = DealResultPopup(
        key: ValueKey(resultKey),
        lines: [
          for (final r in result)
            (
              name: r['playerName'].toString(),
              label: specialOutcome != null && special != null
                  ? '${specialName(special['kind'].toString())} ×${specialOutcome['risk']}'
                  : r['declaration'] == 'КОН' && konAs != null
                      ? 'КОН по $konAs'
                      : r['declaration'].toString(),
              how: r['conceded'] == true
                  ? 'сдался до первого хода'
                  : r['garba'] == true
                  ? 'ГАРБА — без розыгрыша'
                  : r['instant'] == true
                      ? 'дама, король и туз козыря — без розыгрыша'
                      : 'взял ${tricksText((r['tricks'] as num?)?.toInt() ?? 0)}',
              won: r['won'] == true,
              delta: (r['delta'] as num?)?.toInt() ?? 0,
            ),
        ],
        garba: result.any((r) => r['garba'] == true),
        konBefore: konBefore,
        konAfter: kon,
        redealText: isRoundDone ? null : redealText,
        nextDealer: dealerName,
        onClose: () => setState(() => dismissedResultKey = resultKey),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text('ГАРБА • #${widget.roomCode}')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Кон — над столом: в центре стола его закрывали карты взятки при 6–7 игроках.
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(
                      'Раздающий: $dealerName',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFFD4A94F),
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFF14503F),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFD4A94F)),
                    ),
                    child: Text(
                      'КОН 🪙 ${fmtCoins(kon)}',
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFFD4A94F),
                      ),
                    ),
                  ),
                ],
              ),
              if (paused && !isRoomDone)
                Container(
                  margin: const EdgeInsets.only(top: 6),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.orange.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.orangeAccent),
                  ),
                  child: Text(
                    '${pausedPlayers.map((p) => '${p['name']} отключился — ждём ${countdown(p)}').join('\n')}\n'
                    'Не вернётся — игра прекращается, кон делится поровну между оставшимися, '
                    'а ушедший теряет 1.0 рейтинга.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.orangeAccent, fontSize: 13),
                  ),
                ),
              if (closing && !isRoomDone)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'У кого-то меньше базового кона (${fmtCoins(baseKon)}) — '
                    'доигрываем последний кон',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.orangeAccent, fontSize: 13),
                  ),
                ),
              const SizedBox(height: 10),
              // Открывалась ИЗЖОГА — показываем, что вернули в колоду (RULES.md §5.2).
              if (izzhoga.isNotEmpty && (stage == 'bidding' || isPlaying))
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'ИЗЖОГА, вернули в колоду: '
                    '${izzhoga.map((c) => '${c['rank']}${suitSymbol(c['suit'].toString())}').join(', ')}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white60, fontSize: 13),
                  ),
                ),
              const SizedBox(height: 10),
              Text(
                headline,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: myTurn ? Colors.greenAccent : Colors.white,
                ),
              ),
              const SizedBox(height: 14),
              Expanded(
                // Стол — по свободной высоте экрана, чтобы моё место внизу не обрезалось.
                // Под столом прокручиваются итоги и история взяток.
                child: LayoutBuilder(
                  builder: (context, box) => Stack(
                    children: [
                  SingleChildScrollView(
                    child: Column(
                    children: [
                      roundTable(box.maxHeight),
                      const SizedBox(height: 16),
                      footer,
                      // Смайлики — только когда раздача сыграна или комната закрыта
                      // (RULES.md §14: чата во время игры нет).
                      if (isRoundDone || isRoomDone) ...[
                        const SizedBox(height: 12),
                        const Divider(),
                        Wrap(
                          alignment: WrapAlignment.center,
                          spacing: 4,
                          children: tableReactions
                              .map((emoji) => IconButton(
                                    onPressed: sendingReaction ? null : () => sendReaction(emoji),
                                    icon: Text(emoji, style: const TextStyle(fontSize: 24)),
                                  ))
                              .toList(),
                        ),
                      ],
                    ],
                    ),
                  ),
                  if (announcement != null)
                    Positioned.fill(
                      child: IgnorePointer(
                        child: Center(
                          child: TweenAnimationBuilder<double>(
                            key: ValueKey(announcement!.id),
                            tween: Tween(begin: 0.3, end: 1),
                            duration: const Duration(milliseconds: 700),
                            curve: Curves.elasticOut,
                            builder: (_, t, c) => Transform.scale(scale: t, child: c),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                              decoration: BoxDecoration(
                                color: const Color(0xEE0B1620),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: const Color(0xFFD4A94F), width: 2),
                                boxShadow: const [
                                  BoxShadow(color: Color(0x88D4A94F), blurRadius: 24),
                                ],
                              ),
                              child: Text(
                                announcement!.text,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 30,
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFFD4A94F),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  if (resultPopup != null) Positioned.fill(child: resultPopup),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'ВАШИ КАРТЫ',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: Colors.white70,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 128,
                child: hand.isEmpty && myPlayed.isEmpty
                    ? Center(
                        child: Text(
                          stage == 'awaiting_deal'
                              ? 'Карты ещё не розданы'
                              : isRoundDone
                                  ? 'Все карты сыграны'
                                  : 'Карты загружаются...',
                        ),
                      )
                    : ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: hand.length + myPlayed.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (_, index) {
                          // Сначала карты на руках, за ними мои сыгранные —
                          // серые и неактивные, но видны до конца раздачи (§10.6).
                          if (index >= hand.length) {
                            final played = myPlayed[index - hand.length];
                            return Opacity(
                              opacity: 0.45,
                              child: ColorFiltered(
                                colorFilter: const ColorFilter.matrix(<double>[
                                  0.33, 0.33, 0.33, 0, 0,
                                  0.33, 0.33, 0.33, 0, 0,
                                  0.33, 0.33, 0.33, 0, 0,
                                  0, 0, 0, 1, 0,
                                ]),
                                child: SmallCard(
                                  rank: played['rank'].toString(),
                                  suit: played['suit'].toString(),
                                ),
                              ),
                            );
                          }

                          final card = hand[index];
                          final cardId = card['id'].toString();

                          // Сброс после спецкарты: нажатием выбираем карту (RULES.md §7.5).
                          if (isDiscard && myDiscardOptions.isNotEmpty) {
                            final canDiscard = myDiscardOptions.contains(cardId);
                            return Opacity(
                              opacity: canDiscard ? 1 : 0.35,
                              child: GestureDetector(
                                onTap: canDiscard && !sendingSpecial
                                    ? () => sendSpecial('discard', {'cardId': cardId})
                                    : null,
                                child: SmallCard(
                                  rank: card['rank'].toString(),
                                  suit: card['suit'].toString(),
                                ),
                              ),
                            );
                          }

                          final myPlayTurn = isPlaying && myTurn;
                          final canPlay = myPlayTurn &&
                              myPlayable.contains(cardId) &&
                              !sendingCard;

                          // В свой ход недопустимые карты приглушены:
                          // так видно, что правила требуют масть или козырь.
                          return Opacity(
                            opacity: myPlayTurn && !myPlayable.contains(cardId)
                                ? 0.35
                                : 1,
                            child: GestureDetector(
                              onTap: canPlay ? () => playCard(cardId) : null,
                              child: SmallCard(
                                rank: card['rank'].toString(),
                                suit: card['suit'].toString(),
                              ),
                            ),
                          );
                        },
                      ),
              ),
              const SizedBox(height: 12),
              // Решили продолжать — показываем, чем кончилось голосование.
              if (lastVote != null &&
                  lastVote['result'] == 'continue' &&
                  (stage == 'awaiting_deal' || isRoundDone))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    'Голосование: продолжаем '
                    '(${lastVote['continueVotes']} : ${lastVote['splitVotes']})'
                    // Снова спросим не раньше чем через круг (RULES.md §12.2).
                    '${((game['dealsUntilNextVote'] as num?)?.toInt() ?? 0) > 0 ? ' · снова спросим через ${game['dealsUntilNextVote']} разд.' : ''}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white60, fontSize: 13),
                  ),
                ),
              if (isVote)
                myVote == null
                    ? Row(
                        children: [
                          Expanded(
                            child: FilledButton(
                              onPressed:
                                  voting ? null : () => sendVote('continue'),
                              child: const Text('ПРОДОЛЖАЕМ'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(
                              onPressed: voting ? null : () => sendVote('split'),
                              child: const Text('ДЕЛИМ КОН'),
                            ),
                          ),
                        ],
                      )
                    : Text(
                        'Ваш голос: ${myVote == 'continue' ? 'продолжаем' : 'делим кон'}. '
                        'Ждём остальных.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white70),
                      )
              else if (isRoomDone)
                FilledButton(
                  onPressed: () => Navigator.pushAndRemoveUntil(
                    context,
                    MaterialPageRoute(builder: (_) => const HomeScreen()),
                    (_) => false,
                  ),
                  child: const Text('В ГЛАВНОЕ МЕНЮ'),
                )
              else if (stage == 'awaiting_deal' || isRoundDone)
                FilledButton(
                  onPressed: isDealer && !dealing && !paused ? dealCards : null,
                  child: Text(
                    dealing
                        ? 'РАЗДАЁМ...'
                        : isDealer
                            ? (isRoundDone
                                ? 'РАЗДАТЬ СЛЕДУЮЩУЮ'
                                : 'РАЗДАТЬ КАРТЫ')
                            : 'РАЗДАЁТ $dealerName',
                  ),
                )
              else if (isPlaying)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      myTurn
                          ? 'Нажмите на карту, чтобы сходить'
                          : 'Ходит $activeName',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: myTurn ? Colors.greenAccent : Colors.white60,
                      ),
                    ),
                    if (canConcede) concedeButton(),
                  ],
                )
              else if (isSpecial)
                // Борьба за спецкарту: множители, которые можно назвать (с учётом
                // баланса, решает сервер), и пас — окончательный выход (RULES.md §7.4).
                myTurn
                    ? Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          ...mySpecialRisks.map(
                            (r) => FilledButton(
                              onPressed: sendingSpecial
                                  ? null
                                  : () => sendSpecial(
                                        'special',
                                        {'action': 'take', 'risk': r},
                                      ),
                              child: Text(
                                special['phase'] == 'blind'
                                    ? 'ВЗЯТЬ ВСЛЕПУЮ ×$r'
                                    : 'ВЗЯТЬ ×$r',
                              ),
                            ),
                          ),
                          OutlinedButton(
                            onPressed: sendingSpecial
                                ? null
                                : () => sendSpecial('special', {'action': 'pass'}),
                            child: Text(
                              special['phase'] == 'blind' ? 'НЕ БРАТЬ' : 'ПАС',
                            ),
                          ),
                          if (mySpecialRisks.isEmpty)
                            const Text(
                              'Монет не хватает ни на один множитель',
                              style: TextStyle(color: Colors.white60),
                            ),
                        ],
                      )
                    : Text(
                        'Решает $activeName',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white60),
                      )
              else if (isDiscard)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      myDiscardOptions.isNotEmpty
                          ? 'Нажмите на карту, которую сбросить'
                          : 'Ждём, пока сбросят карту',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: myDiscardOptions.isNotEmpty
                            ? Colors.greenAccent
                            : Colors.white60,
                      ),
                    ),
                    if (canConcede) concedeButton(),
                  ],
                )
              else if (stage == 'kon_trump')
                // Выигравший КОН называет козырь: по РАЗ или по ДВА (RULES.md §6.7).
                // До этого козырь не знает никто, варианты сервер присылает только ему.
                myKonTrumpOptions.isNotEmpty
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text(
                            'КОН: назовите козырь',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontWeight: FontWeight.w900),
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 10,
                            runSpacing: 10,
                            children: myKonTrumpOptions.map((o) {
                              final suit = o['suit'].toString();
                              return GestureDetector(
                                onTap: choosingKonTrump
                                    ? null
                                    : () => chooseKonTrump(suit),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    SuitBadge(suit: suit),
                                    const SizedBox(height: 4),
                                    Text(
                                      'по ${o['as']}',
                                      style: const TextStyle(
                                        color: Colors.white70,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                          ),
                        ],
                      )
                    : Text(
                        'Козырь называет ${mains.isNotEmpty ? mains.first['playerName'] : ''} (КОН)',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white60),
                      )
              else if (stage == 'bidding')
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        onPressed: canBid('РАЗ') ? () => sendBid('РАЗ') : null,
                        // Сколько стоит заявка: столько заберёшь или положишь.
                        child: bidLabel('РАЗ', razStake),
                      ),
                    ),
                    if (capacity != 4) ...[
                      const SizedBox(width: 6),
                      Expanded(
                        child: FilledButton(
                          onPressed:
                              canBid('ДВА')
                                  ? () => chooseDva(myDvaSuitOptions)
                                  : null,
                          child: bidLabel('ДВА', dvaStake),
                        ),
                      ),
                    ],
                    // КОН — только когда кон дорос до порога (RULES.md §6.7).
                    if (konOpen) ...[
                      const SizedBox(width: 6),
                      Expanded(
                        child: FilledButton(
                          onPressed: canBid('КОН') ? () => sendBid('КОН') : null,
                          child: bidLabel('КОН', konStake),
                        ),
                      ),
                    ],
                    const SizedBox(width: 6),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: canBid('ПАС') ? () => sendBid('ПАС') : null,
                        child: const Text('ПАС'),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// «ГАРБА!» — надпись, которая при появлении увеличивается и загорается (RULES.md §8:
// «показывается анимация ГАРБА»). Без пакетов анимации — встроенный TweenAnimationBuilder.
// «1 взятку», «2 взятки», «5 взяток».
String tricksText(int n) {
  final mod10 = n % 10, mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n взятку';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return '$n взятки';
  return '$n взяток';
}

// Окно итога раздачи с анимацией: всплывает, строки главных появляются по очереди,
// суммы отсчитываются, монета летит из кона к выигравшему или от проигравшего в кон.
class DealResultPopup extends StatelessWidget {
  final List<({String name, String label, String how, bool won, int delta})> lines;
  final bool garba;
  final int? konBefore;
  final int konAfter;
  final String? redealText;
  final String nextDealer;
  final VoidCallback onClose;

  const DealResultPopup({
    super.key,
    required this.lines,
    required this.garba,
    required this.konBefore,
    required this.konAfter,
    required this.redealText,
    required this.nextDealer,
    required this.onClose,
  });

  static const gold = Color(0xFFD4A94F);

  // Появление с задержкой: i-я часть окна начинает двигаться позже предыдущей.
  Widget appear(int i, Widget child) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 500 + 450 * i),
      curve: Interval(i == 0 ? 0 : (450 * i) / (500 + 450 * i), 1, curve: Curves.easeOutBack),
      builder: (_, t, c) => Opacity(
        opacity: t.clamp(0.0, 1.0),
        child: Transform.translate(offset: Offset(0, 16 * (1 - t)), child: c),
      ),
      child: child,
    );
  }

  // Монета летит слева направо: из кона к игроку или от игрока в кон.
  Widget flyingCoin(String from, String to, int i) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(from, style: const TextStyle(fontSize: 12, color: Colors.white70)),
        SizedBox(
          width: 70,
          height: 22,
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: Duration(milliseconds: 1400 + 450 * i),
            curve: Interval((450 * i + 400) / (1400 + 450 * i), 1, curve: Curves.easeInOut),
            builder: (_, t, __) => Align(
              alignment: Alignment(-1 + 2 * t, 0),
              child: const Text('🪙', style: TextStyle(fontSize: 16)),
            ),
          ),
        ),
        Text(to, style: const TextStyle(fontSize: 12, color: Colors.white70)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onClose,
      child: Container(
        color: Colors.black54,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(12),
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.6, end: 1),
          duration: const Duration(milliseconds: 600),
          curve: Curves.elasticOut,
          builder: (_, scale, c) => Transform.scale(scale: scale, child: c),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            decoration: BoxDecoration(
              color: const Color(0xF20B1620),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: gold, width: 2),
              boxShadow: const [BoxShadow(color: Colors.black87, blurRadius: 24)],
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    redealText != null ? 'ПЕРЕСДАЧА' : 'ИТОГ РАЗДАЧИ',
                    style: const TextStyle(
                      fontSize: 13,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w900,
                      color: gold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (garba) const GarbaBanner(),
                  if (redealText != null)
                    appear(
                      0,
                      Text(
                        redealText!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                    ),
                  for (var i = 0; i < lines.length; i++) ...[
                    appear(
                      i,
                      Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: (lines[i].won ? Colors.greenAccent : Colors.redAccent)
                              .withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: lines[i].won ? Colors.greenAccent : Colors.redAccent,
                          ),
                        ),
                        child: Column(
                          children: [
                            Text(
                              '${lines[i].name} сказал ${lines[i].label}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                            ),
                            Text(
                              lines[i].how,
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 13, color: Colors.white70),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              lines[i].won ? 'ВЫИГРАЛ' : 'ПРОИГРАЛ',
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w900,
                                color: lines[i].won ? Colors.greenAccent : Colors.redAccent,
                              ),
                            ),
                            // Сумма отсчитывается от нуля.
                            TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0, end: lines[i].delta.abs().toDouble()),
                              duration: Duration(milliseconds: 1200 + 450 * i),
                              curve: Curves.easeOut,
                              builder: (_, v, __) => Text(
                                lines[i].won
                                    ? 'забрал из кона 🪙 +${fmtCoins(v.round())}'
                                    : 'положил в кон 🪙 ${fmtCoins(v.round())}',
                                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                              ),
                            ),
                            lines[i].won
                                ? flyingCoin('КОН', lines[i].name, i)
                                : flyingCoin(lines[i].name, 'КОН', i),
                          ],
                        ),
                      ),
                    ),
                  ],
                  // Кон до и после — число меняется на глазах.
                  if (konBefore != null && redealText == null)
                    TweenAnimationBuilder<double>(
                      tween: Tween(begin: konBefore!.toDouble(), end: konAfter.toDouble()),
                      duration: Duration(milliseconds: 1400 + 450 * lines.length),
                      curve: Curves.easeInOut,
                      builder: (_, v, __) => Text(
                        'КОН ${fmtCoins(konBefore!)} → ${fmtCoins(v.round())}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                          color: gold,
                        ),
                      ),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    'Раздаёт $nextDealer · нажмите, чтобы закрыть',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 11, color: Colors.white54),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class GarbaBanner extends StatelessWidget {
  const GarbaBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.3, end: 1),
      duration: const Duration(milliseconds: 900),
      curve: Curves.elasticOut,
      builder: (_, scale, child) => Transform.scale(scale: scale, child: child),
      child: const Padding(
        padding: EdgeInsets.only(bottom: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'ГАРБА!',
              style: TextStyle(
                fontSize: 44,
                fontWeight: FontWeight.w900,
                color: Color(0xFFD4A94F),
                shadows: [Shadow(color: Color(0xAAD4A94F), blurRadius: 24)],
              ),
            ),
            Text(
              'Дама, король и туз козыря — без розыгрыша',
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

// Масть без карты: символ и название, например «♥ черви».
// Светлая подложка, чтобы чёрные масти были видны на тёмном фоне.
class SuitBadge extends StatelessWidget {
  final String suit;

  const SuitBadge({super.key, required this.suit});

  @override
  Widget build(BuildContext context) {
    final color = isRedSuit(suit) ? Colors.red.shade800 : Colors.black;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        '${suitSymbol(suit)} ${suitName(suit)}',
        style: TextStyle(
          color: color,
          fontSize: 17,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class PlayingCardView extends StatelessWidget {
  final String rank;
  final String suit;
  final bool glow;

  const PlayingCardView({
    super.key,
    required this.rank,
    required this.suit,
    required this.glow,
  });

  @override
  Widget build(BuildContext context) {
    final red = isRedSuit(suit);
    final symbol = suitSymbol(suit);

    return Container(
      width: 150,
      height: 210,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: glow ? const Color(0xFFD4A94F) : Colors.white30,
          width: glow ? 4 : 1,
        ),
        boxShadow: glow
            ? const [
                BoxShadow(
                  color: Color(0x66D4A94F),
                  blurRadius: 28,
                  spreadRadius: 5,
                ),
              ]
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            rank,
            style: TextStyle(
              fontSize: 40,
              fontWeight: FontWeight.w900,
              color: red ? Colors.red.shade800 : Colors.black,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              fontSize: 42,
              color: red ? Colors.red.shade800 : Colors.black,
            ),
          ),
          // Большой значок масти занимает остаток карточки и ужимается под него.
          // Раньше тут стоял фиксированный шрифт 70 между двумя Spacer, и на
          // эмуляторе Pixel 8 карта переполнялась на 47 пикселей.
          Expanded(
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  symbol,
                  style: TextStyle(
                    fontSize: 70,
                    color: red ? Colors.red.shade800 : Colors.black,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}


class SmallTrumpCard extends StatelessWidget {
  final String rank;
  final String suit;

  const SmallTrumpCard({
    super.key,
    required this.rank,
    required this.suit,
  });

  @override
  Widget build(BuildContext context) {
    final red = isRedSuit(suit);
    final symbol = suitSymbol(suit);

    return Container(
      width: 52,
      height: 64,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            rank,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontWeight: FontWeight.w900,
              fontSize: 17,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontSize: 19,
            ),
          ),
        ],
      ),
    );
  }
}

class SmallCard extends StatelessWidget {
  final String rank;
  final String suit;

  const SmallCard({
    super.key,
    required this.rank,
    required this.suit,
  });

  @override
  Widget build(BuildContext context) {
    final red = isRedSuit(suit);
    final symbol = suitSymbol(suit);

    return Container(
      width: 78,
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            rank,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontSize: 28,
            ),
          ),
          const Spacer(),
          Align(
            alignment: Alignment.bottomRight,
            child: Text(
              symbol,
              style: TextStyle(
                color: red ? Colors.red.shade800 : Colors.black,
                fontSize: 22,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class PlayerTile extends StatelessWidget {
  final String name;
  final String subtitle;
  final bool ready;
  // Адрес фото игрока; null — фото нет или место свободно.
  final String? avatar;

  const PlayerTile({
    super.key,
    required this.name,
    required this.subtitle,
    required this.ready,
    this.avatar,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: ready
            ? AvatarView(avatar: avatar, name: name)
            : const CircleAvatar(child: Icon(Icons.person_outline)),
        title: Text(name),
        subtitle: Text(subtitle),
        trailing: Icon(
          ready ? Icons.check_circle : Icons.hourglass_empty,
          color: ready ? Colors.greenAccent : Colors.white38,
        ),
      ),
    );
  }
}

class GarbaButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const GarbaButton({
    super.key,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 58,
      child: FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFD4A94F),
          foregroundColor: Colors.black,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}
