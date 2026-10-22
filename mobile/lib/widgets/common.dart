// Общие элементы: строка игрока, кнопка, плитка главного экрана.
part of '../main.dart';

// Внутренние экраны не используют отдельную «шапку»: остаётся только
// компактная стрелка возврата поверх общего фона приложения.
PreferredSizeWidget backOnlyAppBar({PreferredSizeWidget? bottom}) => AppBar(
      automaticallyImplyLeading: false,
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      elevation: 0,
      toolbarHeight: 44,
      leadingWidth: 48,
      leading: Builder(
        builder: (context) => IconButton(
          tooltip: 'Назад',
          onPressed: () => Navigator.of(context).maybePop(),
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints.tightFor(width: 32, height: 32),
          iconSize: 20,
          icon: const Icon(Icons.arrow_back_ios_new),
        ),
      ),
      bottom: bottom,
    );

// Единый значок игровой монеты. Системный emoji на iPhone выглядел как
// серая луна, поэтому во всём приложении используем жёлтую Material-иконку.
class CoinIcon extends StatelessWidget {
  final double size;

  const CoinIcon({super.key, this.size = 16});

  @override
  Widget build(BuildContext context) {
    return Icon(
      Icons.monetization_on_rounded,
      size: size,
      color: const Color(0xFFD4A94F),
    );
  }
}

class PlayerTile extends StatelessWidget {
  final String name;
  final String subtitle;
  final bool ready;
  // Адрес фото игрока; null — фото нет или место свободно.
  final String? avatar;
  // Нажатие — открыть карточку игрока (в друзья, подарок).
  final VoidCallback? onTap;

  const PlayerTile({
    super.key,
    required this.name,
    required this.subtitle,
    required this.ready,
    this.avatar,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: ready
            ? AvatarView(avatar: avatar, name: name)
            : const CircleAvatar(child: Icon(Icons.person_outline)),
        title: Text(name),
        subtitle: Text(subtitle),
        onTap: onTap,
        trailing: Icon(
          ready ? Icons.check_circle : Icons.hourglass_empty,
          color: ready ? Colors.greenAccent : Colors.white38,
        ),
      ),
    );
  }
}

class GarbaButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const GarbaButton({
    super.key,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 58,
      child: FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFD4A94F),
          foregroundColor: Colors.black,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

// Плитка главного экрана: значок и подпись; badge — число на уголке (заявки в друзья).
class HomeTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final int badge;

  const HomeTile({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.badge = 0,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 92,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            child: FilledButton(
              onPressed: onTap,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFD4A94F),
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 30),
                  const SizedBox(height: 6),
                  Text(
                    label,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, height: 1.1),
                  ),
                ],
              ),
            ),
          ),
          if (badge > 0)
            Positioned(
              right: 8,
              top: 8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.redAccent,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$badge',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 12),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// Смайлики (RULES.md §14, с 25.09.2026 — в любой момент): кнопка у стола открывает набор,
// выбранный смайлик всплывает на аватарке отправившего у всех за столом.
// С 10.10.2026 фразы — отдельной кнопкой 💬 над смайликами; смайлики — всегда 6 в ряд,
// фразы — 2 в ряд, чтобы на любом телефоне набор выглядел одинаково.
class EmojiButton extends StatelessWidget {
  final void Function(String emoji) onSend;

  const EmojiButton({super.key, required this.onSend});

  static const _gold = Color(0xFFD4A94F);

  void _open(BuildContext context, Widget Function(BuildContext sheet) body) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF13232E),
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 16, 12, 12),
          child: body(sheet),
        ),
      ),
    );
  }

  // Таблица: ровно [columns] в ряд, ячейки равной ширины.
  static Widget _grid(int columns, double gap, List<Widget> items) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < items.length; i += columns)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : gap),
            child: Row(
              children: [
                for (var j = i; j < i + columns; j++) ...[
                  if (j > i) SizedBox(width: gap),
                  Expanded(child: j < items.length ? items[j] : const SizedBox()),
                ],
              ],
            ),
          ),
      ],
    );
  }

  // Заголовок купленного набора в окне.
  static Widget _packTitle(String text) => Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 6),
        child: Text(text,
            style: const TextStyle(color: _gold, fontSize: 12, fontWeight: FontWeight.w900, letterSpacing: 1.2)),
      );

  // Не купленные наборы — одной строкой: где их взять.
  static Widget _shopHint(List<String> names) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Text(
          '🔒 ${names.join(', ')} — в МАГАЗИНЕ на главном экране',
          textAlign: TextAlign.center,
          style: const TextStyle(color: Colors.white54, fontSize: 13),
        ),
      );

  Widget _emojiCell(BuildContext sheet, String emoji) => InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () {
          Navigator.pop(sheet);
          onSend(emoji);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Center(
            child: FittedBox(child: Text(emoji, style: const TextStyle(fontSize: 28))),
          ),
        ),
      );

  void _openEmojis(BuildContext context) => _open(
        context,
        (sheet) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _grid(6, 4, [for (final emoji in tableReactions) _emojiCell(sheet, emoji)]),
            if (ShopState.has('pack_troll')) ...[
              _packTitle('ТРОЛЛЬ'),
              _grid(6, 4, [for (final emoji in packTroll) _emojiCell(sheet, emoji)]),
            ],
            if (ShopState.has('pack_mazak')) ...[
              _packTitle('НАСМЕШКА'),
              _grid(3, 6, [
                for (final entry in stickerAssets.entries)
                  InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () {
                      Navigator.pop(sheet);
                      onSend(entry.key);
                    },
                    child: Image.asset(shopAsset(entry.value), height: 76),
                  ),
              ]),
            ],
            if (!ShopState.has('pack_troll') || !ShopState.has('pack_mazak'))
              _shopHint([
                if (!ShopState.has('pack_troll')) 'Тролль',
                if (!ShopState.has('pack_mazak')) 'стикеры «Насмешка»',
              ]),
          ],
        ),
      );

  void _openPhrases(BuildContext context) => _open(
        context,
        (sheet) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _phraseGrid(sheet, tablePhrases, const Color(0xFF1C3442)),
            // Купленные наборы фраз (§17): «Подкол», «Воин», «Воин 2».
            for (final pack in phrasePacks.entries)
              if (ShopState.has(pack.key)) ...[
                _packTitle(pack.value.title),
                _phraseGrid(sheet, pack.value.phrases, pack.value.color),
              ],
            if (phrasePacks.keys.any((id) => !ShopState.has(id)))
              _shopHint([
                if (!ShopState.has('pack_podkol')) 'Фразы-подколы',
                if (!ShopState.has('pack_voin')) '«Воин»',
                if (!ShopState.has('pack_voin2')) '«Воин 2»',
              ]),
          ],
        ),
      );

  Widget _phraseGrid(BuildContext sheet, List<String> phrases, Color color) => _grid(2, 8, [
          for (final phrase in phrases)
            InkWell(
              borderRadius: BorderRadius.circular(22),
              onTap: () {
                Navigator.pop(sheet);
                onSend(phrase);
              },
              child: Container(
                height: 44,
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: _gold),
                ),
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(phrase, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                ),
              ),
            ),
        ]);

  static Widget _circle(String icon, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 46,
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: const Color(0xE60B1620),
            border: Border.all(color: _gold, width: 1.5),
            boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 8)],
          ),
          child: Text(icon, style: const TextStyle(fontSize: 22)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        _circle('💬', () => _openPhrases(context)),
        const SizedBox(height: 8),
        _circle('😊', () => _openEmojis(context)),
      ],
    );
  }
}

// Готовая фраза облачком над аватаркой: выпрыгивает и держится 4 секунды (09.10.2026).
class PhraseBubble extends StatelessWidget {
  final String text;

  const PhraseBubble({super.key, required this.text});

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.2, end: 1),
      duration: const Duration(milliseconds: 500),
      curve: Curves.elasticOut,
      builder: (_, scale, child) => Transform.scale(scale: scale, child: child),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFD4A94F), width: 1.5),
          boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 8)],
        ),
        child: Text(
          text,
          maxLines: 1,
          style: const TextStyle(
            color: Color(0xFF0B1620),
            fontSize: 13,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }
}

// Смайлик поверх аватарки: выпрыгивает и держится, пока его не уберут (3 секунды).
class AvatarEmoji extends StatelessWidget {
  final String emoji;
  final double size;

