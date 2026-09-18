import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

const apiBase = 'http://10.0.2.2:3000';

void main() => runApp(const GarbaApp());

class GarbaApp extends StatelessWidget {
  const GarbaApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'ГАРБА',
      theme: ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF07131B),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFD4A94F),
          brightness: Brightness.dark,
        ),
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('ГАРБА',
                    style: TextStyle(
                      fontSize: 38,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFFD4A94F),
                    ),
                  ),
                  Text('🪙 10 000',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              const Text('Казахская карточная онлайн-игра',
                style: TextStyle(color: Colors.white70),
              ),
              const Spacer(),
              GarbaButton(
                label: 'СОЗДАТЬ КОМНАТУ',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const CreateRoomScreen()),
                ),
              ),
              const SizedBox(height: 14),
              GarbaButton(
                label: 'ВОЙТИ ПО КОДУ',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const JoinRoomScreen()),
                ),
              ),
              const SizedBox(height: 14),
              GarbaButton(label: 'РЕЙТИНГ', onTap: () {}),
              const SizedBox(height: 14),
              GarbaButton(label: 'ПРОФИЛЬ', onTap: () {}),
              const Spacer(),
              const Text(
                'Игровые монеты являются виртуальными единицами и не имеют денежного эквивалента.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CreateRoomScreen extends StatefulWidget {
  const CreateRoomScreen({super.key});
  @override
  State<CreateRoomScreen> createState() => _CreateRoomScreenState();
}

class _CreateRoomScreenState extends State<CreateRoomScreen> {
  int capacity = 5;
  bool loading = false;

  Future<void> createRoom() async {
    if (loading) return;
    setState(() => loading = true);
    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'playerId': 'player-serik',
          'name': 'Серик',
          'capacity': capacity,
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final roomId = data['id'].toString();

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: roomId,
            capacity: capacity,
            playerNames: const ['Серик'],
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка создания комнаты: $e')),
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Создать комнату')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Количество игроков',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [4, 5, 6, 7].map((n) {
                return ChoiceChip(
                  label: Text('$n игроков'),
                  selected: capacity == n,
                  onSelected: (_) => setState(() => capacity = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 28),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Комната создаётся на сервере. Друзья смогут войти по коду комнаты.',
                  style: TextStyle(color: Colors.white70),
                ),
              ),
            ),
            const Spacer(),
            GarbaButton(
              label: loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ',
              onTap: createRoom,
            ),
          ],
        ),
      ),
    );
  }
}

class JoinRoomScreen extends StatefulWidget {
  const JoinRoomScreen({super.key});
  @override
  State<JoinRoomScreen> createState() => _JoinRoomScreenState();
}

class _JoinRoomScreenState extends State<JoinRoomScreen> {
  final roomController = TextEditingController();
  final nameController = TextEditingController(text: 'Игрок 2');
  bool loading = false;

  Future<void> joinRoom() async {
    final roomId = roomController.text.trim();
    final name = nameController.text.trim();
    if (roomId.isEmpty || name.isEmpty || loading) return;

    setState(() => loading = true);
    try {
      final response = await http.post(
        Uri.parse('$apiBase/rooms/$roomId/join'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'playerId': 'player-${DateTime.now().millisecondsSinceEpoch}',
          'name': name,
        }),
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(response.body);
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final capacity = (data['capacity'] as num).toInt();
      final players = (data['players'] as List)
          .map((p) => (p as Map<String, dynamic>)['name'].toString())
          .toList();

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: roomId,
            capacity: capacity,
            playerNames: players,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка входа: $e')),
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    roomController.dispose();
    nameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Войти по коду')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: roomController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Код комнаты',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: nameController,
              decoration: const InputDecoration(
                labelText: 'Имя игрока',
                border: OutlineInputBorder(),
              ),
            ),
            const Spacer(),
            GarbaButton(
              label: loading ? 'ВХОДИМ...' : 'ВОЙТИ',
              onTap: joinRoom,
            ),
          ],
        ),
      ),
    );
  }
}

class LobbyScreen extends StatelessWidget {
  final String roomCode;
  final int capacity;
  final List<String> playerNames;

  const LobbyScreen({
    super.key,
    required this.roomCode,
    required this.capacity,
    required this.playerNames,
  });

  @override
  Widget build(BuildContext context) {
    final empty = capacity - playerNames.length;
    return Scaffold(
      appBar: AppBar(title: Text('Комната #$roomCode')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${playerNames.length} / $capacity игроков',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            Text('Код комнаты: $roomCode',
              style: const TextStyle(
                fontSize: 20,
                color: Color(0xFFD4A94F),
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 22),
            ...playerNames.map((name) => PlayerTile(
              name: name,
              subtitle: name == 'Серик' ? 'Создатель • Готов' : 'Игрок • Готов',
              ready: true,
            )),
            ...List.generate(
              empty < 0 ? 0 : empty,
              (_) => const PlayerTile(
                name: 'Свободное место',
                subtitle: 'Ожидание игрока',
                ready: false,
              ),
            ),
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Код комнаты: $roomCode')),
                );
              },
              icon: const Icon(Icons.share),
              label: const Text('ПРИГЛАСИТЬ'),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: null,
              icon: const Icon(Icons.play_arrow),
              label: const Text('НАЧАТЬ ИГРУ'),
            ),
          ],
        ),
      ),
    );
  }
}

class PlayerTile extends StatelessWidget {
  final String name;
  final String subtitle;
  final bool ready;

  const PlayerTile({
    super.key,
    required this.name,
    required this.subtitle,
    required this.ready,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          child: Icon(ready ? Icons.person : Icons.person_outline),
        ),
        title: Text(name),
        subtitle: Text(subtitle),
        trailing: Icon(
          ready ? Icons.check_circle : Icons.hourglass_empty,
          color: ready ? Colors.greenAccent : Colors.white38,
        ),
      ),
    );
  }
}

class GarbaButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const GarbaButton({
    super.key,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 58,
      child: FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFD4A94F),
          foregroundColor: Colors.black,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}
