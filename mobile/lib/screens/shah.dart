// ШАХ (ветка shah, этап 3, 04.11.2026): плитка на главном, раздел ШАХ, создание стола,
// открытые и идущие столы, вход, лобби и правила. Стол — screens/shah_table.dart.
// Правила — SHAH_RULES.md; всё проверяет сервер (/shah/...), приложение только показывает.
part of '../main.dart';

// Плитка «ШАХ» на главном экране — во всю ширину, как турнир и магазин.
class ShahTile extends StatelessWidget {
  const ShahTile({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Ink(
          height: 92,
          decoration: const BoxDecoration(
            gradient: LinearGradient(colors: [Color(0xFF0B2A3D), Color(0xFF1C5574), Color(0xFF0B2A3D)]),
          ),
          child: const Row(
            children: [
              SizedBox(width: 14),
              ShahMiniCard(card: {'id': 'clubs-6', 'suit': 'clubs', 'rank': '6'}, width: 44),
              SizedBox(width: 14),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ШАХ',
                        style: TextStyle(
                            fontSize: 22, fontWeight: FontWeight.w900, color: Color(0xFFFFD87A), letterSpacing: 2)),
                    SizedBox(height: 2),
                    Text('Вторая игра: 1×1, 1×1×1, 2×2, 3×3', style: TextStyle(fontSize: 13, color: Colors.white70)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Color(0xFFFFD87A), size: 30),
              SizedBox(width: 10),
            ],
          ),
        ),
      ),
    );
  }
}

// Слова ШАХ (владелец 05.11.2026): ПАРТИЯ — игра до −24, РАЗДАЧА — сдали по 6 карт и сыграли,
// СТОЛ — несколько партий подряд тем же составом. На сервере партия — match, раздача — party.

// Взнос за партию (SHAH_RULES.md §18): 1×1 и 1×1×1 — 1 000…10 000, команды — 10 000…20 000, шаг 1 000.
// Проверяет сервер — здесь только кнопки выбора.
List<int> shahAntes(int capacity) => capacity == 4 || capacity == 6
    ? [for (var a = 10000; a <= 20000; a += 1000) a]
    : [for (var a = 1000; a <= 10000; a += 1000) a];

const shahMatchPresets = [1, 3, 5, 10, 20, 30];
const shahMatchesMax = 30;

String shahMatchesWord(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return 'партия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'партии';
  return 'партий';
}

// Условия стола одной строкой: «взнос 1 000 · 3 партии · ход 20 с · ждём 1 мин».
String shahSettingsLine(Map settings) {
  final ante = (settings['ante'] as num?)?.toInt() ?? 0;
  final matches = (settings['matches'] as num?)?.toInt() ?? 1;
  return 'взнос ${fmtCoins(ante)} · $matches ${shahMatchesWord(matches)} · ход ${settings['turnSeconds'] ?? 20} с · '
      'ждём ${settings['absenceMinutes'] ?? 1} мин';
}

// Монеты партии (вопрос 17, SHAH_RULES.md §18): взнос за каждую партию, банк — выигравшим.
String shahMoneyLine(int capacity, int ante) =>
    'Взнос за каждую партию: каждый кладёт ${fmtCoins(ante)}, выигравшие делят банк ${fmtCoins(ante * capacity)}';

// Сколько партий за столом и что потом (вопрос 18).
String shahMatchesLine(int matches) =>
    'Партий: $matches (партия — до −24). Сыграете все — спросим всех: ещё 3 партии?';

void openShahLobby(BuildContext context, String roomId, {bool replace = false}) {
  final route = MaterialPageRoute(builder: (_) => ShahLobbyScreen(roomCode: roomId));
  if (replace) {
    Navigator.pushReplacement(context, route);
  } else {
    Navigator.push(context, route);
  }
}

// Смотреть идущий стол (как «НАБЛЮДАТЬ» в Гарбе, §18): без своей руки и без кнопок.
Future<void> watchShahRoom(BuildContext context, String roomId) async {
  try {
    final response = await apiRequest(http.get(Uri.parse('$apiBase/shah/rooms/$roomId'), headers: authHeaders()));
    if (response.statusCode == 404) throw Exception('За этим столом уже не играют.');
    expectStatus(response, const [200]);
    if (!context.mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ShahTableScreen(roomCode: roomId, spectator: true)),
    );
  } catch (e) {
    if (context.mounted) showGarbaError(context, e);
  }
}

// Сесть за стол ШАХ по номеру: показать условия (на кону монеты), спросить и сесть.
// info — состояние стола, если уже есть (GET /shah/rooms/:id). Уже сижу за ним — просто открыть.
Future<void> joinShahTable(BuildContext context, String roomId, {Map<String, dynamic>? info, bool replace = false}) async {
  try {
    var data = info;
    if (data == null) {
      final peek = await apiRequest(http.get(Uri.parse('$apiBase/shah/rooms/$roomId'), headers: authHeaders()));
      if (peek.statusCode != 200) throw ApiFailure.fromResponse(peek);
      data = jsonDecode(peek.body) as Map<String, dynamic>;
    }
    final seated = ((data['players'] as List?) ?? const []).any((p) => (p as Map)['id'].toString() == Session.id);
    if (!seated) {
      if (data['status'] == 'started') {
        if (context.mounted) await watchShahRoom(context, roomId);
        return;
      }
      if (data['status'] != 'lobby') throw ApiFailure(409, 'room finished', null);
      if (!context.mounted) return;
      final ok = await confirmShahTable(context, data);
      if (ok != true) return;
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/shah/rooms/$roomId/join'),
        headers: authHeaders(),
        body: jsonEncode({}),
      ));
      if (response.statusCode != 200) throw ApiFailure.fromResponse(response);
    }
    if (!context.mounted) return;
    openShahLobby(context, roomId, replace: replace);
  } catch (e) {
    if (context.mounted) showGarbaError(context, e, prefix: 'Не удалось сесть за стол');
  }
}