  const AvatarEmoji({super.key, required this.emoji, this.size = 30});

  @override
  Widget build(BuildContext context) {
    // Стикер «Насмешка» из магазина (§17) — картинкой художника, крупнее аватарки.
    final sticker = stickerAssets[emoji];
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.2, end: 1),
      duration: const Duration(milliseconds: 500),
      curve: Curves.elasticOut,
      builder: (_, scale, child) => Transform.scale(scale: scale, child: child),
      child: sticker != null
          ? OverflowBox(
              // Стикер растёт вверх от аватарки — имя под ней остаётся видно.
              alignment: Alignment.bottomCenter,
              maxWidth: size * 2.6,
              maxHeight: size * 2.6,
              child: Image.asset(shopAsset(sticker), width: size * 2.6, height: size * 2.6),
            )
          : Container(
              alignment: Alignment.center,
              decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xCC0B1620)),
              child: Text(emoji, style: TextStyle(fontSize: size)),
            ),
    );
  }
}

// Позвать друзей в комнату (25.09.2026): список «Друзья», у каждого — «ПОЗВАТЬ».
// Друг увидит приглашение у себя на главном экране. Решает сервер (друг ли, есть ли место).
Future<void> showFriendInviteSheet(BuildContext context, String roomCode) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: const Color(0xFF13232E),
    isScrollControlled: true,
    builder: (_) => FriendInviteSheet(roomCode: roomCode),
  );
}

class FriendInviteSheet extends StatefulWidget {
  final String roomCode;
  const FriendInviteSheet({super.key, required this.roomCode});

  @override
  State<FriendInviteSheet> createState() => _FriendInviteSheetState();
}

class _FriendInviteSheetState extends State<FriendInviteSheet> {
  List<Map<String, dynamic>>? friends;
  final invited = <String>{};
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/friends'), headers: authHeaders());
      expectStatus(response, const [200]);
      final list = ((jsonDecode(response.body) as Map)['friends'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      if (mounted) setState(() => friends = list);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  Future<void> invite(String code) async {
    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${widget.roomCode}/invite'),
        headers: authHeaders(),
        body: jsonEncode({'code': code}),
      );
      expectStatus(response, const [200]);
      if (mounted) setState(() => invited.add(code));
    } catch (e) {
      if (mounted) showGarbaError(context, e, prefix: 'Не удалось позвать');
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = friends;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.6),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Позвать друзей',
                  textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              const Text('Друг увидит приглашение на главном экране ГАРБЫ',
                  textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, fontSize: 12)),
              const SizedBox(height: 12),
              if (error != null)
                Text(error!, textAlign: TextAlign.center)
              else if (list == null)
                const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
              else if (list.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Друзей пока нет — добавьте их в разделе «ДРУЗЬЯ»',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.white70)),
                )
              else
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final f in list)
                        () {
                          final code = f['code'].toString();
                          final busyRoom = f['roomId']?.toString();
                          final here = busyRoom == widget.roomCode;
                          final busy = busyRoom != null && !here;
                          return ListTile(
                            leading: AvatarView(avatar: f['avatar']?.toString(), name: f['name'].toString(), radius: 20, frame: f['frame']?.toString()),
                            title: Text(f['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w800)),
                            subtitle: Text(here ? 'уже за этим столом' : busy ? 'сейчас в другой игре' : '⭐ ${fmtRating(f['rating'])}'),
                            trailing: FilledButton(
                              onPressed: here || busy || invited.contains(code) ? null : () => invite(code),
                              child: Text(invited.contains(code) ? 'ПОЗВАЛИ' : 'ПОЗВАТЬ'),
                            ),
                          );
                        }(),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// Тренировка с ботами (решение владельца, 28.09.2026): за столом боты сервера, монеты,
// рейтинг и статистика не меняются. В лобби — плашка с пояснением, за столом — метка.
class PracticeBanner extends StatelessWidget {
  const PracticeBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0x3342A5F5),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0x8842A5F5)),
      ),
      child: const Text(
        'ТРЕНИРОВКА С БОТАМИ — монеты, рейтинг и статистика не меняются',
        style: TextStyle(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class PracticeChip extends StatelessWidget {
  const PracticeChip({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0x3342A5F5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Text(
        'ТРЕНИРОВКА',
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Color(0xFF90CAF9)),
      ),
    );
  }
}

// Комнаты больше нет: закрылась, пока приложение было свёрнуто, и сервер её уже
// выгрузил (404 / room_error), или за столом не осталось никого (28.09.2026).
class RoomClosedScreen extends StatelessWidget {
  const RoomClosedScreen({super.key, this.title = 'Игра закончилась', this.text});

  final String title;
  final String? text;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Spacer(),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Text(
              text ?? 'Комната уже закрыта. Итог игры — в профиле, в статистике.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const Spacer(),
            GarbaButton(
              label: 'В ГЛАВНОЕ МЕНЮ',
              onTap: () => Navigator.of(context).popUntil((r) => r.isFirst),
            ),
          ],
        ),
      ),
    );
  }
}

