// ШАХ (ветка shah, этап 3, 04.11.2026): карты, взятка в центре стола, табло штрафов,
// окна итога партии и матча. Правила — SHAH_RULES.md; что можно и чья очередь — решает сервер.
part of '../main.dart';

// Цвета сторон: команда 1 — золото, команда 2 — небо (стиль «Көк»); при 1×1×1 у третьего — коралл.
const shahSideColors = [Color(0xFFE6B74F), Color(0xFF5EC8FF), Color(0xFFFF8A80)];
Color shahSideColor(int side) => shahSideColors[side % shahSideColors.length];

// Старшинство ШАХ (§2): Т > 10 > К > Д > В > 9 > 8 > 7 > 6 — только для порядка карт в руке.
const shahRankOrder = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];

// Форматы стола (§1): 2 — каждый сам, 3 — каждый сам, 4 — 2×2, 6 — 3×3.
String shahFormatName(int capacity) => switch (capacity) {
      2 => '1×1',
      3 => '1×1×1',
      4 => '2×2',
      6 => '3×3',
      _ => '$capacity',
    };

String shahFormatLong(int capacity) => switch (capacity) {
      2 => '1×1 — двое, каждый сам за себя',
      3 => '1×1×1 — трое, каждый сам за себя',
      4 => '2×2 — две команды по двое',
      6 => '3×3 — две команды по трое',
      _ => '$capacity игроков',
    };

// Штраф: 0 → «0», −4 → «−4» (настоящий минус).
String fmtPenalty(num value) => value == 0 ? '0' : '−${value.abs().toInt()}';

bool isShahCard(Map c) => c['suit'] == 'clubs' && c['rank'] == '6';

// 1 карта, 2 карты, 5 карт, 21 карта.
String cardsCountText(int n) {
  final m10 = n % 10, m100 = n % 100;
  final word = m10 == 1 && m100 != 11
      ? 'карта'
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
          ? 'карты'
          : 'карт';
  return '$n $word';
}

// Рука по порядку (только показ): масти чередуются по цвету, козырь — справа;
// внутри масти — по старшинству ШАХ. Порядок карт на сервере не меняется.
List<Map<String, dynamic>> sortShahHand(List<Map<String, dynamic>> hand, String? trump) {
  const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
  int suitKey(String s) => s == trump ? 10 : suits.indexOf(s);
  return [...hand]..sort((a, b) {
      final bySuit = suitKey(a['suit'].toString()).compareTo(suitKey(b['suit'].toString()));
      if (bySuit != 0) return bySuit;
      return shahRankOrder.indexOf(a['rank'].toString()).compareTo(shahRankOrder.indexOf(b['rank'].toString()));
    });
}

// Маленькая карта стола: лицом или рубашкой (card == null). glow — верхняя комбинация.
class ShahMiniCard extends StatelessWidget {
  final Map<String, dynamic>? card;
  final double width;
  final bool glow;
  final String? back;
  final double opacity;

  const ShahMiniCard({super.key, required this.card, this.width = 38, this.glow = false, this.back, this.opacity = 1});

