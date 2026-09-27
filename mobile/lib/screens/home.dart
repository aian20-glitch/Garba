// Главный экран.
part of '../main.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with RouteAware {
  // Всё с сервера (GET /me): баланс, незаконченная комната, код игрока,
  // ежедневный бонус (ТЗ §3), дарил ли сегодня (ТЗ §5).
  int? balance;
  String? roomId;
  String code = '';
  int dailyStreak = 0;
  int invitedCount = 0;
  // Сколько человек зовут меня в друзья — цифра на кнопке «ДРУЗЬЯ».
  int friendRequests = 0;
  bool claimingBonus = false;
  String? avatar;
  Object? rating;
  // Друзья зовут в комнату (25.09.2026). Новое приглашение — со звуком.
  List<Map<String, dynamic>> invites = const [];
  Set<String> seenInvites = {};
  Timer? invitesTimer;

  @override
  void initState() {
    super.initState();
    refreshMe();
    // Приглашения приходят, пока главный экран открыт (push-уведомлений нет).
    invitesTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!covered) refreshMe();
    });
  }

  // Поверх главного открыт другой экран (стол, лобби) — не опрашиваем сервер и не
  // показываем окно бонуса: оно всплыло бы посреди хода (28.09.2026).
  bool covered = false;

  @override
  void didPushNext() => covered = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  @override
  void dispose() {
    invitesTimer?.cancel();
    routeObserver.unsubscribe(this);
    super.dispose();
  }

  // Вернулись на главный экран — баланс мог измениться.
  @override
  void didPopNext() {
    covered = false;
    refreshMe();
  }

  Future<void> refreshMe() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/me'), headers: authHeaders());
      if (response.statusCode != 200) return;
      final me = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      final daily = Map<String, dynamic>.from(me['daily'] as Map);
      setState(() {
        balance = (me['balance'] as num).toInt();
        roomId = me['roomId']?.toString();
        code = me['code'].toString();
        dailyStreak = (daily['streak'] as num).toInt();
        avatar = me['avatar']?.toString();
        rating = me['rating'];
        invitedCount = (me['invitedCount'] as num?)?.toInt() ?? 0;
        friendRequests = (me['friendRequests'] as num?)?.toInt() ?? 0;
        invites = ((me['roomInvites'] as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      });
      final ids = invites.map((i) => i['roomId'].toString()).toSet();
      if (ids.difference(seenInvites).isNotEmpty) {
        GarbaSounds.ready();
        HapticFeedback.mediumImpact();
      }
      seenInvites = ids;
      // Первый вход за день — бонус забирается сам (ТЗ §3: «за ежедневный вход»).
      if (daily['claimedToday'] != true && !covered) await claimDailyBonus();
    } catch (_) {
      // Нет связи — оставляем то, что уже показано.
    }
  }

  Future<void> claimDailyBonus() async {
    if (claimingBonus) return;
    claimingBonus = true;
    try {
      final response = await http.post(
        Uri.parse('$apiBase/me/daily-bonus'),
        headers: authHeaders(),
        body: jsonEncode({}),
      );
      if (response.statusCode != 200) return;
      final bonus = jsonDecode(response.body) as Map<String, dynamic>;
      final amount = (bonus['amount'] as num).toInt();
      final streak = (bonus['streak'] as num).toInt();
      if (!mounted) return;
      setState(() {
        balance = (bonus['balance'] as num).toInt();
        dailyStreak = streak;
      });
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Ежедневный бонус'),
          content: Text(
            streak == 7
                ? 'День 7/7 — 7 дней подряд!\n+${fmtCoins(amount)} монет'
                : 'День $streak/7\n+${fmtCoins(amount)} монет\n\n'
                    'Заходите каждый день: на 7-й день подряд — 6 000.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('ЗАБРАТЬ'),
            ),
          ],
        ),
      );
    } catch (_) {
      // Нет связи — бонус заберётся при следующем входе.
    } finally {
      claimingBonus = false;
    }
  }

  void go(Widget screen) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  Widget tileRow(Widget left, Widget right) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          children: [
            Expanded(child: left),
            const SizedBox(width: 12),
            Expanded(child: right),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const GarbaTitle(),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CoinIcon(size: 22),
                      const SizedBox(width: 4),
                      Text(
                        balance == null ? '…' : fmtCoins(balance!),
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  AvatarView(avatar: avatar, name: Session.name, radius: 24),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          rating == null ? Session.name : '${Session.name} · ⭐ ${fmtRating(rating)}',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                        ),
                        if (code.isNotEmpty)
                          Text(
                            'Ваш код: $code · бонус: день $dailyStreak/7',
                            style: const TextStyle(color: Colors.white70),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Кнопок много — на небольшом экране они прокручиваются.
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Друг зовёт за стол — войти одним нажатием.
                      for (final inv in invites)
                        Card(
                          color: const Color(0xFF1E3A2A),
                          margin: const EdgeInsets.only(bottom: 10),
                          child: ListTile(
                            leading: const Icon(Icons.mail, color: Color(0xFFD4A94F)),
                            title: Text('${inv['fromName']} зовёт за стол',
                                style: const TextStyle(fontWeight: FontWeight.w800)),
                            subtitle: Text('Комната #${inv['roomId']}'),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                FilledButton(
                                  onPressed: roomId != null
                                      ? null
                                      : () => Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) => JoinRoomScreen(initialCode: inv['roomId'].toString()),
                                            ),
                                          ),
                                  child: const Text('ВОЙТИ'),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.close),
                                  onPressed: () async {
                                    setState(() => invites = invites.where((i) => i != inv).toList());
                                    try {
                                      await http.delete(
                                        Uri.parse('$apiBase/me/invites/${inv['roomId']}'),
                                        headers: authHeaders(),
                                      );
                                    } catch (_) {}
                                  },
                                ),
                              ],
                            ),
                          ),
                        ),
                      // Игрок уже сидит в комнате — туда и возвращаемся, новую не начать.
                      if (roomId != null) ...[
                        GarbaButton(
                          label: 'ВЕРНУТЬСЯ В КОМНАТУ #$roomId',
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => LobbyScreen(
                                roomCode: roomId!,
                                currentPlayerId: Session.id,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                      ],
                      // По две плитки в ряд (просьба владельца, 19.09.2026): короче экран,
                      // всё видно сразу. «Вернуться в комнату» — выше, во всю ширину.
                      tileRow(
                        HomeTile(icon: Icons.bolt, label: 'БЫСТРАЯ ИГРА', onTap: () => quickGame(context)),
                        HomeTile(icon: Icons.public, label: 'ОТКРЫТЫЕ КОМНАТЫ', onTap: () => go(const OpenRoomsScreen())),
                      ),
                      tileRow(
                        HomeTile(icon: Icons.add_circle_outline, label: 'СОЗДАТЬ КОМНАТУ', onTap: () => go(const CreateRoomScreen())),
                        HomeTile(icon: Icons.pin_outlined, label: 'ВОЙТИ ПО КОДУ', onTap: () => go(const JoinRoomScreen())),
                      ),
                      tileRow(
                        HomeTile(icon: Icons.card_giftcard, label: 'ПОДАРИТЬ МОНЕТЫ', onTap: () => go(const GiftScreen())),
                        HomeTile(
                          icon: Icons.person_add_alt_1,
                          label: 'ПРИГЛАСИТЬ ДРУГА',
                          onTap: () => go(InviteScreen(code: code, invitedCount: invitedCount)),
                        ),
                      ),
                      tileRow(
                        HomeTile(icon: Icons.group, label: 'ДРУЗЬЯ', badge: friendRequests, onTap: () => go(const FriendsScreen())),
                        HomeTile(icon: Icons.emoji_events_outlined, label: 'РЕЙТИНГ', onTap: () => go(const RatingScreen())),
                      ),
                      tileRow(
                        HomeTile(icon: Icons.person_outline, label: 'ПРОФИЛЬ', onTap: () => go(const ProfileScreen())),
                        HomeTile(icon: Icons.menu_book_outlined, label: 'ПРАВИЛА', onTap: () => go(const RulesScreen())),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Игровые монеты являются виртуальными единицами и не имеют денежного эквивалента.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
