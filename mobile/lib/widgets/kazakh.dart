// Казахский орнамент: рога қошқар мүйіз, заголовок ГАРБА, стол «Көк».
part of '../main.dart';

// «ГАРБА!» — надпись, которая при появлении увеличивается и загорается (RULES.md §8:
// «показывается анимация ГАРБА»). Без пакетов анимации — встроенный TweenAnimationBuilder.
// Қошқар мүйіз — бараньи рога, главный казахский орнамент. Контур в квадрате 100×100:
// два завитка из одного стебля и ромб между ними. Тот же рисунок — в иконке приложения.
Path kazakhHornPath() {
  final p = Path()
    ..moveTo(50, 88)
    ..cubicTo(50, 64, 46, 52, 33, 49)
    ..cubicTo(19, 46, 12, 34, 18, 24)
    ..cubicTo(24, 14, 39, 16, 39, 27)
    ..cubicTo(39, 34, 31, 37, 27, 31)
    ..moveTo(50, 88)
    ..cubicTo(50, 64, 54, 52, 67, 49)
    ..cubicTo(81, 46, 88, 34, 82, 24)
    ..cubicTo(76, 14, 61, 16, 61, 27)
    ..cubicTo(61, 34, 69, 37, 73, 31)
    ..moveTo(50, 42)
    ..lineTo(56, 34)
    ..lineTo(50, 26)
    ..lineTo(44, 34)
    ..close();
  return p;
}

// Рога қошқар мүйіз золотом — как на иконке приложения.
class KazakhHorn extends StatelessWidget {
  final double size;
  const KazakhHorn({super.key, this.size = 36});

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _HornPainter());
}

class _HornPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 100);
    canvas.drawPath(
      kazakhHornPath(),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 8
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFF6DC8A), Color(0xFFC08A2E)],
        ).createShader(const Rect.fromLTWH(0, 0, 100, 100)),
    );
  }

  @override
  bool shouldRepaint(covariant _HornPainter oldDelegate) => false;
}

// Заголовок «ГАРБА» с орнаментом — на экране имени и на главном.
class GarbaTitle extends StatelessWidget {
  const GarbaTitle({super.key});

  @override
  Widget build(BuildContext context) => const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          KazakhHorn(size: 40),
          SizedBox(width: 6),
          Text(
            'ГАРБА',
            style: TextStyle(
              fontSize: 38,
              fontWeight: FontWeight.w800,
              letterSpacing: 2,
              color: Color(0xFFD4A94F),
            ),
          ),
        ],
      );
}

// Фирменный стол ГАРБА: тёмно-синее сукно, глубокий чёрный бортик и несколько
// слоёв тёплого золота. Орнамент остаётся достаточно тихим, чтобы карты и
// плашки игроков читались поверх него.
class KazakhTablePainter extends CustomPainter {
  const KazakhTablePainter();

  static const gold = Color(0xFFE6B74F);
  static const brightGold = Color(0xFFFFD87A);

  @override
  void paint(Canvas canvas, Size size) {
    final bounds = Offset.zero & size;
    final center = bounds.center;
    final outerRect = Rect.fromLTRB(3, 3, size.width - 3, size.height - 3);
    final outerRadius = Radius.circular(size.width * 0.28);
    final outer = RRect.fromRectAndRadius(outerRect, outerRadius);
    final feltRect = outerRect.deflate(18);
    final felt = RRect.fromRectAndRadius(
      feltRect,
      Radius.circular(size.width * 0.23),
    );
    final horn = kazakhHornPath();

    void drawHorn(Offset at, double motifSize, double angle, double alpha) {
      canvas.save();
      canvas.translate(at.dx, at.dy);
      canvas.rotate(angle);
      canvas.scale(motifSize / 100);
      canvas.translate(-50, -50);
      canvas.drawPath(
        horn,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 7
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..color = brightGold.withValues(alpha: alpha),
      );
      canvas.restore();
    }

    canvas.drawRRect(
      outer.shift(const Offset(0, 7)),
      Paint()
        ..color = const Color(0xCC000000)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 16),
    );
    canvas.drawRRect(
      outer,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFD87A), Color(0xFF7E4A12), Color(0xFFD99A35)],
        ).createShader(outerRect),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        outerRect.deflate(5),
        Radius.circular(size.width * 0.27),
      ),
      Paint()..color = const Color(0xFF241508),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        outerRect.deflate(10),
        Radius.circular(size.width * 0.25),
      ),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..shader = const LinearGradient(
          colors: [brightGold, Color(0xFF9D661C), brightGold],
        ).createShader(outerRect),
    );

    canvas.drawRRect(
      felt,
      Paint()
        ..shader = const RadialGradient(
          center: Alignment(0, -0.18),
          radius: 1.05,
          colors: [Color(0xFF0B6090), Color(0xFF06456C), Color(0xFF02263F)],
          stops: [0, 0.62, 1],
        ).createShader(feltRect),
    );
    canvas.drawRRect(
      felt,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = brightGold.withValues(alpha: 0.82),
    );

    // Едва заметная фактура сукна.
    canvas.save();
    canvas.clipRRect(felt);
    final texture = Paint()
      ..color = Colors.white.withValues(alpha: 0.018)
      ..strokeWidth = 0.7;
    for (var y = feltRect.top; y < feltRect.bottom; y += 9) {
      canvas.drawLine(
        Offset(feltRect.left, y),
        Offset(feltRect.right, y + 20),
        texture,
      );
    }
    canvas.restore();

    // Акцентные орнаменты по прямым бокам рамки.
    for (final fraction in [0.27, 0.5, 0.73]) {
      final y = outerRect.top + outerRect.height * fraction;
      drawHorn(Offset(outerRect.left + 10, y), 18, -math.pi / 2, 0.82);
      drawHorn(Offset(outerRect.right - 10, y), 18, math.pi / 2, 0.82);
    }

    // Большой спокойный водяной знак в центре сукна.
    drawHorn(center.translate(0, -12), size.width * 0.38, 0, 0.10);
    final title = TextPainter(
      text: TextSpan(
        text: 'ГАРБА',
        style: TextStyle(
          color: brightGold.withValues(alpha: 0.10),
          fontSize: size.width * 0.075,
          fontWeight: FontWeight.w700,
          letterSpacing: 2,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    title.paint(
      canvas,
      Offset(center.dx - title.width / 2, center.dy + size.width * 0.16),
    );
  }

  @override
  bool shouldRepaint(covariant KazakhTablePainter oldDelegate) => false;
}