// Условия стола перед входом: формат, взнос за партию, сколько партий.
Future<bool?> confirmShahTable(BuildContext context, Map<String, dynamic> data) {
  final capacity = (data['capacity'] as num).toInt();
  final settings = (data['settings'] as Map?) ?? const {};
  final ante = (settings['ante'] as num?)?.toInt() ?? 0;
  final practice = data['practice'] == true;
  return showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Стол ШАХ #${data['id']}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(shahFormatLong(capacity), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(practice ? 'Тренировка с ботами — монеты не двигаются' : shahMoneyLine(capacity, ante)),
          const SizedBox(height: 8),
          Text(shahMatchesLine((settings['matches'] as num?)?.toInt() ?? 1)),
          const SizedBox(height: 8),
          Text(
            'Ход ${settings['turnSeconds'] ?? 20} с · ждём отошедшего ${settings['absenceMinutes'] ?? 1} мин. '
            'Выйти до конца — бан и проигрыш партии',
            style: const TextStyle(color: Colors.white70, fontSize: 13),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('СЕСТЬ')),
      ],
    ),
  );
}

// «Быстрая игра» ШАХ: сервер сажает в самую заполненную открытую комнату (того же формата,
// если выбран), нет такой — создаёт открытую (без формата — 2×2): самый маленький взнос, 1 партия.
bool _shahQuickBusy = false;

Future<void> shahQuickGame(BuildContext context) async {
  if (_shahQuickBusy) return;
  final capacity = await showModalBottomSheet<int>(
    context: context,
    backgroundColor: const Color(0xFF13232E),
    builder: (sheet) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Быстрая игра ШАХ',
                textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 4),
            const Text('Посадим за открытый стол, нет такого — создадим: 1 партия до −24, '
                'взнос 1 000 (1×1, 1×1×1) или 10 000 (команды)',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, fontSize: 12)),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => Navigator.pop(sheet, 0), child: const Text('ЛЮБОЙ СТОЛ')),
            const SizedBox(height: 8),
            Row(
              children: [
                for (final n in [2, 3, 4, 6]) ...[
                  if (n != 2) const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(sheet, n),
                      child: FittedBox(child: Text(shahFormatName(n))),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    ),
  );
  if (capacity == null || !context.mounted) return;
  _shahQuickBusy = true;
  try {
    final response = await apiRequest(http.post(
      Uri.parse('$apiBase/shah/rooms/quick'),
      headers: authHeaders(),
      body: jsonEncode({if (capacity > 0) 'capacity': capacity}),
    ));
    if (response.statusCode != 200 && response.statusCode != 201) throw ApiFailure.fromResponse(response);
    final room = jsonDecode(response.body) as Map<String, dynamic>;
    if (!context.mounted) return;
    openShahLobby(context, room['id'].toString());
  } catch (e) {
    if (context.mounted) showGarbaError(context, e);
  } finally {
    _shahQuickBusy = false;
  }
}

// Раздел ШАХ: вернуться за свой стол, быстрая игра, создать, войти по коду, открытые столы, правила.
class ShahHomeScreen extends StatefulWidget {
  const ShahHomeScreen({super.key});

  @override
  State<ShahHomeScreen> createState() => _ShahHomeScreenState();
}

class _ShahHomeScreenState extends State<ShahHomeScreen> with RouteAware {
  String? shahRoomId;
  String? garbaRoomId;
  int? balance;
  double? shahRating; // рейтинг ШАХ (§19) — свой, не рейтинг Гарбы

  @override
  void initState() {
    super.initState();
    refresh();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    super.dispose();
  }

  @override
  void didPopNext() => refresh();

  Future<void> refresh() async {
    try {
      final response = await apiRequest(http.get(Uri.parse('$apiBase/me'), headers: authHeaders()));
      if (response.statusCode != 200) return;
      final me = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        shahRoomId = me['shahRoomId']?.toString();
        garbaRoomId = me['roomId']?.toString();
        balance = (me['balance'] as num?)?.toInt();
        shahRating = (me['shahRating'] as num?)?.toDouble();
      });
    } catch (_) {}
  }

  void go(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  Widget tileRow(Widget left, Widget right) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(children: [Expanded(child: left), const SizedBox(width: 12), Expanded(child: right)]),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          children: [
            const Row(
              children: [
                ShahMiniCard(card: {'id': 'clubs-6', 'suit': 'clubs', 'rank': '6'}, width: 40),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('ШАХ',
                          style: TextStyle(
                              fontSize: 30, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F), letterSpacing: 3)),
                      Text('6♣ на отбое бьёт всё · штрафы до −24',
                          style: TextStyle(color: Colors.white70, fontSize: 13)),
                    ],
                  ),
                ),
              ],
            ),
            if (balance != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    const CoinIcon(size: 18),
                    const SizedBox(width: 4),
                    Text('${fmtCoins(balance!)} монет', style: const TextStyle(fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            // Рейтинг ШАХ (§19) — свой, отдельно от Гарбы.
            if (shahRating != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    const Text('Рейтинг ШАХ ', style: TextStyle(color: Colors.white70)),
                    RatingText(shahRating, fontSize: 15),
                  ],
                ),
              ),
            const SizedBox(height: 16),
            if (shahRoomId != null) ...[
              GarbaButton(label: 'ВЕРНУТЬСЯ ЗА СТОЛ ШАХ #$shahRoomId', onTap: () => openShahLobby(context, shahRoomId!)),
              const SizedBox(height: 14),
            ] else if (garbaRoomId != null) ...[
              Text(
                'Вы сейчас в комнате ГАРБЫ #$garbaRoomId — играть можно только за одним столом.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.orangeAccent),
              ),
              const SizedBox(height: 14),
            ],
            tileRow(
              HomeTile(icon: Icons.bolt, label: 'БЫСТРАЯ ИГРА', onTap: () => shahQuickGame(context)),
              HomeTile(icon: Icons.public, label: 'ОТКРЫТЫЕ СТОЛЫ', onTap: () => go(const ShahOpenRoomsScreen())),
            ),
            tileRow(
              HomeTile(icon: Icons.add_circle_outline, label: 'СОЗДАТЬ СТОЛ', onTap: () => go(const ShahCreateScreen())),
              HomeTile(icon: Icons.pin_outlined, label: 'ВОЙТИ ПО КОДУ', onTap: () => go(const JoinRoomScreen())),
            ),
            tileRow(
              HomeTile(icon: Icons.emoji_events_outlined, label: 'РЕЙТИНГ ШАХ', onTap: () => go(const ShahRatingScreen())),
              HomeTile(icon: Icons.menu_book_outlined, label: 'ПРАВИЛА ШАХ', onTap: () => go(const ShahRulesScreen())),
            ),
            HomeTile(icon: Icons.smart_toy_outlined, label: 'ТРЕНИРОВКА С БОТАМИ', onTap: () => go(const ShahCreateScreen(practiceHint: true))),
          ],
        ),
      ),
    );
  }
}

