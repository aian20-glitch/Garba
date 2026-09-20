// Карты и масти.
part of '../main.dart';

const _cardIvory = Color(0xFFFFF6DF);
const _cardIvoryDeep = Color(0xFFE9D8B3);
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
        color: glow ? const Color(0xFFF2C65D) : _cardGold,
        width: glow ? 3 : 1.2,
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

// Валет, дама и король используют один фирменный спрайт. Так иллюстрация
// остаётся чёткой и одинаковой на большой карте, в руке и на столе.
class _CourtCardArt extends StatelessWidget {
  final String rank;
  final double opacity;

  const _CourtCardArt({required this.rank, this.opacity = 1});

  @override
  Widget build(BuildContext context) {
    final alignment = rank == 'J'
        ? Alignment.centerLeft
        : rank == 'Q'
            ? Alignment.center
            : Alignment.centerRight;
    return LayoutBuilder(
      builder: (context, constraints) => ClipRect(
        child: OverflowBox(
          alignment: alignment,
          minWidth: constraints.maxWidth * 3,
          maxWidth: constraints.maxWidth * 3,
          minHeight: constraints.maxWidth,
          maxHeight: constraints.maxWidth,
          child: Opacity(
            opacity: opacity,
            child: Image.asset(
              'assets/branding/court_cards.png',
              width: constraints.maxWidth * 3,
              height: constraints.maxWidth,
              fit: BoxFit.fill,
            ),
          ),
        ),
      ),
    );
  }
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
          if (rank == 'J' || rank == 'Q' || rank == 'K')
            Positioned.fill(
              top: 24,
              bottom: 4,
              child: _CourtCardArt(rank: rank, opacity: 0.92),
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
          if (rank == 'J' || rank == 'Q' || rank == 'K')
            Positioned.fill(
              top: 21,
              bottom: 5,
              child: _CourtCardArt(rank: rank, opacity: 0.72),
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
                    fontSize: 24,
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
      width: 82,
      height: 42,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          for (var index = 0; index < 5; index++)
            Positioned(
              left: 5 + index * 13,
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
      width: 25,
      height: 38,
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
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        color: red ? _cardRed : const Color(0xFF101419),
                      ),
                    ),
                    Text(
                      suitSymbol(suit!),
                      style: TextStyle(
                        height: 1,
                        fontSize: 11,
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
