// Рейтинг: друзья и все игроки.
part of '../main.dart';

class RatingScreen extends StatelessWidget {
  const RatingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: backOnlyAppBar(
          bottom: const TabBar(
            tabs: [Tab(text: 'ДРУЗЬЯ'), Tab(text: 'ВСЕ ИГРОКИ')],
          ),
        ),
        body: const TabBarView(
          children: [
            RatingList(scope: 'friends'),
            RatingList(scope: 'all'),
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
      if (response.statusCode != 200) throw Exception(response.body);
      if (!mounted) return;
      setState(() => board = jsonDecode(response.body) as Map<String, dynamic>);
    } catch (_) {
      if (mounted) setState(() => error = 'Нет связи с сервером');
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
            widget.scope == 'friends'
                ? 'Ваше место среди друзей: $myPlace из $total'
                : 'Ваше место среди всех игроков: $myPlace из $total',
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
                        child: Text('${p['place']}', style: const TextStyle(fontWeight: FontWeight.w800)),
                      ),
                      AvatarView(avatar: p['avatar']?.toString(), name: p['name'].toString()),
                    ],
                  ),
                ),
                title: Text(isMe ? '${p['name']} (вы)' : p['name'].toString()),
                trailing: Text(
                  '⭐ ${fmtRating(p['rating'])}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFFD4A94F)),
                ),
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