// Создать стол ШАХ (SHAH_RULES.md §18): игроков 2/3/4/6, взнос 100…1000, время игры, ход 20/40 с,
// ожидание отошедшего 1…5 минут, открытый или по коду. Проверяет сервер (checkShahSettings).
class ShahCreateScreen extends StatefulWidget {
  const ShahCreateScreen({super.key, this.practiceHint = false});

  // Пришли с «ТРЕНИРОВКА С БОТАМИ» — подсказываем, что ботов сажают в лобби.
  final bool practiceHint;

  @override
  State<ShahCreateScreen> createState() => _ShahCreateScreenState();
}

class _ShahCreateScreenState extends State<ShahCreateScreen> {
  int capacity = 4;
  int ante = 10000;
  int matches = 3;
  int turnSeconds = 20;
  int absenceMinutes = 1;
  bool isPublic = false;
  bool loading = false;

  Future<void> askCustomMatches() async {
    final value = await showDialog<int>(
      context: context,
      builder: (_) => _ShahMatchesDialog(initial: shahMatchPresets.contains(matches) ? null : matches),
    );
    if (value != null && mounted) setState(() => matches = value);
  }

  // Сменился формат — взнос в его пределах (у команд и у 1×1 они разные).
  void setCapacity(int n) {
    final antes = shahAntes(n);
    setState(() {
      capacity = n;
      if (!antes.contains(ante)) ante = antes.first;
    });
  }

  Future<void> create() async {
    if (loading) return;
    setState(() => loading = true);
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/shah/rooms'),
        headers: authHeaders(),
        body: jsonEncode({
          'capacity': capacity,
          'ante': ante,
          'turnSeconds': turnSeconds,
          'absenceMinutes': absenceMinutes,
          'matches': matches,
          'isPublic': isPublic,
        }),
      ));
      if (response.statusCode != 201) throw ApiFailure.fromResponse(response);
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      openShahLobby(context, data['id'].toString(), replace: true);
    } catch (e) {
      if (mounted) showGarbaError(context, e, prefix: 'Не удалось создать стол');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Widget title(String text) => Padding(
        padding: const EdgeInsets.only(top: 22, bottom: 10),
        child: Text(text, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
      );

  Widget hint(String text) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(text, style: const TextStyle(color: Colors.white60)),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                children: [
                  const Text('Новый стол ШАХ', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                  if (widget.practiceHint)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: PracticeBanner(),
                    ),
                  if (widget.practiceHint)
                    hint('Создайте стол, а в лобби нажмите «БОТЫ · ТРЕНИРОВКА» — боты сядут на свободные места.'),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: isPublic,
                    onChanged: (v) => setState(() => isPublic = v),
                    title: const Text('Открытый стол', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    subtitle: Text(isPublic
                        ? 'Виден всем в «Открытых столах» — сесть может любой'
                        : 'Только по коду — для своих. Открыть можно и потом, в лобби'),
                  ),
                  title('Сколько игроков'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [2, 3, 4, 6].map((n) {
                      return ChoiceChip(
                        label: Text(shahFormatName(n)),
                        selected: capacity == n,
                        onSelected: (_) => setCapacity(n),
                      );
                    }).toList(),
                  ),
                  hint(capacity == 4 || capacity == 6
                      ? '${shahFormatLong(capacity)}. Напарники сидят через одного — садитесь так, чтобы быть вместе'
                      : shahFormatLong(capacity)),
                  title('Взнос за партию'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: shahAntes(capacity).map((n) {
                      return ChoiceChip(
                          label: Text(fmtCoins(n)), selected: ante == n, onSelected: (_) => setState(() => ante = n));
                    }).toList(),
                  ),
                  hint('${shahMoneyLine(capacity, ante)}. Проиграла сторона — взнос не возвращается'),
                  title('Сколько партий'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      ...shahMatchPresets.map((n) => ChoiceChip(
                            label: Text('$n'),
                            selected: matches == n,
                            onSelected: (_) => setState(() => matches = n),
                          )),
                      ChoiceChip(
                        label: Text(shahMatchPresets.contains(matches) ? 'СВОЁ' : '$matches'),
                        avatar: const Icon(Icons.edit, size: 16),
                        selected: !shahMatchPresets.contains(matches),
                        onSelected: (_) => askCustomMatches(),
                      ),
                    ],
                  ),
                  hint('Партия — до −24, взнос — за каждую. Сыграете $matches ${shahMatchesWord(matches)} — '
                      'спросим всех, добавить ли ещё 3 (только если согласны все). Выйти раньше — бан, '
                      'и партия засчитана проигранной вашей стороне'),
                  title('Время на ход'),
                  Wrap(
                    spacing: 8,
                    children: [20, 40].map((n) {
                      return ChoiceChip(
                          label: Text('$n секунд'), selected: turnSeconds == n, onSelected: (_) => setState(() => turnSeconds = n));
                    }).toList(),
                  ),
                  hint('Не успел — за игрока ходит игра: заходит самой слабой картой, бить не бьёт — '
                      'кладёт рубашкой самые дешёвые'),
                  title('Сколько ждать отошедшего'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [1, 2, 3, 4, 5].map((n) {
                      return ChoiceChip(
                          label: Text('$n мин'),
                          selected: absenceMinutes == n,
                          onSelected: (_) => setState(() => absenceMinutes = n));
                    }).toList(),
                  ),
                  hint('Игрок пропал — стол ждёт его $absenceMinutes мин за весь стол. '
                      'Не вернулся — его сторона проиграла партию'),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: GarbaButton(label: loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ СТОЛ', onTap: create),
            ),
          ],
        ),
      ),
    );
  }
}

