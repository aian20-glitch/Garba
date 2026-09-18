import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
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
  // checking — проверяем сохранённый аккаунт; needName — аккаунта нет, нужно имя.
  bool checking = true;
  bool needName = false;
  bool creating = false;
  String? error;

  @override
  void initState() {
    super.initState();
    checkAccount();
  }

  @override
  void dispose() {
    nameController.dispose();
    super.dispose();
  }

  Future<void> checkAccount() async {
    setState(() {
      checking = true;
      error = null;
    });

    await Session.load();
    if (Session.token.isEmpty) {
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
        body: jsonEncode({'name': name}),
      );
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
  // Баланс и незаконченная комната — с сервера (GET /me).
  int? balance;
  String? roomId;

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
      setState(() {
        balance = (me['balance'] as num).toInt();
        roomId = me['roomId']?.toString();
      });
    } catch (_) {
      // Нет связи — оставляем то, что уже показано.
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
              Text(
                Session.name,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              const Text(
                'Казахская карточная онлайн-игра',
                style: TextStyle(color: Colors.white70),
              ),
              const Spacer(),
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
              GarbaButton(label: 'РЕЙТИНГ', onTap: () {}),
              const SizedBox(height: 14),
              GarbaButton(label: 'ПРОФИЛЬ', onTap: () {}),
              const Spacer(),
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
  const JoinRoomScreen({super.key});

  @override
  State<JoinRoomScreen> createState() => _JoinRoomScreenState();
}

class _JoinRoomScreenState extends State<JoinRoomScreen> {
  final roomController = TextEditingController();
  bool loading = false;

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
            ...players.map((p) {
              final isOwner = p['id'].toString() == creatorId;
              return PlayerTile(
                name: p['name'].toString(),
                subtitle: isOwner ? 'Создатель • Готов' : 'Игрок • Готов',
                ready: true,
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
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () {},
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
                    children: ((tricks[i]['cards'] as List?) ?? const []).map((t) {
                      final card = Map<String, dynamic>.from((t as Map)['card'] as Map);
                      final suit = card['suit'].toString();
                      return Container(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF4EFE2),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '${card['rank']}${suitSymbol(suit)}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: isRedSuit(suit) ? Colors.red.shade800 : Colors.black,
                          ),
                        ),
                      );
                    }).toList(),
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

    final myBalance = balanceOf(widget.currentPlayerId);

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

    const labelStyle = TextStyle(
      fontWeight: FontWeight.w900,
      color: Color(0xFFD4A94F),
    );

    final Widget footer;
    if (isRoomDone) {
      // Итог комнаты: кто сколько выиграл или проиграл за всю игру.
      final rows = players.map((p) {
        final start = (p['startBalance'] as num?)?.toInt() ?? 0;
        final end = (p['balance'] as num?)?.toInt() ?? 0;
        return (name: p['name'].toString(), start: start, end: end, diff: end - start);
      }).toList()
        ..sort((a, b) => b.diff.compareTo(a.diff));

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
            final isWinner = r == rows.first && r.diff > 0;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
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
      if (isRefill && lastAnte['skipped'] == true) {
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
      footer = Text(
        '$why\n$anteText\nРаздаёт $dealerName.',
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

    return Scaffold(
      appBar: AppBar(title: Text('ГАРБА • #${widget.roomCode}')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Раздающий: $dealerName',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFFD4A94F),
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  Text(
                    'КОН: ${fmtCoins(kon)}',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    'Баланс: ${fmtCoins(myBalance)}',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Colors.white70,
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
                    'Не вернётся — игра прекращается, кон делится поровну между оставшимися.',
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
              if (openCard != null || razSuit != null || trumpSuit != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF13232E),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFD4A94F)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (openCard != null) ...[
                        const Text('ОТКРЫТА: ', style: labelStyle),
                        SmallTrumpCard(
                          rank: openCard['rank'].toString(),
                          suit: openCard['suit'].toString(),
                        ),
                        const SizedBox(width: 18),
                      ],
                      // До конца торгов известна только масть РАЗ.
                      // После торгов — итоговый козырь (ДВА может его сменить).
                      if (trumpSuit != null) ...[
                        const Text('КОЗЫРЬ: ', style: labelStyle),
                        SuitBadge(suit: trumpSuit),
                      ] else if (razSuit != null) ...[
                        const Text('РАЗ: ', style: labelStyle),
                        SuitBadge(suit: razSuit),
                      ],
                    ],
                  ),
                ),
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
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0C3A2F),
                    borderRadius: BorderRadius.circular(26),
                    border: Border.all(
                      color: const Color(0xFFD4A94F),
                      width: 2,
                    ),
                  ),
                  // Прокрутка: при 7 игроках, взятке и истории взяток стол не влезает
                  // по высоте на телефон.
                  child: SingleChildScrollView(
                    child: Column(
                    children: [
                      const Text(
                        'ИГРОВОЙ СТОЛ',
                        style: TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 22,
                        ),
                      ),
                      const SizedBox(height: 12),
                      // Игроки идут в порядке мест за столом против часовой стрелки.
                      ...players.map((p) {
                        final pId = p['id'].toString();
                        final isMain = mainIds.contains(pId);
                        final isActive = pId == actorId;
                        final bidMatches =
                            bids.where((b) => b['playerId'].toString() == pId);

                        // В торгах справа — заявка, в розыгрыше — взятки.
                        final String bidText;
                        if (isPlaying || isRoundDone) {
                          bidText = 'взяток: ${tricksWon[pId] ?? 0}';
                        } else if (bidMatches.isEmpty) {
                          bidText = isActive ? 'ДУМАЕТ...' : '—';
                        } else {
                          final said = bidMatches.last['bid'].toString();
                          // Свою масть ДВА игрок видит, остальные — просто «ДВА».
                          bidText = said == 'ДВА' &&
                                  pId == widget.currentPlayerId &&
                                  myDvaSuit != null
                              ? 'ДВА ${suitSymbol(myDvaSuit)}'
                              : said;
                        }

                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Row(
                            children: [
                              Icon(
                                isMain
                                    ? Icons.star
                                    : isActive
                                        ? Icons.play_circle_fill
                                        : Icons.person,
                                size: 20,
                                color: isMain
                                    ? const Color(0xFFD4A94F)
                                    : isActive
                                        ? Colors.greenAccent
                                        : Colors.white60,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      pId == dealerId
                                          ? '${p['name']}  • раздаёт'
                                          : p['name'].toString(),
                                    ),
                                    Text(
                                      '🪙 ${fmtCoins(balanceOf(pId))}',
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: Colors.white54,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                bidText,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  color: Color(0xFFD4A94F),
                                ),
                              ),
                            ],
                          ),
                        );
                      }),
                      const SizedBox(height: 16),
                      footer,
                    ],
                    ),
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
                Text(
                  myTurn
                      ? 'Нажмите на карту, чтобы сходить'
                      : 'Ходит $activeName',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: myTurn ? Colors.greenAccent : Colors.white60,
                  ),
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

  const PlayerTile({
    super.key,
    required this.name,
    required this.subtitle,
    required this.ready,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          child: Icon(ready ? Icons.person : Icons.person_outline),
        ),
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
