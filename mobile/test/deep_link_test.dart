import 'package:flutter_test/flutter_test.dart';
import 'package:garba_mobile/main.dart';

// Ссылки garba:// (находка скептика, 28.09.2026): pathSegments раскодирует %2F и %3F,
// и чужая ссылка подменила бы адрес запроса — например, вывела бы игрока из игры.
void main() {
  String first(String link) => Uri.parse(link).pathSegments.first;

  test('обычные ссылки на комнату и приглашение проходят', () {
    expect(DeepLinks.validValue('room', first('garba://room/12345')), isTrue);
    expect(DeepLinks.validValue('invite', first('garba://invite/ER6XKJ')), isTrue);
  });

  test('ссылка с подменой адреса не проходит', () {
    final leave = first('garba://room/12345%2Fleave%3F');
    expect(leave, '12345/leave?');
    expect(DeepLinks.validValue('room', leave), isFalse);
    expect(DeepLinks.validValue('room', first('garba://room/12345%2Fconcede%3F')), isFalse);
    expect(DeepLinks.validValue('invite', first('garba://invite/..%2Fme')), isFalse);
  });

  test('старое состояние комнаты отбрасывается, без номера — принимается', () {
    expect(isStaleRoom({'version': 7}, {'version': 6}), isTrue);
    expect(isStaleRoom({'version': 7}, {'version': 7}), isFalse);
    expect(isStaleRoom({'version': 7}, {'version': 8}), isFalse);
    expect(isStaleRoom(null, {'version': 1}), isFalse);
    expect(isStaleRoom({'version': 7}, {}), isFalse);
  });
}
