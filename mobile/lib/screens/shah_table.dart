// ШАХ (ветка shah, этап 3, 04.11.2026): игровой стол. Стиль — как стол Гарбы («Көк»): круглый
// стол, я внизу, остальные против часовой. В центре — взятка столбиками (заход и накрытия),
// колода и козырь. Внизу — моя рука: выбираю карты, «ЗАЙТИ» / «ПОБИТЬ» / «НЕ БИТЬ» / «РУБАШКОЙ».
// Что можно — решает сервер (myLeadOptions, myBeatOptions, myMin); приложение только показывает.
part of '../main.dart';

class ShahTableScreen extends StatefulWidget {
  final String roomCode;
  // Зритель (§18 Гарбы, «как в Гарбе»): без руки и без кнопок.
  final bool spectator;

  const ShahTableScreen({super.key, required this.roomCode, this.spectator = false});

  @override
  State<ShahTableScreen> createState() => _ShahTableScreenState();
}

class _ShahTableScreenState extends State<ShahTableScreen> {
  late final RoomLink link;
  Timer? pollTimer;
  Timer? ticker;
  Map<String, dynamic>? room;
  DateTime receivedAt = DateTime.now();
  bool notFound = false;
  String? refusal;
  bool sending = false;

  // Выбранные карты руки. Сменился ход — выбор сбрасывается.
  final selected = <String>{};
  String selectionKey = '';

  // Смайлики и фразы (§14 Гарбы).
  final flyingEmoji = <String, String>{};
  int lastReactionId = 0;
  bool firstReactions = true;

  // Объявление крупно над столом: «ШАХ!», «Козырь сменился».
  ({int id, String text, String? sub, Color color})? announcement;
  int announcementSeq = 0;
  Timer? announcementTimer;
  String seenShah = '';
  String seenDraw = '';
  String? lastTrump;
  int seenMovesParty = -1;
  int seenMovesTotal = 0;

  // Вскрытие на туза в начале стола: сколько карт уже открыто.
  bool revealStarted = false;
  bool revealDone = false;
  int revealCount = 0;
  Timer? revealTimer;

  // Раздача по одной карте: какую раздачу показываем (партия × 1000 + раздача) и сколько карт уже роздано.
  int? dealNumber;
  int dealProgress = 0;
  int dealTotal = 0;
  Timer? dealTimer;
  bool get dealing => dealProgress < dealTotal;

  // Итог раздачи — окно; закрытое нажатием больше не показываем.
  int? partyDoneNumber;
  // Окно итога раздачи — снимок на момент конца раздачи: держится 7 с или до нажатия, даже если
  // сдающий (бот) уже раздал следующую.
  Map<String, dynamic>? partyPopupData;
  Timer? partyTimer;
  Timer? partyHideTimer;

  // Итог партии (до −24) и итог стола — окно после окна раздачи; закрыто — итоги под столом.
  bool matchHeld = true;
  bool matchClosed = true;
  String? matchKey;
  Timer? matchTimer;

  // «Ещё 3 партии?»: итог голосования — надпись на несколько секунд.
  String? moreVoteKey;
  DateTime? moreVoteAt;

  String get myId => Session.id;
  String get base => '$apiBase/shah/rooms/${widget.roomCode}';

  @override
  void initState() {
    super.initState();
    link = RoomLink(
      roomCode: widget.roomCode,
      onRoom: applyRoom,
      onError: (error) {
        if (!mounted) return;
        if (error == 'room not found') setState(() => notFound = true);
        if (error == 'playing elsewhere' || error == 'blocked') setState(() => refusal = error);
      },
      watchEvent: 'watch_shah',
      roomEvent: 'shah_room',
      errorEvent: 'shah_room_error',
    );
    refresh();
    pollTimer = Timer.periodic(fallbackPollInterval, (_) {
      if (!link.connected) refresh();
    });
    // Отсчёты (ход, пауза, время стола) — раз в секунду.
    ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    pollTimer?.cancel();
    ticker?.cancel();
    announcementTimer?.cancel();
    revealTimer?.cancel();
    dealTimer?.cancel();
    partyTimer?.cancel();
    partyHideTimer?.cancel();
    matchTimer?.cancel();
    link.dispose();
    super.dispose();
  }

  Future<void> refresh() async {
    try {
      final response = await apiRequest(http.get(Uri.parse(base), headers: authHeaders()));
      if (response.statusCode == 200) {
        applyRoom(jsonDecode(response.body) as Map<String, dynamic>);
      } else if (response.statusCode == 404 && mounted) {
        setState(() => notFound = true);
      } else if (response.statusCode == 403 && mounted) {
        final error = (jsonDecode(response.body) as Map)['error']?.toString();
        setState(() => refusal = error ?? 'blocked');
      }
    } catch (_) {}
  }

  // ——— состояние с сервера ———

  Map<String, dynamic>? gameOf(Map<String, dynamic>? data) =>
      data?['game'] is Map ? Map<String, dynamic>.from(data!['game'] as Map) : null;

  Map<String, dynamic>? partyOf(Map<String, dynamic>? game) =>
      game?['party'] is Map ? Map<String, dynamic>.from(game!['party'] as Map) : null;

  void applyRoom(Map<String, dynamic> data) {
    if (!mounted || isStaleRoom(room, data)) return;
    final first = room == null;
    applyReactions((data['reactions'] as List?) ?? const []);
    noteMoreVote(data, first);
    final game = gameOf(data);
    final party = partyOf(game);
    setState(() {
      room = data;
      receivedAt = DateTime.now();
    });
    updateReveal(data, game, party);
    updateDeal(data, party);
    applyAnnouncements(data, game, party, first);
    updatePartyPopup(data, game, party, first);
    updateMatchOver(data, first);
    syncSelection(game, party);
  }

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

  void noteMoreVote(Map<String, dynamic> data, bool first) {
    final last = data['lastMoreVote'];
    final key = last is Map ? '${data['matchLimit']}:${last['result']}' : null;
    if (key == moreVoteKey) return;
    moreVoteKey = key;
    moreVoteAt = first || key == null ? null : DateTime.now();
  }

  // Номер раздачи вместе с номером партии: в новой партии раздачи снова с 1.
  int dealKey(Map<String, dynamic> data, Map<String, dynamic> party) =>
      ((data['matchNumber'] as num?)?.toInt() ?? 1) * 1000 + (party['number'] as num).toInt();

