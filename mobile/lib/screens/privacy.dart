// Политика конфиденциальности (26.09.2026) — её требуют App Store и Google Play внутри
// приложения. Текст один на всех — берём с сервера (GET /privacy?format=json).
part of '../main.dart';

class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key});

  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  List<Map<String, dynamic>>? sections;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final response = await http.get(Uri.parse('$apiBase/privacy?format=json'));
      expectStatus(response, const [200]);
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => sections = (body['sections'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList());
    } catch (e) {
      if (mounted) setState(() => error = userErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = sections;
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(20), child: Text(error!)))
          : list == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 30),
                  children: [
                    const Text(
                      'Политика конфиденциальности',
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Color(0xFFD4A94F)),
                    ),
                    for (final s in list) ...[
                      const SizedBox(height: 18),
                      Text(s['title'].toString(),
                          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                      for (final p in (s['body'] as List))
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(p.toString(), style: const TextStyle(color: Colors.white70, height: 1.4)),
                        ),
                    ],
                  ],
                ),
    );
  }
}
