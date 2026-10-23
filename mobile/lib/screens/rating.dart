// Рейтинг: друзья, все игроки по рейтингу и по монетам, сверху — ТОП-3 недели
// (решение владельца, 23.10.2026, RULES.md §16.8).
part of '../main.dart';

class RatingScreen extends StatelessWidget {
  const RatingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      // Начинаем со всех игроков по рейтингу — общий рейтинг, как просил владелец.
      initialIndex: 1,
      child: Scaffold(
        appBar: backOnlyAppBar(
          bottom: const TabBar(
            tabs: [Tab(text: 'ДРУЗЬЯ'), Tab(text: 'РЕЙТИНГ'), Tab(text: 'МОНЕТЫ')],
          ),
        ),
        body: const Column(
          children: [
            WeekTopCard(),
            Expanded(
              child: TabBarView(
                children: [
                  RatingList(scope: 'friends'),
                  RatingList(scope: 'all'),
                  RatingList(scope: 'coins'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class RatingList extends StatefulWidget {
  final String scope;

  const RatingList({super.key, required this.scope});

  @override
  State<RatingList> createState() => _RatingListState();
}

class _RatingListState extends State<RatingList> {
  Map<String, dynamic>? board;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(
        Uri.parse('$apiBase/rating?scope=${widget.scope}'),
        headers: authHeaders(),
      );
      expectStatus(response, const [200]);
      if (!mounted) return;
      setState(() => board = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = board;
    if (b == null) {
      return Center(child: error == null ? const CircularProgressIndicator() : Text(error!));
    }
    final players = (b['players'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final myPlace = b['myPlace'];
    final total = b['total'];

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            switch (widget.scope) {
              'friends' => 'Ваше место среди друзей: $myPlace из $total',
              'coins' => 'Ваше место по монетам: $myPlace из $total',
              _ => 'Ваше место по рейтингу: $myPlace из $total',
            },
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
        ),
        if (widget.scope == 'friends' && total == 1)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Добавьте друзей по коду — и увидите, кто из вас сильнее.',
              style: TextStyle(color: Colors.white54),
            ),
          ),
        Expanded(
          child: ListView(
            children: players.map((p) {
              final isMe = p['me'] == true;
              return ListTile(
                tileColor: isMe ? const Color(0x33D4A94F) : null,
                leading: SizedBox(
                  width: 76,
                  child: Row(
                    children: [
                      SizedBox(
                        width: 28,
                        child: Text(
                          '${p['place']}',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            color: widget.scope != 'friends' && (p['place'] as num) <= 10
                                ? topColor((p['place'] as num).toInt())
                                : null,
                          ),
                        ),
                      ),
                      AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString(), frame: p['frame']?.toString()),
                    ],
                  ),
                ),
                title: Text(isMe ? '${p['name']} (вы)' : p['name'].toString()),
                trailing: widget.scope == 'coins'
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const CoinIcon(size: 18),
                          const SizedBox(width: 4),
                          Text(
                            fmtCoins((p['coins'] as num).toInt()),
                            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                          ),
                        ],
                      )
                    : RatingText(p['rating'], fontSize: 18),
                onTap: isMe
                    ? null
                    : () => Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => PlayerScreen(code: p['code'].toString())),
                        ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}

// ТОП-3 недели (§16.8): чистый плюс за столами с понедельника — бонусы и подарки не в счёт.
class WeekTopCard extends StatefulWidget {
  const WeekTopCard({super.key});

  @override
  State<WeekTopCard> createState() => _WeekTopCardState();
}

class _WeekTopCardState extends State<WeekTopCard> {
  Map<String, dynamic>? week;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/rating/week'), headers: authHeaders());
      expectStatus(response, const [200]);
      if (!mounted) return;
      setState(() => week = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      // Нет ТОПа недели — сам рейтинг всё равно виден ниже.
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = week;
    if (w == null) return const SizedBox.shrink();
    final players = (w['players'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final mine = (w['myCoins'] as num?)?.toInt() ?? 0;
    const medals = ['🥇', '🥈', '🥉'];

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: const Color(0x22D4A94F),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD4A94F), width: 1.2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'ТОП-3 НЕДЕЛИ',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFFD4A94F), fontWeight: FontWeight.w900, letterSpacing: 1.2),
          ),
          const SizedBox(height: 8),
          if (players.isEmpty)
            const Text(
              'На этой неделе в плюсе пока никого — сыграйте первым!',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70),
            )
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < players.length; i++)
                  Expanded(
                    child: InkWell(
                      onTap: players[i]['me'] == true
                          ? null
                          : () => Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => PlayerScreen(code: players[i]['code'].toString()),
                                ),
                              ),
                      child: Column(
                        children: [
                          Text(medals[i], style: const TextStyle(fontSize: 22)),
                          const SizedBox(height: 2),
                          AvatarView(
                            avatar: players[i]['avatar']?.toString(),
                            name: players[i]['name'].toString(),
                            frame: players[i]['frame']?.toString(),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            players[i]['me'] == true ? '${players[i]['name']} (вы)' : players[i]['name'].toString(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '+${fmtCoins((players[i]['coins'] as num).toInt())}',
                            style: const TextStyle(color: Color(0xFF7BD88F), fontWeight: FontWeight.w800),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 6),
          Text(
            'Ваш итог недели: ${fmtDelta(mine)} · счёт с понедельника',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white60, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
