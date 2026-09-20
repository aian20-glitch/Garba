// Карты и масти.
part of '../main.dart';

const _cardIvory = Color(0xFFFFF6DF);
const _cardIvoryDeep = Color(0xFFF1E2BE);
const _cardGold = Color(0xFFD5A33C);
const _cardRed = Color(0xFFB20D24);

BoxDecoration _garbaCardDecoration({bool glow = false}) => BoxDecoration(
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [_cardIvory, Color(0xFFF7ECD2), _cardIvoryDeep],
      ),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(
        color: glow ? const Color(0xFFF2C65D) : const Color(0xFFE4CEA0),
        width: glow ? 3 : 0.6,
      ),
      boxShadow: [
        const BoxShadow(
            color: Colors.black38, blurRadius: 5, offset: Offset(0, 2)),
        if (glow)
          const BoxShadow(
            color: Color(0x88D4A94F),
            blurRadius: 22,
            spreadRadius: 3,
          ),
      ],
    );

// Светлый золотой узор одинаков для всех рангов. Номинал и масть рисуются
// поверх него: орнамент не мешает быстро прочитать карту.
class _CardOrnamentPainter extends CustomPainter {
  const _CardOrnamentPainter();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    canvas.scale(size.width / 60, size.height / 110);
    final ink = Paint()
      ..color = const Color(0xFFD4A543).withValues(alpha: 0.24)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.65
      ..strokeCap = StrokeCap.round;
    final stem = Path()
      ..moveTo(8, 105)
      ..cubicTo(0, 78, 57, 66, 46, 40)
      ..cubicTo(35, 18, 57, 12, 49, 1);
    canvas.drawPath(stem, ink);
    for (var i = 0; i < 7; i++) {
      final t = i / 6;
      final x = 10 + 37 * t + 5 * math.sin(t * math.pi * 2);
      final y = 98 - 88 * t;
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(-0.55 + (i.isEven ? 0 : math.pi));
      canvas.scale(0.24);
      canvas.translate(-50, -50);
      canvas.drawPath(kazakhHornPath(), ink..strokeWidth = 3);
      final leaf = Path()
        ..moveTo(50, 85)
        ..cubicTo(9, 79, 4, 53, 18, 42)
        ..cubicTo(20, 68, 39, 58, 50, 85)
        ..moveTo(50, 85)
        ..cubicTo(91, 79, 96, 53, 82, 42)
        ..cubicTo(80, 68, 61, 58, 50, 85);
      canvas.drawPath(leaf, ink);
      canvas.restore();
      ink.strokeWidth = 0.65;
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _CardOrnamentPainter oldDelegate) => false;
}

// Масть без карты: символ и название, например «♥ черви».
// Светлая подложка, чтобы чёрные масти были видны на тёмном фоне.
class SuitBadge extends StatelessWidget {
  final String suit;

  const SuitBadge({super.key, required this.suit});

