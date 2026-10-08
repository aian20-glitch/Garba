// Подарить монеты и пригласить друга.
part of '../main.dart';

// Подарок монет другому игроку по его коду (ТЗ §5): до 10 000 в сутки на всех вместе —
// одному 10 000 или десятерым по 1 000 (08.10.2026).
// Все проверки — на сервере; экран только подсказывает заранее.
class GiftScreen extends StatefulWidget {
  // Код получателя, если подарок открыт из карточки друга.
  final String? initialCode;

  const GiftScreen({super.key, this.initialCode});

  @override
  State<GiftScreen> createState() => _GiftScreenState();
}

class _GiftScreenState extends State<GiftScreen> {
  final codeController = TextEditingController();
  int amount = 100;
  // Кому уйдёт подарок — имя по коду, чтобы не ошибиться адресатом.
  String? recipientName;
  String? error;
  bool sending = false;
  // С сервера (GET /me): сколько монет, дарил ли сегодня, сидит ли в комнате.
  int balance = 0;
  bool giftSentToday = false;
  // Сколько ещё можно подарить сегодня (старый сервер поля не отдаёт — тогда 10 000).
  int giftLeft = 10000;
  bool inRoom = false;
  bool loaded = false;

  @override
  void initState() {
    super.initState();
    codeController.text = widget.initialCode ?? '';
    loadMe();
    if (widget.initialCode != null) findRecipient();
  }

  Future<void> loadMe() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/me'), headers: authHeaders());
      expectStatus(response, const [200]);
      final me = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        balance = (me['balance'] as num).toInt();
        giftSentToday = me['giftSentToday'] == true;
        giftLeft = (me['giftLeftToday'] as num?)?.toInt() ?? (giftSentToday ? 0 : 10000);
        inRoom = me['roomId'] != null;
        loaded = true;
      });
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  static const _gifts = [100, 500, 1000, 2000, 3000, 5000, 7000, 10000];

  static const _errors = <String, String>{
    'player not found': 'Игрока с таким кодом нет',
    'bad amount': 'Сумма — от 100 до 10 000',
    'self': 'Себе подарить нельзя',
    'already gifted today': 'Сегодня вы уже подарили 10 000. Следующие подарки — завтра',
    'over daily limit': 'Столько уже не влезает в лимит на сегодня',
    'not enough coins': 'Не хватает монет',
    'finish your game first': 'Сначала доиграйте: пока вы в комнате, дарить нельзя',
  };

  @override
  void dispose() {
    codeController.dispose();
    super.dispose();
  }

  Future<void> findRecipient() async {
    final code = codeController.text.trim();
    if (code.isEmpty) return;
    setState(() {
      recipientName = null;
      error = null;
    });
    try {
      final response = await http.get(
        Uri.parse('$apiBase/players/${Uri.encodeComponent(code)}'),
        headers: authHeaders(),
      );
      if (!mounted) return;
      if (response.statusCode == 404) {
        setState(() => error = _errors['player not found']);
        return;
      }
      expectStatus(response, const [200]);
      final player = jsonDecode(response.body) as Map<String, dynamic>;
      setState(() => recipientName = player['name'].toString());
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> sendGift() async {
    if (sending || recipientName == null) return;
    setState(() {
      sending = true;
      error = null;
    });
    try {
      final response = await http.post(
        Uri.parse('$apiBase/gifts'),
        headers: authHeaders(),
        body: jsonEncode({'toCode': codeController.text.trim(), 'amount': amount}),
      );
      if (!mounted) return;
      if (response.statusCode != 200) {
        final failure = ApiFailure.fromResponse(response);
        setState(() => error = _errors[failure.code] ?? userErrorMessage(failure));
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Подарок отправлен: $recipientName +${fmtCoins(amount)}')),
      );
      Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!loaded) {
      return Scaffold(
        appBar: backOnlyAppBar(),
        body: Center(child: error == null ? const CircularProgressIndicator() : Text(error!)),
      );
    }

    final blocked = giftSentToday
        ? _errors['already gifted today']
        : inRoom
            ? _errors['finish your game first']
            : null;

    return Scaffold(
      appBar: backOnlyAppBar(),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Можно подарить до 10 000 монет в сутки — одному или нескольким игрокам.',
                style: TextStyle(color: Colors.white70),
              ),
              if (blocked == null && giftLeft < 10000)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Сегодня можно подарить ещё ${fmtCoins(giftLeft)}',
                    style: const TextStyle(color: Color(0xFFD4A94F), fontWeight: FontWeight.w700),
                  ),
                ),
              const SizedBox(height: 16),
              if (blocked != null)
                Text(blocked, style: const TextStyle(color: Colors.orangeAccent, fontSize: 16))
              else ...[
                TextField(
                  controller: codeController,
                  textCapitalization: TextCapitalization.characters,
                  decoration: InputDecoration(
                    labelText: 'Код игрока',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.search),
                      onPressed: findRecipient,
                    ),
                  ),
                  onChanged: (_) {
                    if (recipientName != null) setState(() => recipientName = null);
                  },
                  onSubmitted: (_) => findRecipient(),
                ),
                if (recipientName != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Получатель: $recipientName',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                  ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _gifts.map((n) {
                    return ChoiceChip(
                      label: Text(fmtCoins(n)),
                      selected: amount == n,
                      onSelected: n <= balance && n <= giftLeft ? (_) => setState(() => amount = n) : null,
                    );
                  }).toList(),
                ),
              ],
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(error!, style: const TextStyle(color: Colors.redAccent)),
                ),
              const Spacer(),
              if (blocked == null)
                GarbaButton(
                  label: sending
                      ? 'ОТПРАВЛЯЕМ...'
                      : recipientName == null
                          ? 'ВВЕДИТЕ КОД И НАЙДИТЕ ИГРОКА'
                          : 'ПОДАРИТЬ ${fmtCoins(amount)}',
                  onTap: recipientName == null ? findRecipient : sendGift,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// Приглашение друга (ТЗ §4): друг вводит этот код при первом входе в игру —
// пригласивший получает 10 000 монет, когда друг доиграет 3 комнаты.
class InviteScreen extends StatelessWidget {
  final String code;
  final int invitedCount;

  const InviteScreen({super.key, required this.code, required this.invitedCount});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Ваш код приглашения',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              SelectableText(
                code,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 40,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 6,
                  color: Color(0xFFD4A94F),
                ),
              ),
              const SizedBox(height: 8),
              GarbaButton(
                label: 'ОТПРАВИТЬ ССЫЛКУ',
                onTap: () => shareInvite(
                  text: 'Играю в ГАРБУ — карточная игра для друзей. Заходи по ссылке:',
                  link: inviteLink(code),
                  extra: 'При первом входе введи код приглашения $code.',
                ),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: code));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Код скопирован')),
                  );
                },
                icon: const Icon(Icons.copy),
                label: const Text('СКОПИРОВАТЬ'),
              ),
              const SizedBox(height: 24),
              const Text(
                'Друг устанавливает ГАРБУ и при первом входе вводит этот код. '
                'Как только он доиграет 3 комнаты — вы получите 10 000 монет.',
                style: TextStyle(fontSize: 16),
              ),
              const SizedBox(height: 16),
              Text(
                'Пришло по вашему коду: $invitedCount',
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              const Text(
                'По этому же коду вам можно подарить монеты.',
                style: TextStyle(color: Colors.white54),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
