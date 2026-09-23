// Запуск с локальным backend: flutter test integration_test/ios_smoke_test.dart -d <device>.
// Отдельные тестовые аккаунты; сохранённый аккаунт владельца восстанавливается.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:garba_mobile/main.dart' as app;
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('iPhone: экраны, ссылки, партии на 4 и 7 игроков', (tester) async {
    Future<Map<String, dynamic>> request(String method, String path,
        {String? token, Map<String, dynamic>? body}) async {
      final req = http.Request(method, Uri.parse('${app.apiBase}$path'));
      req.headers['Content-Type'] = 'application/json';
      if (token != null) req.headers['Authorization'] = 'Bearer $token';
      if (body != null) req.body = jsonEncode(body);
      final res = await http.Response.fromStream(await req.send());
      expect(res.statusCode, inInclusiveRange(200, 299), reason: '$method $path: ${res.body}');
      return Map<String, dynamic>.from(jsonDecode(res.body) as Map);
    }

    Future<void> waitFor(Finder finder) async {
      for (var i = 0; i < 100 && finder.evaluate().isEmpty; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(finder, findsWidgets);
      await tester.pump(const Duration(milliseconds: 400));
      expect(tester.takeException(), isNull);
    }

    Future<void> tapText(String text) async {
      final target = find.text(text).last;
      await waitFor(target);
      await tester.ensureVisible(target);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.tap(target);
      await tester.pump(const Duration(milliseconds: 500));
    }

    Future<void> screenshot(String name) async {
      final bytes = await binding.takeScreenshot(name);
      await File('${Directory.systemTemp.path}/garba-$name.png').writeAsBytes(bytes);
    }

    await app.Session.load();
    final saved = {'id': app.Session.id, 'name': app.Session.name, 'token': app.Session.token};
    final sockets = <io.Socket>[];
    final accounts = <Map<String, dynamic>>[];
    try {
      for (var i = 0; i < 7; i++) {
        accounts.add(await request('POST', '/accounts', body: {'name': 'iOS тест ${i + 1}'}));
      }
      final me = accounts.first;
      await app.Session.save(me);
      await request('POST', '/me/daily-bonus', token: me['token'], body: {});
      await app.main();
      await tester.pump();
      await waitFor(find.text('СОЗДАТЬ КОМНАТУ'));
      await screenshot('home');

      for (final screen in [
        ('ПРОФИЛЬ', app.ProfileScreen),
        ('ДРУЗЬЯ', app.FriendsScreen),
        ('РЕЙТИНГ', app.RatingScreen),
        ('ПРАВИЛА', app.RulesScreen),
        ('ПОДАРИТЬ МОНЕТЫ', app.GiftScreen),
        ('ПРИГЛАСИТЬ ДРУГА', app.InviteScreen),
        ('ОТКРЫТЫЕ КОМНАТЫ', app.OpenRoomsScreen),
        ('ВОЙТИ ПО КОДУ', app.JoinRoomScreen),
        ('СОЗДАТЬ КОМНАТУ', app.CreateRoomScreen),
      ]) {
        await tapText(screen.$1);
        await waitFor(find.byType(screen.$2));
        await tester.pump(const Duration(seconds: 1));
        expect(tester.takeException(), isNull, reason: screen.$1);
        app.navigatorKey.currentState!.pop();
        await tester.pump(const Duration(milliseconds: 500));
      }

      for (final capacity in [4, 7]) {
        final room = await request('POST', '/rooms', token: me['token'], body: {
          'capacity': capacity, 'ante': 100, 'emptyLimit': 5,
          'konThreshold': 10, 'minBalance': 1000,
        });
        final id = room['id'].toString();
        for (final account in accounts.take(capacity)) {
          if (account != me) {
            await request('POST', '/rooms/$id/join', token: account['token'], body: {});
          }
          final socket = io.io(app.apiBase, io.OptionBuilder()
              .setTransports(['websocket']).enableForceNew().disableAutoConnect().build());
          socket.onConnect((_) => socket.emit('watch', {'roomId': id, 'token': account['token']}));
          socket.connect();
          sockets.add(socket);
        }
        app.DeepLinks.handle(Uri.parse('garba://room/$id'));
        // Приглашение само отправляет запрос входа после первого кадра.
        await waitFor(find.byType(app.LobbyScreen));
        await screenshot('lobby-$capacity');
        // Комната набралась — остальные жмут «ГОТОВ» через API, я — кнопкой.
        for (final account in accounts.take(capacity)) {
          if (account != me) {
            await request('POST', '/rooms/$id/ready', token: account['token'], body: {});
          }
        }
        final readyButton = find.textContaining('ГОТОВ ·').last;
        await waitFor(readyButton);
        await tester.ensureVisible(readyButton);
        await tester.tap(readyButton);
        await tester.pump(const Duration(milliseconds: 500));
        await waitFor(find.byType(app.DealerSelectionScreen));

        var played = 0;
        var done = false;
        final seen = <String>{};
        for (var step = 0; step < 220; step++) {
          final state = await request('GET', '/rooms/$id', token: me['token']);
          final game = state['game'] as Map;
          final stage = game['stage'] as String;
          await tester.pump(const Duration(milliseconds: 150));
          expect(tester.takeException(), isNull, reason: '$capacity игроков, $stage');
          if (stage != 'dealer_found' && seen.add(stage)) {
            await tester.pump(const Duration(milliseconds: 500));
            await screenshot('table-$capacity-$stage');
          }
          if (state['status'] == 'finished') { done = true; break; }
          if (played > 0 && (stage == 'round_done' || stage == 'awaiting_deal')) {
            for (final account in accounts.take(capacity)) {
              await request('POST', '/rooms/$id/end-game', token: account['token'], body: {'choice': 'yes'});
            }
            continue;
          }
          var acted = false;
          for (final account in accounts.take(capacity)) {
            final own = await request('GET', '/rooms/$id', token: account['token']);
            final g = own['game'] as Map;
            String? action;
            Map<String, dynamic> body = {};
            switch (g['stage']) {
              case 'dealer_found':
              case 'awaiting_deal':
              case 'round_done':
                if (g['dealerId'] == account['id']) action = 'dealer/continue';
              case 'bidding':
                final bids = (g['myAllowedBids'] as List?) ?? [];
                if (bids.isNotEmpty) {
                  action = 'bid';
                  body = {'bid': bids.contains('РАЗ') ? 'РАЗ' : 'ПАС'};
                }
              case 'special':
                if (g['special']['activeId'] == account['id']) {
                  action = 'special'; body = {'action': 'pass'};
                }
              case 'playing':
                final cards = (g['myPlayableCardIds'] as List?) ?? [];
                if (cards.isNotEmpty) {
                  action = 'play'; body = {'cardId': cards.first}; played++;
                }
              case 'vote':
                if (g['myVote'] == null) { action = 'vote'; body = {'choice': 'split'}; }
            }
            if (action != null) {
              await request('POST', '/rooms/$id/$action', token: account['token'], body: body);
              acted = true;
              break;
            }
          }
          expect(acted, isTrue, reason: 'Нет доступного действия: $stage');
        }
        expect(done, isTrue, reason: 'Партия $capacity игроков должна завершиться');
        expect(played, greaterThan(0));
        await tester.pump(const Duration(seconds: 2));
        expect(tester.takeException(), isNull);
        await screenshot('result-$capacity');
        // Закрываем окно результата перед возвратом в меню.
        app.navigatorKey.currentState!.pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const app.HomeScreen()), (_) => false);
        await tester.pump(const Duration(seconds: 1));
        for (final socket in sockets) { socket.dispose(); }
        sockets.clear();
      }
    } finally {
      for (final socket in sockets) { socket.dispose(); }
      await tester.pumpWidget(const SizedBox.shrink());
      if (saved['token']!.isEmpty) {
        await app.Session.clear();
      } else {
        await app.Session.save(saved);
      }
    }
  }, timeout: const Timeout(Duration(minutes: 8)));
}
