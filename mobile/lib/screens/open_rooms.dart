// Открытые комнаты и «Быстрая игра» (решение владельца, 19.09.2026): у игрока нет друзей
// онлайн или не хватает одного за столом — открытая комната видна всем, войти без кода.
part of '../main.dart';

// Понятный текст для отказа сервера при входе: занят в другой комнате, не хватает монет.
String? roomEntryError(http.Response response) {
  final busy = busyInRoomMessage(response);
  if (busy != null) return busy;
  if (response.statusCode == 403) {
    final err = jsonDecode(response.body);
    if (err is Map && err['error'] == 'not enough coins to enter') {
      return 'Недостаточно монет: нужно ${fmtCoins((err['minBalance'] as num).toInt())}, '
          'у вас ${fmtCoins((err['balance'] as num).toInt())}';
    }
  }
  if (response.statusCode == 409 && response.body.contains('room is full')) {
    return 'Пока вы выбирали, комнату заняли. Выберите другую.';
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    return userErrorMessage(ApiFailure.fromResponse(response));
  }
  return null;
}

void openLobby(BuildContext context, String roomId, {bool replace = false}) {
  final route = MaterialPageRoute(
    builder: (_) => LobbyScreen(roomCode: roomId, currentPlayerId: Session.id),
  );
  if (replace) {
    Navigator.pushReplacement(context, route);
  } else {
    Navigator.push(context, route);
  }
}

// Почему сервер не даёт смотреть стол (RULES.md §18); null — отказ не про наблюдателя.
String? spectateRefusalText(String? error) => switch (error) {
      'playing elsewhere' => 'Вы сейчас в игре. Смотреть чужой стол можно, когда доиграете свою.',
      'blocked' => 'За этим столом игрок, с которым у вас блокировка.',
      _ => null,
    };

// Наблюдать за идущим столом (§18): стол без своей руки и без кнопок. Сначала спрашиваем
// сервер — вдруг смотреть нельзя (сам в игре, блокировка) или игра уже закончилась.
Future<void> watchRoom(BuildContext context, String roomId) async {
  try {
    final response = await apiRequest(http.get(Uri.parse('$apiBase/rooms/$roomId'), headers: authHeaders()));
    if (response.statusCode == 403) {
      final refusal = spectateRefusalText((jsonDecode(response.body) as Map)['error']?.toString());
      if (refusal != null) throw Exception(refusal);
    }
    if (response.statusCode == 404) throw Exception('Эта игра уже закончилась.');
    expectStatus(response, const [200]);
    if (!context.mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => GameTableScreen(roomCode: roomId, currentPlayerId: Session.id, spectator: true),
      ),
    );
  } catch (e) {
    if (!context.mounted) return;
    showGarbaError(context, e);
  }
}

// «Быстрая игра»: сервер сажает в самую заполненную открытую комнату, куда хватает
// монет, а если таких нет — создаёт открытую (5 игроков, взнос 100) и ждёт людей.
// Двойное нажатие не отправляет второй запрос: иначе второй ответ «вы уже в комнате»
// всплывал бы поверх только что открытого лобби.
bool _quickGameBusy = false;

// Минимум комнаты «Быстрой игры» — как QUICK_ROOM.minBalance в backend/src/openRooms.ts.
const quickRoomMinBalance = 1000;

Future<void> quickGame(BuildContext context) async {
  if (_quickGameBusy) return;
  _quickGameBusy = true;
  try {
    final buyIn = await askBuyIn(context, minBalance: quickRoomMinBalance);
    if (buyIn == null) return;
    final response = await apiRequest(http.post(
      Uri.parse('$apiBase/rooms/quick'),
      headers: authHeaders(),
      body: jsonEncode({'buyIn': buyIn}),
    ));
    final error = roomEntryError(response);
    if (error != null) throw Exception(error);
    final room = jsonDecode(response.body) as Map<String, dynamic>;
    if (!context.mounted) return;
    openLobby(context, room['id'].toString());
  } catch (e) {
    if (!context.mounted) return;
    showGarbaError(context, e);
  } finally {
    _quickGameBusy = false;
  }
}

class OpenRoomsScreen extends StatefulWidget {
  const OpenRoomsScreen({super.key});

  @override
  State<OpenRoomsScreen> createState() => _OpenRoomsScreenState();
}

class _OpenRoomsScreenState extends State<OpenRoomsScreen> {
  List<Map<String, dynamic>>? rooms;
  // Идущие столы — смотреть или сесть на освободившееся место (§18).
  List<Map<String, dynamic>> live = const [];
  String? error;
  Timer? refresher;
  bool joining = false;

  @override
  void initState() {
    super.initState();
    load();
    // Комнаты появляются и заполняются — список обновляется сам.
    refresher = Timer.periodic(const Duration(seconds: 4), (_) => load());
  }

