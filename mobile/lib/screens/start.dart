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
  final playerCodeController = TextEditingController();
  final recoveryCodeController = TextEditingController();
  // checking — проверяем сохранённый аккаунт; needName — аккаунта нет, нужно имя.
  bool checking = true;
  bool needName = false;
  bool creating = false;
  bool recovering = false;
  String? error;

  @override
  void initState() {
    super.initState();
    DeepLinks.start();
    // Отладка с сервером на Mac: короткая проверка сервера сразу вызывает системный
    // запрос iOS на доступ к локальной сети, и первая попытка создать аккаунт не ждёт
    // тайм-аута. В релизе сервер в интернете по https — это не нужно.
    if (kDebugMode) unawaited(_warmUpServerConnection());
    checkAccount();
  }

  Future<void> _warmUpServerConnection() async {
    try {
      await http
          .get(Uri.parse('$apiBase/health'))
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      // Ошибку покажет обычное действие пользователя с понятным сообщением.
    }
  }

  @override
  void dispose() {
    nameController.dispose();
    inviteController.dispose();
    playerCodeController.dispose();
    recoveryCodeController.dispose();
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
      final response = await apiRequest(
          http.get(Uri.parse('$apiBase/me'), headers: authHeaders()));
      if (response.statusCode == 401) {
        // Сервер не знает этот аккаунт — заводим новый или восстанавливаем по коду.
        // Говорим прямо, что случилось, — иначе игрок молча теряет аккаунт.
        await Session.clear();
        setState(() {
          checking = false;
          needName = true;
          error = 'Аккаунт на сервере не найден. Если сохраняли код восстановления — '
              'восстановите аккаунт ниже, иначе создайте новый.';
        });
        return;
      }
      expectStatus(response, const [200]);
      openHome();
    } catch (e) {
      // Сеть недоступна — токен НЕ стираем, просто предлагаем повторить.
      if (!mounted) return;
      setState(() {
        checking = false;
        error = userErrorMessage(e);
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
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/accounts'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'name': name,
          if (inviteController.text.trim().isNotEmpty)
            'inviteCode': inviteController.text.trim(),
        }),
      ));
      expectStatus(response, const [201]);
      final account = jsonDecode(response.body) as Map<String, dynamic>;
      await Session.save(account);
      if (!mounted) return;
      await showRecoveryCode(
        context,
        playerCode: account['code'].toString(),
        recoveryCode: account['recoveryCode'].toString(),
        firstTime: true,
      );
      openHome();
    } catch (e) {
      if (!mounted) return;
      setState(() =>
          error = userErrorMessage(e, fallback: 'Не удалось создать аккаунт'));
    } finally {
      if (mounted) setState(() => creating = false);
    }
  }

  Future<void> recoverAccount() async {
    if (creating) return;
    final playerCode = playerCodeController.text.trim();
    final recoveryCode = recoveryCodeController.text.trim();
    if (playerCode.isEmpty || recoveryCode.isEmpty) {
      setState(() => error = 'Введите оба кода.');
      return;
    }
    setState(() {
      creating = true;
      error = null;
    });
    try {
      final response = await apiRequest(http.post(
        Uri.parse('$apiBase/accounts/recover'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(
            {'playerCode': playerCode, 'recoveryCode': recoveryCode}),
      ));
      expectStatus(response, const [200]);
      final account = jsonDecode(response.body) as Map<String, dynamic>;
      await Session.save(account);
      if (!mounted) return;
      await showRecoveryCode(
        context,
        playerCode: account['code'].toString(),
        recoveryCode: account['recoveryCode'].toString(),
      );
      openHome();
    } catch (e) {
      if (mounted)
        setState(() => error =
            userErrorMessage(e, fallback: 'Не удалось восстановить аккаунт'));
    } finally {
      if (mounted) setState(() => creating = false);
    }
  }

  void toggleRecovery() {
    setState(() {
      recovering = !recovering;
      error = null;
    });
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
      MaterialPageRoute(
          builder: (_) =>
              LobbyScreen(roomCode: room, currentPlayerId: Session.id)),
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
                    const Align(
                        alignment: Alignment.centerLeft, child: GarbaTitle()),
                    const Spacer(),
                    if (checking)
                      const Center(child: CircularProgressIndicator())
                    else if (needName) ...[
                      Text(
                        recovering
                            ? 'Восстановление аккаунта'
                            : 'Как вас зовут?',
                        style: TextStyle(
                            fontSize: 24, fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        recovering
                            ? 'Введите код игрока и секретный код, который вы сохранили.'
                            : 'Это имя увидят другие игроки за столом.',
                        style: TextStyle(color: Colors.white70),
                      ),
                      const SizedBox(height: 16),
                      if (recovering) ...[
                        TextField(
                          controller: playerCodeController,
                          maxLength: 6,
                          textCapitalization: TextCapitalization.characters,
                          autocorrect: false,
                          decoration: const InputDecoration(
                            labelText: 'Код игрока',
                            hintText: 'Например, A7K9MP',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: recoveryCodeController,
                          textCapitalization: TextCapitalization.characters,
                          autocorrect: false,
                          decoration: const InputDecoration(
                            labelText: 'Код восстановления',
                            hintText: 'XXXX-XXXX-XXXX-XXXX',
                            border: OutlineInputBorder(),
                          ),
                          onSubmitted: (_) => recoverAccount(),
                        ),
                      ] else ...[
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
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          GarbaButton(
                            label: creating
                                ? 'ПОДОЖДИТЕ...'
                                : recovering
                                    ? 'ВОССТАНОВИТЬ'
                                    : 'НАЧАТЬ',
                            onTap: recovering ? recoverAccount : createAccount,
                          ),
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: creating ? null : toggleRecovery,
                            child: Text(recovering
                                ? 'СОЗДАТЬ НОВЫЙ АККАУНТ'
                                : 'ВОССТАНОВИТЬ АККАУНТ'),
                          ),
                          // Требование App Store и Google Play — видно до создания аккаунта.
                          TextButton(
                            onPressed: () => Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const PrivacyScreen()),
                            ),
                            child: const Text('Политика конфиденциальности',
                                style: TextStyle(color: Colors.white54, fontSize: 12)),
                          ),
                        ],
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

Future<void> showRecoveryCode(
  BuildContext context, {
  required String playerCode,
  required String recoveryCode,
  bool firstTime = false,
}) async {
  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) => AlertDialog(
      title: Text(firstTime
          ? 'Сохраните доступ к аккаунту'
          : 'Новый код восстановления'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
              'Эти два кода вернут аккаунт после смены или потери телефона.'),
          const SizedBox(height: 18),
          const Text('КОД ИГРОКА',
              style: TextStyle(color: Colors.white60, fontSize: 12)),
          SelectableText(playerCode,
              style:
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          const Text('КОД ВОССТАНОВЛЕНИЯ',
              style: TextStyle(color: Colors.white60, fontSize: 12)),
          SelectableText(recoveryCode,
              style:
                  const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          const Text(
            'Никому не отправляйте код восстановления. После использования он изменится.',
            style: TextStyle(color: Colors.white70),
          ),
        ],
      ),
      actions: [
        TextButton.icon(
          onPressed: () async {
            await Clipboard.setData(
              ClipboardData(
                  text:
                      'Код игрока: $playerCode\nКод восстановления: $recoveryCode'),
            );
            if (dialogContext.mounted) {
              ScaffoldMessenger.of(dialogContext).showSnackBar(
                  const SnackBar(content: Text('Коды скопированы')));
            }
          },
          icon: const Icon(Icons.copy),
          label: const Text('КОПИРОВАТЬ'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Я СОХРАНИЛ(А)'),
        ),
      ],
    ),
  );
}
