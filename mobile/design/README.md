# Иконка ГАРБА — «Көк аспан»

Небесный фон, золотые рога «қошқар мүйіз» (казахский орнамент), надпись ГАРБА.

- `icon-full.svg` — iOS (квадрат во весь размер, без прозрачности — скругляет система);
- `icon-legacy.svg` — Android до 8.0 (скруглённый квадрат);
- `icon-bg.svg` + `icon-fg.svg` — адаптивная иконка Android 8+ (фон и рисунок в безопасной зоне).

Перерисовать PNG: открыть SVG в Chrome без окна
(`--headless=new --screenshot --window-size=1024,1024 --default-background-color=00000000`)
и уменьшить `sips -z <px> <px>` до размеров из `mipmap-*` и `AppIcon.appiconset`.