  @override
  Widget build(BuildContext context) {
    final k = width / 38;
    final c = card;
    final suit = c?['suit']?.toString();
    final red = suit != null && isRedSuit(suit);
    final ink = red ? _cardRed : const Color(0xFF101419);
    return Opacity(
      opacity: opacity,
      child: Container(
        width: width,
        height: width * 1.47,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4 * k),
          border: Border.all(color: glow ? const Color(0xFFF2C65D) : _cardGold, width: glow ? 2 : 0.8),
          boxShadow: [
            const BoxShadow(color: Colors.black45, blurRadius: 3, offset: Offset(0, 1)),
            if (glow) const BoxShadow(color: Color(0x99D4A94F), blurRadius: 10, spreadRadius: 1),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(3 * k),
          child: c == null
              ? Image.asset(cardBackAsset(back), fit: BoxFit.cover)
              : Container(
                  padding: EdgeInsets.fromLTRB(3 * k, 2 * k, 2 * k, 1 * k),
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [_cardIvory, _cardIvoryDeep],
                    ),
                  ),
                  child: Stack(
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(c['rank'].toString(),
                              style: TextStyle(height: 1, fontSize: 13 * k, fontWeight: FontWeight.w900, color: ink)),
                          Text(suitSymbol(suit!), style: TextStyle(height: 1, fontSize: 14 * k, color: ink)),
                        ],
                      ),
                      Align(
                        alignment: Alignment.bottomRight,
                        child: Text(suitSymbol(suit), style: TextStyle(height: 1, fontSize: 20 * k, color: ink)),
                      ),
                      // ШАХ — шестёрка крестей (§10): на отбое бьёт всё.
                      if (isShahCard(c))
                        Align(
                          alignment: Alignment.bottomLeft,
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: 2 * k),
                            decoration: BoxDecoration(color: _cardRed, borderRadius: BorderRadius.circular(3)),
                            child: Text('ШАХ',
                                style: TextStyle(fontSize: 7 * k, fontWeight: FontWeight.w900, color: Colors.white)),
                          ),
                        ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }
}

// Взятка в центре стола (§9): N столбиков — карта захода и накрытия поверх неё (какая карта
// какую бьёт — по covers от сервера). Нижняя карта столбика — верхняя комбинация, её и бьют.
// Рубашки — отдельной стопкой с числом: что в них, не видит никто.
class ShahTrickView extends StatelessWidget {
  final Map<String, dynamic> trick;
  final bool finished;
  final String? back;
  final double maxWidth;

  const ShahTrickView({super.key, required this.trick, required this.finished, this.back, required this.maxWidth});

  // Столбики: [заход, накрытие, накрытие накрытия…].
  static List<List<Map<String, dynamic>>> columnsOf(Map<String, dynamic> trick) {
    final moves = ((trick['moves'] as List?) ?? const []).map((m) => Map<String, dynamic>.from(m as Map)).toList();
    final columns = <List<Map<String, dynamic>>>[];
    for (final m in moves) {
      final cards = ((m['cards'] as List?) ?? const []).map((c) => Map<String, dynamic>.from(c as Map)).toList();
      if (m['kind'] == 'lead') {
        for (final c in cards) {
          columns.add([c]);
        }
      } else if (m['kind'] == 'beat') {
        final covers = ((m['covers'] as List?) ?? const []).map((e) => e.toString()).toList();
        for (var i = 0; i < cards.length; i++) {
          final target = i < covers.length ? covers[i] : null;
          final col = columns.indexWhere((col) => col.last['id'].toString() == target);
          if (col >= 0) {
            columns[col].add(cards[i]);
          } else {
            columns.add([cards[i]]);
          }
        }
      }
    }
    return columns;
  }

  static int closedCountOf(Map<String, dynamic> trick) => ((trick['moves'] as List?) ?? const [])
      .where((m) => (m as Map)['kind'] == 'closed')
      .fold<int>(0, (sum, m) => sum + (((m as Map)['count'] as num?)?.toInt() ?? 0));