// Открытые столы ШАХ — сесть; идущие — смотреть (§18).
class ShahOpenRoomsScreen extends StatefulWidget {
  const ShahOpenRoomsScreen({super.key});

  @override
  State<ShahOpenRoomsScreen> createState() => _ShahOpenRoomsScreenState();
}

class _ShahOpenRoomsScreenState extends State<ShahOpenRoomsScreen> {
  List<Map<String, dynamic>>? rooms;
  List<Map<String, dynamic>> live = const [];
  String? error;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    load();
    timer = Timer.periodic(const Duration(seconds: 5), (_) => load());
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final response = await apiRequest(http.get(Uri.parse('$apiBase/shah/rooms/open'), headers: authHeaders()));
      expectStatus(response, const [200]);
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      List<Map<String, dynamic>> list(Object? raw) =>
          ((raw as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!mounted) return;
      setState(() {
        rooms = list(data['rooms']);
        live = list(data['live']);
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Widget roomCard(Map<String, dynamic> r) {
    final capacity = (r['capacity'] as num).toInt();
    return Card(
      child: ListTile(
        title: Text('${shahFormatName(capacity)} · ${r['creatorName']}', style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text('${r['players']} из $capacity · ${shahSettingsLine(r['settings'] as Map)}'),
        trailing: FilledButton(
          onPressed: () => joinShahTable(context, r['id'].toString()),
          child: const Text('СЕСТЬ'),
        ),
      ),
    );
  }

  Widget liveCard(Map<String, dynamic> r) {
    final capacity = (r['capacity'] as num).toInt();
    final totals = ((r['totals'] as List?) ?? const []).map((e) => fmtPenalty(e as num)).join(' : ');
    return Card(
      child: ListTile(
        title: Text('${shahFormatName(capacity)} · ${((r['names'] as List?) ?? const []).join(', ')}',
            maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text([
          if (r['practice'] == true) 'тренировка',
          'партия ${r['matchNumber'] ?? 1} из ${r['matchLimit'] ?? 1}',
          'раздача ${r['partyNumber']}',
          if (totals.isNotEmpty) 'счёт $totals',
          '👁 ${r['spectators']}',
        ].join(' · ')),
        trailing: OutlinedButton(
          onPressed: () => watchShahRoom(context, r['id'].toString()),
          child: const Text('СМОТРЕТЬ'),
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
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: [
            const Text('Открытые столы ШАХ', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            const SizedBox(height: 4),
            const Text('Сесть может любой, без кода', style: TextStyle(color: Colors.white60)),
            const SizedBox(height: 10),
            if (error != null)
              Padding(padding: const EdgeInsets.all(12), child: Text(error!, textAlign: TextAlign.center))
            else if (list == null)
              const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
            else if (list.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Открытых столов сейчас нет — создайте свой или нажмите «Быструю игру»',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
              )
            else
              ...list.map(roomCard),
            if (live.isNotEmpty) ...[
              const SizedBox(height: 18),
              const Text('ИДУТ СЕЙЧАС',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, letterSpacing: 1.2, color: Color(0xFFE6B74F))),
              const SizedBox(height: 4),
              const Text('Смотреть чужой стол: видно только то, что на столе',
                  style: TextStyle(color: Colors.white60, fontSize: 12)),
              const SizedBox(height: 8),
              ...live.map(liveCard),
            ],
          ],
        ),
      ),
    );
  }
}

// Лобби стола ШАХ: места по кругу (в 2×2 и 3×3 — через одно одна команда), «ГОТОВ», боты,
// позвать друзей, открыть для всех. Стол начался — сразу за стол.
class ShahLobbyScreen extends StatefulWidget {
  final String roomCode;

  const ShahLobbyScreen({super.key, required this.roomCode});

  @override
  State<ShahLobbyScreen> createState() => _ShahLobbyScreenState();
}

class _ShahLobbyScreenState extends State<ShahLobbyScreen> {
  Timer? timer;
  Timer? ticker;
  late final RoomLink link;
  Map<String, dynamic>? room;
  DateTime receivedAt = DateTime.now();
  bool notFound = false;
  bool firstLoad = true;
  bool moved = false;
  bool busy = false;
  bool hadReadyCheck = false;
  final flyingEmoji = <String, String>{};
  int lastReactionId = 0;
  bool firstReactions = true;

  String get myId => Session.id;
  String get base => '$apiBase/shah/rooms/${widget.roomCode}';

  @override
  void initState() {
    super.initState();
    link = RoomLink(
      roomCode: widget.roomCode,
      onRoom: applyRoom,
      onError: (error) {
        if (error == 'room not found' && mounted) setState(() => notFound = true);
      },
      watchEvent: 'watch_shah',
      roomEvent: 'shah_room',
      errorEvent: 'shah_room_error',
    );
    refresh();
    timer = Timer.periodic(fallbackPollInterval, (_) {
      if (!link.connected) refresh();
    });
    ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    ticker?.cancel();
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
      }
    } catch (_) {
      if (mounted && firstLoad) setState(() => firstLoad = false);
    }
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

  void applyRoom(Map<String, dynamic> data) {
    if (!mounted || isStaleRoom(room, data)) return;
    applyReactions((data['reactions'] as List?) ?? const []);
    final hasReady = data['readyCheck'] is Map;
    final imIn = ((data['players'] as List?) ?? const []).any((p) => (p as Map)['id'].toString() == myId);
    setState(() {
      room = data;
      firstLoad = false;
      receivedAt = DateTime.now();
    });
    if (hasReady && !hadReadyCheck && imIn) {
      GarbaSounds.ready();
      HapticFeedback.heavyImpact();
    }
    hadReadyCheck = hasReady;
    // Стол начался (или уже закрыт — итоги на столе), и я за столом — за стол.
    final matchOn = data['status'] == 'started' || (data['status'] == 'finished' && data['game'] != null);
    if (matchOn && imIn && !moved) {
      moved = true;
      timer?.cancel();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => ShahTableScreen(roomCode: widget.roomCode)),
        );
      });
    }
  }