  // Вскрытие на туза (§5): карты по кругу, 0,9 с на карту, потом 1,6 с — как в Гарбе.
  // Открыл стол позже — догоняем по revealShowLeftMs от сервера.
  void updateReveal(Map<String, dynamic> data, Map<String, dynamic>? game, Map<String, dynamic>? party) {
    if (revealStarted || game == null) return;
    final reveals = ((game['firstDealer'] as Map?)?['reveals'] as List?) ?? const [];
    revealStarted = true;
    if (party != null || reveals.isEmpty) {
      revealDone = true;
      revealCount = reveals.length;
      return;
    }
    final leftMs = (data['revealShowLeftMs'] as num?)?.toInt() ?? 0;
    if (leftMs <= 0) {
      revealDone = true;
      revealCount = reveals.length;
      return;
    }
    final notShown = ((leftMs - 1600).clamp(0, 1 << 30) / 900).ceil();
    revealCount = (reveals.length - notShown).clamp(0, reveals.length);
    void finish(int ms) {
      revealTimer = Timer(Duration(milliseconds: ms), () {
        if (mounted) setState(() => revealDone = true);
      });
    }

    if (revealCount >= reveals.length) {
      finish(leftMs);
      return;
    }
    revealTimer = Timer.periodic(const Duration(milliseconds: 900), (t) {
      if (!mounted) return t.cancel();
      GarbaSounds.card();
      setState(() => revealCount++);
      if (revealCount >= reveals.length) {
        t.cancel();
        finish(1600);
      }
    });
  }

  // Раздача (§3): по одной карте по кругу с соседа справа от сдающего, 1 с на начало и 0,43 с на
  // карту — те же числа, что у сервера (turnTimer.ts): пока идёт анимация, часы хода стоят.
  void updateDeal(Map<String, dynamic> data, Map<String, dynamic>? party) {
    if (party == null) return;
    final number = dealKey(data, party);
    if (number == dealNumber) return;
    dealNumber = number;
    dealTimer?.cancel();
    final capacity = (data['capacity'] as num).toInt();
    dealTotal = 6 * capacity;
    final leftMs = (data['dealShowLeftMs'] as num?)?.toInt() ?? 0;
    if (leftMs <= 0 || ((party['tricksPlayed'] as num?) ?? 0) > 0 || party['trick'] != null) {
      dealProgress = dealTotal;
      return;
    }
    revealDone = true;
    const opening = 1000, perCard = 430;
    final elapsed = opening + dealTotal * perCard - leftMs;
    dealProgress = ((elapsed - opening) / perCard).floor().clamp(0, dealTotal);
    dealTimer = Timer(Duration(milliseconds: math.max(0, opening - elapsed)), () {
      dealTimer = Timer.periodic(const Duration(milliseconds: perCard), (t) {
        if (!mounted) return t.cancel();
        GarbaSounds.card();
        setState(() => dealProgress++);
        if (dealProgress >= dealTotal) t.cancel();
      });
    });
  }

  void announce(String text, {String? sub, Color color = const Color(0xFFD4A94F)}) {
    announcementTimer?.cancel();
    setState(() => announcement = (id: ++announcementSeq, text: text, sub: sub, color: color));
    announcementTimer = Timer(const Duration(milliseconds: 2400), () {
      if (mounted) setState(() => announcement = null);
    });
  }

  String nameOf(Map<String, dynamic> data, Object? id) =>
      ((data['players'] as List?) ?? const [])
          .cast<Map>()
          .where((p) => p['id'].toString() == id.toString())
          .map((p) => p['name'].toString())
          .firstOrNull ??
      'Игрок';

  String nameAtSeat(Map<String, dynamic> data, Object? seat) =>
      ((data['players'] as List?) ?? const [])
          .cast<Map>()
          .where((p) => p['seat'] == seat)
          .map((p) => p['name'].toString())
          .firstOrNull ??
      'Игрок';

  // «ШАХ!», смена козыря, звук хода.
  void applyAnnouncements(Map<String, dynamic> data, Map<String, dynamic>? game, Map<String, dynamic>? party, bool first) {
    if (party == null) return;
    final number = dealKey(data, party);
    final trick = party['trick'] is Map ? party['trick'] as Map : null;
    final played = (party['tricksPlayed'] as num?)?.toInt() ?? 0;
    final moves = ((trick?['moves'] as List?) ?? const []).length;
    final total = played * 1000 + moves;
    if (number == seenMovesParty && total > seenMovesTotal && !first) GarbaSounds.move();
    seenMovesParty = number;
    seenMovesTotal = total;

    if (trick?['shah'] == true) {
      final key = '$number:$played';
      if (key != seenShah) {
        seenShah = key;
        if (!first) {
          GarbaSounds.garba();
          announce('ШАХ!', sub: '${nameAtSeat(data, trick!['topSeat'])} — 6♣ бьёт всё', color: const Color(0xFFFF5252));
        }
      }
    }
    final trump = party['trump']?.toString();
    final draw = party['lastDraw'] is Map ? party['lastDraw'] as Map : null;
    if (draw != null) {
      final card = draw['card'] as Map;
      final key = '$number:$played:${card['id']}';
      if (key != seenDraw) {
        seenDraw = key;
        if (!first && lastTrump != null && trump != lastTrump && trump != null) {
          announce('КОЗЫРЬ ${suitSymbol(trump)}',
              sub: '${nameAtSeat(data, draw['seat'])} взял ${card['rank']}${suitSymbol(card['suit'].toString())}',
              color: isRedSuit(trump) ? const Color(0xFFFF6B6B) : const Color(0xFFD4A94F));
        }
      }
    }
    lastTrump = trump;
  }

