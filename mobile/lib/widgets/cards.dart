// Карты и масти.
part of '../main.dart';

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
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: glow ? const Color(0xFFD4A94F) : Colors.white30,
          width: glow ? 4 : 1,
        ),
        boxShadow: glow
            ? const [
                BoxShadow(
                  color: Color(0x66D4A94F),
                  blurRadius: 28,
                  spreadRadius: 5,
                ),
              ]
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            rank,
            style: TextStyle(
              fontSize: 40,
              fontWeight: FontWeight.w900,
              color: red ? Colors.red.shade800 : Colors.black,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              fontSize: 42,
              color: red ? Colors.red.shade800 : Colors.black,
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
                    color: red ? Colors.red.shade800 : Colors.black,
                  ),
                ),
              ),
            ),
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
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            rank,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontWeight: FontWeight.w900,
              fontSize: 17,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontSize: 19,
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
      decoration: BoxDecoration(
        color: const Color(0xFFF4EFE2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            rank,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            symbol,
            style: TextStyle(
              color: red ? Colors.red.shade800 : Colors.black,
              fontSize: 28,
            ),
          ),
          const Spacer(),
          Align(
            alignment: Alignment.bottomRight,
            child: Text(
              symbol,
              style: TextStyle(
                color: red ? Colors.red.shade800 : Colors.black,
                fontSize: 22,
              ),
            ),
          ),
        ],
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
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