// Сумма за стол (решение владельца, 09.10.2026). Перед входом в комнату игрок выбирает,
// сколько монет взять с собой: от минимума комнаты до всего баланса. За столом он играет
// только ими, остальное остаётся на балансе. Докупить за столом — только с согласия всех
// (§9.1c, 22.10.2026; TopUpDialog). Проверяет сервер (buyIn.ts) — здесь только выбор. null — передумал.
Future<int?> askBuyIn(BuildContext context, {required int minBalance}) async {
  final response = await apiRequest(http.get(Uri.parse('$apiBase/me'), headers: authHeaders()));
  expectStatus(response, const [200]);
  final balance = ((jsonDecode(response.body) as Map)['balance'] as num).toInt();
  if (balance < minBalance) {
    throw Exception('Недостаточно монет: нужно ${fmtCoins(minBalance)}, у вас ${fmtCoins(balance)}');
  }
  if (!context.mounted) return null;
  return showDialog<int>(
    context: context,
    builder: (_) => BuyInDialog(minBalance: minBalance, balance: balance),
  );
}

class BuyInDialog extends StatefulWidget {
  final int minBalance;
  final int balance;

  const BuyInDialog({super.key, required this.minBalance, required this.balance});

  @override
  State<BuyInDialog> createState() => _BuyInDialogState();
}

class _BuyInDialogState extends State<BuyInDialog> {
  // Варианты — от минимума шагом 1 000, последний — весь баланс.
  late final List<int> options = [
    for (var v = widget.minBalance; v < widget.balance; v += 1000) v,
    widget.balance,
  ];
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final amount = options[index];
    return AlertDialog(
      title: const Text('Сколько взять за стол?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const CoinIcon(size: 26),
              const SizedBox(width: 6),
              Text(fmtCoins(amount), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
            ],
          ),
          if (options.length > 1)
            Slider(
              value: index.toDouble(),
              max: (options.length - 1).toDouble(),
              divisions: options.length - 1,
              activeColor: const Color(0xFFD4A94F),
              onChanged: (v) => setState(() => index = v.round()),
            ),
          if (options.length > 1)
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                TextButton(onPressed: () => setState(() => index = 0), child: const Text('МИНИМУМ')),
                TextButton(onPressed: () => setState(() => index = options.length - 1), child: const Text('ВСЁ')),
              ],
            ),
          const SizedBox(height: 8),
          Text(
            'За столом играете только этими монетами. На балансе останется '
            '${fmtCoins(widget.balance - amount)}. Докупить за столом можно, только если '
            'согласятся все игроки.',
            style: const TextStyle(fontSize: 14, color: Colors.white70),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: () => Navigator.pop(context, amount), child: const Text('ЗА СТОЛ')),
      ],
    );
  }
}

// Докупить из кошелька за столом (§9.1c, решение владельца, 22.10.2026): сколько перенести
// на стол. Согласие всех за столом спрашивает сервер — здесь только выбор. null — передумал.
class TopUpDialog extends StatefulWidget {
  final int reserve; // сколько в кошельке — вне стола
  final int onTable; // сколько сейчас на столе
  final int suggested; // с чего начать — сумма за стол этой комнаты

  const TopUpDialog({super.key, required this.reserve, required this.onTable, required this.suggested});

  @override
  State<TopUpDialog> createState() => _TopUpDialogState();
}

