// Еженедельный турнир (RULES.md §19, 31.10.2026): регистрация, столы отбора, финалисты,
// финал, победитель. Всё решает сервер — экран только показывает и отправляет действия.
part of '../main.dart';

// Живые обновления турнира по Socket.IO: сервер присылает 'tournament' после каждого
// изменения (зарегистрировался, сел за стол, стол сыгран, финалисты, победитель).
class TournamentLink {
  TournamentLink({required this.onData}) {
    _socket = io.io(
      apiBase,
      io.OptionBuilder().setTransports(['websocket']).enableForceNew().disableAutoConnect().build(),
    );
    _socket.onConnect((_) => _socket.emit('watch_tournament', {'token': Session.token}));
    _socket.on('tournament', (data) {
      if (data is Map) onData(Map<String, dynamic>.from(data));
    });
    _socket.connect();
  }

  final void Function(Map<String, dynamic> data) onData;
  late final io.Socket _socket;

  bool get connected => _socket.connected;

  void dispose() => _socket.dispose();
}

// 93 784 секунды → «1 д 02:03:04»; меньше суток — «02:03:04».
String fmtCountdown(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  final days = s ~/ 86400;
  final h = (s % 86400) ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = s % 60;
  String two(int v) => v.toString().padLeft(2, '0');
  return '${days > 0 ? '$days д ' : ''}${two(h)}:${two(m)}:${two(sec)}';
}

// «4 места», «5 мест» — за столом 4–7.
String placesText(int n) => n >= 2 && n <= 4 ? '$n места' : '$n мест';

// «🏆», «🏆×2» — значок победителя турнира (§19.12).
String winsBadge(int wins) => wins <= 0 ? '' : wins == 1 ? '🏆' : '🏆×$wins';

const _tourGold = Color(0xFFD4A94F);

// Предупреждение перед регистрацией — слово в слово от владельца (§19.2).
Future<bool> confirmTournamentEntry(BuildContext context) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('ВАЖНО! Участие в турнире обязательно.',
          style: TextStyle(fontWeight: FontWeight.w900, color: Colors.redAccent)),
      content: const Text(
        'Если вы зарегистрируетесь, но не сыграете свой турнирный стол, самовольно выйдете из игры '
        'или не вернётесь после отключения, вы получите:\n'
        '— бан на 24 часа;\n'
        '— −1.5 рейтинга;\n'
        '— ваши турнирные монеты перейдут в казну турнира.\n\n'
        'Продолжить регистрацию?',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ПОДТВЕРДИТЬ УЧАСТИЕ')),
      ],
    ),
  );
  return ok == true;
}

const _tourErrors = <String, String>{
  'registration closed': 'Регистрация уже закрыта.',
  'already registered': 'Вы уже зарегистрированы в этом турнире.',
  'not enough coins': 'Для участия нужно 10 000 монет в кошельке.',
  'not registered': 'Вы не зарегистрированы в этом турнире.',
  'cannot sit': 'Вы уже сыграли свой стол или выбыли из турнира.',
  'table is starting': 'Стол уже запускается — свободные места займут боты.',
  'tournament stage is over': 'Этот этап турнира уже закончился.',
  'no tables now': 'Сейчас столов нет.',
  'tournament table': 'За турнирный стол садятся с экрана «ТУРНИР».',
  'not a tournament participant': 'Этот игрок не может сесть за этот стол.',
};

String tournamentError(Object e) {
  if (e is ApiFailure && _tourErrors[e.code] != null) return _tourErrors[e.code]!;
  return userErrorMessage(e);
}

// Сесть за турнирный стол (§19.3): сервер сажает с турнирным балансом, дальше — лобби стола.
Future<void> sitAtTournamentTable(BuildContext context, int tableNo) async {
  try {
    final response = await apiRequest(http.post(
      Uri.parse('$apiBase/tournament/tables/$tableNo/sit'),
      headers: authHeaders(),
      body: jsonEncode({}),
    ));
    expectStatus(response, const [200]);
    final room = jsonDecode(response.body) as Map<String, dynamic>;
    if (!context.mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => LobbyScreen(roomCode: room['id'].toString(), currentPlayerId: Session.id)),
    );
  } catch (e) {
    if (!context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFF7A1F2A),
      content: Text(tournamentError(e)),
    ));
  }
}

