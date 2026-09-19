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

  @override
  void initState() {
    super.initState();
    refreshMe();
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

  // Вернулись на главный экран — баланс мог измениться.
  @override
  void didPopNext() => refreshMe();

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
      });
      // Первый вход за день — бонус забирается сам (ТЗ §3: «за ежедневный вход»).
      if (daily['claimedToday'] != true) await claimDailyBonus();
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
                  Text(
                    balance == null ? '🪙 …' : '🪙 ${fmtCoins(balance!)}',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
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
                      // Играть с кем угодно, без кода (19.09.2026).
                      GarbaButton(label: 'БЫСТРАЯ ИГРА', onTap: () => quickGame(context)),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ОТКРЫТЫЕ КОМНАТЫ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const OpenRoomsScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'СОЗДАТЬ КОМНАТУ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const CreateRoomScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ВОЙТИ ПО КОДУ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const JoinRoomScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПОДАРИТЬ МОНЕТЫ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const GiftScreen(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПРИГЛАСИТЬ ДРУГА',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => InviteScreen(code: code, invitedCount: invitedCount),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: friendRequests > 0 ? 'ДРУЗЬЯ · заявок: $friendRequests' : 'ДРУЗЬЯ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const FriendsScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'РЕЙТИНГ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const RatingScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПРОФИЛЬ',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const ProfileScreen()),
                        ),
                      ),
                      const SizedBox(height: 14),
                      GarbaButton(
                        label: 'ПРАВИЛА',
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const RulesScreen()),
                        ),
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
