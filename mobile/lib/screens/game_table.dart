// Игровой стол: торги, розыгрыш, итоги.
part of '../main.dart';

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

    // Пока пауза или голосование «закончить игру» — перерисовываем раз в секунду,
    // чтобы шёл обратный отсчёт.
    final gameRaw = data['game'];
    if (data['pause'] is Map ||
        (gameRaw is Map && (gameRaw['endVote'] is Map || gameRaw['turnSecondsLeft'] != null))) {
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

  // Главный сдаётся — признаёт поражение в раздаче (RULES.md §10.7). Сначала спрашиваем.
  // twoMains — главных двое: сдавшийся доигрывает как обычный противник.
  Future<void> confirmConcede(int loss, bool twoMains) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Сдаться?'),
        content: Text(
          'Вы признаёте поражение в этой раздаче.\n'
          'Положите в кон ${fmtCoins(loss)} — как при обычном проигрыше.'
          '${twoMains ? '\nВторой главный доигрывает, а вы кладёте карты как обычный противник.' : ''}',
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
    // Время на ход (RULES.md §13a): сколько секунд осталось тому, кого ждём.
    final turnLeftRaw = (game['turnSecondsLeft'] as num?)?.toInt();
    final turnLeft = turnLeftRaw == null
        ? null
        : math.max(0, turnLeftRaw - DateTime.now().difference(pauseReceivedAt).inSeconds);
    final awaitedIds = ((game['awaitedIds'] as List?) ?? const [])
        .map((e) => e.toString())
        .toSet();
    // Я «ушёл» (два хода подряд за меня сходил таймер) — нужно нажать «Я ЗДЕСЬ».
    final pauseRaw0 = data['pause'];
    final iAmAway = pauseRaw0 is Map &&
        ((pauseRaw0['players'] as List?) ?? const []).any((p) =>
            (p as Map)['id'].toString() == widget.currentPlayerId && p['reason'] == 'away');

    // Закончить игру по согласию (RULES.md §12.3).
    final endVoteRaw = game['endVote'];
    final endVote = endVoteRaw is Map ? Map<String, dynamic>.from(endVoteRaw) : null;
    final myEndVote = game['myEndVote']?.toString();
    final canProposeEnd = game['myCanProposeEnd'] == true;
    final lastEndVoteRaw = game['lastEndVote'];
    final lastEndVote =
        lastEndVoteRaw is Map ? Map<String, dynamic>.from(lastEndVoteRaw) : null;

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
          // Кон никто не мог взять или все устали и согласились закончить —
          // его поделили поровну (RULES.md §12.2, §12.3).
          if ((game['closeReason'] == 'nobody_can_play' ||
                  game['closeReason'] == 'agreed_end') &&
              game['split'] is Map)
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
                  '${game['closeReason'] == 'agreed_end' ? 'Все согласились закончить игру. Кон ${fmtCoins(splitKon)}' : 'Кон ${fmtCoins(splitKon)} не по карману никому'} — '
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

    // Главный видит, что не выиграет, — может сдаться в любой момент розыгрыша (§10.7).
    // Разрешает и считает, сколько он положит в кон, сервер.
    final canConcede = game['myCanConcede'] == true;
    final concedeLoss = (game['myConcedeLoss'] as num?)?.toInt() ?? 0;
    final concededIds = ((game['concededIds'] as List?) ?? const [])
        .map((e) => e.toString())
        .toSet();
    Widget concedeButton() => Padding(
          padding: const EdgeInsets.only(top: 6),
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.redAccent,
              side: const BorderSide(color: Colors.redAccent),
            ),
            onPressed: sendingSpecial ? null : () => confirmConcede(concedeLoss, mains.length > 1),
            icon: const Icon(Icons.flag),
            label: Text('СДАТЬСЯ (в кон ${fmtCoins(concedeLoss)})'),
          ),
        );

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
          bidText = concededIds.contains(pId)
              ? '$label · сдался'
              : '$label · взяток ${tricksWon[pId] ?? 0}';
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
                // Стол в казахском стиле «Көк»: небесное сукно, деревянный бортик
                // с золотыми рогами қошқар мүйіз, шаңырақ в центре.
                const Positioned(
                  left: 10,
                  right: 10,
                  top: 26,
                  bottom: 36,
                  child: CustomPaint(painter: KazakhTablePainter()),
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
                  ? 'сдался — признал поражение'
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
                      color: const Color(0xFF0B4A60),
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
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        '${pausedPlayers.map((p) => '${p['name']} ${p['reason'] == 'away' ? 'отошёл (два хода за него сходил таймер)' : 'отключился'} — ждём ${countdown(p)}').join('\n')}\n'
                        'Не вернётся — игра прекращается, кон делится поровну между оставшимися, '
                        'а ушедший теряет 1.0 рейтинга.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.orangeAccent, fontSize: 13),
                      ),
                      // Это я отошёл — одно нажатие, и игра продолжается (§13a).
                      if (iAmAway)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: FilledButton(
                            onPressed: sendingSpecial ? null : () => sendSpecial('back', {}),
                            child: const Text('Я ЗДЕСЬ'),
                          ),
                        ),
                    ],
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
                // 20 секунд на ход (§13a): не успел — за тебя сходит сервер.
                turnLeft != null && !paused && !isRoomDone
                    ? '$headline · $turnLeft'
                    : headline,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: awaitedIds.contains(widget.currentPlayerId) &&
                          turnLeft != null &&
                          turnLeft <= 5
                      ? Colors.redAccent
                      : myTurn
                          ? Colors.greenAccent
                          : Colors.white,
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
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Кто-то предложил закончить игру — все отвечают, решает единогласие.
                    if (endVote != null)
                      Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: const Color(0xFF13232E),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFD4A94F)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              '${endVote['proposerName']} предлагает закончить игру',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
                            ),
                            Text(
                              'Кон поделят поровну. Нужно согласие всех: '
                              '${(endVote['yesIds'] as List).length} из ${players.length} · '
                              '${countdown({'secondsLeft': endVote['secondsLeft']})}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 12, color: Colors.white70),
                            ),
                            const SizedBox(height: 8),
                            if (myEndVote == null)
                              Row(
                                children: [
                                  Expanded(
                                    child: FilledButton(
                                      onPressed: sendingSpecial
                                          ? null
                                          : () => sendSpecial('end-game', {'choice': 'yes'}),
                                      child: const Text('ДА, ЗАКОНЧИТЬ'),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: OutlinedButton(
                                      onPressed: sendingSpecial
                                          ? null
                                          : () => sendSpecial('end-game', {'choice': 'no'}),
                                      child: const Text('НЕТ, ИГРАЕМ'),
                                    ),
                                  ),
                                ],
                              )
                            else
                              const Text(
                                'Вы согласны. Ждём остальных.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Colors.white70),
                              ),
                          ],
                        ),
                      ),
                    if (endVote == null && lastEndVote != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Text(
                          lastEndVote['result'] == 'rejected'
                              ? '${lastEndVote['byName'] ?? 'Кто-то'} против — играем дальше'
                              : 'Не все ответили — играем дальше',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white60, fontSize: 13),
                        ),
                      ),
                    FilledButton(
                      onPressed: isDealer && !dealing && !paused && endVote == null
                          ? dealCards
                          : null,
                      child: Text(
                        dealing
                            ? 'РАЗДАЁМ...'
                            : isDealer
                                ? (isRoundDone
                                    ? 'РАЗДАТЬ СЛЕДУЮЩУЮ'
                                    : 'РАЗДАТЬ КАРТЫ')
                                : 'РАЗДАЁТ $dealerName',
                      ),
                    ),
                    if (canProposeEnd)
                      TextButton.icon(
                        onPressed: sendingSpecial
                            ? null
                            : () => sendSpecial('end-game', {'choice': 'yes'}),
                        icon: const Icon(Icons.bedtime_outlined, size: 18),
                        label: const Text('ЗАКОНЧИТЬ ИГРУ'),
                      ),
                  ],
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
