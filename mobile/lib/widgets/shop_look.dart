// Вещи из магазина (RULES.md §17, 13.10.2026): рамка аватарки, рубашка карт, сукно стола,
// эффект победы, наборы смайликов. Цены и что куплено решает сервер (GET /shop, /me → shop),
// здесь — только рисунки. Рисунки нарисовал художник, лежат в assets/shop.
part of '../main.dart';

String shopAsset(String id) => 'assets/shop/$id.webp';

// Какую долю картинки рамки занимает дырка под фото (картинки выровнены так, что дырка
// ровно в центре). Посчитано по самим картинкам — tools/shop_art.py.
const frameHole = <String, double>{
  'frame_kumis': 0.695,
  'frame_tumar': 0.592,
  'frame_muiz': 0.616,
  'frame_khan': 0.556,
};

// Наборы смайликов и фраз — тот же состав, что PACK_CONTENT в backend/src/shop.ts, менять вместе.
const packTroll = ['🤡', '🐔', '🍼', '🪦', '🐌', '🥱'];
const packPodkol = [
  'Опять ПАС?',
  'Кон мой!',
  'Плати давай!',
  'Кто так ходит?',
  'Иди к ботам!',
  'Больно, да?',
  'Бәрекелді!',
  'Қап!',
];
// Стикеры «Насмешка»: по сети идёт смайлик, вместо него рисуется картинка художника.
// Старое приложение покажет просто смайлик.
const stickerAssets = <String, String>{
  '🐑': 'sticker_koi',
  '🐫': 'sticker_tuie',
  '🐓': 'sticker_tauyk',
  '👵': 'sticker_azhe',
  '👶': 'sticker_bala',
  '💸': 'sticker_aqsha',
};

// Фраза (облачком над аватаркой) или смайлик (на аватарке).
bool isPhrase(String reaction) => tablePhrases.contains(reaction) || packPodkol.contains(reaction);

// Что из магазина у меня: куплено и надето. Приходит в GET /me и в ответах магазина.
class ShopState {
  static List<String> owned = const [];
  static Map<String, String?> look = const {};

  static void apply(Object? shop) {
    if (shop is! Map) return;
    if (shop['owned'] is List) owned = (shop['owned'] as List).map((e) => e.toString()).toList();
    if (shop['items'] is List) {
      owned = [
        for (final i in shop['items'] as List)
          if (i is Map && i['owned'] == true) i['id'].toString(),
      ];
    }
    if (shop['look'] is Map) {
      look = {
        for (final e in (shop['look'] as Map).entries) e.key.toString(): e.value?.toString(),
      };
    }
  }

  static bool has(String id) => owned.contains(id);
}

// Рубашка карт: своя из магазина или общая чёрно-золотая.
String cardBackAsset(String? back) =>
    back != null && back.startsWith('back_') ? shopAsset(back) : 'assets/branding/card_back.png';

// Рамка поверх аватарки. Размер аватарки не меняется — рамка выходит за её края.
Widget framed(Widget avatar, {required double diameter, required String? frame}) {
  final hole = frameHole[frame];
  if (frame == null || hole == null) return avatar;
  // Дырка чуть меньше аватарки: край рамки ложится на край фото, без щели.
  final size = diameter / hole * 0.97;
  final shift = (diameter - size) / 2;
  return SizedBox(
    width: diameter,
    height: diameter,
    child: Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(child: avatar),
        Positioned(
          left: shift,
          top: shift,
          width: size,
          height: size,
          child: IgnorePointer(child: Image.asset(shopAsset(frame), fit: BoxFit.contain)),
        ),
      ],
    ),
  );
}

// Стол с сукном. Обычный — моё надетое сукно (каждый видит своё, решение владельца);
// KazakhTable.preview — для витрины магазина.
class KazakhTable extends StatefulWidget {
  const KazakhTable({super.key})
      : preview = false,
        cloth = null;
  const KazakhTable.preview(this.cloth, {super.key}) : preview = true;

  final bool preview;
  final String? cloth;

  @override
  State<KazakhTable> createState() => _KazakhTableState();
}

class _KazakhTableState extends State<KazakhTable> {
  // Картинки сукна уже разжаты — второй раз не грузим.
  static final Map<String, ui.Image> _cache = {};
  String? loading;
  ImageStream? stream;
  ImageStreamListener? listener;

  String? get wanted => widget.preview ? widget.cloth : ShopState.look['cloth'];

  void ensureLoaded(String id) {
    if (_cache.containsKey(id) || loading == id) return;
    stopListening();
    loading = id;
    stream = AssetImage(shopAsset(id)).resolve(createLocalImageConfiguration(context));
    listener = ImageStreamListener((info, _) {
      _cache[id] = info.image.clone();
      stopListening();
      if (mounted) setState(() {});
    }, onError: (_, __) => stopListening());
    stream!.addListener(listener!);
  }