class _TopUpDialogState extends State<TopUpDialog> {
  // Варианты — шагом 1 000, последний — весь кошелёк.
  late final List<int> options = [
    for (var v = 1000; v < widget.reserve; v += 1000) v,
    widget.reserve,
  ];
  late int index = () {
    final i = options.indexWhere((v) => v >= widget.suggested);
    return i < 0 ? options.length - 1 : i;
  }();

  @override
  Widget build(BuildContext context) {
    final amount = options[index];
    return AlertDialog(
      title: const Text('Докупить из кошелька'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const CoinIcon(size: 26),
              const SizedBox(width: 6),
              Text(fmtCoins(amount), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
            ],
          ),
          if (options.length > 1)
            Slider(
              value: index.toDouble(),
              max: (options.length - 1).toDouble(),
              divisions: options.length - 1,
              activeColor: const Color(0xFFD4A94F),
              onChanged: (v) => setState(() => index = v.round()),
            ),
          if (options.length > 1)
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                TextButton(onPressed: () => setState(() => index = 0), child: const Text('МИНИМУМ')),
                TextButton(onPressed: () => setState(() => index = options.length - 1), child: const Text('ВСЁ')),
              ],
            ),
          const SizedBox(height: 8),
          Text(
            'На столе станет ${fmtCoins(widget.onTable + amount)}, в кошельке останется '
            '${fmtCoins(widget.reserve - amount)}.\n'
            'Нужно согласие всех за столом: хоть один против — докупки не будет.',
            style: const TextStyle(fontSize: 14, color: Colors.white70),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: () => Navigator.pop(context, amount), child: const Text('ПОПРОСИТЬ')),
      ],
    );
  }
}

// Сообщение всем за столом, когда выигравший отдал часть выигрыша (RULES.md §11.8), двумя
// частями: «Серик выиграл 10k монет» и «и отдал 500 монет игроку Аян». «Игроку» — чтобы
// не склонять имя: Асель, Мадина, Бот Айдар склоняются по-разному.
({String won, String gave}) winShareText(Map<String, dynamic> share) => (
      won: '${share['fromName']} выиграл ${fmtCoins((share['won'] as num?)?.toInt() ?? 0)} монет',
      gave: 'и отдал ${fmtCoins((share['amount'] as num?)?.toInt() ?? 0)} монет игроку ${share['toName']}',
    );

// Отдать часть выигрыша другому игроку (RULES.md §11.8, 22.10.2026): кому — любому за столом,
// сколько — от взноса стола до 10% выигрыша, шагом 100. Ответ — кому и сколько, или null.
class ShareDialog extends StatefulWidget {
  final int won; // сколько выиграл в этой раздаче
  final int min; // взнос стола — меньше отдать нельзя
  final int max; // 10% выигрыша — больше отдать нельзя
  final List<({String id, String name})> players; // кому можно отдать — все за столом, кроме меня

  const ShareDialog({
    super.key,
    required this.won,
    required this.min,
    required this.max,
    required this.players,
  });

  @override
  State<ShareDialog> createState() => _ShareDialogState();
}

class _ShareDialogState extends State<ShareDialog> {
  late final List<int> options = [
    for (var v = widget.min; v <= widget.max; v += 100) v,
  ];
  int index = 0;
  String? toId;

  @override
  Widget build(BuildContext context) {
    final amount = options[index];
    return AlertDialog(
      title: const Text('Отдать часть выигрыша'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Вы выиграли ${fmtCoins(widget.won)}. Отдать можно '
              '${widget.min == widget.max ? fmtCoins(widget.min) : 'от ${fmtCoins(widget.min)} до ${fmtCoins(widget.max)}'}: '
              'не меньше взноса стола и не больше 10% выигрыша. Монеты уходят сразу, вернуть их нельзя.',
              style: const TextStyle(fontSize: 14, color: Colors.white70),
            ),
            const SizedBox(height: 12),
            const Text('Кому', style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final p in widget.players)
                  ChoiceChip(
                    label: Text(p.name),
                    selected: toId == p.id,
                    onSelected: (_) => setState(() => toId = p.id),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const CoinIcon(size: 26),
                const SizedBox(width: 6),
                Text(fmtCoins(amount), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
              ],
            ),
            if (options.length > 1)
              Slider(
                value: index.toDouble(),
                max: (options.length - 1).toDouble(),
                divisions: options.length - 1,
                activeColor: const Color(0xFFD4A94F),
                onChanged: (v) => setState(() => index = v.round()),
              ),
            if (options.length > 1)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(onPressed: () => setState(() => index = 0), child: const Text('МИНИМУМ')),
                  TextButton(onPressed: () => setState(() => index = options.length - 1), child: const Text('10%')),
                ],
              ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ОТМЕНА')),
        FilledButton(
          onPressed: toId == null ? null : () => Navigator.pop(context, (toId: toId!, amount: amount)),
          child: const Text('ОТДАТЬ'),
        ),
      ],
    );
  }
}

