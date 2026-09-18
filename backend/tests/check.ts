// Мини-набор для проверок: без зависимостей, чтобы не тянуть тестовый фреймворк.
// Каждая проверка сравнивает результат с ожидаемым через JSON и печатает OK / FAIL.

let passed = 0;
let failed = 0;

export function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

export function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`OK   ${name}`);
    return;
  }
  failed++;
  console.log(`FAIL ${name}\n     ожидали  ${e}\n     получили ${a}`);
}

// Итог всех проверок. Возвращает число проваленных.
export function summary(): number {
  console.log(
    failed === 0
      ? `\nВСЕ ПРОВЕРКИ ПРОШЛИ: ${passed}`
      : `\nПРОВАЛЕНО: ${failed} из ${passed + failed}`,
  );
  return failed;
}
