import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform, SocketException;
import 'package:flutter/foundation.dart' show kDebugMode, kIsWeb, kReleaseMode;
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:app_links/app_links.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'tg/tg.dart';

// Приложение — одна библиотека Dart, разложенная по файлам (part): экраны в screens/,
// общие элементы в widgets/, адрес сервера и связь с ним — в core.dart.
part 'core.dart';
part 'screens/start.dart';
part 'screens/home.dart';
part 'screens/gift_invite.dart';
part 'screens/profile.dart';
part 'screens/rules.dart';
part 'screens/privacy.dart';
part 'screens/rating.dart';
part 'screens/create_join.dart';
part 'screens/open_rooms.dart';
part 'screens/lobby.dart';
part 'screens/dealer_selection.dart';
part 'screens/game_table.dart';
part 'widgets/kazakh.dart';
part 'widgets/deal_result.dart';
part 'widgets/cards.dart';
part 'widgets/common.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Только вертикально: круглый стол и карты в руке под горизонталь не рассчитаны.
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  // Внутри Telegram: во весь экран, свайп вниз не закрывает игру. На телефоне — ничего.
  Tg.ready();
  unawaited(GarbaSounds.init());
  runApp(const GarbaApp());
}

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
      navigatorKey: navigatorKey,
      navigatorObservers: [routeObserver],
      // Крупный системный шрифт — не больше ×1,2: дальше масть вылезает за карту, а на
      // маленьком iPhone кнопки под столом уходят за край экрана (28.09.2026).
      builder: (context, child) => MediaQuery.withClampedTextScaling(
        maxScaleFactor: 1.2,
        child: child!,
      ),
      home: const StartScreen(),
    );
  }
}