  Future<void> post(String path, [Map<String, dynamic> body = const {}, String? errorPrefix]) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final response = await apiRequest(http.post(Uri.parse('$base/$path'), headers: authHeaders(), body: jsonEncode(body)));
      if (response.statusCode < 200 || response.statusCode >= 300) throw ApiFailure.fromResponse(response);
      final decoded = jsonDecode(response.body);
      if (decoded is Map && decoded['kind'] == 'shah') applyRoom(Map<String, dynamic>.from(decoded));
    } catch (e) {
      if (mounted) showGarbaError(context, e, prefix: errorPrefix);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> leave() async {
    try {
      final response = await apiRequest(http.post(Uri.parse('$base/leave'), headers: authHeaders(), body: jsonEncode({})));
      if (response.statusCode < 200 || response.statusCode >= 300) throw ApiFailure.fromResponse(response);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) showGarbaError(context, e, prefix: 'Не удалось выйти');
    }
  }

  Widget seatTable(List<Map<String, dynamic>> players, int capacity, String creatorId, Set<String>? readyIds, int readyLeft) {
    final teams = room!['teams'] == true;
    final me = players.where((p) => p['id'].toString() == myId).firstOrNull;
    final mySeat = (me?['seat'] as num?)?.toInt() ?? 0;
    Map<String, dynamic>? atSeat(int seat) => players.where((p) => (p['seat'] as num?)?.toInt() == seat).firstOrNull;
    // Сторона места: в командах — через одно (места 0, 2, 4 — команда 1), иначе место = сторона.
    int sideOfSeat(int seat) => teams ? seat % 2 : seat;

    Widget seatView(int seat) {
      final p = atSeat(seat);
      final color = shahSideColor(sideOfSeat(seat));
      if (p == null) {
        return GestureDetector(
          onTap: me == null ? null : () => post('seat', {'seat': seat}, 'Не удалось пересесть'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0x55000000),
                  border: Border.all(color: teams ? color.withValues(alpha: 0.7) : Colors.white38, width: 2),
                ),
                child: Icon(Icons.event_seat, color: teams ? color : Colors.white54, size: 24),
              ),
              const SizedBox(height: 4),
              Text(teams ? 'Свободно · команда ${sideOfSeat(seat) + 1}' : 'Свободно',
                  style: const TextStyle(fontSize: 11, color: Colors.white70)),
            ],
          ),
        );
      }
      final id = p['id'].toString();
      final ready = readyIds?.contains(id);
      return GestureDetector(
        onTap: () => openPlayerCard(context, p),
        child: SizedBox(
          width: 96,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  framed(
                    Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: ready == null ? color : ready ? Colors.greenAccent : Colors.white38,
                          width: 2.5,
                        ),
                      ),
                      child: AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 21),
                    ),
                    diameter: 51,
                    frame: p['frame']?.toString(),
                  ),
                  if (flyingEmoji[id] case final emoji? when !isPhrase(emoji))
                    Positioned.fill(child: AvatarEmoji(key: ValueKey('${id}_${emoji}_$lastReactionId'), emoji: emoji)),
                  if (flyingEmoji[id] case final phrase? when isPhrase(phrase))
                    Positioned(
                      left: -70,
                      right: -70,
                      top: -26,
                      child: Center(child: PhraseBubble(key: ValueKey('${id}_${phrase}_$lastReactionId'), text: phrase)),
                    ),
                ],
              ),
              const SizedBox(height: 3),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xF0121A22),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: teams ? color : const Color(0xFFB6812D)),
                ),
                child: Column(
                  children: [
                    Text(p['name'].toString(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: ratingColor(p['rating']))),
                    Text(
                      ready == null
                          ? [if (id == creatorId) 'создатель', if (p['bot'] == true) 'бот', if (teams) 'команда ${sideOfSeat(seat) + 1}']
                              .join(' · ')
                          : ready
                              ? 'готов'
                              : 'ждём «ГОТОВ»',
                      style: TextStyle(fontSize: 10, color: ready == true ? Colors.greenAccent : color),
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
            const Positioned.fill(child: KazakhTable(title: 'ШАХ')),
            Align(
              alignment: const Alignment(0, -0.15),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${players.length} / $capacity', style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
                  Text(
                    readyIds == null ? (players.length < capacity ? 'ждём игроков' : '') : '«ГОТОВ» · $readyLeft',
                    style: const TextStyle(color: Color(0xFFD4A94F), fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
            Positioned(
              right: 10,
              bottom: 10,
              child: EmojiButton(onSend: (emoji) => post('react', {'emoji': emoji})),
            ),
            for (var seat = 0; seat < capacity; seat++)
              () {
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

  Widget closedScreen(String title, [String? text]) => Scaffold(
        appBar: backOnlyAppBar(),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              if (text != null) ...[
                const SizedBox(height: 12),
                Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
              ],
              const Spacer(),
              GarbaButton(label: 'НАЗАД', onTap: () => Navigator.pop(context)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final data = room;
    if (data == null) {
      return Scaffold(
        appBar: backOnlyAppBar(),
        body: Center(
          child: notFound
              ? const Text('Стол не найден — возможно, он уже закрыт')
              : firstLoad
                  ? const CircularProgressIndicator()
                  : const Text('Нет связи с сервером'),
        ),
      );
    }
    final players = ((data['players'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final capacity = (data['capacity'] as num).toInt();
    final creatorId = data['creatorId'].toString();
    final imIn = players.any((p) => p['id'].toString() == myId);
    final status = data['status'];

    if (status == 'finished' && data['game'] == null) {
      final reason = (data['result'] as Map?)?['reason'];
      return closedScreen(switch (reason) {
        'lobby_timeout' => 'Игра не началась за 10 минут — стол закрыт',
        'nobody_ready' => 'Никто не нажал «ГОТОВ» — стол закрыт',
        _ => 'Создатель закрыл стол',
      });
    }
    final dropped = ((data['readyDroppedIds'] as List?) ?? const []).any((id) => id.toString() == myId) && !imIn;
    if (dropped) {
      return closedScreen('Вы не нажали «ГОТОВ» за 30 секунд',
          'Вы вышли из-за стола — место ждёт другого игрока. Можно сесть снова, если оно ещё свободно.');
    }
    if (status != 'lobby' && !imIn) {
      return Scaffold(
        appBar: backOnlyAppBar(),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              const Text('Игра началась без вас',
                  textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              const Text('За этим столом уже играют — можно посмотреть.',
                  textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
              const Spacer(),
              if (status == 'started')
                GarbaButton(
                  label: 'СМОТРЕТЬ',
                  onTap: () => Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(builder: (_) => ShahTableScreen(roomCode: widget.roomCode, spectator: true)),
                  ),
                ),
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('НАЗАД')),
            ],
          ),
        ),
      );
    }

    final readyCheck = data['readyCheck'] is Map ? Map<String, dynamic>.from(data['readyCheck'] as Map) : null;
    final readyIds = ((readyCheck?['readyIds'] as List?) ?? const []).map((e) => e.toString()).toSet();
    final elapsed = DateTime.now().difference(receivedAt).inSeconds;
    final readyLeft = readyCheck == null ? 0 : math.max(0, (readyCheck['secondsLeft'] as num).toInt() - elapsed);
    final lobbyLeft =
        data['lobbySecondsLeft'] is num ? math.max(0, (data['lobbySecondsLeft'] as num).toInt() - elapsed) : null;
    final isCreator = creatorId == myId;
    final settings = (data['settings'] as Map?) ?? const {};
    final ante = (settings['ante'] as num?)?.toInt() ?? 0;

    return Scaffold(
      appBar: backOnlyAppBar(),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Expanded(
                  child: Text('ШАХ · стол ${widget.roomCode}',
                      style: const TextStyle(fontSize: 20, color: Color(0xFFD4A94F), fontWeight: FontWeight.w800)),
                ),
                if (lobbyLeft != null && readyCheck == null)
                  Text('закроется ${fmtClock(lobbyLeft)}',
                      style: TextStyle(fontSize: 12, color: lobbyLeft <= 60 ? Colors.redAccent : Colors.white60)),
              ],
            ),
            if (data['practice'] == true) const PracticeBanner(),
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${shahFormatLong(capacity)}\n'
                '${data['practice'] == true ? 'Тренировка — монеты не двигаются' : shahMoneyLine(capacity, ante)}\n'
                '${shahMatchesLine((settings['matches'] as num?)?.toInt() ?? 1)}\n'
                'Ход ${settings['turnSeconds'] ?? 20} с · ждём ${settings['absenceMinutes'] ?? 1} мин',
                style: const TextStyle(color: Colors.white60, fontSize: 13),
              ),
            ),
            if (data['teams'] == true)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text.rich(
                  TextSpan(children: [
                    const TextSpan(text: 'Напарники — через одного: '),
                    TextSpan(text: '● команда 1', style: TextStyle(color: shahSideColor(0), fontWeight: FontWeight.w800)),
                    const TextSpan(text: ', '),
                    TextSpan(text: '● команда 2', style: TextStyle(color: shahSideColor(1), fontWeight: FontWeight.w800)),
                    const TextSpan(text: '. Нажмите свободный стул — пересесть'),
                  ]),
                  style: const TextStyle(fontSize: 12, color: Colors.white70),
                ),
              ),
            if (levelsBanner(players) case final banner?) ...[
              const SizedBox(height: 6),
              banner,
            ],
            if (isCreator)
              SwitchListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: data['isPublic'] == true,
                onChanged: busy ? null : (v) => post('visibility', {'isPublic': v}),
                title: Text(data['isPublic'] == true ? 'Открытый: виден всем, без кода' : 'Закрытый: только по коду'),
              ),
            const SizedBox(height: 6),
            Expanded(
              child: seatTable(players, capacity, creatorId, readyCheck == null ? null : readyIds, readyLeft),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => shareInvite(
                      text: 'Играем в ШАХ! Садись за стол #${widget.roomCode}:',
                      link: roomLink(widget.roomCode),
                      extra: 'Если ссылка не открылась — введи код ${widget.roomCode} в приложении ГАРБА («Войти по коду»).',
                    ),
                    icon: const Icon(Icons.share, size: 18),
                    label: const Text('ССЫЛКА'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => showModalBottomSheet<void>(
                      context: context,
                      backgroundColor: const Color(0xFF13232E),
                      isScrollControlled: true,
                      builder: (_) => FriendInviteSheet(roomCode: widget.roomCode, shah: true),
                    ),
                    icon: const Icon(Icons.group_add, size: 18),
                    label: const Text('ДРУЗЬЯ'),
                  ),
                ),
              ],
            ),
            if (isCreator && readyCheck == null && players.length < capacity) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: busy ? null : () => post('bots', const {}, 'Не удалось добавить ботов'),
                icon: const Icon(Icons.smart_toy_outlined),
                label: Text('БОТЫ (${capacity - players.length}) · ТРЕНИРОВКА'),
              ),
            ],
            const SizedBox(height: 4),
            if (readyCheck != null)
              readyIds.contains(myId)
                  ? FilledButton.icon(
                      onPressed: null,
                      icon: const Icon(Icons.check_circle),
                      label: Text('ВЫ ГОТОВЫ · ждём остальных ${readyIds.length} / $capacity · $readyLeft'),
                    )
                  : FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: readyLeft <= 10 ? Colors.redAccent : Colors.green,
                        minimumSize: const Size.fromHeight(56),
                      ),
                      onPressed: busy ? null : () => post('ready', const {}, 'Не удалось отметиться'),
                      icon: const Icon(Icons.check),
                      label: Text('ГОТОВ · $readyLeft', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                    ),
            TextButton(onPressed: leave, child: Text(isCreator ? 'ЗАКРЫТЬ СТОЛ' : 'ВЫЙТИ ИЗ-ЗА СТОЛА')),
          ],
        ),
      ),
    );
  }
}

