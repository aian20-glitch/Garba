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
  bool sendingReady = false;
  bool addingBots = false;
  // Сервер ответил «комнаты нет» — показываем это вместо вечной загрузки.
  bool notFound = false;
  bool firstLoad = true;
  bool moved = false;
  // «ГОТОВ» (23.09.2026): когда пришёл отсчёт и была ли проверка в прошлый раз —
  // чтобы сигнал прозвучал один раз, в момент, когда комната набралась.
  DateTime readyReceivedAt = DateTime.now();
  bool hadReadyCheck = false;
  Timer? readyTicker;
  // Смайлики в лобби (RULES.md §14, 25.09.2026): кто что отправил — на его аватарке 3 секунды.
  final flyingEmoji = <String, String>{};
  int lastReactionId = 0;
  bool firstReactions = true;

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
      Timer(reactionShowTime(emoji), () {
        if (!mounted) return;
        setState(() {
          if (flyingEmoji[playerId] == emoji) flyingEmoji.remove(playerId);
        });
      });
    }
    firstReactions = false;
  }

  Future<void> sendReaction(String emoji) async {
    try {
      await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/react'),
        headers: authHeaders(),
        body: jsonEncode({'emoji': emoji}),
      ));
    } catch (_) {
      // Не дошло — не беда, это просто смайлик.
    }
  }

  @override
  void initState() {
    super.initState();
    // Обновления приходят сами по сокету; опрос — только пока сокет отвалился.
    link = RoomLink(
      roomCode: widget.roomCode,
      onRoom: applyRoom,
      onError: (error) {
        if (error == 'room not found' && mounted) setState(() => notFound = true);
      },
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
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/visibility'),
        headers: authHeaders(),
        body: jsonEncode({'isPublic': value}),
      ));
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
      final response = await apiRequest(http.get(Uri.parse(roomUrl()), headers: authHeaders()));
      if (response.statusCode == 200) {
        applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
      } else if (response.statusCode == 404 && mounted) {
        setState(() => notFound = true);
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
    if (isStaleRoom(room, data)) return;

    applyReactions((data['reactions'] as List?) ?? const []);
    final hasReadyCheck = data['readyCheck'] is Map;
    setState(() {
      room = data;
      firstLoad = false;
      readyReceivedAt = DateTime.now();
    });

    // Комната набралась — звук и вибрация, чтобы игрок, занятый другим, успел нажать.
    final imIn = ((data['players'] as List?) ?? const [])
        .any((p) => (p as Map)['id'].toString() == widget.currentPlayerId);
    if (hasReadyCheck && !hadReadyCheck && imIn) {
      GarbaSounds.ready();
      HapticFeedback.heavyImpact();
    }
    hadReadyCheck = hasReadyCheck;
    // Секундный отсчёт — и для «ГОТОВ», и для закрытия лобби через 10 минут.
    if (hasReadyCheck || data['lobbySecondsLeft'] is num) {
      readyTicker ??= Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else {
      readyTicker?.cancel();
      readyTicker = null;
    }

    // Игра началась — за стол, только если я за ним сижу: выбывшего за «ГОТОВ» не
    // перебрасываем во вскрытие чужой игры (28.09.2026).
    if (data['status']?.toString() == 'started' &&
        data['game'] is Map &&
        imIn &&
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

  // Пересесть на свободное место — до начала игры (RULES.md §2). Решает сервер.
  Future<void> changeSeat(int seat) async {
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/seat'),
        headers: authHeaders(),
        body: jsonEncode({'seat': seat}),
      ));
      expectStatus(response, const [200]);
      applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось пересесть');
    }
  }

  // Лобби — сразу стол (24.09.2026): я внизу, остальные по кругу против часовой, как за
  // игрой; свободный стул можно нажать и пересесть.
  Widget seatTable({
    required List<Map<String, dynamic>> players,
    required int capacity,
    required String creatorId,
    required Set<String>? readyIds,
    required int readyLeft,
  }) {
    const gold = Color(0xFFD4A94F);
    final me = players.where((p) => p['id'].toString() == widget.currentPlayerId).firstOrNull;
    final mySeat = (me?['seat'] as num?)?.toInt() ?? 0;
    Map<String, dynamic>? atSeat(int seat) => players
        .where((p) => ((p['seat'] as num?)?.toInt() ?? players.indexOf(p)) == seat)
        .firstOrNull;

    Widget seatView(int seat) {
      final p = atSeat(seat);
      if (p == null) {
        return GestureDetector(
          onTap: me == null ? null : () => changeSeat(seat),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0x55000000),
                  border: Border.all(color: Colors.white38, width: 2),
                ),
                child: const Icon(Icons.event_seat, color: Colors.white54, size: 24),
              ),
              const SizedBox(height: 4),
              const Text('Свободно', style: TextStyle(fontSize: 11, color: Colors.white70)),
            ],
          ),
        );
      }
      final id = p['id'].toString();
      final ready = readyIds?.contains(id);
      return GestureDetector(
        onTap: () => openPlayerCard(context, p),
        child: SizedBox(
          width: 92,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Рамка из магазина (§17) — вокруг кольца «готов», смайлики и фразы — поверх рамки.
              Stack(
                clipBehavior: Clip.none,
                children: [
                  framed(
                    Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: ready == null
                              ? (id == widget.currentPlayerId ? gold : const Color(0xFF3A4A55))
                              : ready
                                  ? Colors.greenAccent
                                  : Colors.white38,
                          width: 2.5,
                        ),
                      ),
                      child: AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 21),
                    ),
                    diameter: 51,
                    frame: p['frame']?.toString(),
                  ),
                  if (flyingEmoji[id] case final emoji? when !isPhrase(emoji))
                    Positioned(
                      left: -1,
                      top: -1,
                      right: -1,
                      bottom: -1,
                      child: AvatarEmoji(key: ValueKey('${id}_${emoji}_$lastReactionId'), emoji: emoji),
                    ),
                  if (flyingEmoji[id] case final phrase? when isPhrase(phrase))
                    Positioned(
                      left: -70,
                      right: -70,
                      top: -26,
                      child: Center(
                        child: PhraseBubble(key: ValueKey('${id}_${phrase}_$lastReactionId'), text: phrase),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 3),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xF0121A22),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFB6812D)),
                ),
                child: Column(
                  children: [
                    Text(
                      p['name'].toString(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      // Имя цветом уровня рейтинга (11.10.2026).
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: ratingColor(p['rating'])),
                    ),
                    if (ready == null)
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (id == creatorId)
                              const Text('Создатель · ', style: TextStyle(fontSize: 10, color: gold)),
                            RatingText(p['rating'], fontSize: 10),
                          ],
                        ),
                      )
                    else
                      Text(
                        ready ? 'готов' : 'ждём «ГОТОВ»',
                        style: TextStyle(
                          fontSize: 10,
                          color: ready ? Colors.greenAccent : gold,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    }

    return LayoutBuilder(builder: (context, box) {
      return SizedBox(
        width: box.maxWidth,
        height: box.maxHeight,
        child: Stack(
          children: [
            const Positioned.fill(child: KazakhTable()),
            Align(
              alignment: const Alignment(0, -0.2),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '${players.length} / $capacity',
                    style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900),
                  ),
                  Text(
                    readyIds == null
                        ? (players.length < capacity ? 'ждём игроков' : '')
                        : '«ГОТОВ» · $readyLeft',
                    style: const TextStyle(color: gold, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
            Positioned(right: 10, bottom: 10, child: EmojiButton(onSend: sendReaction)),
            for (var seat = 0; seat < capacity; seat++)
              () {
                // 0 — я внизу; следующее место (сосед справа) — правее, дальше по кругу.
                final k = (seat - mySeat + capacity) % capacity;
                final angle = -math.pi / 2 + 2 * math.pi * k / capacity;
                return Align(
                  alignment: Alignment(math.cos(angle) * 0.82, -math.sin(angle) * 0.8),
                  child: seatView(seat),
                );
              }(),
          ],
        ),
      );
    });
  }

  // «ГОТОВ»: нажали все — игра начнётся сама (решает сервер).
  Future<void> sendReady() async {
    if (sendingReady) return;
    setState(() => sendingReady = true);

    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/ready'),
        headers: authHeaders(),
        body: jsonEncode({}),
      ));
      expectStatus(response, const [200]);
      applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось отметиться');
    } finally {
      if (mounted) setState(() => sendingReady = false);
    }
  }

  // «ДОБАВИТЬ БОТОВ» (27.09.2026): сервер сажает ботов на все свободные места и сам
  // играет за них. Только создатель, только в лобби.
  Future<void> addBots() async {
    if (addingBots) return;
    setState(() => addingBots = true);
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/bots'),
        headers: authHeaders(),
        body: jsonEncode({}),
      ));
      expectStatus(response, const [200]);
      applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось добавить ботов');
    } finally {
      if (mounted) setState(() => addingBots = false);
    }
  }

  // Выйти из комнаты, пока игра не началась. Если выходит создатель —
  // сервер закрывает комнату для всех.
  Future<void> leaveRoom() async {
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/leave'),
        headers: authHeaders(),
        body: jsonEncode({}),
      ));
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
    readyTicker?.cancel();
    link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (room == null) {
      return Scaffold(
        appBar: backOnlyAppBar(),
        body: Center(
          child: notFound
              ? const Text('Комната не найдена — возможно, она уже закрыта')
              : firstLoad
                  ? const CircularProgressIndicator()
                  : const Text('Нет связи с сервером'),
        ),
      );
    }

    final tournament = room!['tournament'] is Map ? Map<String, dynamic>.from(room!['tournament'] as Map) : null;

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
              Text(
                tournament != null
                    ? 'Турнирный стол не собрался — играть не будут'
                    : room!['lobbyTimedOut'] == true
                    ? 'Игра не началась за 10 минут — комната закрыта'
                    : ((room!['readyDroppedIds'] as List?) ?? const []).isNotEmpty
                        ? 'Никто не нажал «ГОТОВ» — комната закрыта'
                        : 'Создатель закрыл комнату',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
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

    // Не нажал «ГОТОВ» за 30 секунд — сервер вывел из комнаты, место ждёт других.
    final droppedMe = ((room!['readyDroppedIds'] as List?) ?? const [])
            .any((id) => id.toString() == widget.currentPlayerId) &&
        !players.any((p) => p['id'].toString() == widget.currentPlayerId);
    if (droppedMe) {
      return Scaffold(
        appBar: backOnlyAppBar(),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              const Text(
                'Вы не нажали «ГОТОВ» за 30 секунд',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              Text(
                tournament != null
                    ? 'Ваше место освободилось, регистрация в турнире осталась. Сыграть свой стол '
                        'всё равно нужно до конца отбора — иначе бан 24 часа и −1.5 рейтинга.'
                    : 'Вы вышли из комнаты — ваше место ждёт другого игрока. '
                        'Можно зайти снова, если место ещё свободно.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
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

    // Игра началась, а меня за столом нет (выбыл за «ГОТОВ» или ушёл) — чужая игра.
    if (room!['status']?.toString() == 'started' &&
        !players.any((p) => p['id'].toString() == widget.currentPlayerId)) {
      if (tournament != null) {
        return const RoomClosedScreen(
          title: 'Стол начался без вас',
          text: 'Выберите другой стол на экране «ТУРНИР». Не сыграете свой стол до конца отбора — '
              'бан 24 часа и −1.5 рейтинга.',
        );
      }
      return const RoomClosedScreen(
        title: 'Игра началась без вас',
        text: 'За этим столом уже играют. Если освободится место — комната появится '
            'в «Открытых комнатах», или друг позовёт вас снова.',
      );
    }

    final readyCheck = room!['readyCheck'] is Map
        ? Map<String, dynamic>.from(room!['readyCheck'] as Map)
        : null;
    final readyIds = ((readyCheck?['readyIds'] as List?) ?? const [])
        .map((e) => e.toString())
        .toSet();
    final iAmReady = readyIds.contains(widget.currentPlayerId);
    final readyLeft = readyCheck == null
        ? 0
        : math.max(
            0,
            (readyCheck['secondsLeft'] as num).toInt() -
                DateTime.now().difference(readyReceivedAt).inSeconds,
          );

    // Игра не началась за 10 минут — сервер закроет лобби сам.
    final lobbyLeft = room!['lobbySecondsLeft'] is num
        ? math.max(
            0,
            (room!['lobbySecondsLeft'] as num).toInt() -
                DateTime.now().difference(readyReceivedAt).inSeconds,
          )
        : null;

    final isCreator = creatorId == widget.currentPlayerId;

    return Scaffold(
      appBar: backOnlyAppBar(),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Код комнаты и, справа, сколько осталось до автозакрытия лобби.
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Expanded(
                  child: Text(
                    tournament != null
                        ? (tournament['stage'] == 'final' ? '🏆 Финал турнира' : '🏆 Турнир · стол №${tournament['tableNo']}')
                        : 'Код комнаты: ${widget.roomCode}',
                    style: const TextStyle(
                      fontSize: 20,
                      color: Color(0xFFD4A94F),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (lobbyLeft != null && readyCheck == null)
                  Text(
                    'закроется ${lobbyLeft ~/ 60}:${(lobbyLeft % 60).toString().padLeft(2, '0')}',
                    style: TextStyle(
                      fontSize: 12,
                      color: lobbyLeft <= 60 ? Colors.redAccent : Colors.white60,
                    ),
                  ),
              ],
            ),
            if (room!['practice'] == true) const PracticeBanner(),
            // Условия комнаты — их выбрал создатель.
            if (room!['settings'] is Map)
              Builder(builder: (_) {
                final s = Map<String, dynamic>.from(room!['settings'] as Map);
                int v(String k) => (s[k] as num?)?.toInt() ?? 0;
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    tournament != null
                        ? 'Взнос ${fmtCoins(v('ante'))} · ход ${s['turnSeconds']} с · ждём ${s['absenceMinutes']} мин · '
                            'пустых раздач ${v('emptyLimit')} · КОН с ×${v('konThreshold')}\n'
                            'Стол играет до 20 минут или пока не останется трое. Начнётся сам, когда все сядут.'
                        : 'Взнос ${fmtCoins(v('ante'))} · вход от ${fmtCoins(v('minBalance'))} · ход ${s['turnSeconds'] ?? 20} с · ждём ${s['absenceMinutes'] ?? 5} мин\n'
                            'Пустых раздач ${v('emptyLimit')} · КОН с ×${v('konThreshold')}\n'
                            'Время игры: ${fmtTimeLimit(s['timeLimitMinutes'])}${s['timeLimitMinutes'] is num ? ' — пойдёт с первой раздачи' : ''}',
                    style: const TextStyle(color: Colors.white60, fontSize: 13),
                  ),
                );
              }),
            // «За столом один игрок фиолетового уровня» (11.10.2026, вместо «ТОП-N»).
            if (levelsBanner(players) case final banner?) ...[
              const SizedBox(height: 6),
              banner,
            ],
            // «В игре есть победитель турнира 🏆» (§19.12) — перед обычной игрой.
            if (room!['winnerBanner'] is String) ...[
              const SizedBox(height: 6),
              WinnerBanner(text: room!['winnerBanner'].toString()),
            ],
            // Турнир: казна; последние минуты — пустые места займут боты (§19.5).
            if (tournament != null) ...[
              TournamentTableBar(tournament: tournament, receivedAt: readyReceivedAt),
              if (tournament['lastCall'] == true || ((tournament['reserveBots'] as num?) ?? 0) > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    tournament['lastCall'] == true
                        ? 'Последние минуты отбора: потом «ГОТОВ», пустые места займут боты'
                        : 'Ещё ${tournament['reserveBots']} места займут боты, когда сядут все финалисты',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.orangeAccent, fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ),
            ],
            // Мои монеты: на столе, всего и рейтинг (09.10.2026).
            if (myWalletBar(room!) case final bar?) ...[
              const SizedBox(height: 8),
              bar,
            ],
            // Открытая комната — видна всем; создатель открывает и закрывает до старта.
            if (isCreator)
              SwitchListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: room!['isPublic'] == true,
                onChanged: changingVisibility ? null : setPublic,
                title: Text(
                  room!['isPublic'] == true
                      ? 'Открытая: видна всем, без кода'
                      : 'Закрытая: только по коду',
                ),
              )
            else if (room!['isPublic'] == true)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  'Открытая комната — может зайти любой',
                  style: TextStyle(color: Colors.white60, fontSize: 13),
                ),
              ),
            const SizedBox(height: 8),
            // Лобби — стол: сразу видно, кто где сидит, свободный стул — пересесть.
            Expanded(
              child: seatTable(
                players: players,
                capacity: capacity,
                creatorId: creatorId,
                readyIds: readyCheck == null ? null : readyIds,
                readyLeft: readyLeft,
              ),
            ),
            const SizedBox(height: 8),
            // Турнир: позвать любого участника (§19.3); обычная комната — ссылка и друзья.
            if (tournament != null)
              OutlinedButton.icon(
                onPressed: () => showTournamentInviteSheet(context, widget.roomCode, null),
                icon: const Icon(Icons.group_add, size: 18),
                label: const Text('ПРИГЛАСИТЬ УЧАСТНИКОВ'),
              )
            else
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => shareInvite(
                      text: 'Играем в ГАРБУ! Заходи в комнату #${widget.roomCode}:',
                      link: roomLink(widget.roomCode),
                      extra: 'Если ссылка не открылась — введи код комнаты ${widget.roomCode} в приложении.',
                    ),
                    icon: const Icon(Icons.share, size: 18),
                    label: const Text('ССЫЛКА'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => showFriendInviteSheet(context, widget.roomCode),
                    icon: const Icon(Icons.group_add, size: 18),
                    label: const Text('ДРУЗЬЯ'),
                  ),
                ),
              ],
            ),
            // Людей мало — создатель сажает ботов на свободные места, играют они сами.
            if (isCreator && readyCheck == null && players.length < capacity) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: addingBots ? null : addBots,
                icon: const Icon(Icons.smart_toy_outlined),
                label: Text('БОТЫ (${capacity - players.length}) · ТРЕНИРОВКА'),
              ),
            ],
            const SizedBox(height: 4),
            // Комната набралась — у всех «ГОТОВ» с отсчётом; нажали все — игра начнётся сама.
            if (readyCheck == null)
              const SizedBox.shrink()
            else if (iAmReady)
              FilledButton.icon(
                onPressed: null,
                icon: const Icon(Icons.check_circle),
                label: Text('ВЫ ГОТОВЫ · ждём остальных ${readyIds.length} / $capacity · $readyLeft'),
              )
            else
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: readyLeft <= 10 ? Colors.redAccent : Colors.green,
                  minimumSize: const Size.fromHeight(56),
                ),
                onPressed: sendingReady ? null : sendReady,
                icon: const Icon(Icons.check),
                label: Text(
                  'ГОТОВ · $readyLeft',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
              ),
            TextButton(
              onPressed: leaveRoom,
              child: Text(tournament != null ? 'ВСТАТЬ ИЗ-ЗА СТОЛА' : isCreator ? 'ЗАКРЫТЬ КОМНАТУ' : 'ВЫЙТИ ИЗ КОМНАТЫ'),
            ),
          ],
        ),
      ),
    );
  }
}
