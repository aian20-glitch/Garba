import 'package:flutter_test/flutter_test.dart';
import 'package:garba_mobile/main.dart';
import 'package:http/http.dart' as http;

void main() {
  test('ошибки сервера показываются игроку понятным текстом', () {
    final recovery = ApiFailure.fromResponse(
      http.Response('{"error":"invalid recovery credentials"}', 401),
    );
    expect(
      userErrorMessage(recovery),
      'Код игрока или код восстановления неверный.',
    );

    final balance = ApiFailure.fromResponse(
      http.Response(
        '{"error":"not enough coins to enter","minBalance":5000,"balance":1200}',
        403,
      ),
    );
    expect(
      userErrorMessage(balance),
      'Для входа нужно 5 000 монет. У вас 1 200.',
    );

    final busy = ApiFailure.fromResponse(
      http.Response(
        '{"error":"already in another room","roomId":"12345"}',
        409,
      ),
    );
    expect(
      userErrorMessage(busy),
      'Вы уже в комнате #12345. Вернитесь в неё с главного экрана.',
    );
  });

  test('технические ответы не попадают в интерфейс', () {
    final failure = ApiFailure.fromResponse(
      http.Response('<html>proxy error</html>', 502),
    );
    expect(
      userErrorMessage(failure),
      'Сервер временно недоступен. Попробуйте ещё раз.',
    );
  });
}
