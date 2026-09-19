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

// Стол «Көк»: деревянный бортик с золотыми рогами по кругу (рогами наружу),
// небесно-голубое сукно и едва заметный шаңырақ — купол юрты — в центре.
class KazakhTablePainter extends CustomPainter {
  const KazakhTablePainter();

  static const gold = Color(0xFFE0B84F);

  @override
  void paint(Canvas canvas, Size size) {
    final outer = Offset.zero & size;
    const rim = 16.0;
    final felt = outer.deflate(rim);
    final center = outer.center;

    // Тень и бортик.
    canvas.drawOval(
      outer.shift(const Offset(0, 6)),
      Paint()
        ..color = Colors.black54
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12),
    );
    canvas.drawOval(
      outer,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF6B4423), Color(0xFF2E1B0C)],
        ).createShader(outer),
    );
    canvas.drawOval(
      outer.deflate(0.75),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = gold.withValues(alpha: 0.9),
    );

    // Рога по бортику: каждый смотрит наружу, от центра стола.
    final horn = kazakhHornPath();
    final hornPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 9
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = gold;
    final rx = size.width / 2 - rim / 2;
    final ry = size.height / 2 - rim / 2;
    final perimeter = math.pi * (3 * (rx + ry) - math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    final count = (perimeter / 24).floor();
    const motif = 13.0;
    for (var i = 0; i < count; i++) {
      final t = 2 * math.pi * i / count;
      final pos = center + Offset(rx * math.cos(t), ry * math.sin(t));
      // Нормаль эллипса наружу — туда смотрят рога.
      final normal = math.atan2(math.sin(t) / ry, math.cos(t) / rx);
      canvas.save();
      canvas.translate(pos.dx, pos.dy);
      canvas.rotate(normal + math.pi / 2);
      canvas.scale(motif / 100);
      canvas.translate(-50, -55);
      canvas.drawPath(horn, hornPaint);
      canvas.restore();
    }

    // Сукно — небесно-голубое, светлее к центру.
    canvas.drawOval(
      felt,
      Paint()
        ..shader = const RadialGradient(
          colors: [Color(0xFF1C8FAE), Color(0xFF0B4A60)],
          radius: 0.75,
        ).createShader(felt),
    );
    canvas.drawOval(
      felt,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = gold.withValues(alpha: 0.8),
    );

    // Шаңырақ в центре — тонко, чтобы не мешал картам.
    final r = math.min(felt.width, felt.height) * 0.26;
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..color = gold.withValues(alpha: 0.28);
    canvas.drawCircle(center, r, line);
    canvas.drawCircle(center, r * 0.82, line);
    final arcs = Path()
      ..moveTo(center.dx - r, center.dy)
      ..quadraticBezierTo(center.dx, center.dy - r * 1.35, center.dx + r, center.dy)
      ..moveTo(center.dx - r, center.dy)
      ..quadraticBezierTo(center.dx, center.dy + r * 1.35, center.dx + r, center.dy)
      ..moveTo(center.dx, center.dy - r)
      ..quadraticBezierTo(center.dx - r * 1.35, center.dy, center.dx, center.dy + r)
      ..moveTo(center.dx, center.dy - r)
      ..quadraticBezierTo(center.dx + r * 1.35, center.dy, center.dx, center.dy + r);
    canvas.drawPath(arcs, line);
  }

  @override
  bool shouldRepaint(covariant KazakhTablePainter oldDelegate) => false;
}