  // Раздача сыграна — через 1,2 с окно итога (сначала видно, кто забрал последнюю взятку).
  // Открыл стол давно после раздачи — старое окно не показываем.
  void updatePartyPopup(Map<String, dynamic> data, Map<String, dynamic>? game, Map<String, dynamic>? party, bool first) {
    if (game == null || party == null || party['phase'] != 'done' || party['result'] == null) return;
    final number = dealKey(data, party);
    if (number == partyDoneNumber) return;
    partyDoneNumber = number;
    partyTimer?.cancel();
    final showLeft = (data['partyShowLeftMs'] as num?)?.toInt() ?? 0;
    // Открыл стол позже: раздача давно сыграна или стол уже закрыт — сразу без окна раздачи.
    if (first && (showLeft <= 0 || data['status'] == 'finished')) return;
    final players = ((data['players'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final result = Map<String, dynamic>.from(party['result'] as Map);
    final mySide = mySideOf(game);
    final snapshot = <String, dynamic>{
      'result': result,
      'leftover': party['leftover'],
      'sideNames': ShahScoreBoard.sideNames(game, players),
      'mySide': mySide,
      'nextMultiplier': (game['multiplier'] as num?)?.toInt() ?? 1,
      'limit': (game['limit'] as num?)?.toInt() ?? -24,
      'nextDealer': game['nextDealerSeat'] is num ? nameAtSeat(data, game['nextDealerSeat']) : null,
    };
    partyTimer = Timer(Duration(milliseconds: first ? 0 : 1200), () {
      if (!mounted) return;
      setState(() => partyPopupData = snapshot);
      final penalties = (result['penalties'] as List?) ?? const [];
      if (!first && mySide >= 0 && mySide < penalties.length) {
        GarbaSounds.result(((penalties[mySide] as num?) ?? 0) == 0);
      }
      partyHideTimer?.cancel();
      partyHideTimer = Timer(const Duration(seconds: 7), hidePartyPopup);
    });
  }

  // Окно итога раздачи закрыто (нажатием или через 7 с) — если партия окончена, пора её итогу.
  void hidePartyPopup() {
    partyHideTimer?.cancel();
    if (!mounted) return;
    setState(() {
      partyPopupData = null;
      matchHeld = false;
    });
  }

  // Партия окончена (новая запись в series) или стол закрыт: если только что кончилась раздача —
  // сначала её окно, потом итог партии (hidePartyPopup); иначе (вышел, не вернулся) — через 1,5 с.
  // Открыл стол позже — старый итог партии не показываем, а итог закрытого стола — показываем.
  void updateMatchOver(Map<String, dynamic> data, bool first) {
    if (data['game'] == null) return;
    final finished = data['status'] == 'finished';
    final count = ((data['series'] as List?) ?? const []).length;
    final key = '$count:$finished';
    if (key == matchKey) return;
    matchKey = key;
    if (count == 0 && !finished) return;
    matchTimer?.cancel();
    if (first) {
      matchHeld = false;
      matchClosed = !finished;
      return;
    }
    matchClosed = false;
    matchHeld = true;
    matchTimer = Timer(const Duration(milliseconds: 1500), () {
      if (!mounted || partyPopupData != null || (partyTimer?.isActive ?? false)) return;
      setState(() => matchHeld = false);
    });
  }

  int mySideOf(Map<String, dynamic>? game) {
    final seat = (game?['mySeat'] as num?)?.toInt() ?? -1;
    final infos = (game?['players'] as List?) ?? const [];
    if (seat < 0 || seat >= infos.length) return -1;
    return ((infos[seat] as Map)['side'] as num?)?.toInt() ?? -1;
  }

  void syncSelection(Map<String, dynamic>? game, Map<String, dynamic>? party) {
    final trick = party?['trick'] is Map ? party!['trick'] as Map : null;
    final key = '${party?['number']}:${party?['tricksPlayed']}:${((trick?['moves'] as List?) ?? const []).length}:${game?['myAwaiting']}';
    if (key != selectionKey) {
      selectionKey = key;
      selected.clear();
    }
    final hand = ((game?['myHand'] as List?) ?? const []).map((c) => (c as Map)['id'].toString()).toSet();
    selected.removeWhere((id) => !hand.contains(id));
  }

  // ——— действия ———

  Future<void> post(String path, [Map<String, dynamic> body = const {}]) async {
    if (sending) return;
    setState(() => sending = true);
    try {
      final response = await apiRequest(http.post(Uri.parse('$base/$path'), headers: authHeaders(), body: jsonEncode(body)));
      if (response.statusCode < 200 || response.statusCode >= 300) throw ApiFailure.fromResponse(response);
      final decoded = jsonDecode(response.body);
      if (decoded is Map && decoded['kind'] == 'shah') applyRoom(Map<String, dynamic>.from(decoded));
    } catch (e) {
      if (mounted) showGarbaError(context, e);
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  Future<void> move(String type) async {
    final ids = selected.toList();
    await post('move', {'type': type, 'cardIds': ids});
  }

  Future<void> sendReaction(String emoji) async {
    try {
      await apiRequest(http.post(Uri.parse('$base/react'), headers: authHeaders(), body: jsonEncode({'emoji': emoji})));
    } catch (_) {}
  }

  // Выйти из-за стола между раздачами (§18 SHAH_RULES.md, вопрос 19): сторона проиграла партию,
  // между партиями — следующую; бан за выход.
  Future<void> leaveMatch(Map<String, dynamic> data) async {
    final practice = data['practice'] == true;
    final teams = data['teams'] == true;
    final between = data['matchOver'] == true;
    final ante = ((data['settings'] as Map?)?['ante'] as num?)?.toInt() ?? 0;
    final side = teams ? 'Ваша команда проиграет' : 'Вы проиграете';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Выйти из-за стола?'),
        content: Text(practice
            ? 'Тренировка закончится.'
            : between
                ? '$side следующую партию — ${teams ? 'каждый заплатит' : 'заплатите'} взнос ${fmtCoins(ante)}. '
                    'Выход из начатой игры — бан на вход за стол от 10 минут (каждый следующий дольше, до часа).'
                : '$side эту партию — взнос не вернётся, даже если по штрафам вы впереди. '
                    'Выход из начатой игры — бан на вход за стол от 10 минут (каждый следующий дольше, до часа).'),
        actions: [
          FilledButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ОСТАТЬСЯ')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ВЫЙТИ')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final response = await apiRequest(http.post(Uri.parse('$base/leave'), headers: authHeaders(), body: jsonEncode({})));
      if (response.statusCode < 200 || response.statusCode >= 300) throw ApiFailure.fromResponse(response);
      await refresh();
    } catch (e) {
      if (mounted) showGarbaError(context, e, prefix: 'Не удалось выйти');
    }
  }

  // ——— отрисовка ———

  // Сколько карт из первых `progress` розданных досталось месту `seat` (§3: с соседа справа).
  int dealtTo(int seat, int progress, int dealerSeat, int capacity) {
    final pos = (seat - dealerSeat - 1 + capacity) % capacity;
    return progress ~/ capacity + (pos < progress % capacity ? 1 : 0);
  }

  int secondsSince(DateTime t) => DateTime.now().difference(t).inSeconds;

  // Итог «ещё 3 партии?» — строкой на несколько секунд (вопрос 18).
  Widget? moreVoteResultLine(Map<String, dynamic> data) {
    final last = data['lastMoreVote'] is Map ? Map<String, dynamic>.from(data['lastMoreVote'] as Map) : null;
    if (last == null || moreVoteAt == null || DateTime.now().difference(moreVoteAt!) > const Duration(seconds: 8)) return null;
    final approved = last['result'] == 'approved';
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        switch (last['result']) {
          'approved' => 'Все согласились — ещё 3 партии, всего ${data['matchLimit']}.',
          'rejected' => last['byName'] != null ? '${last['byName']} — «хватит». Стол закрывается.' : 'Ещё партии не играем.',
          _ => 'Ответили не все — стол закрывается.',
        },
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 12, color: approved ? Colors.greenAccent : Colors.white70),
      ),
    );
  }

  // «Добавить 3 партии?» — договорённые партии сыграны, решают все (только единогласно).
  Widget moreVoteBar(Map<String, dynamic> data, Map<String, dynamic> vote) {
    const gold = Color(0xFFE6B74F);
    final canVote = data['myCanVoteMore'] == true;
    final myVote = data['myMoreVote']?.toString();
    final left = math.max(0, ((vote['secondsLeft'] as num?)?.toInt() ?? 0) - secondsSince(receivedAt));
    final played = ((data['series'] as List?) ?? const []).length;
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: const Color(0xFF13232E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: gold.withValues(alpha: 0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            canVote
                ? 'Сыграли партий: $played. Играем ещё ${vote['add']}?'
                : myVote == 'yes'
                    ? 'Вы — за ещё ${vote['add']} партии. Ждём остальных.'
                    : 'Игроки решают, играть ли ещё ${vote['add']} партии.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
          ),
          Text(
            'Ответили: ${vote['votedCount']} из ${vote['voterCount']} · только если согласны все · $left с',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11, color: Colors.white60),
          ),
          if (canVote) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: sending ? null : () => post('more-vote', {'choice': 'yes'}),
                    child: FittedBox(child: Text('ЕЩЁ ${vote['add']} ПАРТИИ')),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: sending ? null : () => post('more-vote', {'choice': 'no'}),
                    child: const FittedBox(child: Text('ХВАТИТ')),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget personalPauseBar(Map<String, dynamic> p) {
    final left = math.max(0, ((p['secondsLeft'] as num?)?.toInt() ?? 0) - secondsSince(receivedAt));
    final mine = p['playerId']?.toString() == myId;
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.fromLTRB(10, 4, 6, 4),
      decoration: BoxDecoration(
        color: const Color(0xFF13232E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE6B74F).withValues(alpha: 0.6)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(mine ? '⏸ Ваша пауза · $left с' : '⏸ Пауза — ${p['name']} · $left с',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
          ),
          if (mine) TextButton(onPressed: sending ? null : () => post('pause/end'), child: const Text('ПРОДОЛЖИТЬ')),
        ],
      ),
    );
  }