  void stopListening() {
    if (stream != null && listener != null) stream!.removeListener(listener!);
    stream = null;
    listener = null;
    loading = null;
  }

  @override
  void dispose() {
    stopListening();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final id = wanted;
    if (id != null) ensureLoaded(id);
    return CustomPaint(painter: KazakhTablePainter(cloth: id == null ? null : _cache[id]));
  }
}

// Эффект победы над аватаркой: главный выиграл раздачу — все за столом видят его эффект.
// loop — в витрине магазина эффект повторяется.
class WinEffect extends StatefulWidget {
  const WinEffect({super.key, required this.effect, required this.size, this.loop = false});

  final String effect;
  final double size;
  final bool loop;

  static const duration = Duration(milliseconds: 2800);

  @override
  State<WinEffect> createState() => _WinEffectState();
}

class _WinEffectState extends State<WinEffect> with SingleTickerProviderStateMixin {
  late final AnimationController controller = AnimationController(vsync: this, duration: WinEffect.duration);

  @override
  void initState() {
    super.initState();
    if (widget.loop) {
      controller.repeat();
    } else {
      controller.forward();
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  // Повторяемое «случайное» число 0…1 для частицы — у всех за столом одинаково.
  static double rnd(int i, int salt) {
    final v = math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return v - v.floorToDouble();
  }

  Widget sprite(String id, double size) =>
      Image.asset(shopAsset(id), width: size, height: size, fit: BoxFit.contain, filterQuality: FilterQuality.medium);

  List<Widget> shashu(double t, double s) {
    const kinds = ['fx_coin', 'fx_candy', 'fx_baursak', 'fx_coin', 'fx_candy'];
    return [
      for (var i = 0; i < 18; i++)
        () {
          final delay = rnd(i, 1) * 0.45;
          final p = ((t - delay) / 0.55).clamp(0.0, 1.0);
          if (p <= 0 || p >= 1) return const SizedBox.shrink();
          final x = (rnd(i, 2) - 0.5) * s * 0.95;
          final y = -s * 0.45 + p * p * s * 0.9;
          final piece = s * (0.13 + rnd(i, 3) * 0.07);
          return Positioned(
            left: s / 2 + x - piece / 2,
            top: s / 2 + y - piece / 2,
            child: Opacity(
              opacity: p < 0.8 ? 1 : (1 - p) / 0.2,
              child: Transform.rotate(
                angle: (rnd(i, 4) - 0.5) * 6 * p,
                child: sprite(kinds[i % kinds.length], piece),
              ),
            ),
          );
        }(),
    ];
  }

  List<Widget> stars(double t, double s) {
    final fade = t < 0.1 ? t / 0.1 : (t > 0.85 ? (1 - t) / 0.15 : 1.0);
    return [
      for (var i = 0; i < 8; i++)
        () {
          final angle = -math.pi / 2 + i * math.pi / 4 + t * 0.8;
          final r = s * (0.36 + 0.05 * math.sin(t * 9 + i));
          final pulse = 0.55 + 0.45 * math.sin(t * math.pi * 6 + i * 1.3).abs();
          final star = s * (i.isEven ? 0.22 : 0.15) * pulse;
          return Positioned(
            left: s / 2 + math.cos(angle) * r - star / 2,
            top: s / 2 + math.sin(angle) * r - star / 2,
            child: Opacity(opacity: fade.clamp(0.0, 1.0), child: sprite('fx_star', star)),
          );
        }(),
    ];
  }

  List<Widget> burkit(double t, double s) {
    // Беркут садится прямо на аватарку (её верх — на 0,4 размера, когти — у её середины),
    // машет крыльями и улетает вверх. Выше не поднимаем: у верхнего места его обрезал бы край стола.
    final appear = Curves.easeOutBack.transform((t / 0.25).clamp(0.0, 1.0));
    final leave = ((t - 0.75) / 0.25).clamp(0.0, 1.0);
    final flap = 1 - 0.18 * math.sin(t * math.pi * 10).abs();
    final w = s * 0.62 * (0.3 + 0.7 * appear);
    return [
      Positioned(
        left: s / 2 - w / 2,
        top: s * 0.35 - leave * s * 0.3 - w / 2,
        child: Opacity(
          opacity: (1 - leave).clamp(0.0, 1.0),
          child: Transform(
            alignment: Alignment.center,
            transform: Matrix4.diagonal3Values(1, flap, 1),
            child: sprite('fx_burkit', w),
          ),
        ),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.size;
    return IgnorePointer(
      child: SizedBox(
        width: s,
        height: s,
        child: AnimatedBuilder(
          animation: controller,
          builder: (_, __) {
            final t = controller.value;
            return Stack(
              clipBehavior: Clip.none,
              children: switch (widget.effect) {
                'win_shashu' => shashu(t, s),
                'win_stars' => stars(t, s),
                'win_burkit' => burkit(t, s),
                _ => const <Widget>[],
              },
            );
          },
        ),
      ),
    );
  }
}