  @override
  Widget build(BuildContext context) {
    final color = isRedSuit(suit) ? Colors.red.shade800 : Colors.black;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        '${suitSymbol(suit)} ${suitName(suit)}',
        style: TextStyle(
          color: color,
          fontSize: 17,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class PlayingCardView extends StatelessWidget {
  final String rank;
  final String suit;
  final bool glow;

  const PlayingCardView({
    super.key,
    required this.rank,
    required this.suit,
    required this.glow,
  });

  @override
  Widget build(BuildContext context) {
    final red = isRedSuit(suit);
    final symbol = suitSymbol(suit);

    return Container(
      width: 150,
      height: 210,
      padding: const EdgeInsets.all(16),
      decoration: _garbaCardDecoration(glow: glow).copyWith(
        borderRadius: BorderRadius.circular(18),
      ),
      child: Stack(
        children: [
          const Positioned.fill(
            child: CustomPaint(painter: _CardOrnamentPainter()),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                rank,
                style: TextStyle(
                  fontSize: 40,
                  fontWeight: FontWeight.w900,
                  color: red ? _cardRed : const Color(0xFF101419),
                ),
              ),
              Text(
                symbol,
                style: TextStyle(
                  fontSize: 42,
                  color: red ? _cardRed : const Color(0xFF101419),
                ),
              ),
              // Большой значок масти занимает остаток карточки и ужимается под него.
              // Раньше тут стоял фиксированный шрифт 70 между двумя Spacer, и на
              // эмуляторе Pixel 8 карта переполнялась на 47 пикселей.
              Expanded(
                child: Center(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      symbol,
                      style: TextStyle(
                        fontSize: 70,
                        color: red ? _cardRed : const Color(0xFF101419),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SmallTrumpCard extends StatelessWidget {
  final String rank;
  final String suit;

  const SmallTrumpCard({
    super.key,
    required this.rank,
    required this.suit,
  });

  @override
  Widget build(BuildContext context) {
    final red = isRedSuit(suit);
    final symbol = suitSymbol(suit);

    return Container(
      width: 52,
      height: 64,
      padding: const EdgeInsets.all(4),
      decoration: _garbaCardDecoration().copyWith(
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            rank,
            style: TextStyle(
              color: red ? _cardRed : const Color(0xFF101419),
              fontWeight: FontWeight.w900,
              fontSize: 16,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              color: red ? _cardRed : const Color(0xFF101419),
              fontSize: 17,
            ),
          ),
        ],
      ),
    );
  }
}

class SmallCard extends StatelessWidget {
  final String rank;
  final String suit;

  const SmallCard({
    super.key,
    required this.rank,
    required this.suit,
  });

  @override
  Widget build(BuildContext context) {
    final red = isRedSuit(suit);
    final symbol = suitSymbol(suit);

    return Container(
      width: 78,
      padding: const EdgeInsets.all(9),
      decoration: _garbaCardDecoration(),
      child: Stack(
        children: [
          const Positioned.fill(
            child: CustomPaint(painter: _CardOrnamentPainter()),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                rank,
                style: TextStyle(
                  height: 0.95,
                  color: red ? _cardRed : const Color(0xFF101419),
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                symbol,
                style: TextStyle(
                  height: 1,
                  color: red ? _cardRed : const Color(0xFF101419),
                  fontSize: 27,
                ),
              ),
              const Spacer(),
              Align(
                alignment: Alignment.bottomRight,
                child: Text(
                  symbol,
                  style: TextStyle(
                    color: red ? _cardRed : const Color(0xFF101419),
                    fontSize: 34,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// Пять карт соперника веером за аватаром. Не сыгранные карты закрыты,
// а сыгранные по одной открываются слева направо.
class PlayerCardFan extends StatelessWidget {
  final List<Map<String, dynamic>> revealedCards;

  const PlayerCardFan({
    super.key,
    required this.revealedCards,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 96,
      height: 54,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          for (var index = 0; index < 5; index++)
            Positioned(
              left: 2 + index * 15,
              top: (index - 2).abs() * 2,
              child: Transform.rotate(
                angle: (index - 2) * 0.11,
                alignment: Alignment.bottomCenter,
                child: _FanCard(
                  card: index < revealedCards.length
                      ? revealedCards[index]
                      : null,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _FanCard extends StatelessWidget {
  final Map<String, dynamic>? card;

  const _FanCard({this.card});

  @override
  Widget build(BuildContext context) {
    final suit = card?['suit']?.toString();
    final red = suit != null && isRedSuit(suit);

    return Container(
      width: 32,
      height: 49,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: _cardGold,
          width: 0.8,
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black45, blurRadius: 3, offset: Offset(0, 1)),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(3),
        child: card == null
            ? Image.asset(
                'assets/branding/card_back.png',
                fit: BoxFit.cover,
              )
            : Container(
                padding: const EdgeInsets.fromLTRB(3, 2, 2, 1),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [_cardIvory, _cardIvoryDeep],
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      card!['rank'].toString(),
                      style: TextStyle(
                        height: 1,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                        color: red ? _cardRed : const Color(0xFF101419),
                      ),
                    ),
                    Text(
                      suitSymbol(suit!),
                      style: TextStyle(
                        height: 1,
                        fontSize: 13,
                        color: red ? _cardRed : const Color(0xFF101419),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

// Масштабируем исходные карты целиком; пять мест сохраняются после хода.
class PlayerHandRow extends StatelessWidget {
  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;

  const PlayerHandRow({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 4.0;
        final slots = itemCount > 5 ? itemCount : 5;
        final cardWidth = ((constraints.maxWidth - gap * (slots - 1)) / slots)
            .clamp(0.0, 70.0);
        final cardHeight = cardWidth * 128 / 78;
        return SizedBox(
          height: cardHeight,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var index = 0; index < itemCount; index++) ...[
                if (index > 0) const SizedBox(width: gap),
                SizedBox(
                  width: cardWidth,
                  height: cardHeight,
                  child: FittedBox(
                    child: SizedBox(
                      width: 78,
                      height: 128,
                      child: itemBuilder(context, index),
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

// Показывает открытие козыря по шагам. Каждая ИЗЖОГА сначала появляется
// на столе, затем визуально возвращается в колоду, и только после неё
// открывается следующая карта.
class TrumpOpeningView extends StatefulWidget {
  final List<Map<String, dynamic>> izzhoga;
  final Map<String, dynamic>? openCard;
  final String? shownSuit;
  final String suitLabel;
  final bool showOpenCard;

  const TrumpOpeningView({
    super.key,
    required this.izzhoga,
    required this.openCard,
    required this.shownSuit,
    required this.suitLabel,
    required this.showOpenCard,
  });

  @override
  State<TrumpOpeningView> createState() => _TrumpOpeningViewState();
}

class _TrumpOpeningViewState extends State<TrumpOpeningView> {
  Timer? timer;
  var index = 0;

  String get signature => [
        ...widget.izzhoga.map((c) => c['id']),
        widget.openCard?['id'],
      ].join('|');

  @override
  void initState() {
    super.initState();
    startSequence();
  }

  @override
  void didUpdateWidget(covariant TrumpOpeningView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldSignature = [
      ...oldWidget.izzhoga.map((c) => c['id']),
      oldWidget.openCard?['id'],
    ].join('|');
    if (oldSignature != signature) startSequence();
  }

  void startSequence() {
    timer?.cancel();
    index = 0;
    if (widget.izzhoga.isEmpty) return;
    // Три секунды: игрок успевает увидеть карту, прочитать причину и понять,
    // что она вернулась в колоду до открытия следующей.
    timer = Timer.periodic(const Duration(seconds: 3), (timer) {
      if (!mounted || index >= widget.izzhoga.length) {
        timer.cancel();
        return;
      }
      setState(() => index++);
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final showingIzzhoga = index < widget.izzhoga.length;
    final card = showingIzzhoga
        ? widget.izzhoga[index]
        : widget.showOpenCard
            ? widget.openCard
            : null;

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 650),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(scale: animation, child: child),
      ),
      child: Column(
        key: ValueKey('${card?['id']}-$showingIzzhoga'),
        mainAxisSize: MainAxisSize.min,
        children: [
          if (card != null)
            SmallTrumpCard(
              rank: card['rank'].toString(),
              suit: card['suit'].toString(),
            ),
          if (showingIzzhoga) ...[
            const SizedBox(height: 3),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFC62828),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'ИЗЖОГА  ↩  В КОЛОДУ',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ] else if (widget.openCard == null && widget.izzhoga.isNotEmpty)
            const Text(
              'ТРИ ИЗЖОГИ · ПЕРЕСДАЧА',
              style: TextStyle(
                color: Colors.redAccent,
                fontSize: 10,
                fontWeight: FontWeight.w900,
              ),
            )
          else if (widget.shownSuit != null) ...[
            const SizedBox(height: 3),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: const Color(0xFFF4EFE2),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFD4A94F), width: 1.5),
              ),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${widget.suitLabel} ',
                      style: const TextStyle(color: Colors.black87),
                    ),
                    TextSpan(
                      text: suitSymbol(widget.shownSuit!),
                      style: TextStyle(
                        fontSize: 15,
                        color: isRedSuit(widget.shownSuit!)
                            ? Colors.red.shade800
                            : Colors.black,
                      ),
                    ),
                  ],
                ),
                style:
                    const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