// Мои монеты и рейтинг за столом (просьба владельца, 09.10.2026): сколько взял за стол,
// сколько всего (на столе + вне стола) и рейтинг — одной плашкой над столом.
// null — я не сижу в этой комнате, плашки нет.
Widget? myWalletBar(Map<String, dynamic> room) {
  final players = (room['players'] as List?) ?? const [];
  final me = players.cast<Map>().where((p) => p['id']?.toString() == Session.id).firstOrNull;
  if (me == null) return null;
  final onTable = (me['balance'] as num?)?.toInt() ?? 0;
  final total = onTable + ((room['myReserve'] as num?)?.toInt() ?? 0);
  return WalletBar(onTable: onTable, total: total, rating: me['rating']);
}

class WalletBar extends StatelessWidget {
  final int onTable;
  final int total;
  final Object? rating;

  const WalletBar({super.key, required this.onTable, required this.total, this.rating});

  static const gold = Color(0xFFD4A94F);

  Widget part(Widget icon, String value, String label) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          icon,
          const SizedBox(width: 5),
          Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Colors.white)),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.white60)),
        ],
      );

  Widget divider() => Container(
        width: 1,
        height: 16,
        margin: const EdgeInsets.symmetric(horizontal: 10),
        color: gold.withValues(alpha: 0.35),
      );

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [Color(0xFF1A2C3A), Color(0xFF0E1A24)]),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: gold.withValues(alpha: 0.7)),
        ),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              part(const CoinIcon(size: 16), fmtCoins(onTable), 'на столе'),
              divider(),
              part(const Icon(Icons.account_balance_wallet, size: 16, color: gold), fmtCoins(total), 'всего'),
              divider(),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.star_rounded, size: 18, color: Color(0xFFFFC83D)),
                  const SizedBox(width: 5),
                  RatingText(rating, fontSize: 15, star: false),
                  const SizedBox(width: 4),
                  const Text('рейтинг', style: TextStyle(fontSize: 11, color: Colors.white60)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// Рейтинг цветом по уровню: «⭐ 6.2» (09.10.2026, ratingColor в core.dart).
class RatingText extends StatelessWidget {
  final Object? rating;
  final double fontSize;
  final bool star;

  const RatingText(this.rating, {super.key, this.fontSize = 14, this.star = true});

  @override
  Widget build(BuildContext context) {
    return Text(
      '${star ? '⭐ ' : ''}${fmtRating(rating)}',
      maxLines: 1,
      style: TextStyle(
        fontSize: fontSize,
        fontWeight: FontWeight.w900,
        color: ratingColor(rating),
      ),
    );
  }
}

// «За столом: один игрок фиолетового уровня» — в лобби, цветом уровня (11.10.2026).
// null — цветных уровней за столом нет.
Widget? levelsBanner(List players) {
  final lines = strongLevels(players);
  if (lines.isEmpty) return null;
  return Center(
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xE0101820),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: lines.first.color),
      ),
      child: Text.rich(
        TextSpan(
          style: const TextStyle(fontSize: 13, color: Colors.white),
          children: [
            const TextSpan(text: 'За столом '),
            for (final (i, line) in lines.indexed) ...[
              if (i > 0) const TextSpan(text: ', '),
              TextSpan(text: line.text, style: TextStyle(fontWeight: FontWeight.w900, color: line.color)),
            ],
          ],
        ),
        textAlign: TextAlign.center,
      ),
    ),
  );
}
