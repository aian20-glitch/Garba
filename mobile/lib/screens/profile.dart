// Профиль, друзья, карточка игрока, аватар.
part of '../main.dart';

// Статистика игрока (ТЗ §2): считает сервер, экран только показывает.
class StatsView extends StatelessWidget {
  final Map<String, dynamic> stats;

  const StatsView({super.key, required this.stats});

  int v(String key) => (stats[key] as num?)?.toInt() ?? 0;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      if (stats.containsKey('rooms')) ('Сыграно комнат', '${v('rooms')}'),
      ('Сыграно партий', '${v('deals')}'),
      ('Был главным', '${v('mains')}'),
      ('Победы', '${v('wins')}'),
      ('Поражения', '${v('losses')}'),
      ('Играл РАЗ', '${v('raz')}'),
      ('Играл ДВА', '${v('dva')}'),
      ('Играл КОН', '${v('kon')}'),
      ('ГАРБА', '${v('garba')}'),
      ('Выиграно монет', fmtCoins(v('coinsWon'))),
      ('Проиграно монет', fmtCoins(v('coinsLost'))),
      ('Максимальный выигрыш', fmtCoins(v('maxWin'))),
      (
        'Максимальный выигранный риск',
        v('maxRisk') == 0 ? '—' : '×${v('maxRisk')}'
      ),
    ];
    return Column(
      children: rows
          .map((r) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    Expanded(
                        child: Text(r.$1,
                            style: const TextStyle(color: Colors.white70))),
                    Text(r.$2,
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                  ],
                ),
              ))
          .toList(),
    );
  }
}

// Достижения — медали за монеты (решение владельца, 23.10.2026, RULES.md §16.9): за каждый
// миллион, до которого дошёл весь баланс. Полученная — золотая и не пропадает, следующая —
// серая, закрытая. Какие получены — решает сервер.
class CoinMedalsView extends StatelessWidget {
  final List medals;
  // Победы в еженедельном турнире (§19.12): один значок 🏆, на нём — сколько раз.
  final int tournamentWins;

  const CoinMedalsView({super.key, required this.medals, this.tournamentWins = 0});

  @override
  Widget build(BuildContext context) {
    final list = medals.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'ДОСТИЖЕНИЯ',
          style: TextStyle(fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            if (tournamentWins > 0) _TournamentBadge(wins: tournamentWins),
            ...list.map((m) => _CoinMedal(coins: (m['coins'] as num).toInt(), earned: m['earned'] == true)),
          ],
        ),
      ],
    );
  }
}

// Значок победителя турнира: 🏆, со второй победы — число на нём (🏆×2, 🏆×3…).
class _TournamentBadge extends StatelessWidget {
  final int wins;

  const _TournamentBadge({required this.wins});

