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
          'Аккаунт удалится навсегда: монеты, рейтинг, друзья, фото и статистика. '
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
                Center(
                  child: GestureDetector(
                    onTap: () async {
                      final avatar = await pickAndUploadAvatar(context);
                      if (avatar != null && mounted)
                        setState(() => p['avatar'] = avatar);
                    },
                    child: Stack(
                      children: [
                        AvatarView(
                            avatar: p['avatar']?.toString(),
                            name: p['name'].toString(),
                            radius: 56),
                        const Positioned(
                          right: 0,
                          bottom: 0,
                          child: CircleAvatar(
                              radius: 16,
                              child: Icon(Icons.photo_camera, size: 18)),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                const Center(
                  child: Text('Нажмите на фото, чтобы сменить',
                      style: TextStyle(color: Colors.white54)),
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
                    Text(
                      fmtCoins((p['balance'] as num).toInt()),
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                Text('Друзей: ${p['friendsCount']}',
                    style: const TextStyle(color: Colors.white70)),
                Text(
                  'Рейтинг: ⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFFD4A94F)),
                ),
                const Divider(height: 32),
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
                  onPressed: deleteAccount,
                  style:
                      TextButton.styleFrom(foregroundColor: Colors.redAccent),
                  icon: const Icon(Icons.delete_forever),
                  label: const Text('Удалить аккаунт'),
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
        final body = jsonDecode(response.body);
        final key = body is Map ? body['error']?.toString() : null;
        if (mounted)
          setState(() => error = _errors[key] ?? 'Ошибка: ${response.body}');
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
                                    name: f['name'].toString()),
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
          response = await http.delete(Uri.parse('$apiBase/friends/$code'),
              headers: authHeaders());
        default: // accept | decline | cancel
          response = await http.post(
            Uri.parse('$apiBase/friends/requests/$code/$action'),
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
                        radius: 56)),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(
                      fontSize: 28, fontWeight: FontWeight.w900),
                ),
                Text('Код игрока: ${p['code']}',
                    style: const TextStyle(color: Colors.white70)),
                Text(
                  'Рейтинг: ⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFFD4A94F)),
                ),
                if (p['friendStatus'] == 'incoming')
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text('Зовёт вас в друзья',
                        style: TextStyle(color: Colors.greenAccent)),
                  ),
                const SizedBox(height: 12),
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
                const Divider(height: 32),
                StatsView(stats: Map<String, dynamic>.from(p['stats'] as Map)),
              ],
            ),
    );
  }
}

// Аватар игрока (этап 9.5): фото с сервера или первая буква имени.
// avatar — адрес от сервера вида /avatars/<id>?v=<версия> или null.
class AvatarView extends StatelessWidget {
  final String? avatar;
  final String name;
  final double radius;

  const AvatarView(
      {super.key, required this.avatar, required this.name, this.radius = 20});

  @override
  Widget build(BuildContext context) {
    final letter = name.isEmpty ? '?' : name.characters.first.toUpperCase();
    return CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF2A3B45),
      foregroundImage: avatar == null ? null : NetworkImage('$apiBase$avatar'),
      child: Text(letter,
          style:
              TextStyle(fontSize: radius * 0.9, fontWeight: FontWeight.w800)),
    );
  }
}

// Выбрать фото в галерее и загрузить как аватар. Телефон сам уменьшает фото
// до 256 точек — сервер принимает не больше 300 КБ. Возвращает новый адрес или null.
Future<String?> pickAndUploadAvatar(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 256,
      maxHeight: 256,
      imageQuality: 85,
    );
    if (picked == null) return null; // передумал
    final bytes = await picked.readAsBytes();
    final response = await http.put(
      Uri.parse('$apiBase/me/avatar'),
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': 'Bearer ${Session.token}',
      },
      body: bytes,
    );
    if (response.statusCode == 413) {
      messenger
          .showSnackBar(const SnackBar(content: Text('Фото слишком большое')));
      return null;
    }
    if (response.statusCode == 400) {
      messenger
          .showSnackBar(const SnackBar(content: Text('Это не похоже на фото')));
      return null;
    }
    expectStatus(response, const [200]);
    return (jsonDecode(response.body) as Map)['avatar']?.toString();
  } catch (e) {
    showGarbaError(context, e, prefix: 'Не удалось загрузить фото');
    return null;
  }
}
