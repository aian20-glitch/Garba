// Магазин за игровые монеты (RULES.md §17, решение владельца 13.10.2026).
// Только внешний вид: рамка аватарки, рубашка карт, сукно стола, эффект победы, наборы смайликов.
// Цены, что куплено и что надето — с сервера (GET /shop); рисунки — в приложении (assets/shop).
part of '../main.dart';

// Плитка магазина на главном экране — во всю ширину, с рамкой «Ханский трон».
class ShopTile extends StatelessWidget {
  const ShopTile({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Ink(
          height: 92,
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF3A0D16), Color(0xFF7A1F2A), Color(0xFF3A0D16)],
            ),
          ),
          child: Row(
            children: [
              const SizedBox(width: 10),
              Image.asset(shopAsset('frame_khan'), width: 78, height: 78),
              const SizedBox(width: 6),
              const Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('МАГАЗИН',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFFFFD87A), letterSpacing: 1)),
                    SizedBox(height: 2),
                    Text('Рамки, рубашки, сукно, стикеры',
                        style: TextStyle(fontSize: 13, color: Colors.white70)),
                  ],
                ),
              ),
              Image.asset(shopAsset('back_altyn'), width: 40, height: 60),
              const SizedBox(width: 14),
            ],
          ),
        ),
      ),
    );
  }
}

// Цена полностью, с пробелами: 250 000 (а не «250k», как баланс за столом).
String fmtPrice(int value) =>
    value.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ' ');

