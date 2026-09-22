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
  if (response.statusCode < 200 || response.statusCode >= 300) return response.body;
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

// «Быстрая игра»: сервер сажает в самую заполненную открытую комнату, куда хватает
// монет, а если таких нет — создаёт открытую (5 игроков, взнос 100) и ждёт людей.
Future<void> quickGame(BuildContext context) async {
  try {
    final response = await http.post(
      Uri.parse('$apiBase/rooms/quick'),
      headers: authHeaders(),
      body: jsonEncode({}),
    );
    final error = roomEntryError(response);
    if (error != null) throw Exception(error);
    final room = jsonDecode(response.body) as Map<String, dynamic>;
    if (!context.mounted) return;
    openLobby(context, room['id'].toString());
  } catch (e) {
    if (!context.mounted) return;
    showGarbaError(context, e);
  }
}

class OpenRoomsScreen extends StatefulWidget {
  const OpenRoomsScreen({super.key});

  @override
  State<OpenRoomsScreen> createState() => _OpenRoomsScreenState();
}

class _OpenRoomsScreenState extends State<OpenRoomsScreen> {
  List<Map<String, dynamic>>? rooms;
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
      final response = await http.get(Uri.parse('$apiBase/rooms/open'), headers: authHeaders());
      expectStatus(response, const [200]);
      final list = ((jsonDecode(response.body) as Map)['rooms'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (mounted) setState(() {
        rooms = list;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> join(String roomId) async {
    if (joining) return;
    setState(() => joining = true);
    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/$roomId/join'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );
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
            else if (list.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 24),
                child: Text(
                  'Открытых комнат, куда хватает монет, сейчас нет.\n'
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
                      '${free == 1 ? 'Ждут одного игрока' : 'Свободно мест: $free'}',
                    ),
                    isThreeLine: true,
                    trailing: FilledButton(
                      onPressed: joining ? null : () => join(r['id'].toString()),
                      child: const Text('ВОЙТИ'),
                    ),
                  ),
                );
              }),
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
  if (code == null || player['id']?.toString() == Session.id) return;
  Navigator.push(context, MaterialPageRoute(builder: (_) => PlayerScreen(code: code)));
}