  // Веер карт игрока над табличкой: рубашки и показанные всем карты (козырь из добора, §4).
  Widget seatFan(int count, List<Map<String, dynamic>> shown, String? back) {
    final total = count.clamp(0, 6);
    if (total == 0) return const SizedBox(height: 34);
    final faceUp = shown.take(total).toList();
    return SizedBox(
      width: 22.0 + (total - 1) * 11,
      height: 34,
      child: Stack(
        children: [
          for (var i = 0; i < total; i++)
            Positioned(
              left: i * 11.0,
              child: ShahMiniCard(card: i < faceUp.length ? faceUp[i] : null, width: 22, back: back),
            ),
        ],
      ),
    );
  }

  // Колода и козырь — строкой над столом (§4): сколько карт в колоде, по какой карте козырь.
  // При 2/3/4 козырь открывают после раздачи; при 6 — до неё (вся колода на руках).
  Widget? deckTrumpBar(Map<String, dynamic> game, Map<String, dynamic>? party, int capacity, String? back) {
    if (party == null) return null;
    final format = (game['format'] as num?)?.toInt() ?? capacity;
    final deckCount = (party['deckCount'] as num?)?.toInt() ?? 0;
    final showingDeal = dealing;
    final inDeck = showingDeal ? (format == 6 ? 0 : deckCount + dealTotal - dealProgress) : deckCount;
    final trump = party['trump']?.toString();
    final deckOpen = party['deckOpenCard'] is Map ? Map<String, dynamic>.from(party['deckOpenCard'] as Map) : null;
    final trumpCard = party['trumpCard'] is Map ? Map<String, dynamic>.from(party['trumpCard'] as Map) : null;
    final showTrump = !showingDeal || format == 6;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (format != 6) ...[
            TableDeckView(width: 16, back: back),
            const SizedBox(width: 4),
            Text(inDeck > 0 ? 'в колоде $inDeck' : 'колода кончилась',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.white70)),
            const SizedBox(width: 14),
          ],
          if (showTrump && trump != null) ...[
            if (deckOpen != null || trumpCard != null) ShahMiniCard(card: deckOpen ?? trumpCard, width: 20),
            const SizedBox(width: 5),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
              decoration: BoxDecoration(
                color: const Color(0xFFF4EFE2),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFD4A94F), width: 1.5),
              ),
              child: Text.rich(
                TextSpan(children: [
                  const TextSpan(text: 'КОЗЫРЬ ', style: TextStyle(color: Colors.black87)),
                  TextSpan(
                    text: suitSymbol(trump),
                    style: TextStyle(fontSize: 16, color: isRedSuit(trump) ? Colors.red.shade800 : Colors.black),
                  ),
                ]),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
              ),
            ),
          ] else if (showingDeal)
            const Text('козырь откроют после раздачи', style: TextStyle(fontSize: 12, color: Colors.white54)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (refusal != null) {
      return RoomClosedScreen(
        title: 'Смотреть нельзя',
        text: spectateRefusalText(refusal) ?? userErrorMessage(ApiFailure(403, refusal!, null)),
      );
    }
    if (notFound) {
      return const RoomClosedScreen(title: 'Стол закрыт', text: 'Этот стол ШАХ уже закрыт.');
    }
    final data = room;
    if (data == null) {
      return Scaffold(appBar: backOnlyAppBar(), body: const Center(child: CircularProgressIndicator()));
    }
    final game = gameOf(data);
    if (game == null) {
      return Scaffold(appBar: backOnlyAppBar(), body: const Center(child: Text('Игра ещё не началась')));
    }
    final party = partyOf(game);
    final players = ((data['players'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final infos = ((game['players'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final capacity = (data['capacity'] as num).toInt();
    final finished = data['status'] == 'finished';
    final stage = data['stage']?.toString();
    final mySeat = (game['mySeat'] as num?)?.toInt() ?? -1;
    final watching = widget.spectator || mySeat < 0;
    final baseSeat = mySeat >= 0 ? mySeat : 0;
    final back = tableCardBack(data);
    final trump = party?['trump']?.toString();
    final myAwaiting = watching ? null : game['myAwaiting']?.toString();
    final awaitedIds = ((data['awaitedIds'] as List?) ?? const []).map((e) => e.toString()).toList();
    final awaitedId = awaitedIds.firstOrNull;
    final dealerSeat = (game['dealerSeat'] as num?)?.toInt() ?? 0;
    final pause = data['pause'] is Map ? Map<String, dynamic>.from(data['pause'] as Map) : null;
    final pausePlayers = ((pause?['players'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final paused = pausePlayers.isNotEmpty;
    final iAmAway = pausePlayers.any((p) => p['id'].toString() == myId && p['reason'] == 'away');
    final turnSeconds = ((data['settings'] as Map?)?['turnSeconds'] as num?)?.toInt() ?? 20;
    final rawTurnLeft = (data['turnSecondsLeft'] as num?)?.toInt();
    final turnLeft = rawTurnLeft == null ? null : math.max(0, math.min(turnSeconds, rawTurnLeft - secondsSince(receivedAt)));
    final myTurn = awaitedId == myId && !watching;
    final trick = party?['trick'] is Map ? Map<String, dynamic>.from(party!['trick'] as Map) : null;
    final lastTrick = party?['lastTrick'] is Map ? Map<String, dynamic>.from(party!['lastTrick'] as Map) : null;
    final revealing = party == null && !revealDone;
    final showingDeal = party != null && dealing;
    final spectators = (data['spectators'] as num?)?.toInt() ?? 0;
    final matchNumber = (data['matchNumber'] as num?)?.toInt() ?? 1;
    final matchLimit = (data['matchLimit'] as num?)?.toInt() ?? 1;
    final matchOver = data['matchOver'] == true;
    final moreVote = data['moreVote'] is Map ? Map<String, dynamic>.from(data['moreVote'] as Map) : null;
    Map<String, dynamic>? playerAt(int seat) => players.where((p) => (p['seat'] as num?)?.toInt() == seat).firstOrNull;
    String seatName(int seat) => playerAt(seat)?['name']?.toString() ?? 'Игрок';
    int sideOfSeat(int seat) => seat < infos.length ? ((infos[seat]['side'] as num?)?.toInt() ?? seat) : seat;

    // Шапка: что сейчас происходит.
    final String headline;
    if (finished) {
      headline = 'Стол закрыт';
    } else if (paused) {
      headline = 'Пауза';
    } else if (moreVote != null) {
      headline = 'Ещё ${moreVote['add']} партии?';
    } else if (stage == 'awaiting_deal') {
      headline = revealing
          ? 'Ищем сдающего…'
          : data['dealerId']?.toString() == myId
              ? (matchOver ? 'Новая партия — ваша раздача' : 'Ваша раздача')
              : '${matchOver ? 'Новую партию сдаёт' : 'Сдаёт'} ${nameOf(data, data['dealerId'])}';
    } else if (showingDeal) {
      headline = 'Раздача…';
    } else if (myAwaiting == 'lead') {
      headline = 'Ваш заход';
    } else if (myAwaiting == 'beat') {
      headline = 'Бить или нет?';
    } else if (myAwaiting == 'closed') {
      headline = 'Рубашкой ×${game['myMin']}';
    } else {
      headline = awaitedId != null ? 'Ходит ${nameOf(data, awaitedId)}' : '';
    }

    // ——— стол ———
    Widget roundTable(double maxHeight) {
      return LayoutBuilder(builder: (context, box) {
        final width = box.maxWidth;
        final crowded = capacity >= 6;
        final height = math.min(maxHeight, (width * (crowded ? 1.4 : 1.3)).clamp(340.0, crowded ? 600.0 : 560.0));
        const seatWidth = 92.0;
        final hSpread = crowded ? 0.94 : 0.9;
        final vSpread = crowded ? 0.76 : 0.8;
        Alignment seatAlign(int seat) {
          final k = (seat - baseSeat + capacity) % capacity;
          final angle = -math.pi / 2 + 2 * math.pi * k / capacity;
          final neighbour = crowded && (k == 1 || k == capacity - 1);
          return Alignment(
            (math.cos(angle) * hSpread).clamp(-1.0, 1.0),
            (-math.sin(angle) * vSpread + (neighbour ? 0.1 : 0.0) + (crowded && k == 0 ? 0.06 : 0.0)).clamp(-1.0, 1.0),
          );
        }

        // Ширина середины: места сбоку (по высоте около центра) не должны наезжать на взятку.
        var centerWidth = width * 0.8;
        for (var s = 0; s < capacity; s++) {
          final a = seatAlign(s);
          if (a.y.abs() > 0.5) continue;
          final inner = a.x.abs() * (width - seatWidth) / 2 - seatWidth / 2;
          centerWidth = math.min(centerWidth, inner * 2 - 8);
        }
        centerWidth = math.max(110, centerWidth);

        // Сидящий на месте seat: аватар, табличка, веер, что сделал во взятке.
        Widget seatView(int seat) {
          final p = playerAt(seat);
          if (p == null) return const SizedBox.shrink();
          final id = p['id'].toString();
          final info = seat < infos.length ? infos[seat] : const <String, dynamic>{};
          final side = sideOfSeat(seat);
          final color = shahSideColor(side);
          // Пока идёт вскрытие, кольцо хода не показываем — иначе видно сдающего раньше туза.
          final active = awaitedIds.contains(id) && !finished && !revealing;
          final count = showingDeal
              ? math.min((info['handCount'] as num?)?.toInt() ?? 0, dealtTo(seat, dealProgress, dealerSeat, capacity))
              : (info['handCount'] as num?)?.toInt() ?? 0;
          final shown = showingDeal
              ? const <Map<String, dynamic>>[]
              : ((info['shown'] as List?) ?? const []).map((c) => Map<String, dynamic>.from(c as Map)).toList();
          // Что сделал во взятке: зашёл, побил, ШАХ, не бьёт, рубашкой.
          String? label;
          Color labelColor = const Color(0xFF3A4A55);
          Color labelText = Colors.white70;
          if (trick != null) {
            final mine = ((trick['moves'] as List?) ?? const []).cast<Map>().where((m) => m['seat'] == seat).toList();
            final top = trick['topSeat'] == seat;
            if (mine.isNotEmpty) {
              final last = mine.last;
              switch (last['kind']) {
                case 'lead':
                  label = 'ЗАШЁЛ ×${(last['cards'] as List).length}';
                  labelColor = top ? const Color(0xFFD4A94F) : const Color(0xFF6B5A33);
                  labelText = Colors.black;
                case 'beat':
                  label = last['shah'] == true ? 'ШАХ!' : 'ПОБИЛ';
                  labelColor = last['shah'] == true ? const Color(0xFFC62828) : top ? Colors.green.shade600 : const Color(0xFF2E5A3A);
                  labelText = Colors.white;
                default:
                  label = last['reason'] == 'fold' ? 'НЕ БЬЁТ' : 'РУБАШКОЙ ×${last['count']}';
              }
            } else if (active) {
              label = 'думает…';
            }
          } else if (lastTrick != null && party?['phase'] == 'lead' && lastTrick['winnerSeat'] == seat) {
            label = 'ВЗЯЛ';
            labelColor = const Color(0xFFD4A94F);
            labelText = Colors.black;
          }
          // Фишка «С»: в партии — её сдающий, между партиями — кто раздаёт следующую (как в шапке).
          final chipSeat = stage == 'awaiting_deal'
              ? (players.where((x) => x['id'].toString() == data['dealerId']?.toString()).map((x) => (x['seat'] as num).toInt()).firstOrNull ?? -1)
              : dealerSeat;
          final isDealer = seat == chipSeat && !finished && !revealing;
          return GestureDetector(
            onTap: () => openPlayerCard(context, p),
            child: SizedBox(
              width: seatWidth,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (seat != mySeat) seatFan(count, shown, back) else const SizedBox(height: 4),
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      framed(
                        Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFF0B1620),
                            border: Border.all(color: active ? Colors.greenAccent : color, width: active ? 3 : 2.5),
                            boxShadow: [
                              if (active) BoxShadow(color: Colors.greenAccent.withValues(alpha: 0.5), blurRadius: 10),
                            ],
                          ),
                          child: AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 16),
                        ),
                        diameter: 41,
                        frame: p['frame']?.toString(),
                      ),
                      if (isDealer)
                        Positioned(
                          right: -9,
                          top: -4,
                          child: Container(
                            width: 18,
                            height: 18,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.black26, width: 2),
                            ),
                            child: const Text('С',
                                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.black)),
                          ),
                        ),
                      if (flyingEmoji[id] case final emoji? when !isPhrase(emoji))
                        Positioned(
                          left: -6,
                          top: -6,
                          right: -6,
                          bottom: -6,
                          child: AvatarEmoji(key: ValueKey('${id}_${emoji}_$lastReactionId'), emoji: emoji),
                        ),
                      if (flyingEmoji[id] case final phrase? when isPhrase(phrase))
                        Positioned(
                          left: -70,
                          right: -70,
                          top: -34,
                          child: Center(child: PhraseBubble(key: ValueKey('${id}_${phrase}_$lastReactionId'), text: phrase)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Container(
                    width: seatWidth,
                    padding: const EdgeInsets.fromLTRB(4, 2, 4, 2),
                    decoration: BoxDecoration(
                      color: const Color(0xF0121A22),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: active ? Colors.greenAccent : color.withValues(alpha: 0.8), width: active ? 2 : 1),
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Flexible(
                              child: Text(
                                p['name'].toString(),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: ratingColor(p['rating'])),
                              ),
                            ),
                            const SizedBox(width: 3),
                            Text(fmtRating(p['rating']),
                                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: ratingColor(p['rating']))),
                          ],
                        ),
                        // У себя число карт не нужно — рука внизу; место для взятки в центре.
                        if (seat != mySeat)
                          Text(
                            '${p['bot'] == true ? 'бот · ' : ''}карт: $count',
                            style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w700),
                          ),
                      ],
                    ),
                  ),
                  if (label != null)
                    Transform.translate(
                      offset: const Offset(0, -2),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                        decoration: BoxDecoration(color: labelColor, borderRadius: BorderRadius.circular(10)),
                        child: Text(label,
                            maxLines: 1, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: labelText)),
                      ),
                    ),
                ],
              ),
            ),
          );
        }

        // Середина стола: колода и козырь, взятка, что происходит.
        Widget center() {
          final children = <Widget>[];
          if (party == null) {
            // Во время вскрытия в центре только колода: карты вскрытия лежат у мест.
            children.add(TableDeckView(width: 34, back: back));
            if (!revealing) {
              children.add(const SizedBox(height: 8));
              children.add(Text(
                'Сдаёт ${seatName(dealerSeat)}',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Color(0xFFE6B74F)),
              ));
            }
          } else {
            // Колода и козырь — строкой над столом; в центре колода только на время раздачи.
            if (showingDeal) children.add(TableDeckView(width: 30, back: back));
            final shownTrick = trick ?? lastTrick;
            if (shownTrick != null && !showingDeal) {
              // Заход в 5–6 карт со стопкой рубашек может не влезть — тогда взятка ужимается.
              children.add(FittedBox(
                fit: BoxFit.scaleDown,
                child: ShahTrickView(trick: shownTrick, finished: trick == null, back: back, maxWidth: centerWidth),
              ));
            }
            // Что происходит — строкой под взяткой.
            String? status;
            Color statusColor = Colors.white70;
            if (showingDeal) {
              status = 'Карты раздаются…';
            } else if (trick != null && trick['shah'] == true) {
              status = 'ШАХ! Взятка — ${seatName((trick['topSeat'] as num).toInt())}';
              statusColor = const Color(0xFFFF6B6B);
            } else if (trick != null) {
              final n = (trick['n'] as num?)?.toInt() ?? 1;
              status = 'Сверху — ${seatName((trick['topSeat'] as num).toInt())}${n > 1 ? ' · бьют по $n' : ''}';
              statusColor = const Color(0xFFE6B74F);
            } else if (party['phase'] == 'done') {
              status = matchOver ? 'Партия окончена' : 'Раздача сыграна';
              statusColor = const Color(0xFFE6B74F);
            } else if (lastTrick != null) {
              final total = ShahTrickView.columnsOf(lastTrick).fold<int>(0, (s, c) => s + c.length) +
                  ShahTrickView.closedCountOf(lastTrick);
              status = 'Взял ${seatName((lastTrick['winnerSeat'] as num).toInt())} · ${cardsCountText(total)}';
            } else if (party['turnSeat'] != null) {
              status = 'Заходит ${seatName((party['turnSeat'] as num).toInt())}';
            }
            if (status != null) {
              children.add(Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(status,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: statusColor)),
              ));
            }
          }
          return SizedBox(
            width: centerWidth,
            child: Column(mainAxisSize: MainAxisSize.min, children: children),
          );
        }

        // Вскрытие на туза: у каждого места — последняя открытая ему карта, туз светится.
        final revealCards = <int, Map<String, dynamic>>{};
        if (party == null && revealing) {
          final reveals = ((game['firstDealer'] as Map?)?['reveals'] as List?) ?? const [];
          for (final r in reveals.take(revealCount)) {
            final m = r as Map;
            revealCards[(m['seat'] as num).toInt()] = Map<String, dynamic>.from(m['card'] as Map);
          }
        }

        return SizedBox(
          height: height,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              const Positioned(left: 0, right: 0, top: 2, bottom: 2, child: KazakhTable(title: 'ШАХ')),
              // Чуть ниже середины: у верхних мест над аватаркой ещё веер карт.
              Align(alignment: const Alignment(0, 0.06), child: center()),
              for (final entry in revealCards.entries)
                Align(
                  alignment: Alignment(seatAlign(entry.key).x * 0.42, seatAlign(entry.key).y * 0.4),
                  child: ShahMiniCard(card: entry.value, width: 34, glow: entry.value['rank'] == 'A'),
                ),
              // Летящая карта при раздаче — к тому, кому она сейчас.
              if (showingDeal && dealTimer != null)
                () {
                  final target = (dealerSeat + 1 + dealProgress) % capacity;
                  return TweenAnimationBuilder<Alignment>(
                    key: ValueKey('deal-$dealNumber-$dealProgress'),
                    tween: AlignmentTween(begin: Alignment.center, end: seatAlign(target)),
                    duration: const Duration(milliseconds: 380),
                    curve: Curves.easeOutCubic,
                    builder: (_, alignment, child) => Align(alignment: alignment, child: child),
                    child: TableDeckView(width: 22, back: back),
                  );
                }(),
              for (var seat = 0; seat < capacity; seat++) Align(alignment: seatAlign(seat), child: seatView(seat)),
              if (!watching)
                Positioned(right: 6, bottom: 6, child: EmojiButton(onSend: sendReaction)),
            ],
          ),
        );
      });
    }

    // ——— рука и кнопки ———
    final rawHand = ((game['myHand'] as List?) ?? const []).map((c) => Map<String, dynamic>.from(c as Map)).toList();
    final hand = showingDeal
        ? rawHand.take(math.min(rawHand.length, dealtTo(mySeat, dealProgress, dealerSeat, capacity))).toList()
        : sortShahHand(rawHand, trump);
    final canSelect = myAwaiting != null && !paused && !sending && !showingDeal;
    final need = (game['myMin'] as num?)?.toInt() ?? 0;
    String keyOf(Iterable<Object?> ids) => (ids.map((e) => e.toString()).toList()..sort()).join(',');
    final selKey = keyOf(selected);
    final leadKeys = ((game['myLeadOptions'] as List?) ?? const []).map((o) => keyOf(o as List)).toSet();
    final beatOptions = ((game['myBeatOptions'] as List?) ?? const []).map((o) => (o as List).map((e) => e.toString()).toList()).toList();
    final beatKeys = beatOptions.map(keyOf).toSet();

    Widget handRow() {
      if (hand.isEmpty) {
        return SizedBox(
          height: 44,
          child: Center(
            child: Text(
              party == null
                  ? 'Карты ещё не розданы'
                  : party['phase'] == 'done'
                      ? (matchOver ? 'Партия окончена' : 'Раздача сыграна')
                      : 'Ваши карты кончились — ждём конца раздачи',
              style: const TextStyle(color: Colors.white70),
            ),
          ),
        );
      }
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: PlayerHandRow(
          itemCount: hand.length,
          itemBuilder: (_, i) {
            final card = hand[i];
            final id = card['id'].toString();
            final isSelected = selected.contains(id);
            return GestureDetector(
              onTap: canSelect
                  ? () => setState(() {
                        if (!selected.remove(id)) selected.add(id);
                      })
                  : null,
              child: Transform.translate(
                offset: Offset(0, isSelected ? -14 : 0),
                child: Stack(
                  children: [
                    Positioned.fill(child: SmallCard(rank: card['rank'].toString(), suit: card['suit'].toString())),
                    if (isShahCard(card))
                      Positioned(
                        left: 6,
                        bottom: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                          decoration: BoxDecoration(color: _cardRed, borderRadius: BorderRadius.circular(4)),
                          child: const Text('ШАХ',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: Colors.white)),
                        ),
                      ),
                    if (isSelected)
                      Positioned.fill(
                        child: IgnorePointer(
                          child: Container(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: const Color(0xFFF2C65D), width: 4),
                              boxShadow: const [BoxShadow(color: Color(0x88D4A94F), blurRadius: 14)],
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
      );
    }

    String cardsWord(int n) => n == 1 ? 'карту' : n < 5 ? 'карты' : 'карт';

    Widget hintText(String text, {Color color = Colors.white70}) => Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(text, textAlign: TextAlign.center, maxLines: 2, style: TextStyle(fontSize: 12.5, color: color)),
        );

    Widget actions() {
      if (watching) return const SizedBox.shrink();
      if (finished) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            hintText(shahCloseReasonText(data), color: const Color(0xFFE6B74F)),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => setState(() => matchClosed = false),
                    child: const Text('ИТОГИ'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(child: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ВЫЙТИ'))),
              ],
            ),
          ],
        );
      }
      if (stage == 'awaiting_deal' && moreVote != null) return moreVoteBar(data, moreVote);
      if (stage == 'awaiting_deal') {
        final iDeal = data['dealerId']?.toString() == myId;
        final showLeftMs = math.max(0, ((data['partyShowLeftMs'] as num?)?.toInt() ?? 0) - DateTime.now().difference(receivedAt).inMilliseconds);
        final blocked = revealing || showLeftMs > 0 || data['personalPause'] is Map || paused || sending;
        final ante = ((data['settings'] as Map?)?['ante'] as num?)?.toInt() ?? 0;
        // Партия окончена — сдающий начинает следующую: взнос за неё — с каждого (вопрос 17).
        final nextLine = 'Партия ${matchNumber + 1} из $matchLimit'
            '${data['practice'] == true ? '' : ' · взнос ${fmtCoins(ante)} с каждого'}';
        final dealLabel = matchOver ? 'НОВАЯ ПАРТИЯ' : 'РАЗДАТЬ';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (matchOver) hintText(nextLine, color: const Color(0xFFE6B74F)),
            if (iDeal)
              SizedBox(
                height: 52,
                child: FilledButton(
                  onPressed: blocked ? null : () => post('deal'),
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFD4A94F), foregroundColor: Colors.black),
                  child: Text(
                    turnLeft != null && !blocked ? '$dealLabel · $turnLeft' : dealLabel,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                  ),
                ),
              )
            else
              hintText(revealing
                  ? 'Ищем первого сдающего: кому первым выпадет туз — тот сдаёт'
                  : 'Ждём, пока ${nameOf(data, data['dealerId'])} ${matchOver ? 'начнёт новую партию' : 'раздаст'}'),
            Row(
              children: [
                if (data['myCanPause'] == true)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: sending ? null : () => post('pause'),
                      child: FittedBox(child: Text('ПАУЗА ${data['myPausesLeft']}/${data['pauseLimit']} · 10 с')),
                    ),
                  ),
                if (data['myCanPause'] == true) const SizedBox(width: 8),
                Expanded(
                  child: TextButton(
                    onPressed: () => leaveMatch(data),
                    child: const FittedBox(child: Text('ВЫЙТИ ИЗ-ЗА СТОЛА')),
                  ),
                ),
              ],
            ),
          ],
        );
      }
      if (showingDeal) return hintText('Карты раздаются по одной…', color: const Color(0xFFE6B74F));
      if (myAwaiting == 'lead') {
        final ok = selected.isNotEmpty && leadKeys.contains(selKey);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            hintText(selected.isEmpty
                ? 'Ваш заход: одна карта, несколько одной масти или одного достоинства'
                : ok
                    ? 'Заходите ${selected.length} ${cardsWord(selected.length)} — столько кладёт каждый'
                    : 'Так зайти нельзя: только одной масти или одного достоинства'),
            SizedBox(
              height: 50,
              child: FilledButton(
                onPressed: ok && canSelect ? () => move('lead') : null,
                child: Text(selected.length > 1 ? 'ЗАЙТИ ×${selected.length}' : 'ЗАЙТИ',
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              ),
            ),
          ],
        );
      }
      if (myAwaiting == 'beat') {
        final canBeat = selected.length == need && beatKeys.contains(selKey);
        final canFold = selected.length == need;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            hintText(beatOptions.isEmpty
                ? 'Побить нечем — выберите $need ${cardsWord(need)} и «НЕ БИТЬ»: они лягут рубашкой'
                : selected.length == need && !canBeat
                    ? 'Этими не побить — можно только «НЕ БИТЬ» (рубашкой)'
                    : 'Побить $need ${cardsWord(need)} (каждую своей) или «НЕ БИТЬ» — $need любых рубашкой'),
            Row(
              children: [
                // Подобрать самые дешёвые карты, которыми можно побить (первый вариант от сервера).
                if (beatOptions.isNotEmpty) ...[
                  SizedBox(
                    width: 50,
                    height: 50,
                    child: IconButton.outlined(
                      tooltip: 'Подобрать, чем побить',
                      onPressed: canSelect
                          ? () => setState(() {
                                selected
                                  ..clear()
                                  ..addAll(beatOptions.first);
                              })
                          : null,
                      icon: const Icon(Icons.lightbulb_outline),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child: FilledButton(
                      onPressed: canBeat && canSelect ? () => move('beat') : null,
                      child: const Text('ПОБИТЬ', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SizedBox(
                    height: 50,
                    child: OutlinedButton(
                      onPressed: canFold && canSelect ? () => move('closed') : null,
                      child: const Text('НЕ БИТЬ', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                    ),
                  ),
                ),
              ],
            ),
          ],
        );
      }
      if (myAwaiting == 'closed') {
        final shahOn = trick?['shah'] == true;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            hintText(shahOn
                ? 'ШАХ — бить нельзя. Положите $need ${cardsWord(need)} рубашкой'
                : 'Вы не бьёте в этой взятке — новый круг: положите $need ${cardsWord(need)} рубашкой'),
            SizedBox(
              height: 50,
              child: FilledButton(
                onPressed: selected.length == need && canSelect ? () => move('closed') : null,
                child: Text('РУБАШКОЙ ×$need', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              ),
            ),
          ],
        );
      }
      return hintText(awaitedId != null ? 'Ходит ${nameOf(data, awaitedId)}…' : '');
    }

    // ——— окна поверх стола ———
    Widget? partyPopup;
    final pp = partyPopupData;
    if (pp != null) {
      partyPopup = ShahPartyResultPopup(
        result: pp['result'] as Map<String, dynamic>,
        sideNames: (pp['sideNames'] as List).cast<String>(),
        mySide: pp['mySide'] as int,
        nextMultiplier: pp['nextMultiplier'] as int,
        limit: pp['limit'] as int,
        leftover: pp['leftover'] is Map ? pp['leftover'] as Map : null,
        nextDealerName: pp['nextDealer'] as String?,
        matchOver: finished,
        onClose: hidePartyPopup,
      );
    }
    // Итог партии — пока партия окончена и новую не сдали; итог стола — когда стол закрыт.
    Widget? matchPopup;
    final hasSeries = ((data['series'] as List?) ?? const []).isNotEmpty;
    if ((finished || matchOver) && hasSeries && !matchHeld && !matchClosed && partyPopup == null) {
      matchPopup = ShahMatchOverPopup(room: data, myId: myId, onClose: () => setState(() => matchClosed = true));
    }

    final personalPause = data['personalPause'] is Map ? Map<String, dynamic>.from(data['personalPause'] as Map) : null;
    final absenceMinutes = ((data['settings'] as Map?)?['absenceMinutes'] as num?)?.toInt() ?? 1;

    return PopScope(
      canPop: finished || watching,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Уйти от стола?'),
            content: Text(
              'Игра не остановится: пока вас нет, за вас ходит таймер. Два пропуска подряд — стол на паузе, '
              'тратится ваш запас $absenceMinutes мин. Кончится запас — ваша сторона проиграет партию.',
            ),
            actions: [
              FilledButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ОСТАТЬСЯ')),
              TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('УЙТИ')),
            ],
          ),
        );
        if (leave == true && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
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
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Уйти от стола',
                        onPressed: () => Navigator.of(context).maybePop(),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints.tightFor(width: 32, height: 32),
                        iconSize: 20,
                        icon: const Icon(Icons.arrow_back_ios_new),
                      ),
                      const SizedBox(width: 4),
                      if (data['practice'] == true) ...[const PracticeChip(), const SizedBox(width: 6)],
                      if (spectators > 0) ...[SpectatorsChip(count: spectators), const SizedBox(width: 6)],
                      Flexible(
                        flex: 2,
                        child: Text(
                          'партия $matchNumber/$matchLimit',
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                          style: const TextStyle(color: Color(0xFFD4A94F), fontSize: 13, fontWeight: FontWeight.w800),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 3,
                        child: Text(
                          turnLeft != null && !paused && !finished && stage == 'playing' && !showingDeal
                              ? '$headline · $turnLeft'
                              : headline,
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                          textAlign: TextAlign.right,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                            color: myTurn && turnLeft != null && turnLeft <= 5
                                ? Colors.redAccent
                                : myTurn
                                    ? Colors.greenAccent
                                    : Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ShahScoreBoard(
                    game: game,
                    players: players,
                    onTap: () => showShahHistory(context, data, game, players, myId),
                  ),
                  if (deckTrumpBar(game, party, capacity, back) case final bar?) bar,
                  if (moreVoteResultLine(data) case final line?) line,
                  if (personalPause != null && !finished) personalPauseBar(personalPause),
                  const SizedBox(height: 4),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, box) => Stack(
                        children: [
                          SingleChildScrollView(child: roundTable(box.maxHeight)),
                          if (paused && !finished)
                            Positioned(
                              left: 10,
                              right: 10,
                              top: 12,
                              child: Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: const Color(0xF20B1620),
                                  borderRadius: BorderRadius.circular(16),
                                  border: Border.all(color: const Color(0xFFE6B74F), width: 1.5),
                                  boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 18, offset: Offset(0, 6))],
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Text(
                                      [
                                        for (final p in pausePlayers)
                                          '${p['name']} ${p['reason'] == 'away' ? 'отошёл' : 'отключился'} — ждём '
                                              '${fmtClock(math.max(0, ((p['secondsLeft'] as num?)?.toInt() ?? 0) - secondsSince(receivedAt)))}',
                                      ].join('\n'),
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(color: Color(0xFFFFC04D), fontSize: 13, fontWeight: FontWeight.w800),
                                    ),
                                    const SizedBox(height: 5),
                                    const Text(
                                      'Не вернётся — его сторона проиграет партию.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(color: Colors.white70, fontSize: 11),
                                    ),
                                    if (iAmAway)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 8),
                                        child: FilledButton(
                                          onPressed: sending ? null : () => post('back'),
                                          child: const Text('Я ЗДЕСЬ'),
                                        ),
                                      ),
                                  ],
                                ),
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
                                        border: Border.all(color: announcement!.color, width: 2),
                                        boxShadow: [BoxShadow(color: announcement!.color.withValues(alpha: 0.5), blurRadius: 24)],
                                      ),
                                      child: Text.rich(
                                        TextSpan(
                                          text: announcement!.text,
                                          children: [
                                            if (announcement!.sub != null)
                                              TextSpan(
                                                text: '\n${announcement!.sub}',
                                                style: const TextStyle(fontSize: 16, color: Colors.white),
                                              ),
                                          ],
                                        ),
                                        textAlign: TextAlign.center,
                                        style: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: announcement!.color),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          if (partyPopup != null) Positioned.fill(child: partyPopup),
                          if (matchPopup != null) Positioned.fill(child: matchPopup),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (watching)
                    SpectatorBar(canSit: false, onSit: () {})
                  else ...[
                    const Text(
                      'ВАШИ КАРТЫ',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.1, color: Color(0xFFE6B74F)),
                    ),
                    handRow(),
                  ],
                  const SizedBox(height: 8),
                  actions(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