// В профиле и карточке игрока — рейтинг ШАХ и партии до −24 (/me/profile, /players/:code → shah).
class ShahProfileLine extends StatelessWidget {
  final Map<String, dynamic> shah;

  const ShahProfileLine({super.key, required this.shah});

  @override
  Widget build(BuildContext context) {
    final matches = (shah['matches'] as num?)?.toInt() ?? 0;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Рейтинг ШАХ: ',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F))),
              RatingText(shah['rating'], fontSize: 17),
            ],
          ),
          Text(
            matches == 0
                ? 'В ШАХ ещё не играл'
                : 'ШАХ: партий $matches · побед ${shah['wins']} · поражений ${shah['losses']}',
            style: const TextStyle(color: Colors.white70),
          ),
        ],
      ),
    );
  }
}

// Рейтинг ШАХ (SHAH_RULES.md §19): свой, отдельно от рейтинга Гарбы — друзья и все, кто сыграл партию.
class ShahRatingScreen extends StatelessWidget {
  const ShahRatingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      initialIndex: 1,
      child: Scaffold(
        appBar: backOnlyAppBar(
          bottom: const TabBar(tabs: [Tab(text: 'ДРУЗЬЯ'), Tab(text: 'ВСЕ')]),
        ),
        body: Column(
          children: [
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              decoration: BoxDecoration(
                color: const Color(0x22D4A94F),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFD4A94F), width: 1.2),
              ),
              child: const Column(
                children: [
                  Text('РЕЙТИНГ ШАХ',
                      style: TextStyle(color: Color(0xFFD4A94F), fontWeight: FontWeight.w900, letterSpacing: 1.2)),
                  SizedBox(height: 4),
                  Text(
                    'Свой, отдельно от Гарбы. Командная игра дороже: 1×1 < 1×1×1 < 2×2 < 3×3. '
                    'Меньше 10 минут за столом — не меняется, полностью — с часа игры.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                ],
              ),
            ),
            const Expanded(
              child: TabBarView(children: [ShahRatingList(scope: 'friends'), ShahRatingList(scope: 'all')]),
            ),
          ],
        ),
      ),
    );
  }
}

