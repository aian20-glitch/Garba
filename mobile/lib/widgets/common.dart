// Общие элементы: строка игрока, кнопка, плитка главного экрана.
part of '../main.dart';

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