  @override
  Widget build(BuildContext context) {
    const gold = Color(0xFFD4A94F);
    return Semantics(
      label: 'Победитель турнира: $wins',
      child: SizedBox(
        width: 72,
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 58,
                  height: 58,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const RadialGradient(colors: [Color(0xFFFFE6A0), gold, Color(0xFF8A6A22)]),
                    border: Border.all(color: const Color(0xFFFFE6A0), width: 2),
                    boxShadow: const [BoxShadow(color: Color(0x88D4A94F), blurRadius: 10)],
                  ),
                  child: const Text('🏆', style: TextStyle(fontSize: 28)),
                ),
                if (wins > 1)
                  Positioned(
                    right: -4,
                    bottom: -2,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: const Color(0xFF3B2A00),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: gold),
                      ),
                      child: Text('×$wins', style: const TextStyle(fontWeight: FontWeight.w900, color: gold, fontSize: 13)),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            const Text('Турнир', style: TextStyle(fontSize: 12, color: gold, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

class _CoinMedal extends StatelessWidget {
  final int coins;
  final bool earned;

  const _CoinMedal({required this.coins, required this.earned});

  @override
  Widget build(BuildContext context) {
    const gold = Color(0xFFD4A94F);
    final millions = coins ~/ 1000000;
    return Semantics(
      label: earned ? 'Медаль $millions млн — получена' : 'Медаль $millions млн — ещё закрыта',
      child: SizedBox(
        width: 72,
        child: Column(
          children: [
            Container(
              width: 58,
              height: 58,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: earned
                    ? const RadialGradient(colors: [Color(0xFFFFE6A0), gold, Color(0xFF8A6A22)])
                    : null,
                color: earned ? null : Colors.white10,
                border: Border.all(color: earned ? const Color(0xFFFFE6A0) : Colors.white24, width: 2),
                boxShadow: earned ? const [BoxShadow(color: Color(0x88D4A94F), blurRadius: 10)] : null,
              ),
              child: earned
                  ? Text(
                      '${millions}M',
                      style: const TextStyle(color: Color(0xFF3B2A00), fontSize: 18, fontWeight: FontWeight.w900),
                    )
                  : const Icon(Icons.lock_outline, color: Colors.white38),
            ),
            const SizedBox(height: 4),
            Text(
              '$millions млн',
              style: TextStyle(fontSize: 12, color: earned ? gold : Colors.white38, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

// Свой профиль (ТЗ §2). Аватара пока нет, рейтинг — после утверждения формулы (§37).
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? profile;
  String? error;
  bool issuingRecoveryCode = false;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await apiRequest(
          http.get(Uri.parse('$apiBase/me/profile'), headers: authHeaders()));
      expectStatus(response, const [200]);
      if (!mounted) return;
      setState(
          () => profile = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> issueRecoveryCode() async {
    final p = profile;
    if (p == null || issuingRecoveryCode) return;
    if (p['hasRecoveryCode'] == true) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Создать новый код?'),
          content: const Text(
              'Старый код восстановления сразу перестанет работать.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('ОТМЕНА')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('СОЗДАТЬ')),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() => issuingRecoveryCode = true);
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/me/recovery-code'),
        headers: authHeaders(),
        body: '{}',
      ));
      expectStatus(response, const [200]);
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => p['hasRecoveryCode'] = true);
      await showRecoveryCode(
        context,
        playerCode: p['code'].toString(),
        recoveryCode: body['recoveryCode'].toString(),
      );
    } catch (e) {
      if (mounted) showGarbaError(context, e, prefix: 'Не удалось создать код');
    } finally {
      if (mounted) setState(() => issuingRecoveryCode = false);
    }
  }

  // Удалить аккаунт навсегда (требование Apple и Google). Сначала переспрашиваем.
  Future<void> deleteAccount() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Удалить аккаунт?'),
        content: const Text(
          'Аккаунт удалится навсегда: монеты, рейтинг, друзья и статистика. '
          'Восстановить его будет нельзя.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('ОТМЕНА')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('УДАЛИТЬ'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final response = await apiRequest(
          http.delete(Uri.parse('$apiBase/me'), headers: authHeaders()));
      if (!mounted) return;
      if (response.statusCode == 409) {
        final roomId = (jsonDecode(response.body) as Map)['roomId'];
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Сначала доиграйте игру в комнате #$roomId')),
        );
        return;
      }
      expectStatus(response, const [200]);
      await Session.clear();
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const StartScreen()),
        (_) => false,
      );
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось удалить аккаунт');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = profile;
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: p == null
          ? Center(
              child: error == null
                  ? const CircularProgressIndicator()
                  : Text(error!))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                // Фото выключены (26.09.2026) — вместо аватара первая буква имени.
                // Выбор фото из галереи — в истории git (коммит до «Убрать выбор фото»).
                Center(
                  child: AvatarView(
                      avatar: null, name: p['name'].toString(), radius: 56, frame: p['frame']?.toString()),
                ),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(
                      fontSize: 28, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text('Код игрока: ${p['code']}',
                    style: const TextStyle(color: Colors.white70)),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'Баланс: ',
                      style:
                          TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                    const CoinIcon(size: 21),
                    const SizedBox(width: 4),
                    // Всего: вне стола + на столе (09.10.2026).
                    Text(
                      fmtCoins((p['balance'] as num).toInt() +
                          ((p['tableBalance'] as num?)?.toInt() ?? 0)),
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                if (p['tableBalance'] is num)
                  Text(
                    'На столе ${fmtCoins((p['tableBalance'] as num).toInt())} · '
                    'вне стола ${fmtCoins((p['balance'] as num).toInt())}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white70),
                  ),
                Text('Друзей: ${p['friendsCount']}',
                    style: const TextStyle(color: Colors.white70)),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('Рейтинг: ',
                        style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFD4A94F))),
                    RatingText(p['rating'], fontSize: 20),
                  ],
                ),
                // Игра ШАХ (этап 4): свой рейтинг и партии — только когда ШАХ включён на сервере.
                if (p['shah'] is Map) ShahProfileLine(shah: Map<String, dynamic>.from(p['shah'] as Map)),
                const Divider(height: 32),
                if (p['medals'] is List) ...[
                  CoinMedalsView(medals: p['medals'] as List, tournamentWins: (p['tournamentWins'] as num?)?.toInt() ?? 0),
                  const Divider(height: 32),
                ],
                StatsView(stats: Map<String, dynamic>.from(p['stats'] as Map)),
                const Divider(height: 40),
                const Text(
                  'ВОССТАНОВЛЕНИЕ АККАУНТА',
                  style: TextStyle(
                      fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                const SizedBox(height: 8),
                Text(
                  p['hasRecoveryCode'] == true
                      ? 'Код настроен. Создайте новый, если потеряли сохранённую копию.'
                      : 'Создайте секретный код, чтобы вернуть этот аккаунт на другом телефоне.',
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: issuingRecoveryCode ? null : issueRecoveryCode,
                  icon: const Icon(Icons.key),
                  label: Text(
                    issuingRecoveryCode
                        ? 'СОЗДАЁМ...'
                        : p['hasRecoveryCode'] == true
                            ? 'СОЗДАТЬ НОВЫЙ КОД'
                            : 'СОЗДАТЬ КОД ВОССТАНОВЛЕНИЯ',
                  ),
                ),
                const SizedBox(height: 24),
                TextButton.icon(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const BlockedScreen()),
                  ),
                  icon: const Icon(Icons.block),
                  label: const Text('Заблокированные игроки'),
                ),
                TextButton.icon(
                  onPressed: deleteAccount,
                  style:
                      TextButton.styleFrom(foregroundColor: Colors.redAccent),
                  icon: const Icon(Icons.delete_forever),
                  label: const Text('Удалить аккаунт'),
                ),
                TextButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const PrivacyScreen()),
                  ),
                  child: const Text('Политика конфиденциальности',
                      style: TextStyle(color: Colors.white54)),
                ),
              ],
            ),
    );
  }
}

