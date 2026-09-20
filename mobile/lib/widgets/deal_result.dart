// Окно итога раздачи и надпись «ГАРБА!».
part of '../main.dart';

// «1 взятку», «2 взятки», «5 взяток».
String tricksText(int n) {
  final mod10 = n % 10, mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n взятку';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return '$n взятки';
  return '$n взяток';
}

// Окно итога раздачи с анимацией: всплывает, строки главных появляются по очереди,
// суммы отсчитываются, монета летит из кона к выигравшему или от проигравшего в кон.
class DealResultPopup extends StatelessWidget {
  final List<({String name, String label, String how, bool won, int delta})> lines;
  final bool garba;
  final int? konBefore;
  final int konAfter;
  final String? redealText;
  final String nextDealer;
  final VoidCallback onClose;

  const DealResultPopup({
    super.key,
    required this.lines,
    required this.garba,
    required this.konBefore,
    required this.konAfter,
    required this.redealText,
    required this.nextDealer,
    required this.onClose,
  });

  static const gold = Color(0xFFD4A94F);

  // Появление с задержкой: i-я часть окна начинает двигаться позже предыдущей.
  Widget appear(int i, Widget child) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 500 + 450 * i),
      curve: Interval(i == 0 ? 0 : (450 * i) / (500 + 450 * i), 1, curve: Curves.easeOutBack),
      builder: (_, t, c) => Opacity(
        opacity: t.clamp(0.0, 1.0),
        child: Transform.translate(offset: Offset(0, 16 * (1 - t)), child: c),
      ),
      child: child,
    );
  }

  // Монета летит слева направо: из кона к игроку или от игрока в кон.
  Widget flyingCoin(String from, String to, int i) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(from, style: const TextStyle(fontSize: 12, color: Colors.white70)),
        SizedBox(
          width: 70,
          height: 22,
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: Duration(milliseconds: 1400 + 450 * i),
            curve: Interval((450 * i + 400) / (1400 + 450 * i), 1, curve: Curves.easeInOut),
            builder: (_, t, __) => Align(
              alignment: Alignment(-1 + 2 * t, 0),
              child: const CoinIcon(size: 18),
            ),
          ),
        ),
        Text(to, style: const TextStyle(fontSize: 12, color: Colors.white70)),
      ],
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
                  Text(
                    redealText != null ? 'ПЕРЕСДАЧА' : 'ИТОГ РАЗДАЧИ',
                    style: const TextStyle(
                      fontSize: 13,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w900,
                      color: gold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (garba) const GarbaBanner(),
                  if (redealText != null)
                    appear(
                      0,
                      Text(
                        redealText!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                    ),
                  for (var i = 0; i < lines.length; i++) ...[
                    appear(
                      i,
                      Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: (lines[i].won ? Colors.greenAccent : Colors.redAccent)
                              .withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: lines[i].won ? Colors.greenAccent : Colors.redAccent,
                          ),
                        ),
                        child: Column(
                          children: [
                            Text(
                              '${lines[i].name} сказал ${lines[i].label}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                            ),
                            Text(
                              lines[i].how,
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 13, color: Colors.white70),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              lines[i].won ? 'ВЫИГРАЛ' : 'ПРОИГРАЛ',
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w900,
                                color: lines[i].won ? Colors.greenAccent : Colors.redAccent,
                              ),
                            ),
                            // Сумма отсчитывается от нуля.
                            TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0, end: lines[i].delta.abs().toDouble()),
                              duration: Duration(milliseconds: 1200 + 450 * i),
                              curve: Curves.easeOut,
                              builder: (_, v, __) => Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    lines[i].won ? 'забрал из кона ' : 'положил в кон ',
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                                  ),
                                  const CoinIcon(size: 17),
                                  const SizedBox(width: 4),
                                  Text(
                                    '${lines[i].won ? '+' : ''}${fmtCoins(v.round())}',
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                                  ),
                                ],
                              ),
                            ),
                            lines[i].won
                                ? flyingCoin('КОН', lines[i].name, i)
                                : flyingCoin(lines[i].name, 'КОН', i),
                          ],
                        ),
                      ),
                    ),
                  ],
                  // Кон до и после — число меняется на глазах.
                  if (konBefore != null && redealText == null)
                    TweenAnimationBuilder<double>(
                      tween: Tween(begin: konBefore!.toDouble(), end: konAfter.toDouble()),
                      duration: Duration(milliseconds: 1400 + 450 * lines.length),
                      curve: Curves.easeInOut,
                      builder: (_, v, __) => Text(
                        'КОН ${fmtCoins(konBefore!)} → ${fmtCoins(v.round())}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                          color: gold,
                        ),
                      ),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    'Раздаёт $nextDealer · нажмите, чтобы закрыть',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 11, color: Colors.white54),
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

class GarbaBanner extends StatelessWidget {
  const GarbaBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.3, end: 1),
      duration: const Duration(milliseconds: 900),
      curve: Curves.elasticOut,
      builder: (_, scale, child) => Transform.scale(scale: scale, child: child),
      child: const Padding(
        padding: EdgeInsets.only(bottom: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'ГАРБА!',
              style: TextStyle(
                fontSize: 44,
                fontWeight: FontWeight.w900,
                color: Color(0xFFD4A94F),
                shadows: [Shadow(color: Color(0xAAD4A94F), blurRadius: 24)],
              ),
            ),
            Text(
              'Дама, король и туз козыря — без розыгрыша',
              style: TextStyle(color: Colors.white70, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}