class ShahRatingList extends StatefulWidget {
  final String scope;

  const ShahRatingList({super.key, required this.scope});

  @override
  State<ShahRatingList> createState() => _ShahRatingListState();
}

class _ShahRatingListState extends State<ShahRatingList> {
  Map<String, dynamic>? board;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/shah/rating?scope=${widget.scope}'), headers: authHeaders());
      expectStatus(response, const [200]);
      if (!mounted) return;
      setState(() => board = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = board;
    if (b == null) return Center(child: error == null ? const CircularProgressIndicator() : Text(error!));
    final players = (b['players'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final myPlace = b['myPlace'];
    final total = b['total'];
    final header = widget.scope == 'friends'
        ? 'Ваше место среди друзей: $myPlace из $total'
        : myPlace == null
            ? 'Сыграйте партию ШАХ (не тренировку) — и попадёте в рейтинг'
            : 'Ваше место: $myPlace из $total';

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Text(header, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Ваш рейтинг ШАХ · партий ${b['myMatches'] ?? 0}   ', style: const TextStyle(color: Colors.white70)),
                  RatingText(b['myRating'], fontSize: 16),
                ],
              ),
            ],
          ),
        ),
        if (widget.scope == 'friends' && total == 1)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text('Добавьте друзей по коду — и увидите, кто из вас сильнее в ШАХ.',
                style: TextStyle(color: Colors.white54)),
          ),
        Expanded(
          child: ListView(
            children: players.map((p) {
              final isMe = p['me'] == true;
              final matches = (p['matches'] as num?)?.toInt() ?? 0;
              return ListTile(
                tileColor: isMe ? const Color(0x33D4A94F) : null,
                leading: SizedBox(
                  width: 76,
                  child: Row(
                    children: [
                      SizedBox(
                        width: 28,
                        child: Text(
                          '${p['place']}',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            color: widget.scope != 'friends' && (p['place'] as num) <= 10
                                ? topColor((p['place'] as num).toInt())
                                : null,
                          ),
                        ),
                      ),
                      AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), frame: p['frame']?.toString()),
                    ],
                  ),
                ),
                title: Text(isMe ? '${p['name']} (вы)' : p['name'].toString()),
                subtitle: Text(matches == 0 ? 'ещё не играл в ШАХ' : 'партий $matches · побед ${p['wins']}',
                    style: const TextStyle(color: Colors.white60)),
                trailing: RatingText(p['rating'], fontSize: 18),
                onTap: isMe
                    ? null
                    : () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => PlayerScreen(code: p['code'].toString())),
                        ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}

// Правила ШАХ для игроков — по SHAH_RULES.md (как сейчас работает сервер).
class ShahRulesScreen extends StatelessWidget {
  const ShahRulesScreen({super.key});