// Кого я заблокировал (29.09.2026): нажать — карточка, там «РАЗБЛОКИРОВАТЬ».
class BlockedScreen extends StatefulWidget {
  const BlockedScreen({super.key});

  @override
  State<BlockedScreen> createState() => _BlockedScreenState();
}

class _BlockedScreenState extends State<BlockedScreen> {
  List<Map<String, dynamic>>? players;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await apiRequest(
          http.get(Uri.parse('$apiBase/me/blocks'), headers: authHeaders()));
      expectStatus(response, const [200]);
      final list = (jsonDecode(response.body) as Map)['players'] as List;
      if (mounted) {
        setState(() => players = list.map((p) => Map<String, dynamic>.from(p as Map)).toList());
      }
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = players;
    return Scaffold(
      appBar: AppBar(title: const Text('Заблокированные')),
      body: list == null
          ? Center(child: error == null ? const CircularProgressIndicator() : Text(error!))
          : list.isEmpty
              ? const Center(
                  child: Text('Вы никого не блокировали',
                      style: TextStyle(color: Colors.white70)))
              : ListView(
                  children: [
                    for (final p in list)
                      ListTile(
                        leading: AvatarView(avatar: null, name: p['name'].toString(), radius: 20),
                        title: Text(p['name'].toString()),
                        subtitle: Text('Код: ${p['code']}'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () async {
                          await Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => PlayerScreen(code: p['code'].toString())),
                          );
                          load();
                        },
                      ),
                  ],
                ),
    );
  }
}

