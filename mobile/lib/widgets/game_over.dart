// Окно итога всей игры: кто сколько выиграл и как изменился рейтинг (09.10.2026).
part of '../main.dart';

// Строка итога: монеты за игру и рейтинг до и после; left — ушёл посреди игры.
typedef GameOverLine = ({
  String id,
  String name,
  int diff,
  double ratingStart,
  double ratingEnd,
  bool left,
});

// Все, кто играл в этой комнате: кто за столом и кто ушёл посреди игры (сервер помнит
// его итог на момент ухода — departedPlayers, 11.10.2026). У ушедших — left: true.
List<Map<String, dynamic>> playersForResults(Map<String, dynamic> room) => [
      for (final p in (room['players'] as List?) ?? const [])
        Map<String, dynamic>.from(p as Map),
      for (final p in (room['departedPlayers'] as List?) ?? const [])
        {...Map<String, dynamic>.from(p as Map), 'left': true},
    ];

// Всплывает поверх стола, когда комната закрылась. Строки — от большего выигрыша
// к меньшему. Лучшего (§36) называет сервер в winnerIds — его строка золотая, с кубком.
class GameOverPopup extends StatelessWidget {
  final List<GameOverLine> lines;
  final Set<String> winnerIds;
  final String myId;
  final bool practice;
  final VoidCallback onClose;
  // Почему игра закончилась, если стоит сказать (вышло время стола, §20), — под заголовком.
  final String? reason;

  const GameOverPopup({
    super.key,
    required this.lines,
    required this.winnerIds,
    required this.myId,
    required this.practice,
    required this.onClose,
    this.reason,
  });

  static const gold = Color(0xFFD4A94F);

  Widget appear(int i, Widget child) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 500 + 300 * i),
      curve: Interval(i == 0 ? 0 : (300 * i) / (500 + 300 * i), 1, curve: Curves.easeOutBack),
      builder: (_, t, c) => Opacity(
        opacity: t.clamp(0.0, 1.0),
        child: Transform.translate(offset: Offset(0, 16 * (1 - t)), child: c),
      ),
      child: child,
    );
  }

  Widget line(int i, GameOverLine r) {
    final isWinner = winnerIds.contains(r.id);
    final isMe = r.id == myId;
    final change = ((r.ratingEnd - r.ratingStart) * 10).round() / 10;
    final changeColor = change > 0
        ? Colors.greenAccent
        : change < 0
            ? Colors.redAccent
            : Colors.white60;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: EdgeInsets.symmetric(horizontal: 10, vertical: isWinner ? 12 : 8),
      decoration: BoxDecoration(
        color: isWinner ? gold.withValues(alpha: 0.22) : Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isWinner ? gold : isMe ? Colors.white54 : Colors.white12,
          width: isWinner ? 2 : 1,
        ),
        boxShadow: isWinner
            ? [BoxShadow(color: gold.withValues(alpha: 0.45), blurRadius: 16)]
            : null,
      ),
      child: Row(
        children: [
          SizedBox(
            width: 30,
            child: Text(
              isWinner ? '🏆' : '${i + 1}',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: isWinner ? 22 : 15,
                fontWeight: FontWeight.w900,
                color: Colors.white60,
              ),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isMe ? '${r.name} (вы)' : r.name,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: isWinner ? 18 : 15,
                    fontWeight: FontWeight.w900,
                    color: isWinner ? gold : Colors.white,
                  ),
                ),
                if (r.left)
                  const Text(
                    'ВЫШЕЛ ИЗ ИГРЫ',
                    style: TextStyle(
                      fontSize: 10,
                      letterSpacing: 1,
                      fontWeight: FontWeight.w900,
                      color: Colors.white54,
                    ),
                  ),
                if (isWinner)
                  const Text(
                    'ВЫИГРАЛ БОЛЬШЕ ВСЕХ',
                    style: TextStyle(
                      fontSize: 10,
                      letterSpacing: 1,
                      fontWeight: FontWeight.w900,
                      color: gold,
                    ),
                  ),
                if (!practice)
                  Text(
                    'Рейтинг ${fmtRating(r.ratingStart)} → ${fmtRating(r.ratingEnd)} '
                    '(${change > 0 ? '+' : change < 0 ? '−' : ''}${change.abs().toStringAsFixed(1)})',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: changeColor),
                  ),
              ],
            ),
          ),
          // Сумма отсчитывается от нуля.
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: r.diff.toDouble()),
            duration: Duration(milliseconds: 1200 + 300 * i),
            curve: Curves.easeOut,
            builder: (_, v, __) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CoinIcon(size: 16),
                const SizedBox(width: 4),
                Text(
                  fmtDelta(v.round()),
                  style: TextStyle(
                    fontSize: isWinner ? 19 : 16,
                    fontWeight: FontWeight.w900,
                    color: r.diff > 0
                        ? Colors.greenAccent
                        : r.diff < 0
                            ? Colors.redAccent
                            : Colors.white70,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onClose,
      child: Container(
        color: Colors.black54,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(12),
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.6, end: 1),
          duration: const Duration(milliseconds: 600),
          curve: Curves.elasticOut,
          builder: (_, scale, c) => Transform.scale(scale: scale, child: c),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            decoration: BoxDecoration(
              color: const Color(0xF20B1620),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: gold, width: 2),
              boxShadow: const [BoxShadow(color: Colors.black87, blurRadius: 24)],
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'ИТОГИ ИГРЫ',
                    style: TextStyle(
                      fontSize: 20,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w900,
                      color: gold,
                    ),
                  ),
                  if (reason != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        reason!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 13, color: Colors.white70),
                      ),
                    ),
                  if (practice)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text(
                        'Тренировка — монеты и рейтинг в аккаунте не изменились',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 12, color: Colors.white60),
                      ),
                    ),
                  const SizedBox(height: 10),
                  for (var i = 0; i < lines.length; i++) appear(i, line(i, lines[i])),
                  const SizedBox(height: 4),
                  const Text(
                    'Нажмите, чтобы закрыть. Подробно — под столом',
                    style: TextStyle(fontSize: 12, color: Colors.white54),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
