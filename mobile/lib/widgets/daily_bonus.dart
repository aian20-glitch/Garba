// Окно ежедневного бонуса (26.10.2026): семь дней серии, сегодняшний подсвечен,
// взятые — с галочкой, 7-й день — большой подарок. Суммы по дням присылает сервер
// (days в ответе /me/daily-bonus): каждый день 10 000, на 7-й — 50 000.
part of '../main.dart';

// Если сервер старый и days не прислал — те же суммы, что в bonus.ts.
const dailyBonusFallback = [10000, 10000, 10000, 10000, 10000, 10000, 50000];

// 50000 → «50 000».
String fmtFullCoins(int value) {
  final s = value.abs().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(' ');
    b.write(s[i]);
  }
  return b.toString();
}

class DailyBonusDialog extends StatefulWidget {
  final int streak; // какой сегодня день серии, 1…7
  final int amount; // сколько начислили
  final List<int> days; // монеты за дни 1…7

  const DailyBonusDialog({
    super.key,
    required this.streak,
    required this.amount,
    required this.days,
  });

  @override
  State<DailyBonusDialog> createState() => _DailyBonusDialogState();
}

class _DailyBonusDialogState extends State<DailyBonusDialog> with SingleTickerProviderStateMixin {
  static const gold = Color(0xFFD4A94F);
  static const goldLight = Color(0xFFF3D27A);

  // Сегодняшний день «дышит».
  late final AnimationController pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    pulse.dispose();
    super.dispose();
  }

  int dayAmount(int day) => day - 1 < widget.days.length ? widget.days[day - 1] : dailyBonusFallback[day - 1];

  Widget dayCell(int day) {
    final today = day == widget.streak;
    final taken = day < widget.streak;
    final big = day == 7;

    final cell = Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      decoration: BoxDecoration(
        gradient: today
            ? const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [goldLight, gold],
              )
            : null,
        color: today
            ? null
            : big
                ? gold.withValues(alpha: 0.12)
                : Colors.white.withValues(alpha: taken ? 0.10 : 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: today
              ? goldLight
              : big
                  ? gold.withValues(alpha: 0.7)
                  : taken
                      ? Colors.greenAccent.withValues(alpha: 0.5)
                      : Colors.white12,
          width: today ? 2 : 1,
        ),
      ),
      child: SizedBox(
        width: double.infinity,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'ДЕНЬ $day',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
                color: today ? const Color(0xFF2A1A05) : Colors.white70,
              ),
            ),
            const SizedBox(height: 4),
            // Взятый день — галочка вместо монеты.
            Icon(
              taken
                  ? Icons.check_circle_rounded
                  : big
                      ? Icons.redeem_rounded
                      : Icons.monetization_on_rounded,
              size: big ? 34 : 26,
              color: today
                  ? const Color(0xFF5A3A08)
                  : taken
                      ? Colors.greenAccent.withValues(alpha: 0.8)
                      : gold,
            ),
            const SizedBox(height: 4),
            Text(
              fmtFullCoins(dayAmount(day)),
              maxLines: 1,
              style: TextStyle(
                fontSize: big ? 16 : 13,
                fontWeight: FontWeight.w900,
                color: today
                    ? const Color(0xFF2A1A05)
                    : taken
                        ? Colors.white38
                        : Colors.white,
              ),
            ),
          ],
        ),
      ),
    );

    if (!today) return cell;
    return AnimatedBuilder(
      animation: pulse,
      builder: (_, c) => Transform.scale(
        scale: 1 + 0.05 * Curves.easeInOut.transform(pulse.value),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(
                color: gold.withValues(alpha: 0.35 + 0.35 * pulse.value),
                blurRadius: 10 + 10 * pulse.value,
              ),
            ],
          ),
          child: c,
        ),
      ),
      child: cell,
    );
  }

  Widget row(List<int> days, {Map<int, int> flex = const {}}) => Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < days.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(flex: flex[days[i]] ?? 1, child: dayCell(days[i])),
          ],
        ],
      );

  @override
  Widget build(BuildContext context) {
    final streak = widget.streak;
    final week = streak == 7;
    final next = week ? 1 : streak + 1;

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16),
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.6, end: 1),
        duration: const Duration(milliseconds: 600),
        curve: Curves.elasticOut,
        builder: (_, scale, c) => Transform.scale(scale: scale, child: c),
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
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
                const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    KazakhHorn(size: 22),
                    SizedBox(width: 6),
                    Flexible(
                      child: FittedBox(
                        child: Text(
                          'ЕЖЕДНЕВНЫЙ БОНУС',
                          style: TextStyle(
                            fontSize: 20,
                            letterSpacing: 1.5,
                            fontWeight: FontWeight.w900,
                            color: gold,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  week ? '7 дней подряд!' : 'День $streak из 7',
                  style: const TextStyle(fontSize: 14, color: Colors.white70),
                ),
                const SizedBox(height: 12),
                // Сумма отсчитывается от нуля.
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: widget.amount.toDouble()),
                  duration: const Duration(milliseconds: 1200),
                  curve: Curves.easeOut,
                  builder: (_, v, __) => Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const CoinIcon(size: 34),
                      const SizedBox(width: 6),
                      Text(
                        '+${fmtFullCoins(v.round())}',
                        style: const TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w900,
                          color: goldLight,
                          shadows: [Shadow(color: Colors.black, blurRadius: 6)],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                IntrinsicHeight(child: row(const [1, 2, 3, 4])),
                const SizedBox(height: 8),
                IntrinsicHeight(child: row(const [5, 6, 7], flex: const {7: 2})),
                const SizedBox(height: 14),
                Text(
                  week
                      ? 'Серия собрана! Завтра — снова день 1: +${fmtFullCoins(dayAmount(1))}'
                      : 'Завтра — день $next: +${fmtFullCoins(dayAmount(next))}\n'
                          'Пропустите день — серия начнётся заново',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 13, color: Colors.white60, height: 1.35),
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: gold,
                      foregroundColor: const Color(0xFF2A1A05),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: () => Navigator.pop(context),
                    child: const Text(
                      'ЗАБРАТЬ',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, letterSpacing: 1.5),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