class TournamentScreen extends StatefulWidget {
  const TournamentScreen({super.key});

  @override
  State<TournamentScreen> createState() => _TournamentScreenState();
}

class _TournamentScreenState extends State<TournamentScreen> {
  Map<String, dynamic>? data;
  DateTime receivedAt = DateTime.now();
  String? error;
  bool registering = false;
  late final TournamentLink link;
  Timer? ticker;
  Timer? poll;

  @override
  void initState() {
    super.initState();
    link = TournamentLink(onData: apply);
    refresh();
    ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
    // Сокет отвалился — опрашиваем, пока он не вернётся.
    poll = Timer.periodic(fallbackPollInterval, (_) {
      if (!link.connected) refresh();
    });
  }

  @override
  void dispose() {
    ticker?.cancel();
    poll?.cancel();
    link.dispose();
    super.dispose();
  }

  void apply(Map<String, dynamic> d) {
    if (!mounted) return;
    setState(() {
      data = d;
      error = null;
      receivedAt = DateTime.now();
    });
  }

  Future<void> refresh() async {
    try {
      final response = await apiRequest(http.get(Uri.parse('$apiBase/tournament'), headers: authHeaders()));
      expectStatus(response, const [200]);
      apply(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (mounted && data == null) setState(() => error = userErrorMessage(e));
    }
  }

  // Секунд до срока: сервер прислал число, с тех пор прошло время.
  int left(Object? seconds) =>
      seconds is num ? seconds.toInt() - DateTime.now().difference(receivedAt).inSeconds : 0;

  Future<void> register() async {
    if (registering) return;
    if (!await confirmTournamentEntry(context)) return;
    setState(() => registering = true);
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/tournament/register'),
        headers: authHeaders(),
        body: jsonEncode({'confirm': true}),
      ));
      expectStatus(response, const [200]);
      apply(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xFF7A1F2A),
        content: Text(tournamentError(e)),
      ));
    } finally {
      if (mounted) setState(() => registering = false);
    }
  }

  void openRoom(String roomId) => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => LobbyScreen(roomCode: roomId, currentPlayerId: Session.id)),
      );

  void watchRoom(String roomId) => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => GameTableScreen(roomCode: roomId, currentPlayerId: Session.id, spectator: true),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final d = data;
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: d == null
          ? Center(child: error == null ? const CircularProgressIndicator() : Text(error!))
          : RefreshIndicator(
              onRefresh: refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                children: content(d),
              ),
            ),
    );
  }

  List<Widget> content(Map<String, dynamic> d) {
    final t = d['tournament'] is Map ? Map<String, dynamic>.from(d['tournament'] as Map) : null;
    final me = d['me'] is Map ? Map<String, dynamic>.from(d['me'] as Map) : null;
    final widgets = <Widget>[
      const Center(
        child: Text('ТУРНИР НЕДЕЛИ', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: _tourGold)),
      ),
      const SizedBox(height: 4),
    ];
    final status = t?['status']?.toString();
    if (t == null || status == 'finished' || status == 'cancelled') {
      if (t != null && status == 'finished') widgets.addAll(finished(t));
      if (t != null && status == 'cancelled') {
        widgets.add(infoCard('Турнир не состоялся',
            'Участников меньше ${d['minParticipants']}. 10 000 монет вернулись всем участникам.'));
      }
      final next = (d['nextStartsAt'] as num?)?.toInt();
      if (next != null) {
        final secs = (next - ((d['serverNow'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch)) ~/ 1000;
        widgets.add(infoCard('Следующий турнир', 'Понедельник, 20:00 по Казахстану · через ${fmtCountdown(left(secs))}\n'
            'Регистрация — 24 часа, участие — 10 000 монет, минимум ${d['minParticipants']} игроков.'));
      }
      if (t != null && status == 'finished') widgets.addAll(participantsList(t, me, title: 'ИТОГИ'));
      return widgets;
    }

    final phase = t['phase']?.toString();
    final phaseText = switch (phase) {
      'registration' => 'РЕГИСТРАЦИЯ',
      'qualification' => 'ОТБОР',
      'final_waiting' => 'ФИНАЛИСТЫ',
      'final_playing' => 'ФИНАЛ',
      _ => '',
    };
    final deadlineText = switch (phase) {
      'registration' => 'до конца регистрации',
      'qualification' => 'до конца отбора',
      _ => 'до конца финала',
    };
    widgets.add(Center(
      child: Text('$phaseText · $deadlineText ${fmtCountdown(left(t['secondsLeft']))}',
          style: const TextStyle(fontWeight: FontWeight.w800)),
    ));
    widgets.add(const SizedBox(height: 12));

    if (phase == 'registration') {
      widgets.add(statsRow([
        ('УЧАСТИЕ', fmtCoins((d['fee'] as num).toInt())),
        ('УЧАСТНИКОВ', '${t['participantsCount']}'),
        ('МИНИМУМ', '${d['minParticipants']}'),
      ]));
      widgets.add(const SizedBox(height: 12));
      if (me?['registered'] == true) {
        widgets.add(infoCard('Вы зарегистрированы ✓',
            'Когда регистрация закроется, появятся столы — выберите свободное место. На отбор 72 часа.'));
      } else {
        final err = me?['registerError']?.toString();
        widgets.add(GarbaButton(
          label: registering ? '…' : 'УЧАСТВОВАТЬ — 10 000',
          onTap: me?['canRegister'] == true && !registering ? register : () => showReason(err),
        ));
        if (err == 'not enough coins') {
          widgets.add(const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('Для участия нужно 10 000 монет в кошельке.',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.white60)),
          ));
        }
      }
      widgets.addAll(participantsList(t, me, title: 'УЧАСТНИКИ'));
      return widgets;
    }

    widgets.add(statsRow([
      ('КАЗНА', fmtCoins((t['treasury'] as num).toInt())),
      if (me?['registered'] == true && me?['balance'] is num) ('МОЙ БАЛАНС', fmtCoins((me!['balance'] as num).toInt())),
      ('УЧАСТНИКОВ', '${t['participantsCount']}'),
    ]));
    widgets.add(const SizedBox(height: 10));
    if (me != null && me['registered'] == true) widgets.add(myStatus(me, phase ?? ''));

    final tables = ((t['tables'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final stage = phase == 'qualification' ? 'qual' : 'final';
    final stageTables = tables.where((x) => x['stage'] == stage).toList();
    widgets.add(sectionTitle(stage == 'qual' ? 'СТОЛЫ' : 'ФИНАЛЬНЫЙ СТОЛ'));
    for (final table in stageTables) {
      widgets.add(tableCard(table, me));
    }
    if (stage == 'final') {
      widgets.addAll(participantsList(t, me, title: 'ФИНАЛИСТЫ', onlyFinalists: true));
    }
    widgets.addAll(participantsList(t, me, title: stage == 'final' ? 'ВСЕ УЧАСТНИКИ' : 'УЧАСТНИКИ'));
    return widgets;
  }

  void showReason(String? err) {
    final text = switch (err) {
      'not enough coins' => 'Для участия нужно 10 000 монет в кошельке.',
      'banned' => 'Сейчас у вас бан — зарегистрироваться нельзя.',
      'already registered' => 'Вы уже зарегистрированы.',
      _ => 'Регистрация закрыта.',
    };
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(behavior: SnackBarBehavior.floating, content: Text(text)));
  }

  Widget sectionTitle(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 18, 0, 8),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w900, color: _tourGold, letterSpacing: 1.1)),
      );

  Widget infoCard(String title, String text) => Card(
        color: const Color(0xFF13232E),
        margin: const EdgeInsets.only(top: 10),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              Text(text, style: const TextStyle(color: Colors.white70)),
            ],
          ),
        ),
      );

  Widget statsRow(List<(String, String)> items) => Row(
        children: [
          for (final (i, item) in items.indexed) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF13232E),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: _tourGold.withValues(alpha: 0.5)),
                ),
                child: Column(
                  children: [
                    Text(item.$2, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                    Text(item.$1, style: const TextStyle(fontSize: 11, color: Colors.white60)),
                  ],
                ),
              ),
            ),
          ],
        ],
      );

  // Что со мной в турнире: где сижу, сыграл ли, прошёл ли в финал.
  Widget myStatus(Map<String, dynamic> me, String phase) {
    final status = me['status']?.toString();
    final roomId = me['roomId']?.toString();
    final balance = (me['balance'] as num?)?.toInt() ?? 0;
    final (title, text) = switch (status) {
      'registered' => roomId != null
          ? ('Вы за столом', 'Стол начнётся, когда соберутся все. Позовите участников кнопкой «ПРИГЛАСИТЬ».')
          : ('Выберите стол', 'Сядьте на свободное место. Не сыграете свой стол до конца отбора — бан 24 часа и −1.5 рейтинга.'),
      'playing' => ('Вы играете отборочный стол', 'Ваш турнирный баланс: ${fmtCoins(balance)}.'),
      'played' => ('Ваш стол сыгран', 'Итог: ${fmtCoins(balance)}. Финалисты — после конца отбора.'),
      'finalist' => roomId != null
          ? ('Вы за финальным столом', 'Финал начнётся, когда соберутся все финалисты.')
          : ('Вы в финале!', 'Садитесь за финальный стол со своими ${fmtCoins(balance)}.'),
      'final_playing' => ('Вы играете финал', 'Ваш баланс: ${fmtCoins(balance)}.'),
      'final_done' => ('Финал сыгран', 'Ваш итог: ${fmtCoins(balance)}.'),
      'out' => ('Вы не прошли в финал', 'Ваш итог отбора — ${fmtCoins((me['balance'] as num?)?.toInt() ?? 0)} — ушёл в казну турнира.'),
      'penalized' => ('Вы исключены из турнира', 'Вы не сыграли стол или вышли из игры: бан 24 часа, −1.5 рейтинга, монеты — в казну.'),
      _ => ('', ''),
    };
    if (title.isEmpty) return const SizedBox.shrink();
    return Card(
      color: status == 'penalized' ? const Color(0xFF3A1E1E) : const Color(0xFF1E3A2A),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
            const SizedBox(height: 4),
            Text(text, style: const TextStyle(color: Colors.white70)),
            if (roomId != null) ...[
              const SizedBox(height: 10),
              FilledButton(onPressed: () => openRoom(roomId), child: const Text('К МОЕМУ СТОЛУ')),
            ],
          ],
        ),
      ),
    );
  }

  // Стол: номер, места, кто сидит, свободные, состояние; «СЕСТЬ», «ПРИГЛАСИТЬ».
  Widget tableCard(Map<String, dynamic> table, Map<String, dynamic>? me) {
    final no = (table['tableNo'] as num).toInt();
    final capacity = (table['capacity'] as num).toInt();
    final status = table['status']?.toString();
    final players = ((table['players'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final free = (table['free'] as num?)?.toInt() ?? 0;
    final bots = (table['bots'] as num?)?.toInt() ?? 0;
    final roomId = table['roomId']?.toString();
    final mine = roomId != null && me?['roomId']?.toString() == roomId;
    final statusText = switch (status) {
      'waiting' => table['lastCall'] == true ? 'ПОСЛЕДНИЙ ШАНС — потом боты' : 'ЖДЁТ ИГРОКОВ',
      'playing' => 'ИДЁТ ИГРА · ${fmtClock(left(table['secondsLeft']).clamp(0, 99999))}',
      'finished' => 'СЫГРАН',
      'skipped' => 'НЕ СОБРАЛСЯ',
      _ => '',
    };
    final title = table['stage'] == 'final' ? 'ФИНАЛ' : 'СТОЛ №$no';
    return Card(
      color: mine ? const Color(0xFF1E3A2A) : const Color(0xFF13232E),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                const SizedBox(width: 8),
                Text(placesText(capacity), style: const TextStyle(color: Colors.white60)),
                const Spacer(),
                Flexible(
                  child: Text(statusText,
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                        color: status == 'playing' ? Colors.greenAccent : _tourGold,
                      )),
                ),
              ],
            ),
            if (status == 'waiting')
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  'Занято ${players.length} · свободно $free${bots > 0 ? ' · ещё $bots — боты' : ''}',
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
              ),
            if (players.isNotEmpty) ...[
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final p in players)
                    Chip(
                      visualDensity: VisualDensity.compact,
                      label: Text(
                        '${p['bot'] == true ? '🤖 ' : ''}${p['name']}${status == 'playing' ? ' · ${fmtCoins((p['balance'] as num?)?.toInt() ?? 0)}' : ''}',
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                if (status == 'waiting' && mine) ...[
                  Expanded(child: FilledButton(onPressed: () => openRoom(roomId), child: const Text('ОТКРЫТЬ'))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: free > 0 ? () => showTournamentInviteSheet(context, roomId, data) : null,
                      child: const Text('ПРИГЛАСИТЬ'),
                    ),
                  ),
                ] else if (status == 'waiting')
                  Expanded(
                    child: FilledButton(
                      onPressed: me?['canSit'] == true && free > 0 ? () => sitAtTournamentTable(context, no) : null,
                      child: const Text('СЕСТЬ'),
                    ),
                  )
                else if (status == 'playing' && roomId != null)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: mine ? () => openRoom(roomId) : () => watchRoom(roomId),
                      child: Text(mine ? 'К СТОЛУ' : 'НАБЛЮДАТЬ'),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // Турнирный список (§19.11): сыгравшие — по монетам, финалисты сверху.
  List<Widget> participantsList(Map<String, dynamic> t, Map<String, dynamic>? me,
      {required String title, bool onlyFinalists = false}) {
    var list = ((t['participants'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (onlyFinalists) {
      list = list.where((p) => ['finalist', 'final_playing', 'final_done'].contains(p['status'])).toList();
    } else {
      list = list.where((p) => p['status'] != 'refunded').toList();
    }
    if (list.isEmpty) return const [];
    String statusText(Map<String, dynamic> p) => switch (p['status']) {
          'registered' => p['seatedAt'] != null
              ? 'сидит за столом №${p['seatedAt']}'
              : t['status'] == 'registration'
                  ? 'зарегистрирован'
                  : 'ещё не сыграл',
          'playing' => 'играет · стол №${p['tableNo']}',
          'played' => 'сыграл · стол №${p['tableNo']}',
          'finalist' => 'финалист',
          'final_playing' => 'играет финал',
          'final_done' => p['finalPlace'] != null ? '${p['finalPlace']}-е место' : 'сыграл финал',
          'out' => 'не прошёл в финал',
          'penalized' => 'исключён',
          _ => '',
        };
    final showBalance = t['status'] != 'registration';
    return [
      sectionTitle(title),
      for (final p in list)
        Card(
          color: p['code'] != null && p['code'] == me?['code'] ? const Color(0xFF1E3A2A) : const Color(0xFF0F1C25),
          margin: const EdgeInsets.only(bottom: 6),
          child: ListTile(
            dense: true,
            onTap: p['code'] == null ? null : () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => PlayerScreen(code: p['code'].toString())),
                ),
            leading: AvatarView(
                avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 18, frame: p['frame']?.toString()),
            title: Text(
              '${p['name']}${((p['wins'] as num?)?.toInt() ?? 0) > 0 ? ' ${winsBadge((p['wins'] as num).toInt())}' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text(statusText(p), style: const TextStyle(fontSize: 12, color: Colors.white60)),
            trailing: showBalance && p['status'] != 'registered' && p['status'] != 'penalized'
                ? Text(fmtCoins((p['balance'] as num?)?.toInt() ?? 0),
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      color: ((p['balance'] as num?)?.toInt() ?? 0) > 10000 ? Colors.greenAccent : Colors.white,
                    ))
                : null,
          ),
        ),
    ];
  }

  // Победитель (§19.9): аватар, имя, итог финала, казна, выигрыш, сколько раз выигрывал.
  List<Widget> finished(Map<String, dynamic> t) {
    final w = t['winner'] is Map ? Map<String, dynamic>.from(t['winner'] as Map) : null;
    if (w == null) {
      return [infoCard('Турнир закончен', 'В финал некого было вести — победителя нет.')];
    }
    final wins = (w['wins'] as num?)?.toInt() ?? 1;
    final byQualification = w['byQualification'] == true;
    return [
      const SizedBox(height: 8),
      Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFF3B2A00), Color(0xFF13232E)]),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _tourGold, width: 2),
        ),
        child: Column(
          children: [
            const Text('🥇 ПОБЕДИТЕЛЬ ТУРНИРА', style: TextStyle(fontWeight: FontWeight.w900, color: _tourGold)),
            const SizedBox(height: 10),
            AvatarView(avatar: w['avatar']?.toString(), name: w['name'].toString(), radius: 36, frame: w['frame']?.toString()),
            const SizedBox(height: 8),
            Text('${w['name']} ${winsBadge(wins)}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            if (byQualification) ...[
              const SizedBox(height: 4),
              const Text('Финал не сыгран — победитель по отбору',
                  textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
            ],
            const SizedBox(height: 10),
            statsRow([
              (byQualification ? 'ИТОГ ОТБОРА' : 'ИТОГ ФИНАЛА', fmtCoins((w['balance'] as num?)?.toInt() ?? 0)),
              ('КАЗНА', fmtCoins((w['treasury'] as num?)?.toInt() ?? 0)),
            ]),
            const SizedBox(height: 10),
            Text('ВЫИГРЫШ ${fmtCoins((w['prize'] as num?)?.toInt() ?? 0)}',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: _tourGold)),
            Text('Побед в турнирах: $wins', style: const TextStyle(color: Colors.white70)),
          ],
        ),
      ),
    ];
  }
}

