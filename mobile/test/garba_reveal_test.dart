// Показ ГАРБЫ: дама, король и туз козыря, потом «ГАРБА!» на финальном ударе барабана.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:garba_mobile/main.dart';

void main() {
  testWidgets('ГАРБА: три карты козыря, надпись — после дроби', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: GarbaReveal(name: 'Аян', suit: 'hearts')),
    ));
    expect(find.text('Аян'), findsOneWidget);
    expect(find.byType(PlayingCardView), findsNWidgets(3));
    await tester.pump(const Duration(milliseconds: 1000));
    expect(find.text('ГАРБА!'), findsNothing);
    await tester.pump(const Duration(milliseconds: 1300));
    expect(find.text('ГАРБА!'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
