// Локальная подготовка ручной проверки: flutter run -t tool/prepare_manual.dart.
// Затем tools/garba join <номер из журнала> подключает ботов; когда комната
// заполнится, этот запуск сам нажмёт «НАЧАТЬ ИГРУ».
import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:garba_mobile/main.dart' as app;
import 'package:http/http.dart' as http;

const manualCapacity = int.fromEnvironment(
  'GARBA_CAPACITY',
  defaultValue: 6,
);

Future<void> startWhenFull(String roomId) async {
  for (var attempt = 0; attempt < 180; attempt++) {
    await Future<void>.delayed(const Duration(seconds: 1));
    final room = await http.get(
      Uri.parse('${app.apiBase}/rooms/$roomId'),
      headers: app.authHeaders(),
    );
    if (room.statusCode != 200) continue;
    final data = jsonDecode(room.body) as Map<String, dynamic>;
    if (data['status'] == 'started') {
      final game = data['game'];
      if (game is Map &&
          game['stage'] == 'dealer_found' &&
          game['dealerId']?.toString() == app.Session.id) {
        final response = await http.post(
          Uri.parse('${app.apiBase}/rooms/$roomId/deal'),
          headers: app.authHeaders(),
          body: '{}',
        );
        debugPrint('GARBA_MANUAL_DEALT=$roomId (${response.statusCode})');
      }
      return;
    }
    final players = (data['players'] as List?)?.length ?? 0;
    final capacity = (data['capacity'] as num?)?.toInt() ?? 0;
    if (players != capacity) continue;

    final response = await http.post(
      Uri.parse('${app.apiBase}/rooms/$roomId/start'),
      headers: app.authHeaders(),
      body: '{}',
    );
    if (response.statusCode == 200) {
      debugPrint('GARBA_MANUAL_STARTED=$roomId');
      continue;
    }
    debugPrint('Не удалось автоматически начать игру: ${response.statusCode}');
    return;
  }
  debugPrint('Комната не заполнилась за 3 минуты');
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kDebugMode || !['localhost', '127.0.0.1', '10.0.2.2'].contains(Uri.parse(app.apiBase).host)) {
    throw StateError('Подготовка разрешена только для локальной отладки');
  }
  await app.Session.load();
  if (app.Session.token.isEmpty) {
    final response = await http.post(Uri.parse('${app.apiBase}/accounts'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'name': 'Игрок iPhone'}));
    if (response.statusCode != 201) throw StateError('Не удалось создать аккаунт');
    await app.Session.save(jsonDecode(response.body) as Map<String, dynamic>);
  }
  final me = await http.get(Uri.parse('${app.apiBase}/me'), headers: app.authHeaders());
  if (me.statusCode != 200) throw StateError('Не удалось проверить сохранённый аккаунт');
  var roomId = (jsonDecode(me.body) as Map)['roomId']?.toString();
  if (roomId == null) {
    final response = await http.post(Uri.parse('${app.apiBase}/rooms'),
        headers: app.authHeaders(), body: jsonEncode({
          'capacity': manualCapacity, 'ante': 100, 'emptyLimit': 5,
          'konThreshold': 10, 'minBalance': 1000,
        }));
    if (response.statusCode != 201 && response.statusCode != 200) {
      throw StateError('Не удалось создать комнату: ${response.statusCode}');
    }
    roomId = (jsonDecode(response.body) as Map)['id'].toString();
  }
  debugPrint('GARBA_MANUAL_ROOM=$roomId');
  app.DeepLinks.pending = Uri.parse('garba://room/$roomId');
  await app.main();
  unawaited(startWhenFull(roomId));
}