  @override
  Widget build(BuildContext context) {
    final columns = columnsOf(trick);
    final closed = closedCountOf(trick);
    const maxShown = 4;
    final n = columns.length + (closed > 0 ? 1 : 0);
    final width = ((maxWidth - 6 * (n - 1)) / (n == 0 ? 1 : n)).clamp(26.0, 40.0);
    final step = width * 0.5;
    // Высота — по самому длинному столбику (не больше maxShown карт): короткая взятка места не занимает.
    final longest = columns.fold<int>(1, (m, c) => math.max(m, math.min(c.length, maxShown)));
    // Стопке рубашек ниже карты нужна строка «×N».
    final height = math.max(width * 1.47 + step * (longest - 1), closed > 0 ? width * 1.47 + 16 : 0.0);

    Widget column(List<Map<String, dynamic>> col) {
      final hidden = col.length > maxShown ? col.length - maxShown : 0;
      final shown = col.sublist(hidden);
      return SizedBox(
        width: width,
        height: height,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            for (var i = 0; i < shown.length; i++)
              Positioned(
                top: i * step,
                child: ShahMiniCard(
                  card: shown[i],
                  width: width,
                  glow: !finished && i == shown.length - 1 && shown.length > 0,
                  opacity: finished ? 0.75 : 1,
                ),
              ),
            if (hidden > 0)
              Positioned(
                top: -12,
                left: 0,
                right: 0,
                child: Text('+$hidden',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.white70)),
              ),
          ],
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < columns.length; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          column(columns[i]),
        ],
        if (closed > 0) ...[
          if (columns.isNotEmpty) const SizedBox(width: 6),
          SizedBox(
            width: width,
            height: height,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ShahMiniCard(card: null, width: width, back: back, opacity: finished ? 0.75 : 1),
                const SizedBox(height: 2),
                Text('×$closed',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Colors.white70)),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

// Табло штрафов (§14–§16): у каждой стороны — имена и счёт; до −24; ×2 после ничьей.
class ShahScoreBoard extends StatelessWidget {
  final Map<String, dynamic> game;
  final List<Map<String, dynamic>> players;
  final VoidCallback? onTap;

  const ShahScoreBoard({super.key, required this.game, required this.players, this.onTap});

  static List<String> sideNames(Map<String, dynamic> game, List<Map<String, dynamic>> players) {
    final sides = (game['sides'] as num?)?.toInt() ?? 2;
    final infos = ((game['players'] as List?) ?? const []).map((p) => Map<String, dynamic>.from(p as Map)).toList();
    String nameOf(String id) =>
        players.where((p) => p['id'].toString() == id).map((p) => p['name'].toString()).firstOrNull ?? '?';
    return [
      for (var s = 0; s < sides; s++)
        infos.where((p) => (p['side'] as num?)?.toInt() == s).map((p) => nameOf(p['id'].toString())).join(', '),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final totals = ((game['totals'] as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    final names = sideNames(game, players);
    final multiplier = (game['multiplier'] as num?)?.toInt() ?? 1;
    final limit = (game['limit'] as num?)?.toInt() ?? -24;
    final party = game['party'] is Map ? game['party'] as Map : null;
    final piles = ((party?['pileCounts'] as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    final mySide = () {
      final seat = (game['mySeat'] as num?)?.toInt() ?? -1;
      final infos = (game['players'] as List?) ?? const [];
      if (seat < 0 || seat >= infos.length) return -1;
      return ((infos[seat] as Map)['side'] as num?)?.toInt() ?? -1;
    }();

    Widget side(int s) {
      final color = shahSideColor(s);
      final total = s < totals.length ? totals[s] : 0;
      final danger = total <= limit + 8; // осталось 8 и меньше до −24
      return Container(
        padding: const EdgeInsets.fromLTRB(8, 3, 8, 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: s == mySide ? 0.22 : 0.10),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: s == mySide ? 0.95 : 0.55), width: s == mySide ? 1.6 : 1),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s == mySide ? '${names[s]} · вы' : names[s],
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color),
                  ),
                  if (s < piles.length)
                    Text('взято карт: ${piles[s]}', style: const TextStyle(fontSize: 9, color: Colors.white54)),
                ],
              ),
            ),
            const SizedBox(width: 4),
            Text(
              fmtPenalty(total),
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w900,
                fontFeatures: const [FontFeature.tabularFigures()],
                color: danger ? Colors.redAccent : Colors.white,
              ),
            ),
          ],
        ),
      );
    }

    return GestureDetector(
      onTap: onTap,
      child: Row(
        children: [
          for (var s = 0; s < names.length; s++) ...[
            if (s > 0) const SizedBox(width: 6),
            Expanded(child: side(s)),
          ],
          const SizedBox(width: 6),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('до ${fmtPenalty(limit)}', style: const TextStyle(fontSize: 10, color: Colors.white60)),
              if (multiplier > 1)
                Container(
                  margin: const EdgeInsets.only(top: 2),
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(color: Colors.redAccent, borderRadius: BorderRadius.circular(6)),
                  child: Text('×$multiplier',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Colors.white)),
                )
              else
                const Icon(Icons.history, size: 14, color: Colors.white38),
            ],
          ),
        ],
      ),
    );
  }
}