// «ПРИГЛАСИТЬ» за турнирный стол (§19.3): любого участника, кто ещё может сесть.
Future<void> showTournamentInviteSheet(BuildContext context, String roomId, Map<String, dynamic>? data) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: const Color(0xFF13232E),
    isScrollControlled: true,
    builder: (_) => TournamentInviteSheet(roomId: roomId),
  );
}

class TournamentInviteSheet extends StatefulWidget {
  final String roomId;
  const TournamentInviteSheet({super.key, required this.roomId});

  @override
  State<TournamentInviteSheet> createState() => _TournamentInviteSheetState();
}

class _TournamentInviteSheetState extends State<TournamentInviteSheet> {
  List<Map<String, dynamic>>? people;
  final invited = <String>{};
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await apiRequest(http.get(Uri.parse('$apiBase/tournament'), headers: authHeaders()));
      expectStatus(response, const [200]);
      final d = jsonDecode(response.body) as Map<String, dynamic>;
      final t = d['tournament'] is Map ? d['tournament'] as Map : const {};
      final eligible = t['status'] == 'final' ? 'finalist' : 'registered';
      final list = ((t['participants'] as List?) ?? const [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .where((p) => p['status'] == eligible && p['code'] != null && p['seatedAt'] == null)
          .toList();
      if (mounted) setState(() => people = list);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> invite(String code) async {
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/${widget.roomId}/invite'),
        headers: authHeaders(),
        body: jsonEncode({'code': code}),
      ));
      expectStatus(response, const [200]);
      if (mounted) setState(() => invited.add(code));
    } catch (e) {
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      messenger.showSnackBar(SnackBar(behavior: SnackBarBehavior.floating, content: Text(tournamentError(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = people;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.6),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Позвать участников',
                  textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              const Text('Приглашение придёт на главный экран и в Telegram',
                  textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, fontSize: 12)),
              const SizedBox(height: 12),
              if (error != null)
                Text(error!, textAlign: TextAlign.center)
              else if (list == null)
                const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
              else if (list.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Все участники уже сели за столы',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
                )
              else
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final p in list)
                        ListTile(
                          leading: AvatarView(
                              avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 20, frame: p['frame']?.toString()),
                          title: Text(p['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
                          trailing: FilledButton(
                            onPressed: invited.contains(p['code']) ? null : () => invite(p['code'].toString()),
                            child: Text(invited.contains(p['code']) ? 'ПОЗВАЛИ' : 'ПОЗВАТЬ'),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// Плитка «ТУРНИР» на главном экране — во всю ширину, с этапом турнира.
class TournamentTile extends StatelessWidget {
  final Map<String, dynamic>? brief;
  final VoidCallback onTap;

  const TournamentTile({super.key, required this.brief, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final b = brief;
    final phase = b?['phase']?.toString();
    final registered = b?['registered'] == true;
    final subtitle = switch (phase) {
      'registration' => registered ? 'Вы зарегистрированы' : 'Идёт регистрация — участие 10 000',
      'qualification' => registered ? 'Отбор — сыграйте свой стол' : 'Идёт отбор',
      'final_waiting' || 'final_playing' => 'Идёт финал',
      _ => 'Каждый понедельник в 20:00',
    };
    return SizedBox(
      height: 72,
      child: FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFF3B2A00),
          foregroundColor: Colors.white,
          side: const BorderSide(color: _tourGold, width: 1.5),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
        child: Row(
          children: [
            const Text('🏆', style: TextStyle(fontSize: 30)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('ТУРНИР НЕДЕЛИ',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: _tourGold)),
                  Text(subtitle, style: const TextStyle(fontSize: 13, color: Colors.white70)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}

// Шапка турнирного стола (§19.4): этап и номер, сколько осталось от 40 минут, казна; кто выбыл.
class TournamentTableBar extends StatelessWidget {
  final Map<String, dynamic> tournament;
  final DateTime receivedAt;

  const TournamentTableBar({super.key, required this.tournament, required this.receivedAt});

  @override
  Widget build(BuildContext context) {
    final t = tournament;
    final secs = t['secondsLeft'] is num
        ? ((t['secondsLeft'] as num).toInt() - DateTime.now().difference(receivedAt).inSeconds).clamp(0, 99999)
        : null;
    final lastOut = t['lastOut'] is Map ? Map<String, dynamic>.from(t['lastOut'] as Map) : null;
    final outText = lastOut == null
        ? null
        : switch (lastOut['reason']) {
            'eliminated' => '${lastOut['name']} выбыл — не хватает на взнос',
            'left' => '${lastOut['name']} вышел из турнира',
            _ => '${lastOut['name']} не вернулся',
          };
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFF3B2A00),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: _tourGold.withValues(alpha: 0.7)),
            ),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                '🏆 ${t['stage'] == 'final' ? 'ФИНАЛ' : 'СТОЛ №${t['tableNo']}'}'
                '${secs != null ? ' · до конца ${fmtClock(secs)}' : ''}'
                ' · казна ${fmtCoins((t['treasury'] as num?)?.toInt() ?? 0)}',
                style: const TextStyle(fontWeight: FontWeight.w900, color: _tourGold, fontSize: 13),
              ),
            ),
          ),
          if (outText != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(outText, style: const TextStyle(fontSize: 12, color: Colors.white70)),
            ),
        ],
      ),
    );
  }
}

// «В игре есть победитель турнира 🏆» — в лобби обычной игры (§19.12).
class WinnerBanner extends StatelessWidget {
  final String text;
  const WinnerBanner({super.key, required this.text});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: const Color(0xE03B2A00),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _tourGold),
        ),
        child: Text(text,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: _tourGold)),
      ),
    );
  }
}
