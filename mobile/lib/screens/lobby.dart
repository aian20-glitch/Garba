// Лобби комнаты до старта.
part of '../main.dart';

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

  bool changingVisibility = false;

  // Открыть комнату для всех или закрыть обратно (только создатель, до старта).
  Future<void> setPublic(bool value) async {
    setState(() => changingVisibility = true);
    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/visibility'),
        headers: authHeaders(),
        body: jsonEncode({'isPublic': value}),
      );
      expectStatus(response, const [200]);
      applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e);
    } finally {
      if (mounted) setState(() => changingVisibility = false);
    }
  }

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
        throw ApiFailure.fromResponse(response);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось начать игру');
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
        throw ApiFailure.fromResponse(response);
      }
      if (!mounted) return;
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось выйти');
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
        appBar: backOnlyAppBar(),
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
        appBar: backOnlyAppBar(),
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
      appBar: backOnlyAppBar(),
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
            // Открытая комната — видна всем; создатель открывает и закрывает до старта.
            if (isCreator)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: room!['isPublic'] == true,
                onChanged: changingVisibility ? null : setPublic,
                title: const Text('Открытая комната'),
                subtitle: Text(
                  room!['isPublic'] == true
                      ? 'Видна всем — может зайти любой, без кода'
                      : 'Только по коду. Откройте, если не хватает игроков',
                ),
              )
            else if (room!['isPublic'] == true)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Открытая комната — может зайти любой',
                  style: TextStyle(color: Colors.white60),
                ),
              ),
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
                      onTap: () => openPlayerCard(context, p),
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