// Друзья (ТЗ §2): список, добавить по коду, открыть карточку друга.
class FriendsScreen extends StatefulWidget {
  const FriendsScreen({super.key});

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen> {
  final codeController = TextEditingController();
  List<Map<String, dynamic>>? friends;
  String? error;
  bool adding = false;

  static const _errors = <String, String>{
    'player not found': 'Игрока с таким кодом нет',
    'self': 'Это ваш собственный код',
    'already friends': 'Уже в друзьях',
    'request already sent': 'Заявка уже отправлена — ждём ответа',
  };
  // Кто зовёт меня в друзья — сверху, с кнопками «принять» / «отклонить».
  List<Map<String, dynamic>> incoming = [];
  String? notice;

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    codeController.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final response =
          await http.get(Uri.parse('$apiBase/friends'), headers: authHeaders());
      expectStatus(response, const [200]);
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final requests = await http.get(Uri.parse('$apiBase/friends/requests'),
          headers: authHeaders());
      final reqBody = requests.statusCode == 200
          ? jsonDecode(requests.body) as Map
          : const {};
      if (!mounted) return;
      setState(() {
        friends = (body['friends'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        incoming = ((reqBody['incoming'] as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> addFriend() async {
    final code = codeController.text.trim();
    if (code.isEmpty || adding) return;
    setState(() {
      adding = true;
      error = null;
    });
    try {
      final response = await http.post(
        Uri.parse('$apiBase/friends'),
        headers: authHeaders(),
        body: jsonEncode({'code': code}),
      );
      if (response.statusCode != 201 && response.statusCode != 202) {
        final failure = ApiFailure.fromResponse(response);
        if (mounted) {
          setState(() => error = _errors[failure.code] ?? userErrorMessage(failure));
        }
        return;
      }
      final body = jsonDecode(response.body) as Map;
      codeController.clear();
      if (mounted) {
        setState(() => notice = body['status'] == 'friends'
            ? '${body['name']} теперь в друзьях'
            : 'Заявка отправлена — ${body['name']} решит, добавить ли вас');
      }
      await load();
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    } finally {
      if (mounted) setState(() => adding = false);
    }
  }

  Future<void> answer(String code, String action) async {
    try {
      await http.post(
        Uri.parse(
            '$apiBase/friends/requests/${Uri.encodeComponent(code)}/$action'),
        headers: authHeaders(),
      );
    } catch (_) {}
    await load();
  }

  @override
  Widget build(BuildContext context) {
    final list = friends;
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: codeController,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(
                  labelText: 'Код игрока',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.person_add),
                    onPressed: addFriend,
                  ),
                ),
                onSubmitted: (_) => addFriend(),
              ),
              const SizedBox(height: 6),
              const Text(
                'По коду отправляется заявка — друг примет её или отклонит. '
                'Добавить можно и за столом: нажмите на игрока.',
                style: TextStyle(color: Colors.white54),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(error!,
                      style: const TextStyle(color: Colors.redAccent)),
                ),
              if (notice != null && error == null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(notice!,
                      style: const TextStyle(color: Colors.greenAccent)),
                ),
              // Заявки в друзья: принять или отклонить. Отклонённому не сообщаем.
              if (incoming.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text(
                  'ЗАЯВКИ В ДРУЗЬЯ',
                  style: TextStyle(
                      fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                ...incoming.map(
                  (r) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: AvatarView(
                        avatar: r['avatar']?.toString(),
                        name: r['name'].toString()),
                    title: Text(r['name'].toString()),
                    subtitle: Text(
                        '⭐ ${fmtRating(r['rating'])} · зовёт вас в друзья'),
                    onTap: () async {
                      await Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) =>
                                PlayerScreen(code: r['code'].toString())),
                      );
                      load();
                    },
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          tooltip: 'Принять',
                          icon: const Icon(Icons.check_circle,
                              color: Colors.greenAccent),
                          onPressed: () =>
                              answer(r['code'].toString(), 'accept'),
                        ),
                        IconButton(
                          tooltip: 'Отклонить',
                          icon: const Icon(Icons.cancel, color: Colors.white38),
                          onPressed: () =>
                              answer(r['code'].toString(), 'decline'),
                        ),
                      ],
                    ),
                  ),
                ),
                const Divider(),
              ],
              const SizedBox(height: 12),
              Expanded(
                child: list == null
                    ? const Center(child: CircularProgressIndicator())
                    : list.isEmpty
                        ? const Center(
                            child: Text(
                              'Друзей пока нет.\nПопросите у друга его код — он есть в профиле.',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.white70),
                            ),
                          )
                        : ListView(
                            children: list.map((f) {
                              final stats =
                                  Map<String, dynamic>.from(f['stats'] as Map);
                              final roomId = f['roomId']?.toString();
                              return ListTile(
                                leading: AvatarView(
                                    avatar: f['avatar']?.toString(),
                                    name: f['name'].toString(),
                                    frame: f['frame']?.toString()),
                                title: Text(f['name'].toString()),
                                subtitle: Text(
                                  '⭐ ${fmtRating(f['rating'])} · код ${f['code']} · партий ${stats['deals']} · побед ${stats['wins']}'
                                  '${roomId != null ? ' · сейчас в комнате #$roomId' : ''}',
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () async {
                                  await Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => PlayerScreen(
                                          code: f['code'].toString()),
                                    ),
                                  );
                                  load();
                                },
                              );
                            }).toList(),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Карточка другого игрока: статистика, дружба, подарок.
class PlayerScreen extends StatefulWidget {
  final String code;