// Разделы витрины. free — что у всех бесплатно (снять купленное = вернуть это).
const _shopSections = [
  (kind: 'frame', title: 'РАМКА АВАТАРКИ', hint: 'Видят все: за столом, в лобби, в рейтинге, у друзей.', free: 'Без рамки'),
  (kind: 'back', title: 'РУБАШКА КАРТ', hint: 'В комнате, которую создал ты, все за столом играют твоей рубашкой.', free: 'ГАРБА'),
  (kind: 'cloth', title: 'СУКНО СТОЛА', hint: 'Твой стол — у каждого своё сукно на экране.', free: 'Небесное'),
  (kind: 'effect', title: 'ЭФФЕКТ ПОБЕДЫ', hint: 'Над аватаркой, когда выиграл раздачу главным. Видят все.', free: 'Без эффекта'),
  (kind: 'pack', title: 'СМАЙЛИКИ И ФРАЗЫ', hint: 'Появятся в окне смайликов 😊 и фраз 💬 за столом.', free: null),
];

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  static const gold = Color(0xFFD4A94F);

  Map<String, dynamic>? shop;
  Object? loadError;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    load();
  }

  int get balance => (shop?['balance'] as num?)?.toInt() ?? 0;
  String? get roomId => shop?['roomId']?.toString();
  List<Map<String, dynamic>> get items => ((shop?['items'] as List?) ?? const [])
      .map((e) => Map<String, dynamic>.from(e as Map))
      // Вещь, для которой в этой версии приложения нет рисунка, не показываем.
      .where((i) => _knownItem(i['id'].toString()))
      .toList();

  static bool _knownItem(String id) =>
      frameHole.containsKey(id) ||
      id.startsWith('back_') ||
      id.startsWith('cloth_') ||
      const ['win_shashu', 'win_stars', 'win_burkit', 'pack_troll', 'pack_podkol', 'pack_mazak'].contains(id);

  void apply(Map<String, dynamic> data) {
    ShopState.apply(data);
    setState(() {
      shop = data;
      loadError = null;
    });
  }

  Future<void> load() async {
    try {
      final response = await apiRequest(http.get(Uri.parse('$apiBase/shop'), headers: authHeaders()));
      expectStatus(response, const [200]);
      if (mounted) apply(jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (mounted) setState(() => loadError = e);
    }
  }

  Future<void> post(String path, Map<String, dynamic> body) async {
    final response = await apiRequest(
      http.post(Uri.parse('$apiBase$path'), headers: authHeaders(), body: jsonEncode(body)),
    );
    expectStatus(response, const [200]);
    if (mounted) apply(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> buy(Map<String, dynamic> item) async {
    final price = (item['price'] as num).toInt();
    if (roomId != null) {
      showGarbaError(context, ApiFailure(409, 'finish your game first', const {}),
          prefix: 'Купить можно после игры');
      return;
    }
    if (balance < price) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Не хватает ${fmtPrice(price - balance)} монет'),
      ));
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        backgroundColor: const Color(0xFF13232E),
        title: Text('Купить «${item['name']}»?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const CoinIcon(size: 20),
              const SizedBox(width: 6),
              Text(fmtPrice(price), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: gold)),
            ]),
            const SizedBox(height: 10),
            const Text('Монеты сгорят, вещь — ваша навсегда. Вернуть или подарить её нельзя.'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('ОТМЕНА')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: gold, foregroundColor: Colors.black),
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('КУПИТЬ', style: TextStyle(fontWeight: FontWeight.w900)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await run(() => post('/shop/buy', {'itemId': item['id']}), () {
      GarbaSounds.result(true);
      HapticFeedback.mediumImpact();
      return item['kind'] == 'pack'
          ? '«${item['name']}» — ваш! Уже в окне смайликов за столом.'
          : '«${item['name']}» — ваше! Уже надето.';
    });
  }

  Future<void> equip(String kind, String? itemId) =>
      run(() => post('/shop/equip', {'slot': kind, 'itemId': itemId}), () => itemId == null ? 'Снято' : 'Надето');

  Future<void> run(Future<void> Function() action, String Function() done) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await action();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done())));
      }
    } catch (e) {
      if (mounted) showGarbaError(context, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  // Картинка вещи: big — в окне подробностей.
  Widget preview(String kind, String? id, {bool big = false}) {
    final k = big ? 1.9 : 1.0;
    switch (kind) {
      case 'frame':
        return AvatarView(avatar: null, name: Session.name, radius: 30 * k, frame: id);
      case 'back':
        Widget card(double angle) => Transform.rotate(
              angle: angle,
              child: Container(
                width: 52 * k,
                height: 78 * k,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(5 * k),
                  boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(0, 2))],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(5 * k),
                  child: Image.asset(cardBackAsset(id), fit: BoxFit.cover),
                ),
              ),
            );
        return SizedBox(
          width: 100 * k,
          height: 96 * k,
          child: Stack(alignment: Alignment.center, children: [
            Positioned(left: 6 * k, child: card(-0.22)),
            Positioned(right: 6 * k, child: card(0.22)),
            card(0),
          ]),
        );
      case 'cloth':
        // В окне подробностей — настоящий стол; на карточке — само сукно, крупно.
        if (big) return SizedBox(width: 200, height: 290, child: KazakhTable.preview(id));
        return Container(
          width: 84,
          height: 122,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: const Color(0xFFE6B74F), width: 3),
            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 8)],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(23),
            child: id == null
                ? const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: RadialGradient(
                        center: Alignment(0, -0.18),
                        colors: [Color(0xFF0B6090), Color(0xFF06456C), Color(0xFF02263F)],
                      ),
                    ),
                  )
                : Image.asset(shopAsset(id), fit: BoxFit.fill),
          ),
        );
      case 'effect':
        final avatar = AvatarView(avatar: null, name: Session.name, radius: 22 * k);
        if (id == null) return avatar;
        // Аватарка там же, где за столом относительно эффекта (верх — на 0,4 размера).
        final size = 120 * k;
        return SizedBox(
          width: size,
          height: size,
          child: Stack(clipBehavior: Clip.none, children: [
            Positioned(left: size / 2 - 22 * k, top: size * 0.4, child: avatar),
            WinEffect(effect: id, size: size, loop: true),
          ]),
        );
      case 'pack':
        if (id == 'pack_mazak') {
          final side = big ? 92.0 : 42.0;
          return SizedBox(
            width: side * 3 + 8,
            child: Wrap(
              alignment: WrapAlignment.center,
              spacing: 2,
              runSpacing: 2,
              children: [
                for (final s in stickerAssets.values) Image.asset(shopAsset(s), width: side, height: side),
              ],
            ),
          );
        }
        if (id == 'pack_podkol') {
          return Wrap(
            alignment: WrapAlignment.center,
            spacing: 4,
            runSpacing: 4,
            children: [
              for (final p in big ? packPodkol : packPodkol.take(3))
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: gold),
                  ),
                  child: Text(p,
                      style: TextStyle(
                          color: const Color(0xFF0B1620), fontSize: big ? 15 : 11, fontWeight: FontWeight.w900)),
                ),
            ],
          );
        }
        // Тролль: 3 в ряд.
        return SizedBox(
          width: big ? 220 : 120,
          child: Wrap(
            alignment: WrapAlignment.center,
            spacing: big ? 14 : 6,
            runSpacing: big ? 10 : 4,
            children: [for (final e in packTroll) Text(e, style: TextStyle(fontSize: big ? 48 : 26))],
          ),
        );
    }
    return const SizedBox.shrink();
  }

  // Подробнее: крупная картинка и та же кнопка.
  void openDetails(String kind, Map<String, dynamic>? item, String freeName) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF13232E),
      isScrollControlled: true,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                height: 300,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  gradient: const RadialGradient(colors: [Color(0xFF0F4A70), Color(0xFF06304D), Color(0xFF04182A)]),
                ),
                child: preview(kind, item?['id']?.toString(), big: true),
              ),
              const SizedBox(height: 14),
              Text(item?['name']?.toString() ?? freeName,
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: Color(0xFFFFD87A))),
              Text(item?['title']?.toString() ?? 'Бесплатно, у всех',
                  style: const TextStyle(color: Colors.white70, fontSize: 15)),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: action(kind, item, close: () => Navigator.pop(sheet)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // Кнопка под вещью: купить / надеть / снять. item == null — бесплатное «как у всех».
  Widget action(String kind, Map<String, dynamic>? item, {VoidCallback? close}) {
    final look = ShopState.look;
    void then(Future<void> Function() f) {
      close?.call();
      f();
    }

    if (item == null) {
      final on = look[kind] == null;
      return OutlinedButton(
        onPressed: on || busy ? null : () => then(() => equip(kind, null)),
        child: Text(on ? '✓ НАДЕТО' : 'НАДЕТЬ'),
      );
    }
    final id = item['id'].toString();
    if (item['owned'] == true) {
      if (kind == 'pack') {
        return const OutlinedButton(onPressed: null, child: Text('✓ КУПЛЕНО'));
      }
      final on = look[kind] == id;
      return on
          ? OutlinedButton(
              onPressed: busy ? null : () => then(() => equip(kind, null)),
              child: const Text('СНЯТЬ'),
            )
          : FilledButton(
              onPressed: busy ? null : () => then(() => equip(kind, id)),
              child: const Text('НАДЕТЬ', style: TextStyle(fontWeight: FontWeight.w900)),
            );
    }
    final price = (item['price'] as num).toInt();
    final enough = balance >= price;
    return FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: enough ? gold : const Color(0xFF4A4A40),
        foregroundColor: enough ? Colors.black : Colors.white60,
        padding: const EdgeInsets.symmetric(horizontal: 8),
      ),
      onPressed: busy ? null : () => then(() => buy(item)),
      child: FittedBox(
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          const CoinIcon(size: 16),
          const SizedBox(width: 4),
          Text(fmtPrice(price), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        ]),
      ),
    );
  }

  Widget card(String kind, Map<String, dynamic>? item, String freeName) {
    final id = item?['id']?.toString();
    final on = kind != 'pack' && ShopState.look[kind] == id && (item == null || item['owned'] == true);
    final price = (item?['price'] as num?)?.toInt() ?? 0;
    // Дорогие вещи — золотой каймой, сразу видно, что это понты.
    final rich = price >= 150000;
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: const Color(0xFF0E2534),
        border: Border.all(
          color: on ? Colors.greenAccent : (rich ? gold : Colors.white12),
          width: on || rich ? 1.6 : 1,
        ),
        boxShadow: rich ? [BoxShadow(color: gold.withValues(alpha: 0.25), blurRadius: 14)] : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
            onTap: () => openDetails(kind, item, freeName),
            child: Container(
              height: 140,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
                gradient: RadialGradient(colors: [Color(0xFF0F4A70), Color(0xFF06304D), Color(0xFF04182A)]),
              ),
              child: Stack(
                children: [
                  Positioned.fill(child: Center(child: preview(kind, id))),
                  if (on)
                    const Positioned(
                      top: 6,
                      right: 6,
                      child: Icon(Icons.check_circle, color: Colors.greenAccent, size: 20),
                    ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Русские названия длиннее — ужимаем, а не обрезаем.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(item?['name']?.toString() ?? freeName,
                      maxLines: 1, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
                ),
                // Подпись — до двух строк, высота одна на всех: карточки в ряду ровные.
                SizedBox(
                  height: 32,
                  child: Text(item?['title']?.toString() ?? 'Как у всех',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, height: 1.3, color: Colors.white60)),
                ),
                const SizedBox(height: 8),
                SizedBox(height: 38, child: action(kind, item)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Две карточки в ряд, ячейки равной ширины.
  Widget grid(List<Widget> cards) => Column(
        children: [
          for (var i = 0; i < cards.length; i += 2)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: cards[i]),
                  const SizedBox(width: 12),
                  Expanded(child: i + 1 < cards.length ? cards[i + 1] : const SizedBox()),
                ],
              ),
            ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('МАГАЗИН', style: TextStyle(fontWeight: FontWeight.w900)),
        actions: [
          if (shop != null)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Row(children: [
                const CoinIcon(size: 20),
                const SizedBox(width: 4),
                Text(fmtCoins(balance), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ]),
            ),
        ],
      ),
      body: shop == null
          ? Center(
              child: loadError == null
                  ? const CircularProgressIndicator()
                  : Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text(userErrorMessage(loadError!, fallback: 'Не удалось открыть магазин'),
                            textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(onPressed: load, child: const Text('ЕЩЁ РАЗ')),
                      ]),
                    ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
              children: [
                const Text(
                  'Только внешний вид — в игре не помогает. Монеты за покупку сгорают, вещь — ваша навсегда.',
                  style: TextStyle(color: Colors.white70),
                ),
                if (roomId != null)
                  Container(
                    margin: const EdgeInsets.only(top: 10),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF3A2A10),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: gold),
                    ),
                    child: Text('Вы за столом #$roomId: купить можно после игры, надеть купленное — можно сейчас.'),
                  ),
                for (final section in _shopSections) ...[
                  const SizedBox(height: 22),
                  Text(section.title,
                      style: const TextStyle(color: gold, fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 1.2)),
                  const SizedBox(height: 2),
                  Text(section.hint, style: const TextStyle(color: Colors.white60, fontSize: 13)),
                  const SizedBox(height: 10),
                  grid([
                    if (section.free != null) card(section.kind, null, section.free!),
                    for (final item in items.where((i) => i['kind'] == section.kind))
                      card(section.kind, item, section.free ?? ''),
                  ]),
                ],
                const SizedBox(height: 8),
                const Text(
                  'Игровые монеты являются виртуальными единицами и не имеют денежного эквивалента.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white38, fontSize: 12),
                ),
              ],
            ),
    );
  }
}
