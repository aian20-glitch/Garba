# Боты-игроки для ручной проверки GARBA на эмуляторе.
#
# Зачем нужен: Git Bash и PowerShell портят кириллицу при передаче тела запроса
# в curl.exe. Здесь запросы идут нативным Invoke-RestMethod с явным UTF-8,
# поэтому русские имена и заявки РАЗ / ДВА / ПАС доезжают до сервера целыми.
#
# Использование:
#   .\tools\garba.ps1 join    -Room 12345     добрать ботов до полной комнаты
#   .\tools\garba.ps1 state   -Room 12345     показать состояние комнаты
#   .\tools\garba.ps1 deal    -Room 12345     раздать, если раздающим оказался бот
#   .\tools\garba.ps1 bid     -Room 12345 -Bid РАЗ -Bot 1    заявка конкретного бота
#   .\tools\garba.ps1 bid     -Room 12345 -Bid ДВА -Suit clubs -Bot 2   ДВА с мастью (6–7 игроков)
#   .\tools\garba.ps1 passall -Room 12345     боты пасуют, пока очередь не дойдёт до тебя
#   .\tools\garba.ps1 playall -Room 12345     боты ходят картами, пока очередь не дойдёт до тебя
#   .\tools\garba.ps1 vote    -Room 12345 -Choice split      все боты голосуют (continue | split)
#   .\tools\garba.ps1 bid     -Room 12345 -Bid КОН -Bot 1    КОН (когда кон дорос до порога)
#   .\tools\garba.ps1 kontrump -Room 12345 -Suit diamonds    бот, выигравший КОН, называет козырь
#   .\tools\garba.ps1 special -Room 12345 -Risk 2            бот, чья очередь, берёт спецкарту за ×2
#   .\tools\garba.ps1 special -Room 12345                    бот, чья очередь, пасует
#   .\tools\garba.ps1 discard -Room 12345                    бот-владелец спецкарты сбрасывает карту

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('join', 'state', 'deal', 'bid', 'passall', 'playall', 'vote', 'kontrump', 'special', 'discard')]
    [string]$Command,

    [Parameter(Mandatory = $true)]
    [string]$Room,

    [string]$Bid = 'ПАС',

    [int]$Bot = 1,

    [ValidateSet('continue', 'split')]
    [string]$Choice = 'continue',

    # Масть для ДВА при 6 и 7 игроках (RULES.md §6.3). При 5 не нужна.
    [ValidateSet('', 'hearts', 'diamonds', 'clubs', 'spades')]
    [string]$Suit = '',

    # Множитель для спецкарты (RULES.md §7). 0 — пас.
    [ValidateRange(0, 5)]
    [int]$Risk = 0
)

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000'

$bots = @(
    @{ id = 'bot-1'; name = 'Айдар' },
    @{ id = 'bot-2'; name = 'Дана' },
    @{ id = 'bot-3'; name = 'Ержан' },
    @{ id = 'bot-4'; name = 'Асель' },
    @{ id = 'bot-5'; name = 'Тимур' },
    @{ id = 'bot-6'; name = 'Мадина' }
)

function Send-Json($url, $obj) {
    $json = $obj | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri $url -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes
}

function Get-RoomState($viewer) {
    $url = "$base/rooms/$Room"
    if ($viewer) { $url = "$url`?playerId=$viewer" }
    return Invoke-RestMethod -Uri $url
}