  @override
  void dispose() {
    refresher?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final response = await apiRequest(http.get(Uri.parse('$apiBase/rooms/open'), headers: authHeaders()));
      expectStatus(response, const [200]);
      final body = jsonDecode(response.body) as Map;
      List<Map<String, dynamic>> parse(Object? raw) =>
          ((raw as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      // Начатые игры со свободным местом сервер кладёт и в rooms (для старых сборок) —
      // здесь они в «Идут сейчас», с кнопкой «СЕСТЬ».
      final list = parse(body['rooms']).where((r) => r['started'] != true).toList();
      if (mounted) setState(() {
        rooms = list;
        live = parse(body['live']);
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> join(String roomId, int minBalance, Map settings) async {
    if (joining) return;
    setState(() => joining = true);
    try {
      final buyIn = await askBuyIn(context, minBalance: minBalance, settings: settings);
      if (buyIn == null) return;
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/rooms/$roomId/join'),
        headers: authHeaders(),
        body: jsonEncode({'buyIn': buyIn}),
      ));
      final problem = roomEntryError(response);
      if (problem != null) throw Exception(problem);
      if (!mounted) return;
      openLobby(context, roomId, replace: true);
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e);
      load();
    } finally {
      if (mounted) setState(() => joining = false);
    }
  }

  Widget liveRoomCard(Map<String, dynamic> r) {
    final s = Map<String, dynamic>.from(r['settings'] as Map);
    int v(String k) => (s[k] as num?)?.toInt() ?? 0;
    final id = r['id'].toString();
    final spectators = (r['spectators'] as num?)?.toInt() ?? 0;
    final deal = (r['dealNumber'] as num?)?.toInt() ?? 0;
    final vacancies = (r['vacancies'] as num?)?.toInt() ?? 0;
    return Card(
      color: const Color(0xFF13232E),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${r['creatorName']} · ${r['players']} из ${r['capacity']}',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                ),
                if (r['practice'] == true) ...[
                  const PracticeChip(),
                  const SizedBox(width: 6),
                ],
                if (spectators > 0) SpectatorsChip(count: spectators),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Игра идёт${deal > 0 ? ' · раздача $deal' : ''} · взнос ${fmtCoins(v('ante'))}'
              '\nВремя игры: ${fmtTimeLimit(s['timeLimitMinutes'])}'
              '${vacancies > 0 ? '\nОсвободилось место · вход от ${fmtCoins(v('minBalance'))}' : ''}',
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: () => watchRoom(context, id),
                  icon: const Icon(Icons.visibility, size: 18),
                  label: const Text('НАБЛЮДАТЬ'),
                ),
                if (r['canSit'] == true) ...[
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: joining ? null : () => join(id, v('minBalance'), s),
                    child: const Text('СЕСТЬ'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final list = rooms;
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: RefreshIndicator(
        onRefresh: load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            GarbaButton(label: 'БЫСТРАЯ ИГРА', onTap: () => quickGame(context)),
            const SizedBox(height: 6),
            const Text(
              'Сядем в комнату, где почти все собрались. Нет такой — создадим новую, '
              'и к вам присоединятся.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white54, fontSize: 12),
            ),
            const SizedBox(height: 16),
            if (list == null)
              Center(
                child: error == null ? const CircularProgressIndicator() : Text(error!),
              )
            else if (list.isEmpty && live.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 24),
                child: Text(
                  'Открытых комнат, куда хватает монет, и идущих игр сейчас нет.\n'
                  'Нажмите «Быстрая игра» — создадим комнату, и к вам присоединятся.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
              )
            else
              ...list.map((r) {
                final s = Map<String, dynamic>.from(r['settings'] as Map);
                int v(String k) => (s[k] as num?)?.toInt() ?? 0;
                final free = (r['capacity'] as num).toInt() - (r['players'] as num).toInt();
                return Card(
                  color: const Color(0xFF13232E),
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    title: Text(
                      '${r['creatorName']} · ${r['players']} из ${r['capacity']}',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: Text(
                      'Взнос ${fmtCoins(v('ante'))} · вход от ${fmtCoins(v('minBalance'))}\n'
                      'Время игры: ${fmtTimeLimit(s['timeLimitMinutes'])}\n'
                      '${r['started'] == true ? 'Идёт игра · освободилось место' : free == 1 ? 'Ждут одного игрока' : 'Свободно мест: $free'}',
                    ),
                    isThreeLine: true,
                    trailing: FilledButton(
                      onPressed: joining ? null : () => join(r['id'].toString(), v('minBalance'), s),
                      child: const Text('ВОЙТИ'),
                    ),
                  ),
                );
              }),
            // Идущие столы (§18): «Игра идёт» — смотреть, освободилось место — сесть.
            if (list != null && live.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text(
                'ИДУТ СЕЙЧАС',
                style: TextStyle(fontWeight: FontWeight.w900, letterSpacing: 1.1, color: Color(0xFFE6B74F)),
              ),
              const SizedBox(height: 8),
              ...live.map(liveRoomCard),
            ],
          ],
        ),
      ),
    );
  }
}

// Карточка другого игрока из-за стола или лобби: добавить в друзья, подарок.
// Себя не открываем; у игрока без кода (старое состояние) — тоже ничего.
void openPlayerCard(BuildContext context, Map<String, dynamic> player) {
  final code = player['code']?.toString();
  // У бота сервера карточки нет: ни в друзья, ни подарок (28.09.2026).
  if (code == null || player['id']?.toString() == Session.id || player['bot'] == true) return;
  Navigator.push(context, MaterialPageRoute(builder: (_) => PlayerScreen(code: code)));
}
