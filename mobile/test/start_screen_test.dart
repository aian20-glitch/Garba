import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:garba_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('Вход на небольшом iPhone: клавиатура не скрывает форму', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(375, 667);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetViewInsets);

    await tester.pumpWidget(const MaterialApp(home: StartScreen()));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(TextField).first);
    tester.view.viewInsets = const FakeViewPadding(bottom: 336);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.ensureVisible(find.text('НАЧАТЬ'));
    await tester.pumpAndSettle();
    expect(find.text('НАЧАТЬ').hitTestable(), findsOneWidget);
    await tester.ensureVisible(find.byType(TextField).last);
    await tester.enterText(find.byType(TextField).last, 'FRIEND');
    expect(find.text('FRIEND'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