function Show-State {
    $r = Get-RoomState $null
    Write-Host ""
    Write-Host "Комната $($r.id): $($r.players.Count)/$($r.capacity), статус $($r.status)"

    if (-not $r.game) {
        Write-Host "Игроки: $(($r.players | ForEach-Object { $_.name }) -join ', ')"
        Write-Host "Игра ещё не начата."
        return
    }

    $g = $r.game
    Write-Host "Раздающий: $($g.dealerName) | стадия: $($g.stage)"
    Write-Host "Кон: $($g.kon) (базовый $($g.baseKon)) | РАЗ стоит $($g.razStake), ДВА стоит $($g.dvaStake)"
    if ($g.konAvailable) {
        Write-Host "КОН открыт (с $($g.konUnlockAt)), стоит $($g.konStake)"
    }
    if ($g.special) {
        $sp = $g.special
        Write-Host "СПЕЦКАРТА: $($sp.card.rank) $($sp.card.suit) ($($sp.kind)), фаза $($sp.phase)"
        if ($sp.holderName) { Write-Host "  у $($sp.holderName) на x$($sp.risk)" }
        if ($sp.activeId) { Write-Host "  решает: $($sp.activeId)" }
        if ($sp.passedIds.Count -gt 0) { Write-Host "  выбыли: $($sp.passedIds -join ', ')" }
        if ($sp.outcome -eq 'nobody') { Write-Host "  не взял никто — обычные торги" }
    }
    if ($g.stage -eq 'special_discard') {
        Write-Host "Владелец спецкарты $($g.mains[0].playerName) сбрасывает одну карту"
    }
    if ($g.stage -eq 'kon_trump') {
        Write-Host "КОН выиграл $($g.mains[0].playerName) — ждём, какой козырь он назовёт"
    }
    if ($g.closing) {
        Write-Host "У кого-то меньше базового кона — доигрываем последний кон"
    }

    if ($g.openCard) {
        Write-Host "Открыта: $($g.openCard.rank) $($g.openCard.suit)"
    }
    if ($g.trumpSuit) {
        Write-Host "Козырь: $($g.trumpSuit)"
    } elseif ($g.razSuit) {
        Write-Host "РАЗ: $($g.razSuit)"
    }
    if ($g.izzhoga -and $g.izzhoga.Count -gt 0) {
        $iz = $g.izzhoga | ForEach-Object { "$($_.rank) $($_.suit)" }
        Write-Host "ИЗЖОГА (вернули в колоду): $($iz -join ', ')"
    }
    if ($g.stage -eq 'awaiting_deal') {
        $why = 'Все спасовали'
        if ($g.lastRedeal -eq 'three_izzhoga') { $why = 'Три ИЗЖОГИ подряд' }
        Write-Host "$why — пересдача, раздаёт $($g.dealerName)"
        if ($g.lastAnte -and $g.lastAnte.skipped) {
            Write-Host "Доливки нет ни у кого: не хватает на взнос у $($g.lastAnte.brokePlayerIds -join ', ')"
        }
    }

    if ($g.stage -eq 'vote') {
        Write-Host "ГОЛОСОВАНИЕ: кон не по карману никому (самая дешёвая заявка $($g.vote.cheapest))"
        Write-Host "Продолжаем: $($g.vote.continueVotes) | Делим: $($g.vote.splitVotes) | голосовали: $($g.vote.votedIds -join ', ')"
    }
    if ($g.lastVote -and $g.stage -ne 'vote') {
        Write-Host "Последнее голосование: $($g.lastVote.result) ($($g.lastVote.continueVotes) : $($g.lastVote.splitVotes))"
    }

    $mainIds = @($g.mains | ForEach-Object { $_.playerId })
    $playing = ($g.stage -eq 'playing' -or $g.stage -eq 'round_done')
    $actor = $g.activeBidderId
    if ($g.stage -eq 'playing') { $actor = $g.turnPlayerId }

    if ($g.stage -eq 'playing') {
        Write-Host "Взятка $($g.trickNumber) из 5"
        if ($g.currentTrick.Count -gt 0) {
            $cards = $g.currentTrick | ForEach-Object { "$($_.playerName): $($_.card.rank) $($_.card.suit)" }
            Write-Host "На столе: $($cards -join ' | ')"
        } elseif ($g.lastTrick) {
            Write-Host "Прошлую взятку забрал $($g.lastTrick.winnerName)"
        }
    }

    foreach ($p in $r.players) {
        $mark = '  '
        if ($p.id -eq $actor) { $mark = '->' }
        if ($mainIds -contains $p.id -and $p.id -ne $actor) { $mark = '**' }

        if ($playing) {
            $said = "взяток: $($g.tricksWon.($p.id))"
        } else {
            $said = ($g.bids | Where-Object { $_.playerId -eq $p.id } | Select-Object -Last 1).bid
            if (-not $said) { $said = '-' }
        }

        Write-Host ("{0} {1,-10} {2,-10} карт: {3}  баланс: {4}" -f $mark, $p.name, $said, $g.handCounts.($p.id), $p.balance)
    }

    if ($g.stage -eq 'round_done') {
        Write-Host ""
        $noPlay = @($g.result | Where-Object { $_.instant }).Count -gt 0
        if ($g.trickNumber -lt 5 -and -not $noPlay) {
            Write-Host "Исход ясен после $($g.trickNumber)-й взятки — дальше не играли"
        }
        foreach ($res in $g.result) {
            $verdict = 'ПРОИГРАЛ'
            if ($res.won) { $verdict = 'ВЫИГРАЛ' }
            $how = "взяток $($res.tricks)"
            if ($res.garba) { $how = 'ГАРБА, без розыгрыша' }
            elseif ($res.instant) { $how = 'Q K A козыря, без розыгрыша (не ГАРБА)' }
            Write-Host "ИТОГ: $($res.playerName) ($($res.declaration)) — $how, $verdict, $($res.delta)"
        }
        Write-Host "Кон: $($g.konBeforeSettlement) -> $($g.kon). Следующую раздачу сдаёт $($g.dealerName)"
    }

    if ($g.stage -eq 'room_done') {
        Write-Host ""
        Write-Host "КОМНАТА ЗАКРЫТА. Итоги:"
        if ($g.closeReason -eq 'nobody_can_play') {
            Write-Host "Кон $($g.split.kon) не по карману никому — поделили по $($g.split.perPlayer), остаток $($g.split.remainder)"
        }
        foreach ($p in $r.players) {
            Write-Host ("   {0,-10} {1} -> {2}  ({3})" -f $p.name, $p.startBalance, $p.balance, ($p.balance - $p.startBalance))
        }
    }
    Write-Host ""
}