  const PlayerScreen({super.key, required this.code});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  Map<String, dynamic>? player;
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(
        Uri.parse('$apiBase/players/${Uri.encodeComponent(widget.code)}'),
        headers: authHeaders(),
      );
      expectStatus(response, const [200]);
      if (!mounted) return;
      setState(
          () => player = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  // Дружба — только с согласия второго (решение владельца, 19.09.2026):
  // none → заявка; outgoing → отменить; incoming → принять / отклонить; friends → удалить.
  Future<void> friendAction(String action) async {
    if (busy) return;
    setState(() => busy = true);
    final code = Uri.encodeComponent(widget.code);
    try {
      final http.Response response;
      switch (action) {
        case 'request':
          response = await http.post(
            Uri.parse('$apiBase/friends'),
            headers: authHeaders(),
            body: jsonEncode({'code': widget.code}),
          );
        case 'remove':
          response = await http.delete(Uri.parse('$apiBase/friends/${Uri.encodeComponent(code)}'),
              headers: authHeaders());
        default: // accept | decline | cancel
          response = await http.post(
            Uri.parse('$apiBase/friends/requests/${Uri.encodeComponent(code)}/$action'),
            headers: authHeaders(),
          );
      }
      if (response.statusCode >= 300) throw ApiFailure.fromResponse(response);
      if (action == 'request' && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(
                  'Заявка отправлена — ${player?['name']} решит, добавить ли вас')),
        );
      }
      await load();
    } catch (e) {
      if (mounted) {
        showGarbaError(context, e);
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  // Пожаловаться (Apple 1.2, 29.09.2026): причина — имя, поведение или другое.
  // Жалобу разбирает владелец в течение суток; сам игрок о ней не узнаёт.
  Future<void> report() async {
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('На что жалуетесь?',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            ),
            for (final (code, label) in const [
              ('name', 'Оскорбительное имя'),
              ('behavior', 'Поведение за столом'),
              ('other', 'Другое'),
            ])
              ListTile(
                leading: const Icon(Icons.flag_outlined),
                title: Text(label),
                onTap: () => Navigator.pop(ctx, code),
              ),
          ],
        ),
      ),
    );
    if (reason == null || !mounted) return;
    setState(() => busy = true);
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/players/${Uri.encodeComponent(widget.code)}/report'),
        headers: authHeaders(),
        body: jsonEncode({'reason': reason}),
      ));
      expectStatus(response, const [201]);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Жалоба отправлена. Мы проверим её в течение суток.')));
    } catch (e) {
      if (mounted) showGarbaError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  // Заблокировать / разблокировать. Блокировка снимает дружбу — переспрашиваем.
  Future<void> toggleBlock(bool blocked) async {
    if (!blocked) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Заблокировать ${player?['name']}?'),
          content: const Text(
            'Он не сможет звать вас в друзья и дарить монеты, его смайлики вы не '
            'увидите, быстрая игра не посадит вас за один стол. Если вы друзья — '
            'дружба удалится. Он об этом не узнает.',
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('ОТМЕНА')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('ЗАБЛОКИРОВАТЬ'),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    setState(() => busy = true);
    try {
      final uri = Uri.parse('$apiBase/players/${Uri.encodeComponent(widget.code)}/block');
      final response = await apiRequest(blocked
          ? http.delete(uri, headers: authHeaders())
          : http.post(uri, headers: authHeaders(), body: '{}'));
      expectStatus(response, const [200]);
      await load();
    } catch (e) {
      if (mounted) showGarbaError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Widget friendButtons(String status) {
    switch (status) {
      case 'friends':
        return OutlinedButton(
          onPressed: busy ? null : () => friendAction('remove'),
          child: const Text('УДАЛИТЬ ИЗ ДРУЗЕЙ'),
        );
      case 'outgoing':
        return OutlinedButton(
          onPressed: busy ? null : () => friendAction('cancel'),
          child: const Text('ЗАЯВКА ОТПРАВЛЕНА ✕'),
        );
      case 'incoming':
        return Row(
          children: [
            Expanded(
              child: FilledButton(
                onPressed: busy ? null : () => friendAction('accept'),
                child: const Text('ПРИНЯТЬ'),
              ),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: OutlinedButton(
                onPressed: busy ? null : () => friendAction('decline'),
                child: const Text('ОТКЛОНИТЬ'),
              ),
            ),
          ],
        );
      default:
        return OutlinedButton(
          onPressed: busy ? null : () => friendAction('request'),
          child: const Text('ДОБАВИТЬ В ДРУЗЬЯ'),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = player;
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: p == null
          ? Center(
              child: error == null
                  ? const CircularProgressIndicator()
                  : Text(error!))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                    child: AvatarView(
                        avatar: p['avatar']?.toString(),
                        name: p['name'].toString(),
                        radius: 56,
                        frame: p['frame']?.toString())),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(
                      fontSize: 28, fontWeight: FontWeight.w900),
                ),
                Text('Код игрока: ${p['code']}',
                    style: const TextStyle(color: Colors.white70)),
                // Сколько у него монет (с 08.10.2026; старый сервер поля не отдаёт).
                if (p['balance'] is num)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const CoinIcon(size: 19),
                      const SizedBox(width: 4),
                      Text(
                        fmtCoins((p['balance'] as num).toInt()),
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('Рейтинг: ',
                        style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFFD4A94F))),
                    RatingText(p['rating'], fontSize: 20),
                  ],
                ),
                // Игра ШАХ (этап 4): свой рейтинг и партии — только когда ШАХ включён на сервере.
                if (p['shah'] is Map) ShahProfileLine(shah: Map<String, dynamic>.from(p['shah'] as Map)),
                if (p['friendStatus'] == 'incoming')
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text('Зовёт вас в друзья',
                        style: TextStyle(color: Colors.greenAccent)),
                  ),
                const SizedBox(height: 12),
                if (p['blocked'] == true)
                  const Text('Вы заблокировали этого игрока',
                      style: TextStyle(color: Colors.redAccent))
                else
                  Row(
                    children: [
                      Expanded(
                          child: friendButtons(
                              p['friendStatus']?.toString() ?? 'none')),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  GiftScreen(initialCode: p['code'].toString()),
                            ),
                          ),
                          child: const Text('ПОДАРИТЬ'),
                        ),
                      ),
                    ],
                  ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextButton.icon(
                        onPressed: busy ? null : report,
                        style: TextButton.styleFrom(foregroundColor: Colors.orangeAccent),
                        icon: const Icon(Icons.flag_outlined),
                        label: const Text('ПОЖАЛОВАТЬСЯ'),
                      ),
                    ),
                    Expanded(
                      child: TextButton.icon(
                        onPressed: busy ? null : () => toggleBlock(p['blocked'] == true),
                        style: TextButton.styleFrom(foregroundColor: Colors.redAccent),
                        icon: const Icon(Icons.block),
                        label: Text(p['blocked'] == true ? 'РАЗБЛОКИРОВАТЬ' : 'ЗАБЛОКИРОВАТЬ'),
                      ),
                    ),
                  ],
                ),
                const Divider(height: 32),
                if (p['medals'] is List) ...[
                  CoinMedalsView(medals: p['medals'] as List, tournamentWins: (p['tournamentWins'] as num?)?.toInt() ?? 0),
                  const Divider(height: 32),
                ],
                StatsView(stats: Map<String, dynamic>.from(p['stats'] as Map)),
              ],
            ),
    );
  }
}

// Аватар игрока (этап 9.5): фото с сервера или первая буква имени.
// avatar — адрес от сервера вида /avatars/<id>?v=<версия> или null.
// frame — рамка из магазина (§17), её видят все; null — без рамки.
class AvatarView extends StatelessWidget {
  final String? avatar;
  final String name;
  final double radius;
  final String? frame;

  const AvatarView(
      {super.key, required this.avatar, required this.name, this.radius = 20, this.frame});

  @override
  Widget build(BuildContext context) {
    final letter = name.isEmpty ? '?' : name.characters.first.toUpperCase();
    return framed(
      CircleAvatar(
        radius: radius,
        backgroundColor: const Color(0xFF2A3B45),
        foregroundImage: avatar == null ? null : NetworkImage('$apiBase$avatar'),
        child: Text(letter,
            style:
                TextStyle(fontSize: radius * 0.9, fontWeight: FontWeight.w800)),
      ),
      diameter: radius * 2,
      frame: frame,
    );
  }
}
