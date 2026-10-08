// Создать комнату и войти по коду.
part of '../main.dart';

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
  // Время на ход: 20 или 40 секунд (RULES.md §13a).
  int turnSeconds = 20;
  // Запас на отлучку за игру: 1…5 минут (RULES.md §13, 08.10.2026).
  int absenceMinutes = 5;
  // Открытая — видна всем в «Открытых комнатах», войти можно без кода.
  bool isPublic = false;
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
          'turnSeconds': turnSeconds,
          'absenceMinutes': absenceMinutes,
          'isPublic': isPublic,
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
        throw ApiFailure.fromResponse(response);
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
      showGarbaError(context, e, prefix: 'Не удалось создать комнату');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
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
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: isPublic,
              onChanged: (v) => setState(() => isPublic = v),
              title: const Text(
                'Открытая комната',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                isPublic
                    ? 'Видна всем в «Открытых комнатах» — зайти может любой, без кода'
                    : 'Только по коду — для своих. Открыть можно и потом, в лобби',
              ),
            ),
            const SizedBox(height: 12),
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
            const SizedBox(height: 24),
            const Text(
              'Время на ход',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [20, 40].map((n) {
                return ChoiceChip(
                  label: Text('$n секунд'),
                  selected: turnSeconds == n,
                  onSelected: (_) => setState(() => turnSeconds = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            const Text(
              'Не успел — за игрока сходит игра: в торгах ПАС, в розыгрыше — любая допустимая карта',
              style: TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Сколько ждать отошедшего',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [1, 2, 3, 4, 5].map((n) {
                return ChoiceChip(
                  label: Text('$n мин'),
                  selected: absenceMinutes == n,
                  onSelected: (_) => setState(() => absenceMinutes = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Игрок пропал или не ходит — игра ждёт его $absenceMinutes мин за всю игру. '
              'Не вернулся — игра заканчивается, кон делят остальные',
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
        Uri.parse('$apiBase/rooms/${Uri.encodeComponent(roomId)}/join'),
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
        throw ApiFailure.fromResponse(response);
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
      showGarbaError(context, e, prefix: 'Не удалось войти');
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
      appBar: backOnlyAppBar(),
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