switch ($Command) {

    'join' {
        $r = Get-RoomState $null
        $need = $r.capacity - $r.players.Count

        if ($need -le 0) {
            Write-Host "Комната уже полная: $($r.players.Count)/$($r.capacity)"
            break
        }

        for ($i = 0; $i -lt $need; $i++) {
            $b = $bots[$i]
            $res = Send-Json "$base/rooms/$Room/join" @{ playerId = $b.id; name = $b.name }
            Write-Host "$($b.name) вошёл: $($res.players.Count)/$($res.capacity)"
        }

        Show-State
    }

    'state' {
        Show-State
    }

    'deal' {
        $r = Get-RoomState $null

        if (-not $r.game) {
            Write-Host "Игра ещё не начата — сначала нажми СТАРТ в приложении."
            break
        }
        $dealable = @('dealer_found', 'awaiting_deal', 'round_done')
        if ($dealable -notcontains $r.game.stage) {
            Write-Host "Карты уже розданы, стадия: $($r.game.stage)"
            Show-State
            break
        }

        $dealerId = $r.game.dealerId
        $b = $bots | Where-Object { $_.id -eq $dealerId }

        if (-not $b) {
            Write-Host "Раздающий — живой игрок ($($r.game.dealerName)). Жми кнопку в приложении."
            break
        }

        Send-Json "$base/rooms/$Room/dealer/continue" @{ playerId = $b.id } | Out-Null
        Write-Host "$($b.name) раздал карты"
        Show-State
    }

    'bid' {
        $b = $bots[$Bot - 1]
        $body = @{ playerId = $b.id; bid = $Bid }
        if ($Suit) { $body.suit = $Suit }
        $res = Send-Json "$base/rooms/$Room/bid" $body
        Write-Host "$($b.name) сказал $Bid $Suit"
        Show-State
    }

    'passall' {
        for ($guard = 0; $guard -lt 10; $guard++) {
            $r = Get-RoomState $null

            if (-not $r.game) {
                Write-Host "Игра ещё не начата."
                break
            }
            if ($r.game.stage -ne 'bidding') {
                Write-Host "Торги не активны, стадия: $($r.game.stage)"
                break
            }

            $active = $r.game.activeBidderId
            $b = $bots | Where-Object { $_.id -eq $active }

            if (-not $b) {
                Write-Host "Сейчас ход живого игрока. Жду тебя."
                break
            }

            Send-Json "$base/rooms/$Room/bid" @{ playerId = $b.id; bid = 'ПАС' } | Out-Null
            Write-Host "$($b.name) сказал ПАС"
        }

        Show-State
    }

    'playall' {
        # Бот кладёт первую карту из тех, что сервер разрешил. Никакой стратегии —
        # задача только довести раздачу до твоего хода.
        for ($guard = 0; $guard -lt 40; $guard++) {
            $r = Get-RoomState $null

            if (-not $r.game -or $r.game.stage -ne 'playing') {
                Write-Host "Розыгрыш не идёт, стадия: $($r.game.stage)"
                break
            }

            $active = $r.game.turnPlayerId
            $b = $bots | Where-Object { $_.id -eq $active }

            if (-not $b) {
                Write-Host "Сейчас ход живого игрока. Жду тебя."
                break
            }

            $view = Get-RoomState $b.id
            $cardId = @($view.game.myPlayableCardIds)[0]
            $card = $view.game.hand | Where-Object { $_.id -eq $cardId }

            Send-Json "$base/rooms/$Room/play" @{ playerId = $b.id; cardId = $cardId } | Out-Null
            Write-Host "$($b.name) сходил: $($card.rank) $($card.suit)"
        }

        Show-State
    }

    'special' {
        # Бот, чья очередь в борьбе за спецкарту: -Risk N — взять за ×N, без -Risk — пас.
        $r = Get-RoomState $null
        if (-not $r.game -or $r.game.stage -ne 'special') {
            Write-Host "Борьбы за спецкарту нет, стадия: $($r.game.stage)"
            break
        }
        $activeId = $r.game.special.activeId
        $b = $bots | Where-Object { $_.id -eq $activeId }
        if (-not $b) {
            Write-Host "Сейчас решает живой игрок. Жми в приложении."
            break
        }
        if ($Risk -gt 0) {
            Send-Json "$base/rooms/$Room/special" @{ playerId = $b.id; action = 'take'; risk = $Risk } | Out-Null
            Write-Host "$($b.name) берёт спецкарту за x$Risk"
        } else {
            Send-Json "$base/rooms/$Room/special" @{ playerId = $b.id; action = 'pass' } | Out-Null
            Write-Host "$($b.name) пасует"
        }
        Show-State
    }

    'discard' {
        # Бот-владелец спецкарты сбрасывает первую разрешённую карту.
        $r = Get-RoomState $null
        if (-not $r.game -or $r.game.stage -ne 'special_discard') {
            Write-Host "Сейчас никто не сбрасывает, стадия: $($r.game.stage)"
            break
        }
        $ownerId = $r.game.mains[0].playerId
        $b = $bots | Where-Object { $_.id -eq $ownerId }
        if (-not $b) {
            Write-Host "Спецкарта у живого игрока. Сбрасывай в приложении."
            break
        }
        $view = Get-RoomState $b.id
        $cardId = @($view.game.myDiscardOptions)[0]
        Send-Json "$base/rooms/$Room/discard" @{ playerId = $b.id; cardId = $cardId } | Out-Null
        Write-Host "$($b.name) сбросил карту (её никто не видит)"
        Show-State
    }

    'kontrump' {
        # Бот, выигравший КОН, называет козырь. -Suit не задан — берёт масть РАЗ.
        $r = Get-RoomState $null
        if (-not $r.game -or $r.game.stage -ne 'kon_trump') {
            Write-Host "Сейчас никто не выбирает козырь для КОНА, стадия: $($r.game.stage)"
            break
        }
        $konId = $r.game.mains[0].playerId
        $b = $bots | Where-Object { $_.id -eq $konId }
        if (-not $b) {
            Write-Host "КОН у живого игрока ($($r.game.mains[0].playerName)). Выбирай козырь в приложении."
            break
        }
        $pick = $Suit
        if (-not $pick) { $pick = $r.game.razSuit }
        Send-Json "$base/rooms/$Room/kon-trump" @{ playerId = $b.id; suit = $pick } | Out-Null
        Write-Host "$($b.name) (КОН) назвал козырь: $pick"
        Show-State
    }

    'vote' {
        # Все боты, которые ещё не голосовали, голосуют одинаково.
        # Сервер объявит итог, как только его нельзя будет изменить.
        foreach ($b in $bots) {
            $r = Get-RoomState $null

            if (-not $r.game -or $r.game.stage -ne 'vote') {
                Write-Host "Голосования нет, стадия: $($r.game.stage)"
                break
            }
            if (-not ($r.players | Where-Object { $_.id -eq $b.id })) { continue }
            if ($r.game.vote.votedIds -contains $b.id) { continue }

            Send-Json "$base/rooms/$Room/vote" @{ playerId = $b.id; choice = $Choice } | Out-Null
            Write-Host "$($b.name) голосует: $Choice"
        }

        Show-State
    }
}













