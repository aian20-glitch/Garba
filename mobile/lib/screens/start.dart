// Первый запуск: имя игрока и код приглашения.
part of '../main.dart';

// Первый экран: есть ли на телефоне аккаунт. Нет — спрашиваем имя и заводим.
// Есть — проверяем токен на сервере и идём на главный экран.
class StartScreen extends StatefulWidget {
  const StartScreen({super.key});

  @override
  State<StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<StartScreen> {
  final nameController = TextEditingController();
  // Код друга, который пригласил (ТЗ §4). Необязательно.
  final inviteController = TextEditingController();
  // checking — проверяем сохранённый аккаунт; needName — аккаунта нет, нужно имя.
  bool checking = true;
  bool needName = false;
  bool creating = false;
  String? error;

  @override
  void initState() {
    super.initState();
    DeepLinks.start();
    checkAccount();
  }

  @override
  void dispose() {
    nameController.dispose();
    inviteController.dispose();
    super.dispose();
  }

  Future<void> checkAccount() async {
    setState(() {
      checking = true;
      error = null;
    });

    await Session.load();
    if (Session.token.isEmpty) {
      // Пришли по ссылке-приглашению — код уже заполнен.
      final fromLink = DeepLinks.takeInviteCode();
      if (fromLink.isNotEmpty) inviteController.text = fromLink;
      setState(() {
        checking = false;
        needName = true;
      });
      return;
    }

    try {
      final response = await http.get(Uri.parse('$apiBase/me'), headers: authHeaders());
      if (response.statusCode == 401) {
        // Сервер не знает этот аккаунт — заводим новый.
        await Session.clear();
        setState(() {
          checking = false;
          needName = true;
        });
        return;
      }
      if (response.statusCode != 200) throw Exception(response.body);
      openHome();
    } catch (_) {
      // Сеть недоступна — токен НЕ стираем, просто предлагаем повторить.
      if (!mounted) return;
      setState(() {
        checking = false;
        error = 'Нет связи с сервером';
      });
    }
  }

  Future<void> createAccount() async {
    final name = nameController.text.trim();
    if (name.isEmpty || creating) return;
    setState(() {
      creating = true;
      error = null;
    });

    try {
      final response = await http.post(
        Uri.parse('$apiBase/accounts'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': name,
          if (inviteController.text.trim().isNotEmpty) 'inviteCode': inviteController.text.trim(),
        }),
      );
      if (response.statusCode == 400 && response.body.contains('invite code not found')) {
        setState(() => error = 'Код приглашения не найден. Проверьте его или оставьте поле пустым.');
        return;
      }
      // С одного адреса — не больше 5 новых аккаунтов в час (защита от накрутки).
      if (response.statusCode == 429) {
        setState(() => error = 'С вашего подключения недавно создавали много аккаунтов. '
            'Попробуйте позже.');
        return;
      }
      if (response.statusCode != 201) throw Exception(response.body);
      await Session.save(jsonDecode(response.body) as Map<String, dynamic>);
      openHome();
    } catch (e) {
      if (!mounted) return;
      setState(() => error = 'Не удалось создать аккаунт: $e');
    } finally {
      if (mounted) setState(() => creating = false);
    }
  }

  // Отладка на симуляторе iPhone, где нечем нажимать: если в настройках приложения лежит
  // ключ debug.room, сразу открываем эту комнату. В релизной сборке ничего не делает.
  Future<void> openDebugRoom() async {
    if (!kDebugMode) return;
    final prefs = await SharedPreferences.getInstance();
    final room = prefs.getString('debug.room');
    if (room == null || room.isEmpty) return;
    await prefs.remove('debug.room');
    navigatorKey.currentState?.push(
      MaterialPageRoute(builder: (_) => LobbyScreen(roomCode: room, currentPlayerId: Session.id)),
    );
  }

  void openHome() {
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => const HomeScreen()),
    );
    // Ссылка на комнату ждала входа в аккаунт — открываем её.
    DeepLinks.openPending();
    openDebugRoom();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: math.max(0, constraints.maxHeight - 40),
              ),
              // Сохраняем отступы на полном экране; с клавиатурой форма прокручивается.
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(alignment: Alignment.centerLeft, child: GarbaTitle()),
                    const Spacer(),
                    if (checking)
                      const Center(child: CircularProgressIndicator())
                    else if (needName) ...[
                      const Text(
                        'Как вас зовут?',
                        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Это имя увидят другие игроки за столом.',
                        style: TextStyle(color: Colors.white70),
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: nameController,
                        maxLength: 20,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Имя игрока',
                          border: OutlineInputBorder(),
                        ),
                        onSubmitted: (_) => createAccount(),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: inviteController,
                        textCapitalization: TextCapitalization.characters,
                        decoration: const InputDecoration(
                          labelText: 'Код приглашения (если есть)',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                    if (error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.redAccent),
                      ),
                    ],
                    const Spacer(),
                    if (!checking && needName)
                      GarbaButton(
                        label: creating ? 'СОЗДАЁМ...' : 'НАЧАТЬ',
                        onTap: createAccount,
                      )
                    else if (!checking && error != null)
                      GarbaButton(label: 'ПОВТОРИТЬ', onTap: checkAccount),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
