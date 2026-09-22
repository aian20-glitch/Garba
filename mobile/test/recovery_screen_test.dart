import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:garba_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('форма восстановления помещается на небольшом телефоне',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(375, 667);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);

    await tester.pumpWidget(const MaterialApp(home: StartScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ВОССТАНОВИТЬ АККАУНТ'));
    await tester.pumpAndSettle();

    expect(find.text('Восстановление аккаунта'), findsOneWidget);
    expect(find.text('Код игрока'), findsOneWidget);
    expect(find.text('Код восстановления'), findsOneWidget);
    expect(find.text('ВОССТАНОВИТЬ'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
