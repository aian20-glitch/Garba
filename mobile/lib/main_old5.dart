import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

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

bool isRedSuit(String suit) =>
    suit == 'hearts' || suit == 'diamonds' || suit == '♥' || suit == '♦';

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
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'ГАРБА',
                    style: TextStyle(
                      fontSize: 38,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFD4A94F),
                    ),
                  ),
                  Text(
                    '🪙 10 000',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Казахская карточная онлайн-игра',
                style: TextStyle(color: Colors.white70),
              ),
              const Spacer(),
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
  bool loading = false;

  Future<void> createRoom() async {
    if (loading) return;
    setState(() => loading = true);

    const playerId = 'player-serik';

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'playerId': playerId,
          'name': 'Серик',
          'capacity': capacity,
        }),
      );

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
            currentPlayerId: playerId,
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
      body: Padding(
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
            const SizedBox(height: 28),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Комната создаётся на сервере. Список игроков обновляется автоматически.',
                  style: TextStyle(color: Colors.white70),
                ),
              ),
            ),
            const Spacer(),
            GarbaButton(
              label: loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ',
              onTap: createRoom,
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
  final nameController = TextEditingController(text: 'Игрок 2');
  bool loading = false;

  Future<void> joinRoom() async {
    final roomId = roomController.text.trim();
    final name = nameController.text.trim();

    if (roomId.isEmpty || name.isEmpty || loading) return;

    setState(() => loading = true);
    final playerId = 'player-${DateTime.now().millisecondsSinceEpoch}';

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/$roomId/join'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'playerId': playerId,
          'name': name,
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: roomId,
            currentPlayerId: playerId,
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
    nameController.dispose();
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
            TextField(
              controller: nameController,
              decoration: const InputDecoration(
                labelText: 'Имя игрока',
                border: OutlineInputBorder(),
              ),
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
  Map<String, dynamic>? room;
  bool starting = false;
  bool firstLoad = true;
  bool moved = false;

  @override
  void initState() {
    super.initState();
    refreshRoom();
    timer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => refreshRoom(),
    );
  }

  String roomUrl() =>
      '$apiBase/rooms/${widget.roomCode}?playerId=${Uri.encodeComponent(widget.currentPlayerId)}';

  Future<void> refreshRoom() async {
    try {
      final response = await http.get(Uri.parse(roomUrl()));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;

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
    } catch (_) {
      if (mounted && firstLoad) {
        setState(() => firstLoad = false);
      }
    }
  }

  Future<void> startGame() async {
    if (starting) return;
    setState(() => starting = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/start'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'playerId': widget.currentPlayerId}),
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

  @override
  void dispose() {
    timer?.cancel();
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
  Map<String, dynamic>? room;
  int visibleCount = 0;
  bool continuing = false;
  bool moved = false;

  @override
  void initState() {
    super.initState();
    refreshRoom();
    pollTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => refreshRoom(),
    );
  }

  String roomUrl() =>
      '$apiBase/rooms/${widget.roomCode}?playerId=${Uri.encodeComponent(widget.currentPlayerId)}';

  Future<void> refreshRoom() async {
    try {
      final response = await http.get(Uri.parse(roomUrl()));
      if (response.statusCode != 200) return;

      final data = jsonDecode(response.body) as Map<String, dynamic>;
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

        if (game['stage']?.toString() == 'bidding' && !moved) {
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
    } catch (_) {}
  }

  Future<void> continueGame() async {
    if (continuing) return;
    setState(() => continuing = true);

    try {
      final response = await http.post(
        Uri.parse(
          '$apiBase/rooms/${widget.roomCode}/dealer/continue',
        ),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'playerId': widget.currentPlayerId}),
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

  @override
  void initState() {
    super.initState();
    refreshRoom();
    timer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => refreshRoom(),
    );
  }

  String roomUrl() =>
      '$apiBase/rooms/${widget.roomCode}?playerId=${Uri.encodeComponent(widget.currentPlayerId)}';

  Future<void> refreshRoom() async {
    try {
      final response = await http.get(Uri.parse(roomUrl()));
      if (response.statusCode == 200 && mounted) {
        setState(() {
          room = jsonDecode(response.body) as Map<String, dynamic>;
        });
      }
    } catch (_) {}
  }

  Future<void> sendBid(String bid) async {
    if (sendingBid) return;
    setState(() => sendingBid = true);

    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/bid'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'playerId': widget.currentPlayerId,
          'bid': bid,
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = room;

    if (data == null) {
      return Scaffold(
        appBar: AppBar(title: Text('ГАРБА • #${widget.roomCode}')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final game = Map<String, dynamic>.from(data['game'] as Map);
    final dealerName = game['dealerName'].toString();
    final stage = game['stage'].toString();
    final trumpRaw = game['trumpCard'];
    final trumpCard = trumpRaw is Map
        ? Map<String, dynamic>.from(trumpRaw)
        : null;
    final activeBidderId = game['activeBidderId']?.toString();
    final hand = ((game['hand'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final bids = ((game['bids'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final players = (data['players'] as List)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    final myTurn =
        stage == 'bidding' && activeBidderId == widget.currentPlayerId;
    final capacity = (data['capacity'] as num).toInt();
    final isFourPlayers = capacity == 4;

    String activeName = '';
    if (activeBidderId != null) {
      final matches =
          players.where((p) => p['id'].toString() == activeBidderId);
      if (matches.isNotEmpty) {
        activeName = matches.first['name'].toString();
      }
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
              const SizedBox(height: 10),
              if (trumpCard != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF13232E),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: const Color(0xFFD4A94F),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text(
                        'КОЗЫРЬ: ',
                        style: TextStyle(
                          fontWeight: FontWeight.w900,
                          color: Color(0xFFD4A94F),
                        ),
                      ),
                      SmallTrumpCard(
                        rank: trumpCard['rank'].toString(),
                        suit: trumpCard['suit'].toString(),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 10),
              Text(
                stage == 'bidding_done'
                    ? 'Торги завершены'
                    : myTurn
                        ? 'ВАШ ХОД'
                        : 'Ход: $activeName',
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
                      ...players.map((p) {
                        final pId = p['id'].toString();
                        final bidMatches =
                            bids.where((b) => b['playerId'].toString() == pId);

                        final bidText = bidMatches.isEmpty
                            ? (pId == activeBidderId ? 'ДУМАЕТ...' : '—')
                            : bidMatches.last['bid'].toString();

                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Row(
                            children: [
                              Icon(
                                pId == activeBidderId
                                    ? Icons.play_circle_fill
                                    : Icons.person,
                                size: 20,
                                color: pId == activeBidderId
                                    ? Colors.greenAccent
                                    : Colors.white60,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(p['name'].toString()),
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
                      const Spacer(),
                      if (stage == 'bidding_done')
                        const Text(
                          '✅ Все игроки сделали выбор.\nСледующим шагом определим победителя торгов и начнём розыгрыш.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white70),
                        )
                      else
                        Text(
                          isFourPlayers ? 'РАЗ / ПАС' : 'РАЗ / ДВА / ПАС',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFD4A94F),
                          ),
                        ),
                      const Spacer(),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 14),
              const Text(
                'ВАШИ 5 КАРТ',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: Colors.white70,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 128,
                child: hand.isEmpty
                    ? const Center(child: Text('Карты загружаются...'))
                    : ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: hand.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(width: 8),
                        itemBuilder: (_, index) {
                          final card = hand[index];
                          return SmallCard(
                            rank: card['rank'].toString(),
                            suit: card['suit'].toString(),
                          );
                        },
                      ),
              ),

              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed:
                          myTurn && !sendingBid ? () => sendBid('РАЗ') : null,
                      child: const Text('РАЗ'),
                    ),
                  ),
                  if (!isFourPlayers) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton(
                        onPressed:
                            myTurn && !sendingBid ? () => sendBid('ДВА') : null,
                        child: const Text('ДВА'),
                      ),
                    ),
                  ],
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed:
                          myTurn && !sendingBid ? () => sendBid('ПАС') : null,
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
          const Spacer(),
          Center(
            child: Text(
              symbol,
              style: TextStyle(
                fontSize: 70,
                color: red ? Colors.red.shade800 : Colors.black,
              ),
            ),
          ),
          const Spacer(),
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
