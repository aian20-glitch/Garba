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
    final outer = Offset.zero & size;
    const rim = 22.0;
    final felt = outer.deflate(rim);
    final center = outer.center;

    // Глубокая тень отделяет стол от тёмного фона экрана.
    canvas.drawOval(
      outer.shift(const Offset(0, 9)),
      Paint()
        ..color = const Color(0xCC000000)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 18),
    );

    // Внешняя рама: почти чёрное дерево с золотым светом по центру.
    canvas.drawOval(
      outer,
      Paint()
        ..shader = const RadialGradient(
          colors: [Color(0xFF9A651E), Color(0xFF39200D), Color(0xFF090B0D)],
          stops: [0, 0.72, 1],
          radius: 0.9,
        ).createShader(outer),
    );
    canvas.drawOval(
      outer.deflate(1.5),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [brightGold, Color(0xFF9B651A), brightGold],
        ).createShader(outer),
    );
    canvas.drawOval(
      outer.deflate(8),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..color = const Color(0xFF3D260F),
    );

    // Крупный ритм казахского орнамента по раме.
    final horn = kazakhHornPath();
    final hornPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = gold.withValues(alpha: 0.92);
    final rx = size.width / 2 - 12;
    final ry = size.height / 2 - 12;
    final count = size.height > 450 ? 24 : 20;
    const motif = 14.5;
    for (var i = 0; i < count; i++) {
      final t = 2 * math.pi * i / count;
      final pos = center + Offset(rx * math.cos(t), ry * math.sin(t));
      final normal = math.atan2(math.sin(t) / ry, math.cos(t) / rx);
      canvas.save();
      canvas.translate(pos.dx, pos.dy);
      canvas.rotate(normal + math.pi / 2);
      canvas.scale(motif / 100);
      canvas.translate(-50, -55);
      canvas.drawPath(horn, hornPaint);
      canvas.restore();
    }

    // Внутренний золотой кант и глубокое бархатное сукно.
    canvas.drawOval(
      outer.deflate(17),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [brightGold, Color(0xFFB77A20), Color(0xFFF0C65A)],
        ).createShader(outer),
    );
    canvas.drawOval(
      felt,
      Paint()
        ..shader = const RadialGradient(
          center: Alignment(0, -0.08),
          colors: [Color(0xFF0B7590), Color(0xFF075268), Color(0xFF032D3D)],
          stops: [0, 0.58, 1],
          radius: 0.92,
        ).createShader(felt),
    );
    canvas.drawOval(
      felt,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = brightGold.withValues(alpha: 0.72),
    );

    // Тонкая тканевая фактура, едва заметная на телефоне.
    final texture = Paint()
      ..color = Colors.white.withValues(alpha: 0.018)
      ..strokeWidth = 0.7;
    canvas.save();
    canvas.clipPath(Path()..addOval(felt.deflate(2)));
    for (var y = felt.top; y < felt.bottom; y += 10) {
      canvas.drawLine(
          Offset(felt.left, y), Offset(felt.right, y + 22), texture);
    }
    canvas.restore();

    // Центральный водяной знак: шаңырақ и фирменные рога.
    final r = math.min(felt.width, felt.height) * 0.24;
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3
      ..color = gold.withValues(alpha: 0.18);
    canvas.drawCircle(center, r, line);
    canvas.drawCircle(center, r * 0.82, line);
    final arcs = Path()
      ..moveTo(center.dx - r, center.dy)
      ..quadraticBezierTo(
          center.dx, center.dy - r * 1.35, center.dx + r, center.dy)
      ..moveTo(center.dx - r, center.dy)
      ..quadraticBezierTo(
          center.dx, center.dy + r * 1.35, center.dx + r, center.dy)
      ..moveTo(center.dx, center.dy - r)
      ..quadraticBezierTo(
          center.dx - r * 1.35, center.dy, center.dx, center.dy + r)
      ..moveTo(center.dx, center.dy - r)
      ..quadraticBezierTo(
          center.dx + r * 1.35, center.dy, center.dx, center.dy + r);
    canvas.drawPath(arcs, line);

    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.scale((r * 1.25) / 100);
    canvas.translate(-50, -50);
    canvas.drawPath(
      horn,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 7
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = brightGold.withValues(alpha: 0.11),
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant KazakhTablePainter oldDelegate) => false;
}
