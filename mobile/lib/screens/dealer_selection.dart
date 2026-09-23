// Вскрытие карт до первого туза — кто раздаёт.
part of '../main.dart';

class DealerSelectionScreen extends StatefulWidget {
  final String roomCode;
  final String currentPlayerId;

  const DealerSelectionScreen({
    super.key,
    required this.roomCode,
    required this.currentPlayerId,
  });

  @override
  State<DealerSelectionScreen> createState() => _DealerSelectionScreenState();
}

class _DealerSelectionScreenState extends State<DealerSelectionScreen> {
  Timer? pollTimer;
  Timer? revealTimer;
  Timer? returnTimer;
  late final RoomLink link;
  Map<String, dynamic>? room;
  int visibleCount = 0;
  bool cardsReturned = false;
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

  String roomUrl() => '$apiBase/rooms/${widget.roomCode}';

  Future<void> refreshRoom() async {
    try {
      final response =
          await http.get(Uri.parse(roomUrl()), headers: authHeaders());
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
                returnTimer?.cancel();
                returnTimer = Timer(const Duration(milliseconds: 1600), () {
                  if (mounted) setState(() => cardsReturned = true);
                });
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
        throw ApiFailure.fromResponse(response);
      }

      await refreshRoom();
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось продолжить');
    } finally {
      if (mounted) setState(() => continuing = false);
    }
  }

  @override
  void dispose() {
    pollTimer?.cancel();
    revealTimer?.cancel();
    returnTimer?.cancel();
    link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = room;
    if (data == null) {
      return Scaffold(
        appBar: backOnlyAppBar(),
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
    final players = ((data['players'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final cardsAtSeat = <String, List<Map<String, dynamic>>>{};
    if (!cardsReturned) {
      for (final card in shown) {
        cardsAtSeat
            .putIfAbsent(card['playerId'].toString(), () => [])
            .add(card);
      }
    }
    final myIndex = math.max(
      0,
      players.indexWhere((p) => p['id'].toString() == widget.currentPlayerId),
    );

    Widget seat(Map<String, dynamic> player) => SizedBox(
          width: 92,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(2),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF0B1620),
                  border: Border.all(
                    color: player['id'].toString() ==
                                game['dealerId'].toString() &&
                            cardsReturned
                        ? Colors.greenAccent
                        : const Color(0xFFD4A94F),
                    width: 2.5,
                  ),
                ),
                child: AvatarView(
                  avatar: player['avatar']?.toString(),
                  name: player['name'].toString(),
                  radius: 18,
                ),
              ),
              Container(
                width: 92,
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xEB101A22),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFB6812D)),
                ),
                child: Text(
                  player['name'].toString(),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
        );

    Widget revealPile(List<Map<String, dynamic>> cards) {
      final visible =
          cards.length > 3 ? cards.sublist(cards.length - 3) : cards;
      return SizedBox(
        width: 70,
        height: 72,
        child: Stack(
          alignment: Alignment.center,
          children: [
            for (var i = 0; i < visible.length; i++)
              Positioned(
                left: 8.0 + i * 9,
                child: Transform.rotate(
                  angle: (i - (visible.length - 1) / 2) * 0.10,
                  child: Transform.scale(
                    scale: 0.78,
                    child: SmallTrumpCard(
                      rank: visible[i]['rank'].toString(),
                      suit: visible[i]['suit'].toString(),
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.25),
            radius: 1.15,
            colors: [Color(0xFF102536), Color(0xFF07131B), Color(0xFF02070C)],
          ),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      padding: EdgeInsets.zero,
                      constraints:
                          const BoxConstraints.tightFor(width: 34, height: 34),
                      iconSize: 20,
                      icon: const Icon(Icons.arrow_back_ios_new),
                    ),
                    Expanded(
                      child: Text(
                        cardsReturned
                            ? 'ПЕРВЫМ РАЗДАЁТ $dealerName'
                            : finished
                                ? 'ТУЗ НАЙДЕН'
                                : 'ОПРЕДЕЛЯЕМ РАЗДАЮЩЕГО',
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFE6B74F),
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(width: 34),
                  ],
                ),
                const SizedBox(height: 4),
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final n = players.length;
                      final crowded = n >= 6;
                      return Stack(
                        children: [
                          const Positioned.fill(
                            child: CustomPaint(painter: KazakhTablePainter()),
                          ),
                          Align(
                            alignment: Alignment.center,
                            child: AnimatedSwitcher(
                              duration: const Duration(milliseconds: 500),
                              child: cardsReturned
                                  ? Container(
                                      key: const ValueKey('dealer-found'),
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 15,
                                        vertical: 10,
                                      ),
                                      decoration: BoxDecoration(
                                        color: const Color(0xEC0B1620),
                                        borderRadius: BorderRadius.circular(14),
                                        border: Border.all(
                                          color: Colors.greenAccent,
                                          width: 2,
                                        ),
                                      ),
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Text(
                                            'ПЕРВЫМ РАЗДАЁТ',
                                            style: TextStyle(
                                              color: Colors.white70,
                                              fontSize: 11,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                          Text(
                                            dealerName,
                                            style: const TextStyle(
                                              color: Color(0xFFE6B74F),
                                              fontSize: 20,
                                              fontWeight: FontWeight.w900,
                                            ),
                                          ),
                                        ],
                                      ),
                                    )
                                  : Column(
                                      key: const ValueKey('dealer-deck'),
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const TableDeckView(width: 48),
                                        const SizedBox(height: 6),
                                        Text(
                                          current == null
                                              ? 'Колода готова'
                                              : current['rank'].toString() ==
                                                      'A'
                                                  ? 'ТУЗ!'
                                                  : 'Карта для ${current['playerName']}',
                                          style: TextStyle(
                                            color:
                                                current?['rank'].toString() ==
                                                        'A'
                                                    ? Colors.greenAccent
                                                    : Colors.white70,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                      ],
                                    ),
                            ),
                          ),
                          for (var i = 0; i < n; i++)
                            ...() {
                              final k = (i - myIndex + n) % n;
                              final angle = -math.pi / 2 + 2 * math.pi * k / n;
                              final x = math.cos(angle);
                              final y = -math.sin(angle);
                              final seatAlignment = Alignment(
                                (x * (crowded ? 0.92 : 0.84)).clamp(-1.0, 1.0),
                                (y * (crowded ? 0.75 : 0.68)).clamp(-1.0, 1.0),
                              );
                              final cardAlignment =
                                  Alignment(x * 0.54, y * 0.50);
                              final player = players[i];
                              final cards =
                                  cardsAtSeat[player['id'].toString()] ??
                                      const [];
                              return <Widget>[
                                Align(
                                    alignment: seatAlignment,
                                    child: seat(player)),
                                if (cards.isNotEmpty)
                                  Align(
                                    alignment: cardAlignment,
                                    child: AnimatedSwitcher(
                                      duration:
                                          const Duration(milliseconds: 350),
                                      child: revealPile(cards),
                                    ),
                                  ),
                              ];
                            }(),
                        ],
                      );
                    },
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  cardsReturned
                      ? 'Карты вернулись в колоду'
                      : finished
                          ? 'Туз найден — возвращаем карты в колоду'
                          : 'Открываем по одной карте возле каждого игрока до первого туза',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white60, fontSize: 12),
                ),
                if (cardsReturned) ...[
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: isDealer && !continuing ? continueGame : null,
                    child: Text(
                      continuing
                          ? 'РАЗДАЁМ...'
                          : isDealer
                              ? 'ОТКРЫТЬ КАРТУ РАЗ И РАЗДАТЬ'
                              : 'РАЗДАЁТ $dealerName',
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
