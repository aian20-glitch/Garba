// Стол, за которым никого не осталось (все ушли — сервер закрыл комнату с пустым
// списком игроков): вместо серого экрана — «Игра закончилась» (28.09.2026).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:garba_mobile/main.dart';

void main() {
  testWidgets('пустой стол после закрытия — экран «Игра закончилась», без ошибок',
      (tester) async {
    tester.view.physicalSize = const Size(750, 1334); // iPhone SE: 375×667
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const MaterialApp(
      home: GameTableScreen(roomCode: '12345', currentPlayerId: 'p0'),
    ));

    final errors = <String>[];
    final old = FlutterError.onError;
    FlutterError.onError = (d) => errors.add(d.exceptionAsString());
    final state = tester.state(find.byType(GameTableScreen)) as dynamic;
    state.applyRoom(<String, dynamic>{
      'id': '12345',
      'capacity': 4,
      'status': 'finished',
      'version': 10,
      'settings': {'turnSeconds': 20},
      'players': [],
      'pause': null,
      'game': {
        'stage': 'room_done',
        'closeReason': 'seat_empty',
        'dealerId': 'p1',
        'dealerName': 'Дана',
        'dealNumber': 3,
        'kon': 0,
        'mains': [],
        'hand': [],
        'handCounts': {},
        'currentTrick': [],
        'playedTricks': [],
        'tricksWon': {},
        'result': [],
        'winnerIds': [],
      },
    });
    await tester.pump(const Duration(milliseconds: 50));
    FlutterError.onError = old;

    expect(errors, isEmpty);
    expect(find.text('Игра закончилась'), findsOneWidget);

    // Экран закрыт — таймеры и сокет стола освобождаются.
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 6));
  });
}
