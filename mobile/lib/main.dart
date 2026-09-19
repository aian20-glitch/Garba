import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:app_links/app_links.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

// Приложение — одна библиотека Dart, разложенная по файлам (part): экраны в screens/,
// общие элементы в widgets/, адрес сервера и связь с ним — в core.dart.
part 'core.dart';
part 'screens/start.dart';
part 'screens/home.dart';
part 'screens/gift_invite.dart';
part 'screens/profile.dart';
part 'screens/rules.dart';
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

void main() => runApp(const GarbaApp());

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
      home: const StartScreen(),
    );
  }
}