// Все партии матча: очки, штрафы, счёт после партии — по нажатию на табло.
void showShahHistory(BuildContext context, Map<String, dynamic> game, List<Map<String, dynamic>> players) {
  final names = ShahScoreBoard.sideNames(game, players);
  final history = ((game['history'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: const Color(0xFF13232E),
    isScrollControlled: true,
    builder: (_) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.7),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
          children: [
            const Text('ПАРТИИ МАТЧА',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F))),
            const SizedBox(height: 4),
            Text('Штрафы копятся; кто первым дошёл до ${fmtPenalty((game['limit'] as num?) ?? -24)} — проиграл матч',
                textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Colors.white60)),
            const SizedBox(height: 10),
            if (history.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Ещё ни одной сыгранной партии', textAlign: TextAlign.center),
              ),
            for (final h in history)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Партия ${h['number']}${h['draw'] == true ? ' · НИЧЬЯ' : ''}${((h['multiplier'] as num?) ?? 1) > 1 ? ' · штрафы ×${h['multiplier']}' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    for (var s = 0; s < names.length; s++)
                      Row(
                        children: [
                          Container(
                              width: 8,
                              height: 8,
                              margin: const EdgeInsets.only(right: 6),
                              decoration: BoxDecoration(color: shahSideColor(s), shape: BoxShape.circle)),
                          Expanded(
                            child: Text(names[s],
                                maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                          ),
                          Text('${(h['points'] as List)[s]} оч.',
                              style: const TextStyle(fontSize: 13, color: Colors.white70)),
                          SizedBox(
                            width: 44,
                            child: Text(
                              fmtPenalty((h['penalties'] as List)[s] as num),
                              textAlign: TextAlign.right,
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w900,
                                color: ((h['penalties'] as List)[s] as num) < 0 ? Colors.redAccent : Colors.white54,
                              ),
                            ),
                          ),
                          SizedBox(
                            width: 44,
                            child: Text(
                              fmtPenalty((h['totals'] as List)[s] as num),
                              textAlign: TextAlign.right,
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900),
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

// Окно итога партии (§13–§16): очки сторон, штраф, ничья ×2, остаток без розыгрыша, счёт матча.
class ShahPartyResultPopup extends StatelessWidget {
  final Map<String, dynamic> result;
  final List<String> sideNames;
  final int mySide;
  final int nextMultiplier;
  final int limit;
  final Map? leftover;
  final String? nextDealerName;
  final bool matchOver;
  final VoidCallback onClose;

  const ShahPartyResultPopup({
    super.key,
    required this.result,
    required this.sideNames,
    required this.mySide,
    required this.nextMultiplier,
    required this.limit,
    required this.leftover,
    required this.nextDealerName,
    required this.matchOver,
    required this.onClose,
  });

  static const gold = Color(0xFFD4A94F);

  @override
  Widget build(BuildContext context) {
    final points = ((result['points'] as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    final penalties = ((result['penalties'] as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    final totals = ((result['totals'] as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    final draw = result['draw'] == true;
    final multiplier = (result['multiplier'] as num?)?.toInt() ?? 1;

    Widget sideLine(int s) {
      final color = shahSideColor(s);
      final penalty = s < penalties.length ? penalties[s] : 0;
      return Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: s == mySide ? 1 : 0.5), width: s == mySide ? 2 : 1),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                s == mySide ? '${sideNames[s]} (вы)' : sideNames[s],
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: color),
              ),
            ),
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: (s < points.length ? points[s] : 0).toDouble()),
              duration: const Duration(milliseconds: 1100),
              curve: Curves.easeOut,
              builder: (_, v, __) => Text('${v.round()} оч.',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white)),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 82,
              child: Text(
                penalty < 0 ? 'штраф ${fmtPenalty(penalty)}' : 'без штрафа',
                textAlign: TextAlign.right,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                  color: penalty < 0 ? Colors.redAccent : Colors.greenAccent,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return GestureDetector(
      onTap: onClose,
      child: Container(
        color: Colors.black54,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(14),
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
                  Text('ПАРТИЯ ${result['number']}',
                      style: const TextStyle(fontSize: 20, letterSpacing: 2, fontWeight: FontWeight.w900, color: gold)),
                  if (draw)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        'НИЧЬЯ — очки поровну, штрафов нет.\nСледующая партия — штрафы ×$nextMultiplier',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.orangeAccent),
                      ),
                    )
                  else if (multiplier > 1)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('После ничьей штрафы этой партии ×$multiplier',
                          style: const TextStyle(fontSize: 13, color: Colors.orangeAccent)),
                    ),
                  const SizedBox(height: 10),
                  for (var s = 0; s < sideNames.length; s++) sideLine(s),
                  if (leftover != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        'Карты остались только у «${sideNames[((leftover!['side'] as num?) ?? 0).toInt().clamp(0, sideNames.length - 1)]}» — '
                        'бить было некому: ${cardsCountText(((leftover!['count'] as num?) ?? 0).toInt())} — им без розыгрыша',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 12, color: Colors.white60),
                      ),
                    ),
                  Text(
                    'Счёт матча: ${totals.map(fmtPenalty).join(' · ')}  (до ${fmtPenalty(limit)})',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                  ),
                  if (!matchOver && nextDealerName != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('Следующим сдаёт: $nextDealerName',
                          style: const TextStyle(fontSize: 13, color: Colors.white70)),
                    ),
                  const SizedBox(height: 6),
                  const Text('Нажмите, чтобы закрыть', style: TextStyle(fontSize: 12, color: Colors.white54)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// Почему кончился матч — одной строкой для окна итогов (§16, §18 SHAH_RULES.md).
String shahCloseReasonText(Map<String, dynamic> room) {
  final result = room['result'] is Map ? room['result'] as Map : const {};
  final players = ((room['players'] as List?) ?? const []).cast<Map>();
  String nameOf(Object? id) =>
      players.where((p) => p['id'].toString() == id.toString()).map((p) => p['name'].toString()).firstOrNull ?? 'Игрок';
  final outcomes = (result['outcomes'] as Map?) ?? const {};
  final draw = outcomes.values.isNotEmpty && outcomes.values.every((o) => o == 'draw');
  final losers = players.where((p) => outcomes[p['id'].toString()] == 'lose').map((p) => p['name'].toString()).toList();
  return switch (result['reason']) {
    'match_over' => losers.isEmpty ? 'Матч окончен' : 'Штрафы −24 и ниже: ${losers.join(', ')} — матч окончен',
    'time_limit' => draw
        ? 'Время стола вышло, штрафы поровну — ничья, взносы вернулись'
        : 'Время стола вышло — выиграли те, у кого меньше штрафов',
    'player_left' => 'Выход из матча: ${((result['leftIds'] as List?) ?? const []).map(nameOf).join(', ')} — '
        'эта сторона проиграла',
    _ => 'Матч окончен',
  };
}

// Окно итога матча: кто выиграл, монеты, счёт.
class ShahMatchOverPopup extends StatelessWidget {
  final Map<String, dynamic> room;
  final String myId;
  final VoidCallback onClose;

  const ShahMatchOverPopup({super.key, required this.room, required this.myId, required this.onClose});

  static const gold = Color(0xFFD4A94F);

  @override
  Widget build(BuildContext context) {
    final result = Map<String, dynamic>.from(room['result'] as Map);
    final outcomes = Map<String, dynamic>.from((result['outcomes'] as Map?) ?? const {});
    final deltas = Map<String, dynamic>.from((result['deltas'] as Map?) ?? const {});
    final practice = room['practice'] == true;
    final players = ((room['players'] as List?) ?? const []).map((p) => Map<String, dynamic>.from(p as Map)).toList();
    final game = room['game'] is Map ? Map<String, dynamic>.from(room['game'] as Map) : null;
    final totals = ((result['totals'] as List?) ?? const []).map((e) => (e as num).toInt()).toList();
    const order = {'win': 0, 'none': 1, 'draw': 2, 'lose': 3};
    players.sort((a, b) {
      final oa = order[outcomes[a['id'].toString()]] ?? 4;
      final ob = order[outcomes[b['id'].toString()]] ?? 4;
      return oa != ob ? oa.compareTo(ob) : ((a['seat'] as num?) ?? 0).compareTo((b['seat'] as num?) ?? 0);
    });

    Widget line(int i, Map<String, dynamic> p) {
      final id = p['id'].toString();
      final outcome = outcomes[id]?.toString();
      final won = outcome == 'win';
      final delta = (deltas[id] as num?)?.toInt() ?? 0;
      final side = (p['side'] as num?)?.toInt() ?? 0;
      final label = switch (outcome) {
        'win' => 'ВЫИГРАЛ',
        'lose' => 'ПРОИГРАЛ',
        'draw' => 'НИЧЬЯ',
        _ => 'НИ ТО НИ ДРУГОЕ',
      };
      return TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: Duration(milliseconds: 500 + 250 * i),
        curve: Curves.easeOutBack,
        builder: (_, t, c) => Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.translate(offset: Offset(0, 14 * (1 - t)), child: c),
        ),
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: EdgeInsets.symmetric(horizontal: 10, vertical: won ? 11 : 8),
          decoration: BoxDecoration(
            color: won ? gold.withValues(alpha: 0.2) : Colors.white.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: won ? gold : (id == myId ? Colors.white54 : Colors.white12), width: won ? 2 : 1),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 30,
                child: Text(won ? '🏆' : '', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20)),
              ),
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(right: 6),
                decoration: BoxDecoration(color: shahSideColor(side), shape: BoxShape.circle),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(id == myId ? '${p['name']} (вы)' : p['name'].toString(),
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: won ? gold : Colors.white)),
                    Text(label,
                        style: TextStyle(
                          fontSize: 10,
                          letterSpacing: 1,
                          fontWeight: FontWeight.w900,
                          color: won ? gold : outcome == 'lose' ? Colors.redAccent : Colors.white60,
                        )),
                  ],
                ),
              ),
              if (!practice)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CoinIcon(size: 16),
                    const SizedBox(width: 4),
                    Text(
                      fmtDelta(delta),
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        color: delta > 0 ? Colors.greenAccent : delta < 0 ? Colors.redAccent : Colors.white70,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      );
    }

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
                  const Text('МАТЧ ОКОНЧЕН',
                      style: TextStyle(fontSize: 20, letterSpacing: 2, fontWeight: FontWeight.w900, color: gold)),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(shahCloseReasonText(room),
                        textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: Colors.white70)),
                  ),
                  if (practice)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text('Тренировка — монеты не изменились',
                          textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Colors.white60)),
                    ),
                  const SizedBox(height: 10),
                  for (var i = 0; i < players.length; i++) line(i, players[i]),
                  if (totals.isNotEmpty && game != null)
                    Text(
                      'Штрафы: ${[
                        for (var s = 0; s < totals.length; s++)
                          '${ShahScoreBoard.sideNames(game, players)[s]} ${fmtPenalty(totals[s])}',
                      ].join(' · ')}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 13, color: Colors.white70),
                    ),
                  const SizedBox(height: 6),
                  const Text('Нажмите, чтобы закрыть', style: TextStyle(fontSize: 12, color: Colors.white54)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
