// Общие элементы: строка игрока, кнопка.
part of '../main.dart';

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
