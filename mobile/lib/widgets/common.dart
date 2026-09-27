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
class EmojiButton extends StatelessWidget {
  final void Function(String emoji) onSend;

  const EmojiButton({super.key, required this.onSend});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(0xFF13232E),
        builder: (sheet) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 16, 12, 12),
            child: Wrap(
              alignment: WrapAlignment.center,
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final emoji in tableReactions)
                  InkWell(
                    borderRadius: BorderRadius.circular(28),
                    onTap: () {
                      Navigator.pop(sheet);
                      onSend(emoji);
                    },
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Text(emoji, style: const TextStyle(fontSize: 34)),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      child: Container(
        width: 46,
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: const Color(0xE60B1620),
          border: Border.all(color: const Color(0xFFD4A94F), width: 1.5),
          boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 8)],
        ),
        child: const Text('😊', style: TextStyle(fontSize: 24)),
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
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.2, end: 1),
      duration: const Duration(milliseconds: 500),
      curve: Curves.elasticOut,
      builder: (_, scale, child) => Transform.scale(scale: scale, child: child),
      child: Container(
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
                            leading: AvatarView(avatar: f['avatar']?.toString(), name: f['name'].toString(), radius: 20),
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