  static const _sections = <(String, String)>[
    (
      'Кто играет',
      '2 или 3 игрока — каждый сам за себя. 4 — две команды по двое, 6 — две команды по трое. '
          'Напарники сидят через одного и могут перебивать друг друга; всё, что взяли напарники, '
          'считается вместе. Очередь — против часовой стрелки.',
    ),
    (
      'Колода',
      '36 карт. Старшинство: Т > 10 > К > Д > В > 9 > 8 > 7 > 6 — десятка старше короля, но слабее туза.',
    ),
    (
      'Раздача и козырь',
      'Каждому по 6 карт. Первого сдающего находят как в Гарбе — карты открываются по кругу, кому '
          'выпал туз, тот сдаёт.\n\n'
          'При 2, 3 и 4 после раздачи открывается верхняя карта колоды — её масть козырь. После каждой '
          'взятки все добирают из колоды, и последний добравший показывает последнюю взятую карту: её '
          'масть — новый козырь. Колода кончилась — козырь последний.\n\n'
          'При 6 раздаётся вся колода, добора нет. Карта, открытая до раздачи, — козырь до конца раздачи, '
          'и достаётся она сдающему.',
    ),
    (
      'Заход',
      'Первым ходит сосед справа от сдающего, дальше — кто взял прошлую взятку. Заходить можно одной '
          'любой картой, несколькими одной масти или несколькими одного достоинства. Сколько карт в '
          'заходе — столько каждый кладёт в каждом круге этой взятки.',
    ),
    (
      'Как бьётся карта',
      'Каждую карту захода накрывают своей картой: старшей той же масти или любым козырем; козырь — '
          'только старшим козырем. Побить можно только все карты сразу. Бить всегда бьют верхнюю '
          'комбинацию — ту, которой отбились последней. Бить не обязательно, даже если есть чем.',
    ),
    (
      'Не бить',
      'Не бьёшь — кладёшь столько же любых своих карт рубашкой вверх. Что в них — не видит никто. '
          'Ты выбыл из борьбы до конца взятки, но в новых кругах снова кладёшь столько же рубашкой.',
    ),
    (
      'Кто берёт взятку',
      'Очередь вернулась к тому, чья комбинация сверху, и её никто не перебил, — взятка его: все '
          'карты стола, и рубашки тоже. Бороться больше некому — взятка его сразу. Он заходит следующим.',
    ),
    (
      'ШАХ — шестёрка крестей',
      'На отбое 6♣ бьёт любую карту — любой масти, даже козырного туза, и её уже ничем не перебить. '
          'Кто ещё не ответил в этом круге, кладёт рубашкой, а взятка — сыгравшего ШАХ. В заходе 6♣ — '
          'обычная шестёрка.',
    ),
    (
      'Очки',
      'Т — 11, 10 — 10, К — 4, Д — 3, В — 2, остальные — 0. Вся колода — 120 очков. Очки считаются '
          'в конце раздачи, по ходу их не видно.',
    ),
    (
      'Штрафы — 2, 4 и 6 игроков',
      'Штраф получает проигравшая сторона: 0 очков — −12, 1–40 — −4, 41–59 — −2. 60:60 — ничья, '
          'штрафов нет, а в следующей раздаче штрафы ×2.',
    ),
    (
      'Штрафы — 3 игрока',
      'Каждому по его очкам: 0 — −12, 1–20 — −4, 21–40 — −2, 41 и больше — без штрафа. 40:40:40 — '
          'ничья, следующая раздача ×2.',
    ),
    (
      'Партия',
      'Партия — несколько раздач, штрафы копятся. Кто первым дошёл до −24 или ниже — проиграл партию. '
          'Взнос — за каждую партию: в начале партии каждый кладёт взнос, выигравшие делят банк '
          '(команда — поровну, при 1×1×1 двое выигравших — пополам). Взнос: 1×1 и 1×1×1 — от 1 000 до 10 000, '
          '2×2 и 3×3 — от 10 000 до 20 000.',
    ),
    (
      'Стол',
      'За столом играют несколько партий подряд тем же составом — сколько выбрал создатель, от 1 до 30. '
          'Сыграли все — всех спрашивают: ещё 3 партии? Играем, только если согласны все; одно «нет» или '
          '30 секунд без ответа — стол закрывается, итоги.\n\n'
          'Ушёл из-за стола или не вернулся — его сторона проиграла партию, даже если выигрывала по штрафам: '
          'банк — другой стороне. Ушёл между партиями — следующая партия засчитана проигранной его стороне. '
          'Кто вышел сам — бан на вход за стол, как в Гарбе.',
    ),
    (
      'Рейтинг ШАХ',
      'Свой, отдельно от Гарбы, начинается с 4.0. За раздачу: без штрафа +0.03, −2 — −0.01, −4 — −0.02, '
          '−12 — −0.04, ничья — 0. За партию: победа +0.10, поражение −0.06, вся команда — одинаково.\n\n'
          'Командная игра дороже: 1×1 ×0.8, 1×1×1 ×1.0, 2×2 ×1.2, 3×3 ×1.4. Обыграл сильнее себя — получаешь '
          'больше, проиграл слабым — теряешь больше (как в Гарбе).\n\n'
          'За столом рейтинг не меняется — всё считается, когда стол закрылся, по времени игры: меньше 10 минут — '
          'не меняется, 10 минут ×0.3, 20 ×0.5, 30 ×0.7, 45 ×0.85, с часа — полностью. За один стол рейтинг '
          'падает не больше чем на 0.25. Тренировка с ботами рейтинг не меняет.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        children: [
          const Text('Правила ШАХ', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900)),
          const SizedBox(height: 14),
          for (final s in _sections)
            Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.$1,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F))),
                  const SizedBox(height: 6),
                  Text(s.$2, style: const TextStyle(fontSize: 16, height: 1.35)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

// Окно «Своё число партий»: 1…30 (вопрос 18). Как «своё время» у Гарбы.
class _ShahMatchesDialog extends StatefulWidget {
  final int? initial;

  const _ShahMatchesDialog({required this.initial});

  @override
  State<_ShahMatchesDialog> createState() => _ShahMatchesDialogState();
}

class _ShahMatchesDialogState extends State<_ShahMatchesDialog> {
  late final controller = TextEditingController(text: widget.initial?.toString() ?? '');
  String? error;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  void submit() {
    final v = int.tryParse(controller.text.trim());
    if (v == null || v < 1) {
      setState(() => error = 'Впишите число партий');
    } else if (v > shahMatchesMax) {
      setState(() => error = 'Не больше $shahMatchesMax партий');
    } else {
      Navigator.pop(context, v);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Сколько партий'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onSubmitted: (_) => submit(),
            decoration: InputDecoration(
              hintText: 'например, 7',
              suffixText: 'партий',
              errorText: error,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          const Text('От 1 до $shahMatchesMax. Партия — до −24.', style: TextStyle(fontSize: 13, color: Colors.white60)),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: submit, child: const Text('ГОТОВО')),
      ],
    );
  }
}
