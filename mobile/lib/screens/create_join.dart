// Создать комнату и войти по коду.
part of '../main.dart';

class CreateRoomScreen extends StatefulWidget {
  const CreateRoomScreen({super.key});

  @override
  State<CreateRoomScreen> createState() => _CreateRoomScreenState();
}

class _CreateRoomScreenState extends State<CreateRoomScreen> {
  int capacity = 5;
  // Взнос и лимит пустых раздач выбирает создатель (RULES.md §9.1, §9.3).
  int ante = 100;
  int emptyLimit = 5;
  // КОН открывается, когда кон достигнет базового × konThreshold (RULES.md §6.7).
  int konThreshold = 10;
  // Сумма за стол — минимум для входа: любая кратно 1 000, не меньше взноса × 10
  // (RULES.md §9.1a; с 22.10.2026 не только 1 000…10 000, а и 25 000, 50 000, 100 000…).
  int minBalance = 1000;
  static const maxEntry = 10000000; // как MAX_ENTRY в backend/src/money.ts
  static const entryPresets = [1000, 5000, 10000, 25000, 50000, 100000];
  // Время на ход: 20 или 40 секунд (RULES.md §13a).
  int turnSeconds = 20;
  // Запас на отлучку за игру: 1…5 минут (RULES.md §13, 08.10.2026), по умолчанию 1.
  int absenceMinutes = 1;
  // Время игры (RULES.md §20, 01.11.2026): 30 / 60 / 90 минут, своё 15…180 или null —
  // без ограничения. По умолчанию 60.
  int? timeLimit = 60;
  // Открытая — видна всем в «Открытых комнатах», войти можно без кода.
  bool isPublic = false;
  bool loading = false;

  int get lowestEntry => ante * 10 < 1000 ? 1000 : ante * 10;

  void setAnte(int value) {
    setState(() {
      ante = value;
      // Подняли взнос — минимум для входа подтягивается следом.
      if (minBalance < lowestEntry) minBalance = lowestEntry;
    });
  }

  // Своя сумма за стол: вписать любую, кратно 1 000. null — передумал.
  Future<void> askCustomEntry() async {
    final value = await showDialog<int>(
      context: context,
      builder: (_) => _CustomEntryDialog(
        initial: entryPresets.contains(minBalance) ? null : minBalance,
        lowest: lowestEntry,
        ante: ante,
        max: maxEntry,
      ),
    );
    if (value != null && mounted) setState(() => minBalance = value);
  }

  // Своё время игры: 15…180 минут. null — передумал.
  Future<void> askCustomTime() async {
    final value = await showDialog<int>(
      context: context,
      builder: (_) => _CustomTimeDialog(
        initial: timeLimit != null && !tableTimePresets.contains(timeLimit) ? timeLimit : null,
      ),
    );
    if (value != null && mounted) setState(() => timeLimit = value);
  }

