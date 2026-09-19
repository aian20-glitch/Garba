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
