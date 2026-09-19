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
      ('Максимальный выигранный риск', v('maxRisk') == 0 ? '—' : '×${v('maxRisk')}'),
    ];
    return Column(
      children: rows
          .map((r) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    Expanded(child: Text(r.$1, style: const TextStyle(color: Colors.white70))),
                    Text(r.$2, style: const TextStyle(fontWeight: FontWeight.w800)),
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

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/me/profile'), headers: authHeaders());
      if (response.statusCode != 200) throw Exception(response.body);
      if (!mounted) return;
      setState(() => profile = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
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
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ОТМЕНА')),
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
      final response = await http.delete(Uri.parse('$apiBase/me'), headers: authHeaders());
      if (!mounted) return;
      if (response.statusCode == 409) {
        final roomId = (jsonDecode(response.body) as Map)['roomId'];
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Сначала доиграйте игру в комнате #$roomId')),
        );
        return;
      }
      if (response.statusCode != 200) throw Exception(response.body);
      await Session.clear();
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const StartScreen()),
        (_) => false,
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Не удалось удалить аккаунт: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = profile;
    return Scaffold(
      appBar: AppBar(title: const Text('Профиль')),
      body: p == null
          ? Center(child: error == null ? const CircularProgressIndicator() : Text(error!))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                  child: GestureDetector(
                    onTap: () async {
                      final avatar = await pickAndUploadAvatar(context);
                      if (avatar != null && mounted) setState(() => p['avatar'] = avatar);
                    },
                    child: Stack(
                      children: [
                        AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 56),
                        const Positioned(
                          right: 0,
                          bottom: 0,
                          child: CircleAvatar(radius: 16, child: Icon(Icons.photo_camera, size: 18)),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                const Center(
                  child: Text('Нажмите на фото, чтобы сменить', style: TextStyle(color: Colors.white54)),
                ),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text('Код игрока: ${p['code']}', style: const TextStyle(color: Colors.white70)),
                const SizedBox(height: 12),
                Text(
                  'Баланс: ${fmtCoins((p['balance'] as num).toInt())} 🪙',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
                Text('Друзей: ${p['friendsCount']}', style: const TextStyle(color: Colors.white70)),
                Text(
                  'Рейтинг: ⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                const Divider(height: 32),
                StatsView(stats: Map<String, dynamic>.from(p['stats'] as Map)),
                const SizedBox(height: 32),
                TextButton.icon(
                  onPressed: deleteAccount,
                  style: TextButton.styleFrom(foregroundColor: Colors.redAccent),
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
  };

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
      final response = await http.get(Uri.parse('$apiBase/friends'), headers: authHeaders());
      if (response.statusCode != 200) throw Exception(response.body);
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        friends = (body['friends'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        error = null;
      });
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
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
      if (response.statusCode != 201) {
        final body = jsonDecode(response.body);
        final key = body is Map ? body['error']?.toString() : null;
        if (mounted) setState(() => error = _errors[key] ?? 'Ошибка: ${response.body}');
        return;
      }
      codeController.clear();
      await load();
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    } finally {
      if (mounted) setState(() => adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = friends;
    return Scaffold(
      appBar: AppBar(title: const Text('Друзья')),
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
                'Добавили по коду — дружба сразу у обоих.',
                style: TextStyle(color: Colors.white54),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(error!, style: const TextStyle(color: Colors.redAccent)),
                ),
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
                              final stats = Map<String, dynamic>.from(f['stats'] as Map);
                              final roomId = f['roomId']?.toString();
                              return ListTile(
                                leading: AvatarView(avatar: f['avatar']?.toString(), name: f['name'].toString()),
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
                                      builder: (_) => PlayerScreen(code: f['code'].toString()),
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
      if (response.statusCode != 200) throw Exception(response.body);
      if (!mounted) return;
      setState(() => player = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
    }
  }

  Future<void> toggleFriend(bool isFriend) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final response = isFriend
          ? await http.delete(
              Uri.parse('$apiBase/friends/${Uri.encodeComponent(widget.code)}'),
              headers: authHeaders(),
            )
          : await http.post(
              Uri.parse('$apiBase/friends'),
              headers: authHeaders(),
              body: jsonEncode({'code': widget.code}),
            );
      if (response.statusCode >= 300) throw Exception(response.body);
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Не получилось: $e')));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = player;
    return Scaffold(
      appBar: AppBar(title: Text(p?['name']?.toString() ?? 'Игрок')),
      body: p == null
          ? Center(child: error == null ? const CircularProgressIndicator() : Text(error!))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(child: AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), radius: 56)),
                const SizedBox(height: 12),
                Text(
                  p['name'].toString(),
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
                ),
                Text('Код игрока: ${p['code']}', style: const TextStyle(color: Colors.white70)),
                Text(
                  'Рейтинг: ⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: busy ? null : () => toggleFriend(p['isFriend'] == true),
                        child: Text(p['isFriend'] == true ? 'УДАЛИТЬ ИЗ ДРУЗЕЙ' : 'ДОБАВИТЬ В ДРУЗЬЯ'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => GiftScreen(initialCode: p['code'].toString()),
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

  const AvatarView({super.key, required this.avatar, required this.name, this.radius = 20});

  @override
  Widget build(BuildContext context) {
    final letter = name.isEmpty ? '?' : name.characters.first.toUpperCase();
    return CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF2A3B45),
      foregroundImage: avatar == null ? null : NetworkImage('$apiBase$avatar'),
      child: Text(letter, style: TextStyle(fontSize: radius * 0.9, fontWeight: FontWeight.w800)),
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
      messenger.showSnackBar(const SnackBar(content: Text('Фото слишком большое')));
      return null;
    }
    if (response.statusCode == 400) {
      messenger.showSnackBar(const SnackBar(content: Text('Это не похоже на фото')));
      return null;
    }
    if (response.statusCode != 200) throw Exception(response.body);
    return (jsonDecode(response.body) as Map)['avatar']?.toString();
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('Не удалось загрузить фото: $e')));
    return null;
  }
}