  Future<void> createRoom() async {
    if (loading) return;
    setState(() => loading = true);

    try {
      // Сколько взять за стол — от минимума комнаты до всего баланса (09.10.2026).
      final buyIn = await askBuyIn(context, minBalance: minBalance);
      if (buyIn == null) return;
      final response = await http.post(
        Uri.parse('$apiBase/rooms'),
        headers: authHeaders(),
        body: jsonEncode({
          'capacity': capacity,
          'ante': ante,
          'emptyLimit': emptyLimit,
          'konThreshold': konThreshold,
          'minBalance': minBalance,
          'turnSeconds': turnSeconds,
          'absenceMinutes': absenceMinutes,
          'timeLimitMinutes': timeLimit,
          'isPublic': isPublic,
          'buyIn': buyIn,
        }),
      );

      final busy = busyInRoomMessage(response);
      if (busy != null) throw Exception(busy);

      if (response.statusCode == 403) {
        final err = jsonDecode(response.body);
        if (err is Map && err['error'] == 'not enough coins to enter') {
          throw Exception(
            'Недостаточно монет: минимум комнаты ${fmtCoins((err['minBalance'] as num).toInt())}, '
            'у вас ${fmtCoins((err['balance'] as num).toInt())}',
          );
        }
      }

      // Время игры вне 15…180 — сервер скажет то же, что окно «Своё время» (§20).
      if (response.statusCode == 400) {
        final err = jsonDecode(response.body);
        if (err is Map && err['error'] == 'time limit too short') {
          throw Exception('Минимальное время стола — $tableTimeMin минут');
        }
        if (err is Map && err['error'] == 'time limit too long') {
          throw Exception('Максимальное время стола — 3 часа');
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiFailure.fromResponse(response);
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: data['id'].toString(),
            currentPlayerId: Session.id,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось создать комнату');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      // Настроек четыре блока — на небольшом экране они не влезут,
      // поэтому прокручиваем их, а кнопка создания всегда видна внизу.
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: isPublic,
              onChanged: (v) => setState(() => isPublic = v),
              title: const Text(
                'Открытая комната',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                isPublic
                    ? 'Видна всем в «Открытых комнатах» — зайти может любой, без кода'
                    : 'Только по коду — для своих. Открыть можно и потом, в лобби',
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Количество игроков',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [4, 5, 6, 7].map((n) {
                return ChoiceChip(
                  label: Text('$n игроков'),
                  selected: capacity == n,
                  onSelected: (_) => setState(() => capacity = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 24),
            const Text(
              'Время игры',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ...tableTimePresets.map((n) {
                  return ChoiceChip(
                    label: Text('$n мин'),
                    selected: timeLimit == n,
                    onSelected: (_) => setState(() => timeLimit = n),
                  );
                }),
                ChoiceChip(
                  label: Text(timeLimit != null && !tableTimePresets.contains(timeLimit)
                      ? fmtTimeLimit(timeLimit)
                      : 'СВОЁ ВРЕМЯ'),
                  avatar: const Icon(Icons.edit, size: 16),
                  selected: timeLimit != null && !tableTimePresets.contains(timeLimit),
                  onSelected: (_) => askCustomTime(),
                ),
                ChoiceChip(
                  label: const Text('Без ограничения'),
                  selected: timeLimit == null,
                  onSelected: (_) => setState(() => timeLimit = null),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              timeLimit == null
                  ? 'Играете, пока кон не заберут или не решите закончить'
                  : 'Время пойдёт с первой раздачи. За 5 минут до конца все решают, продлить ли на 10 минут — '
                      'только если согласны все. Время вышло посреди раздачи — её доигрывают',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Взнос в кон',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
                  .map((n) {
                return ChoiceChip(
                  label: Text('$n'),
                  selected: ante == n,
                  onSelected: (_) => setAnte(n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Базовый кон: $capacity × $ante = ${capacity * ante} монет',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Сумма за стол',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ...entryPresets.map((n) {
                  // Меньше взноса × 10 выбрать нельзя — кнопка выключена.
                  final allowed = n >= lowestEntry;
                  return ChoiceChip(
                    label: Text(fmtPrice(n)),
                    selected: minBalance == n,
                    onSelected: allowed ? (_) => setState(() => minBalance = n) : null,
                  );
                }),
                // Любая своя сумма — вписать (решение владельца, 22.10.2026).
                ChoiceChip(
                  label: Text(entryPresets.contains(minBalance) ? 'СВОЯ СУММА' : fmtPrice(minBalance)),
                  avatar: const Icon(Icons.edit, size: 16),
                  selected: !entryPresets.contains(minBalance),
                  onSelected: (_) => askCustomEntry(),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Игроки садятся за стол с ${fmtPrice(minBalance)} (можно взять и больше). '
              'У кого меньше — в комнату не войдёт. '
              'При взносе $ante — не меньше ${fmtPrice(lowestEntry)}.',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Лимит пустых раздач подряд',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [3, 4, 5, 6, 7, 8, 9, 10].map((n) {
                return ChoiceChip(
                  label: Text('$n'),
                  selected: emptyLimit == n,
                  onSelected: (_) => setState(() => emptyLimit = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            const Text(
              'Сколько раз подряд все доливают в кон, если никто не взялся играть',
              style: TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Когда открывается КОН',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [3, 4, 5, 6, 7, 8, 9, 10].map((n) {
                return ChoiceChip(
                  label: Text('×$n'),
                  selected: konThreshold == n,
                  onSelected: (_) => setState(() => konThreshold = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Играть на базовый кон можно, когда кон дорастёт до '
              '${fmtCoins(capacity * ante * konThreshold)}',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Время на ход',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [20, 40].map((n) {
                return ChoiceChip(
                  label: Text('$n секунд'),
                  selected: turnSeconds == n,
                  onSelected: (_) => setState(() => turnSeconds = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            const Text(
              'Не успел — за игрока сходит игра: в торгах ПАС, в розыгрыше — любая допустимая карта',
              style: TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 24),
            const Text(
              'Сколько ждать отошедшего',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [1, 2, 3, 4, 5].map((n) {
                return ChoiceChip(
                  label: Text('$n мин'),
                  selected: absenceMinutes == n,
                  onSelected: (_) => setState(() => absenceMinutes = n),
                );
              }).toList(),
            ),
            const SizedBox(height: 6),
            Text(
              'Игрок пропал или не ходит — игра ждёт его $absenceMinutes мин за всю игру. '
              'Не вернулся — игра заканчивается, кон делят остальные',
              style: const TextStyle(color: Colors.white60),
            ),
          ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: GarbaButton(
                label: loading ? 'СОЗДАЁМ...' : 'СОЗДАТЬ КОМНАТУ',
                onTap: createRoom,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class JoinRoomScreen extends StatefulWidget {
  // Номер комнаты из ссылки-приглашения — тогда входим сразу.
  final String? initialCode;

  const JoinRoomScreen({super.key, this.initialCode});

  @override
  State<JoinRoomScreen> createState() => _JoinRoomScreenState();
}

class _JoinRoomScreenState extends State<JoinRoomScreen> {
  final roomController = TextEditingController();
  bool loading = false;

  @override
  void initState() {
    super.initState();
    final code = widget.initialCode;
    if (code != null && code.isNotEmpty) {
      roomController.text = code;
      WidgetsBinding.instance.addPostFrameCallback((_) => joinRoom());
    }
  }

  Future<void> joinRoom() async {
    final roomId = roomController.text.trim();

    if (roomId.isEmpty || loading) return;

    setState(() => loading = true);

    try {
      // Сначала — минимум комнаты, чтобы спросить, сколько взять за стол (09.10.2026).
      // Уже сижу в ней — просто возвращаюсь, ничего не спрашиваем.
      final peek = await apiRequest(http.get(
        Uri.parse('$apiBase/rooms/${Uri.encodeComponent(roomId)}'),
        headers: authHeaders(),
      ));
      if (peek.statusCode != 200) throw ApiFailure.fromResponse(peek);
      final info = jsonDecode(peek.body) as Map<String, dynamic>;
      final seated = (info['players'] as List).any((p) => (p as Map)['id']?.toString() == Session.id);
      int? buyIn;
      if (!seated) {
        if (!mounted) return;
        buyIn = await askBuyIn(
          context,
          minBalance: ((info['settings'] as Map)['minBalance'] as num).toInt(),
          settings: info['settings'] as Map,
        );
        if (buyIn == null) return;
      }

      // Кто входит — сервер знает по токену, имя берётся из аккаунта.
      final response = await http.post(
        Uri.parse('$apiBase/rooms/${Uri.encodeComponent(roomId)}/join'),
        headers: authHeaders(),
        body: jsonEncode({if (buyIn != null) 'buyIn': buyIn}),
      );

      final busy = busyInRoomMessage(response);
      if (busy != null) throw Exception(busy);

      // Не хватает монет на минимум комнаты (RULES.md §9.1a) — говорим прямо.
      if (response.statusCode == 403) {
        final err = jsonDecode(response.body);
        if (err is Map && err['error'] == 'not enough coins to enter') {
          throw Exception(
            'Недостаточно монет для входа: нужно ${fmtCoins((err['minBalance'] as num).toInt())}, '
            'у вас ${fmtCoins((err['balance'] as num).toInt())}',
          );
        }
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiFailure.fromResponse(response);
      }

      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => LobbyScreen(
            roomCode: roomId,
            currentPlayerId: Session.id,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showGarbaError(context, e, prefix: 'Не удалось войти');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    roomController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: backOnlyAppBar(),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: roomController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Код комнаты',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Вы войдёте как ${Session.name}',
              style: const TextStyle(color: Colors.white70),
            ),
            const Spacer(),
            GarbaButton(
              label: loading ? 'ВХОДИМ...' : 'ВОЙТИ',
              onTap: joinRoom,
            ),
          ],
        ),
      ),
    );
  }
}

// Окно «Своя сумма за стол». Поле ввода живёт, пока живёт окно: окно закрывается с анимацией,
// и всё это время поле ещё на экране — выбросить его контроллер сразу после закрытия значило
// уронить экран (так и было, нашли на эмуляторе 22.10.2026).
class _CustomEntryDialog extends StatefulWidget {
  final int? initial; // уже вписанная своя сумма — или пусто
  final int lowest; // не меньше взноса × 10
  final int ante;
  final int max;

  const _CustomEntryDialog({required this.initial, required this.lowest, required this.ante, required this.max});

  @override
  State<_CustomEntryDialog> createState() => _CustomEntryDialogState();
}

class _CustomEntryDialogState extends State<_CustomEntryDialog> {
  late final controller = TextEditingController(text: widget.initial?.toString() ?? '');
  String? error;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  void submit() {
    final v = int.tryParse(controller.text.replaceAll(RegExp(r'\s'), ''));
    if (v == null || v % 1000 != 0) {
      setState(() => error = 'Сумма — кратно 1 000');
    } else if (v < widget.lowest) {
      setState(() => error = 'При взносе ${widget.ante} — не меньше ${fmtPrice(widget.lowest)}');
    } else if (v > widget.max) {
      setState(() => error = 'Не больше ${fmtPrice(widget.max)}');
    } else {
      Navigator.pop(context, v);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Своя сумма за стол'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onSubmitted: (_) => submit(),
            decoration: InputDecoration(
              hintText: 'например, 25000',
              suffixText: 'монет',
              errorText: error,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Кратно 1 000, не меньше ${fmtPrice(widget.lowest)}. С этой суммой игроки садятся за стол; '
            'у кого меньше — в комнату не войдёт.',
            style: const TextStyle(fontSize: 13, color: Colors.white60),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: submit, child: const Text('ГОТОВО')),
      ],
    );
  }
}

// Окно «Своё время игры»: 15…180 минут (§20). Поле живёт, пока живёт окно, — как у своей суммы.
class _CustomTimeDialog extends StatefulWidget {
  final int? initial;

  const _CustomTimeDialog({required this.initial});

  @override
  State<_CustomTimeDialog> createState() => _CustomTimeDialogState();
}

class _CustomTimeDialogState extends State<_CustomTimeDialog> {
  late final controller = TextEditingController(text: widget.initial?.toString() ?? '');
  String? error;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  void submit() {
    final v = int.tryParse(controller.text.trim());
    if (v == null) {
      setState(() => error = 'Впишите число минут');
    } else if (v < tableTimeMin) {
      setState(() => error = 'Минимальное время стола — $tableTimeMin минут');
    } else if (v > tableTimeMax) {
      setState(() => error = 'Максимальное время стола — 3 часа');
    } else {
      Navigator.pop(context, v);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Своё время игры'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onSubmitted: (_) => submit(),
            decoration: InputDecoration(
              hintText: 'например, 45',
              suffixText: 'минут',
              errorText: error,
              errorMaxLines: 2,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'От $tableTimeMin минут до 3 часов ($tableTimeMax минут).',
            style: TextStyle(fontSize: 13, color: Colors.white60),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ОТМЕНА')),
        FilledButton(onPressed: submit, child: const Text('ГОТОВО')),
      ],
    );
  }
}
